import type {
	CharacterOutfit,
	CharacterVisualProfileRecord,
	ComfyUiSlotCandidates,
	ComfyUiSlotName,
	ComfyUiSlots,
	ComfyUiWorkflow,
	ImageOrganizerAngle,
	ImageOrganizerBody,
	ImageOrganizerCenter,
	ImageOrganizerExposure,
	ImageReplacementRule,
	ImageTrigger,
	ImageWorkflowRecord,
	NodeImageStatus,
	TagLibraryEntry,
	WritingEntry,
} from "@dramaticer/core";

/** 生图后端的状态；不包含密钥值。 */
export interface ImageProviderView {
	readonly id: string;
	readonly api: string;
	readonly baseUrl: string;
	readonly configured: boolean;
	readonly timeoutMs: number;
	readonly pollIntervalMs: number;
}

export interface ImageProvidersView {
	readonly providers: readonly ImageProviderView[];
}

/** `GET /api/stories/:id/visual-profiles` 的载荷；只读。 */
export interface StoryVisualProfilesView {
	readonly storyId: string;
	readonly profiles: readonly CharacterVisualProfileRecord[];
}

/** `POST /api/stories/:id/visual-profiles/generate` 的结果；生成在后台执行。 */
export interface StoryVisualProfileGenerateResult {
	readonly storyId: string;
	readonly jobId: number;
	readonly kind: string;
}

/** `GET/PUT /api/stories/:id/outfits` 的载荷；服装独立于外貌档案。 */
export interface StoryCharacterOutfitsView {
	readonly storyId: string;
	readonly outfits: readonly CharacterOutfit[];
}

/** `GET/PUT /api/stories/:id/image-tags` 的载荷；故事条目与全局条目都返回。 */
export interface StoryTagLibraryView {
	readonly storyId: string;
	readonly entries: readonly TagLibraryEntry[];
}

/** 画面整理的触发频率与提示词后处理配置。 */
export interface StoryImageOrganizerRulesView {
	readonly storyId: string;
	readonly trigger: ImageTrigger;
	readonly recentPromptHistory: number;
	readonly replacementRules: readonly ImageReplacementRule[];
}

/** `POST /api/stories/:id/nodes/:nodeId/organize-images` 的结果；整理在后台执行。 */
export interface StoryImageOrganizeResult {
	readonly storyId: string;
	readonly nodeId: string;
	readonly jobId: number;
	readonly kind: string;
}

/** 画面整理的写作条目；`scope` 固定为 image_organizer。 */
export interface StoryImageOrganizerEntriesView {
	readonly storyId: string;
	readonly entries: readonly WritingEntry[];
}

/** `POST /api/stories/:id/images/import-st` 的请求体。 */
export interface StoryImageImportRequest {
	readonly kind: "characters" | "preset";
	readonly data: unknown;
}

export interface StoryImageImportResult {
	readonly storyId: string;
	readonly profiles: number;
	readonly outfits: number;
	readonly tagEntries: number;
	readonly writingEntries: number;
}

export type ImageWorkflowView = ImageWorkflowRecord;

export interface ImageWorkflowsView {
	readonly workflows: readonly ImageWorkflowView[];
}

/** `POST /api/images/workflows/detect` 的请求体；只识别，不写库。 */
export interface ImageWorkflowDetectRequest {
	readonly workflow: ComfyUiWorkflow;
}

export interface ImageWorkflowDetectionView {
	readonly slots: ComfyUiSlots | null;
	readonly candidates: ComfyUiSlotCandidates;
	readonly unresolved: readonly ComfyUiSlotName[];
}

/** `POST /api/images/workflows/import` 的请求体；同名导入更新同一行。 */
export interface ImageWorkflowImportRequest {
	readonly name: string;
	readonly workflow: ComfyUiWorkflow;
	readonly slots: ComfyUiSlots;
}

/** 楼层上的一张插图；`url` 只在生成完成时给出。 */
export interface NodeImage {
	readonly id: string;
	readonly nodeId: string;
	readonly ordinal: number;
	readonly status: NodeImageStatus;
	readonly url: string | null;
	readonly width: number | null;
	readonly height: number | null;
	readonly error: string | null;
	/** 插在第几段之后；0 表示开头。 */
	readonly insertAfterParagraph: number | null;
	readonly title: string | null;
	readonly prompt: string | null;
	readonly negativePrompt: string | null;
}

/** 画面整理里一个人物的结构化选择；供界面与重绘复用。 */
export interface NodeImageOrganizerCharacter {
	readonly name: string;
	readonly angle: ImageOrganizerAngle;
	readonly body: ImageOrganizerBody;
	readonly exposure: ImageOrganizerExposure;
	readonly outfitName: string | null;
	readonly action: string | null;
	readonly negative: string | null;
	readonly center: ImageOrganizerCenter | null;
}

/** `GET /api/nodes/:id/images` 的载荷。 */
export interface NodeImagesView {
	readonly nodeId: string;
	readonly images: readonly NodeImage[];
}
