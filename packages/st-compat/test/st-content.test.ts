import { describe, expect, it } from "vitest";
import {
	parseCharacterCardJson,
	parseCharacterCardPng,
} from "../src/character-card.js";
import type { JsonObject } from "../src/index.js";
import { readStAuthorNote } from "../src/st-content/author-note.js";
import {
	listCharacterGreetings,
	mapCharacterCard,
	selectCharacterGreeting,
} from "../src/st-content/card.js";
import { mapStPersona, readStPersona } from "../src/st-content/persona.js";
import { buildPngCard } from "./png-fixture.js";

const cardData: JsonObject = {
	name: "测试角色",
	description: "角色描述正文",
	personality: "性格正文",
	scenario: "场景正文",
	first_mes: "开场白正文",
	mes_example: "示例正文",
	creator_notes: "作者注释正文",
	system_prompt: "系统提示正文",
	post_history_instructions: "历史后指令正文",
	alternate_greetings: ["备用开场一", "备用开场二"],
	group_only_greetings: ["群聊开场"],
	tags: ["标签"],
	creator: "作者",
	character_version: "1.0",
	extensions: { talkativeness: "0.5", world: "测试世界" },
};

const v2Card: JsonObject = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: cardData,
};

const v3Card: JsonObject = {
	spec: "chara_card_v3",
	spec_version: "3.0",
	data: {
		...cardData,
		nickname: "小名",
		assets: [{ type: "icon", uri: "embedded" }],
		unknown_card_field: "未知字段正文",
	},
};

describe("角色卡 prompt 字段映射", () => {
	it("按酒馆的 marker 标识输出未改写的字段", () => {
		const mapping = mapCharacterCard(
			parseCharacterCardJson(JSON.stringify(v2Card)),
		);
		expect(
			mapping.sections.map((section) => [section.marker, section.text]),
		).toEqual([
			["charDescription", "角色描述正文"],
			["charPersonality", "性格正文"],
			["scenario", "场景正文"],
			["main", "系统提示正文"],
			["dialogueExamples", "示例正文"],
			["jailbreak", "历史后指令正文"],
		]);
		expect(mapping.report.fields).toEqual([
			{ field: "description", marker: "charDescription", chars: 6 },
			{ field: "personality", marker: "charPersonality", chars: 4 },
			{ field: "scenario", marker: "scenario", chars: 4 },
			{ field: "system_prompt", marker: "main", chars: 6 },
			{
				field: "mes_example",
				marker: "dialogueExamples",
				chars: 4,
			},
			{
				field: "post_history_instructions",
				marker: "jailbreak",
				chars: 7,
			},
		]);
	});

	it("作者注释只作为元数据，不进入 prompt", () => {
		const mapping = mapCharacterCard(
			parseCharacterCardJson(JSON.stringify(v2Card)),
		);
		expect(mapping.creatorNotes).toBe("作者注释正文");
		expect(
			mapping.sections.some((section) => section.text.includes("作者注释正文")),
		).toBe(false);
		expect(mapping.report.creatorNotesChars).toBe(6);
	});

	it("保留 V1 的 creatorcomment、V3 的昵称与资产，未知字段只记名字", () => {
		const v1 = parseCharacterCardJson(
			JSON.stringify({
				name: "旧卡",
				description: "旧描述",
				creatorcomment: "旧作者注释",
			}),
		);
		const v1Mapping = mapCharacterCard(v1);
		expect(v1Mapping.creatorNotes).toBe("旧作者注释");
		expect(v1Mapping.report.spec).toBe("chara_card_v1");

		const v3 = parseCharacterCardJson(JSON.stringify(v3Card));
		const mapping = mapCharacterCard(v3);
		expect(mapping.report.spec).toBe("chara_card_v3");
		expect(mapping.report.unknownFields).toEqual(["unknown_card_field"]);
		expect(mapping.raw).toBe(v3.raw);
		expect((mapping.raw.data as JsonObject).assets).toEqual([
			{ type: "icon", uri: "embedded" },
		]);
		expect(JSON.stringify(mapping.report)).not.toContain("未知字段正文");
	});

	it("PNG 卡与 JSON 卡映射结果一致", () => {
		const png = buildPngCard([
			{ keyword: "ccv3", value: JSON.stringify(v2Card) },
		]);
		const fromPng = mapCharacterCard(parseCharacterCardPng(png));
		const fromJson = mapCharacterCard(
			parseCharacterCardJson(JSON.stringify(v2Card)),
		);
		expect(fromPng.sections).toEqual(fromJson.sections);
		expect(fromPng.report).toEqual(fromJson.report);
	});

	it("内嵌世界书只记录条目数，不展开正文", () => {
		const card = parseCharacterCardJson(
			JSON.stringify({
				spec: "chara_card_v2",
				data: {
					name: "卡",
					character_book: {
						entries: [
							{ keys: ["甲"], content: "世界书正文一" },
							{ keys: ["乙"], content: "世界书正文二" },
						],
					},
				},
			}),
		);
		const mapping = mapCharacterCard(card);
		expect(mapping.report.embeddedBookEntries).toBe(2);
		expect(JSON.stringify(mapping.report)).not.toContain("世界书正文");
	});

	it("扩展键进入报告，值不进入报告", () => {
		const mapping = mapCharacterCard(
			parseCharacterCardJson(JSON.stringify(v2Card)),
		);
		expect(mapping.report.extensionKeys).toEqual(["talkativeness", "world"]);
		expect(JSON.stringify(mapping.report)).not.toContain("测试世界");
	});
});

