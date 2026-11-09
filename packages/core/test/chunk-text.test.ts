import { describe, expect, it } from "vitest";
import { chunkText, chunkTextByParent } from "../src/retrieval/chunk-text.js";

describe("chunkText", () => {
	it("短文本只产生一块", () => {
		expect(chunkText("很短的一段话", { maxChars: 100 })).toEqual([
			"很短的一段话",
		]);
	});

	it("空白文本不产生块", () => {
		expect(chunkText("   \n\t ", { maxChars: 100 })).toEqual([]);
	});

	it("按窗口和重叠切分长文本", () => {
		const text = "甲".repeat(250);
		const chunks = chunkText(text, { maxChars: 100, overlapChars: 20 });
		expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 90]);
		expect(chunks[1]?.slice(0, 20)).toBe(chunks[0]?.slice(-20));
		expect(chunks[2]?.slice(0, 20)).toBe(chunks[1]?.slice(-20));
	});

	it("不会拆开代理对", () => {
		const text = "😀".repeat(150);
		const chunks = chunkText(text, { maxChars: 100, overlapChars: 0 });
		expect(chunks.map((chunk) => [...chunk].length)).toEqual([100, 50]);
		expect(chunks.join("")).toBe(text);
	});

	it("长度等于 maxChars 时只产生一块", () => {
		const text = "甲".repeat(100);
		expect(chunkText(text, { maxChars: 100, overlapChars: 20 })).toEqual([
			text,
		]);
	});

	it("长度比 maxChars 多一个字符时切成两块", () => {
		const text = "甲".repeat(101);
		const chunks = chunkText(text, { maxChars: 100, overlapChars: 20 });
		expect(chunks.map((chunk) => [...chunk].length)).toEqual([100, 21]);
		expect(chunks[1]).toBe("甲".repeat(21));
	});

	it("末尾残片小于步长时仍然单独成块", () => {
		const text = "甲".repeat(190);
		const chunks = chunkText(text, { maxChars: 100, overlapChars: 20 });
		expect(chunks.map((chunk) => [...chunk].length)).toEqual([100, 100, 30]);
		expect(chunks[2]).toBe("甲".repeat(30));
	});

	it("分块前把回车换行归一成换行", () => {
		expect(chunkText("第一行\r\n第二行\r\n第三行", { maxChars: 100 })).toEqual([
			"第一行\n第二行\n第三行",
		]);
	});

	it("拒绝非法参数", () => {
		expect(() => chunkText("文本", { maxChars: 2 })).toThrow(
			"分块长度必须是不小于 3 的整数",
		);
		expect(() => chunkText("文本", { maxChars: 10, overlapChars: 10 })).toThrow(
			"分块重叠必须是不小于 0、且小于分块长度的整数",
		);
		expect(() => chunkText("文本", { maxChars: 10, overlapChars: -1 })).toThrow(
			"分块重叠必须是不小于 0、且小于分块长度的整数",
		);
	});
});

describe("chunkTextByParent", () => {
	it("按段落边界合并父段，小块不跨父段", () => {
		const first = "甲".repeat(40);
		const second = "乙".repeat(40);
		const third = "丙".repeat(40);
		const text = `${first}\n${second}\n${third}`;
		const chunks = chunkTextByParent(text, {
			parentMaxChars: 100,
			maxChars: 40,
			overlapChars: 0,
		});
		expect(chunks.map((chunk) => chunk.parentOrdinal)).toEqual([0, 0, 0, 1]);
		expect(chunks[0]?.parentText).toBe(`${first}\n${second}`);
		expect(chunks[3]?.parentText).toBe(third);
		expect(chunks[0]?.text).toBe(first);
		expect(chunks[3]?.text).toBe(third);
	});

	it("单个段落超过父段上限时整楼退化成一个父段", () => {
		const text = "丁".repeat(120);
		const chunks = chunkTextByParent(`${text}\n戊`, {
			parentMaxChars: 100,
			maxChars: 40,
			overlapChars: 0,
		});
		expect(new Set(chunks.map((chunk) => chunk.parentOrdinal))).toEqual(
			new Set([0]),
		);
		for (const chunk of chunks) expect(chunk.parentText).toBe(`${text}\n戊`);
	});

	it("空白文本不产生块，非法父段长度直接抛错", () => {
		expect(chunkTextByParent(" \n\t ")).toEqual([]);
		expect(() => chunkTextByParent("文本", { parentMaxChars: 2 })).toThrow(
			"父段长度必须是不小于 3 的整数",
		);
	});
});
