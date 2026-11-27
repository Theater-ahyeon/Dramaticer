import type { CanonBookView, CanonChapterKind } from "@dramaticer/protocol";

export const CHAPTER_KIND_LABELS: Readonly<Record<CanonChapterKind, string>> = {
	chapter: "章节",
	prologue: "序章",
	epilogue: "尾声",
	extra: "番外",
};

export const BOOK_STATUS_LABELS: Readonly<
	Record<CanonBookView["status"], string>
> = {
	ready: "已导入",
	extracting: "抽取中",
	extracted: "已抽取",
	failed: "抽取失败",
};

export function formatChars(value: number): string {
	if (value >= 10000) return `${(value / 10000).toFixed(1)} 万字`;
	return `${value} 字`;
}
