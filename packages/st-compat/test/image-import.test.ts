import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	StoryStore as CoreStore,
	type WritingEntry,
	readWritingEntries,
	writeWritingEntries,
} from "@dramaticer/core";
import { describe, expect, it } from "vitest";
import {
	importImageCharacterLibrary,
	importImagePromptPreset,
	parseImageCharacterLibrary,
	parseImagePromptPreset,
} from "../src/index.js";

const characters = JSON.parse(
	readFileSync(
		join(import.meta.dirname, "fixtures/image-import/characters.json"),
		"utf8",
	),
) as unknown;

const preset = JSON.parse(
	readFileSync(
		join(import.meta.dirname, "fixtures/image-import/preset.json"),
		"utf8",
	),
) as unknown;

function storeWithStory(): CoreStore {
	const store = CoreStore.open(":memory:");
	store.createStory({ id: "s1", title: "插图导入" });
	return store;
}

describe("智绘姬角色 / 服装库导入", () => {
	it("解析 12 格、锁定与归属人物的服装", () => {
		const parsed = parseImageCharacterLibrary(characters);
		expect(parsed.profiles.map((profile) => profile.character)).toEqual([
			"凛",
			"阿岚",
		]);
		const rin = parsed.profiles.find((profile) => profile.character === "凛");
		expect(rin?.locked).toBe(true);
		expect(rin?.slots.face.front.clothed).toEqual(["face front clothed"]);
		expect(rin?.slots.full.back.bare).toEqual(["full back bare"]);
		expect(rin?.defaultOutfit).toBe("深蓝校服");
		expect(rin?.negative).toEqual(["bad hands"]);
		const alan = parsed.profiles.find(
			(profile) => profile.character === "阿岚",
		);
		expect(alan?.slots.face.front.bare).toEqual(["sharp eyes"]);
		expect(alan?.base).toEqual(["short silver hair", "amber eyes"]);
		const names = parsed.outfits.map(
			(outfit) => `${outfit.character}:${outfit.name}`,
		);
		expect(names).toEqual([
			"凛:深蓝校服",
			"凛:白色礼服",
			"凛:雨衣",
			"阿岚:灰色夹克",
		]);
		expect(
			parsed.outfits
				.filter((outfit) => outfit.isDefault)
				.map((outfit) => outfit.name),
		).toEqual(["深蓝校服", "灰色夹克"]);
		expect(
			parsed.outfits.find((outfit) => outfit.name === "白色礼服")?.locked,
		).toBe(true);
	});

	it("写进故事后可读回，服装按人物归属", () => {
		const store = storeWithStory();
		const result = importImageCharacterLibrary(store, "s1", characters);
		expect(result).toEqual({ profiles: 2, outfits: 4 });
		const profiles = store.listCharacterVisualProfiles("s1");
		expect(profiles.map((record) => record.profile.character)).toEqual([
			"凛",
			"阿岚",
		]);
		expect(profiles[0]?.profile.locked).toBe(true);
		const outfits = store.listCharacterOutfits("s1");
		expect(outfits).toHaveLength(4);
		expect(
			outfits.find((outfit) => outfit.name === "深蓝校服")?.upperVisible,
		).toEqual(["navy blazer"]);
		expect(
			outfits.find((outfit) => outfit.name === "灰色夹克")?.upperHidden,
		).toEqual(["jacket collar"]);
		store.close();
	});
});

describe("智绘姬生图提示词预设导入", () => {
	it("有关键词的条目成为标签库，其余成为画面整理条目", () => {
		const parsed = parseImagePromptPreset(preset);
		expect(parsed.tags.map((entry) => entry.name)).toEqual([
			"动作·拔剑",
			"表情·微笑",
		]);
		expect(parsed.tags[0]?.category).toBe("action");
		expect(parsed.tags[1]?.keywords).toEqual(["微笑", "smile"]);
		expect(parsed.writingEntries.map((entry) => entry.name)).toEqual([
			"画风",
			"常驻构图",
			"停用条目",
		]);
		expect(parsed.writingEntries[2]?.enabled).toBe(false);
	});

	it("导入后正文写作条目不变，标签与整理条目分别可读", () => {
		const store = storeWithStory();
		const turnEntry: WritingEntry = {
			id: "turn-1",
			name: "正文条目",
			content: "正文的内容",
			role: "system",
			placement: "after-history",
			depth: 0,
			order: 0,
			enabled: true,
			scope: "turn",
		};
		writeWritingEntries(store, "s1", [turnEntry]);

		const result = importImagePromptPreset(store, "s1", preset);

		expect(result).toEqual({ tagEntries: 2, writingEntries: 3 });
		const tags = store.listTagLibraryEntries("s1");
		expect(tags.map((entry) => entry.name)).toEqual(["动作·拔剑", "表情·微笑"]);
		expect(tags.every((entry) => entry.scope === "story")).toBe(true);
		const entries = readWritingEntries(store, "s1");
		expect(entries.find((entry) => entry.id === "turn-1")).toBeDefined();
		expect(
			entries
				.filter((entry) => entry.scope === "image_organizer")
				.map((entry) => entry.name),
		).toEqual(["画风", "常驻构图", "停用条目"]);
		store.close();
	});
});
