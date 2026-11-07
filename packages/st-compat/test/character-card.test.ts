import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "../src/index.js";
import {
	parseCharacterCardFile,
	parseCharacterCardJson,
	parseCharacterCardPng,
} from "../src/index.js";
import { buildPngCard } from "./png-fixture.js";

const cardData: JsonObject = {
	name: "测试角色",
	description: "描述文本",
	personality: "性格文本",
	scenario: "场景文本",
	first_mes: "开场白",
	mes_example: "对话示例",
	creator_notes: "作者备注",
	system_prompt: "系统提示",
	post_history_instructions: "历史后指令",
	alternate_greetings: ["问候一", "问候二"],
	tags: ["标签一", "标签二"],
	creator: "作者",
	character_version: "1.2",
	extensions: { talkativeness: "0.5", world: "测试世界" },
};

const characterBook: JsonObject = {
	name: "内嵌世界书",
	entries: [{ keys: ["甲"], content: "条目正文", enabled: true }],
};

const v2Card: JsonObject = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: { ...cardData, character_book: characterBook },
};

const v3Card: JsonObject = {
	spec: "chara_card_v3",
	spec_version: "3.0",
	data: {
		...cardData,
		nickname: "小名",
		group_only_greetings: ["群聊问候"],
		assets: [{ type: "icon", uri: "embedded" }],
	},
};

const v1Card: JsonObject = {
	name: "旧卡",
	description: "旧描述",
	personality: "旧性格",
	scenario: "旧场景",
	first_mes: "旧开场",
	mes_example: "旧示例",
	creatorcomment: "旧备注",
	tags: ["旧标签"],
};

describe("parseCharacterCardJson", () => {
	it("解析 V2 卡的字段、世界书和扩展", () => {
		const card = parseCharacterCardJson(JSON.stringify(v2Card));
		expect(card.spec).toBe("chara_card_v2");
		expect(card.specVersion).toBe("2.0");
		expect(card.name).toBe("测试角色");
		expect(card.description).toBe("描述文本");
		expect(card.personality).toBe("性格文本");
		expect(card.scenario).toBe("场景文本");
		expect(card.firstMessage).toBe("开场白");
		expect(card.messageExample).toBe("对话示例");
		expect(card.creatorNotes).toBe("作者备注");
		expect(card.systemPrompt).toBe("系统提示");
		expect(card.postHistoryInstructions).toBe("历史后指令");
		expect(card.alternateGreetings).toEqual(["问候一", "问候二"]);
		expect(card.groupOnlyGreetings).toEqual([]);
		expect(card.nickname).toBeNull();
		expect(card.tags).toEqual(["标签一", "标签二"]);
		expect(card.creator).toBe("作者");
		expect(card.characterVersion).toBe("1.2");
		expect(card.characterBook).toEqual(characterBook);
		expect(card.extensions).toEqual({
			talkativeness: "0.5",
			world: "测试世界",
		});
	});

	it("世界书和扩展与原始对象共用同一个引用", () => {
		const card = parseCharacterCardJson(JSON.stringify(v2Card));
		const rawData = card.raw.data as JsonObject;
		expect(card.characterBook).toBe(rawData.character_book);
		expect(card.extensions).toBe(rawData.extensions);
	});

	it("解析 V3 卡并保留不认识的字段", () => {
		const card = parseCharacterCardJson(JSON.stringify(v3Card));
		expect(card.spec).toBe("chara_card_v3");
		expect(card.specVersion).toBe("3.0");
		expect(card.nickname).toBe("小名");
		expect(card.groupOnlyGreetings).toEqual(["群聊问候"]);
		expect((card.raw.data as JsonObject).assets).toEqual([
			{ type: "icon", uri: "embedded" },
		]);
	});

	it("兼容没有 data 节点的 V1 卡", () => {
		const card = parseCharacterCardJson(JSON.stringify(v1Card));
		expect(card.spec).toBe("chara_card_v1");
		expect(card.specVersion).toBeNull();
		expect(card.name).toBe("旧卡");
		expect(card.creatorNotes).toBe("旧备注");
		expect(card.characterBook).toBeNull();
		expect(card.extensions).toEqual({});
		expect(card.raw).toEqual(v1Card);
	});

	it("字段缺失时给出空值", () => {
		const card = parseCharacterCardJson(
			JSON.stringify({ spec: "chara_card_v2", data: {} }),
		);
		expect(card.name).toBe("");
		expect(card.alternateGreetings).toEqual([]);
		expect(card.tags).toEqual([]);
		expect(card.extensions).toEqual({});
	});

	it("解析带 BOM 的文件", () => {
		const card = parseCharacterCardJson(`\uFEFF${JSON.stringify(v2Card)}`);
		expect(card.name).toBe("测试角色");
	});

	it("非法 JSON、未知版本、缺 data、字段类型错误都会报错", () => {
		expect(() => parseCharacterCardJson("{草稿")).toThrow(/不是合法 JSON/);
		expect(() =>
			parseCharacterCardJson(
				JSON.stringify({ spec: "chara_card_v4", data: {} }),
			),
		).toThrow(/不支持的角色卡版本/);
		expect(() =>
			parseCharacterCardJson(JSON.stringify({ spec: "chara_card_v2" })),
		).toThrow(/"data"/);
		expect(() =>
			parseCharacterCardJson(
				JSON.stringify({ spec: "chara_card_v2", data: { name: 1 } }),
			),
		).toThrow(/"name"/);
		expect(() =>
			parseCharacterCardJson(
				JSON.stringify({
					spec: "chara_card_v2",
					data: { tags: ["标签", 2] },
				}),
			),
		).toThrow(/"tags\[1\]"/);
	});
});

