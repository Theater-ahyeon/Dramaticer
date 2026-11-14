import { describe, expect, it } from "vitest";
import {
	CONTENT_GRAM_SIZE,
	contentGramJaccard,
	contentGrams,
	measureBlockRepetition,
	measureProgression,
	measureReplyRepetition,
	novelRatio,
	rememberGrams,
} from "../src/evalset/metrics.js";

describe("字符 4-gram 指标", () => {
	it("只保留内容字符", () => {
		expect(CONTENT_GRAM_SIZE).toBe(4);
		expect([...contentGrams("你好，世界！")]).toEqual(["你好世界"]);
		expect(contentGrams("abc def").size).toBe(3);
		expect(contentGrams("！！！").size).toBe(0);
	});

	it("Jaccard 在空集时返回 null", () => {
		expect(contentGramJaccard(new Set(), contentGrams("你好世界"))).toBeNull();
		expect(contentGramJaccard(contentGrams("你好世界"), new Set())).toBeNull();
	});

	it("相邻回复的重复度跳过空集对", () => {
		const repeated = measureReplyRepetition(["甲乙丙丁", "甲乙丙丁"]);
		expect(repeated.pairCount).toBe(1);
		expect(repeated.values).toEqual([1]);
		expect(repeated.summary.mean).toBe(1);

		const disjoint = measureReplyRepetition(["甲乙丙丁", "戊己庚辛"]);
		expect(disjoint.values).toEqual([0]);

		const skipped = measureReplyRepetition(["", "甲乙丙丁", "！！！"]);
		expect(skipped.pairCount).toBe(0);
		expect(skipped.summary.count).toBe(0);
	});

	it("推进度从第 2 条回复起算", () => {
		const measurement = measureProgression([
			"甲乙丙丁",
			"甲乙丙丁戊己庚辛",
			"甲乙丙丁戊己庚辛",
		]);
		expect(measurement.samples).toBe(2);
		expect(measurement.values).toEqual([0.8, 0]);
		expect(measurement.mean).toBeCloseTo(0.4);
		expect(measureProgression(["甲乙丙丁"]).mean).toBeNull();
	});

	it("novelRatio 与 rememberGrams 共用同一份集合", () => {
		const seen = new Set<string>();
		expect(novelRatio(seen, "甲乙丙丁")).toBe(1);
		rememberGrams(seen, "甲乙丙丁");
		expect(novelRatio(seen, "甲乙丙丁")).toBe(0);
	});

	it("块的重复度保持按行切块的口径", () => {
		const measurement = measureBlockRepetition([
			"甲甲甲甲\n乙乙乙乙",
			"丙丙丙丙",
		]);
		expect(measurement.blockCount).toBe(3);
		expect(measurement.values).toHaveLength(2);
	});
});
