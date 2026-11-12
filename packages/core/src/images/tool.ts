import type { LlmToolCall } from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";
import type { DeepToolDefinition } from "../tools/registry.js";
import { IMAGE_SHOTS, MAX_IMAGE_PROMPT_CHARACTERS } from "./prompt.js";
import {
	MAX_IMAGE_SCENE_CHARS,
	validateImagePromptRequest,
} from "./request.js";
import type { ImageConfig, ImageMode } from "./types.js";

export const ILLUSTRATE_TOOL_NAME = "illustrate";

const ILLUSTRATE_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		characters: {
			type: "array",
			items: { type: "string", minLength: 1 },
			maxItems: MAX_IMAGE_PROMPT_CHARACTERS,
			description: "画面里的人物名，最多 4 个；名字要与角色卡或台账一致",
		},
		scene: {
			type: "string",
			minLength: 1,
			maxLength: MAX_IMAGE_SCENE_CHARS,
			description: `这一楼要画的场景，一句话，最多 ${MAX_IMAGE_SCENE_CHARS} 个字符`,
		},
		shot: {
			type: "string",
			enum: [...IMAGE_SHOTS],
			description: "镜头：close-up 特写、medium 中景、wide 远景、scenery 风景",
		},
		mood: {
			type: "string",
			minLength: 1,
			description: "画面的气氛，例如 压抑、明亮",
		},
	},
	required: ["scene"],
	additionalProperties: false,
};

export const ILLUSTRATE_TOOL: DeepToolDefinition = {
	name: ILLUSTRATE_TOOL_NAME,
	description:
		"为这一楼登记一张插图。调用只登记，后台在间隙生成；每楼张数与两次出图的最小楼层间隔由故事设置限制。",
	parameters: ILLUSTRATE_SCHEMA,
	permission: "side_effect",
	progressLabel: "准备插图……",
};

/** 回合里处理 illustrate 调用需要的设置；其余字段用于判定工具是否可见。 */
export interface IllustrateTurnOptions extends ImageConfig {
	/** 服务端确认 workflow 的 provider 已经在 images.yaml 里配置。 */
	readonly providerConfigured?: boolean;
	/** 测试注入固定 seed；不提供时随机生成。 */
	readonly seed?: () => number;
}

/** 只有 auto、workflow 存在且 provider 可用时，才把工具发给模型。 */
export function resolveIllustrateTool(
	store: StoryStore,
	options: IllustrateTurnOptions | null | undefined,
): DeepToolDefinition | null {
	if (options === undefined || options === null) return null;
	if (options.mode !== "auto") return null;
	const workflowId = options.workflowId.trim();
	if (workflowId.length === 0) return null;
	if (options.providerConfigured === false) return null;
	if (store.getImageWorkflow(workflowId) === null) return null;
	return ILLUSTRATE_TOOL;
}

export interface IllustrateCallTrace {
	readonly name: string;
	readonly ok: boolean;
	readonly error: string | null;
}

export interface IllustrateCallResult {
	readonly accepted: number;
	readonly rejected: readonly string[];
	readonly calls: readonly IllustrateCallTrace[];
}

export interface ApplyIllustrateCallsInput {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly nodeId: string;
	readonly calls: readonly LlmToolCall[];
	readonly options: IllustrateTurnOptions | null | undefined;
}

/**
 * 在写楼层的同一个事务里处理 illustrate 调用：校验参数与频率，接受的
 * 调用写一条 pending 记录。拒绝只记录原因，不影响楼层保存。
 */
export function applyIllustrateCalls(
	input: ApplyIllustrateCallsInput,
): IllustrateCallResult {
	const calls: IllustrateCallTrace[] = [];
	const rejected: string[] = [];
	let accepted = 0;
	for (const call of input.calls) {
		if (call.name !== ILLUSTRATE_TOOL_NAME) continue;
		const reason = rejectReason(input, call.arguments);
		if (reason !== null) {
			rejected.push(reason);
			calls.push({ name: call.name, ok: false, error: reason });
			continue;
		}
		const options = input.options as IllustrateTurnOptions;
		const request = validateImagePromptRequest(call.arguments);
		input.store.insertNodeImage({
			storyId: input.storyId,
			nodeId: input.nodeId,
			request,
			workflowId: options.workflowId.trim(),
			seed:
				options.seed === undefined
					? Math.floor(Math.random() * 2_147_483_648)
					: options.seed(),
		});
		accepted += 1;
		calls.push({ name: call.name, ok: true, error: null });
	}
	return { accepted, rejected, calls };
}

function rejectReason(
	input: ApplyIllustrateCallsInput,
	argumentsValue: unknown,
): string | null {
	try {
		validateImagePromptRequest(argumentsValue);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	const options = input.options;
	if (options === undefined || options === null) {
		return "故事没有配置生图";
	}
	if (options.mode !== "auto") {
		return `生图模式为 ${describeMode(options.mode)}，只有 auto 接受 illustrate 调用`;
	}
	const workflowId = options.workflowId.trim();
	if (workflowId.length === 0) {
		return "故事没有选择生图 workflow";
	}
	if (input.store.getImageWorkflow(workflowId) === null) {
		return `生图 workflow 不存在：${workflowId}`;
	}
	if (options.providerConfigured === false) {
		return `生图 workflow 的 provider 没有配置：${workflowId}`;
	}
	if (input.store.countNodeImages(input.nodeId) >= options.maxPerFloor) {
		return `本楼已经达到每楼最多 ${options.maxPerFloor} 张的上限`;
	}
	const gap = assistantFloorsSinceLastImage(
		input.store,
		input.storyId,
		input.nodeId,
	);
	if (gap < options.minFloorsBetween) {
		return `与最近一次出图只隔 ${gap} 个助手楼层，至少需要 ${options.minFloorsBetween} 个`;
	}
	return null;
}

function describeMode(mode: ImageMode): string {
	if (mode === "off") return "off（关闭）";
	return "manual（手动）";
}

/** 当前楼层与最近一次出图之间隔了多少个助手楼层；没有历史图片时不受限。 */
function assistantFloorsSinceLastImage(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): number {
	const path = store.getPathToHead(storyId);
	const currentIndex = path.findIndex((node) => node.id === nodeId);
	if (currentIndex === -1) {
		throw new Error(`楼层 ${nodeId} 不在当前 head 路径上`);
	}
	const imageNodes = new Set(store.listNodeImageNodeIds(storyId));
	let lastImageIndex = -1;
	for (let index = currentIndex; index >= 0; index -= 1) {
		if (imageNodes.has(path[index]?.id as string)) {
			lastImageIndex = index;
			break;
		}
	}
	if (lastImageIndex === -1) return Number.POSITIVE_INFINITY;
	let count = 0;
	for (let index = lastImageIndex + 1; index < currentIndex; index += 1) {
		if (path[index]?.role === "assistant") count += 1;
	}
	return count;
}
