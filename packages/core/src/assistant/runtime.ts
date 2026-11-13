import { runDeepTurn } from "../chat/deep-turn.js";
import type { JsonObject, JsonValue } from "../json.js";
import type { LlmToolTransport } from "../llm/channels.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import type { RerankClient } from "../llm/rerank.js";
import type {
	LlmMessage,
	LlmReasoningLevel,
	LlmStreamingClient,
	LlmUsage,
} from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";
import type { DeepToolDefinition } from "../tools/registry.js";
import type { DeepTurnStopReason } from "../trace.js";
import { ASSISTANT_TOOL_NAMES, createAssistantTools } from "./tools.js";
import type {
	AssistantConversationStatus,
	AssistantEvent,
	AssistantMessage,
} from "./types.js";
import { AssistantRunConflictError } from "./types.js";

/** 每次助手运行的工具调用总次数上限；只用来防止跑飞。 */
export const ASSISTANT_MAX_TOOL_CALLS = 20;
/** 每次助手运行的时长上限（毫秒）。 */
export const ASSISTANT_MAX_DURATION_MS = 300_000;
/** 工具往返累计估算 token 的默认上限；会话的 context_budget 可以覆盖。 */
export const ASSISTANT_TOOL_CONTEXT_TOKEN_LIMIT = 32_000;
/** 工具往返上下文卫生保留的最近工具步数。 */
export const ASSISTANT_RECENT_TOOL_STEPS = 4;

export type AssistantTurnStatus = Extract<
	AssistantConversationStatus,
	"completed" | "cancelled" | "failed"
>;

export interface AssistantTurnOptions {
	readonly store: StoryStore;
	readonly client: LlmStreamingClient;
	readonly conversationId: string;
	readonly userText: string;
	/** 技能系统提示；会话内的消息接在它后面。 */
	readonly systemPrompt: string;
	readonly model?: string;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly reasoning?: LlmReasoningLevel;
	readonly toolTransport?: LlmToolTransport;
	readonly embedder?: EmbeddingClient | null;
	readonly reranker?: RerankClient | null;
	/** 会话的上下文预算；给出时覆盖工具往返的 token 上限。 */
	readonly contextBudget?: number | null;
	/** 本次运行启用的工具；缺省为全部已注册工具。 */
	readonly toolNames?: readonly string[];
	/** 技能附带的其他工具；与只读工具一起按会话权限包装。 */
	readonly extraTools?: readonly DeepToolDefinition[];
	/** 测试用：覆盖防失控上限。 */
	readonly maxToolCalls?: number;
	readonly maxDurationMs?: number;
	readonly signal?: AbortSignal;
	readonly onTextDelta?: (delta: string) => void;
	readonly onThinkingDelta?: (delta: string) => void;
	/** 每写入一条事件就回调一次；SSE 用它转发，客户端断开不影响写库。 */
	readonly onEvent?: (event: AssistantEvent) => void;
	readonly now?: () => number;
}

export interface AssistantTurnResult {
	readonly conversationId: string;
	readonly status: AssistantTurnStatus;
	/** 本次运行的正文；失败或取消时是已经生成的部分。 */
	readonly text: string;
	readonly userMessage: AssistantMessage;
	/** 正文为空（例如模型只调用工具就结束）时为 null。 */
	readonly assistantMessage: AssistantMessage | null;
	readonly error: string | null;
	readonly stopReason: DeepTurnStopReason;
	readonly toolCallCount: number;
	readonly durationMs: number;
	readonly usage: LlmUsage;
	readonly contextOmittedPairs: number;
}

/**
 * 运行一次助手回合：消息只来自技能系统提示、会话内消息与本轮用户输入，
 * 复用深回合的工具循环、传输、流式回调与上限。不组装剧情上下文、
 * 不调用 `generateAssistantTurn`、不写楼层与 `turn_runs`。
 *
 * 运行状态与事件都写进助手自己的表；同一会话同时只允许一次运行。
 */
