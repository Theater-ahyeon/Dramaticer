import { describe, expect, it } from "vitest";
import { parseDramaticerCardExtension } from "../src/index.js";

describe("extensions.dramaticer 解析", () => {
	it("没有字段时返回空扩展", () => {
		expect(parseDramaticerCardExtension(undefined)).toEqual({
			events: [],
			npcAgendas: [],
		});
		expect(parseDramaticerCardExtension(null)).toEqual({
			events: [],
			npcAgendas: [],
		});
	});

	it("解析全部字段并套用默认值", () => {
		const extension = parseDramaticerCardExtension({
			events: [
				{
					id: "e1",
					text: "山洪冲垮石桥",
					preconditions: {
						kind: "all",
						conditions: [
							{
								kind: "state",
								path: ["场景", "地点"],
								op: "equals",
								value: "山门",
							},
							{
								kind: "not",
								condition: { kind: "state", path: ["天气"], op: "truthy" },
							},
						],
					},
					cooldown: 4,
					enabled: false,
				},
				{ id: "e2", text: "夜里出现狼群" },
			],
			npcAgendas: [{ npc: " 云裳 ", goal: "寻找剑冢" }],
		});

		expect(extension.events).toHaveLength(2);
		expect(extension.events[0]).toMatchObject({
			id: "e1",
			cooldown: 4,
			enabled: false,
		});
		expect(extension.events[0]?.preconditions?.kind).toBe("all");
		expect(extension.events[1]).toEqual({
			id: "e2",
			text: "夜里出现狼群",
			preconditions: null,
			cooldown: 0,
			enabled: true,
		});
		expect(extension.npcAgendas[0]).toEqual({
			npc: "云裳",
			goal: "寻找剑冢",
			everyChapters: 1,
			importance: 0.5,
		});
	});

	it("未知字段指出字段路径", () => {
		expect(() => parseDramaticerCardExtension({ extras: [] })).toThrow(
			"extensions.dramaticer.extras 是未知字段",
		);
		expect(() =>
			parseDramaticerCardExtension({
				events: [{ id: "e1", text: "事件", weight: 2 }],
			}),
		).toThrow("extensions.dramaticer.events[0].weight 是未知字段");
		expect(() =>
			parseDramaticerCardExtension({
				npcAgendas: [{ npc: "云裳", goal: "目标", mood: "冷静" }],
			}),
		).toThrow("extensions.dramaticer.npcAgendas[0].mood 是未知字段");
	});

	it("重复 id 与空字符串抛错并指出条目", () => {
		expect(() =>
			parseDramaticerCardExtension({
				events: [
					{ id: "e1", text: "第一件" },
					{ id: "e1", text: "第二件" },
				],
			}),
		).toThrow("extensions.dramaticer.events[1].id 重复：e1");
		expect(() =>
			parseDramaticerCardExtension({ events: [{ id: " ", text: "事件" }] }),
		).toThrow("extensions.dramaticer.events[0].id 不能是空字符串");
		expect(() =>
			parseDramaticerCardExtension({ events: [{ id: "e1", text: "  " }] }),
		).toThrow("extensions.dramaticer.events[0].text 不能是空字符串");
		expect(() =>
			parseDramaticerCardExtension({
				npcAgendas: [{ npc: "……", goal: "目标" }],
			}),
		).toThrow("extensions.dramaticer.npcAgendas[0].npc 去掉标点与空白后为空");
	});

	it("冷却、章节间隔与重要度的范围校验", () => {
		expect(() =>
			parseDramaticerCardExtension({
				events: [{ id: "e1", text: "事件", cooldown: -1 }],
			}),
		).toThrow("extensions.dramaticer.events[0].cooldown 必须是非负整数");
		expect(() =>
			parseDramaticerCardExtension({
				events: [{ id: "e1", text: "事件", cooldown: 1.5 }],
			}),
		).toThrow("extensions.dramaticer.events[0].cooldown 必须是非负整数");
		expect(() =>
			parseDramaticerCardExtension({
				npcAgendas: [{ npc: "云裳", goal: "目标", everyChapters: 0 }],
			}),
		).toThrow("extensions.dramaticer.npcAgendas[0].everyChapters 必须是正整数");
		expect(() =>
			parseDramaticerCardExtension({
				npcAgendas: [{ npc: "云裳", goal: "目标", importance: 1.2 }],
			}),
		).toThrow(
			"extensions.dramaticer.npcAgendas[0].importance 必须是 0 到 1 之间的数字",
		);
	});

	it("条件只允许 state、all、any、not，且参数严格", () => {
		expect(() =>
			parseDramaticerCardExtension({
				events: [
					{
						id: "e1",
						text: "事件",
						preconditions: { kind: "switch", name: "secret" },
					},
				],
			}),
		).toThrow(
			"extensions.dramaticer.events[0].preconditions.kind 不能是 switch",
		);
		expect(() =>
			parseDramaticerCardExtension({
				events: [
					{
						id: "e1",
						text: "事件",
						preconditions: { kind: "state", path: [], op: "exists" },
					},
				],
			}),
		).toThrow(
			"extensions.dramaticer.events[0].preconditions.path 必须是非空字符串数组",
		);
		expect(() =>
			parseDramaticerCardExtension({
				events: [
					{
						id: "e1",
						text: "事件",
						preconditions: { kind: "state", path: ["场景"], op: "equals" },
					},
				],
			}),
		).toThrow(
			"extensions.dramaticer.events[0].preconditions.value 在 op 为 equals 时必须提供",
		);
		expect(() =>
			parseDramaticerCardExtension({
				events: [
					{
						id: "e1",
						text: "事件",
						preconditions: { kind: "any", conditions: [] },
					},
				],
			}),
		).toThrow(
			"extensions.dramaticer.events[0].preconditions.conditions 必须是非空数组",
		);
	});

	it("顶层与数组类型错误直接抛错", () => {
		expect(() => parseDramaticerCardExtension([])).toThrow(
			"extensions.dramaticer 必须是对象",
		);
		expect(() => parseDramaticerCardExtension({ events: {} })).toThrow(
			"extensions.dramaticer.events 必须是数组",
		);
	});
});
