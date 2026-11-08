import type { StoryTree, StoryTreeNode } from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import {
	MAX_BRANCH_INDENT,
	type PathPageLike,
	buildBranchRows,
	collectPathNodeIds,
	describeHeadSwitch,
	pruneCollapsed,
	toggleCollapsed,
} from "../src/chat/branch-tree";

const CREATED_AT = "2026-11-08T10:00:00.000Z";

function node(
	id: string,
	parentId: string | null,
	childIds: readonly string[] = [],
	role: "user" | "assistant" = "assistant",
): StoryTreeNode {
	return {
		id,
		parentId,
		role,
		createdAt: CREATED_AT,
		preview: `预览 ${id}`,
		childIds,
	};
}

function storyTree(
	nodes: readonly StoryTreeNode[],
	roots: readonly string[],
	headNodeId: string | null,
): StoryTree {
	return { storyId: "story-1", headNodeId, roots, nodes };
}

/** 一条主路径加一条从 a1 分出的支线。 */
const BRANCHED = storyTree(
	[
		node("u1", null, ["a1"], "user"),
		node("a1", "u1", ["u2a", "u2b"]),
		node("u2a", "a1", ["a2a"], "user"),
		node("a2a", "u2a"),
		node("u2b", "a1", ["a2b"], "user"),
		node("a2b", "u2b"),
	],
	["u1"],
	"a2a",
);

const MAIN_PATH = new Set(["u1", "a1", "u2a", "a2a"]);

describe("楼层树展开", () => {
	it("按深度优先顺序给行，线性楼层不缩进，分叉后的子树缩进一层", () => {
		const rows = buildBranchRows({
			tree: BRANCHED,
			pathNodeIds: MAIN_PATH,
			collapsed: new Set(),
		});
		expect(rows.map((row) => row.node.id)).toEqual([
			"u1",
			"a1",
			"u2a",
			"a2a",
			"u2b",
			"a2b",
		]);
		expect(rows.map((row) => row.depth)).toEqual([0, 0, 1, 1, 1, 1]);
	});

	it("标记当前路径与 head，支线不标记", () => {
		const rows = buildBranchRows({
			tree: BRANCHED,
			pathNodeIds: MAIN_PATH,
			collapsed: new Set(),
		});
		const flags = rows.map(
			(row) => `${row.node.id}:${row.onPath}:${row.isHead}`,
		);
		expect(flags).toEqual([
			"u1:true:false",
			"a1:true:false",
			"u2a:true:false",
			"a2a:true:true",
			"u2b:false:false",
			"a2b:false:false",
		]);
	});

	it("收起的节点藏起全部子孙并计数", () => {
		const rows = buildBranchRows({
			tree: BRANCHED,
			pathNodeIds: MAIN_PATH,
			collapsed: new Set(["a1"]),
		});
		expect(rows.map((row) => row.node.id)).toEqual(["u1", "a1"]);
		expect(rows[1]?.collapsed).toBe(true);
		expect(rows[1]?.hiddenDescendants).toBe(4);
	});

	it("收起中间节点只藏它的子树", () => {
		const rows = buildBranchRows({
			tree: BRANCHED,
			pathNodeIds: MAIN_PATH,
			collapsed: new Set(["u2a"]),
		});
		expect(rows.map((row) => row.node.id)).toEqual([
			"u1",
			"a1",
			"u2a",
			"u2b",
			"a2b",
		]);
		expect(rows[2]?.hiddenDescendants).toBe(1);
	});

	it("嵌套的分支只缩进到上限", () => {
		const nodes: StoryTreeNode[] = [];
		const levels = MAX_BRANCH_INDENT + 3;
		for (let level = 0; level <= levels; level += 1) {
			const id = `main-${level}`;
			const childIds =
				level === levels ? [] : [`main-${level + 1}`, `off-${level}`];
			nodes.push(node(id, level === 0 ? null : `main-${level - 1}`, childIds));
			if (level < levels) nodes.push(node(`off-${level}`, id));
		}
		const rows = buildBranchRows({
			tree: storyTree(nodes, ["main-0"], `main-${levels}`),
			pathNodeIds: new Set(),
			collapsed: new Set(),
		});
		expect(rows.at(-1)?.node.id).toBe("off-0");
		expect(Math.max(...rows.map((row) => row.depth))).toBe(MAX_BRANCH_INDENT);
	});

	it("缺少子节点或出现环时直接失败", () => {
		const missing = storyTree([node("a", null, ["ghost"])], ["a"], "a");
		expect(() =>
			buildBranchRows({
				tree: missing,
				pathNodeIds: new Set(),
				collapsed: new Set(),
			}),
		).toThrow(/缺少节点/);

		const cyclic = storyTree(
			[node("a", null, ["b"]), node("b", "a", ["a"])],
			["a"],
			"a",
		);
		expect(() =>
			buildBranchRows({
				tree: cyclic,
				pathNodeIds: new Set(),
				collapsed: new Set(),
			}),
		).toThrow(/环/);
	});
});

