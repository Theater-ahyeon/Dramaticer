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
	store.upsertEntity({
		id: "e1",
		storyId: "s1",
		kind: "character",
		name: "云裳",
		source: "test",
	});
	store.upsertEntity({
		id: "e2",
		storyId: "s2",
		kind: "character",
		name: "外乡人",
		source: "test",
	});
}

const condition = {
	kind: "state" as const,
	path: ["场景", "地点"],
	op: "equals" as const,
	value: "山门",
};

describe("事件池存储", () => {
	it("插入后按顺序列出，条件往返保持结构", () => {
		const { store } = openTempStore();
		seed(store);

		const result = store.upsertEventPool([
			{
				storyId: "s1",
				sourceId: "e2",
				text: "夜里出现狼群",
				cooldown: 2,
				createdAt: "2026-11-07T12:00:00.000Z",
			},
			{
				storyId: "s1",
				sourceId: "e1",
				text: " 山洪冲垮石桥 ",
				preconditions: condition,
				source: "card-extension",
				createdAt: "2026-11-07T12:00:01.000Z",
			},
		]);
		expect(result).toEqual({ inserted: 2, updated: 0 });

		const entries = store.listEventPool("s1");
		expect(entries.map((entry) => entry.sourceId)).toEqual(["e2", "e1"]);
		expect(entries[0]).toEqual({
			storyId: "s1",
			sourceId: "e2",
			text: "夜里出现狼群",
			preconditions: null,
			cooldown: 2,
			source: "manual",
			createdAt: "2026-11-07T12:00:00.000Z",
		});
		expect(entries[1]?.preconditions).toEqual(condition);
		expect(entries[1]?.text).toBe("山洪冲垮石桥");
		expect(entries[1]?.source).toBe("card-extension");
	});

	it("重复导入更新正文、条件与冷却，保留创建时间", () => {
		const { store } = openTempStore();
		seed(store);
		store.upsertEventPool([
			{
				storyId: "s1",
				sourceId: "e1",
				text: "旧事件",
				cooldown: 0,
				createdAt: "2026-11-07T12:00:00.000Z",
			},
		]);

		const result = store.upsertEventPool([
			{
				storyId: "s1",
				sourceId: "e1",
				text: "新事件",
				preconditions: condition,
				cooldown: 5,
				source: "card-extension",
				createdAt: "2026-11-08T12:00:00.000Z",
			},
		]);
		expect(result).toEqual({ inserted: 0, updated: 1 });

		const entries = store.listEventPool("s1");
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			sourceId: "e1",
			text: "新事件",
			cooldown: 5,
			source: "card-extension",
			createdAt: "2026-11-07T12:00:00.000Z",
		});
		expect(entries[0]?.preconditions).toEqual(condition);
	});

	it("非法输入抛错且整批不写入", () => {
		const { store } = openTempStore();
		seed(store);

		expect(() =>
			store.upsertEventPool([
				{ storyId: "s1", sourceId: "ok", text: "合法" },
				{ storyId: "s1", sourceId: " ", text: "非法" },
			]),
		).toThrow("事件池条目[1] 的 sourceId 不能是空字符串");
		expect(() =>
			store.upsertEventPool([
				{ storyId: "s1", sourceId: "e1", text: "事件", cooldown: -1 },
			]),
		).toThrow("事件池条目[0] 的 cooldown 必须是非负整数");
		expect(() =>
			store.upsertEventPool([
				{ storyId: "s1", sourceId: "e1", text: "事件" },
				{ storyId: "s1", sourceId: "e1", text: "重复" },
			]),
		).toThrow("同一次写入里事件池条目的 sourceId 重复：e1");
		expect(() =>
			store.upsertEventPool([
				{ storyId: "nope", sourceId: "e1", text: "事件" },
			]),
		).toThrow("故事不存在：nope");
		expect(() =>
			store.upsertEventPool([
				{
					storyId: "s1",
					sourceId: "e1",
					text: "事件",
					preconditions: { kind: "switch", name: "secret" },
				},
			]),
		).toThrow("事件池条目[0] 的 preconditions.kind 不能是 switch");

		expect(store.listEventPool("s1")).toEqual([]);
	});
});

