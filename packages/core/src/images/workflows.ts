import type { StoryStore } from "../store/story-store.js";
import type { ComfyUiProviderConfig, ImagesConfig } from "./config.js";
import {
	assertComfyUiSlots,
	parseComfyUiWorkflow,
	resolveComfyUiSlots,
} from "./slots.js";
import type { ImageWorkflowRecord } from "./types.js";

export interface ImportImageWorkflowInput {
	readonly name: string;
	readonly workflow: unknown;
	/** 显式插槽；不提供时只采用唯一候选，否则拒绝。 */
	readonly slots?: unknown;
	/** 显式选择 provider；没有提供时要求配置里只有一个 provider。 */
	readonly provider?: string;
}

/** 取导入 workflow 使用的 provider：显式指定优先，否则要求配置里只有一个。 */
export function resolveImageProvider(
	config: ImagesConfig,
	requested?: string,
): ComfyUiProviderConfig {
	if (requested !== undefined) {
		const provider = config.providers.get(requested);
		if (provider === undefined) {
			throw new Error(`没有配置图像 provider：${requested}`);
		}
		return provider;
	}
	if (config.providers.size === 0) {
		throw new Error("没有配置图像 provider，生图功能关闭");
	}
	if (config.providers.size > 1) {
		throw new Error(
			"配置了多个图像 provider，导入 workflow 时必须指定 provider",
		);
	}
	const provider = config.providers.values().next().value;
	if (provider === undefined) {
		throw new Error("没有配置图像 provider，生图功能关闭");
	}
	return provider;
}

/** 解析、校验并保存 workflow；同名导入更新同一行。 */
export function importImageWorkflow(
	store: StoryStore,
	config: ImagesConfig,
	input: ImportImageWorkflowInput,
): ImageWorkflowRecord {
	const provider = resolveImageProvider(config, input.provider);
	const workflow = parseComfyUiWorkflow(input.workflow, "workflow");
	const slots =
		input.slots === undefined
			? resolveComfyUiSlots(workflow)
			: assertComfyUiSlots(workflow, input.slots);
	return store.saveImageWorkflow({
		name: input.name,
		provider: provider.id,
		payload: workflow,
		slots,
	});
}