describe("折叠状态", () => {
	it("切换不修改原来的集合", () => {
		const before = new Set<string>(["a1"]);
		const after = toggleCollapsed(before, "a1");
		expect([...before]).toEqual(["a1"]);
		expect([...after]).toEqual([]);
		const added = toggleCollapsed(before, "u2a");
		expect([...added].sort()).toEqual(["a1", "u2a"]);
	});

	it("清理后只留下还有子节点的楼层", () => {
		const pruned = pruneCollapsed(new Set(["a1", "a2a", "u2b"]), BRANCHED);
		expect([...pruned].sort()).toEqual(["a1", "u2b"]);
	});
});

describe("完整路径读取", () => {
	it("从最新一页向上取完，结果保持根到 head 的顺序", async () => {
		const pages: Record<string, PathPageLike> = {
			start: { nodes: [{ id: "n40" }, { id: "n41" }], hasMore: true },
			n40: { nodes: [{ id: "n38" }, { id: "n39" }], hasMore: true },
			n38: { nodes: [{ id: "n0" }], hasMore: false },
		};
		const asked: (string | undefined)[] = [];
		const ids = await collectPathNodeIds(async (before) => {
			asked.push(before);
			const page = pages[before ?? "start"];
			if (page === undefined) throw new Error(`没有这一页：${String(before)}`);
			return page;
		});
		expect(asked).toEqual([undefined, "n40", "n38"]);
		expect(ids).toEqual(["n0", "n38", "n39", "n40", "n41"]);
	});

	it("空页却声明还有更早楼层时直接失败", async () => {
		await expect(
			collectPathNodeIds(async () => ({ nodes: [], hasMore: true })),
		).rejects.toThrow(/空页/);
	});

	it("超过页数上限时直接失败", async () => {
		let counter = 0;
		await expect(
			collectPathNodeIds(async () => {
				const page = counter;
				counter += 1;
				return { nodes: [{ id: `n-${page}` }], hasMore: true };
			}, 3),
		).rejects.toThrow(/超过 3 页/);
	});
});

describe("切换 head 的提示", () => {
	it("目标就是当前 head 时不提示", () => {
		expect(describeHeadSwitch(requireNode("a2a"), BRANCHED)).toBeNull();
	});

	it("切到有后续楼层的支线时说明其他楼层保留", () => {
		const text = describeHeadSwitch(requireNode("u2a"), BRANCHED);
		expect(text).toContain("其他分支的楼层都保留");
		expect(text).toContain("已经有后续楼层");
	});

	it("切到末端楼层时说明它成为新末端，并提醒当前末端保留", () => {
		const text = describeHeadSwitch(requireNode("a2b"), BRANCHED);
		expect(text).toContain("所选楼层还没有后续楼层");
		expect(text).toContain("当前末端楼层还没有后续楼层");
	});
});

function requireNode(id: string): StoryTreeNode {
	const found = BRANCHED.nodes.find((node) => node.id === id);
	if (found === undefined) throw new Error(`测试数据缺少节点：${id}`);
	return found;
}
