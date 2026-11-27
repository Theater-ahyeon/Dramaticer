// StoryStore 的领域仓储：原著书与分章原文（canon/01）。
// 书不属于任何故事；原文只在本机数据库里，写完可合并、拆分、改标题。
import { randomUUID } from "node:crypto";
import {
	CANON_TEXT_ENCODINGS,
	type CanonBaseEntry,
	type CanonBookRecord,
	type CanonBookStatus,
	type CanonChapterExtractionRecord,
	type CanonChapterExtractionStatus,
	type CanonChapterKind,
	type CanonChapterRecord,
	type CanonChapterSummary,
	type CanonChunkPlan,
	type CanonChunkProgress,
	type CanonCompilationRecord,
	type CanonCompilationStatus,
	type CanonCompiledEntityRecord,
	type CanonCursorRecord,
	type CanonEntityKind,
	type CanonEntityMerge,
	type CanonEntityRecord,
	type CanonEventRecord,
	type CanonExtractedEvent,
	type CanonExtractedFact,
	type CanonExtractedVoice,
	type CanonExtractionRecord,
	type CanonExtractionStatus,
	type CanonFactRecord,
	type CanonIdentityKind,
	type CanonPackage,
	type CanonPlayerPage,
	type CanonStoryBindingRecord,
	type CanonVoiceKind,
	type CanonVoiceRecord,
	type NewCanonChapter,
	assertCanonChapterKind,
	countCanonChars,
	isCanonBookStatus,
	isCanonChapterExtractionStatus,
	isCanonCompilationStatus,
	isCanonEntityKind,
	isCanonExtractionStatus,
	isCanonIdentityKind,
} from "../../canon/index.js";
import { StoreRepo } from "./base.js";
import { assertNonEmptyString, readBooleanColumn } from "./shared.js";

export interface CreateCanonBookInput {
	readonly id?: string;
	readonly title: string;
	readonly filename?: string | null;
	readonly encoding: string;
	readonly chapters: readonly NewCanonChapter[];
	readonly createdAt?: string;
}

export interface CanonChapterUpdate {
	readonly title?: string;
	readonly kind?: CanonChapterKind;
}

export interface CanonChapterSplitResult {
	readonly first: CanonChapterRecord;
	readonly second: CanonChapterRecord;
}

/** 名册重建与块结果写入的输入；章节锚点在这里一并带上（I12）。 */
export interface CanonEntityInput {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly kind: CanonEntityKind;
	readonly chapterOrdinal: number;
}

export interface CanonChunkResultsInput {
	readonly bookId: string;
	readonly chapterId: string;
	readonly chapterOrdinal: number;
	readonly events: readonly CanonExtractedEvent[];
	readonly voices: readonly CanonExtractedVoice[];
	readonly facts: readonly CanonExtractedFact[];
}

export interface CanonChapterExtractionPatch {
	readonly status: CanonChapterExtractionStatus;
	readonly chunks: readonly CanonChunkProgress[];
	readonly lastError: string | null;
	readonly tokens: number;
}

export interface CanonChapterExtractionDefaults {
	readonly chapterOrdinal: number;
	readonly chunks: readonly CanonChunkPlan[];
}

/** 汇编写回的实体页；书 id 由 store 补齐。 */
export interface CanonCompiledEntityInput {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly kind: CanonEntityKind;
	readonly lead: string;
	readonly base: string;
	readonly baseEntries: readonly CanonBaseEntry[];
	readonly firstChapterOrdinal: number;
	readonly lastChapterOrdinal: number;
}

/** 主时间线顺序与关键转折一起写回，避免两次全表扫描。 */
export interface CanonEventTimelinePatch {
	readonly eventId: number;
	readonly timelineOrder: number | null;
	readonly isTurningPoint: boolean;
}

interface CanonBookRow {
	readonly id: string;
	readonly title: string;
	readonly filename: string | null;
	readonly encoding: string;
	readonly char_count: number;
	readonly chapter_count: number;
	readonly status: string;
	readonly has_text: number;
	readonly created_at: string;
}

interface CanonChapterRow {
	readonly id: string;
	readonly book_id: string;
	readonly ordinal: number;
	readonly volume_title: string | null;
	readonly title: string;
	readonly kind: string;
	readonly paragraphs: string;
	readonly paragraph_count: number;
	readonly char_count: number;
	readonly created_at: string;
}

interface CanonExtractionRow {
	readonly book_id: string;
	readonly status: string;
	readonly model: string | null;
	readonly total_chapters: number;
	readonly done_chapters: number;
	readonly failed_chapters: number;
	readonly llm_calls: number;
	readonly llm_tokens: number;
	readonly last_error: string | null;
	readonly started_at: string | null;
	readonly updated_at: string;
}

interface CanonChapterExtractionRow {
	readonly chapter_id: string;
	readonly book_id: string;
	readonly chapter_ordinal: number;
	readonly status: string;
	readonly chunks: string;
	readonly last_error: string | null;
	readonly tokens: number;
	readonly updated_at: string;
}

interface CanonEntityRow {
	readonly book_id: string;
	readonly name: string;
	readonly aliases: string;
	readonly kind: string;
	readonly first_chapter_ordinal: number;
	readonly last_chapter_ordinal: number;
}

interface CanonEventRow {
	readonly id: number;
	readonly book_id: string;
	readonly chapter_id: string;
	readonly chapter_ordinal: number;
	readonly seq: number;
	readonly title: string;
	readonly summary: string;
	readonly digest: string;
	readonly participants: string;
	readonly location: string | null;
	readonly time_text: string | null;
	readonly paragraph_start: number;
	readonly paragraph_end: number;
	readonly is_interlude: number;
	readonly timeline_order: number | null;
	readonly is_turning_point: number;
	readonly created_at: string;
}

interface CanonVoiceRow {
	readonly id: number;
	readonly book_id: string;
	readonly chapter_id: string;
	readonly chapter_ordinal: number;
	readonly ordinal: number;
	readonly character: string;
	readonly kind: string;
	readonly text: string;
	readonly created_at: string;
}

interface CanonFactRow {
	readonly id: number;
	readonly book_id: string;
	readonly chapter_id: string;
	readonly chapter_ordinal: number;
	readonly entity_name: string;
	readonly aliases: string;
	readonly entity_kind: string;
	readonly fact: string;
	readonly created_at: string;
}

interface CanonCompilationRow {
	readonly book_id: string;
	readonly status: string;
	readonly model: string | null;
	readonly llm_calls: number;
	readonly llm_tokens: number;
	readonly last_error: string | null;
	readonly started_at: string | null;
	readonly updated_at: string;
}

interface CanonCompiledEntityRow {
	readonly book_id: string;
	readonly name: string;
	readonly aliases: string;
	readonly kind: string;
	readonly lead: string;
	readonly base: string;
	readonly base_entries: string;
	readonly first_chapter_ordinal: number;
	readonly last_chapter_ordinal: number;
}

const RENUMBER_OFFSET = 1_000_000;

function readStatus(value: string): CanonBookStatus {
	if (!isCanonBookStatus(value)) {
		throw new Error(`原著状态不合法：${value}`);
	}
	return value;
}

function parseParagraphs(value: string, label: string): readonly string[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) {
		throw new Error(`${label} 不是段落数组`);
	}
	return parsed.map((item, index) => {
		if (typeof item !== "string" || item.length === 0) {
			throw new Error(`${label} 第 ${index + 1} 段不是非空字符串`);
		}
		return item;
	});
}

function rowToBook(row: CanonBookRow): CanonBookRecord {
	return {
		id: row.id,
		title: row.title,
		filename: row.filename,
		encoding: row.encoding,
		charCount: row.char_count,
		chapterCount: row.chapter_count,
		status: readStatus(row.status),
		hasText: row.has_text === 1,
		createdAt: row.created_at,
	};
}

function rowToChapterSummary(row: CanonChapterRow): CanonChapterSummary {
	return {
		id: row.id,
		bookId: row.book_id,
		ordinal: row.ordinal,
		volumeTitle: row.volume_title,
		title: row.title,
		kind: assertCanonChapterKind(row.kind, `章节 ${row.id} 的类型`),
		paragraphCount: row.paragraph_count,
		charCount: row.char_count,
	};
}

function rowToChapterRecord(row: CanonChapterRow): CanonChapterRecord {
	return {
		...rowToChapterSummary(row),
		paragraphs: parseParagraphs(row.paragraphs, `章节 ${row.id} 的原文`),
		createdAt: row.created_at,
	};
}

function readExtractionStatus(value: string): CanonExtractionStatus {
	if (!isCanonExtractionStatus(value)) {
		throw new Error(`原著抽取状态不合法：${value}`);
	}
	return value;
}

function readChapterExtractionStatus(
	value: string,
): CanonChapterExtractionStatus {
	if (!isCanonChapterExtractionStatus(value)) {
		throw new Error(`章节抽取状态不合法：${value}`);
	}
	return value;
}

function readVoiceKind(value: string): CanonVoiceKind {
	if (value !== "speech" && value !== "thought") {
		throw new Error(`话术类别不合法：${value}`);
	}
	return value;
}

