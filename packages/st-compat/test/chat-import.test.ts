import { fileURLToPath } from "node:url";
import { type StateDiff, StoryStore } from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import type { JsonObject, JsonValue } from "../src/index.js";
import {
	importChatFileToStore,
	importChatToStore,
	isJsonObject,
	parseChatJsonl,
} from "../src/index.js";

const fixturePath = fileURLToPath(
	new URL("./fixtures/chat-import.jsonl", import.meta.url),
);

const first: JsonObject = {
	stat_data: { hp: 100, mood: "平静" },
	flags: [],
};
const second: JsonObject = {
	stat_data: { hp: 90 },
	flags: ["战斗"],
};
const mainSwipe: JsonObject = {
	stat_data: { hp: 80, mood: "受伤" },
	flags: ["战斗"],
	loot: { item: "剑", n: 2 },
};
const otherSwipe: JsonObject = {
	stat_data: { hp: 95 },
	flags: ["战斗"],
};
const last: JsonObject = {
	stat_data: { hp: 70 },
	flags: [],
	meta: { turn: 2, tags: ["a", "b"] },
};

function openStore(): StoryStore {
	const store = StoryStore.open(":memory:");
	onTestFinished(() => store.close());
	return store;
}

function replay(diffs: readonly StateDiff[]): JsonObject {
	const root: JsonObject = {};
	for (const diff of diffs) {
		let parent = root;
		for (const key of diff.path.slice(0, -1)) {
			const child = parent[key];
			if (child === undefined) {
				const created: JsonObject = {};
				parent[key] = created;
				parent = created;
				continue;
			}
			if (!isJsonObject(child)) {
				throw new Error(`路径 ${diff.path.join(".")} 的父级不是对象`);
			}
			parent = child;
		}
		const leaf = diff.path[diff.path.length - 1];
		if (leaf === undefined) {
			throw new Error("状态 diff 的路径为空");
		}
		if (diff.op === "set") {
			parent[leaf] = diff.value as JsonValue;
		} else {
			delete parent[leaf];
		}
	}
	return root;
}

function snapshotAt(store: StoryStore, nodeId: string): JsonObject {
	return replay(store.getStateDiffsAlongPath(nodeId));
}

