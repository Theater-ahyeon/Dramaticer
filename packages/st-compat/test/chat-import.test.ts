import { fileURLToPath } from "node:url";
import { StoryStore } from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import type { JsonObject } from "../src/index.js";
import {
	importChatFileToStore,
	importChatToStore,
	parseChatJsonl,
} from "../src/index.js";
import { snapshotAt } from "./store-replay.js";

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
		expect(store.getHead("story-import")?.id).toBe("story-import:m4:s0");

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

		expect(snapshotAt(store, "story-import:m0:s0")).toEqual({ mvu: first });
		expect(snapshotAt(store, "story-import:m1:s0")).toEqual({ mvu: second });
		expect(snapshotAt(store, "story-import:m2:s1")).toEqual({
			mvu: mainSwipe,
		});
		expect(snapshotAt(store, "story-import:m3:s0")).toEqual({
			mvu: mainSwipe,
		});
		expect(snapshotAt(store, "story-import:m4:s0")).toEqual({ mvu: last });
		expect(snapshotAt(store, "story-import:m2:s0")).toEqual({
			mvu: otherSwipe,
		});
	});

	it("diff 使用 mvu 命名空间下的对象键路径，删除和整体替换都正确", async () => {
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
			{ path: ["mvu", "stat_data", "hp"], op: "set", value: 90 },
			{ path: ["mvu", "stat_data", "mood"], op: "delete", value: null },
			{ path: ["mvu", "flags"], op: "set", value: ["战斗"] },
		]);
		expect(
			store
				.getStateDiffs("story-import:m4:s0")
				.map((diff) => [diff.path.join("."), diff.op]),
		).toEqual([
			["mvu.stat_data.hp", "set"],
			["mvu.stat_data.mood", "delete"],
			["mvu.flags", "set"],
			["mvu.meta.turn", "set"],
			["mvu.meta.tags", "set"],
			["mvu.loot", "delete"],
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
		expect(snapshotAt(store, "edited:m0:s1")).toEqual({ mvu: { v: 2 } });
		expect(snapshotAt(store, "edited:m0:s0")).toEqual({ mvu: { v: 1 } });
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
		expect(store.getStateDiffs("prefix:m0:s0")).toEqual([]);
		expect(snapshotAt(store, "prefix:m0:s0")).toEqual({});
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
			mvu: { stat_data: { hp: 100 } },
		});
		expect(
			store.getStateDiffs("empty:m2:s0").map((diff) => ({
				path: diff.path,
				op: diff.op,
				value: diff.value,
			})),
		).toEqual([{ path: ["mvu", "stat_data", "hp"], op: "set", value: 90 }]);
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
		expect(store.getStory("bad")).toBeNull();
		expect(store.getNode("bad:m0:s0")).toBeNull();
	});

	it("文件末尾的坏行让整次导入回滚，修正后可以重新导入", async () => {
		const store = openStore();
		const header = JSON.stringify({ character_name: "角色" });
		const firstFloor = JSON.stringify({
			mes: "第一层正文",
			variables: [{ stat_data: { hp: 1 } }],
		});
		const broken = `${header}\n${firstFloor}\n{oops}\n`;

		await expect(
			importChatToStore(store, parseChatJsonl([broken]), {
				storyId: "atomic",
			}),
		).rejects.toThrow("第 3 行不是合法 JSON");

		expect(store.getStory("atomic")).toBeNull();
		expect(store.getNode("atomic:m0:s0")).toBeNull();
		expect(store.searchNodeText("第一层正文", { storyId: "atomic" })).toEqual(
			[],
		);

		const fixed = `${header}\n${firstFloor}\n${JSON.stringify({ mes: "第二层正文" })}\n`;
		const result = await importChatToStore(store, parseChatJsonl([fixed]), {
			storyId: "atomic",
		});
		expect(result.nodeCount).toBe(2);
		expect(
			store
				.searchNodeText("第一层正文", { storyId: "atomic" })
				.map((match) => match.nodeId),
		).toEqual(["atomic:m0:s0"]);
	});

	it("swipe_id 越界时整次导入回滚", async () => {
		const store = openStore();
		const lines = [
			JSON.stringify({ character_name: "角色" }),
			JSON.stringify({
				mes: "正文",
				swipes: ["一", "二"],
				swipe_id: 2,
			}),
		].join("\n");

		await expect(
			importChatToStore(store, parseChatJsonl([lines]), {
				storyId: "bad-swipe",
			}),
		).rejects.toThrow("swipe_id 2 超出范围（共 2 个 swipe）");
		expect(store.getStory("bad-swipe")).toBeNull();
		expect(store.getNode("bad-swipe:m0:s0")).toBeNull();
	});

	it("嵌套空对象生成删除 diff，回放后状态被清空", async () => {
		const store = openStore();
		const lines = [
			JSON.stringify({ character_name: "角色" }),
			JSON.stringify({
				mes: "开场",
				variables: [{ stat_data: { hp: 100, mood: "平静" } }],
			}),
			JSON.stringify({ mes: "清空", variables: [{ stat_data: {} }] }),
		];
		await importChatToStore(store, parseChatJsonl([lines.join("\n")]), {
			storyId: "clear",
		});

		expect(
			store.getStateDiffs("clear:m1:s0").map((diff) => ({
				path: diff.path,
				op: diff.op,
			})),
		).toEqual([
			{ path: ["mvu", "stat_data", "hp"], op: "delete" },
			{ path: ["mvu", "stat_data", "mood"], op: "delete" },
		]);
		expect(snapshotAt(store, "clear:m1:s0")).toEqual({
			mvu: { stat_data: {} },
		});
	});

	it("缺少头部时拒绝导入", async () => {
		const store = openStore();
		await expect(
			importChatToStore(store, [], { storyId: "empty" }),
		).rejects.toThrow("缺少头部");
	});
});