function readEntityKind(value: string): CanonEntityKind {
	if (!isCanonEntityKind(value)) {
		throw new Error(`实体类别不合法：${value}`);
	}
	return value;
}

function parseStringArray(value: string, label: string): readonly string[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) throw new Error(`${label} 不是字符串数组`);
	return parsed.map((item, index) => {
		if (typeof item !== "string" || item.trim().length === 0) {
			throw new Error(`${label} 第 ${index + 1} 项不是非空字符串`);
		}
		return item;
	});
}

function parseBaseEntries(
	value: string,
	label: string,
): readonly CanonBaseEntry[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) throw new Error(`${label} 不是底色数组`);
	return parsed.map((item, index) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			throw new Error(`${label} 第 ${index + 1} 项不是对象`);
		}
		const record = item as Record<string, unknown>;
		if (
			typeof record.chapterOrdinal !== "number" ||
			!Number.isInteger(record.chapterOrdinal) ||
			record.chapterOrdinal < 1
		) {
			throw new Error(`${label} 第 ${index + 1} 项的章节号不合法`);
		}
		if (typeof record.text !== "string" || record.text.trim().length === 0) {
			throw new Error(`${label} 第 ${index + 1} 项的正文不能为空`);
		}
		return { chapterOrdinal: record.chapterOrdinal, text: record.text };
	});
}

function parseChunkProgress(
	value: string,
	label: string,
): readonly CanonChunkProgress[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) throw new Error(`${label} 不是块数组`);
	return parsed.map((item, index) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			throw new Error(`${label} 第 ${index + 1} 块不是对象`);
		}
		const record = item as Record<string, unknown>;
		const status = record.status;
		if (
			status !== "pending" &&
			status !== "running" &&
			status !== "done" &&
			status !== "failed"
		) {
			throw new Error(`${label} 第 ${index + 1} 块的状态不合法`);
		}
		if (
			typeof record.index !== "number" ||
			typeof record.startParagraph !== "number" ||
			typeof record.endParagraph !== "number" ||
			typeof record.charCount !== "number" ||
			typeof record.tokens !== "number" ||
			(record.error !== null && typeof record.error !== "string")
		) {
			throw new Error(`${label} 第 ${index + 1} 块的字段不完整`);
		}
		return {
			index: record.index,
			startParagraph: record.startParagraph,
			endParagraph: record.endParagraph,
			charCount: record.charCount,
			status,
			error: record.error,
			tokens: record.tokens,
		};
	});
}

function rowToExtraction(row: CanonExtractionRow): CanonExtractionRecord {
	return {
		bookId: row.book_id,
		status: readExtractionStatus(row.status),
		model: row.model,
		totalChapters: row.total_chapters,
		doneChapters: row.done_chapters,
		failedChapters: row.failed_chapters,
		llmCalls: row.llm_calls,
		llmTokens: row.llm_tokens,
		lastError: row.last_error,
		startedAt: row.started_at,
		updatedAt: row.updated_at,
	};
}

function rowToChapterExtraction(
	row: CanonChapterExtractionRow,
): CanonChapterExtractionRecord {
	return {
		chapterId: row.chapter_id,
		bookId: row.book_id,
		chapterOrdinal: row.chapter_ordinal,
		status: readChapterExtractionStatus(row.status),
		chunks: parseChunkProgress(row.chunks, `章节 ${row.chapter_id} 的块进度`),
		lastError: row.last_error,
		tokens: row.tokens,
		updatedAt: row.updated_at,
	};
}

function rowToEntity(row: CanonEntityRow): CanonEntityRecord {
	return {
		bookId: row.book_id,
		name: row.name,
		aliases: parseStringArray(row.aliases, `实体 ${row.name} 的别名`),
		kind: readEntityKind(row.kind),
		firstChapterOrdinal: row.first_chapter_ordinal,
		lastChapterOrdinal: row.last_chapter_ordinal,
	};
}

function rowToEvent(row: CanonEventRow): CanonEventRecord {
	return {
		id: row.id,
		bookId: row.book_id,
		chapterId: row.chapter_id,
		chapterOrdinal: row.chapter_ordinal,
		seq: row.seq,
		title: row.title,
		summary: row.summary,
		digest: row.digest,
		participants: parseStringArray(
			row.participants,
			`事件 ${row.id} 的参与人物`,
		),
		location: row.location,
		timeText: row.time_text,
		paragraphStart: row.paragraph_start,
		paragraphEnd: row.paragraph_end,
		isInterlude: row.is_interlude === 1,
		timelineOrder: row.timeline_order,
		isTurningPoint: row.is_turning_point === 1,
		createdAt: row.created_at,
	};
}

function rowToVoice(row: CanonVoiceRow): CanonVoiceRecord {
	return {
		id: row.id,
		bookId: row.book_id,
		chapterId: row.chapter_id,
		chapterOrdinal: row.chapter_ordinal,
		ordinal: row.ordinal,
		character: row.character,
		kind: readVoiceKind(row.kind),
		text: row.text,
		createdAt: row.created_at,
	};
}

function rowToFact(row: CanonFactRow): CanonFactRecord {
	return {
		id: row.id,
		bookId: row.book_id,
		chapterId: row.chapter_id,
		chapterOrdinal: row.chapter_ordinal,
		entityName: row.entity_name,
		aliases: parseStringArray(row.aliases, `事实 ${row.id} 的别名`),
		entityKind: readEntityKind(row.entity_kind),
		fact: row.fact,
		createdAt: row.created_at,
	};
}

function readCompilationStatus(value: string): CanonCompilationStatus {
	if (!isCanonCompilationStatus(value)) {
		throw new Error(`原著汇编状态不合法：${value}`);
	}
	return value;
}

function rowToCompilation(row: CanonCompilationRow): CanonCompilationRecord {
	return {
		bookId: row.book_id,
		status: readCompilationStatus(row.status),
		model: row.model,
		llmCalls: row.llm_calls,
		llmTokens: row.llm_tokens,
		lastError: row.last_error,
		startedAt: row.started_at,
		updatedAt: row.updated_at,
	};
}

function rowToCompiledEntity(
	row: CanonCompiledEntityRow,
): CanonCompiledEntityRecord {
	return {
		bookId: row.book_id,
		name: row.name,
		aliases: parseStringArray(row.aliases, `汇编实体 ${row.name} 的别名`),
		kind: readEntityKind(row.kind),
		lead: row.lead,
		base: row.base,
		baseEntries: parseBaseEntries(
			row.base_entries,
			`汇编实体 ${row.name} 的底色`,
		),
		firstChapterOrdinal: row.first_chapter_ordinal,
		lastChapterOrdinal: row.last_chapter_ordinal,
	};
}

export interface SaveStoryCanonBindingInput {
	readonly storyId: string;
	readonly bookId: string;
	readonly startEventId: number;
	readonly startChapterOrdinal: number;
	readonly identityKind: CanonIdentityKind;
	readonly playerEntityName: string;
	readonly playerPage: CanonPlayerPage | null;
	readonly allowFullBookSpoilers?: boolean;
	readonly createdAt?: string;
}

export interface SaveCanonCursorInput {
	readonly storyId: string;
	readonly nodeId: string;
	readonly eventId: number;
	readonly eventOrdinal: number;
	readonly chapterOrdinal: number;
	readonly createdAt?: string;
}

interface StoryCanonRow {
	readonly story_id: string;
	readonly book_id: string;
	readonly start_event_id: number;
	readonly start_chapter_ordinal: number;
	readonly identity_kind: string;
	readonly player_entity_name: string;
	readonly player_page: string | null;
	readonly allow_full_book_spoilers: number;
	readonly created_at: string;
}

interface CanonCursorRow {
	readonly story_id: string;
	readonly node_id: string;
	readonly event_id: number;
	readonly event_ordinal: number;
	readonly chapter_ordinal: number;
	readonly created_at: string;
}

function rowToPlayerPage(value: string | null): CanonPlayerPage | null {
	if (value === null) return null;
	const parsed = JSON.parse(value) as Record<string, unknown>;
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("原著扮演人物页必须是 JSON 对象");
	}
	const entries = parsed.entries;
	if (!Array.isArray(entries)) {
		throw new Error("原著扮演人物页缺少底色条目数组");
	}
	return {
		name: typeof parsed.name === "string" ? parsed.name : "",
		kind: readEntityKind(
			typeof parsed.kind === "string" ? parsed.kind : String(parsed.kind),
		),
		aliases: Array.isArray(parsed.aliases)
			? parsed.aliases.filter(
					(item): item is string => typeof item === "string",
				)
			: [],
		lead: typeof parsed.lead === "string" ? parsed.lead : "",
		base: typeof parsed.base === "string" ? parsed.base : "",
		entries: parseBaseEntries(JSON.stringify(entries), "原著扮演人物页的底色"),
	};
}

