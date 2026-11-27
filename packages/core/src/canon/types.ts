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
