import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	type EventWindow,
	type StoryStore,
	appendReflectionRecord,
	readMemoryRecords,
	recordExtractedEvents,
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

function windowOf(store: StoryStore, nodeId: string): EventWindow {
	const node = store.getNode(nodeId);
	if (node === null) throw new Error(`楼层不存在：${nodeId}`);
	return {
		floors: [node],
		span: [node],
		before: null,
		after: null,
	};
}

describe("记忆记录", () => {
	it("引文对不上时照样按楼层锚点写入，不留摘录也不拒收（v5 §3.5）", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "a1", null, "assistant", "凛站在教室门口。");

		recordExtractedEvents(store, "s1", windowOf(store, "a1"), [
			{
				nodeId: "a1",
				events: [
					{
						text: "凛在教室门口等人",
						participants: ["凛"],
						knowers: [],
						importance: 0.4,
						storyTime: null,
						location: null,
						quote: "她一直在门口等着",
					},
				],
			},
		]);

		expect(store.countEventsForNode("a1")).toBe(1);
		expect(readMemoryRecords(store, "s1", "a1")[0]).toMatchObject({
			nodeId: "a1",
			floorNo: 1,
			quote: null,
		});
		expect(store.listMemoryRejections("s1")).toEqual([]);

		append(store, "u1", "a1", "user", "我走过去。");
		append(store, "a2", "u1", "assistant", "凛站在教室门口，没回头。");
		recordExtractedEvents(store, "s1", windowOf(store, "a2"), [
			{
				nodeId: "a2",
				events: [
					{
						text: "凛在教室门口等人",
						participants: ["凛"],
						knowers: [],
						importance: 0.4,
						storyTime: null,
						location: null,
						quote: "凛站在教室门口！",
					},
				],
			},
		]);

		// 宽松匹配的引文（标点不同）照样留作摘录。
		const records = readMemoryRecords(store, "s1", "a2");
		expect(records.map((record) => record.quote)).toContain("凛站在教室门口！");
	});

	it("分支切换后只读到当前路径上的记录与事实", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "a1", null, "assistant", "共同的开场。");
		append(store, "u1", "a1", "user", "向左。");
		append(store, "u2", "a1", "user", "向右。");
		append(store, "a2", "u1", "assistant", "左边。");
		append(store, "a3", "u2", "assistant", "右边。");
		store.setHead("s1", "a2");

		store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "a1",
				ordinal: 0,
				text: "共同事件",
				participants: [],
				knowers: [],
				importance: 0.2,
			},
			{
				storyId: "s1",
				sourceNodeId: "a2",
				ordinal: 0,
				text: "左边事件",
				participants: [],
				knowers: [],
				importance: 0.2,
			},
			{
				storyId: "s1",
				sourceNodeId: "a3",
				ordinal: 0,
				text: "右边事件",
				participants: [],
				knowers: [],
				importance: 0.2,
			},
		]);
		for (const nodeId of ["a2", "a3"]) {
			store.appendStateDiff({
				storyId: "s1",
				nodeId,
				path: ["character", "凛", "location"],
				op: "set",
				value: nodeId === "a2" ? "左边教室" : "右边走廊",
				source: "settler",
			});
		}

		expect(readMemoryRecords(store, "s1").map((record) => record.text)).toEqual(
			["共同事件", "左边事件", "character · 凛 · location：左边教室"],
		);

		store.setHead("s1", "a3");
		expect(readMemoryRecords(store, "s1").map((record) => record.text)).toEqual(
			["共同事件", "右边事件", "character · 凛 · location：右边走廊"],
		);
	});

	it("结算写下的事实也以记录形式读到", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "a1", null, "assistant", "凛搬到了旧校舍。");
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "a1",
			path: ["character", "凛", "location"],
			op: "set",
			value: "旧校舍",
			source: "settler",
			confidence: 0.9,
			storyTime: { start: "第二天", end: null },
		});
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "a1",
			path: ["character", "凛", "injury"],
			op: "delete",
			source: "settler",
		});

		const records = readMemoryRecords(store, "s1");
		expect(records).toEqual([
			expect.objectContaining({
				kind: "fact",
				nodeId: "a1",
				floorNo: 1,
				text: "character · 凛 · location：旧校舍",
				entities: ["凛"],
				storyTime: "第二天",
				quote: null,
				source: "settler",
			}),
			expect.objectContaining({
				kind: "fact",
				text: "character · 凛 · injury：不再成立",
				source: "settler",
			}),
		]);
	});

	it("章末反思以记录追加，与抽取记录一样只读", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "a1", null, "assistant", "他第一次叫了她的名字。");

		appendReflectionRecord(
			store,
			"s1",
			"a1",
			"凛对卫宫的态度从警惕变成了信任。",
		);

		const records = readMemoryRecords(store, "s1");
		expect(records).toEqual([
			expect.objectContaining({
				kind: "reflection",
				nodeId: "a1",
				text: "凛对卫宫的态度从警惕变成了信任。",
				importance: 0.8,
				source: "reflection",
			}),
		]);
	});

	it("记录的出处写入后不可修改、不可删除", () => {
		const { store, path } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "a1", null, "assistant", "凛站在教室门口。");
		recordExtractedEvents(store, "s1", windowOf(store, "a1"), [
			{
				nodeId: "a1",
				events: [
					{
						text: "凛在教室门口等人",
						participants: ["凛"],
						knowers: [],
						importance: 0.4,
						storyTime: null,
						location: null,
						quote: "凛站在教室门口。",
					},
				],
			},
		]);

		const raw = new Database(path);
		try {
			expect(() =>
				raw.prepare("UPDATE memory_event_quotes SET quote = '改'").run(),
			).toThrow("记录的出处不可修改");
			expect(() =>
				raw.prepare("DELETE FROM memory_event_quotes").run(),
			).toThrow("记录的出处不可删除");
		} finally {
			raw.close();
		}
	});
});