function rowToStoryCanon(row: StoryCanonRow): CanonStoryBindingRecord {
	if (!isCanonIdentityKind(row.identity_kind)) {
		throw new Error(
			`故事 ${row.story_id} 的扮演身份不合法：${row.identity_kind}`,
		);
	}
	return {
		storyId: row.story_id,
		bookId: row.book_id,
		startEventId: row.start_event_id,
		startChapterOrdinal: row.start_chapter_ordinal,
		identityKind: row.identity_kind,
		playerEntityName: row.player_entity_name,
		playerPage: rowToPlayerPage(row.player_page),
		allowFullBookSpoilers: readBooleanColumn(
			row.allow_full_book_spoilers,
			`故事 ${row.story_id} 的 allowFullBookSpoilers`,
		),
		createdAt: row.created_at,
	};
}

function rowToCursor(row: CanonCursorRow): CanonCursorRecord {
	return {
		storyId: row.story_id,
		nodeId: row.node_id,
		eventId: row.event_id,
		eventOrdinal: row.event_ordinal,
		chapterOrdinal: row.chapter_ordinal,
		createdAt: row.created_at,
	};
}

export class CanonRepo extends StoreRepo {
	createCanonBook(input: CreateCanonBookInput): {
		readonly book: CanonBookRecord;
		readonly chapters: readonly CanonChapterRecord[];
	} {
		const title = input.title.trim();
		if (title.length === 0) {
			throw new Error("原著书名不能为空");
		}
		if (!CANON_TEXT_ENCODINGS.some((value) => value === input.encoding)) {
			throw new Error(`不支持的原文编码：${input.encoding}`);
		}
		if (input.chapters.length === 0) {
			throw new Error("原著至少要有一章");
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		const bookId = input.id ?? randomUUID();
		const chapters = input.chapters.map((chapter, index) =>
			this.#normalizeChapter(chapter, index, bookId, createdAt),
		);
		const charCount = chapters.reduce(
			(total, chapter) => total + chapter.charCount,
			0,
		);
		this.db.transaction(() => {
			this.db
				.prepare(
					`INSERT INTO canon_books
					(id, title, filename, encoding, char_count, chapter_count, status, created_at)
					VALUES (?, ?, ?, ?, ?, ?, 'ready', ?)`,
				)
				.run(
					bookId,
					title,
					input.filename?.trim() || null,
					input.encoding,
					charCount,
					chapters.length,
					createdAt,
				);
			const insert = this.db.prepare(
				`INSERT INTO canon_chapters
				(id, book_id, ordinal, volume_title, title, kind, paragraphs,
				 paragraph_count, char_count, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			);
			chapters.forEach((chapter, index) => {
				insert.run(
					chapter.id,
					bookId,
					index + 1,
					chapter.volumeTitle,
					chapter.title,
					chapter.kind,
					JSON.stringify(chapter.paragraphs),
					chapter.paragraphs.length,
					chapter.charCount,
					createdAt,
				);
			});
		})();
		return {
			book: this.#requireBook(bookId),
			chapters: this.listCanonChapterRecords(bookId),
		};
	}

	listCanonBooks(): readonly CanonBookRecord[] {
		const rows = this.db
			.prepare("SELECT * FROM canon_books ORDER BY created_at DESC, id ASC")
			.all() as CanonBookRow[];
		return rows.map(rowToBook);
	}

	getCanonBook(bookId: string): CanonBookRecord | null {
		const row = this.db
			.prepare("SELECT * FROM canon_books WHERE id = ?")
			.get(bookId) as CanonBookRow | undefined;
		return row === undefined ? null : rowToBook(row);
	}

	listCanonChapters(bookId: string): readonly CanonChapterSummary[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM canon_chapters
				WHERE book_id = ? ORDER BY ordinal ASC`,
			)
			.all(bookId) as CanonChapterRow[];
		return rows.map(rowToChapterSummary);
	}

	listCanonChapterRecords(bookId: string): readonly CanonChapterRecord[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM canon_chapters
				WHERE book_id = ? ORDER BY ordinal ASC`,
			)
			.all(bookId) as CanonChapterRow[];
		return rows.map(rowToChapterRecord);
	}

	getCanonChapter(
		bookId: string,
		chapterId: string,
	): CanonChapterRecord | null {
		const row = this.db
			.prepare("SELECT * FROM canon_chapters WHERE book_id = ? AND id = ?")
			.get(bookId, chapterId) as CanonChapterRow | undefined;
		return row === undefined ? null : rowToChapterRecord(row);
	}

	updateCanonChapter(
		bookId: string,
		chapterId: string,
		update: CanonChapterUpdate,
	): CanonChapterRecord | null {
		const current = this.getCanonChapter(bookId, chapterId);
		if (current === null) return null;
		const title =
			update.title === undefined ? current.title : update.title.trim();
		if (title.length === 0) {
			throw new Error("章节标题不能为空");
		}
		const kind =
			update.kind === undefined
				? current.kind
				: assertCanonChapterKind(update.kind, "章节类型");
		this.db
			.prepare(
				"UPDATE canon_chapters SET title = ?, kind = ? WHERE book_id = ? AND id = ?",
			)
			.run(title, kind, bookId, chapterId);
		return this.getCanonChapter(bookId, chapterId);
	}

	/** 把下一章的段落并入这一章；最后一章没有下一章可合并。 */
	mergeCanonChapterWithNext(
		bookId: string,
		chapterId: string,
	): CanonChapterRecord | null {
		const current = this.getCanonChapter(bookId, chapterId);
		if (current === null) return null;
		const nextRow = this.db
			.prepare(
				`SELECT * FROM canon_chapters
				WHERE book_id = ? AND ordinal > ?
				ORDER BY ordinal ASC LIMIT 1`,
			)
			.get(bookId, current.ordinal) as CanonChapterRow | undefined;
		if (nextRow === undefined) {
			throw new Error("已经是最后一章，没有下一章可以合并");
		}
		const next = rowToChapterRecord(nextRow);
		const paragraphs = [...current.paragraphs, ...next.paragraphs];
		this.db.transaction(() => {
			this.db
				.prepare(
					`UPDATE canon_chapters
					SET paragraphs = ?, paragraph_count = ?, char_count = ?
					WHERE book_id = ? AND id = ?`,
				)
				.run(
					JSON.stringify(paragraphs),
					paragraphs.length,
					countCanonChars(paragraphs),
					bookId,
					chapterId,
				);
			this.db
				.prepare("DELETE FROM canon_chapters WHERE book_id = ? AND id = ?")
				.run(bookId, next.id);
			this.#dropChapterExtraction(chapterId);
			this.#renumberChapters(bookId);
			this.#syncChapterOrdinals(bookId);
		})();
		this.refreshCanonExtraction(bookId);
		return this.getCanonChapter(bookId, chapterId);
	}

	/** 在第 `paragraphIndex` 段之后切开；前半保留原章，后半作为新章插在后面。 */
	splitCanonChapter(
		bookId: string,
		chapterId: string,
		paragraphIndex: number,
	): CanonChapterSplitResult | null {
		const current = this.getCanonChapter(bookId, chapterId);
		if (current === null) return null;
		const total = current.paragraphs.length;
		if (total < 2) {
			throw new Error("这一章只有一段，无法再拆");
		}
		if (
			!Number.isInteger(paragraphIndex) ||
			paragraphIndex < 1 ||
			paragraphIndex >= total
		) {
			throw new Error(`拆分位置必须是 1 到 ${total - 1} 之间的整数`);
		}
		const firstParagraphs = current.paragraphs.slice(0, paragraphIndex);
		const secondParagraphs = current.paragraphs.slice(paragraphIndex);
		const secondId = randomUUID();
		const secondTitle = `${current.title}（续）`;
		this.db.transaction(() => {
			this.db
				.prepare(
					"UPDATE canon_chapters SET ordinal = ordinal + ? WHERE book_id = ?",
				)
				.run(RENUMBER_OFFSET, bookId);
			this.db
				.prepare(
					`INSERT INTO canon_chapters
					(id, book_id, ordinal, volume_title, title, kind, paragraphs,
					 paragraph_count, char_count, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					secondId,
					bookId,
					RENUMBER_OFFSET * 2,
					current.volumeTitle,
					secondTitle,
					current.kind,
					JSON.stringify(secondParagraphs),
					secondParagraphs.length,
					countCanonChars(secondParagraphs),
					new Date().toISOString(),
				);
			this.db
				.prepare(
					`UPDATE canon_chapters
					SET paragraphs = ?, paragraph_count = ?, char_count = ?
					WHERE book_id = ? AND id = ?`,
				)
				.run(
					JSON.stringify(firstParagraphs),
					firstParagraphs.length,
					countCanonChars(firstParagraphs),
					bookId,
					chapterId,
				);
			const ids = (
				this.db
					.prepare(
						`SELECT id FROM canon_chapters
						WHERE book_id = ? AND id <> ?
						ORDER BY ordinal ASC`,
					)
					.all(bookId, secondId) as { readonly id: string }[]
			).map((row) => row.id);
			const position = ids.indexOf(chapterId);
			ids.splice(position + 1, 0, secondId);
			this.#assignOrdinals(bookId, ids);
			this.#recountBook(bookId);
			this.#dropChapterExtraction(chapterId);
			this.#syncChapterOrdinals(bookId);
		})();
		this.refreshCanonExtraction(bookId);
		const first = this.getCanonChapter(bookId, chapterId);
		const second = this.getCanonChapter(bookId, secondId);
		if (first === null || second === null) {
			throw new Error("拆分后的章节读取失败");
		}
		return { first, second };
	}

	deleteCanonBook(bookId: string): boolean {
		const result = this.db
			.prepare("DELETE FROM canon_books WHERE id = ?")
			.run(bookId);
		return result.changes > 0;
	}

	getCanonExtraction(bookId: string): CanonExtractionRecord | null {
		const row = this.db
			.prepare("SELECT * FROM canon_extractions WHERE book_id = ?")
			.get(bookId) as CanonExtractionRow | undefined;
		return row === undefined ? null : rowToExtraction(row);
	}

	/** 还没有抽取任务时建一条 idle；总章数取当前分章数。 */
	ensureCanonExtraction(bookId: string): CanonExtractionRecord {
		this.#requireBook(bookId);
		const now = new Date().toISOString();
		const total = this.#chapterCount(bookId);
		this.db
			.prepare(
				`INSERT OR IGNORE INTO canon_extractions
				(book_id, status, model, total_chapters, done_chapters,
				 failed_chapters, llm_calls, llm_tokens, last_error, started_at, updated_at)
				VALUES (?, 'idle', NULL, ?, 0, 0, 0, 0, NULL, NULL, ?)`,
			)
			.run(bookId, total, now);
		const record = this.getCanonExtraction(bookId);
		if (record === null) throw new Error(`原著 ${bookId} 的抽取任务创建失败`);
		return record;
	}

	markCanonExtractionRunning(
		bookId: string,
		model: string | null,
	): CanonExtractionRecord {
		const current = this.ensureCanonExtraction(bookId);
		const now = new Date().toISOString();
		this.db
			.prepare(
				`UPDATE canon_extractions
				SET status = 'running', model = ?, last_error = NULL,
					started_at = ?, updated_at = ?
				WHERE book_id = ?`,
			)
			.run(model, current.startedAt ?? now, now, bookId);
		this.#syncBookStatus(bookId, "running");
		return this.#requireExtraction(bookId);
	}

	pauseCanonExtraction(bookId: string): CanonExtractionRecord {
		const current = this.ensureCanonExtraction(bookId);
		if (current.status !== "running") return current;
		this.db
			.prepare(
				`UPDATE canon_extractions
				SET status = 'paused', updated_at = ?
				WHERE book_id = ?`,
			)
			.run(new Date().toISOString(), bookId);
		this.#syncBookStatus(bookId, "paused");
		return this.#requireExtraction(bookId);
	}

	/** 全书跑完或中断后写终态；计数由 refreshCanonExtraction 重新数。 */
	finishCanonExtraction(
		bookId: string,
		status: "done" | "failed" | "paused",
		lastError: string | null,
	): CanonExtractionRecord {
		this.ensureCanonExtraction(bookId);
		this.db
			.prepare(
				`UPDATE canon_extractions
				SET status = ?, last_error = ?, updated_at = ?
				WHERE book_id = ?`,
			)
			.run(status, lastError, new Date().toISOString(), bookId);
		this.refreshCanonExtraction(bookId);
		this.#syncBookStatus(bookId, status);
		return this.#requireExtraction(bookId);
	}

	addCanonExtractionUsage(bookId: string, calls: number, tokens: number): void {
		if (calls < 0 || tokens < 0) throw new Error("调用次数与 token 不能是负数");
		this.db
			.prepare(
				`UPDATE canon_extractions
				SET llm_calls = llm_calls + ?, llm_tokens = llm_tokens + ?,
					updated_at = ?
				WHERE book_id = ?`,
			)
			.run(calls, tokens, new Date().toISOString(), bookId);
	}

	/**
	 * 重新数总章数与完成、失败章数。正在跑或已暂停的任务保留状态，
	 * 其余按实际进度回到 done / failed / idle。
	 */
	refreshCanonExtraction(bookId: string): CanonExtractionRecord {
		const current = this.ensureCanonExtraction(bookId);
		const counts = this.db
			.prepare(
				`SELECT
					(SELECT COUNT(*) FROM canon_chapters WHERE book_id = ?) AS total,
					(SELECT COUNT(*) FROM canon_chapter_extractions
						WHERE book_id = ? AND status = 'done') AS done,
					(SELECT COUNT(*) FROM canon_chapter_extractions
						WHERE book_id = ? AND status = 'failed') AS failed`,
			)
			.get(bookId, bookId, bookId) as {
			readonly total: number;
			readonly done: number;
			readonly failed: number;
		};
		let status = current.status;
		if (status !== "running" && status !== "paused") {
			if (counts.total > 0 && counts.done === counts.total) {
				status = "done";
			} else if (counts.failed > 0) {
				status = "failed";
			} else {
				status = "idle";
			}
		}
		this.db
			.prepare(
				`UPDATE canon_extractions
				SET total_chapters = ?, done_chapters = ?, failed_chapters = ?,
					status = ?, updated_at = ?
				WHERE book_id = ?`,
			)
			.run(
				counts.total,
				counts.done,
				counts.failed,
				status,
				new Date().toISOString(),
				bookId,
			);
		this.#syncBookStatus(bookId, status);
		return this.#requireExtraction(bookId);
	}

	/** 进程中断时把 running 退回 paused，块退回 pending，便于下次续跑。 */
	markInterruptedCanonExtractions(): number {
		const rows = this.db
			.prepare("SELECT book_id FROM canon_extractions WHERE status = 'running'")
			.all() as { readonly book_id: string }[];
		const now = new Date().toISOString();
		this.db.transaction(() => {
			for (const row of rows) {
				this.db
					.prepare(
						`UPDATE canon_extractions
						SET status = 'paused', updated_at = ?
						WHERE book_id = ?`,
					)
					.run(now, row.book_id);
				this.db
					.prepare(
						`UPDATE canon_chapter_extractions
						SET status = 'pending', updated_at = ?
						WHERE book_id = ? AND status = 'running'`,
					)
					.run(now, row.book_id);
				this.#syncBookStatus(row.book_id, "paused");
			}
		})();
		return rows.length;
	}

	ensureCanonChapterExtraction(
		bookId: string,
		chapterId: string,
		defaults: CanonChapterExtractionDefaults,
	): CanonChapterExtractionRecord {
		const now = new Date().toISOString();
		const chunks: CanonChunkProgress[] = defaults.chunks.map((chunk) => ({
			...chunk,
			status: "pending",
			error: null,
			tokens: 0,
		}));
		this.db
			.prepare(
				`INSERT OR IGNORE INTO canon_chapter_extractions
				(chapter_id, book_id, chapter_ordinal, status, chunks,
				 last_error, tokens, updated_at)
				VALUES (?, ?, ?, 'pending', ?, NULL, 0, ?)`,
			)
			.run(
				chapterId,
				bookId,
				defaults.chapterOrdinal,
				JSON.stringify(chunks),
				now,
			);
		const record = this.getCanonChapterExtraction(chapterId);
		if (record === null) {
			throw new Error(`章节 ${chapterId} 的抽取进度创建失败`);
		}
		return record;
	}

	getCanonChapterExtraction(
		chapterId: string,
	): CanonChapterExtractionRecord | null {
		const row = this.db
			.prepare("SELECT * FROM canon_chapter_extractions WHERE chapter_id = ?")
			.get(chapterId) as CanonChapterExtractionRow | undefined;
		return row === undefined ? null : rowToChapterExtraction(row);
	}

	listCanonChapterExtractions(
		bookId: string,
	): readonly CanonChapterExtractionRecord[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM canon_chapter_extractions
				WHERE book_id = ? ORDER BY chapter_ordinal ASC`,
			)
			.all(bookId) as CanonChapterExtractionRow[];
		return rows.map(rowToChapterExtraction);
	}

	setCanonChapterExtraction(
		bookId: string,
		chapterId: string,
		patch: CanonChapterExtractionPatch,
	): CanonChapterExtractionRecord {
		this.db
			.prepare(
				`UPDATE canon_chapter_extractions
				SET status = ?, chunks = ?, last_error = ?, tokens = ?, updated_at = ?
				WHERE book_id = ? AND chapter_id = ?`,
			)
			.run(
				patch.status,
				JSON.stringify(patch.chunks),
				patch.lastError,
				patch.tokens,
				new Date().toISOString(),
				bookId,
				chapterId,
			);
		const record = this.getCanonChapterExtraction(chapterId);
		if (record === null) {
			throw new Error(`章节 ${chapterId} 的抽取进度不存在`);
		}
		return record;
	}

	/** 整章重跑：进度换回按当前原文重新切的块，旧结果由调用方清理。 */
	resetCanonChapterExtraction(
		bookId: string,
		chapterId: string,
		defaults: CanonChapterExtractionDefaults,
	): CanonChapterExtractionRecord {
		const chunks: CanonChunkProgress[] = defaults.chunks.map((chunk) => ({
			...chunk,
			status: "pending",
			error: null,
			tokens: 0,
		}));
		this.db
			.prepare(
				`INSERT INTO canon_chapter_extractions
				(chapter_id, book_id, chapter_ordinal, status, chunks,
				 last_error, tokens, updated_at)
				VALUES (?, ?, ?, 'pending', ?, NULL, 0, ?)
				ON CONFLICT(chapter_id) DO UPDATE SET
					status = 'pending', chunks = excluded.chunks,
					last_error = NULL, tokens = 0, updated_at = excluded.updated_at`,
			)
			.run(
				chapterId,
				bookId,
				defaults.chapterOrdinal,
				JSON.stringify(chunks),
				new Date().toISOString(),
			);
		const record = this.getCanonChapterExtraction(chapterId);
		if (record === null) {
			throw new Error(`章节 ${chapterId} 的抽取进度重建失败`);
		}
		return record;
	}

	clearCanonChapterResults(chapterId: string): void {
		this.db.transaction(() => {
			this.db
				.prepare("DELETE FROM canon_events WHERE chapter_id = ?")
				.run(chapterId);
			this.db
				.prepare("DELETE FROM canon_voices WHERE chapter_id = ?")
				.run(chapterId);
			this.db
				.prepare("DELETE FROM canon_facts WHERE chapter_id = ?")
				.run(chapterId);
		})();
	}

	/** 一块的结果整体落库；事件段落范围与参与人物已在引擎里校验过。 */
	insertCanonChunkResults(input: CanonChunkResultsInput): void {
		const now = new Date().toISOString();
		this.db.transaction(() => {
			let seq = (
				this.db
					.prepare(
						"SELECT COALESCE(MAX(seq), 0) AS seq FROM canon_events WHERE chapter_id = ?",
					)
					.get(input.chapterId) as { readonly seq: number }
			).seq;
			const insertEvent = this.db.prepare(
				`INSERT INTO canon_events
				(book_id, chapter_id, chapter_ordinal, seq, title, summary, digest,
				 participants, location, time_text, paragraph_start, paragraph_end,
				 is_interlude, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			);
			for (const event of input.events) {
				seq += 1;
				insertEvent.run(
					input.bookId,
					input.chapterId,
					input.chapterOrdinal,
					seq,
					event.title,
					event.summary,
					event.digest,
					JSON.stringify(event.participants),
					event.location,
					event.timeText,
					event.paragraphStart,
					event.paragraphEnd,
					event.isInterlude ? 1 : 0,
					now,
				);
			}
			const countVoices = this.db.prepare(
				"SELECT COUNT(*) AS count FROM canon_voices WHERE chapter_id = ? AND character = ?",
			);
			const textExists = this.db.prepare(
				"SELECT 1 FROM canon_voices WHERE chapter_id = ? AND character = ? AND text = ?",
			);
			let voiceOrdinal = (
				this.db
					.prepare(
						"SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM canon_voices WHERE chapter_id = ?",
					)
					.get(input.chapterId) as { readonly ordinal: number }
			).ordinal;
			const insertVoice = this.db.prepare(
				`INSERT INTO canon_voices
				(book_id, chapter_id, chapter_ordinal, ordinal, character, kind, text, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			);
			for (const voice of input.voices) {
				const existing = (
					countVoices.get(input.chapterId, voice.character) as {
						readonly count: number;
					}
				).count;
				if (existing >= 5) continue;
				if (textExists.get(input.chapterId, voice.character, voice.text)) {
					continue;
				}
				voiceOrdinal += 1;
				insertVoice.run(
					input.bookId,
					input.chapterId,
					input.chapterOrdinal,
					voiceOrdinal,
					voice.character,
					voice.kind,
					voice.text,
					now,
				);
			}
			const insertFact = this.db.prepare(
				`INSERT INTO canon_facts
				(book_id, chapter_id, chapter_ordinal, entity_name, aliases,
				 entity_kind, fact, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			);
			for (const fact of input.facts) {
				insertFact.run(
					input.bookId,
					input.chapterId,
					input.chapterOrdinal,
					fact.name,
					JSON.stringify(fact.aliases),
					fact.kind,
					fact.fact,
					now,
				);
			}
		})();
	}

