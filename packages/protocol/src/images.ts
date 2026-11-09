import type {
	ComfyUiSlotCandidates,
	ComfyUiSlotName,
	ComfyUiSlots,
	ComfyUiWorkflow,
	ImageWorkflowRecord,
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
