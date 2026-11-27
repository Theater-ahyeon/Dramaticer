import { type LlmClient, NO_CONTINUATION } from "../llm/types.js";
import type { CanonEntityInput } from "../store/repos/canon.js";
import type { StoryStore } from "../store/story-store.js";
import { planCanonChunks } from "./estimate.js";
import { buildCanonExtractionPrompt } from "./prompt.js";
/**
 * 原著按章抽取：超过 2 万字的章按段落切块，每块一次调用。
 * 块的结果由程序校验，失败只影响这一块；暂停、续跑与单章重跑都按已落库的进度走。
 */
import type {
	CanonChapterExtractionRecord,
	CanonChapterRecord,
	CanonChunkExtraction,
	CanonChunkPlan,
	CanonChunkProgress,
	CanonEntityKind,
	CanonEntityRecord,
	CanonExtractedEvent,
	CanonExtractedFact,
	CanonExtractedVoice,
	CanonExtractionRecord,
} from "./types.js";
import { isCanonEntityKind } from "./types.js";

export const CANON_EXTRACT_MAX_TOKENS = 4_096;

export interface CanonExtractionRunOptions {
	readonly store: StoryStore;
	readonly client: LlmClient;
	readonly model: string;
	readonly bookId: string;
	readonly signal?: AbortSignal;
	readonly onProgress?: (record: CanonExtractionRecord) => void;
}

export interface CanonChapterExtractionOptions {
	readonly store: StoryStore;
	readonly client: LlmClient;
	readonly model: string;
	readonly bookId: string;
	readonly chapterId: string;
	/** resume 只跑未完成的块；full 先清掉这一章的旧结果再整章重抽。 */
	readonly mode: "resume" | "full";
	readonly signal?: AbortSignal;
}

export interface CanonChapterExtractionResult {
	readonly chapter: CanonChapterExtractionRecord;
	readonly calls: number;
	readonly tokens: number;
}

/** 校验时需要的上下文：本块范围、原文与当前名册。 */
export interface CanonChunkValidationContext {
	readonly chunk: CanonChunkPlan;
	readonly paragraphs: readonly string[];
	readonly roster: readonly CanonEntityRecord[];
}

/** 开始或继续：把任务标成 running，并为每章补齐块进度。 */
export function beginCanonExtraction(
	store: StoryStore,
	bookId: string,
	model: string | null,
): CanonExtractionRecord {
	store.ensureCanonExtraction(bookId);
	const chapters = store.listCanonChapterRecords(bookId);
	for (const chapter of chapters) {
		const existing = store.getCanonChapterExtraction(chapter.id);
		if (existing !== null && chunkPlanMatches(existing.chunks, chapter))
			continue;
		if (existing !== null) {
			store.clearCanonChapterResults(chapter.id);
		}
		store.resetCanonChapterExtraction(bookId, chapter.id, {
			chapterOrdinal: chapter.ordinal,
			chunks: planCanonChunks(chapter.paragraphs),
		});
	}
	store.refreshCanonExtraction(bookId);
	return store.markCanonExtractionRunning(bookId, model);
}

/** 从头跑到尾：跳过已完成章，失败章会重试；暂停或中断时保留已完成章。 */
export async function runCanonBookExtraction(
	options: CanonExtractionRunOptions,
): Promise<CanonExtractionRecord> {
	const { store, bookId } = options;
	beginCanonExtraction(store, bookId, options.model);
	const chapters = store.listCanonChapterRecords(bookId);
	for (const chapter of chapters) {
		if (
			options.signal?.aborted ||
			store.getCanonExtraction(bookId)?.status !== "running"
		) {
			return store.pauseCanonExtraction(bookId);
		}
		const existing = store.getCanonChapterExtraction(chapter.id);
		if (
			existing?.status === "done" &&
			chunkPlanMatches(existing.chunks, chapter)
		) {
			options.onProgress?.(store.refreshCanonExtraction(bookId));
			continue;
		}
		await extractCanonChapter({
			store,
			client: options.client,
			model: options.model,
			bookId,
			chapterId: chapter.id,
			mode: "resume",
			...(options.signal === undefined ? {} : { signal: options.signal }),
		});
		options.onProgress?.(store.refreshCanonExtraction(bookId));
		if (options.signal?.aborted) {
			return store.pauseCanonExtraction(bookId);
		}
		if (store.getCanonExtraction(bookId)?.status === "paused") {
			return store.pauseCanonExtraction(bookId);
		}
	}
	return finalizeCanonExtraction(store, bookId);
}

