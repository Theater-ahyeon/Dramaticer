import type { LlmMessage } from "../llm/types.js";
import { type TokenEstimator, createTokenEstimator } from "../tokens.js";
import {
	assertDeepContextTokenLimit,
	assertDeepRecentToolSteps,
} from "./mode.js";

/** 深回合的工具往返上下文上限与保留步数。 */
export interface DeepContextWindow {
	/** 工具往返累计估算 token 的上限。 */
	readonly tokenLimit: number;
	/** 结尾保留、不参与省略的工具步数。 */
	readonly recentToolSteps: number;
	/** token 估算器；不设置时按默认字符比例估算。 */
	readonly estimator?: TokenEstimator;
}

/** 一次成对省略的累计数字。 */
export interface DeepContextOmission {
	/** 省略的工具往返对数。 */
	readonly pairs: number;
	/** 省略的消息条数。 */
	readonly messages: number;
	/** 省略消息的估算 token 数。 */
	readonly tokens: number;
	readonly reason: "context_limit";
}

export interface DeepContextPruneResult {
	/** 省略之后的完整消息序列；没有省略时与输入相同。 */
	readonly messages: readonly LlmMessage[];
	readonly omitted: DeepContextOmission | null;
}

/** 一次工具往返在消息序列里占据的区间：助手工具调用消息加紧随其后的工具结果。 */
interface ToolStep {
	readonly start: number;
	readonly end: number;
}

function collectToolSteps(messages: readonly LlmMessage[]): ToolStep[] {
	const steps: ToolStep[] = [];
	let index = 0;
	while (index < messages.length) {
		const message = messages[index] as LlmMessage;
		if (message.role !== "assistant") {
			index += 1;
			continue;
		}
		let end = index;
		while (
			end + 1 < messages.length &&
			(messages[end + 1] as LlmMessage).role === "tool"
		) {
			end += 1;
		}
		// 没有工具结果的助手消息不是工具往返，不省略也不参与估算。
		if (end > index) steps.push({ start: index, end });
		index = end + 1;
	}
	return steps;
}

function estimateMessage(
	message: LlmMessage,
	estimator: TokenEstimator,
): number {
	if (message.role === "tool") {
		return estimator(message.content) + estimator(message.toolName);
	}
	let tokens = estimator(message.content);
	for (const call of message.toolCalls ?? []) {
		tokens += estimator(call.name) + estimator(JSON.stringify(call.arguments));
	}
	return tokens;
}

/**
 * 工具往返的上下文卫生：工具往返累计估算 token 超过上限时，从最早的一对
 * “助手工具调用 + 工具结果”开始成对省略，直到降到上限以下或只剩最近
 * `recentToolSteps` 步。系统消息、用户消息与最近步骤不省略，也不会留下
 * 没有调用的工具结果或没有结果的工具调用。
 */
export function pruneToolRoundTrips(
	messages: readonly LlmMessage[],
	window: DeepContextWindow,
): DeepContextPruneResult {
	assertDeepContextTokenLimit(window.tokenLimit, "深回合的工具消息 token 上限");
	assertDeepRecentToolSteps(window.recentToolSteps, "深回合保留的最近工具步数");
	const estimator = window.estimator ?? createTokenEstimator();
	const steps = collectToolSteps(messages);
	const stepTokens = steps.map((step) => {
		let tokens = 0;
		for (let index = step.start; index <= step.end; index += 1) {
			tokens += estimateMessage(messages[index] as LlmMessage, estimator);
		}
		return tokens;
	});
	let total = stepTokens.reduce((sum, tokens) => sum + tokens, 0);
	if (total <= window.tokenLimit) return { messages, omitted: null };
	const removable = steps.length - window.recentToolSteps;
	if (removable <= 0) return { messages, omitted: null };

	const removed = new Set<number>();
	let pairs = 0;
	let removedTokens = 0;
	for (
		let index = 0;
		index < removable && total > window.tokenLimit;
		index += 1
	) {
		const step = steps[index] as ToolStep;
		const tokens = stepTokens[index] as number;
		for (let cursor = step.start; cursor <= step.end; cursor += 1) {
			removed.add(cursor);
		}
		total -= tokens;
		removedTokens += tokens;
		pairs += 1;
	}
	if (pairs === 0) return { messages, omitted: null };
	return {
		messages: messages.filter((_, index) => !removed.has(index)),
		omitted: {
			pairs,
			messages: removed.size,
			tokens: removedTokens,
			reason: "context_limit",
		},
	};
}

/** 把多次请求前的省略累计成一条记录。 */
export function addContextOmission(
	left: DeepContextOmission | null,
	right: DeepContextOmission | null,
): DeepContextOmission | null {
	if (right === null) return left;
	if (left === null) return right;
	return {
		pairs: left.pairs + right.pairs,
		messages: left.messages + right.messages,
		tokens: left.tokens + right.tokens,
		reason: "context_limit",
	};
}
