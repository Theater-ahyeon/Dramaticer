import { describe, expect, it } from "vitest";
import { createTokenEstimator } from "../src/tokens.js";

describe("createTokenEstimator", () => {
	it("中文按 1.5 个字符算一个 token", () => {
		const estimate = createTokenEstimator();
		expect(estimate("你好世界")).toBe(3);
		expect(estimate("你好")).toBe(2);
	});

	it("其他字符按 4 个字符算一个 token，并向上取整", () => {
		const estimate = createTokenEstimator();
		expect(estimate("abcd")).toBe(1);
		expect(estimate("abcde")).toBe(2);
		expect(estimate("")).toBe(0);
		expect(estimate("你好abcd")).toBe(3);
	});

	it("谚文按 CJK 字符估算", () => {
		const estimate = createTokenEstimator();
		expect(estimate("안녕하세요")).toBe(4);
		expect(estimate("ㄱ")).toBe(1);
	});

	it("换算比例可以替换", () => {
		const estimate = createTokenEstimator({
			cjkCharsPerToken: 1,
			otherCharsPerToken: 1,
		});
		expect(estimate("你好ab")).toBe(4);
	});

	it("非正的换算比例直接报错", () => {
		expect(() => createTokenEstimator({ cjkCharsPerToken: 0 })).toThrow();
		expect(() => createTokenEstimator({ otherCharsPerToken: -1 })).toThrow();
	});
});
