import { describe, expect, it } from "vitest";
import { analyzePresets, scanMacros } from "../src/health/preset-health.js";
import { parsePresetJson } from "../src/preset.js";

const presetText = `{
	"name": "测试预设",
	"assistant_prefill": "预填充",
	"prompts": [
		{"identifier": "a", "content": "{{char}} {{setvar::x::1}} {{getvar::x}}", "enabled": true},
		{"identifier": "b", "content": "{{// 注释}} {{roll 1d100}}", "enabled": false, "marker": true}
	],
	"extensions": {
		"regex_scripts": [
			{"scriptName": "一", "placement": [1, 2], "disabled": false, "markdownOnly": true, "promptOnly": false, "runOnEdit": true, "minDepth": 2, "maxDepth": null, "substituteRegex": 1},
			{"scriptName": "二", "placement": [2], "disabled": true}
		]
	}
}`;

describe("scanMacros", () => {
	it("宏名取 :: 或空白之前的第一个词，注释归为 //", () => {
		const scan = scanMacros(
			"{{char}} {{setvar::x::1}} {{getvar::x}} {{// 注释}} {{roll 1d100}} {{Roll: d6}}",
		);
		expect(Object.fromEntries(scan.counts)).toEqual({
			char: 1,
			setvar: 1,
			getvar: 1,
			"//": 1,
			roll: 2,
		});
	});

	it("无法识别的写法只计数，不当作宏名", () => {
		const scan = scanMacros("{{中文写法}} {{char}}");
		expect(Object.fromEntries(scan.counts)).toEqual({ char: 1 });
		expect(scan.unrecognized).toBe(1);
	});
});

describe("analyzePresets", () => {
	it("统计提示词、宏、正则范围和开关", () => {
		const preset = parsePresetJson(presetText);
		const stats = analyzePresets([preset]);
		expect(stats.presetCount).toBe(1);
		expect(stats.promptCount).toBe(2);
		expect(stats.enabledPromptCount).toBe(1);
		expect(stats.markerPromptCount).toBe(1);
		expect(stats.presetsWithAssistantPrefill).toBe(1);
		expect(
			Object.fromEntries(
				stats.macros.map((macro) => [macro.name, macro.count]),
			),
		).toEqual({
			char: 1,
			setvar: 1,
			getvar: 1,
			"//": 1,
			roll: 1,
		});
		expect(
			stats.macros.find((macro) => macro.name === "char")?.presetCount,
		).toBe(1);
		expect(stats.regexScriptCount).toBe(2);
		expect(stats.disabledRegexScriptCount).toBe(1);
		expect(stats.markdownOnlyCount).toBe(1);
		expect(stats.promptOnlyCount).toBe(0);
		expect(stats.runOnEditCount).toBe(1);
		expect(stats.depthLimitedCount).toBe(1);
		expect(stats.placements).toEqual([
			{ placement: 1, label: "USER_INPUT", scriptCount: 1 },
			{ placement: 2, label: "AI_OUTPUT", scriptCount: 2 },
		]);
		expect(stats.substituteRegex).toEqual([
			{ value: 1, label: "RAW", scriptCount: 1 },
		]);
	});
});
