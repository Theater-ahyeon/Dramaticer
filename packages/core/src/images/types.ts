import type { ComfyUiSlots, ComfyUiWorkflow } from "./slots.js";

/** 保存在数据库里的 workflow 模板；`payload` 是原始 API 格式 JSON。 */
export interface ImageWorkflowRecord {
	readonly id: string;
	readonly name: string;
	readonly provider: string;
	readonly payload: ComfyUiWorkflow;
	readonly slots: ComfyUiSlots;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface SaveImageWorkflowInput {
	readonly name: string;
	readonly provider: string;
	readonly payload: ComfyUiWorkflow;
	readonly slots: ComfyUiSlots;
}

/** 删除仍被图片记录引用的 workflow。 */
export class ImageWorkflowInUseError extends Error {
	readonly workflowId: string;
	readonly imageCount: number;

	constructor(workflowId: string, imageCount: number) {
		super(
			`图片 workflow ${workflowId} 仍被 ${imageCount} 条图片记录引用，不能删除`,
		);
		this.name = "ImageWorkflowInUseError";
		this.workflowId = workflowId;
		this.imageCount = imageCount;
	}
}
