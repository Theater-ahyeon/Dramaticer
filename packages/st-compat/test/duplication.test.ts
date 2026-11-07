import { describe, expect, it } from "vitest";
import {
	analyzeDuplication,
	charNgrams,
	jaccardSimilarity,
} from "../src/health/duplication.js";

describe("charNgrams", () => {
	it("按码点生成字符 n-gram", () => {
		expect([...charNgrams("abcd", 2)]).toEqual(["ab", "bc", "cd"]);
		expect([...charNgrams("你好世", 2)]).toEqual(["你好", "好世"]);
		expect(charNgrams("ab", 3).size).toBe(0);
	});

	it("n-gram 长度必须是正整数", () => {
		expect(() => charNgrams("abc", 0)).toThrow();
		expect(() => charNgrams("abc", 1.5)).toThrow();
	});
});

describe("jaccardSimilarity", () => {
	it("相同集合是 1，不相交是 0", () => {
		expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
		expect(jaccardSimilarity(new Set(["a"]), new Set(["b"]))).toBe(0);
		expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
	});

	it("部分重合按交集除以并集计算", () => {
		expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["b", "c"]))).toBe(
			1 / 3,
		);
	});
});

describe("analyzeDuplication", () => {
	it("标出持续上升的起点和峰值窗口", () => {
		const replies = [
			{ floor: 1, text: "a" },
			{ floor: 2, text: "b" },
			{ floor: 3, text: "c" },
			{ floor: 4, text: "cd" },
			{ floor: 5, text: "cd" },
			{ floor: 6, text: "cd" },
			{ floor: 7, text: "cd" },
			{ floor: 8, text: "cd" },
			{ floor: 9, text: "cd" },
		];
		const curve = analyzeDuplication(replies, {
			ngramSize: 1,
			windowSize: 2,
			step: 2,
			riseWindows: 3,
			riseDelta: 0.2,
			riseMinimum: 0.1,
		});
		expect(curve.pairs).toHaveLength(8);
		expect(curve.windows.map((window) => window.meanSimilarity)).toEqual([
			0, 0.75, 1, 1,
		]);
		expect(curve.riseStartFloor).toBe(3);
		expect(curve.peakWindow?.startFloor).toBe(5);
		expect(curve.peakWindow?.endFloor).toBe(7);
	});

	it("重复度不变时没有持续上升的起点", () => {
		const replies = Array.from({ length: 9 }, (_, index) => ({
			floor: index + 1,
			text: "同样的内容",
		}));
		const curve = analyzeDuplication(replies, {
			ngramSize: 2,
			windowSize: 2,
			step: 2,
			riseWindows: 3,
			riseDelta: 0.2,
			riseMinimum: 0.1,
		});
		expect(curve.pairs.every((pair) => pair.similarity === 1)).toBe(true);
		expect(curve.riseStartFloor).toBeNull();
		expect(curve.peakWindow?.meanSimilarity).toBe(1);
	});

	it("回复太少时窗口为空", () => {
		const curve = analyzeDuplication([
			{ floor: 1, text: "a" },
			{ floor: 3, text: "b" },
		]);
		expect(curve.pairs).toHaveLength(1);
		expect(curve.windows).toHaveLength(0);
		expect(curve.riseStartFloor).toBeNull();
		expect(curve.peakWindow).toBeNull();
	});

	it("窗口参数非法时报错", () => {
		expect(() => analyzeDuplication([], { windowSize: 0 })).toThrow();
		expect(() => analyzeDuplication([], { step: 0 })).toThrow();
	});
});
