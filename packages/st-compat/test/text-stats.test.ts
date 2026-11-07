import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeReferenceText } from "../src/reference/text-stats.js";

const fixturesPath = fileURLToPath(new URL("./fixtures/", import.meta.url));

describe("analyzeReferenceText", () => {
	it("按句子切分并统计句长分布", () => {
		const stats = analyzeReferenceText("第一句。第二句更长一些！第三句？");
		expect(stats.sentence.sentenceCount).toBe(3);
		expect(stats.sentence.mean).toBeCloseTo(13 / 3);
		expect(stats.sentence.median).toBe(3);
		expect(stats.sentence.p90).toBe(7);
		expect(stats.sentence.buckets.map((bucket) => bucket.count)).toEqual([
			3, 0, 0, 0, 0,
		]);
		expect(stats.sentence.buckets[0].ratio).toBe(1);
		expect(stats.blockCount).toBe(1);
		expect(stats.duplication.pairs).toEqual([]);
		expect(stats.meanAdjacentSimilarity).toBe(0);
	});

	it("句长分档在 10、20、40、80 处切换", () => {
		const text = [10, 11, 20, 21, 40, 41, 80, 81]
			.map((length) => `${"啊".repeat(length)}。`)
			.join("\n");
		const stats = analyzeReferenceText(text);
		expect(stats.sentence.sentenceCount).toBe(8);
		expect(stats.sentence.buckets.map((bucket) => bucket.count)).toEqual([
			1, 2, 2, 2, 1,
		]);
		expect(stats.sentence.mean).toBe(304 / 8);
		expect(stats.sentence.median).toBe(30.5);
		expect(stats.sentence.p90).toBe(81);
	});

	it("统计引号内的字符占比", () => {
		const stats = analyzeReferenceText("他说：“你好世界。”然后走了。");
		expect(stats.dialogue.spanCount).toBe(1);
		expect(stats.dialogue.quotedChars).toBe(4);
		expect(stats.dialogue.totalChars).toBe(10);
		expect(stats.dialogue.ratio).toBeCloseTo(0.4);
	});

	it("相邻文本块相同则重复度为 1", () => {
		const stats = analyzeReferenceText(
			["春眠不觉晓", "春眠不觉晓", "夜来风雨声"].join("\n"),
		);
		expect(stats.blockCount).toBe(3);
		expect(stats.duplication.pairs).toHaveLength(2);
		expect(stats.duplication.pairs[0].similarity).toBe(1);
		expect(stats.duplication.pairs[1].similarity).toBe(0);
		expect(stats.meanAdjacentSimilarity).toBe(0.5);
	});

	it("统计字符与二元组的类符形符比", () => {
		const stats = analyzeReferenceText("春眠不觉晓，处处闻啼鸟。");
		expect(stats.vocabulary.charCount).toBe(10);
		expect(stats.vocabulary.uniqueChars).toBe(9);
		expect(stats.vocabulary.charTypeTokenRatio).toBe(0.9);
		expect(stats.vocabulary.bigramCount).toBe(9);
		expect(stats.vocabulary.uniqueBigrams).toBe(9);
		expect(stats.vocabulary.bigramTypeTokenRatio).toBe(1);
	});

	it("在公有领域 fixture 上产出四项统计", async () => {
		const text = await readFile(
			`${fixturesPath}reference/public-domain.txt`,
			"utf8",
		);
		const stats = analyzeReferenceText(text);
		expect(stats.blockCount).toBeGreaterThanOrEqual(50);
		expect(stats.charCount).toBeGreaterThan(800);
		expect(stats.sentence.sentenceCount).toBeGreaterThan(50);
		expect(stats.sentence.buckets).toHaveLength(5);
		expect(stats.sentence.buckets.some((bucket) => bucket.count > 0)).toBe(
			true,
		);
		expect(stats.dialogue.spanCount).toBeGreaterThan(0);
		expect(stats.dialogue.ratio).toBeGreaterThan(0);
		expect(stats.vocabulary.bigramCount).toBe(stats.vocabulary.charCount - 1);
		expect(stats.vocabulary.bigramTypeTokenRatio).toBeGreaterThan(0);
		expect(stats.vocabulary.bigramTypeTokenRatio).toBeLessThanOrEqual(1);
		expect(stats.duplication.pairs).toHaveLength(stats.blockCount - 1);
		expect(stats.duplication.windows.length).toBeGreaterThan(0);
		expect(stats.meanAdjacentSimilarity).toBeGreaterThan(0);
		expect(stats.meanAdjacentSimilarity).toBeLessThanOrEqual(1);
	});
});
