import { describe, expect, it } from "vitest";
import {
	BlockParser,
	type BlockTypeDefinition,
	DEFAULT_BLOCK_TYPES,
	type ParsedContent,
	createBlockTypeRegistry,
	parseBlocks,
} from "../src/index.js";

function renderRaw(items: readonly ParsedContent[]): string {
	return items
		.map((item) =>
			item.kind === "text"
				? item.text
				: `<${item.name}>${renderRaw(item.content)}${item.complete ? `</${item.name}>` : ""}`,
		)
		.join("");
}

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

describe("BlockParser", () => {
	it("解析普通文本与块交替出现的内容", () => {
		const parser = new BlockParser();
		parser.push("开场。\n<选项>甲\n乙</选项>\n结束。");
		const items = parser.finish();

		expect(items).toHaveLength(3);
		expect(items[0]).toEqual({ kind: "text", text: "开场。\n" });
		expect(items[1]).toMatchObject({
			kind: "block",
			name: "选项",
			complete: true,
			raw: "甲\n乙",
			content: [{ kind: "text", text: "甲\n乙" }],
		});
		expect(items[1]?.kind === "block" ? items[1].type.display : null).toEqual({
			kind: "native",
			component: "options",
		});
		expect(items[2]).toEqual({ kind: "text", text: "\n结束。" });
		expect(renderRaw(items)).toBe("开场。\n<选项>甲\n乙</选项>\n结束。");
	});

	it("未注册的标签整体保留为原文", () => {
		const items = parseBlocks("<foo>bar</foo>");
		expect(items).toEqual([{ kind: "text", text: "<foo>bar</foo>" }]);
	});

	it("支持嵌套块，块内原文按顺序拼接", () => {
		const items = parseBlocks("<选项>甲<thinking>想法</thinking>乙</选项>");
		const outer = items[0];
		expect(outer).toMatchObject({
			kind: "block",
			name: "选项",
			complete: true,
			raw: "甲想法乙",
		});
		if (outer?.kind !== "block") throw new Error("期望最外层是块");
		expect(outer.content[0]).toEqual({ kind: "text", text: "甲" });
		expect(outer.content[1]).toMatchObject({
			kind: "block",
			name: "thinking",
			complete: true,
			raw: "想法",
		});
		expect(outer.content[2]).toEqual({ kind: "text", text: "乙" });
	});

	it("输入结束时未闭合的块保留 complete=false", () => {
		const items = parseBlocks("<thinking>思考到一半");
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			kind: "block",
			name: "thinking",
			complete: false,
			raw: "思考到一半",
		});
	});

	it("切在标签中间的片段不会被提前当作文本", () => {
		const parser = new BlockParser();
		parser.push("abc<thin");
		expect(parser.snapshot()).toEqual([{ kind: "text", text: "abc" }]);
		parser.push("king>思");
		const middle = parser.snapshot();
		expect(middle).toHaveLength(2);
		expect(middle[0]).toEqual({ kind: "text", text: "abc" });
		expect(middle[1]).toMatchObject({
			kind: "block",
			name: "thinking",
			complete: false,
			raw: "思",
		});
		parser.push("考</thinking>");
		const final = parser.finish();
		expect(final[1]).toMatchObject({
			kind: "block",
			name: "thinking",
			complete: true,
			raw: "思考",
		});
		expect(parser.raw).toBe("abc<thinking>思考</thinking>");
	});

	it("快照是拷贝，后续推入不会修改已经取出的结果", () => {
		const parser = new BlockParser();
		parser.push("前半");
		const snapshot = parser.snapshot();
		parser.push("后半");
		expect(snapshot).toEqual([{ kind: "text", text: "前半" }]);
		expect(parser.finish()).toEqual([{ kind: "text", text: "前半后半" }]);
	});

	it("不配对的闭合标签保留为原文", () => {
		const types: BlockTypeDefinition[] = [
			{
				name: "a",
				display: { kind: "hidden" },
				context: { kind: "keep" },
				semantics: { kind: "none" },
			},
			{
				name: "b",
				display: { kind: "hidden" },
				context: { kind: "keep" },
				semantics: { kind: "none" },
			},
		];
		const items = parseBlocks("<a>x</b></a></a>", { types });
		const block = items[0];
		expect(block).toMatchObject({
			kind: "block",
			name: "a",
			complete: true,
			raw: "x</b>",
		});
		expect(items[1]).toEqual({ kind: "text", text: "</a>" });
	});

	it("标签名可以配置，并且正确处理互为前缀的标签名", () => {
		const types: BlockTypeDefinition[] = [
			{
				name: "a",
				display: { kind: "hidden" },
				context: { kind: "keep" },
				semantics: { kind: "none" },
			},
			{
				name: "ab",
				display: { kind: "hidden" },
				context: { kind: "keep" },
				semantics: { kind: "none" },
			},
		];
		const parser = new BlockParser({ types });
		parser.push("<ab>x</ab><a>y</a>");
		const items = parser.finish();
		expect(items.map((item) => item.kind === "block" && item.name)).toEqual([
			"ab",
			"a",
		]);
	});

	it("随机切分输入后逐段推入，结果与一次性解析一致", () => {
		const sample =
			"前情提要。<thinking>先想一下 <选项>A</选项> 再决定</thinking>\n" +
			"<页眉>第三日 · 雨夜</页眉>\n" +
			"普通 < 文本不是标签；<未知>未知标签</未知>。\n" +
			"<悄悄话>别出声</悄悄话><选项>还没有闭合";
		const expected = parseBlocks(sample);

		for (let seed = 1; seed <= 40; seed += 1) {
			const random = mulberry32(seed);
			const parser = new BlockParser();
			let index = 0;
			while (index < sample.length) {
				const size = 1 + Math.floor(random() * 4);
				parser.push(sample.slice(index, index + size));
				index += size;
			}
			expect(parser.finish()).toEqual(expected);
			expect(renderRaw(parser.finish())).toBe(sample);
		}
	});

	it("默认块类型覆盖 DESIGN 的原生协议", () => {
		const registry = createBlockTypeRegistry(DEFAULT_BLOCK_TYPES);
		expect(registry.names).toEqual([
			"thinking",
			"选项",
			"状态栏",
			"变量更新",
			"分析",
			"图片",
			"页眉",
			"悄悄话",
			"旁白",
			"备忘",
			"state_update",
			"plot_note",
		]);
		expect(registry.get("thinking")?.display).toEqual({ kind: "hidden" });
		expect(registry.get("thinking")?.context).toEqual({ kind: "drop" });
		expect(registry.get("变量更新")?.context).toEqual({ kind: "drop" });
		expect(registry.get("state_update")?.display).toEqual({ kind: "hidden" });
		expect(registry.get("plot_note")?.context).toEqual({ kind: "drop" });
		expect(registry.get("页眉")?.semantics).toEqual({ kind: "none" });
		expect(registry.get("不存在")).toBeNull();
	});

	it("拒绝同时指定 types 与 registry", () => {
		expect(
			() =>
				new BlockParser({
					types: DEFAULT_BLOCK_TYPES,
					registry: createBlockTypeRegistry(DEFAULT_BLOCK_TYPES),
				}),
		).toThrow("不能同时指定");
	});

	it("注册表在创建时拒绝非法定义", () => {
		const base: BlockTypeDefinition = {
			name: "x",
			display: { kind: "hidden" },
			context: { kind: "keep" },
			semantics: { kind: "none" },
		};
		expect(() =>
			createBlockTypeRegistry([base, { ...base, name: "x" }]),
		).toThrow("重复注册");
		expect(() => createBlockTypeRegistry([{ ...base, name: "" }])).toThrow(
			"非空字符串",
		);
		expect(() => createBlockTypeRegistry([{ ...base, name: "a b" }])).toThrow(
			"不能包含",
		);
		expect(() =>
			createBlockTypeRegistry([
				{ ...base, context: { kind: "keep-depth", depth: 0 } },
			]),
		).toThrow("正整数");
		expect(() =>
			createBlockTypeRegistry([
				{ ...base, display: { kind: "native", component: "" } },
			]),
		).toThrow("组件名不能为空");
		expect(() =>
			createBlockTypeRegistry([
				{ ...base, display: { kind: "html", template: "" } },
			]),
		).toThrow("模板不能为空");
		expect(() =>
			createBlockTypeRegistry([
				{
					...base,
					semantics: {
						kind: "handler",
						apply: "not a function" as never,
					},
				},
			]),
		).toThrow("必须是函数");
	});

	it("接受合法的 keep-depth 与语义处理器", () => {
		const registry = createBlockTypeRegistry([
			{
				name: "x",
				display: { kind: "html", template: "<div></div>" },
				context: { kind: "keep-depth", depth: 3 },
				semantics: {
					kind: "handler",
					apply: () => [{ kind: "note", text: "备忘" }],
				},
			},
		]);
		expect(registry.get("x")?.context).toEqual({
			kind: "keep-depth",
			depth: 3,
		});
	});

	it("结束后再推入内容会抛错，重复结束返回同一结果", () => {
		const parser = new BlockParser();
		parser.push("<");
		expect(parser.finish()).toEqual([{ kind: "text", text: "<" }]);
		expect(parser.finish()).toEqual([{ kind: "text", text: "<" }]);
		expect(() => parser.push("更多")).toThrow("已经结束");
	});
});
