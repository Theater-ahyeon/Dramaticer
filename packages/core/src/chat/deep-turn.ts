import type { DeepTurnStopReason } from "../trace.js";
import type { DeepContextOmission } from "./context-window.js";
import {
	type ModelTurnOptions,
	type ModelTurnResult,
	runModelTurns,
} from "./executor.js";
import {
	assertDeepContextTokenLimit,
	assertDeepMaxToolCalls,
	assertDeepRecentToolSteps,
	assertDeepTimeoutMs,
} from "./mode.js";

export interface DeepTurnOptions
	extends Omit<ModelTurnOptions, "maxReadRounds" | "contextWindow"> {
	/** 工具调用总次数上限；默认 40。 */
	readonly maxToolCalls: number;
	/** 运行时长上限（毫秒）；默认 600,000。 */
	readonly maxDurationMs: number;
	/** 工具往返累计估算 token 的上限；默认 48,000。 */
	readonly contextTokenLimit: number;
	/** 结尾保留、不参与省略的工具步数；默认 4。 */
	readonly recentToolSteps: number;
}

export interface DeepTurnResult {
	readonly turn: ModelTurnResult;
	readonly stopReason: DeepTurnStopReason;
	readonly maxToolCalls: number;
	readonly maxDurationMs: number;
	/** 实际执行的工具调用次数；被上限拒绝的调用不计入。 */
	readonly toolCallCount: number;
	readonly durationMs: number;
	/** 工具往返的成对省略累计；没有省略时为 null。 */
	readonly contextOmitted: DeepContextOmission | null;
}

/**
 * 深回合循环：同一个模型自行决定步骤，不要求每轮调用工具，也不要求固定
 * 输出结构。只有工具调用总次数与运行时长两个防失控上限；达到任一上限就停止
 * 继续调用工具，把已有正文交给调用方。每次请求前对工具往返做上下文卫生：
 * 超过上限时从最早的一对开始成对省略，最近若干步保留。
 */
export async function runDeepTurn(
	options: DeepTurnOptions,
): Promise<DeepTurnResult> {
	assertDeepMaxToolCalls(options.maxToolCalls, "深回合的工具调用上限");
	assertDeepTimeoutMs(options.maxDurationMs, "深回合的时长上限");
	assertDeepContextTokenLimit(
		options.contextTokenLimit,
		"深回合的工具消息 token 上限",
	);
	assertDeepRecentToolSteps(
		options.recentToolSteps,
		"深回合保留的最近工具步数",
	);
	const now = options.now ?? Date.now;
	const startedAt = now();
	const { contextTokenLimit, recentToolSteps, ...base } = options;
	const turn = await runModelTurns({
		...base,
		maxToolCalls: options.maxToolCalls,
		maxDurationMs: options.maxDurationMs,
		contextWindow: {
			tokenLimit: contextTokenLimit,
			recentToolSteps,
		},
	});
	const finishedAt = now();
	return {
		turn,
		stopReason: turn.stopReason,
		maxToolCalls: options.maxToolCalls,
		maxDurationMs: options.maxDurationMs,
		toolCallCount: turn.toolCallCount,
		durationMs: finishedAt - startedAt,
		contextOmitted: turn.contextOmitted,
	};
}
