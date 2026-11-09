import type {
	CharacterVisualProfileRecord,
	ComfyUiSlotCandidates,
	ComfyUiSlotName,
	ComfyUiSlots,
	ComfyUiWorkflow,
	ImageWorkflowRecord,
	NodeImageStatus,
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
}

/** `GET /api/nodes/:id/images` 的载荷。 */
export interface NodeImagesView {
	readonly nodeId: string;
	readonly images: readonly NodeImage[];
}
