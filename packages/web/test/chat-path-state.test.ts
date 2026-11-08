import type { StoryPath } from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import {
	type ChatFloor,
	applyLatestPage,
	applyOlderPage,
	canLoadOlder,
	emptyPathState,
	markLoadingOlder,
} from "../src/chat/path-state";

const STORY_ID = "story";

function buildNodes(count: number): readonly ChatFloor[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `n${index}`,
		storyId: STORY_ID,
		parentId: index === 0 ? null : `n${index - 1}`,
		role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
		raw: `楼层 ${index}`,
		createdAt: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
	}));
}

/** 与服务端语义一致：页以锚点结尾，从根一侧裁掉更早的楼层。 */
function pageEndingAt(
	nodes: readonly ChatFloor[],
	index: number,
	limit: number,
): StoryPath {
	const start = Math.max(0, index - limit + 1);
	return {
		storyId: STORY_ID,
		headNodeId: nodes[nodes.length - 1]?.id ?? null,
		nodes: nodes.slice(start, index + 1),
		hasMore: start > 0,
	};
}

describe("聊天路径分页状态", () => {
	it("第一页替换全部状态并保留 head", () => {
		const nodes = buildNodes(3);
		const state = applyLatestPage(emptyPathState(), pageEndingAt(nodes, 2, 60));
		expect(state.nodes.map((node) => node.id)).toEqual(["n0", "n1", "n2"]);
		expect(state.headNodeId).toBe("n2");
		expect(state.hasMore).toBe(false);
	});

	it("2000 楼连续向上加载不重复不丢楼", () => {
		const nodes = buildNodes(2000);
		let state = applyLatestPage(
			emptyPathState(),
			pageEndingAt(nodes, 1999, 60),
		);
		expect(state.nodes).toHaveLength(60);
		expect(state.hasMore).toBe(true);
		let pages = 1;
		while (canLoadOlder(state)) {
			state = markLoadingOlder(state);
			expect(canLoadOlder(state)).toBe(false);
			const oldestId = state.nodes[0]?.id;
			if (oldestId === undefined) throw new Error("缺少最早的楼层");
			const index = nodes.findIndex((node) => node.id === oldestId);
			state = applyOlderPage(state, pageEndingAt(nodes, index, 60));
			pages += 1;
		}
		expect(pages).toBe(Math.ceil(2000 / 59));
		expect(state.nodes).toHaveLength(2000);
		expect(state.nodes[0]?.id).toBe("n0");
		expect(state.nodes[1999]?.id).toBe("n1999");
		expect(new Set(state.nodes.map((node) => node.id)).size).toBe(2000);
		expect(state.hasMore).toBe(false);
		expect(state.loadingOlder).toBe(false);
	});

	it("head 变化后的最新页丢弃旧的向上分页", () => {
		const nodes = buildNodes(120);
		let state = applyLatestPage(emptyPathState(), pageEndingAt(nodes, 119, 60));
		state = applyOlderPage(state, pageEndingAt(nodes, 59, 60));
		expect(state.nodes).toHaveLength(120);
		const base = nodes[50];
		const parent = nodes[49];
		if (base === undefined || parent === undefined)
			throw new Error("夹具缺少楼层");
		const branchHead: ChatFloor = {
			...base,
			id: "branch",
			parentId: parent.id,
		};
		const branchNodes = [...nodes.slice(0, 50), branchHead];
		state = applyLatestPage(state, {
			storyId: STORY_ID,
			headNodeId: branchHead.id,
			nodes: branchNodes,
			hasMore: true,
		});
		expect(state.nodes.at(-1)?.id).toBe("branch");
		expect(state.headNodeId).toBe("branch");
		expect(state.nodes).toHaveLength(51);
	});
});
