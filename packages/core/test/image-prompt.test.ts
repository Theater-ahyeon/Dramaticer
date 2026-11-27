import { describe, expect, it } from "vitest";
import {
	type CharacterVisualProfile,
	DEFAULT_IMAGE_NEGATIVE_PROMPT,
	compileImagePrompt,
	emptyVisualSlotGrid,
} from "../src/index.js";

const rin: CharacterVisualProfile = {
	character: "凛",
	base: ["black long hair", "red eyes"],
	defaultOutfit: "深蓝校服",
	outfitPath: ["character", "凛", "outfit"],
	negative: ["glasses", "glasses"],
	seed: null,
	backends: {},
	locked: false,
	slots: emptyVisualSlotGrid(),
};

const lan: CharacterVisualProfile = {
	character: "阿岚",
	base: ["短发"],
	defaultOutfit: "灰色夹克",
	outfitPath: null,
	negative: ["smile"],
	seed: 7,
	backends: {},
	locked: false,
	slots: emptyVisualSlotGrid(),
};

describe("标签式提示词", () => {
	it("按基础外貌、当前服装、场景、镜头、气氛拼接并去重", () => {
		const compiled = compileImagePrompt({
			profiles: [rin],
			state: { character: { 凛: { outfit: "白衬衫" } } },
			request: {
				characters: ["凛"],
				scene: "图书馆",
				shot: "medium",
				mood: "紧张",
			},
			style: "tags",
		});

		expect(compiled.prompt).toBe(
			"black long hair, red eyes, 白衬衫, 图书馆, medium, 紧张",
		);
		expect(compiled.negativePrompt).toBe(
			`glasses, ${DEFAULT_IMAGE_NEGATIVE_PROMPT}`,
		);
		expect(compiled.missingProfiles).toEqual([]);
	});

	it("服装优先取台账，读不到时用默认服装", () => {
		const withState = compileImagePrompt({
			profiles: [rin],
			state: { character: { 凛: { outfit: "白衬衫" } } },
			request: { characters: ["凛"], scene: "走廊" },
			style: "tags",
		});
		expect(withState.prompt).toBe("black long hair, red eyes, 白衬衫, 走廊");

		const missingPath = compileImagePrompt({
			profiles: [rin],
			state: {},
			request: { characters: ["凛"], scene: "走廊" },
			style: "tags",
		});
		expect(missingPath.prompt).toBe(
			"black long hair, red eyes, 深蓝校服, 走廊",
		);

		const noPath = compileImagePrompt({
			profiles: [lan],
			state: { character: { 阿岚: { outfit: "雨衣" } } },
			request: { characters: ["阿岚"], scene: "走廊" },
			style: "tags",
		});
		expect(noPath.prompt).toBe("短发, 灰色夹克, 走廊");
	});

	it("重复标签只保留一次", () => {
		const duplicated: CharacterVisualProfile = {
			...rin,
			base: ["白衬衫", "red eyes"],
			defaultOutfit: "白衬衫",
		};
		const compiled = compileImagePrompt({
			profiles: [duplicated],
			state: {},
			request: { characters: ["凛"], scene: "白衬衫" },
			style: "tags",
		});
		expect(compiled.prompt).toBe("白衬衫, red eyes");
	});

	it("没有档案的人物进入提示词并列入 missingProfiles", () => {
		const compiled = compileImagePrompt({
			profiles: [rin],
			state: {},
			request: { characters: ["凛", "阿岚", "凛"], scene: "走廊" },
			style: "tags",
		});
		expect(compiled.prompt).toBe(
			"black long hair, red eyes, 深蓝校服, 阿岚, 走廊",
		);
		expect(compiled.missingProfiles).toEqual(["阿岚"]);
	});
});

describe("自然语言提示词", () => {
	it("按人物、镜头与气氛拼成句子", () => {
		const compiled = compileImagePrompt({
			profiles: [rin, lan],
			state: { character: { 凛: { outfit: "白衬衫" } } },
			request: {
				characters: ["凛", "阿岚", "陌生客"],
				scene: "图书馆的窗边",
				shot: "close-up",
				mood: "紧张",
			},
			style: "natural",
		});

		expect(compiled.prompt).toBe(
			"图书馆的窗边。人物：凛（black long hair，red eyes，白衬衫）；阿岚（短发，灰色夹克）；陌生客。镜头：特写。气氛：紧张。",
		);
		expect(compiled.negativePrompt).toBe(
			`glasses, smile, ${DEFAULT_IMAGE_NEGATIVE_PROMPT}`,
		);
		expect(compiled.missingProfiles).toEqual(["陌生客"]);
	});

	it("没有人物时只描述场景与镜头", () => {
		const compiled = compileImagePrompt({
			profiles: [],
			state: {},
			request: { scene: "雪后的山门", shot: "scenery" },
			style: "natural",
		});
		expect(compiled.prompt).toBe("雪后的山门。镜头：风景。");
		expect(compiled.negativePrompt).toBe(DEFAULT_IMAGE_NEGATIVE_PROMPT);
	});
});

describe("提示词编译约束", () => {
	it("同一输入重复编译逐字节相同", () => {
		const input = {
			profiles: [rin, lan],
			state: { character: { 凛: { outfit: "白衬衫" } } },
			request: {
				characters: ["凛", "阿岚"],
				scene: "图书馆",
				shot: "wide" as const,
				mood: "安静",
			},
			style: "tags" as const,
		};
		const first = compileImagePrompt(input);
		const second = compileImagePrompt(structuredClone(input));
		expect(second).toEqual(first);
		expect(second.prompt).toBe(first.prompt);
		expect(second.negativePrompt).toBe(first.negativePrompt);
	});

	it("人物超过 4 个、空场景、非法镜头与空气氛都拒绝", () => {
		expect(() =>
			compileImagePrompt({
				profiles: [],
				state: {},
				request: {
					characters: ["甲", "乙", "丙", "丁", "戊"],
					scene: "走廊",
				},
				style: "tags",
			}),
		).toThrow("最多 4 个");
		expect(() =>
			compileImagePrompt({
				profiles: [],
				state: {},
				request: { characters: [" "], scene: "走廊" },
				style: "tags",
			}),
		).toThrow("characters[0]");
		expect(() =>
			compileImagePrompt({
				profiles: [],
				state: {},
				request: { scene: "  " },
				style: "tags",
			}),
		).toThrow("scene");
		expect(() =>
			compileImagePrompt({
				profiles: [],
				state: {},
				request: { scene: "走廊", shot: "aerial" as never },
				style: "tags",
			}),
		).toThrow("shot");
		expect(() =>
			compileImagePrompt({
				profiles: [],
				state: {},
				request: { scene: "走廊", mood: "" },
				style: "tags",
			}),
		).toThrow("mood");
		expect(() =>
			compileImagePrompt({
				profiles: [],
				state: {},
				request: { scene: "走廊" },
				style: "anime" as never,
			}),
		).toThrow("tags 或 natural");
	});
});
