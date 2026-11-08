import { parseBlocks } from "@dramaticer/core/blocks";
import { describe, expect, it } from "vitest";
import {
	blockViewKind,
	imageSourceOf,
	optionLinesOf,
	plainTextOf,
} from "../src/chat/blocks";

function findBlock(raw: string, name: string) {
	const block = parseBlocks(raw).find(
		(item) => item.kind === "block" && item.name === name,
	);
	if (block === undefined || block.kind !== "block") {
		throw new Error(`没有找到块 ${name}`);
	}
	return block;
}

describe("块的界面呈现", () => {
	it("原生块映射到各自组件，写入类块隐藏", () => {
		expect(blockViewKind(findBlock("<选项>走</选项>", "选项"))).toBe("options");
		expect(blockViewKind(findBlock("<页眉>序章</页眉>", "页眉"))).toBe(
			"header",
		);
		expect(blockViewKind(findBlock("<悄悄话>别动</悄悄话>", "悄悄话"))).toBe(
			"whisper",
		);
		expect(blockViewKind(findBlock("<旁白>风起了</旁白>", "旁白"))).toBe(
			"narration",
		);
		expect(blockViewKind(findBlock("<备忘>钥匙</备忘>", "备忘"))).toBe("memo");
		expect(blockViewKind(findBlock("<状态栏>体力 3</状态栏>", "状态栏"))).toBe(
			"status",
		);
		expect(blockViewKind(findBlock("<分析>他很紧张</分析>", "分析"))).toBe(
			"analysis",
		);
		expect(
			blockViewKind(
				findBlock("<图片>data:image/png;base64,AAA</图片>", "图片"),
			),
		).toBe("image");
		expect(
			blockViewKind(findBlock("<thinking>想一想</thinking>", "thinking")),
		).toBe("thinking");
		expect(
			blockViewKind(findBlock("<变量更新>{}</变量更新>", "变量更新")),
		).toBe("hidden");
	});

	it("未注册的标签保持为原文，未闭合块显示原文", () => {
		const content = parseBlocks("<未知>内容</未知>");
		expect(content).toEqual([{ kind: "text", text: "<未知>内容</未知>" }]);
		expect(
			blockViewKind({
				kind: "block",
				name: "未知",
				type: {
					name: "未知",
					display: { kind: "hidden" },
					context: { kind: "keep" },
					semantics: { kind: "none" },
				},
				complete: true,
				content: [],
				raw: "内容",
			}),
		).toBe("raw");
		const incomplete = findBlock("<旁白>还在写", "旁白");
		expect(incomplete.complete).toBe(false);
		expect(blockViewKind(incomplete)).toBe("raw");
	});

	it("选项行按行去掉空白且跳过空行", () => {
		const block = findBlock(
			"正文\n<选项>\n 点火把 \n\n继续走\n回头\n</选项>\n结束",
			"选项",
		);
		expect(optionLinesOf(block)).toEqual(["点火把", "继续走", "回头"]);
	});

	it("嵌套块的文字可以拼成纯文本", () => {
		const content = parseBlocks("开头<旁白>中间<备忘>最后</备忘></旁白>结尾");
		expect(plainTextOf(content)).toBe("开头中间最后结尾");
	});

	it("只有单个地址的图片块给出地址", () => {
		expect(imageSourceOf("\n data:image/png;base64,AAA \n")).toBe(
			"data:image/png;base64,AAA",
		);
		expect(
			imageSourceOf(
				"两张图 data:image/png;base64,AAA data:image/png;base64,BBB",
			),
		).toBeNull();
		expect(imageSourceOf("一段说明")).toBeNull();
	});
});
