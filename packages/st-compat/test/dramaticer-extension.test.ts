import { StoryStore as CoreStore } from "@dramaticer/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
	importCharacterCardEntity,
	importDramaticerExtension,
	parseCharacterCardJson,
} from "../src/index.js";

function cardJson(extension: unknown): string {
	return JSON.stringify({
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: "云裳",
			description: "青云宗剑修",
			nickname: "阿裳",
			extensions: extension === undefined ? {} : { dramaticer: extension },
		},
	});
}

const extension = {
	events: [
		{
			id: "bridge",
			text: "山洪冲垮石桥",
			preconditions: {
				kind: "state",
				path: ["场景", "地点"],
				op: "equals",
				value: "山门",
			},
			cooldown: 4,
		},
		{ id: "wolves", text: "夜里出现狼群" },
	],
	npcAgendas: [
		{
			npc: "阿裳",
			goal: "寻找剑冢",
			everyChapters: 2,
			importance: 0.8,
		},
	],
};

let store: CoreStore;

beforeEach(() => {
	store = CoreStore.open(":memory:");
	store.createStory({ id: "s1", title: "测试故事" });
	store.createStory({ id: "s2", title: "另一个故事" });
});

describe("extensions.dramaticer 导入", () => {
	it("事件与 NPC 议程写入存储，NPC 别名解析到角色实体", () => {
		const card = parseCharacterCardJson(cardJson(extension));
		importCharacterCardEntity(store, "s1", card);

		const result = importDramaticerExtension(store, "s1", card);
		expect(result).toEqual({
			events: { inserted: 2, updated: 0 },
			npcAgendas: { inserted: 1, updated: 0 },
		});

		const events = store.listEventPool("s1");
		expect(events.map((event) => event.sourceId)).toEqual(["bridge", "wolves"]);
		expect(events[0]).toMatchObject({
			text: "山洪冲垮石桥",
			cooldown: 4,
			source: "card-extension",
		});
		expect(events[0]?.preconditions).toEqual(
			extension.events[0]?.preconditions,
		);
		expect(events[1]?.preconditions).toBeNull();

		const entity = store.findEntityByName("s1", "云裳");
		const agendas = store.listNpcAgendas("s1");
		expect(agendas).toHaveLength(1);
		expect(agendas[0]).toMatchObject({
			entityId: entity?.id,
			goal: "寻找剑冢",
			everyChapters: 2,
			importance: 0.8,
			progress: "",
		});
	});

	it("停用的事件保留在池里并标记为停用", () => {
		const card = parseCharacterCardJson(
			cardJson({ events: [{ id: "off", text: "隐藏事件", enabled: false }] }),
		);
		importCharacterCardEntity(store, "s1", card);
		importDramaticerExtension(store, "s1", card);

		const events = store.listEventPool("s1");
		expect(events).toHaveLength(1);
		expect(events[0]?.enabled).toBe(false);
	});

	it("重复导入不新增行，事件正文更新", () => {
		const first = parseCharacterCardJson(cardJson(extension));
		importCharacterCardEntity(store, "s1", first);
		importDramaticerExtension(store, "s1", first);

		const changed = {
			events: [
				{ id: "bridge", text: "山洪冲垮石桥，道路中断", cooldown: 6 },
				{ id: "wolves", text: "夜里出现狼群" },
			],
			npcAgendas: [{ npc: "云裳", goal: "守住山门" }],
		};
		const second = parseCharacterCardJson(cardJson(changed));
		const result = importDramaticerExtension(store, "s1", second);
		expect(result).toEqual({
			events: { inserted: 0, updated: 2 },
			npcAgendas: { inserted: 0, updated: 1 },
		});

		const events = store.listEventPool("s1");
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			sourceId: "bridge",
			text: "山洪冲垮石桥，道路中断",
			cooldown: 6,
		});
		const agendas = store.listNpcAgendas("s1");
		expect(agendas).toHaveLength(1);
		expect(agendas[0]?.goal).toBe("守住山门");
	});

	it("没有扩展时返回零计数", () => {
		const card = parseCharacterCardJson(cardJson(undefined));
		importCharacterCardEntity(store, "s1", card);
		expect(importDramaticerExtension(store, "s1", card)).toEqual({
			events: { inserted: 0, updated: 0 },
			npcAgendas: { inserted: 0, updated: 0 },
		});
		expect(store.listEventPool("s1")).toEqual([]);
		expect(store.listNpcAgendas("s1")).toEqual([]);
	});

	it("找不到 NPC 实体时抛错并指出条目", () => {
		const card = parseCharacterCardJson(
			cardJson({ npcAgendas: [{ npc: "路人", goal: "旁观" }] }),
		);
		importCharacterCardEntity(store, "s1", card);
		expect(() => importDramaticerExtension(store, "s1", card)).toThrow(
			"extensions.dramaticer.npcAgendas[0].npc 找不到角色实体：路人",
		);
	});

	it("NPC 名称对应多个角色实体时抛错", () => {
		const card = parseCharacterCardJson(
			cardJson({ npcAgendas: [{ npc: "阿裳", goal: "寻找剑冢" }] }),
		);
		importCharacterCardEntity(store, "s1", card);
		store.upsertEntity({
			storyId: "s1",
			kind: "character",
			name: "另一个阿裳",
			source: "test",
			aliases: ["阿裳"],
		});

		expect(() => importDramaticerExtension(store, "s1", card)).toThrow(
			"extensions.dramaticer.npcAgendas[0].npc 对应多个角色实体：阿裳",
		);
	});

	it("故事不存在时直接抛错", () => {
		const card = parseCharacterCardJson(cardJson(extension));
		expect(() => importDramaticerExtension(store, "missing", card)).toThrow(
			"故事不存在：missing",
		);
	});
});
