import type { StoryPath } from "@dramaticer/protocol";

export type ChatFloor = StoryPath["nodes"][number];

/** 聊天页持有的路径与分页状态；页面把服务端返回的每一页归并进来。 */
export interface ChatPathState {
	readonly nodes: readonly ChatFloor[];
	readonly headNodeId: string | null;
	readonly hasMore: boolean;
	readonly loadingOlder: boolean;
}

export function emptyPathState(): ChatPathState {
	return { nodes: [], headNodeId: null, hasMore: false, loadingOlder: false };
}

/** 最新一页替换全部楼层：head 变化后旧的向上分页不再属于当前路径。 */
export function applyLatestPage(
	state: ChatPathState,
	page: StoryPath,
): ChatPathState {
	return {
		nodes: page.nodes,
		headNodeId: page.headNodeId,
		hasMore: page.hasMore,
		loadingOlder: false,
	};
}

/**
 * 把更早的一页拼到当前楼层前面。服务端返回的页以上一页最早的楼层结尾，
 * 归并时按 id 去重，页面之间既不重复也不丢楼层。
 */
export function applyOlderPage(
	state: ChatPathState,
	page: StoryPath,
): ChatPathState {
	const seen = new Set(state.nodes.map((node) => node.id));
	const older = page.nodes.filter((node) => !seen.has(node.id));
	return {
		nodes: [...older, ...state.nodes],
		headNodeId: state.headNodeId,
		hasMore: page.hasMore,
		loadingOlder: false,
	};
}

export function markLoadingOlder(state: ChatPathState): ChatPathState {
	return { ...state, loadingOlder: true };
}

/** 当前页之上还有楼层，且已经在取上一页时不再重复请求。 */
export function canLoadOlder(state: ChatPathState): boolean {
	return state.hasMore && !state.loadingOlder && state.headNodeId !== null;
}
