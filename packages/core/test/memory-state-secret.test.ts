import { describe, expect, it } from "vitest";
import {
	type StoryStore,
	readMemorySecrets,
	readMemoryState,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function append(
	store: StoryStore,
	id: string,
	parentId: string | null,
	role: "system" | "user" | "assistant",
	raw: string,
): void {
	store.appendNode({
		id,
		storyId: "s1",
		parentId,
		role,
		raw,
	});
}

function setState(
	store: StoryStore,
	nodeId: string,
	path: readonly string[],
	value: unknown,
): void {
	store.appendStateDiffs([
		{
			storyId: "s1",
			nodeId,
			path,
			op: "set",
			value,
			source: "settler",
		},
	]);
}

describe("状态投影", () => {
	it("同一个键多次变化时读到最新值，历史按先后可查", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant", "凛站在教室里。");
		append(store, "n2", "n1", "assistant", "凛走到操场。");
		setState(store, "n1", ["character", "凛", "location"], "教室");
		setState(store, "n2", ["character", "凛", "location"], "操场");

		const first = readMemoryState(store, "s1", "n1");
		expect(first).toHaveLength(1);
		expect(first[0]?.value).toBe("教室");
		expect(first[0]?.floorNo).toBe(1);

		const latest = readMemoryState(store, "s1", "n2");
		expect(latest).toHaveLength(1);
		expect(latest[0]?.target).toBe(
			JSON.stringify(["character", "凛", "location"]),
		);
		expect(latest[0]?.item).toBe("location");
		expect(latest[0]?.value).toBe("操场");
		expect(latest[0]?.floorNo).toBe(2);
		expect(
			latest[0]?.history.map((version) => [version.floorNo, version.value]),
		).toEqual([
			[1, "教室"],
			[2, "操场"],
		]);
	});

	it("卡声明的类型写着 mvu 变量时进入状态", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant", "凛已入金丹境。");
		store.saveImportAuditEntries("s1", [
			{
				source: "world:境界",
				title: "境界",
				content: "变量：凛.境界，取练气、筑基、金丹。",
				matches: [{ kind: "state", rules: ["title:境界"] }],
				rulePrimary: "state",
				constant: true,
			},
		]);
		setState(store, "n1", ["mvu", "凛", "境界"], "金丹");

		const items = readMemoryState(store, "s1");
		const declared = items.find((item) => item.item === "境界");
		expect(declared?.path).toEqual(["mvu", "凛", "境界"]);
		expect(declared?.value).toBe("金丹");
		expect(declared?.floorNo).toBe(1);
	});
});

describe("秘密投影", () => {
	it("在场的人知道，不在场的人列为不知道，被明确告知后更新", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant", "凛把钥匙藏进钟楼。");
		append(store, "n2", "n1", "assistant", "凛把钟楼的事告诉了卫宫。");
		const [secret] = store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "n1",
				ordinal: 0,
				text: "凛把钥匙藏进钟楼",
				participants: ["凛"],
				knowers: ["凛"],
				importance: 0.8,
			},
			{
				storyId: "s1",
				sourceNodeId: "n1",
				ordinal: 1,
				text: "卫宫在码头值夜",
				participants: ["卫宫"],
				knowers: [],
				importance: 0.2,
			},
			{
				storyId: "s1",
				sourceNodeId: "n1",
				ordinal: 2,
				text: "远坂寄来一封信",
				participants: ["远坂"],
				knowers: [],
				importance: 0.2,
			},
		]);
		if (secret === undefined) throw new Error("事件没有写入");

		const before = readMemorySecrets(store, "s1", "n1");
		expect(before).toHaveLength(1);
		expect(before[0]?.text).toBe("凛把钥匙藏进钟楼");
		expect(before[0]?.knowers).toEqual(["凛"]);
		expect(before[0]?.unaware).toEqual(["卫宫", "远坂"]);

		setState(store, "n2", ["knowledge", "卫宫", "k1"], {
			factId: secret.id,
			text: "凛告诉卫宫钥匙藏在钟楼",
		});
		const after = readMemorySecrets(store, "s1", "n2");
		expect(after).toHaveLength(1);
		expect(after[0]?.knowers).toEqual(["凛", "卫宫"]);
		expect(after[0]?.unaware).toEqual(["远坂"]);
	});

	it("公开事件与标了星号的事件不算秘密", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant", "城门关闭。");
		store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "n1",
				ordinal: 0,
				text: "城门关闭",
				participants: ["凛", "卫宫"],
				knowers: [],
				importance: 0.4,
			},
			{
				storyId: "s1",
				sourceNodeId: "n1",
				ordinal: 1,
				text: "全城都知道的事",
				participants: ["凛", "卫宫"],
				knowers: ["*"],
				importance: 0.4,
			},
		]);
		expect(readMemorySecrets(store, "s1")).toEqual([]);
	});
});
