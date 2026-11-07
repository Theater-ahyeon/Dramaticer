import { describe, expect, it } from "vitest";
import type { StRegexScript } from "../src/preset.js";
import {
	classifyRegexScript,
	containsHtmlElement,
	containsInlineScript,
	parseRegexLiteral,
	readCaptureReferences,
	scanCaptureGroups,
} from "../src/regex-classifier.js";

function script(
	overrides: Partial<StRegexScript> & {
		findRegex: string;
		replaceString: string;
	},
): StRegexScript {
	return {
		id: "id",
		scriptName: "脚本",
		trimStrings: [],
		placement: [2],
		disabled: false,
		markdownOnly: false,
		promptOnly: false,
		runOnEdit: false,
		substituteRegex: null,
		minDepth: null,
		maxDepth: null,
		raw: {},
		...overrides,
	};
}

const draftRender = script({
	scriptName: "草稿本",
	findRegex: "/<erii_draft>([\\s\\S]*?)<\\/erii_draft>/g",
	replaceString: '<div class="draft">$1</div>',
	markdownOnly: true,
});

const draftStreaming = script({
	scriptName: "草稿本·进行中（流式）",
	findRegex: "/<erii_draft>(?![\\s\\S]*?<\\/erii_draft>)[\\s\\S]*$/g",
	replaceString: "<style>.draft{color:red}</style>",
	markdownOnly: true,
});

describe("parseRegexLiteral", () => {
	it("拆开分隔符和 flags", () => {
		expect(parseRegexLiteral("/a\\/b/gi")).toEqual({
			source: "a\\/b",
			flags: "gi",
		});
		expect(parseRegexLiteral("^x$")).toEqual({ source: "^x$", flags: "" });
		expect(parseRegexLiteral("/unterminated")).toEqual({
			source: "/unterminated",
			flags: "",
		});
	});
});

describe("scanCaptureGroups", () => {
	it("区分捕获组、非捕获组和断言", () => {
		expect(
			scanCaptureGroups("(a)(?:b)(?=c)(?!d)(?<=e)(?<!f)(?<name>g)(h)").length,
		).toBe(3);
		expect(scanCaptureGroups("\\\\(a)").length).toBe(1);
		expect(scanCaptureGroups("[(](a)").length).toBe(1);
	});
});

describe("readCaptureReferences", () => {
	it("读取编号、命名和整体引用", () => {
		expect(readCaptureReferences("$2\n$1 $<name> $& $$")).toEqual([
			{ kind: "number", number: 2 },
			{ kind: "number", number: 1 },
			{ kind: "named", number: null },
			{ kind: "whole", number: null },
		]);
		expect(readCaptureReferences("普通文本")).toEqual([]);
	});
});

describe("HTML 判定", () => {
	it("只把真正的 HTML 元素当作 HTML", () => {
		expect(containsHtmlElement("<div>x</div>")).toBe(true);
		expect(containsHtmlElement("```html\n<!DOCTYPE html>")).toBe(true);
		expect(
			containsHtmlElement("<interactive_input>x</interactive_input>"),
		).toBe(false);
		expect(containsHtmlElement("<options>$1</options>")).toBe(false);
	});

	it("脚本、事件属性和 iframe 都算内联脚本", () => {
		expect(containsInlineScript('<div onclick="x()">a</div>')).toBe(true);
		expect(containsInlineScript("<script>alert(1)</script>")).toBe(true);
		expect(containsInlineScript('<iframe src="a"></iframe>')).toBe(true);
		expect(containsInlineScript("<div>a</div>")).toBe(false);
	});
});