export async function runAssistantTurn(
	options: AssistantTurnOptions,
): Promise<AssistantTurnResult> {
	const conversation = options.store.getAssistantConversation(
		options.conversationId,
	);
	if (conversation === null) {
		throw new Error(`助手会话不存在：${options.conversationId}`);
	}
	if (options.systemPrompt.trim().length === 0) {
		throw new Error("助手系统提示不能为空");
	}
	if (options.userText.trim().length === 0) {
		throw new Error("助手消息正文不能为空");
	}
	const toolNames =
		options.toolNames === undefined
			? null
			: resolveToolNames(
					options.toolNames,
					new Set([
						...ASSISTANT_TOOL_NAMES,
						...(options.extraTools ?? []).map((tool) => tool.name),
					]),
				);
	const now = options.now ?? Date.now;
	const startedAt = now();
	const startedEvent = options.store.startAssistantConversationRun(
		options.conversationId,
		{ conversationId: options.conversationId, skill: conversation.skill },
	);
	options.onEvent?.(startedEvent);
	const userMessage = options.store.appendAssistantMessage({
		conversationId: options.conversationId,
		role: "user",
		text: options.userText,
	});
	const writeEvent = (
		kind: AssistantEvent["kind"],
		payload: JsonObject,
	): AssistantEvent => {
		const event = options.store.appendAssistantEvent({
			conversationId: options.conversationId,
			kind,
			payload,
		});
		options.onEvent?.(event);
		return event;
	};
	const tools = createAssistantTools({
		store: options.store,
		storyId: conversation.storyId,
		permission: conversation.permission,
		conversationId: conversation.id,
		extraTools: options.extraTools,
		embedder: options.embedder ?? null,
		reranker: options.reranker ?? null,
		onToolCall: (name, args) => {
			writeEvent("tool.call", { name, arguments: args });
		},
		onToolResult: (name, ok, content) => {
			writeEvent("tool.result", {
				name,
				ok,
				result: { ok, content },
			});
			options.store.appendAssistantMessage({
				conversationId: options.conversationId,
				role: "tool",
				text: "",
				toolName: name,
				toolResult: { ok, content },
			});
		},
		onPermissionDenied: (name, permission, reason) => {
			writeEvent("permission.denied", { name, permission, reason });
		},
	}).filter((tool) => toolNames === null || toolNames.includes(tool.name));
	const messages = buildAssistantMessages(
		options.systemPrompt,
		options.store.getAssistantMessages(options.conversationId),
	);
	try {
		const deep = await runDeepTurn({
			client: options.client,
			messages,
			tools,
			toolContext: {
				store: options.store,
				storyId: conversation.storyId ?? "",
				beforeNodeId: "",
			},
			maxToolCalls: options.maxToolCalls ?? ASSISTANT_MAX_TOOL_CALLS,
			maxDurationMs: options.maxDurationMs ?? ASSISTANT_MAX_DURATION_MS,
			contextTokenLimit:
				options.contextBudget ?? ASSISTANT_TOOL_CONTEXT_TOKEN_LIMIT,
			recentToolSteps: ASSISTANT_RECENT_TOOL_STEPS,
			toolTransport: options.toolTransport ?? "native",
			model: options.model,
			maxTokens: options.maxTokens,
			temperature: options.temperature,
			reasoning: options.reasoning,
			signal: options.signal,
			onTextDelta: (delta) => {
				writeEvent("text.delta", { delta });
				options.onTextDelta?.(delta);
			},
			onThinkingDelta: (delta) => {
				writeEvent("thinking.delta", { delta });
				options.onThinkingDelta?.(delta);
			},
			now,
		});
		const text = deep.turn.result.text;
		const assistantMessage =
			text.trim().length === 0
				? null
				: options.store.appendAssistantMessage({
						conversationId: options.conversationId,
						role: "assistant",
						text,
						usage: usagePayload(deep.turn.usage),
					});
		writeEvent("usage", { usage: usagePayload(deep.turn.usage) });
		const completed = options.store.finishAssistantConversationRun(
			options.conversationId,
			"completed",
			"completed",
			{ status: "completed", stopReason: deep.stopReason },
		);
		options.onEvent?.(completed);
		return {
			conversationId: options.conversationId,
			status: "completed",
			text,
			userMessage,
			assistantMessage,
			error: null,
			stopReason: deep.stopReason,
			toolCallCount: deep.toolCallCount,
			durationMs: now() - startedAt,
			usage: deep.turn.usage,
			contextOmittedPairs: deep.contextOmitted?.pairs ?? 0,
		};
	} catch (error) {
		const cancelled =
			options.signal?.aborted === true || isAbort(error) === true;
		const message = cancelled
			? "运行已取消"
			: error instanceof Error
				? error.message
				: String(error);
		const partial = partialText(error);
		const assistantMessage =
			partial.trim().length === 0
				? null
				: options.store.appendAssistantMessage({
						conversationId: options.conversationId,
						role: "assistant",
						text: partial,
					});
		const status: AssistantTurnStatus = cancelled ? "cancelled" : "failed";
		const finalEvent = options.store.finishAssistantConversationRun(
			options.conversationId,
			status,
			"error",
			{ message },
		);
		options.onEvent?.(finalEvent);
		return {
			conversationId: options.conversationId,
			status,
			text: partial,
			userMessage,
			assistantMessage,
			error: message,
			stopReason: cancelled ? "aborted" : "error",
			toolCallCount: 0,
			durationMs: now() - startedAt,
			usage: emptyUsage(),
			contextOmittedPairs: 0,
		};
	}
}

function resolveToolNames(
	names: readonly string[],
	available: ReadonlySet<string>,
): readonly string[] {
	for (const name of names) {
		if (!available.has(name)) {
			throw new Error(`助手工具未注册：${name}`);
		}
	}
	return [...new Set(names)];
}

/**
 * 会话内消息转成模型消息。工具消息没有可以原样回放的调用 id 与原生签名，
 * 这里以 system 消息保留工具名与结果，避免伪造无法验证的调用。
 */
function buildAssistantMessages(
	systemPrompt: string,
	messages: readonly AssistantMessage[],
): LlmMessage[] {
	const result: LlmMessage[] = [{ role: "system", content: systemPrompt }];
	for (const message of messages) {
		switch (message.role) {
			case "user":
				result.push({ role: "user", content: message.text });
				break;
			case "assistant":
				result.push({ role: "assistant", content: message.text });
				break;
			case "system":
				result.push({ role: "system", content: message.text });
				break;
			case "tool": {
				const json = JSON.stringify(message.toolResult ?? null);
				result.push({
					role: "system",
					content: `工具 ${message.toolName ?? "未知"} 的结果：${json}`,
				});
				break;
			}
		}
	}
	return result;
}

function usagePayload(usage: LlmUsage): JsonObject {
	return {
		promptTokens: usage.promptTokens,
		completionTokens: usage.completionTokens,
		totalTokens: usage.totalTokens,
		reasoningTokens: usage.reasoningTokens,
		cachedTokens: usage.cachedTokens,
	};
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

function isAbort(error: unknown): boolean {
	if (error === null || typeof error !== "object" || !("name" in error)) {
		return false;
	}
	const name = error.name;
	return name === "TurnAbortedError" || name === "AbortError";
}

function partialText(error: unknown): string {
	if (
		error === null ||
		typeof error !== "object" ||
		!("partialText" in error)
	) {
		return "";
	}
	const partial = error.partialText;
	return typeof partial === "string" ? partial : "";
}
