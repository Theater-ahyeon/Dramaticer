/**
 * 回合模式只能由玩家切换（I6）：故事设置给出锁定值，单轮参数可以覆盖它。
 * 程序不根据轮数、工具调用次数、错误或预算改变模式。
 */
export type TurnMode = "fast" | "deep";

export const TURN_MODES: readonly TurnMode[] = ["fast", "deep"];

/** DESIGN §10.1：快回合里读取工具的软上限默认 3 轮。 */
export const DEFAULT_MAX_READ_ROUNDS = 3;

/** DESIGN §10.1：深回合只设防失控上限，不压缩模型的思考。 */
export const DEFAULT_DEEP_MAX_TOOL_CALLS = 40;
export const DEFAULT_DEEP_TIMEOUT_MS = 600_000;
export const DEFAULT_DEEP_CONTEXT_TOKEN_LIMIT = 48_000;
export const DEFAULT_DEEP_RECENT_TOOL_STEPS = 4;

export const MIN_DEEP_MAX_TOOL_CALLS = 1;
export const MAX_DEEP_MAX_TOOL_CALLS = 200;
export const MIN_DEEP_TIMEOUT_MS = 60_000;
export const MAX_DEEP_TIMEOUT_MS = 3_600_000;
export const MIN_DEEP_RECENT_TOOL_STEPS = 1;
export const MAX_DEEP_RECENT_TOOL_STEPS = 20;

export function isTurnMode(value: unknown): value is TurnMode {
	return value === "fast" || value === "deep";
}

export function assertTurnMode(
	value: unknown,
	label: string,
): asserts value is TurnMode {
	if (!isTurnMode(value)) {
		throw new Error(`${label} 只接受 fast 或 deep，收到 ${String(value)}`);
	}
}

export function assertMaxReadRounds(
	value: unknown,
	label: string,
): asserts value is number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new Error(`${label} 必须是非负整数`);
	}
}

function assertIntegerRange(
	value: unknown,
	label: string,
	minimum: number,
	maximum: number,
): asserts value is number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < minimum ||
		value > maximum
	) {
		throw new Error(`${label} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
	}
}

export function assertDeepMaxToolCalls(
	value: unknown,
	label: string,
): asserts value is number {
	assertIntegerRange(
		value,
		label,
		MIN_DEEP_MAX_TOOL_CALLS,
		MAX_DEEP_MAX_TOOL_CALLS,
	);
}

export function assertDeepTimeoutMs(
	value: unknown,
	label: string,
): asserts value is number {
	assertIntegerRange(value, label, MIN_DEEP_TIMEOUT_MS, MAX_DEEP_TIMEOUT_MS);
}

export function assertDeepContextTokenLimit(
	value: unknown,
	label: string,
): asserts value is number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`${label} 必须是正整数`);
	}
}

export function assertDeepRecentToolSteps(
	value: unknown,
	label: string,
): asserts value is number {
	assertIntegerRange(
		value,
		label,
		MIN_DEEP_RECENT_TOOL_STEPS,
		MAX_DEEP_RECENT_TOOL_STEPS,
	);
}