/** 单章重跑；resume 只补没完成的块，full 清掉旧结果与名册后整章重来。 */
export async function extractCanonChapter(
	options: CanonChapterExtractionOptions,
): Promise<CanonChapterExtractionResult> {
	const { store, bookId, chapterId } = options;
	const chapter = store.getCanonChapter(bookId, chapterId);
	if (chapter === null) throw new Error(`章节不存在：${chapterId}`);
	store.ensureCanonExtraction(bookId);
	const plan = planCanonChunks(chapter.paragraphs);
	const existing = store.getCanonChapterExtraction(chapterId);
	const stale =
		options.mode === "full" ||
		existing === null ||
		!chunkPlanMatches(existing.chunks, chapter);
	if (stale) {
		store.clearCanonChapterResults(chapterId);
		if (options.mode === "full") rebuildCanonEntityRoster(store, bookId);
	}
	const progress = stale
		? store.resetCanonChapterExtraction(bookId, chapterId, {
				chapterOrdinal: chapter.ordinal,
				chunks: plan,
			})
		: existing;
	if (progress === null) {
		throw new Error(`章节 ${chapterId} 的抽取进度创建失败`);
	}
	const base = progress;
	const chunks = plan.map(
		(chunk, index) =>
			base.chunks[index] ?? {
				...chunk,
				status: "pending" as const,
				error: null,
				tokens: 0,
			},
	);
	store.setCanonChapterExtraction(bookId, chapterId, {
		status: "running",
		chunks,
		lastError: null,
		tokens: base.tokens,
	});
	let calls = 0;
	let tokens = progress.tokens;
	let firstError: string | null = null;
	for (let index = 0; index < plan.length; index += 1) {
		const chunk = plan[index];
		const current = chunks[index];
		if (chunk === undefined || current === undefined) continue;
		if (current.status === "done") continue;
		if (
			store.getCanonExtraction(bookId)?.status !== "running" ||
			options.signal?.aborted
		) {
			store.setCanonChapterExtraction(bookId, chapterId, {
				status: hasFailed(chunks) ? "failed" : "pending",
				chunks,
				lastError: firstError,
				tokens,
			});
			store.refreshCanonExtraction(bookId);
			return {
				chapter: requireChapterExtraction(store, chapterId),
				calls,
				tokens,
			};
		}
		chunks[index] = { ...current, status: "running", error: null };
		store.setCanonChapterExtraction(bookId, chapterId, {
			status: "running",
			chunks,
			lastError: firstError,
			tokens,
		});
		const roster = store.listCanonEntities(bookId);
		const prompt = buildCanonExtractionPrompt({
			bookTitle: store.getCanonBook(bookId)?.title ?? "原著",
			chapterOrdinal: chapter.ordinal,
			chapterTitle: chapter.title,
			chunk,
			paragraphs: chapter.paragraphs,
			roster,
		});
		try {
			const result = await options.client.complete(
				{
					messages: [
						{ role: "system", content: prompt.system },
						{ role: "user", content: prompt.user },
					],
					model: options.model,
					temperature: 0,
					maxTokens: CANON_EXTRACT_MAX_TOKENS,
					...(options.signal === undefined ? {} : { signal: options.signal }),
				},
				NO_CONTINUATION,
			);
			const usedTokens =
				result.usage.totalTokens ??
				(result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0);
			const usedCalls = result.cached ? 0 : Math.max(1, result.attempts);
			calls += usedCalls;
			tokens += usedTokens;
			store.addCanonExtractionUsage(bookId, usedCalls, usedTokens);
			const extracted = parseCanonExtractionResponse(result.text);
			const context: CanonChunkValidationContext = {
				chunk,
				paragraphs: chapter.paragraphs,
				roster,
			};
			validateCanonChunkExtraction(extracted, context);
			const canonical = canonicalizeExtraction(
				extracted,
				roster,
				chapter.ordinal,
			);
			store.insertCanonChunkResults({
				bookId,
				chapterId,
				chapterOrdinal: chapter.ordinal,
				events: canonical.events,
				voices: canonical.voices,
				facts: canonical.facts,
			});
			store.upsertCanonEntities(bookId, canonical.entities);
			chunks[index] = {
				...chunkStatus(chunks[index], "done"),
				error: null,
				tokens: (chunks[index]?.tokens ?? 0) + usedTokens,
			};
		} catch (error) {
			if (options.signal?.aborted) {
				chunks[index] = {
					...chunkStatus(chunks[index], "pending"),
					error: null,
				};
				store.setCanonChapterExtraction(bookId, chapterId, {
					status: "pending",
					chunks,
					lastError: firstError,
					tokens,
				});
				store.refreshCanonExtraction(bookId);
				return {
					chapter: requireChapterExtraction(store, chapterId),
					calls,
					tokens,
				};
			}
			const message = error instanceof Error ? error.message : String(error);
			firstError ??= message;
			chunks[index] = {
				...chunkStatus(chunks[index], "failed"),
				error: message,
			};
		}
		store.setCanonChapterExtraction(bookId, chapterId, {
			status: "running",
			chunks,
			lastError: firstError,
			tokens,
		});
		store.refreshCanonExtraction(bookId);
	}
	const status = hasFailed(chunks) ? "failed" : "done";
	store.setCanonChapterExtraction(bookId, chapterId, {
		status,
		chunks,
		lastError: firstError,
		tokens,
	});
	store.refreshCanonExtraction(bookId);
	return {
		chapter: requireChapterExtraction(store, chapterId),
		calls,
		tokens,
	};
}