describe("开场问候", () => {
	const card = parseCharacterCardJson(JSON.stringify(v2Card));

	it("单聊候选包含开场白与备用问候，不包含群聊问候", () => {
		expect(listCharacterGreetings(card)).toEqual([
			{ kind: "first", index: null, text: "开场白正文" },
			{ kind: "alternate", index: 0, text: "备用开场一" },
			{ kind: "alternate", index: 1, text: "备用开场二" },
		]);
	});

	it("群聊优先使用群聊问候", () => {
		expect(listCharacterGreetings(card, { group: true })).toEqual([
			{ kind: "group-only", index: 0, text: "群聊开场" },
		]);
	});

	it("选择备用问候与越界报错", () => {
		expect(selectCharacterGreeting(card, { alternateIndex: 1 })).toEqual({
			kind: "alternate",
			index: 1,
			text: "备用开场二",
		});
		expect(() => selectCharacterGreeting(card, { alternateIndex: 2 })).toThrow(
			/备用问候/,
		);
		expect(() =>
			selectCharacterGreeting(card, { group: true, alternateIndex: 0 }),
		).toThrow(/群聊/);
	});
});

describe("人设设置", () => {
	const settings: JsonObject = {
		username: "玩家名",
		user_avatar: "user-default.png",
		power_user: {
			personas: { "user-default.png": "人设名" },
			persona_descriptions: {
				"user-default.png": {
					description: "人设描述正文",
					title: "称号",
					position: 3,
					depth: 2,
					role: 1,
					lorebook: "人设世界书",
				},
			},
		},
	};

	it("读取活动人设的名字、描述、位置、深度、角色与世界书", () => {
		expect(readStPersona(settings)).toEqual({
			avatar: "user-default.png",
			name: "人设名",
			description: "人设描述正文",
			title: "称号",
			position: 3,
			depth: 2,
			role: 1,
			lorebook: "人设世界书",
		});
	});

	it("没有活动人设时返回 null；字符串形式的描述可以使用", () => {
		expect(readStPersona({ username: "玩家名" })).toBeNull();
		expect(
			readStPersona({
				username: "玩家名",
				user_avatar: "a.png",
				power_user: {
					personas: { "a.png": "甲" },
					persona_descriptions: { "a.png": "字符串描述" },
					persona_description_position: 0,
					persona_description_depth: 4,
					persona_description_role: 0,
				},
			}),
		).toEqual({
			avatar: "a.png",
			name: "甲",
			description: "字符串描述",
			title: null,
			position: 0,
			depth: 4,
			role: 0,
			lorebook: null,
		});
	});

	it("位置、深度与角色非法时报错并指出字段", () => {
		const base = {
			power_user: {
				personas: { "a.png": "甲" },
				persona_descriptions: { "a.png": { description: "描述" } },
			},
			user_avatar: "a.png",
		};
		expect(() =>
			readStPersona({
				...base,
				power_user: {
					...base.power_user,
					persona_description_position: 9,
				},
			}),
		).toThrow(/position/);
		expect(() =>
			readStPersona({
				...base,
				power_user: {
					...base.power_user,
					persona_description_depth: -1,
				},
			}),
		).toThrow(/depth/);
		expect(() =>
			readStPersona({
				...base,
				power_user: {
					...base.power_user,
					persona_description_role: 5,
				},
			}),
		).toThrow(/role/);
	});

	it("映射位置与角色，并把原生表达不了的部分记入 issues", () => {
		const persona = readStPersona(settings);
		if (persona === null) throw new Error("测试人设缺失");
		const mapping = mapStPersona(persona);
		expect(mapping.marker).toBe("personaDescription");
		expect(mapping.text).toBe("人设描述正文");
		expect(mapping.role).toBe("user");
		expect(mapping.placement).toBe("in-chat");
		expect(mapping.depth).toBe(2);
		expect(mapping.issues.map((issue) => issue.code)).toEqual([
			"persona-depth",
			"persona-role",
			"persona-lorebook",
		]);

		const relative = mapStPersona({
			...persona,
			position: 0,
			role: 0,
			lorebook: null,
		});
		expect(relative.placement).toBe("relative");
		expect(relative.issues).toEqual([]);

		expect(
			mapStPersona({ ...persona, position: 1, role: 0, lorebook: null })
				.issues[0]?.code,
		).toBe("persona-author-note-top");
		expect(
			mapStPersona({ ...persona, position: 2, role: 0, lorebook: null })
				.issues[0]?.code,
		).toBe("persona-author-note-bottom");
	});
});

describe("聊天作者注释", () => {
	it("读取正文、间隔、位置、深度与角色", () => {
		expect(
			readStAuthorNote({
				note_prompt: "作者注释正文",
				note_interval: 2,
				note_position: 1,
				note_depth: 3,
				note_role: 2,
			}),
		).toEqual({
			text: "作者注释正文",
			interval: 2,
			position: "before",
			depth: 3,
			role: "assistant",
		});
	});

	it("没有正文或没有元数据时返回 null", () => {
		expect(readStAuthorNote(undefined)).toBeNull();
		expect(readStAuthorNote({})).toBeNull();
		expect(readStAuthorNote({ note_prompt: "  " })).toBeNull();
		expect(readStAuthorNote(null)).toBeNull();
	});

	it("位置、深度、角色与间隔非法时报错", () => {
		expect(() =>
			readStAuthorNote({ note_prompt: "x", note_position: 4 }),
		).toThrow(/note_position/);
		expect(() =>
			readStAuthorNote({ note_prompt: "x", note_depth: -1 }),
		).toThrow(/note_depth/);
		expect(() => readStAuthorNote({ note_prompt: "x", note_role: 3 })).toThrow(
			/note_role/,
		);
		expect(() =>
			readStAuthorNote({ note_prompt: "x", note_interval: 0 }),
		).toThrow(/note_interval/);
	});
});
