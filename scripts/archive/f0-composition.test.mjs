import { describe, expect, it } from "vitest";
import {
	classifyEdit,
	countTagCategories,
	createBlockTypes,
	depthBucketOf,
	isPlausibleGeneration,
	measureFencedCodeChars,
	measureReplyComposition,
	startsNewSegment,
} from "./f0-composition.mjs";

const types = createBlockTypes(new Set(["state_update", "选项", "image"]));

describe("depthBucketOf", () => {
	it("按楼层深度分桶", () => {
		expect(depthBucketOf(1)).toBe("1–10");
		expect(depthBucketOf(10)).toBe("1–10");
		expect(depthBucketOf(11)).toBe("11–50");
		expect(depthBucketOf(50)).toBe("11–50");
		expect(depthBucketOf(51)).toBe("51–100");
		expect(depthBucketOf(200)).toBe("101–200");
		expect(depthBucketOf(201)).toBe("201 以上");
	});

	it("拒绝非正整数", () => {
		expect(() => depthBucketOf(0)).toThrow("楼层序号必须是正整数");
		expect(() => depthBucketOf(1.5)).toThrow("楼层序号必须是正整数");
	});
});

describe("startsNewSegment", () => {
	it("间隔超过 30 分钟才算新段", () => {
		const start = Date.UTC(2026, 0, 1, 12, 0, 0);
		expect(startsNewSegment(start, start + 30 * 60 * 1000)).toBe(false);
		expect(startsNewSegment(start, start + 30 * 60 * 1000 + 1)).toBe(true);
	});

	it("缺失时间不算新段", () => {
		expect(startsNewSegment(Number.NaN, Date.now())).toBe(false);
	});
});

describe("isPlausibleGeneration", () => {
	it("只有非负且不超过 24 小时的耗时算有效", () => {
		const start = Date.UTC(2026, 0, 1, 12, 0, 0);
		expect(isPlausibleGeneration(start, start + 50_000)).toBe(true);
		expect(isPlausibleGeneration(start, start - 1)).toBe(false);
		expect(isPlausibleGeneration(start, start + 25 * 60 * 60 * 1000)).toBe(false);
		expect(isPlausibleGeneration(Number.NaN, start)).toBe(false);
	});
});

describe("measureFencedCodeChars", () => {
	it("统计围栏内的字符，包括围栏行", () => {
		const text = "前文\n```js\nconst a = 1;\n```\n后文";
		expect(measureFencedCodeChars(text)).toBe("```js".length + 1 + "const a = 1;".length + 1 + "```".length + 1);
	});

	it("未闭合的围栏算到结尾", () => {
		expect(measureFencedCodeChars("前\n```\nabc")).toBe("```".length + 1 + "abc".length);
	});
});

describe("measureReplyComposition", () => {
	it("计入已闭合的标签块与块外的代码", () => {
		const text = "开场<state_update>{\"path\":[]}</state_update>正文\n```\ncode\n```";
		const result = measureReplyComposition(text, types);
		expect(result.blockChars).toBe("<state_update>{\"path\":[]}</state_update>".length);
		expect(result.codeChars).toBe("```".length + 1 + "code".length + 1 + "```".length);
		expect(result.narrativeChars).toBe(text.length - result.blockChars - result.codeChars);
	});

	it("未闭合的块按正文处理", () => {
		const text = "开场<选项>没有闭合";
		const result = measureReplyComposition(text, types);
		expect(result.blockChars).toBe(0);
		expect(result.narrativeChars).toBe(text.length);
	});

	it("嵌套块只计顶层一次", () => {
		const text = "<选项>甲<image>乙</image>丙</选项>";
		const result = measureReplyComposition(text, types);
		expect(result.blockChars).toBe(text.length);
		expect(result.narrativeChars).toBe(0);
	});

	it("拒绝非字符串", () => {
		expect(() => measureReplyComposition(undefined, types)).toThrow(TypeError);
	});
});

describe("classifyEdit", () => {
	it("相同文本不算编辑", () => {
		expect(classifyEdit("正文", "正文", types)).toBeNull();
	});

	it("只差空白", () => {
		expect(classifyEdit("正文 一\n二", "正文一二", types)).toBe("只差空白");
	});

	it("末尾追加", () => {
		expect(classifyEdit("正文\n补充一句", "正文", types)).toBe("末尾追加");
	});

	it("只改标签块", () => {
		expect(classifyEdit("正文<state_update>{}</state_update>", "正文", types)).toBe("只改标签块");
		expect(classifyEdit("正文<state_update>{}</state_update>", "正文<state_update>[]</state_update>", types)).toBe("只改标签块");
	});

	it("少量手改", () => {
		expect(classifyEdit("今天天气很好，我们去公园散步吧。", "今天天气很好，我们去公园散步。", types)).toBe("少量手改");
	});

	it("正文大改", () => {
		expect(classifyEdit("完全不同的另一段文字", "今天天气很好，我们去公园散步吧。", types)).toBe("正文大改");
	});
});

describe("countTagCategories", () => {
	it("只数开标签，不数闭合标签", () => {
		const counts = countTagCategories("<UpdateVariable>a</UpdateVariable><JSONPatch/>");
		expect(counts.get("变量更新")).toBe(2);
	});

	it("同一类别里的多种标签累加", () => {
		const counts = countTagCategories("<image>a</image><pic>b</pic>");
		expect(counts.get("图片")).toBe(2);
	});

	it("没有命中时返回空表", () => {
		expect(countTagCategories("普通正文").size).toBe(0);
	});
});
