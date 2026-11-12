import type { StoryStore } from "../store/story-store.js";
import type { AssembledContext } from "./assembler.js";
import {
	CONTEXT_PACK_VERSION,
	type ContextPack,
	type ContextPackPayload,
} from "./pack-format.js";

export interface SaveContextPackInput {
	readonly storyId: string;
	readonly nodeId: string;
	readonly fingerprint: string;
	readonly assembled: AssembledContext;
}

/** 把一次组装的结果与引用打包写进玩家楼层；同一楼层覆盖同一行。 */
export function saveContextPack(
	store: StoryStore,
	input: SaveContextPackInput,
): ContextPack {
	const diffCount = store.countStateDiffsAlongPath(input.nodeId);
	const payload: ContextPackPayload = {
		version: CONTEXT_PACK_VERSION,
		fingerprint: input.fingerprint,
		assembled: input.assembled,
		references: {
			loreEntryIds: input.assembled.references.loreEntryIds,
			sceneAnalysisNodeId: input.assembled.references.sceneAnalysisNodeId,
			retrievalNodeIds: input.assembled.references.retrievalNodeIds,
			ledgerSnapshot: { nodeId: input.nodeId, diffCount },
		},
	};
	return store.saveContextPack({
		nodeId: input.nodeId,
		storyId: input.storyId,
		payload,
	});
}

/**
 * 读取可复用的上下文包。以下任一情况视为不存在：楼层不属于该故事、
 * 指纹不一致、引用的世界书条目被删、引用的现场分析不在当前 head 路径上、
 * 检索引用的楼层不在参照楼层的路径上。
 */
export function loadReusableContextPack(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	fingerprint: string,
): AssembledContext | null {
	const pack = store.getContextPack(nodeId);
	if (pack === null) return null;
	if (pack.storyId !== storyId) return null;
	const payload = pack.payload;
	if (payload.fingerprint !== fingerprint) return null;
	const references = payload.references;
	if (references.ledgerSnapshot.nodeId !== nodeId) return null;

	const existingLoreIds = new Set(
		store.listLoreEntries(storyId).map((entry) => entry.id),
	);
	if (
		references.loreEntryIds.some((entryId) => !existingLoreIds.has(entryId))
	) {
		return null;
	}

	const pathIds = new Set(store.getPathToNode(nodeId).map((node) => node.id));
	if (
		references.retrievalNodeIds.some((referenced) => !pathIds.has(referenced))
	) {
		return null;
	}

	if (references.sceneAnalysisNodeId !== null) {
		const head = store.getHead(storyId);
		const headPathIds = new Set(
			(head === null ? [] : store.getPathToNode(head.id)).map(
				(node) => node.id,
			),
		);
		if (!headPathIds.has(references.sceneAnalysisNodeId)) return null;
		if (store.getSceneAnalysis(references.sceneAnalysisNodeId) === null) {
			return null;
		}
	}

	return payload.assembled;
}