describe("parseCharacterCardPng", () => {
	it("从 chara 文本块解析 V2 卡", () => {
		const png = buildPngCard([
			{ keyword: "chara", value: JSON.stringify(v2Card) },
		]);
		const card = parseCharacterCardPng(png);
		expect(card.spec).toBe("chara_card_v2");
		expect(card.name).toBe("测试角色");
		expect(card.characterBook).toEqual(characterBook);
	});

	it("同时存在 chara 和 ccv3 时使用 ccv3", () => {
		const legacy = {
			...v2Card,
			data: { ...cardData, name: "旧名字" },
		};
		const png = buildPngCard([
			{ keyword: "chara", value: JSON.stringify(legacy) },
			{ keyword: "ccv3", value: JSON.stringify(v3Card) },
		]);
		const card = parseCharacterCardPng(png);
		expect(card.spec).toBe("chara_card_v3");
		expect(card.name).toBe("测试角色");
	});

	it("没有角色卡文本块或不是 PNG 时报错", () => {
		const plainPng = buildPngCard([{ keyword: "Comment", value: "纯图片" }]);
		expect(() => parseCharacterCardPng(plainPng)).toThrow(/没有 chara 或 ccv3/);
		expect(() => parseCharacterCardPng(Buffer.from("not a png"))).toThrow(
			/不是 PNG/,
		);
	});

	it("文本块里的数据不是合法卡片时报错", () => {
		const png = buildPngCard([{ keyword: "chara", value: "{" }]);
		expect(() => parseCharacterCardPng(png)).toThrow(/角色卡数据解析失败/);
	});
});

describe("parseCharacterCardFile", () => {
	it("按文件内容识别 JSON 和 PNG", async () => {
		const dir = await mkdtemp(
			join(dirname(fileURLToPath(import.meta.url)), ".tmp-card-"),
		);
		try {
			const jsonPath = join(dir, "card.json");
			await writeFile(jsonPath, JSON.stringify(v3Card));
			const fromJson = await parseCharacterCardFile(jsonPath);
			expect(fromJson.spec).toBe("chara_card_v3");

			const pngPath = join(dir, "card.png");
			await writeFile(
				pngPath,
				buildPngCard([{ keyword: "chara", value: JSON.stringify(v2Card) }]),
			);
			const fromPng = await parseCharacterCardFile(pngPath);
			expect(fromPng.spec).toBe("chara_card_v2");
			expect(fromPng.name).toBe("测试角色");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("损坏的文件会报告路径", async () => {
		const dir = await mkdtemp(
			join(dirname(fileURLToPath(import.meta.url)), ".tmp-card-"),
		);
		try {
			const brokenPath = join(dir, "broken.png");
			await writeFile(brokenPath, Buffer.from("not a png"));
			await expect(parseCharacterCardFile(brokenPath)).rejects.toThrow(
				/解析角色卡失败.*broken\.png/,
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
