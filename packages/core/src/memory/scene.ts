import {
	BackgroundJobDeferredError,
	type BackgroundJobHandler,
	requireJobNodeId,
} from "../background/types.js";
import type { LlmMessage } from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";
import { createTokenEstimator } from "../tokens.js";

export const SCENE_JOB_KIND = "scene";

/** 现场分析读取的最近楼层数；默认 6。 */
export const SCENE_WINDOW_FLOORS = 6;

/** 现场分析的输出上限，按 token 估算器与请求上限同时控制。 */
export const DEFAULT_SCENE_MAX_TOKENS = 200;

/** 一个楼层的现场分析；与楼层绑定，同一楼层只有一行。 */
export interface SceneAnalysis {
	readonly nodeId: string;
	readonly storyId: string;
	readonly text: string;
	readonly tokenCount: number;
	readonly createdAt: string;
}

export interface NewSceneAnalysis {
	readonly nodeId: string;
	readonly storyId: string;
	readonly text: string;
	readonly tokenCount: number;
	readonly createdAt?: string;
}

export interface SceneHandlerOptions {
	/** 读取的最近楼层数；默认 6。 */
	readonly windowFloors?: number;
	/** 分析的 token 上限，同时作为请求的 maxTokens；默认 200。 */
	readonly maxTokens?: number;
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型（settler 角色）。 */
	readonly model?: string;
}

const SYSTEM_PROMPT = [
	"你是故事的现场分析师。阅读台账快照与最近楼层的原文，写一小段现场分析。",
	"- 写明在场人物各自此刻想要什么、各自知道什么、彼此之间的张力在哪里。",
	"- 只写台账快照与原文里有的内容，不要编造人物、地点或事件，不要提出后续剧情建议。",
	"- 直接输出一段纯文本，不要 JSON、标题、列表标记或代码块。",
	"- 控制在两百字以内。",
].join("\n");

const SCENE_TOKEN_ESTIMATOR = createTokenEstimator();

/** 把一段现场分析正文写进楼层；空正文直接拒绝。 */
export function saveSceneAnalysisText(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	text: string,
): void {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		throw new Error("现场分析返回了空内容");
	}
	store.saveSceneAnalysis({
		nodeId,
		storyId,
		text: trimmed,
		tokenCount: SCENE_TOKEN_ESTIMATOR(trimmed),
	});
}

/**
 * 现场分析的后台任务：处理一个已结算的助手楼层。
 * 楼层的台账结算还没完成时任务退回 pending，等结算完成后再执行。
 */
export function createSceneHandler(
	options: SceneHandlerOptions = {},
): BackgroundJobHandler {
	const windowFloors = options.windowFloors ?? SCENE_WINDOW_FLOORS;
	if (!Number.isInteger(windowFloors) || windowFloors < 1) {
		throw new Error("现场分析的楼层窗口必须是正整数");
	}
	const maxTokens = options.maxTokens ?? DEFAULT_SCENE_MAX_TOKENS;
	if (!Number.isInteger(maxTokens) || maxTokens < 1) {
		throw new Error("现场分析的 token 上限必须是正整数");
	}
	return async ({ store, client, job }) => {
		const nodeId = requireJobNodeId(job);
		if (store.getLedgerSettlement(nodeId) === null) {
			throw new BackgroundJobDeferredError();
		}
		const path = store.getPathToNode(nodeId);
		const floors = path
			.slice(-windowFloors)
			.filter((node) => node.raw.trim().length > 0);
		if (floors.length === 0) return;
		const { state } = store.getStateSnapshot(nodeId);
		const messages: LlmMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: buildUserContent(state, floors) },
		];
		const result = await client.complete({
			messages,
			model: options.model,
			temperature: 0,
			maxTokens,
		});
		saveSceneAnalysisText(store, job.storyId, nodeId, result.text);
	};
}

function buildUserContent(
	state: unknown,
	floors: readonly TimelineNode[],
): string {
	const lines = [
		"当前台账快照（截至要分析的楼层）：",
		JSON.stringify(state),
		"",
		"最近楼层的原文：",
	];
	for (const node of floors) {
		lines.push(`<楼层 id="${node.id}" 角色="${node.role}">`);
		lines.push(node.raw);
		lines.push("</楼层>");
	}
	return lines.join("\n");
}
