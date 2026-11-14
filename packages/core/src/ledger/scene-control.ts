import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import type { StorySettings } from "../store/settings.js";
import type { StoryStore } from "../store/story-store.js";
import type { StateDiff } from "../timeline.js";
import { validateLedgerDiff } from "./schema.js";

/** 玩家在游玩页能直接做的三种场面控制。 */
export const SCENE_CONTROL_KINDS = ["end-scene", "jump-time", "pace"] as const;

export type SceneControlKind = (typeof SCENE_CONTROL_KINDS)[number];

export const SCENE_CONTROL_LABELS: Readonly<Record<SceneControlKind, string>> =
	{
		"end-scene": "结束这一场",
		"jump-time": "跳到某个时间",
		pace: "调整节奏",
	};

/** 节奏三档；值直接写进导演配置的 `pace`。 */
export const SCENE_PACE_STEPS = ["slow", "normal", "fast"] as const;

export type ScenePace = (typeof SCENE_PACE_STEPS)[number];

export const SCENE_PACE_LABELS: Readonly<Record<ScenePace, string>> = {
	slow: "放慢",
	normal: "照常",
	fast: "加快",
};

/** 三档对应的 `DirectorConfig.pace`；越小进入冲突所需楼层越多。 */
export const SCENE_PACE_VALUES: Readonly<Record<ScenePace, number>> = {
	slow: 0.6,
	normal: 1,
	fast: 1.6,
};

export interface EndScenePayload {
	readonly note: string | null;
}

export interface JumpTimePayload {
	readonly time: string;
}

export interface PacePayload {
	readonly pace: ScenePace;
}

export type SceneControlPayload =
	| EndScenePayload
	| JumpTimePayload
	| PacePayload;

/** 一个楼层上的一条场面控制记录；同一楼层同一操作只留一条。 */
export interface SceneControl {
	readonly nodeId: string;
	readonly storyId: string;
	readonly kind: SceneControlKind;
	readonly payload: SceneControlPayload;
	readonly createdAt: string;
}

export interface NewSceneControl {
	readonly nodeId: string;
	readonly storyId: string;
	readonly kind: SceneControlKind;
	readonly payload: SceneControlPayload;
	readonly createdAt?: string;
}

export function isSceneControlKind(value: unknown): value is SceneControlKind {
	return (
		typeof value === "string" &&
		(SCENE_CONTROL_KINDS as readonly string[]).includes(value)
	);
}

export function assertSceneControlKind(
	value: unknown,
	label = "场面控制的种类",
): SceneControlKind {
	if (!isSceneControlKind(value)) {
		throw new Error(
			`${label}只能是 ${SCENE_CONTROL_KINDS.join("、")}，收到 ${JSON.stringify(value)}`,
		);
	}
	return value;
}

export function isScenePace(value: unknown): value is ScenePace {
	return (
		typeof value === "string" &&
		(SCENE_PACE_STEPS as readonly string[]).includes(value)
	);
}

