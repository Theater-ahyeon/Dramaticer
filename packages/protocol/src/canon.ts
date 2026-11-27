import type {
	CanonBookRecord,
	CanonChapterExtractionRecord,
	CanonChapterKind,
	CanonChapterRecord,
	CanonChapterSummary,
	CanonCompilationRecord,
	CanonCompiledEntityRecord,
	CanonCursorRecord,
	CanonEntityRecord,
	CanonEventRecord,
	CanonExtractionEstimate,
	CanonExtractionRecord,
	CanonFactRecord,
	CanonIdentityKind,
	CanonPackage,
	CanonPlayerPage,
	CanonStartingPage,
	CanonStoryBindingRecord,
	CanonVoiceRecord,
	CanonWorldIndex,
} from "@dramaticer/core";
import type { ImportStoryRequest, StoryView } from "./story.js";

export type {
	CanonBookRecord,
	CanonChapterExtractionRecord,
	CanonChapterKind,
	CanonChapterRecord,
	CanonCompilationRecord,
	CanonCompiledEntityRecord,
	CanonCursorRecord,
	CanonEntityRecord,
	CanonEventRecord,
	CanonExtractionEstimate,
	CanonExtractionRecord,
	CanonFactRecord,
	CanonIdentityKind,
	CanonPlayerPage,
	CanonStartingPage,
	CanonStoryBindingRecord,
	CanonVoiceRecord,
	CanonWorldIndex,
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
	readonly compilation: CanonCompilationRecord | null;
}

/** 检视器的原著抽取总览；一次性导入，不计入每楼后台预算。 */
export interface CanonExtractionOverviewView {
	readonly books: readonly CanonExtractionOverviewEntry[];
}

/** 全书汇编的结果：实体页、事件轨道与话术；带截止章节时附防剧透切片预览。 */
export interface CanonCompiledView {
	readonly compilation: CanonCompilationRecord;
	readonly entities: readonly CanonCompiledEntityRecord[];
	readonly events: readonly CanonEventRecord[];
	readonly voices: readonly CanonVoiceRecord[];
	readonly facts: readonly CanonFactRecord[];
	/** 只有 `?upToChapter=` 时生成。 */
	readonly pages: readonly CanonStartingPage[] | null;
	readonly worldIndex: CanonWorldIndex | null;
}

/** 原著故事包的 JSON；导入前由 core 校验。 */
export type CanonPackageView = CanonPackage;

export interface ImportCanonPackageRequest {
	readonly package: CanonPackage;
}

export interface ImportCanonPackageResult {
	readonly book: CanonBookView;
	readonly chapters: readonly CanonChapterView[];
}

/** 故事当前绑定的原著；未绑定时外层返回 `{ bound: null }`。 */
export interface StoryCanonBindingView {
	readonly storyId: string;
	readonly bookId: string;
	readonly bookTitle: string;
	readonly startEventId: number;
	readonly startEventTitle: string;
	readonly startChapterOrdinal: number;
	readonly identityKind: CanonIdentityKind;
	readonly playerEntityName: string;
	/** 扮演原著人物时的开局切片；自创人物为 null。 */
	readonly playerPage: CanonPlayerPage | null;
	readonly allowFullBookSpoilers: boolean;
	readonly createdAt: string;
	/** 当前楼层的游标；没有楼层时为最近一次写入的游标。 */
	readonly cursor: CanonCursorRecord | null;
}

export interface StoryCanonView {
	readonly bound: StoryCanonBindingView | null;
}

/** 一步完成：建故事、装原著、可选叠加一张角色卡。 */
export interface StartCanonStoryRequest {
	readonly title?: string;
	readonly bookId: string;
	readonly startEventId?: number;
	readonly identityKind: CanonIdentityKind;
	readonly playerName: string;
	/** 自创人物的人设；扮演原著人物时忽略。 */
	readonly persona?: string;
	readonly card?: ImportStoryRequest["card"];
	readonly worlds?: readonly string[];
}

export interface StartCanonStoryResult {
	readonly story: StoryView;
	readonly canon: StoryCanonBindingView;
	readonly cardName: string | null;
}
