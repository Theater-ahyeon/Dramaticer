/**
 * 回合模式只能由玩家切换（I6）：故事设置给出锁定值，单轮参数可以覆盖它。
 * 程序不根据轮数、工具调用次数、错误或预算改变模式。
 */
export type TurnMode = "fast" | "deep";

export const TURN_MODES: readonly TurnMode[] = ["fast", "deep"];

/** DESIGN §10.1：快回合里读取工具的软上限默认 3 轮。 */
export const DEFAULT_MAX_READ_ROUNDS = 3;

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

/**
 * 深回合在 R3b 实现；在那之前请求深回合直接失败并指出阶段，
 * 不降级成快回合，也不按任何条件自动切换。
 */
export function assertTurnModeSupported(mode: TurnMode): void {
	if (mode === "fast") return;
	throw new Error(
		"深回合尚未实现（阶段 R3b）；当前只支持快回合，请把 turnMode 设为 fast",
	);
}
