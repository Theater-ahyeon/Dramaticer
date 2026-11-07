import { BlockParser } from "../blocks/parser.js";
import type { ParsedContent } from "../blocks/types.js";
import type {
	LlmContinuationOptions,
	LlmMessage,
	LlmReasoningLevel,
	LlmResult,
	LlmStreamingClient,
	LlmToolCall,
	LlmToolDefinition,
	LlmUsage,
} from "../llm/types.js";
import {
	type ReadToolContext,
	executeReadTool,
	isReadToolName,
	validateReadToolArguments,
} from "../tools/read-tools.js";

/** DESIGN §11：主模型调用之后最多再有 2 轮读取工具往返。 */
export const MAX_TOOL_ROUNDS = 2;

/** 中止时把已经生成的部分正文交给调用方，便于保存不完整回复。 */
export class TurnAbortedError extends Error {
	readonly partialText: string;
	readonly partialReasoning: string;
	readonly firstTokenMs: number | null;

	constructor(
		reason: unknown,
		partialText: string,
		partialReasoning: string,
		firstTokenMs: number | null,
	) {
		super(
			reason instanceof Error
				? reason.message
				: typeof reason === "string" && reason.length > 0
					? reason
					: "回合被中止",
			{ cause: reason },
		);
		this.name = "TurnAbortedError";
		this.partialText = partialText;
		this.partialReasoning = partialReasoning;
		this.firstTokenMs = firstTokenMs;
	}
}

export interface ModelTurnOptions {
	readonly client: LlmStreamingClient;
	readonly messages: readonly LlmMessage[];
	/** 结构化输出工具；只在函数调用模式下提供。 */
	readonly structuredTools?: readonly LlmToolDefinition[];
	/** 本模式允许的读取工具；为空时不执行任何工具。 */
	readonly readTools?: readonly LlmToolDefinition[];
	readonly toolContext: ReadToolContext;
	readonly maxToolRounds?: number;
	readonly model?: string;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly reasoning?: LlmReasoningLevel;
	readonly signal?: AbortSignal;
	readonly continuation?: LlmContinuationOptions;
	readonly onTextDelta?: (
		delta: string,
		snapshot: readonly ParsedContent[],
	) => void;
	readonly onThinkingDelta?: (delta: string) => void;
	/** 每次读取工具执行后回调，服务端用它转发 SSE 事件。 */
	readonly onToolCall?: (call: ToolCallTrace) => void;
	readonly now?: () => number;
}

export interface ToolCallTrace {
	readonly name: string;
	readonly ok: boolean;
}

export interface ModelTurnResult {
	readonly result: LlmResult;
	/** 全部轮次里的工具调用，供结构化输出收集写出类工具。 */
	readonly toolCalls: readonly LlmToolCall[];
	readonly blocks: readonly ParsedContent[];
	/** 实际执行的读取工具轮数。 */
	readonly rounds: number;
	readonly calls: readonly ToolCallTrace[];
	readonly usage: LlmUsage;
	readonly attempts: number;
	readonly modelRounds: number;
	readonly cached: boolean;
	readonly firstTokenMs: number | null;
}

/**
 * 无状态单轮执行器：组装好的上下文先发一次主请求；模型请求读取工具时，
 * 校验参数、执行工具，把结果作为工具消息发回去，最多往返 `MAX_TOOL_ROUNDS` 轮。
 * 写入类工具只收集、不执行。
 */
