import type { StoryTree, StoryTreeNode } from "@dramaticer/protocol";

/** 楼层树的一行。线性楼层不缩进，只有分叉之后的子树缩进一层。 */
export interface BranchRow {
	readonly node: StoryTreeNode;
	readonly depth: number;
	readonly onPath: boolean;
	readonly isHead: boolean;
	readonly collapsed: boolean;
	/** 折叠时被藏起来的子孙数量。 */
	readonly hiddenDescendants: number;
}

export interface BranchTreeInput {
	readonly tree: StoryTree;
	readonly pathNodeIds: ReadonlySet<string>;
	readonly collapsed: ReadonlySet<string>;
}

/** 缩进的层数上限：更深的嵌套仍然可见，只是不再继续往右推。 */
export const MAX_BRANCH_INDENT = 8;

/** 路径分页每页最多取的楼层数，与服务端 `PATH_MAX_LIMIT` 一致。 */
export const PATH_PAGE_LIMIT = 200;

/** 路径分页的保护上限，避免服务端连不上时无限循环。 */
export const MAX_PATH_PAGES = 500;

export interface PathPageLike {
	readonly nodes: readonly { readonly id: string }[];
	readonly hasMore: boolean;
}

/**
 * 按深度优先展开楼层树。上一级只有一个子节点时不缩进，
 * 这样线性长对话不会形成一条越走越靠右的斜线。
 */
export function buildBranchRows(input: BranchTreeInput): readonly BranchRow[] {
	const byId = new Map<string, StoryTreeNode>();
	for (const node of input.tree.nodes) {
		if (byId.has(node.id)) {
			throw new Error(`楼层树里出现重复节点：${node.id}`);
		}
		byId.set(node.id, node);
	}
	const sizes = new Map<string, number>();
	const subtreeSize = (nodeId: string): number => {
		const cached = sizes.get(nodeId);
		if (cached !== undefined) return cached;
		const node = requireNode(byId, nodeId);
		let size = 1;
		for (const childId of node.childIds) {
			size += subtreeSize(childId);
		}
		sizes.set(nodeId, size);
		return size;
	};
	const rows: BranchRow[] = [];
	const visiting = new Set<string>();
	const walk = (nodeId: string, depth: number): void => {
		if (visiting.has(nodeId)) {
			throw new Error(`楼层树里出现环：${nodeId}`);
		}
		const node = requireNode(byId, nodeId);
		visiting.add(nodeId);
		const collapsed = node.childIds.length > 0 && input.collapsed.has(node.id);
		rows.push({
			node,
			depth: Math.min(depth, MAX_BRANCH_INDENT),
			onPath: input.pathNodeIds.has(node.id),
			isHead: input.tree.headNodeId === node.id,
			collapsed,
			hiddenDescendants: collapsed ? subtreeSize(node.id) - 1 : 0,
		});
		if (!collapsed) {
			const branchDepth = node.childIds.length > 1 ? depth + 1 : depth;
			for (const childId of node.childIds) {
				walk(childId, branchDepth);
			}
		}
		visiting.delete(nodeId);
	};
	for (const rootId of input.tree.roots) {
		walk(rootId, 0);
	}
	return rows;
}

export function toggleCollapsed(
	collapsed: ReadonlySet<string>,
	nodeId: string,
): ReadonlySet<string> {
	const next = new Set(collapsed);
	if (next.has(nodeId)) next.delete(nodeId);
	else next.add(nodeId);
	return next;
}

/** 只保留有子节点的节点，收起后不留下无用的折叠状态。 */
export function pruneCollapsed(
	collapsed: ReadonlySet<string>,
	tree: StoryTree,
): ReadonlySet<string> {
	const parents = new Set<string>();
	for (const node of tree.nodes) {
		if (node.childIds.length > 0) parents.add(node.id);
	}
	return new Set([...collapsed].filter((nodeId) => parents.has(nodeId)));
}

/**
 * 逐页读取从根到 head 的全部楼层 id。`fetchPage(undefined)` 取最新一页，
 * 之后用上一页最早的楼层作为 `before` 继续向上。
 */
export async function collectPathNodeIds(
	fetchPage: (before: string | undefined) => Promise<PathPageLike>,
	maxPages: number = MAX_PATH_PAGES,
): Promise<readonly string[]> {
	const pages: string[][] = [];
	let before: string | undefined;
	for (let page = 0; page < maxPages; page += 1) {
		const result = await fetchPage(before);
		if (result.nodes.length === 0) {
			if (result.hasMore) {
				throw new Error("路径分页返回空页却声明还有更早楼层");
			}
			return pages.reverse().flat();
		}
		pages.push(result.nodes.map((node) => node.id));
		if (!result.hasMore) return pages.reverse().flat();
		const oldest = result.nodes[0]?.id;
		if (oldest === undefined || oldest === before) {
			throw new Error("路径分页没有向前推进");
		}
		before = oldest;
	}
	throw new Error(`路径分页超过 ${maxPages} 页`);
}

/**
 * 切换 head 之前要说清后果：其他分支的楼层保留，未确认的末端会变成
 * 一条可以随时切回的分支。目标就是当前 head 时返回 null。
 */
export function describeHeadSwitch(
	node: StoryTreeNode,
	tree: StoryTree,
): string | null {
	if (tree.headNodeId === node.id) return null;
	const head = tree.nodes.find((item) => item.id === tree.headNodeId) ?? null;
	const parts = [
		"切换后，下一回合从所选楼层继续；其他分支的楼层都保留在树里，可以随时切回。",
	];
	if (node.childIds.length === 0) {
		parts.push("所选楼层还没有后续楼层，切换后它成为故事的新末端。");
	} else {
		parts.push("所选楼层已经有后续楼层，它们不会参与新的当前路径。");
	}
	if (head !== null && head.childIds.length === 0) {
		parts.push("当前末端楼层还没有后续楼层，切换后它保留为一条分支。");
	}
	return parts.join("");
}

function requireNode(
	byId: ReadonlyMap<string, StoryTreeNode>,
	nodeId: string,
): StoryTreeNode {
	const node = byId.get(nodeId);
	if (node === undefined) {
		throw new Error(`楼层树里缺少节点：${nodeId}`);
	}
	return node;
}
