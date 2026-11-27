/** 原著：导入的长篇小说原文，按卷、章存，章内保存分段数组。 */

export type CanonChapterKind = "chapter" | "prologue" | "epilogue" | "extra";

export const CANON_CHAPTER_KINDS: readonly CanonChapterKind[] = [
	"chapter",
	"prologue",
	"epilogue",
	"extra",
];

export function isCanonChapterKind(value: unknown): value is CanonChapterKind {
	return (
		value === "chapter" ||
		value === "prologue" ||
		value === "epilogue" ||
		value === "extra"
	);
}

export function assertCanonChapterKind(
	value: unknown,
	label: string,
): CanonChapterKind {
	if (!isCanonChapterKind(value)) {
		throw new Error(`${label} 必须是 chapter、prologue、epilogue 或 extra`);
	}
	return value;
}

/** 导入完成即 `ready`；抽取与汇编在 canon/02、03 里推进。 */
export type CanonBookStatus = "ready" | "extracting" | "extracted" | "failed";

export const CANON_BOOK_STATUSES: readonly CanonBookStatus[] = [
	"ready",
	"extracting",
	"extracted",
	"failed",
];

export function isCanonBookStatus(value: unknown): value is CanonBookStatus {
	return (
		value === "ready" ||
		value === "extracting" ||
		value === "extracted" ||
		value === "failed"
	);
}

export interface CanonBookRecord {
	readonly id: string;
	readonly title: string;
	readonly filename: string | null;
	readonly encoding: string;
	readonly charCount: number;
	readonly chapterCount: number;
	readonly status: CanonBookStatus;
	readonly createdAt: string;
}

/** 分章列表用，不带原文；读一章原文走 `getCanonChapter`。 */
export interface CanonChapterSummary {
	readonly id: string;
	readonly bookId: string;
	readonly ordinal: number;
	readonly volumeTitle: string | null;
	readonly title: string;
	readonly kind: CanonChapterKind;
	readonly paragraphCount: number;
	readonly charCount: number;
}

export interface CanonChapterRecord extends CanonChapterSummary {
	readonly paragraphs: readonly string[];
	readonly createdAt: string;
}

/** 分章结果，落库前还没有 id 与序号。 */
export interface NewCanonChapter {
	readonly volumeTitle: string | null;
	readonly title: string;
	readonly kind: CanonChapterKind;
	readonly paragraphs: readonly string[];
}

/** 抽取任务状态：一本原著只有一条。 */
export type CanonExtractionStatus =
	| "idle"
	| "running"
	| "paused"
	| "done"
	| "failed";

export const CANON_EXTRACTION_STATUSES: readonly CanonExtractionStatus[] = [
	"idle",
	"running",
	"paused",
	"done",
	"failed",
];

export function isCanonExtractionStatus(
	value: unknown,
): value is CanonExtractionStatus {
	return (
		value === "idle" ||
		value === "running" ||
		value === "paused" ||
		value === "done" ||
		value === "failed"
	);
}

/** 每章一条进度：待抽取、抽取中、已完成、失败。 */
export type CanonChapterExtractionStatus =
	| "pending"
	| "running"
	| "done"
	| "failed";

export function isCanonChapterExtractionStatus(
	value: unknown,
): value is CanonChapterExtractionStatus {
	return (
		value === "pending" ||
		value === "running" ||
		value === "done" ||
		value === "failed"
	);
}

/** 超过 2 万字的章按段落边界切块；块内状态单独记录，失败只影响这一块。 */
export type CanonChunkStatus = "pending" | "running" | "done" | "failed";

export interface CanonChunkPlan {
	/** 从 0 开始的块序号。 */
	readonly index: number;
	/** 本块在原章里的起止段落，1-based、两端都包含。 */
	readonly startParagraph: number;
	readonly endParagraph: number;
	readonly charCount: number;
}