export async function runModelTurns(
	options: ModelTurnOptions,
): Promise<ModelTurnResult> {
	const maxToolRounds = options.maxToolRounds ?? MAX_TOOL_ROUNDS;
	if (
		!Number.isInteger(maxToolRounds) ||
		maxToolRounds < 0 ||
		maxToolRounds > MAX_TOOL_ROUNDS
	) {
		throw new Error(`工具轮数必须是 0 到 ${MAX_TOOL_ROUNDS} 之间的整数`);
	}
	if (options.messages.length === 0) {
		throw new Error("上下文消息不能为空");
	}
	const now = options.now ?? Date.now;
	const startedAt = now();
	const tools = [
		...(options.structuredTools ?? []),
		...(options.readTools ?? []),
	];
	const allowedReadTools = new Set(
		(options.readTools ?? []).map((tool) => tool.name),
	);
	const messages: LlmMessage[] = [...options.messages];
	const allToolCalls: LlmToolCall[] = [];
	const calls: ToolCallTrace[] = [];
	let rounds = 0;
	let firstTokenMs: number | null = null;
	let blocks: readonly ParsedContent[] = [];
	let last: LlmResult | null = null;
	let usage = emptyUsage();
	let attempts = 0;
	let modelRounds = 0;
	let cached = true;
	let roundText = "";
	let roundReasoning = "";

	try {
		for (;;) {
			throwIfAborted(options.signal);
			const request = {
				messages,
				tools: tools.length > 0 ? tools : undefined,
				model: options.model,
				maxTokens: options.maxTokens,
				temperature: options.temperature,
				reasoning: options.reasoning,
				signal: options.signal,
			};
			const parser = new BlockParser();
			roundText = "";
			roundReasoning = "";
			const stream = options.client.stream(
				request,
				options.continuation === undefined
					? undefined
					: { continuation: options.continuation },
			);
			for await (const event of stream) {
				if (event.type === "thinking_delta") {
					roundReasoning += event.delta;
					options.onThinkingDelta?.(event.delta);
					continue;
				}
				if (firstTokenMs === null) firstTokenMs = now() - startedAt;
				roundText += event.delta;
				parser.push(event.delta);
				options.onTextDelta?.(event.delta, parser.snapshot());
			}
			const result = await stream.result();
			if (roundText !== result.text) {
				throw new Error(
					"流式增量拼接后的正文与生成结果不一致，无法保存楼层原文",
				);
			}
			last = result;
			usage = addUsage(usage, result.usage);
			attempts += result.attempts;
			modelRounds += result.rounds;
			cached &&= result.cached;
			allToolCalls.push(...result.toolCalls);

			const requested = result.toolCalls.filter(
				(call) => allowedReadTools.has(call.name) && isReadToolName(call.name),
			);
			if (requested.length === 0) {
				blocks = parser.finish();
				break;
			}
			if (rounds >= maxToolRounds) {
				if (result.text.trim().length === 0) {
					throw new Error("模型在工具轮数用完后仍只请求读取工具，没有生成正文");
				}
				blocks = parser.finish();
				break;
			}

			rounds += 1;
			messages.push({
				role: "assistant",
				content: result.text,
				toolCalls: requested,
			});
			for (const call of requested) {
				throwIfAborted(options.signal);
				if (!isReadToolName(call.name)) {
					throw new Error(`未知的读取工具：${call.name}`);
				}
				let content: string;
				let ok = true;
				try {
					const args = validateReadToolArguments(call.name, call.arguments);
					content = await executeReadTool(call.name, args, options.toolContext);
				} catch (error) {
					ok = false;
					content = `工具调用失败：${error instanceof Error ? error.message : String(error)}`;
				}
				const trace: ToolCallTrace = { name: call.name, ok };
				calls.push(trace);
				options.onToolCall?.(trace);
				messages.push({
					role: "tool",
					toolCallId: call.id,
					toolName: call.name,
					content,
					isError: !ok,
				});
			}
		}
	} catch (error) {
		if (options.signal?.aborted) {
			throw new TurnAbortedError(
				options.signal.reason,
				roundText,
				roundReasoning,
				firstTokenMs,
			);
		}
		throw error;
	}

	if (last === null) {
		throw new Error("模型没有返回任何结果");
	}
	return {
		result: last,
		toolCalls: allToolCalls,
		blocks,
		rounds,
		calls,
		usage,
		attempts,
		modelRounds,
		cached,
		firstTokenMs,
	};
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason;
}

function emptyUsage(): LlmUsage {
	return {
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		reasoningTokens: null,
		cachedTokens: null,
	};
}

function addUsage(left: LlmUsage, right: LlmUsage): LlmUsage {
	return {
		promptTokens: addNullable(left.promptTokens, right.promptTokens),
		completionTokens: addNullable(
			left.completionTokens,
			right.completionTokens,
		),
		totalTokens: addNullable(left.totalTokens, right.totalTokens),
		reasoningTokens: addNullable(left.reasoningTokens, right.reasoningTokens),
		cachedTokens: addNullable(left.cachedTokens, right.cachedTokens),
	};
}

function addNullable(left: number | null, right: number | null): number | null {
	if (left === null) return right;
	if (right === null) return left;
	return left + right;
}
