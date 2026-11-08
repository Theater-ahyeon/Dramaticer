import { BlockParser, parseBlocks } from "../blocks/parser.js";
import type { ParsedContent } from "../blocks/types.js";
import type { JsonObject } from "../json.js";
import { type LlmToolTransport, assertToolTransport } from "../llm/channels.js";
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
import { DEFAULT_MAX_READ_ROUNDS, assertMaxReadRounds } from "./mode.js";
import {
	TextToolStreamFilter,
	extractTextToolCalls,
	renderToolProtocol,
} from "./tool-protocol.js";

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
	/** 读取工具软上限；达到后正常收束。 */
	readonly maxReadRounds?: number;
	/** 工具传输方式；不设置时走原生函数调用。 */
	readonly toolTransport?: LlmToolTransport;
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
	/** 执行失败的原因；成功时为 null。 */
	readonly error: string | null;
}

/** 文本协议里被拒绝、没有执行的工具调用。 */
export interface ToolCallRejection {
	readonly name: string;
	readonly reason: string;
}

export interface ModelTurnResult {
	readonly result: LlmResult;
	/** 全部轮次里的工具调用，供结构化输出收集写出类工具。 */
	readonly toolCalls: readonly LlmToolCall[];
	readonly blocks: readonly ParsedContent[];
	/** 实际执行的读取工具轮数。 */
	readonly rounds: number;
	/** 模型在软上限处仍请求读取工具，本轮按上限收束。 */
	readonly capped: boolean;
	readonly calls: readonly ToolCallTrace[];
	readonly rejected: readonly ToolCallRejection[];
	readonly usage: LlmUsage;
	readonly attempts: number;
	readonly modelRounds: number;
	readonly cached: boolean;
	readonly firstTokenMs: number | null;
}

/**
 * 无状态单轮执行器：组装好的上下文先发一次主请求；模型请求读取工具时，
 * 校验参数、执行工具，把结果作为工具消息发回去，最多往返 `maxReadRounds` 轮。
 * 写入类工具只收集、不执行。工具传输可以是原生函数调用，也可以是正文里的
 * `<tool>` 文本协议，两种方式共用这里的校验、执行与软上限。
 */
