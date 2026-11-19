import { applyRerollReasonWill } from "../preferences/reroll.js";
import type { StoryStore } from "../store/story-store.js";

/**
 * 撤回的楼层上能读到的导演安排所指向的线；决策记在玩家楼层上，
 * 界面传回复楼层时要往上找一层。没有安排时返回 null。
 */
export function readDirectorArrangementLineId(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): string | null {
	const node = store.getNode(nodeId);
	if (node === null) throw new Error(`楼层节点不存在：${nodeId}`);
	if (node.storyId !== storyId) {
		throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	const decision =
		store.getDirectorDecision(nodeId) ??
		(node.parentId === null ? null : store.getDirectorDecision(node.parentId));
	const lineId = decision?.signals.lineId;
	return typeof lineId === "string" && lineId.length > 0 ? lineId : null;
}

export interface DirectorUndoInput {
	readonly store: StoryStore;
	readonly storyId: string;
	/** 玩家点「这不是我要的」的楼层。 */
	readonly nodeId: string;
	readonly lineId: string;
}

export interface DirectorUndoResult {
	readonly lineId: string;
	/** 这次是否新增了一条偏好；同一句已经在路径上时为 false。 */
	readonly preferenceAdded: boolean;
}

/**
 * 撤回一条导演安排：静音那条线，并把「别推这条线」写成长期偏好。
 * 两者在同一个事务里，避免出现静音了却没记下偏好的状态。
 */
export async function undoDirectorArrangement(
	input: DirectorUndoInput,
): Promise<DirectorUndoResult> {
	const { store, storyId, nodeId, lineId } = input;
	const node = store.getNode(nodeId);
	if (node === null) throw new Error(`楼层节点不存在：${nodeId}`);
	if (node.storyId !== storyId) {
		throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	return store.runInTransaction(() => {
		store.muteDirectorLine(storyId, lineId, nodeId);
		const preferenceAdded = applyRerollReasonWill({
			store,
			storyId,
			nodeId,
			sourceNodeId: node.role === "user" ? node.id : (node.parentId ?? node.id),
			dedupeNodeId: nodeId,
			reason: "avoid-line",
			diffReason: "撤回导演安排：别推这条线",
		});
		return { lineId, preferenceAdded };
	});
}