	listCanonEntities(bookId: string): readonly CanonEntityRecord[] {
		const rows = this.db
			.prepare(
				"SELECT * FROM canon_entities WHERE book_id = ? ORDER BY first_chapter_ordinal ASC, name ASC",
			)
			.all(bookId) as CanonEntityRow[];
		return rows.map(rowToEntity);
	}

	upsertCanonEntities(
		bookId: string,
		entries: readonly CanonEntityInput[],
	): void {
		const select = this.db.prepare(
			"SELECT * FROM canon_entities WHERE book_id = ? AND name = ?",
		);
		const upsert = this.db.prepare(
			`INSERT INTO canon_entities
			(book_id, name, aliases, kind, first_chapter_ordinal, last_chapter_ordinal)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(book_id, name) DO UPDATE SET
				aliases = excluded.aliases,
				kind = excluded.kind,
				first_chapter_ordinal = excluded.first_chapter_ordinal,
				last_chapter_ordinal = excluded.last_chapter_ordinal`,
		);
		this.db.transaction(() => {
			for (const entry of entries) {
				const existing = select.get(bookId, entry.name) as
					| CanonEntityRow
					| undefined;
				const aliases = new Set(
					existing === undefined
						? []
						: parseStringArray(existing.aliases, `实体 ${entry.name} 的别名`),
				);
				for (const alias of entry.aliases) {
					if (alias !== entry.name) aliases.add(alias);
				}
				upsert.run(
					bookId,
					entry.name,
					JSON.stringify([...aliases]),
					entry.kind,
					existing === undefined
						? entry.chapterOrdinal
						: Math.min(existing.first_chapter_ordinal, entry.chapterOrdinal),
					existing === undefined
						? entry.chapterOrdinal
						: Math.max(existing.last_chapter_ordinal, entry.chapterOrdinal),
				);
			}
		})();
	}

