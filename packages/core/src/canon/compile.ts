import { isJsonObject } from "../json.js";
import { type LlmClient, NO_CONTINUATION } from "../llm/types.js";
import type { CanonCompiledEntityInput } from "../store/repos/canon.js";
import type { StoryStore } from "../store/story-store.js";
import {
	type CanonMergePromptInput,
	type CanonPrompt,
	buildCanonEntityPagePrompt,
	buildCanonMergePrompt,
	buildCanonTurningPointPrompt,
	parseCanonCompileResponse,
	renderCanonBaseText,
	sortCanonBaseEntries,
} from "./compile-prompt.js";
import type {
	CanonBaseEntry,
	CanonCompilationRecord,
	CanonCompiledEntityRecord,
	CanonEntityKind,
	CanonEntityMerge,
	CanonEntityRecord,
	CanonEventRecord,
} from "./types.js";

// 全书汇编（canon/03，v5 §5.3）：一次后台任务，分批调用。合并同名与别名、
// 排定主时间线与关键转折、给每个实体生成一行简介与带章节锚点的底色。
// 全部结果写回本机数据库，不计入故事每楼的后台调用预算（I11）。

export const CANON_COMPILE_MAX_TOKENS = 4_096;

/** 一次合并调用最多带多少个实体名。 */
export const CANON_MERGE_ENTITIES_PER_CALL = 24;

/** 一次关键转折调用最多带多少个事件。 */
export const CANON_TURNING_POINTS_PER_CALL = 30;

/** 一次实体页调用最多带几个实体。 */
export const CANON_PAGES_PER_CALL = 4;

/** 世界索引的字数上限，与故事的 world index 一致。 */
export const CANON_WORLD_INDEX_MAX_CHARS = 240;

const LEAD_MAX_CHARS = 60;
const ENTRY_MAX_CHARS = 200;

export interface CanonMergeBatch {
	readonly names: readonly string[];
	/** 程序挑出的可能同指一人的名字，作为提示交给模型。 */
	readonly candidates: readonly (readonly string[])[];
}

export interface CanonMergePlan {
	/** 别名重叠已经能确定的合并组，不再问模型。 */
	readonly locked: readonly CanonEntityMerge[];
	readonly batches: readonly CanonMergeBatch[];
}

export interface CanonCompileCallOptions {
	readonly store: StoryStore;
	readonly client: LlmClient;
	readonly model: string;
	readonly bookId: string;
	readonly signal?: AbortSignal;
	readonly onProgress?: (record: CanonCompilationRecord) => void;
}

export interface CanonCompileOptions extends CanonCompileCallOptions {}

function entityNames(entity: CanonEntityRecord): ReadonlySet<string> {
	return new Set([entity.name, ...entity.aliases]);
}

function pickCanonical(
	entities: readonly CanonEntityRecord[],
	names: readonly string[],
): string {
	const members = entities.filter((entity) => names.includes(entity.name));
	const sorted = [...members].sort((left, right) => {
		if (left.firstChapterOrdinal !== right.firstChapterOrdinal) {
			return left.firstChapterOrdinal - right.firstChapterOrdinal;
		}
		if (left.name.length !== right.name.length) {
			return right.name.length - left.name.length;
		}
		return left.name.localeCompare(right.name, "zh-Hans-CN");
	});
	const first = sorted[0];
	if (first === undefined) throw new Error("合并组里没有实体");
	return first.name;
}

/**
 * 程序侧的合并计划：别名重叠直接合并（同一类别才算同一实体），
 * 其余的按同姓、名字包含关系分成候选批，交给模型确认。
 */
