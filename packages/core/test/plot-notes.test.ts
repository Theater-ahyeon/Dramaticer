import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { StoryStore } from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
	store.createStory({ id: "s2", title: "另一个故事" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场",
	});
	store.appendNode({
		id: "other",
		storyId: "s2",
		parentId: null,
		role: "assistant",
		raw: "另一条故事线",
	});
}

function insert(
	store: StoryStore,
	id: string,
	text: string,
	createdAt = "2026-11-07T12:00:00.000Z",
) {
	return store.insertPlotNotes([
		{ id, storyId: "s1", sourceNodeId: "a1", text, createdAt },
	]);
}

describe("剧情笔记存储", () => {
	it("按创建顺序返回未兑现笔记，并去掉正文两端空白", () => {
		const { store } = openTempStore();
		seed(store);
		const first = insert(
			store,
			"n1",
			" 井底有人跟踪 ",
			"2026-11-07T12:00:00.000Z",
		);
		const second = insert(
			store,
			"n2",
			"裂缝在扩大",
			"2026-11-07T12:00:01.000Z",
		);

		expect(first[0]).toMatchObject({
			id: "n1",
			storyId: "s1",
			sourceNodeId: "a1",
			text: "井底有人跟踪",
			status: "open",
			fulfilledAt: null,
		});
		expect(store.getOpenPlotNotes("s1").map((note) => note.id)).toEqual([
			"n1",
			"n2",
		]);
		expect(store.getOpenPlotNotes("s1")[1]).toEqual(second[0]);
	});

	it("兑现后从 open 列表消失，再次兑现抛错", () => {
		const { store } = openTempStore();
		seed(store);
		insert(store, "n1", "井底有人跟踪");

		const fulfilled = store.fulfillPlotNote("n1", "2026-11-07T13:00:00.000Z");
		expect(fulfilled).toMatchObject({
			id: "n1",
			status: "fulfilled",
			fulfilledAt: "2026-11-07T13:00:00.000Z",
		});
		expect(store.getOpenPlotNotes("s1")).toEqual([]);
		expect(() =>
			store.fulfillPlotNote("n1", "2026-11-07T14:00:00.000Z"),
		).toThrow("已经兑现");
		expect(() =>
			store.fulfillPlotNote("missing", "2026-11-07T14:00:00.000Z"),
		).toThrow("不存在");
	});

	it("校验故事、来源楼层与正文，整批失败时一条都不写入", () => {
		const { store } = openTempStore();
		seed(store);

		expect(() =>
			store.insertPlotNotes([
				{
					storyId: "s1",
					sourceNodeId: "a1",
					text: "合法",
				},
				{ storyId: "s1", sourceNodeId: "a1", text: "   " },
			]),
		).toThrow("不能是空字符串");
		expect(store.getOpenPlotNotes("s1")).toEqual([]);

		expect(() =>
			store.insertPlotNotes([
				{ storyId: "missing", sourceNodeId: "a1", text: "x" },
			]),
		).toThrow("故事不存在");
		expect(() =>
			store.insertPlotNotes([
				{ storyId: "s1", sourceNodeId: "missing", text: "x" },
			]),
		).toThrow("楼层节点不存在");
		expect(() =>
			store.insertPlotNotes([
				{ storyId: "s1", sourceNodeId: "other", text: "x" },
			]),
		).toThrow("与楼层节点所属故事不一致");
	});

	it("裸连接不能修改正文或删除笔记", () => {
		const { store, path } = openTempStore();
		seed(store);
		insert(store, "n1", "井底有人跟踪");

		const raw = new Database(path);
		try {
			expect(() =>
				raw
					.prepare("UPDATE plot_notes SET text = '改写' WHERE id = 'n1'")
					.run(),
			).toThrow("不可修改");
			expect(() =>
				raw.prepare("DELETE FROM plot_notes WHERE id = 'n1'").run(),
			).toThrow("不可删除");
		} finally {
			raw.close();
		}
		expect(store.getOpenPlotNotes("s1")[0]?.text).toBe("井底有人跟踪");
	});
});