	/** 整章重跑后按剩余结果重建名册，避免旧别名继续影响下一章。 */
	replaceCanonEntities(
		bookId: string,
		entries: readonly CanonEntityInput[],
	): void {
		this.db.transaction(() => {
			this.db
				.prepare("DELETE FROM canon_entities WHERE book_id = ?")
				.run(bookId);
			for (const entry of entries) {
				this.db
					.prepare(
						`INSERT INTO canon_entities
						(book_id, name, aliases, kind, first_chapter_ordinal, last_chapter_ordinal)
						VALUES (?, ?, ?, ?, ?, ?)
						ON CONFLICT(book_id, name) DO UPDATE SET
							aliases = excluded.aliases,
							kind = excluded.kind,
							first_chapter_ordinal = MIN(
								canon_entities.first_chapter_ordinal, excluded.first_chapter_ordinal
							),
							last_chapter_ordinal = MAX(
								canon_entities.last_chapter_ordinal, excluded.last_chapter_ordinal
							)`,
					)
					.run(
						bookId,
						entry.name,
						JSON.stringify(entry.aliases),
						entry.kind,
						entry.chapterOrdinal,
						entry.chapterOrdinal,
					);
			}
		})();
	}

	listCanonEvents(
		bookId: string,
		options: { readonly chapterId?: string } = {},
	): readonly CanonEventRecord[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM canon_events
				WHERE book_id = ? AND (? IS NULL OR chapter_id = ?)
				ORDER BY chapter_ordinal ASC, paragraph_start ASC, seq ASC`,
			)
			.all(
				bookId,
				options.chapterId ?? null,
				options.chapterId ?? null,
			) as CanonEventRow[];
		return rows.map(rowToEvent);
	}

	/** 主时间线：插叙、回忆、梦境不进这里，只留在事件全量里。 */
	listCanonTimeline(
		bookId: string,
		options: { readonly chapterId?: string } = {},
	): readonly CanonEventRecord[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM canon_events
				WHERE book_id = ? AND is_interlude = 0
					AND (? IS NULL OR chapter_id = ?)
				ORDER BY chapter_ordinal ASC, paragraph_start ASC, seq ASC`,
			)
			.all(
				bookId,
				options.chapterId ?? null,
				options.chapterId ?? null,
			) as CanonEventRow[];
		return rows.map(rowToEvent);
	}

	listCanonVoices(
		bookId: string,
		options: { readonly chapterId?: string } = {},
	): readonly CanonVoiceRecord[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM canon_voices
				WHERE book_id = ? AND (? IS NULL OR chapter_id = ?)
				ORDER BY chapter_ordinal ASC, ordinal ASC`,
			)
			.all(
				bookId,
				options.chapterId ?? null,
				options.chapterId ?? null,
			) as CanonVoiceRow[];
		return rows.map(rowToVoice);
	}

	listCanonFacts(
		bookId: string,
		options: { readonly chapterId?: string } = {},
	): readonly CanonFactRecord[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM canon_facts
				WHERE book_id = ? AND (? IS NULL OR chapter_id = ?)
				ORDER BY chapter_ordinal ASC, id ASC`,
			)
			.all(
				bookId,
				options.chapterId ?? null,
				options.chapterId ?? null,
			) as CanonFactRow[];
		return rows.map(rowToFact);
	}

	// ---- 全书汇编（canon/03）----

	getCanonCompilation(bookId: string): CanonCompilationRecord | null {
		const row = this.db
			.prepare("SELECT * FROM canon_compilations WHERE book_id = ?")
			.get(bookId) as CanonCompilationRow | undefined;
		return row === undefined ? null : rowToCompilation(row);
	}

	ensureCanonCompilation(bookId: string): CanonCompilationRecord {
		this.#requireBook(bookId);
		this.db
			.prepare(
				`INSERT OR IGNORE INTO canon_compilations
				(book_id, status, model, llm_calls, llm_tokens, last_error,
				 started_at, updated_at)
				VALUES (?, 'idle', NULL, 0, 0, NULL, NULL, ?)`,
			)
			.run(bookId, new Date().toISOString());
		return this.#requireCompilation(bookId);
	}

	markCanonCompilationRunning(
		bookId: string,
		model: string | null,
	): CanonCompilationRecord {
		const current = this.ensureCanonCompilation(bookId);
		const now = new Date().toISOString();
		this.db
			.prepare(
				`UPDATE canon_compilations
				SET status = 'running', model = ?, last_error = NULL,
					started_at = ?, updated_at = ?
				WHERE book_id = ?`,
			)
			.run(model, current.startedAt ?? now, now, bookId);
		return this.#requireCompilation(bookId);
	}

	addCanonCompilationUsage(
		bookId: string,
		calls: number,
		tokens: number,
	): void {
		if (calls < 0 || tokens < 0) throw new Error("调用次数与 token 不能是负数");
		this.db
			.prepare(
				`UPDATE canon_compilations
				SET llm_calls = llm_calls + ?, llm_tokens = llm_tokens + ?,
					updated_at = ?
				WHERE book_id = ?`,
			)
			.run(calls, tokens, new Date().toISOString(), bookId);
	}

	finishCanonCompilation(
		bookId: string,
		status: "done" | "failed",
		lastError: string | null,
	): CanonCompilationRecord {
		this.ensureCanonCompilation(bookId);
		this.db
			.prepare(
				`UPDATE canon_compilations
				SET status = ?, last_error = ?, updated_at = ?
				WHERE book_id = ?`,
			)
			.run(status, lastError, new Date().toISOString(), bookId);
		return this.#requireCompilation(bookId);
	}

	/** 进程中断时把 running 退回 failed，玩家可以重新汇编。 */
	markInterruptedCanonCompilations(): number {
		const result = this.db
			.prepare(
				`UPDATE canon_compilations
				SET status = 'failed', last_error = '汇编被中断', updated_at = ?
				WHERE status = 'running'`,
			)
			.run(new Date().toISOString());
		return result.changes;
	}

	listCanonCompiledEntities(
		bookId: string,
	): readonly CanonCompiledEntityRecord[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM canon_compiled_entities
				WHERE book_id = ?
				ORDER BY first_chapter_ordinal ASC, name ASC`,
			)
			.all(bookId) as CanonCompiledEntityRow[];
		return rows.map(rowToCompiledEntity);
	}

	replaceCanonCompiledEntities(
		bookId: string,
		entries: readonly CanonCompiledEntityInput[],
	): void {
		this.db.transaction(() => {
			this.db
				.prepare("DELETE FROM canon_compiled_entities WHERE book_id = ?")
				.run(bookId);
			const insert = this.db.prepare(
				`INSERT INTO canon_compiled_entities
				(book_id, name, aliases, kind, lead, base, base_entries,
				 first_chapter_ordinal, last_chapter_ordinal)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			);
			for (const entry of entries) {
				const entries2 = [...entry.baseEntries].sort(
					(left, right) => left.chapterOrdinal - right.chapterOrdinal,
				);
				insert.run(
					bookId,
					entry.name,
					JSON.stringify(entry.aliases),
					entry.kind,
					entry.lead,
					entry.base,
					JSON.stringify(entries2),
					entry.firstChapterOrdinal,
					entry.lastChapterOrdinal,
				);
			}
		})();
	}

	/**
	 * 把合并组落到已有数据上：名册合并，事件参与人物、话术人物与事实实体名
	 * 一起改成标准名。抽取阶段的别名归并漏掉的同名与别名在这里收口。
	 */
	applyCanonEntityMerges(
		bookId: string,
		merges: readonly CanonEntityMerge[],
	): readonly CanonEntityRecord[] {
		if (merges.length === 0) return this.listCanonEntities(bookId);
		const owner = new Map<string, CanonEntityMerge>();
		for (const merge of merges) {
			for (const name of merge.mergedFrom) {
				if (owner.has(name)) {
					throw new Error(`实体「${name}」出现在多个合并组里`);
				}
				owner.set(name, merge);
			}
		}
		const resolve = (name: string): string =>
			owner.get(name)?.canonicalName ?? name;
		this.db.transaction(() => {
			const rows = this.db
				.prepare("SELECT * FROM canon_entities WHERE book_id = ?")
				.all(bookId) as CanonEntityRow[];
			const groups = new Map<
				string,
				{
					aliases: Set<string>;
					kind: CanonEntityKind;
					first: number;
					last: number;
				}
			>();
			for (const row of rows) {
				const canonical = resolve(row.name);
				const kind = readEntityKind(row.kind);
				const group = groups.get(canonical) ?? {
					aliases: new Set<string>(),
					kind,
					first: row.first_chapter_ordinal,
					last: row.last_chapter_ordinal,
				};
				groups.set(canonical, group);
				if (row.name === canonical) group.kind = kind;
				group.first = Math.min(group.first, row.first_chapter_ordinal);
				group.last = Math.max(group.last, row.last_chapter_ordinal);
				for (const alias of parseStringArray(
					row.aliases,
					`实体 ${row.name} 的别名`,
				)) {
					if (resolve(alias) !== canonical) group.aliases.add(alias);
				}
				if (row.name !== canonical) group.aliases.add(row.name);
			}
			for (const merge of merges) {
				const group = groups.get(merge.canonicalName);
				if (group === undefined) {
					throw new Error(`合并组的标准名「${merge.canonicalName}」不在书里`);
				}
				for (const alias of merge.aliases) {
					if (resolve(alias) !== merge.canonicalName) {
						group.aliases.add(alias);
					}
				}
				for (const name of merge.mergedFrom) {
					if (name !== merge.canonicalName) group.aliases.add(name);
				}
			}
			this.db
				.prepare("DELETE FROM canon_entities WHERE book_id = ?")
				.run(bookId);
			const insert = this.db.prepare(
				`INSERT INTO canon_entities
				(book_id, name, aliases, kind, first_chapter_ordinal, last_chapter_ordinal)
				VALUES (?, ?, ?, ?, ?, ?)`,
			);
			for (const [canonical, group] of groups) {
				insert.run(
					bookId,
					canonical,
					JSON.stringify([...group.aliases]),
					group.kind,
					group.first,
					group.last,
				);
			}
			const facts = this.db
				.prepare(
					"SELECT id, entity_name, aliases FROM canon_facts WHERE book_id = ?",
				)
				.all(bookId) as {
				readonly id: number;
				readonly entity_name: string;
				readonly aliases: string;
			}[];
			const updateFact = this.db.prepare(
				"UPDATE canon_facts SET entity_name = ?, aliases = ? WHERE id = ?",
			);
			for (const fact of facts) {
				const name = resolve(fact.entity_name);
				const aliases = [
					...new Set(
						parseStringArray(fact.aliases, `事实 ${fact.id} 的别名`).map(
							resolve,
						),
					),
				].filter((alias) => alias !== name);
				updateFact.run(name, JSON.stringify(aliases), fact.id);
			}
			const events = this.db
				.prepare("SELECT id, participants FROM canon_events WHERE book_id = ?")
				.all(bookId) as {
				readonly id: number;
				readonly participants: string;
			}[];
			const updateEvent = this.db.prepare(
				"UPDATE canon_events SET participants = ? WHERE id = ?",
			);
			for (const event of events) {
				const before = parseStringArray(
					event.participants,
					`事件 ${event.id} 的参与人物`,
				);
				const after = [...new Set(before.map(resolve))];
				if (
					after.length !== before.length ||
					after.some((name, index) => name !== before[index])
				) {
					updateEvent.run(JSON.stringify(after), event.id);
				}
			}
			const updateVoice = this.db.prepare(
				"UPDATE canon_voices SET character = ? WHERE book_id = ? AND character = ?",
			);
			for (const [name, merge] of owner) {
				if (name === merge.canonicalName) continue;
				updateVoice.run(merge.canonicalName, bookId, name);
			}
		})();
		return this.listCanonEntities(bookId);
	}

	/** 主时间线顺序 1..N；插叙写 null。 */
	applyCanonEventTimeline(
		bookId: string,
		patches: readonly CanonEventTimelinePatch[],
	): void {
		const update = this.db.prepare(
			`UPDATE canon_events
			SET timeline_order = ?, is_turning_point = ?
			WHERE book_id = ? AND id = ?`,
		);
		this.db.transaction(() => {
			for (const patch of patches) {
				update.run(
					patch.timelineOrder,
					patch.isTurningPoint ? 1 : 0,
					bookId,
					patch.eventId,
				);
			}
		})();
	}

	/**
	 * 导入原著包：书、章、汇编实体、事件轨道、话术与事实一次写入，
	 * 抽取与汇编都标成完成，不再调用模型。
	 */
	importCanonPackage(pkg: CanonPackage): {
		readonly book: CanonBookRecord;
		readonly chapters: readonly CanonChapterSummary[];
	} {
		const title = pkg.book.title.trim();
		if (title.length === 0) throw new Error("原著包的书名不能为空");
		if (pkg.chapters.length === 0) throw new Error("原著包至少要有一章");
		const now = new Date().toISOString();
		const bookId = randomUUID();
		const chapters = pkg.chapters.map((chapter, index) => {
			if (chapter.ordinal !== index + 1) {
				throw new Error(
					`原著包的章节序号必须从 1 连续编号，第 ${index + 1} 项是 ${chapter.ordinal}`,
				);
			}
			const title2 = chapter.title.trim();
			if (title2.length === 0) {
				throw new Error(`原著包第 ${chapter.ordinal} 章的标题不能为空`);
			}
			const paragraphs = chapter.paragraphs ?? [];
			if (chapter.paragraphs !== undefined && paragraphs.length === 0) {
				throw new Error(`原著包第 ${chapter.ordinal} 章标了原文却是空的`);
			}
			return {
				id: randomUUID(),
				ordinal: chapter.ordinal,
				volumeTitle: chapter.volumeTitle,
				title: title2,
				kind: assertCanonChapterKind(chapter.kind, "原著包章节类型"),
				paragraphs,
				paragraphCount:
					paragraphs.length > 0 ? paragraphs.length : chapter.paragraphCount,
				charCount:
					paragraphs.length > 0
						? countCanonChars(paragraphs)
						: chapter.charCount,
			};
		});
		const hasText = chapters.some((chapter) => chapter.paragraphs.length > 0);
		const charCount = chapters.reduce(
			(total, chapter) => total + chapter.charCount,
			0,
		);
		const chapterIdByOrdinal = new Map(
			chapters.map((chapter) => [chapter.ordinal, chapter.id]),
		);
		const requireChapterId = (ordinal: number): string => {
			const id = chapterIdByOrdinal.get(ordinal);
			if (id === undefined) {
				throw new Error(`原著包里的事件或话术引用了不存在的第 ${ordinal} 章`);
			}
			return id;
		};
		this.db.transaction(() => {
			this.db
				.prepare(
					`INSERT INTO canon_books
					(id, title, filename, encoding, char_count, chapter_count,
					 status, has_text, created_at)
					VALUES (?, ?, ?, ?, ?, ?, 'extracted', ?, ?)`,
				)
				.run(
					bookId,
					title,
					pkg.book.filename,
					pkg.book.encoding,
					charCount,
					chapters.length,
					hasText ? 1 : 0,
					now,
				);
			const insertChapter = this.db.prepare(
				`INSERT INTO canon_chapters
				(id, book_id, ordinal, volume_title, title, kind, paragraphs,
				 paragraph_count, char_count, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			);
			for (const chapter of chapters) {
				insertChapter.run(
					chapter.id,
					bookId,
					chapter.ordinal,
					chapter.volumeTitle,
					chapter.title,
					chapter.kind,
					JSON.stringify(chapter.paragraphs),
					chapter.paragraphCount,
					chapter.charCount,
					now,
				);
			}
			const insertEvent = this.db.prepare(
				`INSERT INTO canon_events
				(book_id, chapter_id, chapter_ordinal, seq, title, summary, digest,
				 participants, location, time_text, paragraph_start, paragraph_end,
				 is_interlude, timeline_order, is_turning_point, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			);
			for (const event of pkg.events) {
				insertEvent.run(
					bookId,
					requireChapterId(event.chapterOrdinal),
					event.chapterOrdinal,
					event.seq,
					event.title,
					event.summary,
					event.digest,
					JSON.stringify(event.participants),
					event.location,
					event.timeText,
					event.paragraphStart,
					event.paragraphEnd,
					event.isInterlude ? 1 : 0,
					event.timelineOrder,
					event.isTurningPoint ? 1 : 0,
					now,
				);
			}
			const insertVoice = this.db.prepare(
				`INSERT INTO canon_voices
				(book_id, chapter_id, chapter_ordinal, ordinal, character, kind, text, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			);
			for (const voice of pkg.voices) {
				insertVoice.run(
					bookId,
					requireChapterId(voice.chapterOrdinal),
					voice.chapterOrdinal,
					voice.ordinal,
					voice.character,
					voice.kind,
					voice.text,
					now,
				);
			}
			const insertFact = this.db.prepare(
				`INSERT INTO canon_facts
				(book_id, chapter_id, chapter_ordinal, entity_name, aliases,
				 entity_kind, fact, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			);
			for (const fact of pkg.facts) {
				insertFact.run(
					bookId,
					requireChapterId(fact.chapterOrdinal),
					fact.chapterOrdinal,
					fact.entityName,
					JSON.stringify(fact.aliases),
					fact.entityKind,
					fact.fact,
					now,
				);
			}
			this.replaceCanonCompiledEntities(
				bookId,
				pkg.entities.map((entity) => ({
					name: entity.name,
					aliases: entity.aliases,
					kind: entity.kind,
					lead: entity.lead,
					base: entity.base,
					baseEntries: entity.baseEntries,
					firstChapterOrdinal: entity.firstChapterOrdinal,
					lastChapterOrdinal: entity.lastChapterOrdinal,
				})),
			);
			this.db
				.prepare(
					`INSERT INTO canon_extractions
					(book_id, status, model, total_chapters, done_chapters,
					 failed_chapters, llm_calls, llm_tokens, last_error,
					 started_at, updated_at)
					VALUES (?, 'done', NULL, ?, ?, 0, 0, 0, NULL, ?, ?)`,
				)
				.run(bookId, chapters.length, chapters.length, now, now);
			const insertChapterExtraction = this.db.prepare(
				`INSERT INTO canon_chapter_extractions
				(chapter_id, book_id, chapter_ordinal, status, chunks,
				 last_error, tokens, updated_at)
				VALUES (?, ?, ?, 'done', '[]', NULL, 0, ?)`,
			);
			for (const chapter of chapters) {
				insertChapterExtraction.run(chapter.id, bookId, chapter.ordinal, now);
			}
			this.db
				.prepare(
					`INSERT INTO canon_compilations
					(book_id, status, model, llm_calls, llm_tokens, last_error,
					 started_at, updated_at)
					VALUES (?, 'done', NULL, 0, 0, NULL, ?, ?)`,
				)
				.run(bookId, now, now);
		})();
		return {
			book: this.#requireBook(bookId),
			chapters: this.listCanonChapters(bookId),
		};
	}

	#requireCompilation(bookId: string): CanonCompilationRecord {
		const record = this.getCanonCompilation(bookId);
		if (record === null) throw new Error(`原著 ${bookId} 的汇编任务不存在`);
		return record;
	}

	#chapterCount(bookId: string): number {
		return (
			this.db
				.prepare(
					"SELECT COUNT(*) AS count FROM canon_chapters WHERE book_id = ?",
				)
				.get(bookId) as { readonly count: number }
		).count;
	}

	#requireExtraction(bookId: string): CanonExtractionRecord {
		const record = this.getCanonExtraction(bookId);
		if (record === null) throw new Error(`原著 ${bookId} 的抽取任务不存在`);
		return record;
	}

	#dropChapterExtraction(chapterId: string): void {
		this.db
			.prepare("DELETE FROM canon_chapter_extractions WHERE chapter_id = ?")
			.run(chapterId);
		this.clearCanonChapterResults(chapterId);
	}

	/** 章节序号变化后，所有锚点一起跟上；不然后面的防剧透切片会错位。 */
	#syncChapterOrdinals(bookId: string): void {
		for (const table of [
			"canon_chapter_extractions",
			"canon_events",
			"canon_voices",
			"canon_facts",
		]) {
			this.db
				.prepare(
					`UPDATE ${table}
					SET chapter_ordinal = (
						SELECT ordinal FROM canon_chapters WHERE id = ${table}.chapter_id
					)
					WHERE book_id = ?`,
				)
				.run(bookId);
		}
	}

	/** 一个故事只能绑定一本原著；重复绑定直接失败，由调用方决定怎么处理。 */
	saveStoryCanonBinding(
		input: SaveStoryCanonBindingInput,
	): CanonStoryBindingRecord {
		assertNonEmptyString(input.storyId, "故事 id");
		assertNonEmptyString(input.bookId, "原著 id");
		assertNonEmptyString(input.playerEntityName, "扮演人物名");
		if (this.store.getStory(input.storyId) === null) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		this.#requireBook(input.bookId);
		if (!isCanonIdentityKind(input.identityKind)) {
			throw new Error(`扮演身份不合法：${String(input.identityKind)}`);
		}
		if (
			!Number.isInteger(input.startChapterOrdinal) ||
			input.startChapterOrdinal < 1
		) {
			throw new Error("开局章节必须是正整数");
		}
		const event = this.db
			.prepare("SELECT book_id, chapter_ordinal FROM canon_events WHERE id = ?")
			.get(input.startEventId) as
			| { readonly book_id: string; readonly chapter_ordinal: number }
			| undefined;
		if (event === undefined) {
			throw new Error(`原著事件不存在：${input.startEventId}`);
		}
		if (event.book_id !== input.bookId) {
			throw new Error(
				`原著事件 ${input.startEventId} 不属于原著 ${input.bookId}`,
			);
		}
		if (input.identityKind === "canon" && input.playerPage === null) {
			throw new Error("扮演原著人物时必须给出这个人物的资料");
		}
		if (this.getStoryCanonBinding(input.storyId) !== null) {
			throw new Error(`故事 ${input.storyId} 已经绑定过原著`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		const allow = input.allowFullBookSpoilers === true;
		this.db
			.prepare(
				`INSERT INTO story_canon
					(story_id, book_id, start_event_id, start_chapter_ordinal,
					 identity_kind, player_entity_name, player_page,
					 allow_full_book_spoilers, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.storyId,
				input.bookId,
				input.startEventId,
				input.startChapterOrdinal,
				input.identityKind,
				input.playerEntityName,
				input.playerPage === null ? null : JSON.stringify(input.playerPage),
				allow ? 1 : 0,
				createdAt,
			);
		const saved = this.getStoryCanonBinding(input.storyId);
		if (saved === null) {
			throw new Error(`故事 ${input.storyId} 的原著绑定写入后读取失败`);
		}
		return saved;
	}

	getStoryCanonBinding(storyId: string): CanonStoryBindingRecord | null {
		assertNonEmptyString(storyId, "故事 id");
		const row = this.db
			.prepare("SELECT * FROM story_canon WHERE story_id = ?")
			.get(storyId) as StoryCanonRow | undefined;
		return row === undefined ? null : rowToStoryCanon(row);
	}

	/**
	 * 写入某一楼层的原著游标；同一楼层重复写入覆盖旧游标。
	 * 游标的事件必须属于这个故事绑定的原著，避免两本书混在一起。
	 */
	saveCanonCursor(input: SaveCanonCursorInput): CanonCursorRecord {
		assertNonEmptyString(input.storyId, "故事 id");
		assertNonEmptyString(input.nodeId, "楼层 id");
		if (!Number.isInteger(input.eventOrdinal) || input.eventOrdinal < 1) {
			throw new Error("原著游标的事件序号必须是正整数");
		}
		if (!Number.isInteger(input.chapterOrdinal) || input.chapterOrdinal < 1) {
			throw new Error("原著游标的章节必须是正整数");
		}
		const binding = this.getStoryCanonBinding(input.storyId);
		if (binding === null) {
			throw new Error(`故事 ${input.storyId} 还没有绑定原著`);
		}
		const node = this.store.getNode(input.nodeId);
		if (node === null) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(`楼层 ${input.nodeId} 属于另一个故事`);
		}
		const event = this.db
			.prepare("SELECT book_id, chapter_ordinal FROM canon_events WHERE id = ?")
			.get(input.eventId) as
			| { readonly book_id: string; readonly chapter_ordinal: number }
			| undefined;
		if (event === undefined) {
			throw new Error(`原著事件不存在：${input.eventId}`);
		}
		if (event.book_id !== binding.bookId) {
			throw new Error(`原著事件 ${input.eventId} 不属于绑定的原著`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO canon_cursors
					(story_id, node_id, event_id, event_ordinal, chapter_ordinal, created_at)
				VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT (story_id, node_id) DO UPDATE SET
					event_id = excluded.event_id,
					event_ordinal = excluded.event_ordinal,
					chapter_ordinal = excluded.chapter_ordinal,
					created_at = excluded.created_at`,
			)
			.run(
				input.storyId,
				input.nodeId,
				input.eventId,
				input.eventOrdinal,
				input.chapterOrdinal,
				createdAt,
			);
		const saved = this.getCanonCursor(input.storyId, input.nodeId);
		if (saved === null) {
			throw new Error(`原著游标写入后读取失败：${input.nodeId}`);
		}
		return saved;
	}

	getCanonCursor(storyId: string, nodeId: string): CanonCursorRecord | null {
		assertNonEmptyString(storyId, "故事 id");
		assertNonEmptyString(nodeId, "楼层 id");
		const row = this.db
			.prepare("SELECT * FROM canon_cursors WHERE story_id = ? AND node_id = ?")
			.get(storyId, nodeId) as CanonCursorRow | undefined;
		return row === undefined ? null : rowToCursor(row);
	}

	listCanonCursors(storyId: string): readonly CanonCursorRecord[] {
		assertNonEmptyString(storyId, "故事 id");
		const rows = this.db
			.prepare(
				`SELECT * FROM canon_cursors
				WHERE story_id = ? ORDER BY created_at ASC, node_id ASC`,
			)
			.all(storyId) as CanonCursorRow[];
		return rows.map(rowToCursor);
	}

	/** 最近写入的一个游标；当前楼没有游标时用它给界面一个可读的位置。 */
	getLatestCanonCursor(storyId: string): CanonCursorRecord | null {
		assertNonEmptyString(storyId, "故事 id");
		const row = this.db
			.prepare(
				`SELECT * FROM canon_cursors
				WHERE story_id = ? ORDER BY created_at DESC, node_id DESC LIMIT 1`,
			)
			.get(storyId) as CanonCursorRow | undefined;
		return row === undefined ? null : rowToCursor(row);
	}

	#syncBookStatus(bookId: string, status: CanonExtractionStatus): void {
		const mapped: CanonBookStatus =
			status === "running"
				? "extracting"
				: status === "done"
					? "extracted"
					: status === "failed"
						? "failed"
						: "ready";
		this.db
			.prepare("UPDATE canon_books SET status = ? WHERE id = ?")
			.run(mapped, bookId);
	}

	#requireBook(bookId: string): CanonBookRecord {
		const book = this.getCanonBook(bookId);
		if (book === null) {
			throw new Error(`原著 ${bookId} 不存在`);
		}
		return book;
	}

	#normalizeChapter(
		chapter: NewCanonChapter,
		index: number,
		bookId: string,
		createdAt: string,
	): CanonChapterRecord {
		const label = `第 ${index + 1} 章`;
		const title = chapter.title.trim();
		if (title.length === 0) {
			throw new Error(`${label}的标题不能为空`);
		}
		const volumeTitle = chapter.volumeTitle?.trim() || null;
		const kind = assertCanonChapterKind(chapter.kind, `${label}的类型`);
		if (chapter.paragraphs.length === 0) {
			throw new Error(`${label}没有正文`);
		}
		const paragraphs = chapter.paragraphs.map((paragraph, paragraphIndex) => {
			const trimmed = paragraph.trim();
			if (trimmed.length === 0) {
				throw new Error(`${label}第 ${paragraphIndex + 1} 段是空的`);
			}
			return trimmed;
		});
		return {
			id: randomUUID(),
			bookId,
			ordinal: index + 1,
			volumeTitle,
			title,
			kind,
			paragraphCount: paragraphs.length,
			charCount: countCanonChars(paragraphs),
			paragraphs,
			createdAt,
		};
	}

	#renumberChapters(bookId: string): void {
		const ids = (
			this.db
				.prepare(
					`SELECT id FROM canon_chapters
					WHERE book_id = ? ORDER BY ordinal ASC`,
				)
				.all(bookId) as { readonly id: string }[]
		).map((row) => row.id);
		this.#assignOrdinals(bookId, ids);
		this.#recountBook(bookId);
	}

	/** 先把序号整体挪到高处，避免 UNIQUE(book_id, ordinal) 在逐行更新时撞车。 */
	#assignOrdinals(bookId: string, ids: readonly string[]): void {
		if (ids.length === 0) return;
		this.db
			.prepare(
				"UPDATE canon_chapters SET ordinal = ordinal + ? WHERE book_id = ?",
			)
			.run(RENUMBER_OFFSET, bookId);
		const update = this.db.prepare(
			"UPDATE canon_chapters SET ordinal = ? WHERE id = ?",
		);
		ids.forEach((id, index) => {
			update.run(index + 1, id);
		});
	}

	#recountBook(bookId: string): void {
		const row = this.db
			.prepare(
				`SELECT COUNT(*) AS chapters, COALESCE(SUM(char_count), 0) AS chars
				FROM canon_chapters WHERE book_id = ?`,
			)
			.get(bookId) as { readonly chapters: number; readonly chars: number };
		this.db
			.prepare(
				"UPDATE canon_books SET chapter_count = ?, char_count = ? WHERE id = ?",
			)
			.run(row.chapters, row.chars, bookId);
	}
}
