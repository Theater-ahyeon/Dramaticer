import type { StoryStore } from "../store/story-store.js";

/** 导演开或关时，玩家用这两种原因重写的次数与占比。 */
export interface DirectorInterferenceGroup {
	/** 这一组里生成过的回复楼层数。 */
	readonly floors: number;
	/** 「没听我的」的次数。 */
	readonly ignoredInstruction: number;
	/** 「别推这条线」的次数。 */
	readonly avoidLine: number;
	/** 两种原因合计占回复楼层的比例；没有楼层时为 0。 */
	readonly ratio: number;
}

export interface DirectorInterferenceStats {
	readonly storyId: string;
	/** 导演评估过的楼层（留有决策记录）。 */
	readonly directorOn: DirectorInterferenceGroup;
	/** 导演关闭时生成的楼层（没有决策记录）。 */
	readonly directorOff: DirectorInterferenceGroup;
}

/**
 * 干扰统计：重写原因里的「没听我的」「别推这条线」按导演是否参与分两组。
 * 导演是否参与看被放弃的回复所接的玩家楼层上有没有决策记录。
 */
export function readDirectorInterferenceStats(
	store: StoryStore,
	storyId: string,
): DirectorInterferenceStats {
	if (!store.getStory(storyId)) throw new Error(`故事不存在：${storyId}`);
	const nodes = store.listStoryNodes(storyId);
	const byId = new Map(nodes.map((node) => [node.id, node] as const));
	const directed = (assistantId: string): boolean => {
		const node = byId.get(assistantId);
		if (node === undefined) return false;
		if (store.getDirectorDecision(node.id) !== null) return true;
		return (
			node.parentId !== null &&
			store.getDirectorDecision(node.parentId) !== null
		);
	};
	const counts = {
		on: { floors: 0, ignoredInstruction: 0, avoidLine: 0 },
		off: { floors: 0, ignoredInstruction: 0, avoidLine: 0 },
	};
	for (const node of nodes) {
		if (node.role !== "assistant") continue;
		counts[directed(node.id) ? "on" : "off"].floors += 1;
	}
	for (const event of store.listPreferenceEvents(storyId, { kind: "swipe" })) {
		const payload = event.payload as {
			abandonedNodeId: string;
			reason?: string;
		};
		const group = counts[directed(payload.abandonedNodeId) ? "on" : "off"];
		if (payload.reason === "ignored-instruction") group.ignoredInstruction += 1;
		if (payload.reason === "avoid-line") group.avoidLine += 1;
	}
	const finish = (group: typeof counts.on): DirectorInterferenceGroup => ({
		...group,
		ratio:
			group.floors === 0
				? 0
				: (group.ignoredInstruction + group.avoidLine) / group.floors,
	});
	return {
		storyId,
		directorOn: finish(counts.on),
		directorOff: finish(counts.off),
	};
}