export interface CanonChunkProgress extends CanonChunkPlan {
	readonly status: CanonChunkStatus;
	readonly error: string | null;
	readonly tokens: number;
}

export interface CanonExtractionRecord {
	readonly bookId: string;
	readonly status: CanonExtractionStatus;
	readonly model: string | null;
	readonly totalChapters: number;
	readonly doneChapters: number;
	readonly failedChapters: number;
	readonly llmCalls: number;
	readonly llmTokens: number;
	readonly lastError: string | null;
	readonly startedAt: string | null;
	readonly updatedAt: string;
}

export interface CanonChapterExtractionRecord {
	readonly chapterId: string;
	readonly bookId: string;
	readonly chapterOrdinal: number;
	readonly status: CanonChapterExtractionStatus;
	readonly chunks: readonly CanonChunkProgress[];
	readonly lastError: string | null;
	readonly tokens: number;
	readonly updatedAt: string;
}

/** 实体类别；抽取时由模型填写，未知值判为这一块不合格。 */
export const CANON_ENTITY_KINDS = [
	"人物",
	"地点",
	"势力",
	"物品",
	"其他",
] as const;

export type CanonEntityKind = (typeof CANON_ENTITY_KINDS)[number];

export function isCanonEntityKind(value: unknown): value is CanonEntityKind {
	return (
		typeof value === "string" &&
		(CANON_ENTITY_KINDS as readonly string[]).includes(value)
	);
}

/** 书级累积名册：下一章调用时附上，单章重跑后按剩余结果重建。 */
export interface CanonEntityRecord {
	readonly bookId: string;
	readonly name: string;
	readonly aliases: readonly string[];
	readonly kind: CanonEntityKind;
	readonly firstChapterOrdinal: number;
	readonly lastChapterOrdinal: number;
}

export interface CanonEventRecord {
	readonly id: number;
	readonly bookId: string;
	readonly chapterId: string;
	/** 章节锚点；主时间线按它切片，防剧透。 */
	readonly chapterOrdinal: number;
	readonly seq: number;
	readonly title: string;
	readonly summary: string;
	readonly digest: string;
	readonly participants: readonly string[];
	readonly location: string | null;
	readonly timeText: string | null;
	readonly paragraphStart: number;
	readonly paragraphEnd: number;
	/** 插叙、回忆、梦境；只作为人物经历，不进主时间线。 */
	readonly isInterlude: boolean;
	readonly createdAt: string;
}

export type CanonVoiceKind = "speech" | "thought";

export interface CanonVoiceRecord {
	readonly id: number;
	readonly bookId: string;
	readonly chapterId: string;
	readonly chapterOrdinal: number;
	readonly ordinal: number;
	readonly character: string;
	readonly kind: CanonVoiceKind;
	readonly text: string;
	readonly createdAt: string;
}

export interface CanonFactRecord {
	readonly id: number;
	readonly bookId: string;
	readonly chapterId: string;
	readonly chapterOrdinal: number;
	readonly entityName: string;
	readonly aliases: readonly string[];
	readonly entityKind: CanonEntityKind;
	readonly fact: string;
	readonly createdAt: string;
}

/** 模型对一块原文返回的结构；校验通过后才落库。 */
export interface CanonExtractedEvent {
	readonly title: string;
	readonly summary: string;
	readonly digest: string;
	readonly participants: readonly string[];
	readonly location: string | null;
	readonly timeText: string | null;
	readonly paragraphStart: number;
	readonly paragraphEnd: number;
	readonly isInterlude: boolean;
}

export interface CanonExtractedVoice {
	readonly character: string;
	readonly kind: CanonVoiceKind;
	readonly text: string;
}

export interface CanonExtractedFact {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly kind: CanonEntityKind;
	readonly fact: string;
}

export interface CanonChunkExtraction {
	readonly events: readonly CanonExtractedEvent[];
	readonly voices: readonly CanonExtractedVoice[];
	readonly facts: readonly CanonExtractedFact[];
}
