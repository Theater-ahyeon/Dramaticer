import { DIRECTOR_PUSH_KINDS } from "@dramaticer/core";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_PUSH,
	PUSH_CHOICES,
	PUSH_TURN_TEXT,
	pushLabel,
} from "../src/chat/push";
import {
	REROLL_REASON_CHOICES,
	describeRerollReason,
} from "../src/chat/reroll";

describe("推进档位与重 roll 原因的界面选项", () => {
	it("三档与 core 的取值一一对应", () => {
		expect(PUSH_CHOICES.map((choice) => choice.value)).toEqual([
			...DIRECTOR_PUSH_KINDS,
		]);
		expect(DEFAULT_PUSH).toBe("advance");
		expect(pushLabel("jump")).toBe("大幅");
		expect(PUSH_TURN_TEXT.length).toBeGreaterThan(0);
	});

	it("六项原因覆盖 core 的全部取值，标签不重复", () => {
		expect(REROLL_REASON_CHOICES.map((choice) => choice.value)).toEqual([
			"not-progressed",
			"ignored-instruction",
			"too-short",
			"off-character",
			"format",
			"avoid-line",
		]);
		const labels = REROLL_REASON_CHOICES.map((choice) => choice.label);
		expect(new Set(labels).size).toBe(labels.length);
		expect(describeRerollReason("too-short")).toBe("太短");
		expect(describeRerollReason(null)).toBe("没有");
	});
});