/** 全书跑完后按实际进度收尾：全部完成是 done，有失败章是 failed。 */
export function finalizeCanonExtraction(
	store: StoryStore,
	bookId: string,
): CanonExtractionRecord {
	const refreshed = store.refreshCanonExtraction(bookId);
	if (
		refreshed.totalChapters > 0 &&
		refreshed.doneChapters === refreshed.totalChapters
	) {
		return store.finishCanonExtraction(bookId, "done", null);
	}
	if (refreshed.failedChapters > 0) {
		const first = store
			.listCanonChapterExtractions(bookId)
			.find((item) => item.status === "failed");
		return store.finishCanonExtraction(
			bookId,
			"failed",
			first?.lastError ?? "有章节抽取失败",
		);
	}
	return store.pauseCanonExtraction(bookId);
}

/** 从剩余事实与事件重建书级名册；整章重跑后用，避免旧别名继续影响后续章节。 */
export function rebuildCanonEntityRoster(
	store: StoryStore,
	bookId: string,
): readonly CanonEntityRecord[] {
	const facts = store.listCanonFacts(bookId);
	const events = store.listCanonEvents(bookId);
	const accumulated: Array<{
		name: string;
		aliases: string[];
		kind: CanonEntityKind;
		chapterOrdinal: number;
	}> = [];
	const resolve = (name: string) =>
		accumulated.find(
			(entry) => entry.name === name || entry.aliases.includes(name),
		);
	for (const fact of facts) {
		const existing = resolve(fact.entityName);
		if (existing === undefined) {
			accumulated.push({
				name: fact.entityName,
				aliases: fact.aliases.filter((alias) => alias !== fact.entityName),
				kind: fact.entityKind,
				chapterOrdinal: fact.chapterOrdinal,
			});
			continue;
		}
		for (const alias of fact.aliases) {
			if (alias !== existing.name && !existing.aliases.includes(alias)) {
				existing.aliases.push(alias);
			}
		}
	}
	for (const event of events) {
		for (const participant of event.participants) {
			if (resolve(participant) !== undefined) continue;
			accumulated.push({
				name: participant,
				aliases: [],
				kind: "人物",
				chapterOrdinal: event.chapterOrdinal,
			});
		}
	}
	store.replaceCanonEntities(bookId, accumulated);
	return store.listCanonEntities(bookId);
}

