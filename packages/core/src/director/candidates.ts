import type { BackgroundJobHandler } from "../background/types.js";
import { requireJobNodeId } from "../background/types.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import { type LedgerEntities, listLedgerEntities } from "../ledger/read.js";
import {
	type LlmClient,
	type LlmMessage,
	NO_CONTINUATION,
} from "../llm/types.js";
import { parseJsonOutputObject } from "../memory/json-output.js";
import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";
import { type DirectorIntensity, renderByIntensity } from "./intensity.js";
import { type ResolvedDirectorBeat, resolveCurrentBeat } from "./plan.js";
import { formatClue, formatRelation } from "./planner.js";

/** 后台任务类型：在间隙里为下一轮准备候选行动与场景变化。 */
export const CANDIDATE_ACTIONS_JOB_KIND = "candidate_actions";

/** 一次调用必须产出的行动条数；场景变化另算一条。 */
export const CANDIDATE_ACTION_COUNT = 4;

/** 候选行动输入的楼层窗口：最近 3 楼原文。 */
export const CANDIDATE_WINDOW_FLOORS = 3;

export const DIRECTOR_CANDIDATE_KINDS = ["action", "scene_change"] as const;

export type DirectorCandidateKind = (typeof DIRECTOR_CANDIDATE_KINDS)[number];

export function isDirectorCandidateKind(
	value: unknown,
): value is DirectorCandidateKind {
	return (
		typeof value === "string" &&
		(DIRECTOR_CANDIDATE_KINDS as readonly string[]).includes(value)
	);
}

/** 某个楼层读出的一条候选；顺序按 `ordinal`。 */
export interface DirectorCandidateAction {
	readonly id: string;
	readonly storyId: string;
	readonly nodeId: string;
	readonly ordinal: number;
	readonly kind: DirectorCandidateKind;
	readonly text: string;
	readonly createdAt: string;
}

export interface NewDirectorCandidateActionInput {
	readonly kind: DirectorCandidateKind;
	readonly text: string;
}

export interface ReplaceDirectorCandidateActionsOptions {
	readonly storyId: string;
	readonly nodeId: string;
	readonly actions: readonly NewDirectorCandidateActionInput[];
	readonly createdAt?: string;
}

/** 模型输出：4 条行动加 1 条场景变化，顺序固定为行动在前。 */
export interface CandidateActions {
	readonly actions: readonly string[];
	readonly sceneChange: string;
}

const SYSTEM_PROMPT = [
	"你是故事的导演，正在为玩家的下一次输入准备选项。",
	"- 只输出一个 JSON 对象，不要解释、前后缀或代码块标记；形如：",
	'{"actions":["…","…","…","…"],"sceneChange":"…"}',
	"- actions 必须正好 4 条，sceneChange 正好 1 条；每条都是非空字符串。",
	"- 五条内容互不重复，也不要复述最近楼层里已经发生的事。",
	"- 每条都以玩家第一人称写一个具体动作或台词，可以点一下直接作为输入发送。",
	"- actions 是玩家可以立刻做出的行动；sceneChange 是切换场景或跳转时间的选项。",
	"- 内容要落在当前拍与未兑现线索上，引用具体的人、物与地点；不要编造输入里没有出现的设定。",
	"- 只输出这些字段，不要加额外字段。",
].join("\n");

export interface CandidateActionsInput {
	readonly nodeId: string;
	readonly storyId: string;
	readonly intensity: DirectorIntensity;
	readonly beat: ResolvedDirectorBeat | null;
	readonly floors: readonly TimelineNode[];
	readonly entities: LedgerEntities;
}

/**
 * 收集候选行动的输入。楼层没有可读原文时返回 null：
 * 没有素材时发出请求只能得到凭空编造的内容。
 */
