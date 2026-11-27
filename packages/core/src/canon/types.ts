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
	/** 导入的原著包不带原文时为 false；不能抽取，但可以直接用汇编结果开局。 */
	readonly hasText: boolean;
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
	/** 主时间线顺序 1..N；插叙不进主时间线，这里为 null。 */
	readonly timelineOrder: number | null;
	/** 关键转折；开局选事件与走向参考用。 */
	readonly isTurningPoint: boolean;
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

/** 全书汇编任务：一本原著一条，idle → running → done / failed。 */
export type CanonCompilationStatus = "idle" | "running" | "done" | "failed";

export const CANON_COMPILATION_STATUSES: readonly CanonCompilationStatus[] = [
	"idle",
	"running",
	"done",
	"failed",
];

export function isCanonCompilationStatus(
	value: unknown,
): value is CanonCompilationStatus {
	return (
		value === "idle" ||
		value === "running" ||
		value === "done" ||
		value === "failed"
	);
}

export interface CanonCompilationRecord {
	readonly bookId: string;
	readonly status: CanonCompilationStatus;
	readonly model: string | null;
	readonly llmCalls: number;
	readonly llmTokens: number;
	readonly lastError: string | null;
	readonly startedAt: string | null;
	readonly updatedAt: string;
}

/** 底色条目带章节锚点，防剧透切片就是按它过滤（v5 §5.4）。 */
export interface CanonBaseEntry {
	readonly chapterOrdinal: number;
	readonly text: string;
}

/** 汇编后的实体页：标准名、合并后的别名、一行简介与带锚点的底色。 */
export interface CanonCompiledEntityRecord {
	readonly bookId: string;
	readonly name: string;
	readonly aliases: readonly string[];
	readonly kind: CanonEntityKind;
	readonly lead: string;
	readonly base: string;
	readonly baseEntries: readonly CanonBaseEntry[];
	readonly firstChapterOrdinal: number;
	readonly lastChapterOrdinal: number;
}

/** 汇编第一步的合并结果：把 `mergedFrom` 里的名字都归到 `canonicalName`。 */
export interface CanonEntityMerge {
	readonly canonicalName: string;
	readonly aliases: readonly string[];
	readonly mergedFrom: readonly string[];
}

/** 原著故事包（v5 §5.3、§5.6）：默认不含原文，导入后直接可玩。 */
export const CANON_PACKAGE_FORMAT = "dramaticer-canon-package";
export const CANON_PACKAGE_VERSION = 1;

export interface CanonPackageBook {
	readonly title: string;
	readonly filename: string | null;
	readonly encoding: string;
	readonly charCount: number;
	readonly chapterCount: number;
	readonly hasText: boolean;
}

export interface CanonPackageChapter {
	readonly ordinal: number;
	readonly volumeTitle: string | null;
	readonly title: string;
	readonly kind: CanonChapterKind;
	readonly charCount: number;
	readonly paragraphCount: number;
	/** 只有导出时选择「包含原文」才有。 */
	readonly paragraphs?: readonly string[];
}

export interface CanonPackageEvent {
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
	readonly isInterlude: boolean;
	readonly timelineOrder: number | null;
	readonly isTurningPoint: boolean;
}

export interface CanonPackageVoice {
	readonly chapterOrdinal: number;
	readonly ordinal: number;
	readonly character: string;
	readonly kind: CanonVoiceKind;
	readonly text: string;
}

export interface CanonPackageFact {
	readonly chapterOrdinal: number;
	readonly entityName: string;
	readonly aliases: readonly string[];
	readonly entityKind: CanonEntityKind;
	readonly fact: string;
}

export interface CanonPackageEntity {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly kind: CanonEntityKind;
	readonly lead: string;
	readonly base: string;
	readonly baseEntries: readonly CanonBaseEntry[];
	readonly firstChapterOrdinal: number;
	readonly lastChapterOrdinal: number;
}