/** 从模型回复里取出 JSON；允许 ```json 围栏与前后少量说明。 */
export function parseCanonExtractionResponse(
	text: string,
): CanonChunkExtraction {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) {
		throw new Error("模型回复里没有 JSON 对象");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text.slice(start, end + 1));
	} catch (error) {
		throw new Error(
			`模型回复的 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("模型回复的 JSON 不是对象");
	}
	const record = parsed as Record<string, unknown>;
	return {
		events: readArray(record.events, "events").map(readEvent),
		voices: readArray(record.voices, "voices").map(readVoice),
		facts: readArray(record.facts, "facts").map(readFact),
	};
}

/** 块级程序校验：参与人物出现在本块原文，段落范围不越界。 */
export function validateCanonChunkExtraction(
	extraction: CanonChunkExtraction,
	context: CanonChunkValidationContext,
): void {
	const chunkText = context.paragraphs
		.slice(context.chunk.startParagraph - 1, context.chunk.endParagraph)
		.join("\n");
	const aliasesFor = (name: string): readonly string[] => {
		const candidates = new Set<string>([name]);
		for (const entity of context.roster) {
			if (entity.name === name || entity.aliases.includes(name)) {
				candidates.add(entity.name);
				for (const alias of entity.aliases) candidates.add(alias);
			}
		}
		return [...candidates];
	};
	for (const event of extraction.events) {
		for (const participant of event.participants) {
			if (!aliasesFor(participant).some((name) => chunkText.includes(name))) {
				throw new Error(
					`事件「${event.title}」的参与人物「${participant}」没有在本块原文出现`,
				);
			}
		}
		if (
			!Number.isInteger(event.paragraphStart) ||
			!Number.isInteger(event.paragraphEnd) ||
			event.paragraphStart < context.chunk.startParagraph ||
			event.paragraphEnd > context.chunk.endParagraph ||
			event.paragraphStart > event.paragraphEnd
		) {
			throw new Error(
				`事件「${event.title}」的段落范围 ${event.paragraphStart}-${event.paragraphEnd} 超出本块 ${context.chunk.startParagraph}-${context.chunk.endParagraph}`,
			);
		}
	}
}

export function chunkPlanMatches(
	chunks: readonly CanonChunkProgress[] | readonly CanonChunkPlan[],
	chapter: CanonChapterRecord,
): boolean {
	if (chunks.length === 0) return false;
	let nextStart = 1;
	for (const chunk of chunks) {
		if (
			chunk.startParagraph !== nextStart ||
			chunk.endParagraph < chunk.startParagraph ||
			chunk.endParagraph > chapter.paragraphs.length
		) {
			return false;
		}
		nextStart = chunk.endParagraph + 1;
	}
	return nextStart === chapter.paragraphs.length + 1;
}

/** 把事实里的别名归到标准名；事件参与人物与话术人物一起归并。 */
function canonicalizeExtraction(
	extraction: CanonChunkExtraction,
	roster: readonly CanonEntityRecord[],
	chapterOrdinal: number,
): {
	readonly events: readonly CanonExtractedEvent[];
	readonly voices: readonly CanonExtractedVoice[];
	readonly facts: readonly CanonExtractedFact[];
	readonly entities: readonly CanonEntityInput[];
} {
	const known = new Map<
		string,
		{
			name: string;
			aliases: string[];
			kind: CanonEntityKind;
			chapterOrdinal: number;
		}
	>();
	for (const entity of roster) {
		known.set(entity.name, {
			name: entity.name,
			aliases: [...entity.aliases],
			kind: entity.kind,
			chapterOrdinal: entity.firstChapterOrdinal,
		});
	}
	const resolve = (name: string): string => {
		for (const entity of known.values()) {
			if (entity.name === name || entity.aliases.includes(name)) {
				return entity.name;
			}
		}
		return name;
	};
	const facts: CanonExtractedFact[] = [];
	const appeared = new Set<string>();
	for (const fact of extraction.facts) {
		const name = resolve(fact.name);
		appeared.add(name);
		const aliases = [...new Set(fact.aliases.map(resolve))].filter(
			(alias) => alias !== name,
		);
		const existing = known.get(name);
		if (existing === undefined) {
			known.set(name, {
				name,
				aliases,
				kind: fact.kind,
				chapterOrdinal,
			});
		} else {
			for (const alias of aliases) {
				if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
			}
			existing.kind = fact.kind;
			existing.chapterOrdinal = Math.min(
				existing.chapterOrdinal,
				chapterOrdinal,
			);
		}
		facts.push({ ...fact, name, aliases });
	}
	const events = extraction.events.map((event) => ({
		...event,
		participants: [
			...new Set(event.participants.map((participant) => resolve(participant))),
		],
	}));
	const voices = extraction.voices.map((voice) => ({
		...voice,
		character: resolve(voice.character),
	}));
	for (const event of events) {
		for (const participant of event.participants) {
			appeared.add(participant);
			if (!known.has(participant)) {
				known.set(participant, {
					name: participant,
					aliases: [],
					kind: "人物",
					chapterOrdinal,
				});
			}
		}
	}
	for (const voice of voices) appeared.add(voice.character);
	return {
		events,
		voices,
		facts,
		// 只有这一章真正出现的实体才把末章推到这一章；名册里其余实体保持原范围。
		entities: [...known.values()].map((entity) => ({
			...entity,
			chapterOrdinal: appeared.has(entity.name)
				? chapterOrdinal
				: entity.chapterOrdinal,
		})),
	};
}

function chunkStatus(
	chunk: CanonChunkProgress | undefined,
	status: "pending" | "done" | "failed",
): CanonChunkProgress {
	if (chunk === undefined) throw new Error("块进度丢失");
	return { ...chunk, status };
}

function hasFailed(chunks: readonly CanonChunkProgress[]): boolean {
	return chunks.some((chunk) => chunk.status === "failed");
}

function requireChapterExtraction(
	store: StoryStore,
	chapterId: string,
): CanonChapterExtractionRecord {
	const record = store.getCanonChapterExtraction(chapterId);
	if (record === null) throw new Error(`章节 ${chapterId} 的抽取进度不存在`);
	return record;
}

function readArray(value: unknown, label: string): readonly unknown[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
	return value;
}

function readText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}

function readOptionalText(value: unknown, label: string): string | null {
	if (value === undefined || value === null || value === "") return null;
	if (typeof value !== "string")
		throw new Error(`${label} 必须是字符串或 null`);
	return value.trim() || null;
}

function readStringList(value: unknown, label: string): readonly string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组`);
	return value.map((item, index) =>
		readText(item, `${label} 第 ${index + 1} 项`),
	);
}