export async function runModelTurns(
	options: ModelTurnOptions,
): Promise<ModelTurnResult> {
	const maxReadRounds = options.maxReadRounds ?? DEFAULT_MAX_READ_ROUNDS;
	assertMaxReadRounds(maxReadRounds, "读取工具软上限");
	const transport = assertToolTransport(
		options.toolTransport ?? "native",
		"工具传输方式",
	);
	if (options.messages.length === 0) {
		throw new Error("上下文消息不能为空");
	}
	const now = options.now ?? Date.now;
	const startedAt = now();
	const tools = [
		...(options.structuredTools ?? []),
		...(options.readTools ?? []),
	];
	const toolNames = new Set(tools.map((tool) => tool.name));
	const allowedReadTools = new Set(
		(options.readTools ?? []).map((tool) => tool.name),
	);
	const messages: LlmMessage[] = [...options.messages];
	if (transport === "text" && tools.length > 0) {
		insertToolProtocol(messages, tools);
	}
	const allToolCalls: LlmToolCall[] = [];
	const calls: ToolCallTrace[] = [];
	const rejected: ToolCallRejection[] = [];
	let rounds = 0;
	let capped = false;
	let firstTokenMs: number | null = null;
	let blocks: readonly ParsedContent[] = [];
	let last: LlmResult | null = null;
	let finalText = "";
	let usage = emptyUsage();
	let attempts = 0;
	let modelRounds = 0;
	let cached = true;
	let roundText = "";
	let roundReasoning = "";
	let roundIndex = 0;

	try {
		for (;;) {
			throwIfAborted(options.signal);
			const request = {
				messages,
				tools: transport === "native" && tools.length > 0 ? tools : undefined,
				model: options.model,
				maxTokens: options.maxTokens,
				temperature: options.temperature,
				reasoning: options.reasoning,
				signal: options.signal,
			};
			const parser = new BlockParser();
			const filter = transport === "text" ? new TextToolStreamFilter() : null;
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
				const visible =
					filter === null ? event.delta : filter.push(event.delta);
				if (visible.length === 0) continue;
				parser.push(visible);
				options.onTextDelta?.(visible, parser.snapshot());
			}
			if (filter !== null) {
				const tail = filter.finish();
				if (tail.length > 0) {
					parser.push(tail);
					options.onTextDelta?.(tail, parser.snapshot());
				}
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

			const extraction =
				transport === "text" ? extractTextToolCalls(result.text) : null;
			const body = extraction === null ? result.text : extraction.body;
			const roundCalls: RoundToolCall[] =
				extraction === null
					? result.toolCalls.map((call) => ({
							id: call.id,
							name: call.name,
							arguments: call.arguments,
							error: null,
						}))
					: extraction.calls.map((call, index) => ({
							id: `text-${roundIndex}-${index}`,
							name: call.name,
							arguments: call.arguments,
							error: call.error,
						}));
			roundIndex += 1;
			for (const call of roundCalls) {
				if (call.error === null && call.arguments !== null) {
					allToolCalls.push({
						id: call.id,
						name: call.name,
						arguments: call.arguments,
					});
				}
			}

			if (transport === "text") {
				for (const call of roundCalls) {
					if (!toolNames.has(call.name)) {
						rejected.push({
							name: call.name,
							reason: `未知工具：${call.name}`,
						});
					}
				}
			}

			const readRequests = roundCalls.filter(
				(call) => allowedReadTools.has(call.name) && isReadToolName(call.name),
			);
			if (readRequests.length === 0) {
				finalText = body;
				blocks = transport === "text" ? parseBlocks(body) : parser.finish();
				break;
			}
			if (rounds >= maxReadRounds) {
				if (body.trim().length === 0) {
					throw new Error("模型在工具轮数用完后仍只请求读取工具，没有生成正文");
				}
				capped = true;
				finalText = body;
				blocks = transport === "text" ? parseBlocks(body) : parser.finish();
				break;
			}

			rounds += 1;
			if (transport === "native") {
				messages.push({
					role: "assistant",
					content: result.text,
					toolCalls: readRequests.map((call) => ({
						id: call.id,
						name: call.name,
						arguments: call.arguments as JsonObject,
					})),
				});
			} else {
				messages.push({ role: "assistant", content: result.text });
			}
			for (const call of roundCalls) {
				throwIfAborted(options.signal);
				if (!isReadToolName(call.name) || !allowedReadTools.has(call.name)) {
					if (transport !== "text") continue;
					if (toolNames.has(call.name)) {
						messages.push({
							role: "tool",
							toolCallId: call.id,
							toolName: call.name,
							content: "已记录，正文输出结束后由结算器校验。",
							isError: false,
						});
					} else {
						messages.push({
							role: "tool",
							toolCallId: call.id,
							toolName: call.name,
							content: `工具调用失败：未知工具：${call.name}`,
							isError: true,
						});
					}
					continue;
				}
				let content: string;
				let ok = true;
				let error: string | null = null;
				if (call.error !== null || call.arguments === null) {
					ok = false;
					error = call.error ?? "参数缺失";
					content = `工具调用失败：${error}`;
				} else {
					try {
						const args = validateReadToolArguments(call.name, call.arguments);
						content = await executeReadTool(
							call.name,
							args,
							options.toolContext,
						);
					} catch (caught) {
						ok = false;
						error = caught instanceof Error ? caught.message : String(caught);
						content = `工具调用失败：${error}`;
					}
				}
				const trace: ToolCallTrace = { name: call.name, ok, error };
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
		result: { ...last, text: finalText },
		toolCalls: allToolCalls,
		blocks,
		rounds,
		capped,
		calls,
		rejected,
		usage,
		attempts,
		modelRounds,
		cached,
		firstTokenMs,
	};
}

interface RoundToolCall {
	readonly id: string;
	readonly name: string;
	readonly arguments: JsonObject | null;
	/** 文本协议里参数无法解析时的原因。 */
	readonly error: string | null;
}

/** 文本协议把工具说明插在开头几条 system 消息之后，正文与历史保持原顺序。 */
function insertToolProtocol(
	messages: LlmMessage[],
	tools: readonly LlmToolDefinition[],
): void {
	const protocol: LlmMessage = {
		role: "system",
		content: renderToolProtocol(tools),
	};
	const index = messages.findIndex((message) => message.role !== "system");
	if (index === -1) messages.push(protocol);
	else messages.splice(index, 0, protocol);
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