export function planCanonEntityMerges(
	entities: readonly CanonEntityRecord[],
): CanonMergePlan {
	const parent = entities.map((_, index) => index);
	const find = (index: number): number => {
		let current = index;
		while (parent[current] !== current) {
			const next = parent[current];
			if (next === undefined) throw new Error("合并集合越界");
			parent[current] = parent[next] ?? next;
			current = parent[current] ?? next;
		}
		return current;
	};
	const union = (left: number, right: number): void => {
		const leftRoot = find(left);
		const rightRoot = find(right);
		if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
	};
	for (let left = 0; left < entities.length; left += 1) {
		for (let right = left + 1; right < entities.length; right += 1) {
			const a = entities[left];
			const b = entities[right];
			if (a === undefined || b === undefined || a.kind !== b.kind) continue;
			const namesA = entityNames(a);
			if ([...entityNames(b)].some((name) => namesA.has(name))) {
				union(left, right);
			}
		}
	}
	const components = new Map<number, CanonEntityRecord[]>();
	entities.forEach((entity, index) => {
		const root = find(index);
		const list = components.get(root) ?? [];
		list.push(entity);
		components.set(root, list);
	});
	const locked: CanonEntityMerge[] = [];
	const singles: CanonEntityRecord[] = [];
	for (const members of components.values()) {
		if (members.length === 1) {
			const only = members[0];
			if (only !== undefined) singles.push(only);
			continue;
		}
		const names = members.map((entity) => entity.name);
		const canonicalName = pickCanonical(members, names);
		const aliases = new Set<string>();
		for (const entity of members) {
			for (const alias of entity.aliases) {
				if (!names.includes(alias)) aliases.add(alias);
			}
		}
		locked.push({
			canonicalName,
			aliases: [...aliases],
			mergedFrom: names,
		});
	}
	const softLinked = (left: CanonEntityRecord, right: CanonEntityRecord) => {
		if (left.kind !== right.kind) return false;
		if (left.name.includes(right.name) || right.name.includes(left.name)) {
			return true;
		}
		return (
			left.kind === "人物" &&
			left.name.length >= 2 &&
			right.name.length >= 2 &&
			left.name[0] === right.name[0]
		);
	};
	const softParent = singles.map((_, index) => index);
	const softFind = (index: number): number => {
		let current = index;
		while (softParent[current] !== current) {
			const next = softParent[current];
			if (next === undefined) throw new Error("候选集合越界");
			softParent[current] = softParent[next] ?? next;
			current = softParent[current] ?? next;
		}
		return current;
	};
	for (let left = 0; left < singles.length; left += 1) {
		for (let right = left + 1; right < singles.length; right += 1) {
			const a = singles[left];
			const b = singles[right];
			if (a === undefined || b === undefined) continue;
			if (!softLinked(a, b)) continue;
			const leftRoot = softFind(left);
			const rightRoot = softFind(right);
			if (leftRoot !== rightRoot) softParent[rightRoot] = leftRoot;
		}
	}
	const softGroups = new Map<number, CanonEntityRecord[]>();
	singles.forEach((entity, index) => {
		const root = softFind(index);
		const list = softGroups.get(root) ?? [];
		list.push(entity);
		softGroups.set(root, list);
	});
	const batches: { names: string[]; candidates: string[][] }[] = [];
	let current: { names: string[]; candidates: string[][] } = {
		names: [],
		candidates: [],
	};
	const flush = () => {
		if (current.names.length > 0) batches.push(current);
		current = { names: [], candidates: [] };
	};
	for (const group of softGroups.values()) {
		const names = group.map((entity) => entity.name);
		if (current.names.length + names.length > CANON_MERGE_ENTITIES_PER_CALL) {
			flush();
		}
		for (const name of names) current.names.push(name);
		if (names.length > 1) current.candidates.push(names);
	}
	flush();
	return { locked, batches };
}

/** 分批让模型确认合并；返回要落库的全部合并组（含程序已确定的）。 */
export async function mergeCanonEntities(
	options: CanonCompileCallOptions,
): Promise<readonly CanonEntityMerge[]> {
	const entities = options.store.listCanonEntities(options.bookId);
	if (entities.length === 0)
		throw new Error("这本原著还没有抽取到实体，不能汇编");
	const plan = planCanonEntityMerges(entities);
	const bookTitle = options.store.getCanonBook(options.bookId)?.title ?? "原著";
	const merges: CanonEntityMerge[] = [...plan.locked];
	const byName = new Map(entities.map((entity) => [entity.name, entity]));
	for (const batch of plan.batches) {
		ensureNotAborted(options.signal);
		const batchEntities = batch.names
			.map((name) => byName.get(name))
			.filter((entity): entity is CanonEntityRecord => entity !== undefined);
		const prompt = buildCanonMergePrompt({
			bookTitle,
			entities: batchEntities,
			candidates: batch.candidates,
		});
		const value = await callCompileModel(options, prompt);
		merges.push(...readMergeGroups(value, new Set(batch.names)));
	}
	options.store.applyCanonEntityMerges(options.bookId, merges);
	options.onProgress?.(requireCompilation(options.store, options.bookId));
	return merges;
}

