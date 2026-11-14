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
import type { TurnRunEventInput } from "../run-log.js";
import type { AcceptedStateUpdate } from "../structured/types.js";
import {
	COMMIT_DRAFT_TOOL_NAME,
	DRAFT_WRITE_TOOL_NAME,
	executeDraftCommitTool,
	executeDraftWriteTool,
} from "../tools/draft-tools.js";
import {
	NOTE_WRITE_TOOL_NAME,
	executeNoteWriteTool,
} from "../tools/note-tools.js";
import {
	type ReadToolContext,
	executeReadTool,
	isReadToolName,
	validateReadToolArguments,
} from "../tools/read-tools.js";
import type {
	DeepToolDefinition,
	ToolPermission,
	ToolProgressEvent,
} from "../tools/registry.js";
import {
	RULE_CHECK_TOOL_NAME,
	executeRuleCheckTool,
} from "../tools/rule-tools.js";
import {
	LEDGER_WRITE_TOOL_NAME,
	executeLedgerWriteTool,
} from "../tools/write-tools.js";
import {
	type DeepContextOmission,
	type DeepContextWindow,
	addContextOmission,
	pruneToolRoundTrips,
} from "./context-window.js";
import type { TurnDraftController } from "./draft.js";
import {
	type TurnGuidanceController,
	formatGuidanceMessage,
} from "./guidance.js";
import { DEFAULT_MAX_READ_ROUNDS, assertMaxReadRounds } from "./mode.js";
import type { TurnNoteController } from "./notes.js";
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
	/** 中止之前已经执行的工具调用次数。 */
	readonly toolCallCount: number;

	constructor(
		reason: unknown,
		partialText: string,
		partialReasoning: string,
		firstTokenMs: number | null,
		toolCallCount = 0,
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
		this.toolCallCount = toolCallCount;
	}
}

export interface ModelTurnOptions {
	readonly client: LlmStreamingClient;
	readonly messages: readonly LlmMessage[];
	/** 结构化输出工具；只在函数调用模式下提供。 */
	readonly structuredTools?: readonly LlmToolDefinition[];
	/** 本模式启用的工具；读取、待提交写入与会登记的侧效应工具都走这里。 */
	readonly tools?: readonly DeepToolDefinition[];
	/** 已声明但当前未启用的工具；调用时返回工具错误并记录。 */
	readonly disabledTools?: readonly DeepToolDefinition[];
	readonly toolContext: ReadToolContext;
	/** 读取工具软上限；达到后正常收束。 */
	readonly maxReadRounds?: number;
	/**
	 * 工具调用总次数上限；深回合设置。设置后按调用次数而不是轮数收束，
	 * 超出上限的调用被拒绝，不再发出请求。
	 */
	readonly maxToolCalls?: number;
	/** 运行时长上限（毫秒）；每次发出请求之前检查。 */
	readonly maxDurationMs?: number;
	/**
	 * 深回合的工具往返上下文卫生；每次请求前超过上限就成对省略较早的
	 * 工具往返。快回合不传，不套用这条规则。
	 */
	readonly contextWindow?: DeepContextWindow;
	/** 深回合的草稿控制器；控制工具用它整份替换与提交草稿。 */
	readonly draft?: TurnDraftController | null;
	/** 深回合的手记控制器；note_write 用它收集提交前的修改。 */
	readonly notes?: TurnNoteController | null;
	/** 运行内的追加要求；每次请求前整批取出并作为用户消息追加。 */
	readonly guidance?: TurnGuidanceController | null;
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
	/** 工具执行前的进度阶段；同一阶段连续调用只回调一次。 */
	readonly onToolProgress?: (event: ToolProgressEvent) => void;
	/**
	 * 深回合的运行事件；快回合不传这个回调，运行表保持为空。
	 * 事件载荷只放计数、长度与状态，不放正文、参数或路径。
	 */
	readonly onRunEvent?: (event: TurnRunEventInput) => void;
	readonly now?: () => number;
}