function readEvent(value: unknown): CanonExtractedEvent {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("事件必须是对象");
	}
	const record = value as Record<string, unknown>;
	if (typeof record.isInterlude !== "boolean") {
		throw new Error("事件的 isInterlude 必须是布尔值");
	}
	if (
		typeof record.paragraphStart !== "number" ||
		typeof record.paragraphEnd !== "number"
	) {
		throw new Error("事件的段落范围必须是数字");
	}
	return {
		title: readText(record.title, "事件标题"),
		summary: readText(record.summary, "事件概要"),
		digest: readText(record.digest, "事件缩写"),
		participants: readStringList(record.participants, "事件参与人物"),
		location: readOptionalText(record.location, "事件地点"),
		timeText: readOptionalText(record.time, "事件时间"),
		paragraphStart: record.paragraphStart,
		paragraphEnd: record.paragraphEnd,
		isInterlude: record.isInterlude,
	};
}

function readVoice(value: unknown): CanonExtractedVoice {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("话术必须是对象");
	}
	const record = value as Record<string, unknown>;
	if (record.kind !== "speech" && record.kind !== "thought") {
		throw new Error("话术的 kind 只能是 speech 或 thought");
	}
	return {
		character: readText(record.character, "话术人物"),
		kind: record.kind,
		text: readText(record.text, "话术原文"),
	};
}

function readFact(value: unknown): CanonExtractedFact {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("实体增量必须是对象");
	}
	const record = value as Record<string, unknown>;
	const kind = record.kind;
	if (!isCanonEntityKind(kind)) {
		throw new Error("实体类别必须是 人物、地点、势力、物品 或 其他");
	}
	return {
		name: readText(record.name, "实体名"),
		aliases: readStringList(record.aliases, "实体别名"),
		kind,
		fact: readText(record.fact, "实体事实"),
	};
}
