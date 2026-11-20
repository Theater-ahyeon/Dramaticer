import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapPresetToWritingDials, parsePresetJson } from "../src/index.js";

function preset() {
	const text = readFileSync(
		join(import.meta.dirname, "fixtures", "writing-preset.json"),
		"utf8",
	);
	return parsePresetJson(text);
}

describe("导入预设时的写作选项对应", () => {
	it("按条目名与内容对应到选项，其余按原顺序拼成文风包", () => {
		const { dials, mapping } = mapPresetToWritingDials(preset());

		expect(mapping).toEqual({
			name: "清风预设",
			total: 5,
			mapped: 3,
			packCount: 2,
			packText: "多写眼前的景物。\n\n语气温和，不用感叹号。",
		});
		expect(dials).toEqual({ style: "cold", person: "first", length: "long" });
	});

	it("标记类条目与停用的条目不参与对应也不进文风包", () => {
		const { mapping } = mapPresetToWritingDials(preset());
		expect(mapping.packText).not.toContain("这条已经停用");
		expect(mapping.packText).not.toContain("世界书前");
	});

	it("预设没有名字时用给定的名字", () => {
		const parsed = preset();
		const { mapping } = mapPresetToWritingDials(
			{ ...parsed, name: null },
			"手写的预设",
		);
		expect(mapping.name).toBe("手写的预设");
	});
});

describe("导入预设时的写作条目", () => {
	const text = JSON.stringify({
		name: "注入预设",
		prompts: [
			{
				identifier: "main",
				name: "主提示",
				content: "你是{{char}}，陪{{user}}演一场戏。{{// 作者注释}}",
				role: "system",
			},
			{
				identifier: "chatHistory",
				name: "历史",
				system_prompt: true,
				marker: true,
			},
			{
				identifier: "jailbreak",
				name: "收尾",
				content: "继续写下去。",
				role: "user",
			},
			{
				identifier: "deep",
				name: "深处提醒",
				content: "记得{{random::甲::乙}}。",
				role: "assistant",
				injection_position: 1,
				injection_depth: 2,
				injection_order: 50,
			},
			{ identifier: "off", name: "停用", content: "不要出现", enabled: false },
		],
		prompt_order: [
			{
				character_id: 100001,
				order: [
					{ identifier: "main", enabled: true },
					{ identifier: "chatHistory", enabled: true },
					{ identifier: "jailbreak", enabled: true },
					{ identifier: "deep", enabled: true },
					{ identifier: "off", enabled: false },
				],
			},
		],
	});

	it("保留位置、深度与角色，替换名字宏，去掉注释", () => {
		const { entries, report } = mapPresetToWritingDials(
			parsePresetJson(text),
			"预设",
			{ char: "山神" },
		);
		expect(
			entries.map(({ name, content, role, placement, depth, order }) => ({
				name,
				content,
				role,
				placement,
				depth,
				order,
			})),
		).toEqual([
			{
				name: "主提示",
				content: "你是山神，陪玩家演一场戏。",
				role: "system",
				placement: "before-history",
				depth: 0,
				order: 0,
			},
			{
				name: "收尾",
				content: "继续写下去。",
				role: "user",
				placement: "after-history",
				depth: 0,
				order: 2,
			},
			{
				name: "深处提醒",
				content: "记得{{random::甲::乙}}。",
				role: "assistant",
				placement: "in-history",
				depth: 2,
				order: 50,
			},
		]);
		expect(report).toEqual({ inHistory: 1, unresolvedMacros: 1, dropped: 0 });
	});
});
