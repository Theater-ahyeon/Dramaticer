import { describe, expect, it } from "vitest";
import { parseDirectorBitJudgmentResponse } from "../src/index.js";

describe("剧情小品条件判断", () => {
	it("缺少、重复与多余的条件整批拒绝", () => {
		expect(() =>
			parseDirectorBitJudgmentResponse(
				JSON.stringify({
					judgments: [{ id: "a", matched: true, reason: "x" }],
				}),
				["a", "b"],
			),
		).toThrow("条件判断缺少条件 b");
		expect(() =>
			parseDirectorBitJudgmentResponse(
				JSON.stringify({
					judgments: [
						{ id: "a", matched: true, reason: "x" },
						{ id: "a", matched: false, reason: "y" },
					],
				}),
				["a"],
			),
		).toThrow("条件判断.judgments[1].id 重复：a");
		expect(() =>
			parseDirectorBitJudgmentResponse(
				JSON.stringify({
					judgments: [
						{ id: "a", matched: true, reason: "x" },
						{ id: "b", matched: false, reason: "y" },
					],
				}),
				["a"],
			),
		).toThrow("条件判断.judgments[1].id 不在待判断条件里：b");
	});
});
