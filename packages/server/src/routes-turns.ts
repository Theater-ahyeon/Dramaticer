// server 路由：回合、运行中追加要求、重写与就地纠正、场面控制（refactor/06 从 routes.ts 拆出）。
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type DirectorIntensity,
	type DirectorPush,
	type FeatureSwitchOverrides,
	type RerollReason,
	type SceneControl,
	type SceneControlKind,
	type ScenePace,
	type StorySettings,
	type StoryStore,
	type TimelineNode,
	TurnGuidanceError,
	type TurnMode,
	WRITING_MODE_KEY,
	assertDirectorIntensity,
	assertDirectorPush,
	assertFeatureSwitchOverrides,
	assertRerollReason,
	assertSceneControlKind,
	assertScenePace,
	endSceneAt,
	isJsonObject,
	isPlanWritingMode,
	isTurnMode,
	jumpSceneTime,
	locateCorrectionSpan,
	readSceneSegments,
	rewriteFloorSegment,
	setScenePace,
} from "@dramaticer/core";
import type {
	NodeCorrectResult,
	SceneControlResult,
} from "@dramaticer/protocol";
import { HttpError, readOptionalJsonBody, sendJson } from "./http.js";
import {
	assertKnownKeys,
	fieldError,
	readObjectBody,
	requireNode,
	requireRawText,
	requireStory,
	requireText,
	toBadRequest,
} from "./routes-common.js";
import { buildPath } from "./routes-stories.js";
import type { ApiRouteOptions } from "./routes.js";
import {
	handleRegenerateStream,
	handleRetryStream,
	handleTurnStream,
} from "./turns.js";

export async function handleTurns(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["text", "mode", "intensity", "push", "features"]);
	const text = requireText(body.text, "text");
	rememberWritingMode(options.store, storyId, body.mode);
	await handleTurnStream(res, storyId, text, options, {
		directorIntensity: readOptionalIntensity(body.intensity),
		directorPush: readOptionalPush(body.push),
		turnMode: readOptionalMode(body.mode),
		featureOverrides: readOptionalFeatures(body.features),
	});
}

/** 本轮临时开关：不认识的开关或非法值按 400 拒绝，不悄悄忽略。 */
export function readOptionalFeatures(
	value: unknown,
): FeatureSwitchOverrides | null {
	if (value === undefined || value === null) return null;
	try {
		return assertFeatureSwitchOverrides(value, "features");
	} catch (error) {
		throw new HttpError(
			400,
			"bad_request",
			error instanceof Error ? error.message : String(error),
		);
	}
}

/**
 * 运行中追加要求：只接受属于该故事、仍在运行且句柄还在的深回合。
 * 文本校验与队列上限由 core 的句柄负责，这里只做状态映射。
 */
export async function handleTurnSteering(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
	runId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const run = options.store.getTurnRun(runId);
	if (run === null || run.storyId !== storyId) {
		throw new HttpError(404, "not_found", `运行不存在：${runId}`);
	}
	const active = options.runs.get(runId);
	if (run.status !== "running" || active === null) {
		throw new HttpError(409, "conflict", "运行已经结束，不能再追加要求");
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["text"]);
	if (typeof body.text !== "string") {
		throw fieldError("text", "text 必须是字符串");
	}
	try {
		active.push(body.text);
	} catch (error) {
		if (!(error instanceof TurnGuidanceError)) throw error;
		if (error.reason === "queue_full") {
			throw new HttpError(409, "conflict", error.message);
		}
		throw fieldError("text", error.message);
	}
	sendJson(res, 202, { runId });
}

export function readOptionalMode(value: unknown): TurnMode | null {
	if (value === undefined) return null;
	// 规划写法在存储层是快速回合加一组固定的准备阶段。
	if (value === "plan") return "fast";
	if (!isTurnMode(value)) {
		throw fieldError("mode", "回合的 mode 只接受 fast、plan 或 deep");
	}
	return value;
}

/** 玩家在这一轮选的写法就是之后的写法；程序不自己切换（I6）。 */
export function rememberWritingMode(
	store: StoryStore,
	storyId: string,
	mode: unknown,
): void {
	if (mode === "plan") store.setStoryValue(storyId, WRITING_MODE_KEY, "plan");
	else if (mode === "fast" || mode === "deep") {
		store.setStoryValue(storyId, WRITING_MODE_KEY, null);
	}
}

/** 故事设置里的写法：玩家选了规划时，对界面报告 plan。 */
export function withWritingMode(
	store: StoryStore,
	settings: StorySettings,
): unknown {
	return settings.turnMode === "fast" &&
		isPlanWritingMode(store, settings.storyId)
		? { ...settings, turnMode: "plan" }
		: settings;
}

export function readOptionalIntensity(
	value: unknown,
): DirectorIntensity | null {
	if (value === undefined) return null;
	try {
		return assertDirectorIntensity(value, "回合的 intensity");
	} catch (error) {
		throw fieldError(
			"intensity",
			error instanceof Error ? error.message : "回合的 intensity 不合法",
		);
	}
}

export function readOptionalPush(value: unknown): DirectorPush | null {
	if (value === undefined) return null;
	try {
		return assertDirectorPush(value, "回合的 push");
	} catch (error) {
		throw fieldError(
			"push",
			error instanceof Error ? error.message : "回合的 push 不合法",
		);
	}
}

export async function handleRegenerate(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): Promise<void> {
	const node = requireNode(options.store, nodeId);
	if (node.role !== "assistant") {
		throw fieldError("nodeId", `楼层 ${nodeId} 不是助手楼层，不能重新生成`);
	}
	const body = await readOptionalJsonBody(req, options.maxJsonBodyBytes);
	const reason = readOptionalRerollReason(body);
	await handleRegenerateStream(res, nodeId, options, reason);
}

