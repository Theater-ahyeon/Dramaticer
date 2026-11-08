import {
	StoryStore as CoreStore,
	type DirectorPlan,
	readDirectorPlan,
	replaceDirectorPlan,
} from "@dramaticer/core";
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
			arcs: { inserted: 0, updated: 0, skipped: 0 },
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
			arcs: { inserted: 0, updated: 0, skipped: 0 },
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
			arcs: { inserted: 0, updated: 0, skipped: 0 },
		});
		expect(store.listEventPool("s1")).toEqual([]);
		expect(store.listNpcAgendas("s1")).toEqual([]);
		expect(readDirectorPlan(store, "s1")).toEqual({ arcs: [] });
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

const arcsExtension = {
	events: [{ id: "bridge", text: "山洪冲垮石桥" }],
	arcs: [
		{
			id: "arc-1",
			title: "山门危机",
			throughLine: "守住山门直到援军到来",
			difficulty: 0.5,
			redLines: ["不能揭露掌门旧事"],
			sequences: [
				{
					id: "seq-1",
					title: "试探",
					beats: [
						{
							id: "beat-1",
							goal: "确认敌人来意",
							entrySigns: ["山门外出现马蹄声"],
							fitPoints: ["阿裳提到旧伤"],
						},
					],
				},
			],
		},
	],
};

function importArcs(extensionValue: unknown) {
	const card = parseCharacterCardJson(cardJson(extensionValue));
	importCharacterCardEntity(store, "s1", card);
	return { card, result: importDramaticerExtension(store, "s1", card) };
}

describe("extensions.dramaticer 弧线导入", () => {
	it("弧线、序列与节拍以 import 来源写入导演计划", () => {
		const { result } = importArcs(arcsExtension);
		expect(result.arcs).toEqual({ inserted: 3, updated: 0, skipped: 0 });
		expect(result.events).toEqual({ inserted: 1, updated: 0 });

		expect(readDirectorPlan(store, "s1")).toEqual({
			arcs: arcsExtension.arcs,
		});
		const entries = store.listDirectorPlanEntries("s1");
		expect(entries.arcs.map((arc) => arc.source)).toEqual(["import"]);
		expect(entries.sequences.map((sequence) => sequence.source)).toEqual([
			"import",
		]);
		expect(entries.beats.map((beat) => beat.source)).toEqual(["import"]);
	});

	it("重复导入更新弧线正文且不新增行", () => {
		importArcs(arcsExtension);
		const changed = {
			arcs: [
				{
					...arcsExtension.arcs[0],
					title: "山门失守",
					sequences: [
						{
							id: "seq-1",
							title: "强攻",
							beats: [
								{
									id: "beat-1",
									goal: "挡住第一波冲击",
									entrySigns: ["山门开始开裂"],
									fitPoints: ["阿裳握紧了剑"],
								},
							],
						},
					],
				},
			],
		};
		const { result } = importArcs(changed);
		expect(result.arcs).toEqual({ inserted: 0, updated: 3, skipped: 0 });

		const entries = store.listDirectorPlanEntries("s1");
		expect(entries.arcs).toHaveLength(1);
		expect(entries.sequences).toHaveLength(1);
		expect(entries.beats).toHaveLength(1);
		const plan = readDirectorPlan(store, "s1");
		expect(plan.arcs[0]?.title).toBe("山门失守");
		expect(plan.arcs[0]?.sequences[0]?.title).toBe("强攻");
		expect(plan.arcs[0]?.sequences[0]?.beats[0]?.goal).toBe("挡住第一波冲击");
	});

	it("玩家编辑的行不被导入覆盖", () => {
		importArcs(arcsExtension);
		const playerPlan: DirectorPlan = {
			arcs: [
				{
					id: "arc-1",
					title: "玩家改过的标题",
					throughLine: "玩家改过的贯穿线",
					difficulty: 0.5,
					redLines: [],
					sequences: [
						{
							id: "seq-1",
							title: "玩家改过的序列",
							beats: [
								{
									id: "beat-1",
									goal: "玩家改过的目标",
									entrySigns: ["玩家写的迹象"],
									fitPoints: ["玩家写的契合点"],
								},
							],
						},
					],
				},
			],
		};
		replaceDirectorPlan(store, "s1", playerPlan);

		const { result } = importArcs(arcsExtension);
		expect(result.arcs).toEqual({ inserted: 0, updated: 0, skipped: 3 });
		expect(readDirectorPlan(store, "s1")).toEqual(playerPlan);
	});

	it("没有 arcs 时不写计划", () => {
		const { result } = importArcs({
			events: [{ id: "wolves", text: "夜里出现狼群" }],
		});
		expect(result.arcs).toEqual({ inserted: 0, updated: 0, skipped: 0 });
		expect(readDirectorPlan(store, "s1")).toEqual({ arcs: [] });
	});
});