export interface ToolCallTrace {
	readonly name: string;
	readonly ok: boolean;
	/** 执行失败的原因；成功时为 null。 */
	readonly error: string | null;
	/** 本次调用使用的权限级别；未知工具为 null。 */
	readonly permission: ToolPermission | null;
}

/** 被拒绝、没有执行的工具调用：模型调用了未注册的工具名。 */
export interface ToolCallRejection {
	readonly name: string;
	readonly reason: string;
}

/** 执行器收束的原因：自然结束、工具调用达到上限或运行超时。 */
export type ModelTurnStopReason = "completed" | "max_tool_calls" | "timeout";

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
	/** 实际执行的工具调用次数；被上限拒绝的调用不计入。 */
	readonly toolCallCount: number;
	readonly stopReason: ModelTurnStopReason;
	/** 深回合累计省略的工具往返；没有省略或快回合时为 null。 */
	readonly contextOmitted: DeepContextOmission | null;
	/** propose 工具收集的台账写入；提交楼层时统一写入。 */
	readonly proposedStateUpdates: readonly AcceptedStateUpdate[];
}

/**
 * 无状态单轮执行器：组装好的上下文先发一次主请求；模型请求工具时，
 * 按注册表声明的权限校验并执行：只读工具直接执行，待提交写入只收集，
 * 侧效应工具只登记，结果作为工具消息发回去。快回合按 `maxReadRounds`
 * 收束，深回合按工具调用总次数与运行时长收束。工具传输可以是原生函数
 * 调用，也可以是正文里的 `<tool>` 文本协议，两种方式共用这里的校验、
 * 执行与上限。
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
	const enabledTools = options.tools ?? [];
	const disabledTools = options.disabledTools ?? [];
	const tools = [
		...(options.structuredTools ?? []),
		...(enabledTools as readonly LlmToolDefinition[]),
	];
	const toolNames = new Set(tools.map((tool) => tool.name));
	const structuredNames = new Set(
		(options.structuredTools ?? []).map((tool) => tool.name),
	);
	const definitions = new Map(
		enabledTools.map((tool) => [tool.name, tool] as const),
	);
	const disabledDefinitions = new Map(
		disabledTools.map((tool) => [tool.name, tool] as const),
	);
	for (const name of disabledDefinitions.keys()) {
		if (definitions.has(name)) {
			throw new Error(`工具 ${name} 不能同时启用与停用`);
		}
	}
	const messages: LlmMessage[] = [...options.messages];
	if (transport === "text" && tools.length > 0) {
		insertToolProtocol(messages, tools);
	}
	const allToolCalls: LlmToolCall[] = [];
	const calls: ToolCallTrace[] = [];
	const rejected: ToolCallRejection[] = [];
	const proposedStateUpdates: AcceptedStateUpdate[] = [];
	let lastProgressPhase: string | null = null;
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
	let toolCallCount = 0;
	let stopReason: ModelTurnStopReason = "completed";
	/** 工具往返的成对省略；只累计，不记录被省略的正文。 */
	let contextOmitted: DeepContextOmission | null = null;
	/** 最近一轮的非空正文；上限收束时没有新正文就沿用它。 */
	let lastBody = "";

	try {
		for (;;) {
			throwIfAborted(options.signal);
			if (
				options.maxDurationMs !== undefined &&
				now() - startedAt >= options.maxDurationMs
			) {
				stopReason = "timeout";
				options.onRunEvent?.({
					kind: "limit",
					payload: {
						reason: "timeout",
						maxDurationMs: options.maxDurationMs,
						durationMs: now() - startedAt,
					},
				});
				finalText = lastBody;
				blocks = parseBlocks(finalText);
				break;
			}
			if (options.contextWindow !== undefined) {
				const pruned = pruneToolRoundTrips(messages, options.contextWindow);
				if (pruned.omitted !== null) {
					messages.splice(0, messages.length, ...pruned.messages);
					contextOmitted = addContextOmission(contextOmitted, pruned.omitted);
				}
			}
			// 指引在成对省略之后追加，保证不会被当作较早的工具往返省略掉。
			for (const text of options.guidance?.drain() ?? []) {
				messages.push({ role: "user", content: formatGuidanceMessage(text) });
			}
			const request = {
				messages,
				tools: transport === "native" && tools.length > 0 ? tools : undefined,
				model: options.model,
				maxTokens: options.maxTokens,
				temperature: options.temperature,
				reasoning: options.reasoning,
				signal: options.signal,
			};
			const roundNumber = roundIndex + 1;
			options.onRunEvent?.({
				kind: "model.request",
				payload: {
					round: roundNumber,
					model: options.model ?? null,
					messages: messages.length,
					tools: tools.length,
					transport,
				},
			});
			const requestStartedAt = now();
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
							native: call.native,
							error: null,
						}))
					: extraction.calls.map((call, index) => ({
							id: `text-${roundIndex}-${index}`,
							name: call.name,
							arguments: call.arguments,
							error: call.error,
						}));
			roundIndex += 1;
			options.onRunEvent?.({
				kind: "model.response",
				payload: {
					round: roundNumber,
					stopReason: result.stopReason,
					finishReason: result.finishReason,
					textLength: body.length,
					usage: {
						promptTokens: result.usage.promptTokens,
						completionTokens: result.usage.completionTokens,
						totalTokens: result.usage.totalTokens,
						reasoningTokens: result.usage.reasoningTokens,
						cachedTokens: result.usage.cachedTokens,
					},
					attempts: result.attempts,
					cached: result.cached,
					durationMs: now() - requestStartedAt,
				},
			});
			for (const call of roundCalls) {
				if (call.error === null && call.arguments !== null) {
					allToolCalls.push({
						id: call.id,
						name: call.name,
						arguments: call.arguments,
						...(call.native === undefined ? {} : { native: call.native }),
					});
				}
			}

			// 未知工具在任何传输下都拒绝并记录；原生传输同样不回放它。
			for (const call of roundCalls) {
				if (!toolNames.has(call.name) && !disabledDefinitions.has(call.name)) {
					rejected.push({
						name: call.name,
						reason: `未知工具：${call.name}`,
					});
				}
			}

			const drivingCalls = roundCalls.filter((call) => {
				if (disabledDefinitions.has(call.name)) return true;
				const definition = definitions.get(call.name);
				return (
					definition !== undefined && definition.permission !== "side_effect"
				);
			});
			const respondableCalls = roundCalls.filter(
				(call) =>
					definitions.has(call.name) || disabledDefinitions.has(call.name),
			);
			const followUp = drivingCalls.length > 0;
			if (body.length > 0) lastBody = body;
			if (
				followUp &&
				options.maxToolCalls === undefined &&
				rounds >= maxReadRounds
			) {
				if (body.trim().length === 0) {
					throw new Error("模型在工具轮数用完后仍只请求读取工具，没有生成正文");
				}
				capped = true;
				options.onRunEvent?.({
					kind: "limit",
					payload: { reason: "max_read_rounds", maxReadRounds },
				});
				finalText = body;
				blocks = transport === "text" ? parseBlocks(body) : parser.finish();
				break;
			}

			if (followUp) rounds += 1;
			let hitToolCallLimit = false;
			if (respondableCalls.length > 0) {
				if (transport === "native") {
					messages.push({
						role: "assistant",
						content: result.text,
						toolCalls: respondableCalls.map((call) => ({
							id: call.id,
							name: call.name,
							arguments: call.arguments as JsonObject,
							...(call.native === undefined ? {} : { native: call.native }),
						})),
						...(result.native === undefined ? {} : { native: result.native }),
					});
				} else {
					messages.push({ role: "assistant", content: result.text });
				}
			}
			for (const call of roundCalls) {
				const alreadyCommitted = options.draft?.committed === true;
				if (!alreadyCommitted) throwIfAborted(options.signal);
				const definition = definitions.get(call.name);
				const disabled = disabledDefinitions.get(call.name);
				if (definition !== undefined || disabled !== undefined) {
					options.onRunEvent?.({
						kind: "tool.call",
						payload: {
							round: roundNumber,
							name: call.name,
							permission:
								definition?.permission ?? disabled?.permission ?? null,
						},
					});
				}
				if (definition === undefined) {
					if (disabled !== undefined) {
						const error =
							disabled.disabledReason === undefined
								? `工具未启用：${call.name}`
								: `工具未启用：${call.name}（${disabled.disabledReason}）`;
						const trace: ToolCallTrace = {
							name: call.name,
							ok: false,
							error,
							permission: disabled.permission,
						};
						calls.push(trace);
						options.onToolCall?.(trace);
						options.onRunEvent?.({
							kind: "tool.result",
							payload: {
								round: roundNumber,
								name: call.name,
								permission: disabled.permission,
								ok: false,
								error,
								resultLength: 0,
							},
						});
						messages.push({
							role: "tool",
							toolCallId: call.id,
							toolName: call.name,
							content: `工具调用失败：${error}`,
							isError: true,
						});
						continue;
					}
					if (transport !== "text") continue;
					const structured = structuredNames.has(call.name);
					const resultContent = structured
						? "已记录，正文输出结束后由结算器校验。"
						: `工具调用失败：未知工具：${call.name}`;
					messages.push({
						role: "tool",
						toolCallId: call.id,
						toolName: call.name,
						content: resultContent,
						isError: !structured,
					});
					options.onRunEvent?.({
						kind: "tool.result",
						payload: {
							round: roundNumber,
							name: call.name,
							permission: null,
							ok: structured,
							error: structured ? null : `未知工具：${call.name}`,
							resultLength: resultContent.length,
						},
					});
					continue;
				}
				let content: string;
				let ok = true;
				let error: string | null = null;
				if (alreadyCommitted && definition.permission !== "control") {
					ok = false;
					error = "草稿已经提交，运行已经结束";
					content = `工具调用失败：${error}`;
				} else if (
					options.maxToolCalls !== undefined &&
					toolCallCount >= options.maxToolCalls
				) {
					hitToolCallLimit = true;
					error = `工具调用次数已达上限（${options.maxToolCalls}）`;
					ok = false;
					content = `工具调用失败：${error}`;
				} else if (call.error !== null || call.arguments === null) {
					ok = false;
					error = call.error ?? "参数缺失";
					content = `工具调用失败：${error}`;
				} else {
					toolCallCount += 1;
					if (definition.progressLabel !== lastProgressPhase) {
						lastProgressPhase = definition.progressLabel;
						options.onToolProgress?.({
							type: "progress",
							phase: definition.progressLabel,
							detail: definition.name,
						});
					}
					try {
						const outcome = await runTool(
							definition,
							call.arguments,
							options.toolContext,
							proposedStateUpdates,
							options.draft ?? null,
							options.notes ?? null,
						);
						content = outcome.content;
						ok = outcome.ok;
						error = outcome.error;
					} catch (caught) {
						ok = false;
						error = caught instanceof Error ? caught.message : String(caught);
						content = `工具调用失败：${error}`;
					}
				}
				const trace: ToolCallTrace = {
					name: call.name,
					ok,
					error,
					permission: definition.permission,
				};
				calls.push(trace);
				options.onToolCall?.(trace);
				options.onRunEvent?.({
					kind: "tool.result",
					payload: {
						round: roundNumber,
						name: call.name,
						permission: definition.permission,
						ok,
						error,
						resultLength: content.length,
					},
				});
				messages.push({
					role: "tool",
					toolCallId: call.id,
					toolName: call.name,
					content,
					isError: !ok,
				});
			}
			if (options.draft?.committed === true) {
				stopReason = "completed";
				finalText = options.draft.text;
				blocks = parseBlocks(finalText);
				break;
			}
			if (hitToolCallLimit) {
				stopReason = "max_tool_calls";
				options.onRunEvent?.({
					kind: "limit",
					payload: {
						reason: "max_tool_calls",
						maxToolCalls: options.maxToolCalls ?? null,
					},
				});
				finalText = body.length > 0 ? body : lastBody;
				blocks = parseBlocks(finalText);
				break;
			}
			if (!followUp) {
				finalText = body;
				blocks = transport === "text" ? parseBlocks(body) : parser.finish();
				break;
			}
		}
	} catch (error) {
		if (options.signal?.aborted) {
			throw new TurnAbortedError(
				options.signal.reason,
				roundText,
				roundReasoning,
				firstTokenMs,
				toolCallCount,
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
		toolCallCount,
		stopReason,
		contextOmitted,
		proposedStateUpdates,
	};
}

interface RoundToolCall {
	readonly id: string;
	readonly name: string;
	readonly arguments: JsonObject | null;
	/** 原生工具调用里随响应返回的渠道字段。 */
	readonly native?: JsonObject;
	/** 文本协议里参数无法解析时的原因。 */
	readonly error: string | null;
}

/**
 * 按权限执行一次工具调用：只读直接执行，待提交写入只收集，
 * 侧效应工具只登记，控制工具交给运行内的草稿控制器。
 */
async function runTool(
	definition: DeepToolDefinition,
	args: JsonObject,
	context: ReadToolContext,
	proposed: AcceptedStateUpdate[],
	draft: TurnDraftController | null,
	notes: TurnNoteController | null,
): Promise<{ content: string; ok: boolean; error: string | null }> {
	switch (definition.permission) {
		case "read": {
			if (definition.execute !== undefined) {
				const content = formatToolExecuteResult(await definition.execute(args));
				return { content, ok: true, error: null };
			}
			if (!isReadToolName(definition.name)) {
				throw new Error(
					`工具 ${definition.name} 声明为只读，但没有对应的读取实现`,
				);
			}
			const validated = validateReadToolArguments(definition.name, args);
			const content = await executeReadTool(
				definition.name,
				validated,
				context,
			);
			return { content, ok: true, error: null };
		}
		case "propose": {
			if (definition.name === NOTE_WRITE_TOOL_NAME) {
				if (notes === null) {
					throw new Error(`工具 ${definition.name} 没有运行句柄`);
				}
				const outcome = executeNoteWriteTool(args, notes);
				return {
					content: outcome.content,
					ok: outcome.ok,
					error: outcome.error,
				};
			}
			if (definition.name === RULE_CHECK_TOOL_NAME) {
				const outcome = executeRuleCheckTool(args, context, proposed);
				proposed.push(...outcome.accepted);
				return { content: outcome.content, ok: true, error: null };
			}
			if (definition.name !== LEDGER_WRITE_TOOL_NAME) {
				throw new Error(
					`工具 ${definition.name} 声明为待提交写入，但没有对应的收集实现`,
				);
			}
			const outcome = executeLedgerWriteTool(args);
			for (const proposal of outcome.accepted) {
				proposed.push({
					path: proposal.path,
					op: "set",
					value: proposal.value,
					reason: null,
					storyTime: proposal.storyTime,
					confidence: proposal.confidence,
				});
			}
			return { content: outcome.content, ok: outcome.ok, error: outcome.error };
		}
		case "side_effect":
			return { content: "已登记，后台会处理。", ok: true, error: null };
		case "control": {
			if (draft === null) {
				throw new Error(`控制工具 ${definition.name} 没有运行句柄`);
			}
			if (definition.name === DRAFT_WRITE_TOOL_NAME) {
				return executeDraftWriteTool(args, draft);
			}
			if (definition.name === COMMIT_DRAFT_TOOL_NAME) {
				return executeDraftCommitTool(args, draft);
			}
			throw new Error(
				`工具 ${definition.name} 声明为控制工具，但没有对应的运行句柄实现`,
			);
		}
	}
}

/** 插件工具的返回值统一转成文本；字符串原样返回，其余按 JSON 输出。 */
function formatToolExecuteResult(value: unknown): string {
	if (typeof value === "string") return value;
	const json = JSON.stringify(value);
	return json === undefined ? "null" : json;
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
