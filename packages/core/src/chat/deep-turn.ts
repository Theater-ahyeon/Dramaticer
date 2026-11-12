import type { DeepTurnStopReason } from "../trace.js";
import {
	type ModelTurnOptions,
	type ModelTurnResult,
	runModelTurns,
} from "./executor.js";
import { assertDeepMaxToolCalls, assertDeepTimeoutMs } from "./mode.js";

export interface DeepTurnOptions
	extends Omit<ModelTurnOptions, "maxReadRounds"> {
	/** 工具调用总次数上限；默认 40。 */
	readonly maxToolCalls: number;
	/** 运行时长上限（毫秒）；默认 600,000。 */
	readonly maxDurationMs: number;
}

export interface DeepTurnResult {
	readonly turn: ModelTurnResult;
	readonly stopReason: DeepTurnStopReason;
	readonly maxToolCalls: number;
	readonly maxDurationMs: number;
	/** 实际执行的工具调用次数；被上限拒绝的调用不计入。 */
	readonly toolCallCount: number;
	readonly durationMs: number;
}

/**
 * 深回合循环：同一个模型自行决定步骤，不要求每轮调用工具，也不要求固定
 * 输出结构。只有工具调用总次数与运行时长两个防失控上限；达到任一上限就停止
 * 继续调用工具，把已有正文交给调用方。
 */
export async function runDeepTurn(
	options: DeepTurnOptions,
): Promise<DeepTurnResult> {
	assertDeepMaxToolCalls(options.maxToolCalls, "深回合的工具调用上限");
	assertDeepTimeoutMs(options.maxDurationMs, "深回合的时长上限");
	const now = options.now ?? Date.now;
	const startedAt = now();
	const turn = await runModelTurns({
		...options,
		maxToolCalls: options.maxToolCalls,
		maxDurationMs: options.maxDurationMs,
	});
	const finishedAt = now();
	return {
		turn,
		stopReason: turn.stopReason,
		maxToolCalls: options.maxToolCalls,
		maxDurationMs: options.maxDurationMs,
		toolCallCount: turn.toolCallCount,
		durationMs: finishedAt - startedAt,
	};
}
