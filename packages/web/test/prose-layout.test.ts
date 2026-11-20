import { describe, expect, it } from "vitest";
import { isDialogueLine } from "../src/v4/prose";

describe("对话段判断", () => {
	it.each([
		"「你来了。」",
		"『旧信』里写着",
		"“走吧。”她说。",
		'"Hello."',
		"——不，不是这样。",
		"  「前面有空格」",
	])("%s 是对话段", (line) => {
		expect(isDialogueLine(line)).toBe(true);
	});

	it.each(["门厅里只剩一盏灯。", "她说：「走吧。」", ""])(
		"%s 不是对话段",
		(line) => {
			expect(isDialogueLine(line)).toBe(false);
		},
	);
});