describe("NPC 议程存储", () => {
	it("插入默认值并按顺序列出", () => {
		const { store } = openTempStore();
		seed(store);

		const result = store.upsertNpcAgendas([
			{ storyId: "s1", entityId: "e1", goal: "寻找剑冢" },
		]);
		expect(result).toEqual({ inserted: 1, updated: 0 });

		const agendas = store.listNpcAgendas("s1");
		expect(agendas).toHaveLength(1);
		expect(agendas[0]).toMatchObject({
			storyId: "s1",
			entityId: "e1",
			goal: "寻找剑冢",
			everyChapters: 1,
			importance: 0.5,
			progress: "",
			lastAdvancedNodeId: null,
		});
	});

	it("重复导入更新目标与参数，保留进度与推进楼层", () => {
		const { store, path } = openTempStore();
		seed(store);
		store.upsertNpcAgendas([
			{
				storyId: "s1",
				entityId: "e1",
				goal: "寻找剑冢",
				createdAt: "2026-11-07T12:00:00.000Z",
			},
		]);

		const raw = new Database(path);
		try {
			raw
				.prepare(
					`UPDATE npc_agendas
					SET progress = ?, last_advanced_node_id = ?
					WHERE story_id = ? AND entity_id = ?`,
				)
				.run("已经在剑冢布下陷阱", "a1", "s1", "e1");
		} finally {
			raw.close();
		}

		const result = store.upsertNpcAgendas([
			{
				storyId: "s1",
				entityId: "e1",
				goal: "夺取剑冢里的断剑",
				everyChapters: 2,
				importance: 0.9,
				createdAt: "2026-11-08T12:00:00.000Z",
			},
		]);
		expect(result).toEqual({ inserted: 0, updated: 1 });

		const agendas = store.listNpcAgendas("s1");
		expect(agendas).toHaveLength(1);
		expect(agendas[0]).toMatchObject({
			goal: "夺取剑冢里的断剑",
			everyChapters: 2,
			importance: 0.9,
			progress: "已经在剑冢布下陷阱",
			lastAdvancedNodeId: "a1",
			createdAt: "2026-11-07T12:00:00.000Z",
		});
	});

	it("实体不存在或属于其他故事时抛错", () => {
		const { store } = openTempStore();
		seed(store);

		expect(() =>
			store.upsertNpcAgendas([
				{ storyId: "s1", entityId: "missing", goal: "目标" },
			]),
		).toThrow("NPC 议程[0] 指向的实体不存在：missing");
		expect(() =>
			store.upsertNpcAgendas([{ storyId: "s1", entityId: "e2", goal: "目标" }]),
		).toThrow("NPC 议程[0] 的 storyId 与实体所属故事不一致：s1");
		expect(() =>
			store.upsertNpcAgendas([
				{ storyId: "s1", entityId: "e1", goal: "目标", importance: 1.1 },
			]),
		).toThrow("NPC 议程[0] 的 importance 必须是 0 到 1 之间的数字");
		expect(() =>
			store.upsertNpcAgendas([
				{ storyId: "s1", entityId: "e1", goal: "目标", everyChapters: 0 },
			]),
		).toThrow("NPC 议程[0] 的 everyChapters 必须是正整数");
		expect(() =>
			store.upsertNpcAgendas([
				{ storyId: "s1", entityId: "e1", goal: "目标" },
				{ storyId: "s1", entityId: "e1", goal: "重复" },
			]),
		).toThrow("同一次写入里 NPC 议程的实体重复：e1");

		expect(store.listNpcAgendas("s1")).toEqual([]);
	});

	it("裸连接不能修改议程的故事与实体，也不能写入跨故事推进楼层", () => {
		const { store, path } = openTempStore();
		seed(store);
		store.upsertNpcAgendas([
			{ storyId: "s1", entityId: "e1", goal: "寻找剑冢" },
		]);
		store.appendNode({
			id: "other",
			storyId: "s2",
			parentId: null,
			role: "assistant",
			raw: "另一条故事线",
		});

		const raw = new Database(path);
		try {
			expect(() =>
				raw
					.prepare(
						"UPDATE npc_agendas SET story_id = 's2' WHERE story_id = 's1'",
					)
					.run(),
			).toThrow("NPC 议程的故事与实体不可修改");
			expect(() =>
				raw
					.prepare(
						"UPDATE npc_agendas SET last_advanced_node_id = 'other' WHERE story_id = 's1'",
					)
					.run(),
			).toThrow("NPC 议程的故事与实体不可修改");
		} finally {
			raw.close();
		}
	});
});