export function collectCandidateActionsInput(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): CandidateActionsInput | null {
	const node = store.getNode(nodeId);
	if (node === null) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	if (node.storyId !== storyId) {
		throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	const floors = store
		.getPathToNode(nodeId)
		.filter((item) => item.raw.trim().length > 0)
		.slice(-CANDIDATE_WINDOW_FLOORS);
	if (floors.length === 0) return null;
	return {
		nodeId,
		storyId,
		intensity: store.getStorySettings(storyId).directorConfig.intensity,
		beat: resolveCurrentBeat(store, storyId, nodeId),
		floors,
		entities: listLedgerEntities(store, nodeId),
	};
}

/** 把收集到的输入拼成候选行动的共用户消息。 */
export function buildCandidateActionsUserContent(
	input: CandidateActionsInput,
): string {
	const lines: string[] = [`当前强度：${input.intensity}`];
	lines.push(
		renderByIntensity(input.intensity, {
			setup: "只铺垫，给出可直接执行的观察或试探。",
			natural: "自然推进，让行动带来新的信息或关系变化。",
			detonate: "尽快引爆，让行动把冲突推到台面上。",
		}),
	);
	lines.push("", "当前拍：");
	if (input.beat === null) {
		lines.push("没有可推进的拍。");
	} else {
		lines.push(
			`弧线 ${input.beat.arc.id}《${input.beat.arc.title}》/ 序列 ${input.beat.sequence.id}《${input.beat.sequence.title}》/ 节拍 ${input.beat.beat.id}`,
		);
		lines.push(`目标：${input.beat.beat.goal}`);
		lines.push(`起始迹象：${input.beat.beat.entrySigns.join("；")}`);
		lines.push(`契合点：${input.beat.beat.fitPoints.join("；")}`);
		lines.push(`难度：${input.beat.arc.difficulty.toFixed(2)}`);
	}

	lines.push("", "最近楼层的原文：");
	for (const floor of input.floors) {
		lines.push(`<楼层 id="${floor.id}" 角色="${floor.role}">`);
		lines.push(floor.raw);
		lines.push("</楼层>");
	}

	lines.push("", "未兑现线索：");
	if (input.entities.openClues.length === 0) {
		lines.push("无。");
	} else {
		for (const clue of input.entities.openClues) {
			lines.push(formatClue(clue));
		}
	}

	lines.push("", "人物关系：");
	if (input.entities.relations.length === 0) {
		lines.push("无。");
	} else {
		for (const relation of input.entities.relations) {
			lines.push(formatRelation(relation));
		}
	}
	return lines.join("\n");
}

/**
 * 外部输出与模型输出的唯一校验入口：未知字段、条数不符、空字符串与
 * 重复正文整批拒绝，并指出 JSON 路径。
 */
export function parseCandidateActionsResponse(text: string): CandidateActions {
	const object = assertPlainObject(
		parseJsonOutputObject(text, "候选行动"),
		"候选行动",
	);
	rejectUnknownKeys(object, ["actions", "sceneChange"], "候选行动");
	const rawActions = object.actions;
	if (!Array.isArray(rawActions)) {
		throw new Error("候选行动.actions 必须是数组");
	}
	if (rawActions.length !== CANDIDATE_ACTION_COUNT) {
		throw new Error(
			`候选行动.actions 必须正好 ${CANDIDATE_ACTION_COUNT} 条，实际为 ${rawActions.length} 条`,
		);
	}
	const actions = rawActions.map((value, index) =>
		readCandidateText(value, `候选行动.actions[${index}]`),
	);
	const sceneChange = readCandidateText(
		object.sceneChange,
		"候选行动.sceneChange",
	);
	const seen = new Set<string>();
	for (const [index, action] of actions.entries()) {
		if (seen.has(action)) {
			throw new Error(`候选行动.actions[${index}] 与前面的条目重复`);
		}
		seen.add(action);
	}
	if (seen.has(sceneChange)) {
		throw new Error("候选行动.sceneChange 与 actions 里的条目重复");
	}
	return { actions, sceneChange };
}

function readCandidateText(value: unknown, path: string): string {
	if (typeof value !== "string") {
		throw new Error(`${path} 必须是字符串`);
	}
	const text = value.trim();
	if (text.length === 0) {
		throw new Error(`${path} 不能是空字符串`);
	}
	return text;
}

export interface GenerateCandidateActionsOptions {
	readonly store: StoryStore;
	readonly client: LlmClient;
	readonly storyId: string;
	readonly nodeId: string;
	readonly model?: string;
	readonly signal?: AbortSignal;
}

/**
 * 执行一次候选行动生成：收集输入、请求模型、严格校验后在同一事务里
 * 替换该楼层的旧候选。没有素材时返回 null；输出不合法时不写入任何行。
 */
export async function generateCandidateActions(
	options: GenerateCandidateActionsOptions,
): Promise<DirectorCandidateAction[] | null> {
	const input = collectCandidateActionsInput(
		options.store,
		options.storyId,
		options.nodeId,
	);
	if (input === null) return null;
	const messages: LlmMessage[] = [
		{ role: "system", content: SYSTEM_PROMPT },
		{ role: "user", content: buildCandidateActionsUserContent(input) },
	];
	const result = await options.client.complete(
		{
			messages,
			model: options.model,
			temperature: 0,
			...(options.signal === undefined ? {} : { signal: options.signal }),
		},
		NO_CONTINUATION,
	);
	const parsed = parseCandidateActionsResponse(result.text);
	return options.store.replaceDirectorCandidateActions({
		storyId: options.storyId,
		nodeId: options.nodeId,
		actions: [
			...parsed.actions.map((text) => ({ kind: "action" as const, text })),
			{ kind: "scene_change" as const, text: parsed.sceneChange },
		],
	});
}

export interface CandidateActionsHandlerOptions {
	/** 规划器专用客户端；不设置时使用任务上下文里的后台客户端。 */
	readonly client?: LlmClient;
	/** 覆盖客户端默认模型。 */
	readonly model?: string;
}

/** 后台任务处理器的实现。 */
export function createCandidateActionsHandler(
	options: CandidateActionsHandlerOptions = {},
): BackgroundJobHandler {
	return async ({ store, client, job, signal }) => {
		const nodeId = requireJobNodeId(job);
		await generateCandidateActions({
			store,
			client: options.client ?? client,
			storyId: job.storyId,
			nodeId,
			model: options.model,
			signal,
		});
	};
}
