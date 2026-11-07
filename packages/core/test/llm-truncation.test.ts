import { describe, expect, it } from "vitest";
import {
	detectTruncation,
	detectTruncations,
	resolveContinuationOptions,
} from "../src/index.js";

describe("detectTruncation", () => {
	it("以 length 结束直接判为截断", () => {
		expect(detectTruncation({ text: "完整句子。", stopReason: "length" })).toBe(
			"length",
		);
	});

	it("期望标签没有闭合时判为截断", () => {
		expect(
			detectTruncation(
				{ text: '<state_update>{"hp":1}', stopReason: "stop" },
				{ expectedTags: ["state_update"] },
			),
		).toBe("unclosed_tag");
		expect(
			detectTruncation(
				{ text: "<state_update>{}</state_update>", stopReason: "stop" },
				{ expectedTags: ["state_update"] },
			),
		).toBeNull();
	});

	it("配置了期望标签后检测被切断在标签中间的情况", () => {
		expect(
			detectTruncation(
				{ text: "正文 <state_upd", stopReason: "stop" },
				{ expectedTags: ["state_update"] },
			),
		).toBe("unclosed_tag");
	});

	it("未配置期望标签时不把普通小于号当标签", () => {
		expect(
			detectTruncation({ text: "如果 a < b。", stopReason: "stop" }),
		).toBeNull();
	});

	it("突然中断需要显式开启", () => {
		expect(
			detectTruncation({ text: "写到一半", stopReason: "stop" }),
		).toBeNull();
		expect(
			detectTruncation(
				{ text: "写到一半", stopReason: "stop" },
				{ detectAbruptEnd: true },
			),
		).toBe("abrupt_end");
		expect(
			detectTruncation(
				{ text: "写到一半。", stopReason: "stop" },
				{ detectAbruptEnd: true },
			),
		).toBeNull();
	});

	it("可以自定义句尾字符", () => {
		expect(
			detectTruncation(
				{ text: "结尾是分号;", stopReason: "stop" },
				{ detectAbruptEnd: true, terminators: ";" },
			),
		).toBeNull();
	});
});

describe("detectTruncations", () => {
	it("同时报告 length、未闭合标签与突然中断", () => {
		expect(
			detectTruncations(
				{ text: '<state_update>{"hp":1', stopReason: "length" },
				{ expectedTags: ["state_update"], detectAbruptEnd: true },
			),
		).toEqual(["length", "unclosed_tag", "abrupt_end"]);
	});

	it("没有截断时返回空数组", () => {
		expect(
			detectTruncations(
				{ text: "<state_update>{}</state_update>", stopReason: "stop" },
				{
					expectedTags: ["state_update"],
					terminators: "。>",
					detectAbruptEnd: true,
				},
			),
		).toEqual([]);
	});
});

describe("resolveContinuationOptions", () => {
	it("默认只续写 length，额外轮数为 1", () => {
		expect(resolveContinuationOptions(undefined)).toMatchObject({
			maxRounds: 1,
			continueOn: ["length"],
			detectAbruptEnd: false,
		});
	});

	it("拒绝非法的轮数与截断原因", () => {
		expect(() => resolveContinuationOptions({ maxRounds: -1 })).toThrow(
			"maxRounds",
		);
		expect(() =>
			resolveContinuationOptions({
				continueOn: ["unknown" as never],
			}),
		).toThrow("截断原因");
	});
});