/**
 * 就地纠正：只重写选中的片段，写成旧楼层的兄弟节点。旧楼层与它的 Trace
 * 原样保留；纠正意见同时写进用户意志。选中的片段必须逐字出现在楼层里
 * 且只出现一次，失败时按 400 拒绝并指出字段。
 */
export async function handleNodeCorrect(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): Promise<void> {
	const node = requireNode(options.store, nodeId);
	if (node.role !== "assistant") {
		throw fieldError("nodeId", `楼层 ${nodeId} 不是助手楼层，不能就地纠正`);
	}
	if (options.runtime === null) {
		throw new HttpError(500, "internal", "服务端没有配置渠道");
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["quote", "instruction"]);
	const quote = requireRawText(body.quote, "quote");
	const instruction = requireText(body.instruction, "instruction");
	try {
		locateCorrectionSpan(node.raw, quote);
	} catch (error) {
		throw fieldError(
			"quote",
			error instanceof Error ? error.message : "选中的片段不合法",
		);
	}
	const runtime = await options.runtime.get(node.storyId);
	const result = await rewriteFloorSegment({
		store: options.store,
		client: runtime.chatClient,
		storyId: node.storyId,
		nodeId: node.id,
		quote,
		instruction,
		model: runtime.modelAlias,
		maxTokens: runtime.maxTokens,
		temperature: runtime.settings.temperature,
	});
	const view: NodeCorrectResult = {
		node: result.node,
		path: buildPath(
			options.store,
			node.storyId,
			options.store.getPathToNode(result.node.id),
		),
		beforeNodeId: result.beforeNodeId,
		replacement: result.replacement,
		willId: result.willId,
	};
	sendJson(res, 201, view);
}

/**
 * 场面控制：结束这一场、跳到某个时间、调整节奏。三种操作都落在当前路径的
 * 助手楼层上；非法载荷在写入任何东西之前拒绝。
 */
export async function handleSceneControl(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): Promise<void> {
	const node = requireNode(options.store, nodeId);
	if (node.role !== "assistant") {
		throw fieldError("nodeId", `楼层 ${nodeId} 不是助手楼层，不能做场面控制`);
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	const kind = readSceneControlKind(body.kind);
	const control = await applySceneControl(options, node, kind, body);
	const head = options.store.getHead(node.storyId);
	const scenes = readSceneSegments(options.store, head?.id ?? control.nodeId);
	const view: SceneControlResult = {
		control,
		scenes,
		directorConfig:
			kind === "pace"
				? options.store.getStorySettings(node.storyId).directorConfig
				: null,
	};
	sendJson(res, 201, view);
}

/** 只读请求体里的 `kind`；未知取值按 400 拒绝。 */
export function readSceneControlKind(value: unknown): SceneControlKind {
	try {
		return assertSceneControlKind(value, "场面控制的 kind");
	} catch (error) {
		throw fieldError(
			"kind",
			error instanceof Error ? error.message : "场面控制的 kind 不合法",
		);
	}
}

export async function applySceneControl(
	options: ApiRouteOptions,
	node: TimelineNode,
	kind: SceneControlKind,
	body: Record<string, unknown>,
): Promise<SceneControl> {
	switch (kind) {
		case "end-scene": {
			assertKnownKeys(body, ["kind", "note"]);
			const note = body.note;
			if (note !== undefined && typeof note !== "string") {
				throw fieldError("note", "note 必须是字符串");
			}
			try {
				return endSceneAt({
					store: options.store,
					storyId: node.storyId,
					nodeId: node.id,
					note: typeof note === "string" ? note : null,
				});
			} catch (error) {
				throw toBadRequest(error, "kind");
			}
		}
		case "jump-time": {
			assertKnownKeys(body, ["kind", "time"]);
			const time = requireText(body.time, "time");
			try {
				const result = await jumpSceneTime({
					store: options.store,
					storyId: node.storyId,
					nodeId: node.id,
					time,
				});
				return result.control;
			} catch (error) {
				throw toBadRequest(error, "time");
			}
		}
		case "pace": {
			assertKnownKeys(body, ["kind", "pace"]);
			let pace: ScenePace;
			try {
				pace = assertScenePace(body.pace, "场面控制的 pace");
			} catch (error) {
				throw toBadRequest(error, "pace");
			}
			try {
				const result = await setScenePace({
					store: options.store,
					storyId: node.storyId,
					nodeId: node.id,
					pace,
				});
				return result.control;
			} catch (error) {
				throw toBadRequest(error, "kind");
			}
		}
	}
}

/** 重 roll 的原因可以省略；给了就必须是已知取值。 */
export function readOptionalRerollReason(body: unknown): RerollReason | null {
	if (body === null) return null;
	if (!isJsonObject(body)) {
		throw fieldError("body", "请求体必须是 JSON 对象");
	}
	assertKnownKeys(body, ["reason"]);
	if (body.reason === undefined) return null;
	try {
		return assertRerollReason(body.reason, "重 roll 的 reason");
	} catch (error) {
		throw fieldError(
			"reason",
			error instanceof Error ? error.message : "重 roll 的 reason 不合法",
		);
	}
}

/** `POST /api/nodes/:id/retry`：只接受用户楼层，可带单轮模式。 */
export async function handleRetry(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): Promise<void> {
	requireNode(options.store, nodeId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["mode"]);
	await handleRetryStream(res, nodeId, options, readOptionalMode(body.mode));
}
