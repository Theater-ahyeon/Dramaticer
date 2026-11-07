import { describe, expect, it } from "vitest";
import {
	type BlockTypeDefinition,
	DEFAULT_BLOCK_TYPES,
	createBlockTypeRegistry,
	parseBlocks,
	renderContextView,
} from "../src/index.js";

const extraTypes: readonly BlockTypeDefinition[] = [
	{
		name: "临时",
		display: { kind: "hidden" },
		context: { kind: "keep-depth", depth: 2 },
		semantics: { kind: "none" },
	},
	{
		name: "压缩",
		display: { kind: "hidden" },
		context: { kind: "compress" },
		semantics: { kind: "none" },
	},
];
const registry = createBlockTypeRegistry([
	...DEFAULT_BLOCK_TYPES,
	...extraTypes,
]);

describe("renderContextView", () => {
	it("按上下文策略删除或保留块，并保留原文标签", () => {
		const text =
			"正文<thinking>内心<motion>活动</motion></thinking>中<选项>甲</选项>终";
		const view = renderContextView(parseBlocks(text, { registry }));
		expect(view).toBe("正文中<选项>甲</选项>终");
	});

	it("keep-depth 按距离尾部的深度决定是否保留", () => {
		const text = "<临时>内容</临时>";
		expect(
			renderContextView(parseBlocks(text, { registry }), { depth: 1 }),
		).toBe("<临时>内容</临时>");
		expect(
			renderContextView(parseBlocks(text, { registry }), { depth: 2 }),
		).toBe("");
	});

	it("未闭合的保留块只输出开启标签", () => {
		expect(renderContextView(parseBlocks("<选项>甲", { registry }))).toBe(
			"<选项>甲",
		);
	});

	it("compress 策略尚未实现时抛错", () => {
		expect(() =>
			renderContextView(parseBlocks("<压缩>内容</压缩>", { registry })),
		).toThrow("compress");
	});

	it("非法深度抛错", () => {
		expect(() => renderContextView([], { depth: -1 })).toThrow("非负整数");
	});
});