/** 主时间线按章节、段落与章内序号排 1..N；插叙不进主时间线。 */
export function buildCanonTimelinePatches(
	events: readonly CanonEventRecord[],
	turningPoints: ReadonlySet<number> = new Set(),
): {
	readonly eventId: number;
	readonly timelineOrder: number | null;
	readonly isTurningPoint: boolean;
}[] {
	const main = events
		.filter((event) => !event.isInterlude)
		.sort(
			(left, right) =>
				left.chapterOrdinal - right.chapterOrdinal ||
				left.paragraphStart - right.paragraphStart ||
				left.seq - right.seq,
		);
	const patches: {
		eventId: number;
		timelineOrder: number | null;
		isTurningPoint: boolean;
	}[] = main.map((event, index) => ({
		eventId: event.id,
		timelineOrder: index + 1,
		isTurningPoint: turningPoints.has(event.id),
	}));
	for (const event of events) {
		if (!event.isInterlude) continue;
		patches.push({
			eventId: event.id,
			timelineOrder: null,
			isTurningPoint: false,
		});
	}
	return patches;
}

/** 分批标关键转折；事件编号必须来自这一批。 */
export async function markCanonTurningPoints(
	options: CanonCompileCallOptions,
): Promise<readonly number[]> {
	const events = [...options.store.listCanonTimeline(options.bookId)].sort(
		(left, right) =>
			left.chapterOrdinal - right.chapterOrdinal ||
			left.paragraphStart - right.paragraphStart ||
			left.seq - right.seq,
	);
	const bookTitle = options.store.getCanonBook(options.bookId)?.title ?? "原著";
	const turningPoints = new Set<number>();
	for (
		let index = 0;
		index < events.length;
		index += CANON_TURNING_POINTS_PER_CALL
	) {
		ensureNotAborted(options.signal);
		const batch = events.slice(index, index + CANON_TURNING_POINTS_PER_CALL);
		const prompt = buildCanonTurningPointPrompt({ bookTitle, events: batch });
		const value = await callCompileModel(options, prompt);
		for (const id of readTurningPoints(
			value,
			new Set(batch.map((event) => event.id)),
		)) {
			turningPoints.add(id);
		}
	}
	options.store.applyCanonEventTimeline(
		options.bookId,
		buildCanonTimelinePatches(events, turningPoints),
	);
	options.onProgress?.(requireCompilation(options.store, options.bookId));
	return [...turningPoints];
}

/** 分批生成实体页（一行简介与带章节锚点的底色），全部生成后一次写回。 */
export async function compileCanonEntityPages(
	options: CanonCompileCallOptions,
): Promise<readonly CanonCompiledEntityInput[]> {
	const entities = options.store.listCanonEntities(options.bookId);
	const facts = options.store.listCanonFacts(options.bookId);
	const events = options.store.listCanonEvents(options.bookId);
	const voices = options.store.listCanonVoices(options.bookId);
	const bookTitle = options.store.getCanonBook(options.bookId)?.title ?? "原著";
	const materials = entities.map((entity) => {
		const entityFacts = facts.filter((fact) => fact.entityName === entity.name);
		const entityEvents = events.filter((event) =>
			event.participants.includes(entity.name),
		);
		const entityVoices = voices.filter(
			(voice) => voice.character === entity.name,
		);
		// 抽出来的名册只按事实记首末章；参与事件与话术也要算进出现范围，
		// 否则底色会被压在事实所在的章里。
		let first = entity.firstChapterOrdinal;
		let last = entity.lastChapterOrdinal;
		for (const ordinal of [
			...entityFacts.map((fact) => fact.chapterOrdinal),
			...entityEvents.map((event) => event.chapterOrdinal),
			...entityVoices.map((voice) => voice.chapterOrdinal),
		]) {
			first = Math.min(first, ordinal);
			last = Math.max(last, ordinal);
		}
		return {
			entity: {
				...entity,
				firstChapterOrdinal: first,
				lastChapterOrdinal: last,
			},
			facts: entityFacts,
			events: entityEvents,
			voices: entityVoices,
		};
	});
	const pages: CanonCompiledEntityInput[] = [];
	for (let index = 0; index < materials.length; index += CANON_PAGES_PER_CALL) {
		ensureNotAborted(options.signal);
		const batch = materials.slice(index, index + CANON_PAGES_PER_CALL);
		const prompt = buildCanonEntityPagePrompt({ bookTitle, materials: batch });
		const value = await callCompileModel(options, prompt);
		pages.push(...readEntityPages(value, batch));
		options.onProgress?.(requireCompilation(options.store, options.bookId));
	}
	options.store.replaceCanonCompiledEntities(options.bookId, pages);
	return pages;
}

