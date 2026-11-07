import { describe, expect, it } from "vitest";
import { chunkText } from "../src/retrieval/chunk-text.js";

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

	it("拒绝非法参数", () => {
		expect(() => chunkText("文本", { maxChars: 2 })).toThrow();
		expect(() =>
			chunkText("文本", { maxChars: 10, overlapChars: 10 }),
		).toThrow();
		expect(() =>
			chunkText("文本", { maxChars: 10, overlapChars: -1 }),
		).toThrow();
	});
});
