import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	type StoryStore,
	type TimelineNode,
	applyStateDiffs,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function appendNode(
	store: StoryStore,
	id: string,
	parentId: string | null,
	role: "system" | "user" | "assistant" = "assistant",
): TimelineNode {
	return store.appendNode({
		id,
		storyId: "s1",
		parentId,
		role,
		raw: `楼层 ${id}`,
	});
}

function snapshotRowCount(path: string): Map<string, number> {
	const raw = new Database(path);
	const rows = raw
		.prepare(
			"SELECT node_id, COUNT(*) AS count FROM state_snapshots GROUP BY node_id",
		)
		.all() as { readonly node_id: string; readonly count: number }[];
	raw.close();
	return new Map(rows.map((row) => [row.node_id, row.count]));
}

function createRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 2 ** 32;
		return state / 2 ** 32;
	};
}

describe("状态快照缓存", () => {
	it("首次读取时由父快照叠加本楼层 diff，并写入缓存", () => {
		const { store, path } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const root = appendNode(store, "n-root", null, "system");
		const child = appendNode(store, "n-child", root.id);
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: root.id,
				path: ["时间"],
				op: "set",
				value: "黎明",
				source: "test",
			},
			{
				storyId: "s1",
				nodeId: child.id,
				path: ["场景", "地点"],
				op: "set",
				value: "山门",
				source: "test",
			},
		]);

		const snapshot = store.getStateSnapshot(child.id);
		expect(snapshot.nodeId).toBe(child.id);
		expect(snapshot.storyId).toBe("s1");
		expect(snapshot.state).toEqual({ 时间: "黎明", 场景: { 地点: "山门" } });
		expect(snapshot.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(snapshotRowCount(path)).toEqual(
			new Map([
				[root.id, 1],
				[child.id, 1],
			]),
		);
	});

	it("随机分支树上快照与逐条 diff 回放完全一致", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "随机" });
		const random = createRandom(20261107);
		const paths: readonly (readonly string[])[] = [
			["生命"],
			["时间"],
			["场景", "地点"],
			["场景", "标签"],
			["角色", "卫宫", "好感度"],
			["角色", "凛", "好感度"],
			["背包", "物品"],
		];
		const values: readonly unknown[] = [
			0,
			12,
			"山门",
			true,
			null,
			{ 标签: ["夜", "雨"] },
			[1, 2, 3],
		];
		const nodes: TimelineNode[] = [];
		for (let index = 0; index < 40; index += 1) {
			const parent =
				index === 0
					? null
					: (nodes[Math.floor(random() * index)] as TimelineNode);
			const node = appendNode(store, `n-${index}`, parent?.id ?? null);
			nodes.push(node);
			const diffCount = Math.floor(random() * 4);
			for (let step = 0; step < diffCount; step += 1) {
				const path = paths[Math.floor(random() * paths.length)] as string[];
				if (random() < 0.3) {
					store.appendStateDiff({
						storyId: "s1",
						nodeId: node.id,
						path,
						op: "delete",
						source: "test",
					});
					continue;
				}
				const value = values[Math.floor(random() * values.length)];
				store.appendStateDiff({
					storyId: "s1",
					nodeId: node.id,
					path,
					op: "set",
					value,
					source: "test",
				});
			}
		}

		for (const node of nodes) {
			const expected = applyStateDiffs(store.getStateDiffsAlongPath(node.id));
			expect(store.getStateSnapshot(node.id).state, node.id).toEqual(expected);
			expect(store.countStateDiffsAlongPath(node.id)).toBe(
				store.getStateDiffsAlongPath(node.id).length,
			);
		}
	});

	it("同一节点第二次读取直接命中缓存", () => {
		const { store, path } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const node = appendNode(store, "n-1", null);
		store.appendStateDiff({
			storyId: "s1",
			nodeId: node.id,
			path: ["生命"],
			op: "set",
			value: 100,
			source: "test",
		});

		const first = store.getStateSnapshot(node.id);
		const raw = new Database(path);
		raw
			.prepare("UPDATE state_snapshots SET computed_at = ? WHERE node_id = ?")
			.run("2000-01-01T00:00:00.000Z", node.id);
		raw.close();

		const second = store.getStateSnapshot(node.id);
		expect(second.computedAt).toBe("2000-01-01T00:00:00.000Z");
		expect(second.state).toEqual(first.state);
	});

	it("追加 diff 后该楼层与全部后代的缓存失效，兄弟分支保留", () => {
		const { store, path } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const root = appendNode(store, "n-root", null, "system");
		const branchA = appendNode(store, "n-a", root.id);
		const descendant = appendNode(store, "n-a-child", branchA.id);
		const branchB = appendNode(store, "n-b", root.id);

		store.getStateSnapshot(descendant.id);
		store.getStateSnapshot(branchB.id);
		expect(snapshotRowCount(path).size).toBe(4);

		store.appendStateDiff({
			storyId: "s1",
			nodeId: branchA.id,
			path: ["生命"],
			op: "set",
			value: 80,
			source: "test",
		});
		expect(snapshotRowCount(path)).toEqual(
			new Map([
				[root.id, 1],
				[branchB.id, 1],
			]),
		);

		const snapshot = store.getStateSnapshot(descendant.id);
		expect(snapshot.state).toEqual({ 生命: 80 });
		expect(snapshotRowCount(path).size).toBe(4);
	});

	it("不同分支的快照互不影响", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const root = appendNode(store, "n-root", null, "system");
		const branchA = appendNode(store, "n-a", root.id);
		const branchB = appendNode(store, "n-b", root.id);
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: root.id,
				path: ["角色", "卫宫"],
				op: "set",
				value: { 好感度: 0 },
				source: "test",
			},
			{
				storyId: "s1",
				nodeId: branchA.id,
				path: ["场景"],
				op: "set",
				value: "山门",
				source: "test",
			},
			{
				storyId: "s1",
				nodeId: branchB.id,
				path: ["场景"],
				op: "set",
				value: "庭院",
				source: "test",
			},
		]);

		expect(store.getStateSnapshot(branchA.id).state).toEqual({
			角色: { 卫宫: { 好感度: 0 } },
			场景: "山门",
		});
		expect(store.getStateSnapshot(branchB.id).state).toEqual({
			角色: { 卫宫: { 好感度: 0 } },
			场景: "庭院",
		});
	});

	it("删除型 diff 与 __proto__ 路径在快照中保持一致", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const root = appendNode(store, "n-root", null, "system");
		const child = appendNode(store, "n-child", root.id);
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: root.id,
				path: ["__proto__", "polluted"],
				op: "set",
				value: true,
				source: "test",
			},
			{
				storyId: "s1",
				nodeId: root.id,
				path: ["场景"],
				op: "set",
				value: "山门",
				source: "test",
			},
			{
				storyId: "s1",
				nodeId: child.id,
				path: ["场景"],
				op: "delete",
				source: "test",
			},
			{
				storyId: "s1",
				nodeId: child.id,
				path: ["角色", "卫宫", "好感度"],
				op: "set",
				value: 5,
				source: "test",
			},
		]);

		const snapshot = store.getStateSnapshot(child.id);
		expect(Object.hasOwn(snapshot.state, "__proto__")).toBe(true);
		expect(Object.hasOwn(snapshot.state, "场景")).toBe(false);
		expect(snapshot.state.角色).toEqual({ 卫宫: { 好感度: 5 } });
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(snapshot.state).toEqual(
			applyStateDiffs(store.getStateDiffsAlongPath(child.id)),
		);
	});

	it("head 入口读取当前分支，切换分支后返回对应状态", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		expect(store.getStateSnapshotAtHead("s1")).toBeNull();

		const root = appendNode(store, "n-root", null, "system");
		store.appendStateDiff({
			storyId: "s1",
			nodeId: root.id,
			path: ["时间"],
			op: "set",
			value: "黄昏",
			source: "test",
		});
		const oldBranch = appendNode(store, "n-old", root.id);
		store.appendStateDiff({
			storyId: "s1",
			nodeId: oldBranch.id,
			path: ["场景"],
			op: "set",
			value: "旧庭院",
			source: "test",
		});
		const head = appendNode(store, "n-head", root.id);
		store.appendStateDiff({
			storyId: "s1",
			nodeId: head.id,
			path: ["场景"],
			op: "set",
			value: "新庭院",
			source: "test",
		});

		expect(store.getStateSnapshotAtHead("s1")?.state).toEqual({
			时间: "黄昏",
			场景: "新庭院",
		});
		store.setHead("s1", oldBranch.id);
		expect(store.getStateSnapshotAtHead("s1")?.state).toEqual({
			时间: "黄昏",
			场景: "旧庭院",
		});
		expect(store.getStateSnapshotAtHead("s1")?.nodeId).toBe(oldBranch.id);
	});

	it("缺失楼层与缺失故事抛错", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		expect(() => store.getStateSnapshot("missing")).toThrow(
			/楼层节点不存在：missing/,
		);
		expect(() => store.countStateDiffsAlongPath("missing")).toThrow(
			/楼层节点不存在：missing/,
		);
		expect(() => store.getStateSnapshotAtHead("missing")).toThrow(
			/故事不存在：missing/,
		);
	});
});
