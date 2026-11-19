import { type PlayerEdit, readEffectiveEdits } from "../edits/index.js";
import { isJsonObject } from "../json.js";
import type { StoryStore } from "../store/story-store.js";
import { type SceneCard, assertSceneCard } from "./scene-log.js";
import { type SceneSegment, readSceneSegments } from "./scenes.js";

/** 本场目标由谁写下：场记，还是玩家。 */
export type SceneGoalSource = "player" | "ai";

/** 当前这一场的场面卡：场记写下的那张，叠上玩家在这条路径上的修改。 */
export interface SceneGoal extends SceneCard {
	/** 这一场开始的楼层；修改记录挂在这个楼层上。 */
	readonly nodeId: string;
	readonly source: SceneGoalSource;
	readonly locked: boolean;
}

function currentScene(store: StoryStore, nodeId: string): SceneSegment | null {
	const segments = readSceneSegments(store, nodeId);
	const matching = segments.filter((segment) =>
		segment.floorIds.includes(nodeId),
	);
	return matching.at(-1) ?? segments.at(-1) ?? null;
}

/**
 * 当前这一场的本场目标。玩家的修改按这一场开始的楼层挂记录，换一场后
 * 自动不再生效；分支隔离与其它修改一样按当前路径累加。
 */
export function readSceneGoal(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): SceneGoal | null {
	const segment = currentScene(store, nodeId);
	if (segment === null) return null;
	const edit =
		readEffectiveEdits(store, storyId, nodeId, "scene").get(
			segment.startNodeId,
		) ?? null;
	if (edit?.disabled === true) return null;
	const value = isJsonObject(edit?.value) ? edit.value : null;
	let card: SceneCard | null = null;
	if (value !== null) {
		card = assertSceneCard(value, "本场目标的修改");
	} else {
		for (const id of segment.floorIds) {
			const stored = store.getSceneLog(id)?.sceneCard ?? null;
			if (stored !== null) {
				card = stored;
				break;
			}
		}
	}
	if (card === null) return null;
	return {
		...card,
		nodeId: segment.startNodeId,
		source: value === null ? "ai" : "player",
		locked: edit?.locked === true,
	};
}

/** 玩家直接改本场目标：校验后写入一条修改并默认锁定。 */
export function editSceneGoal(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	card: SceneCard,
	options: { readonly locked?: boolean } = {},
): PlayerEdit {
	const segment = currentScene(store, nodeId);
	if (segment === null) {
		throw new Error(`故事 ${storyId} 还没有助手楼层，无法设置本场目标`);
	}
	const parsed = assertSceneCard(card, "本场目标");
	return store.savePlayerEdit({
		storyId,
		nodeId,
		kind: "scene",
		target: segment.startNodeId,
		value: JSON.parse(JSON.stringify(parsed)),
		locked: options.locked ?? true,
		source: "player",
	});
}
