import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";

/** 一场的楼层数上限；到上限强制切一场。 */
export const DEFAULT_MAX_SCENE_FLOORS = 12;

/** 场次结束的原因：场记判定，或楼层数达到上限。 */
export const SCENE_BOUNDARIES = ["scene-ends", "max-floors"] as const;
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

/**
 * 按路径顺序把助手楼层切成场次。场记判定结束的楼层收尾这一场；没有判定时
 * 数到 `maxSceneFloors` 个助手楼层强制收尾。消息楼层不计数，也不单独开场。
 */
export function deriveSceneSegments(
	floors: readonly Pick<TimelineNode, "id" | "role">[],
	sceneEnds: (nodeId: string) => boolean,
	maxSceneFloors: number,
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
	"getNode" | "getPathToNode" | "getSceneLog"
>;

/** 读出节点所在路径的场次划分；场记没有记录过的楼层按未结束处理。 */
export function readSceneSegments(
	store: ScenePathSource,
	nodeId: string,
	maxSceneFloors = DEFAULT_MAX_SCENE_FLOORS,
): readonly SceneSegment[] {
	if (!store.getNode(nodeId)) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	const path = store.getPathToNode(nodeId);
	return deriveSceneSegments(
		path,
		(id) => store.getSceneLog(id)?.sceneEnds === true,
		maxSceneFloors,
	);
}