describe("classifyRegexScript 分类", () => {
	it("html_render：完整标签块渲染成 HTML，可升级为渲染器", () => {
		const result = classifyRegexScript(draftRender);
		expect(result.category).toBe("html_render");
		expect(result.tagName).toBe("erii_draft");
		expect(result.wholeTagBlock).toBe(true);
		expect(result.deleteScope).toBeNull();
		expect(result.upgrade).toEqual({
			applicable: true,
			strategy: "renderer",
		});
	});

	it("html_script：带脚本的渲染只能进沙箱", () => {
		const result = classifyRegexScript(
			script({
				findRegex: "/<tucao>([\\s\\S]*?)<\\/tucao>/g",
				replaceString: '<div><script>alert("$1")</script></div>',
			}),
		);
		expect(result.category).toBe("html_script");
		expect(result.hasInlineScript).toBe(true);
		expect(result.upgrade).toEqual({
			applicable: false,
			strategy: "sandbox_renderer",
		});
	});

	it("delete：只影响显示、只影响 prompt、带深度限制", () => {
		const display = classifyRegexScript(
			script({
				findRegex: "/<note>[\\s\\S]*?<\\/note>/g",
				replaceString: "",
				markdownOnly: true,
			}),
		);
		expect(display.category).toBe("delete");
		expect(display.deleteScope).toBe("display");
		expect(display.wholeTagBlock).toBe(true);
		expect(display.upgrade).toEqual({
			applicable: true,
			strategy: "block_policy",
		});

		const prompt = classifyRegexScript(
			script({
				findRegex: "/<note>[\\s\\S]*?<\\/note>/g",
				replaceString: " ",
				promptOnly: true,
				minDepth: 4,
			}),
		);
		expect(prompt.category).toBe("delete");
		expect(prompt.deleteScope).toBe("prompt");
		expect(prompt.depthScoped).toBe(true);

		const both = classifyRegexScript(
			script({
				findRegex: "/<note>[\\s\\S]*?<\\/note>/g",
				replaceString: "",
				markdownOnly: true,
				promptOnly: true,
			}),
		);
		expect(both.deleteScope).toBe("both");
	});

	it("delete：删除正文片段不是标签块，保留原正则", () => {
		const result = classifyRegexScript(
			script({
				scriptName: "口癖清洗",
				findRegex: "/极其|极为/g",
				replaceString: "",
				promptOnly: true,
			}),
		);
		expect(result.category).toBe("delete");
		expect(result.tagName).toBeNull();
		expect(result.wholeTagBlock).toBe(false);
		expect(result.upgrade).toEqual({
			applicable: false,
			strategy: "keep_regex",
		});
	});

	it("strip_cot：删除思考块", () => {
		const block = classifyRegexScript(
			script({
				scriptName: "思考块·历史剥离",
				findRegex: "/(<(think|thinking)>)([\\s\\S]*?)(<\\/(think|thinking)>)/g",
				replaceString: "",
				promptOnly: true,
			}),
		);
		expect(block.category).toBe("strip_cot");
		expect(block.deleteScope).toBe("prompt");
		expect(block.upgrade).toEqual({
			applicable: true,
			strategy: "block_policy",
		});

		const partial = classifyRegexScript(
			script({
				scriptName: "ds思维链对ai隐藏",
				findRegex: "/^([\\s\\S]*?)(<\\/think>|<\\/thinking>)/",
				replaceString: "",
				promptOnly: true,
			}),
		);
		expect(partial.category).toBe("strip_cot");
		expect(partial.wholeTagBlock).toBe(false);
		expect(partial.upgrade).toEqual({
			applicable: false,
			strategy: "keep_regex",
		});
	});

	it("rewrite_capture：重排或包裹捕获内容", () => {
		const reorder = classifyRegexScript(
			script({
				scriptName: "调换顺序",
				findRegex: "/(<甲>[\\s\\S]*?<\\/甲>)[\\s\\S]*(<乙>[\\s\\S]*?<\\/乙>)/",
				replaceString: "$2\n$1",
			}),
		);
		expect(reorder.category).toBe("rewrite_capture");

		const wrap = classifyRegexScript(
			script({
				findRegex: "^([\\s\\S]*)$",
				replaceString: "<interactive_input>\n$1\n</interactive_input>",
				promptOnly: true,
			}),
		);
		expect(wrap.category).toBe("rewrite_capture");
		expect(wrap.rendersHtml).toBe(false);
	});

	it("text_replace：纯文本替换", () => {
		const result = classifyRegexScript(
			script({
				scriptName: "口癖",
				findRegex: "/由于/g",
				replaceString: "因为",
			}),
		);
		expect(result.category).toBe("text_replace");
		expect(result.captureReferences).toEqual([]);
	});

	it("streaming_variant：等未闭合标签的同预设渲染器存在时可合并", () => {
		const siblings = [draftRender, draftStreaming];
		const merged = classifyRegexScript(draftStreaming, siblings);
		expect(merged.category).toBe("streaming_variant");
		expect(merged.streaming).toBe(true);
		expect(merged.tagName).toBe("erii_draft");
		expect(merged.upgrade).toEqual({
			applicable: true,
			strategy: "renderer",
		});

		const alone = classifyRegexScript(draftStreaming, [draftStreaming]);
		expect(alone.upgrade).toEqual({
			applicable: false,
			strategy: "keep_regex",
		});
	});

	it("streaming_variant：脚本名里的流式标记也算", () => {
		const result = classifyRegexScript(
			script({
				scriptName: "1美化最近2层思维链（流式）",
				findRegex: "/([\\s\\S]*)<\\/think(ing)?>/g",
				replaceString: "<style>.t{color:red}</style>",
			}),
		);
		expect(result.category).toBe("streaming_variant");
	});

	it("html_render：没有匹配完整标签块时不升级", () => {
		const result = classifyRegexScript(
			script({
				findRegex: "/([\\s\\S]*)<\\/think(ing)?>/g",
				replaceString: "<div>$1</div>",
			}),
		);
		expect(result.category).toBe("html_render");
		expect(result.wholeTagBlock).toBe(false);
		expect(result.upgrade).toEqual({
			applicable: false,
			strategy: "keep_regex",
		});
	});

	it("html_render：替换没有引用捕获内容时不升级", () => {
		const result = classifyRegexScript(
			script({
				findRegex: "/<note>([\\s\\S]*?)<\\/note>/g",
				replaceString: '<div class="note">固定文本</div>',
			}),
		);
		expect(result.category).toBe("html_render");
		expect(result.wholeTagBlock).toBe(true);
		expect(result.upgrade).toEqual({
			applicable: false,
			strategy: "keep_regex",
		});
	});

	it("空正则归入 unclassified", () => {
		const result = classifyRegexScript(
			script({ findRegex: "", replaceString: "<div>x</div>" }),
		);
		expect(result.category).toBe("unclassified");
		expect(result.upgrade).toEqual({
			applicable: false,
			strategy: "keep_regex",
		});
	});
});
