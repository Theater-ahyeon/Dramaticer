import type { StoryStore } from "../store/story-store.js";
import type {
	ImageProviderApi,
	ImageProviderConfig,
	ImagesConfig,
} from "./config.js";
import { assertNovelAiParameters } from "./novelai-params.js";
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

/**
 * 取模板使用的 provider：显式指定优先，否则要求（同一种后端里）只配置了一个。
 * `api` 限定后端种类：导入 ComfyUI workflow 时只在 comfyui 里找。
 */
export function resolveImageProvider(
	config: ImagesConfig,
	requested?: string,
	api?: ImageProviderApi,
): ImageProviderConfig {
	if (requested !== undefined) {
		const provider = config.providers.get(requested);
		if (provider === undefined) {
			throw new Error(`没有配置图像 provider：${requested}`);
		}
		if (api !== undefined && provider.api !== api) {
			throw new Error(
				`图像 provider ${requested} 是 ${provider.api}，不是 ${api}`,
			);
		}
		return provider;
	}
	const candidates = [...config.providers.values()].filter(
		(provider) => api === undefined || provider.api === api,
	);
	if (candidates.length === 0) {
		throw new Error(
			api === undefined
				? "没有配置图像 provider，生图功能关闭"
				: `没有配置 ${api} 图像 provider`,
		);
	}
	if (candidates.length > 1) {
		throw new Error("配置了多个图像 provider，必须指定 provider");
	}
	return candidates[0] as ImageProviderConfig;
}

/** 解析、校验并保存 workflow；同名导入更新同一行。 */
export function importImageWorkflow(
	store: StoryStore,
	config: ImagesConfig,
	input: ImportImageWorkflowInput,
): ImageWorkflowRecord {
	const provider = resolveImageProvider(config, input.provider, "comfyui");
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

export interface SaveNovelAiTemplateInput {
	readonly name: string;
	/** 缺省字段取默认值。 */
	readonly parameters?: unknown;
	readonly provider?: string;
}

/** 保存 NovelAI 出图模板；同名保存更新同一行。 */
export function saveNovelAiTemplate(
	store: StoryStore,
	config: ImagesConfig,
	input: SaveNovelAiTemplateInput,
): ImageWorkflowRecord {
	const provider = resolveImageProvider(config, input.provider, "novelai");
	return store.saveImageWorkflow({
		kind: "novelai",
		name: input.name,
		provider: provider.id,
		payload: assertNovelAiParameters(input.parameters ?? {}, "parameters"),
	});
}