export function assertScenePace(value: unknown, label = "节奏档位"): ScenePace {
	if (!isScenePace(value)) {
		throw new Error(
			`${label}只能是 ${SCENE_PACE_STEPS.join("、")}，收到 ${JSON.stringify(value)}`,
		);
	}
	return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label}必须是非空字符串`);
	}
	return value.trim();
}

/** 按种类校验载荷；未知字段与错误取值都指出字段路径。 */
export function assertSceneControlPayload(
	kind: SceneControlKind,
	value: unknown,
	label = "场面控制的载荷",
): SceneControlPayload {
	const record = assertPlainObject(value, label);
	switch (kind) {
		case "end-scene": {
			rejectUnknownKeys(record, ["note"], label);
			const note = record.note;
			if (note !== null && note !== undefined && typeof note !== "string") {
				throw new Error(`${label}.note 必须是字符串或 null`);
			}
			const text = typeof note === "string" ? note.trim() : "";
			return { note: text.length === 0 ? null : text };
		}
		case "jump-time":
			rejectUnknownKeys(record, ["time"], label);
			return { time: requireNonEmptyString(record.time, `${label}.time`) };
		case "pace":
			rejectUnknownKeys(record, ["pace"], label);
			return { pace: assertScenePace(record.pace, `${label}.pace`) };
	}
}

/** 场面控制只落在当前路径的助手楼层上。 */
function requireSceneControlFloor(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): void {
	if (!store.getStory(storyId)) {
		throw new Error(`故事不存在：${storyId}`);
	}
	const node = store.getNode(nodeId);
	if (node === null) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	if (node.storyId !== storyId) {
		throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	if (node.role !== "assistant") {
		throw new Error(`场面控制只能落在助手楼层上：${nodeId}`);
	}
	const head = store.getHead(storyId);
	if (head === null) {
		throw new Error(`故事 ${storyId} 还没有楼层`);
	}
	if (!store.getPathToNode(head.id).some((item) => item.id === nodeId)) {
		throw new Error(`楼层 ${nodeId} 不在当前路径上`);
	}
}

export interface EndSceneInput {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly nodeId: string;
	readonly note?: string | null;
	readonly createdAt?: string;
}

/**
 * 玩家把当前这一场的边界落在本楼：写一条场面控制记录，
 * 场次派生把这一楼当作这一场最后一楼，原文与场记都不改。
 */
export function endSceneAt(input: EndSceneInput): SceneControl {
	requireSceneControlFloor(input.store, input.storyId, input.nodeId);
	const payload = assertSceneControlPayload(
		"end-scene",
		{ note: input.note ?? null },
		"结束这一场的载荷",
	);
	return input.store.saveSceneControl({
		nodeId: input.nodeId,
		storyId: input.storyId,
		kind: "end-scene",
		payload,
		...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
	});
}

export interface JumpSceneTimeInput {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly nodeId: string;
	readonly time: string;
	readonly createdAt?: string;
}

/**
 * 跳到某个时间：写一条来源为玩家的 `time.current` 事实，再记一条场面控制。
 * 两次写入在同一个事务里，时间锚点与记录不会只写一半。
 */
export async function jumpSceneTime(
	input: JumpSceneTimeInput,
): Promise<{ readonly control: SceneControl; readonly diff: StateDiff }> {
	requireSceneControlFloor(input.store, input.storyId, input.nodeId);
	const time = requireNonEmptyString(input.time, "跳到的时间");
	validateLedgerDiff({
		path: ["time", "current"],
		op: "set",
		value: time,
		source: "player",
	});
	const payload = assertSceneControlPayload(
		"jump-time",
		{ time },
		"跳到某个时间的载荷",
	);
	return input.store.runInTransaction(() => {
		const [diff] = input.store.appendStateDiffs([
			{
				storyId: input.storyId,
				nodeId: input.nodeId,
				path: ["time", "current"],
				op: "set",
				value: time,
				source: "player",
				reason: "玩家跳到这个时间",
			},
		]);
		if (diff === undefined) {
			throw new Error("故事时间锚点写入失败");
		}
		const control = input.store.saveSceneControl({
			nodeId: input.nodeId,
			storyId: input.storyId,
			kind: "jump-time",
			payload,
			...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
		});
		return { control, diff };
	});
}

export interface SetScenePaceInput {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly nodeId: string;
	readonly pace: ScenePace;
	readonly createdAt?: string;
}

/**
 * 调整节奏：把三档换成导演配置里的 `pace`，并记一条场面控制。
 * 节奏状态机与线引擎都读这个值，下一轮开始生效。
 */
export async function setScenePace(input: SetScenePaceInput): Promise<{
	readonly control: SceneControl;
	readonly settings: StorySettings;
}> {
	requireSceneControlFloor(input.store, input.storyId, input.nodeId);
	const pace = assertScenePace(input.pace);
	const payload = assertSceneControlPayload("pace", { pace }, "调整节奏的载荷");
	return input.store.runInTransaction(() => {
		const current = input.store.getStorySettings(input.storyId);
		const settings = input.store.updateStorySettings(input.storyId, {
			directorConfig: {
				...current.directorConfig,
				pace: SCENE_PACE_VALUES[pace],
			},
		});
		const control = input.store.saveSceneControl({
			nodeId: input.nodeId,
			storyId: input.storyId,
			kind: "pace",
			payload,
			...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
		});
		return { control, settings };
	});
}
