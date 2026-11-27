import type {
	CanonBookRecord,
	CanonChapterKind,
	CanonChapterRecord,
	CanonChapterSummary,
} from "@dramaticer/core";

export type { CanonBookRecord, CanonChapterKind, CanonChapterRecord };

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