describe("importChatToStore", () => {
	it("主路径依次连接，其他 swipe 成为同一父节点的兄弟节点", async () => {
		const store = openStore();
		const result = await importChatFileToStore(store, fixturePath, {
			storyId: "story-import",
		});

		expect(result.story.title).toBe("角色");
		expect(result.mainPathNodeIds).toEqual([
			"story-import:m0:s0",
			"story-import:m1:s0",
			"story-import:m2:s1",
			"story-import:m3:s0",
			"story-import:m4:s0",
		]);
		expect(result.nodeCount).toBe(6);

		expect(
			store.getPathToNode("story-import:m2:s1").map((node) => node.id),
		).toEqual([
			"story-import:m0:s0",
			"story-import:m1:s0",
			"story-import:m2:s1",
		]);
		const sibling = store.getNode("story-import:m2:s0");
		expect(sibling?.parentId).toBe("story-import:m1:s0");
		expect(sibling?.raw).toBe("分支一");
		expect(sibling?.role).toBe("assistant");
		expect(store.getNode("story-import:m2:s1")?.raw).toBe("当前二");
		expect(store.getNode("story-import:m1:s0")?.role).toBe("user");
		expect(store.getNode("story-import:m1:s0")?.createdAt).toBe(
			"2026-01-01T00:00:00.000Z",
		);
	});

	it("沿主路径累加 diff 能还原每一层的变量快照", async () => {
		const store = openStore();
		await importChatFileToStore(store, fixturePath, {
			storyId: "story-import",
		});

		expect(snapshotAt(store, "story-import:m0:s0")).toEqual(first);
		expect(snapshotAt(store, "story-import:m1:s0")).toEqual(second);
		expect(snapshotAt(store, "story-import:m2:s1")).toEqual(mainSwipe);
		expect(snapshotAt(store, "story-import:m3:s0")).toEqual(mainSwipe);
		expect(snapshotAt(store, "story-import:m4:s0")).toEqual(last);
		expect(snapshotAt(store, "story-import:m2:s0")).toEqual(otherSwipe);
	});

	it("diff 使用对象键路径，删除和整体替换都正确", async () => {
		const store = openStore();
		await importChatFileToStore(store, fixturePath, {
			storyId: "story-import",
		});

		expect(
			store.getStateDiffs("story-import:m1:s0").map((diff) => ({
				path: diff.path,
				op: diff.op,
				value: diff.value,
			})),
		).toEqual([
			{ path: ["stat_data", "hp"], op: "set", value: 90 },
			{ path: ["stat_data", "mood"], op: "delete", value: null },
			{ path: ["flags"], op: "set", value: ["战斗"] },
		]);
		expect(
			store
				.getStateDiffs("story-import:m4:s0")
				.map((diff) => [diff.path.join("."), diff.op]),
		).toEqual([
			["stat_data.hp", "set"],
			["stat_data.mood", "delete"],
			["flags", "set"],
			["meta.turn", "set"],
			["meta.tags", "set"],
			["loot", "delete"],
		]);
		expect(
			store
				.getStateDiffsAlongPath("story-import:m4:s0")
				.every((diff) => diff.source === "import"),
		).toBe(true);
	});

	it("当前 swipe 被编辑过时，主路径使用当前正文，变量仍取自当前 swipe", async () => {
		const store = openStore();
		const lines = [
			JSON.stringify({ character_name: "角色" }),
			JSON.stringify({
				mes: "编辑后的正文",
				swipes: ["原始一", "原始二"],
				swipe_id: 1,
				variables: [{ v: 1 }, { v: 2 }],
			}),
		].join("\n");
		const result = await importChatToStore(store, parseChatJsonl([lines]), {
			storyId: "edited",
		});

		expect(result.mainPathNodeIds).toEqual(["edited:m0:s1"]);
		expect(store.getNode("edited:m0:s1")?.raw).toBe("编辑后的正文");
		expect(store.getNode("edited:m0:s0")?.raw).toBe("原始一");
		expect(snapshotAt(store, "edited:m0:s1")).toEqual({ v: 2 });
		expect(snapshotAt(store, "edited:m0:s0")).toEqual({ v: 1 });
	});

	it("显式标题、id 前缀和 system 角色", async () => {
		const store = openStore();
		const lines = [
			JSON.stringify({ character_name: "角色" }),
			JSON.stringify({ is_system: true, mes: "系统提示" }),
		].join("\n");
		const result = await importChatToStore(store, parseChatJsonl([lines]), {
			storyId: "sys",
			title: "自定义标题",
			idPrefix: "prefix",
		});

		expect(result.story.title).toBe("自定义标题");
		expect(result.mainPathNodeIds).toEqual(["prefix:m0:s0"]);
		expect(store.getNode("prefix:m0:s0")?.role).toBe("system");
	});

	it("空对象快照表示没有变量更新，不会删除已有状态", async () => {
		const store = openStore();
		const lines = [
			JSON.stringify({ character_name: "角色" }),
			JSON.stringify({ mes: "开场", variables: [{ stat_data: { hp: 100 } }] }),
			JSON.stringify({ is_user: true, mes: "空更新", variables: [{}] }),
			JSON.stringify({ mes: "继续", variables: [{ stat_data: { hp: 90 } }] }),
		];
		await importChatToStore(store, parseChatJsonl([lines.join("\n")]), {
			storyId: "empty",
		});

		expect(store.getStateDiffs("empty:m1:s0")).toEqual([]);
		expect(snapshotAt(store, "empty:m1:s0")).toEqual({
			stat_data: { hp: 100 },
		});
		expect(
			store.getStateDiffs("empty:m2:s0").map((diff) => ({
				path: diff.path,
				op: diff.op,
				value: diff.value,
			})),
		).toEqual([{ path: ["stat_data", "hp"], op: "set", value: 90 }]);
	});

	it("根快照不是对象时拒绝导入", async () => {
		const store = openStore();
		const lines = [
			JSON.stringify({ character_name: "角色" }),
			JSON.stringify({ mes: "正文", variables: [[1, 2]] }),
		].join("\n");
		await expect(
			importChatToStore(store, parseChatJsonl([lines]), { storyId: "bad" }),
		).rejects.toThrow("必须是对象或 null");
	});

	it("缺少头部时拒绝导入", async () => {
		const store = openStore();
		await expect(
			importChatToStore(store, [], { storyId: "empty" }),
		).rejects.toThrow("缺少头部");
	});
});