/** 一次完整汇编：合并 → 时间线与关键转折 → 实体页。失败写 failed，成功写 done。 */
export async function runCanonCompilation(
	options: CanonCompileOptions,
): Promise<CanonCompilationRecord> {
	const { store, bookId } = options;
	const book = store.getCanonBook(bookId);
	if (book === null) throw new Error(`原著 ${bookId} 不存在`);
	if (!book.hasText) {
		throw new Error("这本原著包不含原文，不需要再汇编");
	}
	if (store.getCanonExtraction(bookId)?.status !== "done") {
		throw new Error("按章抽取还没有完成，不能汇编");
	}
	store.ensureCanonCompilation(bookId);
	store.markCanonCompilationRunning(bookId, options.model);
	options.onProgress?.(requireCompilation(store, bookId));
	try {
		await mergeCanonEntities(options);
		await markCanonTurningPoints(options);
		await compileCanonEntityPages(options);
		return store.finishCanonCompilation(bookId, "done", null);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		store.finishCanonCompilation(bookId, "failed", message);
		throw error;
	}
}

function requireCompilation(
	store: StoryStore,
	bookId: string,
): CanonCompilationRecord {
	const record = store.getCanonCompilation(bookId);
	if (record === null) throw new Error(`原著 ${bookId} 的汇编任务不存在`);
	return record;
}

function ensureNotAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new Error("服务关闭，汇编中断");
}

async function callCompileModel(
	options: CanonCompileCallOptions,
	prompt: CanonPrompt,
): Promise<unknown> {
	const result = await options.client.complete(
		{
			messages: [
				{ role: "system", content: prompt.system },
				{ role: "user", content: prompt.user },
			],
			model: options.model,
			temperature: 0,
			maxTokens: CANON_COMPILE_MAX_TOKENS,
			...(options.signal === undefined ? {} : { signal: options.signal }),
		},
		NO_CONTINUATION,
	);
	const calls = result.cached ? 0 : Math.max(1, result.attempts);
	const tokens =
		result.usage.totalTokens ??
		(result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0);
	options.store.addCanonCompilationUsage(options.bookId, calls, tokens);
	return parseCanonCompileResponse(result.text);
}

function readText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}

