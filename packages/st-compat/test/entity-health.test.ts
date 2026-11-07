import { describe, expect, it } from "vitest";
import { parseCharacterCardJson } from "../src/character-card.js";
import {
	summarizeCard,
	summarizeEntities,
	summarizeWorld,
} from "../src/health/entity-health.js";
import { parseWorldInfoJson } from "../src/world-info.js";

const card = parseCharacterCardJson(
	JSON.stringify({
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: "卡",
			description: "描述",
			personality: "安静",
			scenario: "场景",
			first_mes: "开场",
			mes_example: "示例",
			creator_notes: "备注",
			system_prompt: "系统",
			post_history_instructions: "后置",
			tags: ["一", "二"],
			alternate_greetings: ["备用"],
			group_only_greetings: ["群聊"],
			character_book: {
				entries: [
					{ keys: ["甲"], content: "甲" },
					{ keys: ["乙"], content: "乙" },
				],
			},
		},
	}),
);

const world = parseWorldInfoJson(
	JSON.stringify({
		entries: {
			"0": {
				uid: 0,
				key: ["龙", " Dragon "],
				keysecondary: ["鳞"],
				content: "龙的内容",
				constant: true,
			},
			"1": {
				uid: 1,
				key: ["剑"],
				content: "剑的内容",
				disable: true,
			},
		},
	}),
);

describe("summarizeCard", () => {
	it("统计卡文本字段和条目数量", () => {
		const stats = summarizeCard(card);
		expect(stats.spec).toBe("chara_card_v2");
		expect(stats.tagCount).toBe(2);
		expect(stats.alternateGreetingCount).toBe(1);
		expect(stats.groupOnlyGreetingCount).toBe(1);
		expect(stats.embeddedBookEntryCount).toBe(2);
		expect(
			stats.fieldBytes.find((field) => field.field === "description")?.bytes,
		).toBe(Buffer.byteLength("描述", "utf8"));
	});
});

describe("summarizeWorld", () => {
	it("统计条目、启用状态和关键词", () => {
		const stats = summarizeWorld(world);
		expect(stats.entryCount).toBe(2);
		expect(stats.enabledEntryCount).toBe(1);
		expect(stats.constantEntryCount).toBe(1);
		expect(stats.primaryKeywordCount).toBe(3);
		expect(stats.secondaryKeywordCount).toBe(1);
		expect(stats.distinctPrimaryKeywordCount).toBe(3);
		expect(stats.contentBytes).toBe(
			Buffer.byteLength("龙的内容", "utf8") +
				Buffer.byteLength("剑的内容", "utf8"),
		);
	});
});

describe("summarizeEntities", () => {
	it("汇总卡和世界书", () => {
		const stats = summarizeEntities([card], [world]);
		expect(stats.totals).toEqual({
			cardCount: 1,
			worldCount: 1,
			worldEntryCount: 2,
			enabledWorldEntryCount: 1,
			constantWorldEntryCount: 1,
			distinctPrimaryKeywordCount: 3,
			embeddedBookEntryCount: 2,
		});
	});
});