export interface CanonPackage {
	readonly format: typeof CANON_PACKAGE_FORMAT;
	readonly version: typeof CANON_PACKAGE_VERSION;
	readonly exportedAt: string;
	readonly book: CanonPackageBook;
	readonly chapters: readonly CanonPackageChapter[];
	readonly entities: readonly CanonPackageEntity[];
	readonly events: readonly CanonPackageEvent[];
	readonly voices: readonly CanonPackageVoice[];
	readonly facts: readonly CanonPackageFact[];
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

/** 玩家扮演谁：原著里已有的人物，或自创一个人物。 */
export type CanonIdentityKind = "canon" | "custom";

export const CANON_IDENTITY_KINDS: readonly CanonIdentityKind[] = [
	"canon",
	"custom",
];

export function isCanonIdentityKind(
	value: unknown,
): value is CanonIdentityKind {
	return value === "canon" || value === "custom";
}

/** 开局时截取到的扮演人物页；只含开局章节前的底色，作为玩家角色资料存着。 */
export interface CanonPlayerPage {
	readonly name: string;
	readonly kind: CanonEntityKind;
	readonly aliases: readonly string[];
	readonly lead: string;
	readonly base: string;
	readonly entries: readonly CanonBaseEntry[];
}

/** 原著窗口的叠加方式（v5 §5.5）：默认概要加话术。 */
export const CANON_WINDOW_MODES = [
	"summary_only",
	"summary_voice",
	"full_text",
] as const;

export type CanonWindowMode = (typeof CANON_WINDOW_MODES)[number];

export function isCanonWindowMode(value: unknown): value is CanonWindowMode {
	return (
		value === "summary_only" ||
		value === "summary_voice" ||
		value === "full_text"
	);
}

/** 一个故事与一本原著的绑定；每个故事最多一条。 */
export interface CanonStoryBindingRecord {
	readonly storyId: string;
	readonly bookId: string;
	readonly startEventId: number;
	readonly startChapterOrdinal: number;
	readonly identityKind: CanonIdentityKind;
	readonly playerEntityName: string;
	/** 扮演原著人物时的资料；自创人物时为 null。 */
	readonly playerPage: CanonPlayerPage | null;
	/** 默认关；打开后上下文才能取到游标之后的内容。 */
	readonly allowFullBookSpoilers: boolean;
	readonly windowMode: CanonWindowMode;
	/** 玩家点了「推进 N 件」后还没被这一轮消费的件数；回合结束清零。 */
	readonly pendingAdvance: number;
	readonly createdAt: string;
}

/** 某一楼层演到的原著位置；游标是主时间线的事件序号。 */
export interface CanonCursorRecord {
	readonly storyId: string;
	readonly nodeId: string;
	readonly eventId: number;
	readonly eventOrdinal: number;
	readonly chapterOrdinal: number;
	/** 「从这里开始」刚写入、还没被一楼演过；这一楼不自动前进。 */
	readonly fromHere: boolean;
	readonly createdAt: string;
}

// 玩家就地改原著事件（v5 §5.5）：按格保存，每格一条只追加的版本记录；
// 底层抽取出的原文表不动，窗口与原著页读当前楼层路径上各格的最新一版。

export const CANON_EVENT_FIELDS = [
	"title",
	"summary",
	"digest",
	"voices",
	"passage",
] as const;

export type CanonEventField = (typeof CANON_EVENT_FIELDS)[number];

export function isCanonEventField(value: unknown): value is CanonEventField {
	return (
		typeof value === "string" &&
		(CANON_EVENT_FIELDS as readonly string[]).includes(value)
	);
}

export type CanonEventEditSource = "player" | "rollback";

export function isCanonEventEditSource(
	value: unknown,
): value is CanonEventEditSource {
	return value === "player" || value === "rollback";
}

/** 玩家版话术：一句话是谁说的、说还是想。 */
export interface CanonEventVoiceEdit {
	readonly character: string;
	readonly kind: CanonVoiceKind;
	readonly text: string;
}

/** 每格的取值：文本格是字符串，话术格是数组，原文格是段落数组。 */
export type CanonEventFieldValue =
	| string
	| readonly CanonEventVoiceEdit[]
	| readonly string[];

export interface CanonEventEditRecord {
	readonly id: number;
	readonly storyId: string;
	readonly eventId: number;
	/** 产生这一版的楼层；null 表示对所有分支都可见。 */
	readonly nodeId: string | null;
	readonly field: CanonEventField;
	readonly value: CanonEventFieldValue;
	readonly source: CanonEventEditSource;
	readonly note: string | null;
	readonly createdAt: string;
}

function requiredText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label}不能为空`);
	}
	return value.trim();
}

/** 写入与读取都走这里：校验并按格归一化，拒绝多余字段。 */
export function assertCanonEventFieldValue(
	field: CanonEventField,
	value: unknown,
): CanonEventFieldValue {
	switch (field) {
		case "title":
			return requiredText(value, "标题");
		case "summary":
			return requiredText(value, "概要");
		case "digest":
			if (typeof value !== "string") {
				throw new Error("缩写必须是字符串");
			}
			return value.trim();
		case "voices": {
			if (!Array.isArray(value)) {
				throw new Error("话术必须是数组");
			}
			return value.map((item, index): CanonEventVoiceEdit => {
				const label = `第 ${index + 1} 条话术`;
				if (typeof item !== "object" || item === null) {
					throw new Error(`${label}必须是对象`);
				}
				const record = item as Record<string, unknown>;
				if (!onlyVoiceKeys(record)) {
					throw new Error(`${label}有无法识别的字段`);
				}
				if (record.kind !== "speech" && record.kind !== "thought") {
					throw new Error(`${label}的类型必须是 speech 或 thought`);
				}
				return {
					character: requiredText(record.character, `${label}的人物`),
					kind: record.kind,
					text: requiredText(record.text, `${label}的内容`),
				};
			});
		}
		case "passage": {
			if (!Array.isArray(value)) {
				throw new Error("原文必须是段落数组");
			}
			return value.map((paragraph, index) =>
				requiredText(paragraph, `第 ${index + 1} 段原文`),
			);
		}
	}
}

function onlyVoiceKeys(record: Record<string, unknown>): boolean {
	return Object.keys(record).every(
		(key) => key === "character" || key === "kind" || key === "text",
	);
}
