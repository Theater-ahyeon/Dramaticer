import { describe, expect, it } from "vitest";
import { analyzeRegexScripts } from "../src/health/regex-health.js";
import { parsePresetJson } from "../src/preset.js";

const presetText = `{
	"name": "正则统计",
	"extensions": {
		"regex_scripts": [
			{"scriptName": "草稿本", "findRegex": "/<draft>([\\\\s\\\\S]*?)<\\\\/draft>/g", "replaceString": "<div>$1</div>", "placement": [2], "markdownOnly": true},
			{"scriptName": "草稿本·流式", "findRegex": "/<draft>(?![\\\\s\\\\S]*?<\\\\/draft>)[\\\\s\\\\S]*$/g", "replaceString": "<style>.d{}</style>", "placement": [2], "markdownOnly": true},
			{"scriptName": "隐藏备注", "findRegex": "/<note>[\\\\s\\\\S]*?<\\\\/note>/g", "replaceString": "", "placement": [2], "promptOnly": true, "minDepth": 3},
			{"scriptName": "停用脚本", "findRegex": "/极其/g", "replaceString": "", "placement": [2], "disabled": true},
			{"scriptName": "内联脚本", "findRegex": "/<ui>([\\\\s\\\\S]*?)<\\\\/ui>/g", "replaceString": "<div><script>$1</script></div>", "placement": [2]}
		]
	}
}`;

describe("analyzeRegexScripts", () => {
	it("按分类、删除范围、升级策略和标签汇总", () => {
		const preset = parsePresetJson(presetText);
		const stats = analyzeRegexScripts([preset]);
		expect(stats.scriptCount).toBe(5);
		expect(stats.enabledScriptCount).toBe(4);
		expect(stats.disabledScriptCount).toBe(1);
		expect(stats.upgradableScriptCount).toBe(3);
		expect(
			Object.fromEntries(
				stats.categories.map((item) => [item.category, item.scriptCount]),
			),
		).toEqual({
			html_render: 1,
			html_script: 1,
			delete: 2,
			strip_cot: 0,
			rewrite_capture: 0,
			text_replace: 0,
			streaming_variant: 1,
			unclassified: 0,
		});
		expect(
			Object.fromEntries(
				stats.deleteScopes.map((item) => [item.scope, item.scriptCount]),
			),
		).toEqual({ display: 0, prompt: 1, both: 1 });
		expect(
			Object.fromEntries(
				stats.strategies.map((item) => [item.strategy, item.scriptCount]),
			),
		).toEqual({
			block_policy: 1,
			renderer: 2,
			sandbox_renderer: 1,
			keep_regex: 1,
		});
		expect(stats.topTags[0]).toEqual({ tag: "draft", scriptCount: 2 });
		expect(stats.depthScopedScriptCount).toBe(1);
		expect(stats.inlineScriptCount).toBe(1);
		expect(stats.streamingScriptCount).toBe(1);
	});
});
