import {
	DEEP_TURN_TOOLS,
	MAX_DEEP_MAX_TOOL_CALLS,
	MAX_DEEP_RECENT_TOOL_STEPS,
	MAX_DEEP_TIMEOUT_MS,
	MIN_DEEP_MAX_TOOL_CALLS,
	MIN_DEEP_RECENT_TOOL_STEPS,
	MIN_DEEP_TIMEOUT_MS,
	NOTE_READ_TOOL_NAME,
	NOTE_WRITE_TOOL_NAME,
} from "@dramaticer/core";
import { describe, expect, it } from "vitest";
import {
	DEEP_CONTEXT_TOKEN_MINIMUM,
	DEEP_MAX_TOOL_CALLS_RANGE,
	DEEP_RECENT_TOOL_STEPS_RANGE,
	DEEP_TIMEOUT_MS_RANGE,
	DEEP_TURN_TOOL_OPTIONS,
	NOTE_TURN_TOOL_NAMES,
} from "../src/chat/deep-turn";
import { DEEP_NUMBER_FIELDS } from "../src/chat/settings-form";

describe("界面里的深回合常量", () => {
	it("工具名、顺序与阶段文字跟 core 的注册表一致", () => {
		expect(DEEP_TURN_TOOL_OPTIONS.map((option) => option.value)).toEqual(
			DEEP_TURN_TOOLS.tools.map((tool) => tool.name),
		);
		expect(DEEP_TURN_TOOL_OPTIONS.map((option) => option.label)).toEqual(
			DEEP_TURN_TOOLS.tools.map(
				(tool) => `${tool.progressLabel}（${tool.name}）`,
			),
		);
		expect([...NOTE_TURN_TOOL_NAMES]).toEqual([
			NOTE_READ_TOOL_NAME,
			NOTE_WRITE_TOOL_NAME,
		]);
	});

	it("四段数值范围与 core 的校验一致", () => {
		expect(DEEP_MAX_TOOL_CALLS_RANGE).toEqual({
			minimum: MIN_DEEP_MAX_TOOL_CALLS,
			maximum: MAX_DEEP_MAX_TOOL_CALLS,
		});
		expect(DEEP_TIMEOUT_MS_RANGE).toEqual({
			minimum: MIN_DEEP_TIMEOUT_MS,
			maximum: MAX_DEEP_TIMEOUT_MS,
		});
		expect(DEEP_RECENT_TOOL_STEPS_RANGE).toEqual({
			minimum: MIN_DEEP_RECENT_TOOL_STEPS,
			maximum: MAX_DEEP_RECENT_TOOL_STEPS,
		});
		expect(DEEP_CONTEXT_TOKEN_MINIMUM).toBe(1);
		for (const field of DEEP_NUMBER_FIELDS) {
			const key = field.key;
			const expected = {
				deepMaxToolCalls: {
					minimum: MIN_DEEP_MAX_TOOL_CALLS,
					maximum: MAX_DEEP_MAX_TOOL_CALLS,
				},
				deepTimeoutMs: {
					minimum: MIN_DEEP_TIMEOUT_MS,
					maximum: MAX_DEEP_TIMEOUT_MS,
				},
				deepContextTokenLimit: {
					minimum: DEEP_CONTEXT_TOKEN_MINIMUM,
					maximum: undefined,
				},
				deepRecentToolSteps: {
					minimum: MIN_DEEP_RECENT_TOOL_STEPS,
					maximum: MAX_DEEP_RECENT_TOOL_STEPS,
				},
			}[key];
			expect({ minimum: field.minimum, maximum: field.maximum }).toEqual(
				expected,
			);
		}
	});
});
