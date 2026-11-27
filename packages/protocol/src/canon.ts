import type {
	CanonBookRecord,
	CanonChapterExtractionRecord,
	CanonChapterKind,
	CanonChapterRecord,
	CanonChapterSummary,
	CanonEntityRecord,
	CanonEventRecord,
	CanonExtractionEstimate,
	CanonExtractionRecord,
	CanonFactRecord,
	CanonVoiceRecord,
} from "@dramaticer/core";

export type {
	CanonBookRecord,
	CanonChapterExtractionRecord,
	CanonChapterKind,
	CanonChapterRecord,
	CanonEntityRecord,
	CanonEventRecord,
	CanonExtractionEstimate,
	CanonExtractionRecord,
	CanonFactRecord,
	CanonVoiceRecord,
};

/** 原著书：书名、编码、总字数、章数与状态。 */
export type CanonBookView = CanonBookRecord;

/** 分章列表不带原文；读一章原文走 `/chapters/:chapterId`。 */
export type CanonChapterView = CanonChapterSummary;

export interface CanonBooksView {
	readonly books: readonly CanonBookView[];
}

export interface CanonBookDetailView {
	readonly book: CanonBookView;
	readonly chapters: readonly CanonChapterView[];
}

/** 导入 txt：给 base64 字节，或者已经解码好的文本（二选一）。 */
export interface ImportCanonBookRequest {
	readonly title?: string;
	readonly filename?: string;
	readonly dataBase64?: string;
	readonly text?: string;
}

export interface ImportCanonBookResult {
	readonly book: CanonBookView;
	readonly chapters: readonly CanonChapterView[];
}

export interface CanonChapterDetailView {
	readonly chapter: CanonChapterRecord;
}

export interface CanonChapterUpdateRequest {
	readonly title?: string;
	readonly kind?: CanonChapterKind;
}

export interface CanonChapterSplitRequest {
	/** 前半保留的段落数；后半从这一段开始。 */
	readonly paragraphIndex: number;
}

/** 预估页：章、字、块、token 与费用；玩家确认后才开始抽取。 */
export type CanonEstimateView = CanonExtractionEstimate;

export type CanonExtractionProgressView = CanonExtractionRecord;

export interface CanonExtractionChapterView {
	readonly chapter: CanonChapterSummary;
	readonly extraction: CanonChapterExtractionRecord | null;
}

/** 抽取进度与已抽出的内容；`?chapterId=` 收窄到一章。 */
export interface CanonExtractionView {
	readonly extraction: CanonExtractionRecord;
	readonly chapters: readonly CanonExtractionChapterView[];
	readonly events: readonly CanonEventRecord[];
	readonly voices: readonly CanonVoiceRecord[];
	readonly facts: readonly CanonFactRecord[];
	readonly entities: readonly CanonEntityRecord[];
}

export interface CanonChapterExtractRequest {
	/** resume 只补没完成的块（默认）；full 清掉这一章旧结果整章重抽。 */
	readonly mode?: "resume" | "full";
}

export interface CanonExtractionOverviewEntry {
	readonly book: CanonBookRecord;
	readonly extraction: CanonExtractionRecord | null;
}

/** 检视器的原著抽取总览；一次性导入，不计入每楼后台预算。 */
export interface CanonExtractionOverviewView {
	readonly books: readonly CanonExtractionOverviewEntry[];
}