function readStringList(value: unknown, label: string): readonly string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组`);
	return value.map((item, index) =>
		readText(item, `${label} 第 ${index + 1} 项`),
	);
}

function readMergeGroups(
	value: unknown,
	allowed: ReadonlySet<string>,
): readonly CanonEntityMerge[] {
	if (!isJsonObject(value)) throw new Error("合并回复不是 JSON 对象");
	const raw = value.merges;
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) throw new Error("合并回复里的 merges 必须是数组");
	const claimed = new Set<string>();
	const groups: CanonEntityMerge[] = [];
	for (const item of raw) {
		if (!isJsonObject(item)) throw new Error("合并组必须是对象");
		const canonicalName = readText(item.canonicalName, "合并组的标准名");
		if (!allowed.has(canonicalName)) {
			throw new Error(`合并组的标准名「${canonicalName}」不在这一批实体里`);
		}
		const names = readStringList(item.names, "合并组的名字");
		if (names.length === 0) {
			throw new Error(`合并组「${canonicalName}」没有给出名字`);
		}
		if (!names.includes(canonicalName)) {
			throw new Error(`合并组「${canonicalName}」的 names 必须包含它自己`);
		}
		for (const name of names) {
			if (!allowed.has(name)) {
				throw new Error(`合并组里的名字「${name}」不在这一批实体里`);
			}
			if (claimed.has(name)) {
				throw new Error(`实体「${name}」出现在多个合并组里`);
			}
			claimed.add(name);
		}
		const aliases = readStringList(item.aliases, "合并组的别名").filter(
			(alias) => !names.includes(alias),
		);
		groups.push({
			canonicalName,
			aliases: [...new Set(aliases)],
			mergedFrom: [
				canonicalName,
				...names.filter((name) => name !== canonicalName),
			],
		});
	}
	return groups;
}

function readTurningPoints(
	value: unknown,
	allowed: ReadonlySet<number>,
): readonly number[] {
	if (!isJsonObject(value)) throw new Error("关键转折回复不是 JSON 对象");
	const raw = value.turningPoints;
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) throw new Error("turningPoints 必须是数组");
	const ids: number[] = [];
	for (const item of raw) {
		if (typeof item !== "number" || !Number.isInteger(item)) {
			throw new Error("turningPoints 里的事件编号必须是整数");
		}
		if (!allowed.has(item)) {
			throw new Error(`关键转折里的事件编号 ${item} 不在这一批事件里`);
		}
		if (!ids.includes(item)) ids.push(item);
	}
	return ids;
}

interface EntityPageDraft {
	readonly name: string;
	readonly lead: string;
	readonly entries: readonly CanonBaseEntry[];
}

function readEntityPages(
	value: unknown,
	materials: readonly {
		readonly entity: CanonEntityRecord;
	}[],
): readonly CanonCompiledEntityInput[] {
	if (!isJsonObject(value)) throw new Error("实体页回复不是 JSON 对象");
	const raw = value.entities;
	if (!Array.isArray(raw))
		throw new Error("实体页回复里的 entities 必须是数组");
	const byName = new Map(
		materials.map((item) => [item.entity.name, item.entity]),
	);
	const drafts = new Map<string, EntityPageDraft>();
	for (const item of raw) {
		if (!isJsonObject(item)) throw new Error("实体页必须是对象");
		const name = readText(item.name, "实体页的名字");
		const entity = byName.get(name);
		if (entity === undefined) {
			throw new Error(`实体页「${name}」不在这一批实体里`);
		}
		if (drafts.has(name)) throw new Error(`实体页「${name}」重复出现`);
		const lead = readText(item.lead, `实体「${name}」的一行简介`);
		if (lead.length > LEAD_MAX_CHARS) {
			throw new Error(`实体「${name}」的一行简介超过 ${LEAD_MAX_CHARS} 字`);
		}
		const entriesRaw = item.entries;
		if (entriesRaw !== undefined && !Array.isArray(entriesRaw)) {
			throw new Error(`实体「${name}」的底色条目必须是数组`);
		}
		const entries: CanonBaseEntry[] = [];
		for (const entry of entriesRaw ?? []) {
			if (!isJsonObject(entry))
				throw new Error(`实体「${name}」的底色条目必须是对象`);
			const chapter = entry.chapter;
			if (typeof chapter !== "number" || !Number.isInteger(chapter)) {
				throw new Error(`实体「${name}」的底色条目章节号必须是整数`);
			}
			if (
				chapter < entity.firstChapterOrdinal ||
				chapter > entity.lastChapterOrdinal
			) {
				throw new Error(
					`实体「${name}」的底色条目章节号 ${chapter} 超出首末章 ${entity.firstChapterOrdinal}–${entity.lastChapterOrdinal}`,
				);
			}
			const text = readText(entry.text, `实体「${name}」的底色条目`);
			if (text.length > ENTRY_MAX_CHARS) {
				throw new Error(`实体「${name}」的底色条目超过 ${ENTRY_MAX_CHARS} 字`);
			}
			if (
				entries.some(
					(existing) =>
						existing.chapterOrdinal === chapter && existing.text === text,
				)
			) {
				continue;
			}
			entries.push({ chapterOrdinal: chapter, text });
		}
		drafts.set(name, { name, lead, entries });
	}
	const pages: CanonCompiledEntityInput[] = [];
	for (const { entity } of materials) {
		const draft = drafts.get(entity.name);
		if (draft === undefined) {
			throw new Error(`模型没有给实体「${entity.name}」生成页面`);
		}
		const entries = sortCanonBaseEntries(draft.entries);
		pages.push({
			name: entity.name,
			aliases: entity.aliases,
			kind: entity.kind,
			lead: draft.lead,
			base: renderCanonBaseText(entries),
			baseEntries: entries,
			firstChapterOrdinal: entity.firstChapterOrdinal,
			lastChapterOrdinal: entity.lastChapterOrdinal,
		});
	}
	return pages;
}

/** 开局用的实体页：底色只含不晚于游标的条目，现在与经历为空。 */
export interface CanonStartingPage {
	readonly name: string;
	readonly kind: CanonEntityKind;
	readonly aliases: readonly string[];
	readonly lead: string;
	readonly base: string;
	readonly entries: readonly CanonBaseEntry[];
	readonly now: string;
	readonly past: readonly string[];
}

export function sliceCanonEntityPage(
	entity: CanonCompiledEntityRecord,
	upToChapter: number,
): CanonStartingPage | null {
	if (!Number.isInteger(upToChapter) || upToChapter < 1) {
		throw new Error("截止章节必须是正整数");
	}
	if (entity.firstChapterOrdinal > upToChapter) return null;
	const entries = entity.baseEntries.filter(
		(entry) => entry.chapterOrdinal <= upToChapter,
	);
	return {
		name: entity.name,
		kind: entity.kind,
		aliases: entity.aliases,
		lead: entity.lead,
		base: renderCanonBaseText(entries),
		entries,
		now: "",
		past: [],
	};
}

/** 给定一本原著与截止章节，导出每个已出场实体的初版记事页。 */
export function buildCanonStartingPages(
	store: StoryStore,
	bookId: string,
	upToChapter: number,
): readonly CanonStartingPage[] {
	return store
		.listCanonCompiledEntities(bookId)
		.map((entity) => sliceCanonEntityPage(entity, upToChapter))
		.filter((page): page is CanonStartingPage => page !== null);
}

export interface CanonWorldIndexLine {
	readonly text: string;
	readonly entityName: string;
}

export interface CanonWorldIndex {
	readonly text: string;
	readonly lines: readonly CanonWorldIndexLine[];
}

/** 世界索引只列已出场的实体，一行一个 lead。 */
export function renderCanonWorldIndex(
	entities: readonly CanonCompiledEntityRecord[],
	upToChapter: number,
	options: { readonly maxChars?: number } = {},
): CanonWorldIndex | null {
	if (!Number.isInteger(upToChapter) || upToChapter < 1) {
		throw new Error("截止章节必须是正整数");
	}
	const maxChars = options.maxChars ?? CANON_WORLD_INDEX_MAX_CHARS;
	const seen = entities
		.filter((entity) => entity.firstChapterOrdinal <= upToChapter)
		.sort(
			(left, right) =>
				left.firstChapterOrdinal - right.firstChapterOrdinal ||
				left.name.localeCompare(right.name, "zh-Hans-CN"),
		);
	const lines: CanonWorldIndexLine[] = [];
	let used = 0;
	for (const entity of seen) {
		const text =
			entity.lead.length === 0 ? entity.name : `${entity.name}——${entity.lead}`;
		if (lines.length > 0 && used + text.length > maxChars) break;
		lines.push({ text, entityName: entity.name });
		used += text.length;
	}
	if (lines.length === 0) return null;
	return {
		text: ["世界索引：", ...lines.map((line) => `- ${line.text}`)].join("\n"),
		lines,
	};
}

export function buildCanonWorldIndex(
	store: StoryStore,
	bookId: string,
	upToChapter: number,
	options: { readonly maxChars?: number } = {},
): CanonWorldIndex | null {
	return renderCanonWorldIndex(
		store.listCanonCompiledEntities(bookId),
		upToChapter,
		options,
	);
}
