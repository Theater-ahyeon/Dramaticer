import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";

/** 一场的楼层数上限；到上限强制切一场。 */
export const DEFAULT_MAX_SCENE_FLOORS = 12;

/** 场次结束的原因：场记判定、楼层数达到上限，或玩家直接结束这一场。 */
export const SCENE_BOUNDARIES = [
	"scene-ends",
	"max-floors",
	"player-ends",
] as const;
export type SceneBoundary = (typeof SCENE_BOUNDARIES)[number];

export function isSceneBoundary(value: unknown): value is SceneBoundary {
	return (
		typeof value === "string" &&
		(SCENE_BOUNDARIES as readonly string[]).includes(value)
	);
}

/** 路径上的一场的派生区间；`endNodeId` 为 null 表示这一场还没有结束。 */
export interface SceneSegment {
	/** 这一场第一个助手楼层。 */
	readonly startNodeId: string;
	/** 这一场最后一个助手楼层；没有结束时为 null。 */
	readonly endNodeId: string | null;
	/** 这一场覆盖的助手楼层，按路径顺序。 */
	readonly floorIds: readonly string[];
	readonly boundary: SceneBoundary | null;
}

export function assertMaxSceneFloors(value: number, label: string): number {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${label}必须是正整数`);
	}
	return value;
}

/** 场次结束原因的中文说法；三个来源共用一套措辞。 */
export const SCENE_BOUNDARY_LABELS: Readonly<Record<SceneBoundary, string>> = {
	"scene-ends": "场记判定结束",
	"max-floors": "达到楼层上限",
	"player-ends": "玩家结束这一场",
};

/**
 * 按路径顺序把助手楼层切成场次。场记判定结束的楼层收尾这一场；玩家直接
 * 结束这一场时同样收尾，并记下是玩家结束的；都没有时数到
 * `maxSceneFloors` 个助手楼层强制收尾。消息楼层不计数，也不单独开场。
 */
export function deriveSceneSegments(
	floors: readonly Pick<TimelineNode, "id" | "role">[],
	sceneEnds: (nodeId: string) => boolean,
	maxSceneFloors: number,
	playerEnds: (nodeId: string) => boolean = () => false,
): readonly SceneSegment[] {
	assertMaxSceneFloors(maxSceneFloors, "场次的楼层数上限");
	const scenes: SceneSegment[] = [];
	let start: string | null = null;
	let ids: string[] = [];
	let end: string | null = null;
	let boundary: SceneBoundary | null = null;
	const close = (): void => {
		if (start === null || end === null || boundary === null) return;
		scenes.push({
			startNodeId: start,
			endNodeId: end,
			floorIds: [...ids],
			boundary,
		});
		start = null;
		ids = [];
		end = null;
		boundary = null;
	};
	for (const node of floors) {
		if (node.role !== "assistant") continue;
		if (start === null) start = node.id;
		ids.push(node.id);
		end = null;
		boundary = null;
		if (sceneEnds(node.id)) {
			end = node.id;
			boundary = "scene-ends";
			close();
			continue;
		}
		if (playerEnds(node.id)) {
			end = node.id;
			boundary = "player-ends";
			close();
			continue;
		}
		if (ids.length >= maxSceneFloors) {
			end = node.id;
			boundary = "max-floors";
			close();
		}
	}
	if (start !== null) {
		scenes.push({
			startNodeId: start,
			endNodeId: null,
			floorIds: [...ids],
			boundary: null,
		});
	}
	return scenes;
}

export type ScenePathSource = Pick<
	StoryStore,
	"getNode" | "getPathToNode" | "getSceneLog" | "listSceneControlKindsOnPath"
>;

/**
 * 读出节点所在路径的场次划分；场记没有记录过的楼层按未结束处理。
 * 玩家结束这一场的记录与场记判定同等对待，两者同时出现时按场记判定。
 */
export function readSceneSegments(
	store: ScenePathSource,
	nodeId: string,
	maxSceneFloors = DEFAULT_MAX_SCENE_FLOORS,
): readonly SceneSegment[] {
	if (!store.getNode(nodeId)) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	const path = store.getPathToNode(nodeId);
	const playerEnds = store.listSceneControlKindsOnPath(nodeId, "end-scene");
	return deriveSceneSegments(
		path,
		(id) => store.getSceneLog(id)?.sceneEnds === true,
		maxSceneFloors,
		(id) => playerEnds.has(id),
	);
}
