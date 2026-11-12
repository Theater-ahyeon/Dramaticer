import {
	type AssistantMessage,
	type Model,
	type Context as PiContext,
	type Message as PiMessage,
	type Usage as PiUsage,
	type SimpleStreamOptions,
	type TextContent,
	type ThinkingContent,
	type ToolCall,
	normalizeContext,
} from "@earendil-works/pi-ai";
import { streamSimple as googleStreamSimple } from "@earendil-works/pi-ai/api/google-generative-ai";
import { streamSimple as googleVertexStreamSimple } from "@earendil-works/pi-ai/api/google-vertex";
import { streamSimple as openAiStreamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { type JsonObject, isJsonObject } from "../json.js";
import type { LlmChannelApi } from "./channels.js";
import { createEventStream } from "./event-stream.js";
import {
	type LlmAssistantNative,
	type LlmChannel,
	type LlmChannelLimits,
	type LlmContinuation,
	type LlmMessage,
	type LlmModelInfo,
	LlmProviderError,
	type LlmProviderRequest,
	type LlmProviderResult,
	type LlmProviderStream,
	type LlmProviderStreamEvent,
	type LlmStopReason,
	type LlmToolCall,
	type LlmToolDefinition,
	type LlmUsage,
} from "./types.js";

const CONTINUE_INSTRUCTION =
	"接着上面的内容继续写，不要重复已经写过的部分，直接从断开的地方开始。";

const ZERO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	total: 0,
} as const;

export interface PiLlmChannelOptions extends LlmChannelLimits {
	readonly id: string;
	readonly api: LlmChannelApi;
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly timeoutMs: number;
	/** Vertex 与 Google 适配器从这里读取项目、区域与凭证路径；缺省用进程环境。 */
	readonly env?: Readonly<Record<string, string | undefined>>;
}

/** 把 pi-ai 包装成 core/llm 的渠道适配器。 */
export class PiLlmChannel implements LlmChannel {
	readonly id: string;
	readonly api: LlmChannelApi;
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly requestsPerMinute: number;
	readonly maxRetries: number;
	readonly retryBaseDelayMs: number;
	readonly timeoutMs: number;
	private readonly env: Readonly<Record<string, string>>;

	constructor(options: PiLlmChannelOptions) {
		this.id = options.id;
		this.api = options.api;
		this.baseUrl = options.baseUrl;
		this.apiKey = options.apiKey;
		this.requestsPerMinute = options.requestsPerMinute;
		this.maxRetries = options.maxRetries;
		this.retryBaseDelayMs = options.retryBaseDelayMs;
		this.timeoutMs = options.timeoutMs;
		this.env = compactEnv(options.env ?? process.env);
	}

	stream(request: LlmProviderRequest): LlmProviderStream {
		return createEventStream((emit) => this.run(request, emit));
	}

	private async run(
		request: LlmProviderRequest,
		emit: (event: LlmProviderStreamEvent) => void,
	): Promise<LlmProviderResult> {
		let status: number | null = null;
		let piModel: Model<LlmChannelApi>;
		try {
			piModel = this.buildModel(request.model);
		} catch (error) {
			throw toProviderError(error, status, request.signal);
		}
		const context = normalizeContext(
			buildPiContext(
				request.messages,
				request.continuation,
				piModel,
				request.tools,
			),
		);
		const options: SimpleStreamOptions = {
			apiKey: resolveProviderApiKey(this.api, this.apiKey),
			signal: request.signal,
			temperature: request.temperature,
			maxTokens: request.maxTokens ?? request.model.maxTokens,
			reasoning: request.reasoning === "off" ? undefined : request.reasoning,
			timeoutMs: this.timeoutMs,
			maxRetries: 0,
			maxRetryDelayMs: 60_000,
			identity: { attribution: null },
			env: this.env,
			onResponse: (response) => {
				status = response.status;
			},
		};
		try {
			const stream =
				this.api === "openai-completions"
					? openAiStreamSimple(
							piModel as Model<"openai-completions">,
							context,
							options,
						)
					: this.api === "google-generative-ai"
						? googleStreamSimple(
								piModel as Model<"google-generative-ai">,
								context,
								options,
							)
						: googleVertexStreamSimple(
								piModel as Model<"google-vertex">,
								context,
								options,
							);
			for await (const event of stream) {
				if (event.type === "text_delta") {
					emit({ type: "text_delta", delta: event.delta });
				} else if (event.type === "thinking_delta") {
					emit({ type: "thinking_delta", delta: event.delta });
				}
			}
			const message = await stream.result();
			return providerResultFromMessage(message, status, request.signal);
		} catch (error) {
			throw toProviderError(error, status, request.signal);
		}
	}

	private buildModel(info: LlmModelInfo): Model<LlmChannelApi> {
		return {
			id: info.id,
			name: info.id,
			api: this.api,
			provider: this.id,
			baseUrl: this.baseUrl,
			input: ["text"],
			cost: ZERO_COST,
			reasoning: info.reasoning,
			contextWindow: info.contextWindow,
			maxTokens: info.maxTokens,
		};
	}
}

/**
 * 把 core 消息转换成 pi-ai 的上下文。助手消息带 `native.content` 时原样回放，
 * 只保留仍在当前消息里的工具调用；没有 `native` 时按正文与工具调用拼装。
 */
export function buildPiContext(
	messages: readonly LlmMessage[],
	continuation: LlmContinuation | undefined,
	model: Model<LlmChannelApi>,
	tools: readonly LlmToolDefinition[] | undefined,
): PiContext {
	const timestamp = Date.now();
	const converted: PiMessage[] = messages.map((message, index) => {
		const at = timestamp + index;
		if (message.role === "system") {
			return { role: "system", content: message.content, timestamp: at };
		}
		if (message.role === "user") {
			return { role: "user", content: message.content, timestamp: at };
		}
		if (message.role === "tool") {
			return {
				role: "toolResult",
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				content: [{ type: "text", text: message.content }],
				isError: message.isError ?? false,
				timestamp: at,
			};
		}
		return {
			role: "assistant",
			content: assistantContentFromMessage(message),
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: zeroUsage(),
			stopReason: "stop",
			timestamp: at,
		};
	});
	if (continuation !== undefined) {
		converted.push(
			syntheticAssistant(
				model,
				continuation.text,
				timestamp + messages.length,
				continuation.reasoning,
			),
		);
		converted.push({
			role: "user",
			content: CONTINUE_INSTRUCTION,
			timestamp: timestamp + messages.length + 1,
		});
	}
	return {
		messages: converted,
		tools: tools?.map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		})),
	};
}

function assistantContentFromMessage(message: {
	readonly content: string;
	readonly toolCalls?: readonly LlmToolCall[];
	readonly native?: LlmAssistantNative;
}): AssistantMessage["content"] {
	const toolCalls = message.toolCalls ?? [];
	if (message.native !== undefined && message.native.content.length > 0) {
		return replayNativeContent(message.native, toolCalls);
	}
	const content: AssistantMessage["content"] = [];
	if (message.content.length > 0) {
		content.push({ type: "text", text: message.content });
	}
	for (const call of toolCalls) {
		content.push(toolCallPart(call));
	}
	return content;
}

function replayNativeContent(
	native: LlmAssistantNative,
	toolCalls: readonly LlmToolCall[],
): AssistantMessage["content"] {
	const byId = new Map(toolCalls.map((call) => [call.id, call] as const));
	const content: AssistantMessage["content"] = [];
	const replayed = new Set<string>();
	for (const [index, part] of native.content.entries()) {
		const path = `native.content[${index}]`;
		if (part.type === "toolCall") {
			if (typeof part.id !== "string" || part.id.length === 0) {
				throw new Error(`${path}.id 必须是非空字符串`);
			}
			if (!byId.has(part.id)) continue;
			if (replayed.has(part.id)) {
				throw new Error(`${path}.id 重复：${part.id}`);
			}
			replayed.add(part.id);
			content.push(nativeToolCallPart(part, path));
			continue;
		}
		content.push(nativeTextPart(part, path));
	}
	for (const call of toolCalls) {
		if (!replayed.has(call.id)) content.push(toolCallPart(call));
	}
	return content;
}

function nativeTextPart(
	part: JsonObject,
	path: string,
): TextContent | ThinkingContent {
	if (part.type === "text") {
		if (typeof part.text !== "string") {
			throw new Error(`${path}.text 必须是字符串`);
		}
		const block: TextContent = { type: "text", text: part.text };
		if (part.textSignature !== undefined) {
			if (typeof part.textSignature !== "string") {
				throw new Error(`${path}.textSignature 必须是字符串`);
			}
			block.textSignature = part.textSignature;
		}
		return block;
	}
	if (part.type === "thinking") {
		if (typeof part.thinking !== "string") {
			throw new Error(`${path}.thinking 必须是字符串`);
		}
		const block: ThinkingContent = {
			type: "thinking",
			thinking: part.thinking,
		};
		if (part.thinkingSignature !== undefined) {
			if (typeof part.thinkingSignature !== "string") {
				throw new Error(`${path}.thinkingSignature 必须是字符串`);
			}
			block.thinkingSignature = part.thinkingSignature;
		}
		if (part.redacted !== undefined) {
			if (typeof part.redacted !== "boolean") {
				throw new Error(`${path}.redacted 必须是布尔值`);
			}
			block.redacted = part.redacted;
		}
		return block;
	}
	throw new Error(`${path}.type 必须是 text、thinking 或 toolCall`);
}

function nativeToolCallPart(part: JsonObject, path: string): ToolCall {
	if (typeof part.name !== "string" || part.name.length === 0) {
		throw new Error(`${path}.name 必须是非空字符串`);
	}
	if (!isJsonObject(part.arguments)) {
		throw new Error(`${path}.arguments 必须是 JSON 对象`);
	}
	const block: ToolCall = {
		type: "toolCall",
		id: part.id as string,
		name: part.name,
		arguments: part.arguments,
	};
	applyNativeToolCallFields(block, part, path);
	return block;
}

function toolCallPart(call: LlmToolCall): ToolCall {
	const block: ToolCall = {
		type: "toolCall",
		id: call.id,
		name: call.name,
		arguments: call.arguments,
	};
	if (call.native !== undefined) {
		applyNativeToolCallFields(block, call.native, `toolCall ${call.id}.native`);
	}
	return block;
}

function applyNativeToolCallFields(
	block: ToolCall,
	native: JsonObject,
	path: string,
): void {
	if (native.thoughtSignature !== undefined) {
		if (typeof native.thoughtSignature !== "string") {
			throw new Error(`${path}.thoughtSignature 必须是字符串`);
		}
		block.thoughtSignature = native.thoughtSignature;
	}
	if (native.namespace !== undefined) {
		if (typeof native.namespace !== "string") {
			throw new Error(`${path}.namespace 必须是字符串`);
		}
		block.namespace = native.namespace;
	}
	if (native.argumentsError !== undefined) {
		if (typeof native.argumentsError !== "string") {
			throw new Error(`${path}.argumentsError 必须是字符串`);
		}
		block.argumentsError = native.argumentsError;
	}
}

/** 空 apiKey 时 Vertex 用空字符串走 ADC；其它适配器用占位值避免 SDK 拒绝。 */
export function resolveProviderApiKey(
	api: LlmChannelApi,
	apiKey: string,
): string {
	if (apiKey.length > 0) return apiKey;
	return api === "google-vertex" ? "" : "unused";
}

function compactEnv(
	env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
	const compact: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) compact[key] = value;
	}
	return compact;
}

function syntheticAssistant(
	model: Model<LlmChannelApi>,
	text: string,
	timestamp: number,
	reasoning = "",
): AssistantMessage {
	const content: AssistantMessage["content"] = [];
	if (reasoning.length > 0) {
		content.push({ type: "thinking", thinking: reasoning });
	}
	if (text.length > 0) content.push({ type: "text", text });
	return {
		role: "assistant",
		content,
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: zeroUsage(),
		stopReason: "stop",
		timestamp,
	};
}

function zeroUsage(): PiUsage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { ...ZERO_COST },
	};
}

/** 把 pi-ai 的回复转换成 core 结果，并保留渠道原生签名。 */
export function providerResultFromMessage(
	message: AssistantMessage,
	status: number | null,
	signal: AbortSignal | undefined,
): LlmProviderResult {
	let text = "";
	let reasoning = "";
	const toolCalls: LlmToolCall[] = [];
	for (const block of message.content) {
		if (block.type === "text") text += block.text;
		else if (block.type === "thinking") reasoning += block.thinking;
		else if (block.type === "toolCall") {
			const native = nativeToolCallFields(block);
			toolCalls.push({
				id: block.id,
				name: block.name,
				arguments: block.arguments as JsonObject,
				...(native === undefined ? {} : { native }),
			});
		}
	}
	const native = nativeAssistantContent(message);
	const stopReason = mapStopReason(message.stopReason);
	const failed = stopReason === "error";
	const usage: LlmUsage = {
		promptTokens: message.usage.input,
		completionTokens: message.usage.output,
		totalTokens: message.usage.totalTokens,
		reasoningTokens: message.usage.reasoning ?? null,
		cachedTokens: message.usage.cacheRead,
	};
	return {
		text,
		reasoning,
		toolCalls,
		finishReason: message.rawStopReason ?? message.stopReason,
		stopReason,
		model: message.responseModel ?? message.model,
		usage,
		raw: message,
		...(native === undefined ? {} : { native }),
		retryable:
			failed && !signal?.aborted && isRetryable(status, message.errorMessage),
		status,
		errorMessage: message.errorMessage ?? null,
		continuation:
			text.length > 0 || reasoning.length > 0 ? { text, reasoning } : null,
	};
}

/**
 * 只在存在签名类字段时保留原生内容；没有签名的渠道不产生空的 native 对象。
 */
function nativeAssistantContent(
	message: AssistantMessage,
): LlmAssistantNative | undefined {
	let hasNative = false;
	const content: JsonObject[] = [];
	for (const block of message.content) {
		if (block.type === "text") {
			const part: JsonObject = { type: "text", text: block.text };
			if (block.textSignature !== undefined) {
				part.textSignature = block.textSignature;
				hasNative = true;
			}
			content.push(part);
			continue;
		}
		if (block.type === "thinking") {
			const part: JsonObject = { type: "thinking", thinking: block.thinking };
			if (block.thinkingSignature !== undefined) {
				part.thinkingSignature = block.thinkingSignature;
				hasNative = true;
			}
			if (block.redacted !== undefined) part.redacted = block.redacted;
			content.push(part);
			continue;
		}
		const part: JsonObject = {
			type: "toolCall",
			id: block.id,
			name: block.name,
			arguments: block.arguments as JsonObject,
		};
		const native = nativeToolCallFields(block);
		if (native !== undefined) {
			Object.assign(part, native);
			hasNative = true;
		}
		content.push(part);
	}
	return hasNative ? { content } : undefined;
}

function nativeToolCallFields(
	block: Pick<ToolCall, "thoughtSignature" | "namespace" | "argumentsError">,
): JsonObject | undefined {
	const native: JsonObject = {};
	if (block.thoughtSignature !== undefined) {
		native.thoughtSignature = block.thoughtSignature;
	}
	if (block.namespace !== undefined) native.namespace = block.namespace;
	if (block.argumentsError !== undefined) {
		native.argumentsError = block.argumentsError;
	}
	return Object.keys(native).length > 0 ? native : undefined;
}

function mapStopReason(reason: AssistantMessage["stopReason"]): LlmStopReason {
	switch (reason) {
		case "stop":
			return "stop";
		case "length":
			return "length";
		case "toolUse":
			return "toolUse";
		case "aborted":
			return "aborted";
		case "error":
		case "pending":
		case "deferred":
			return "error";
	}
}

function toProviderError(
	error: unknown,
	status: number | null,
	signal: AbortSignal | undefined,
): LlmProviderError {
	if (error instanceof LlmProviderError) return error;
	const message = error instanceof Error ? error.message : String(error);
	if (signal?.aborted) {
		return new LlmProviderError(message, {
			status,
			retryable: false,
			cause: error,
		});
	}
	return new LlmProviderError(message, {
		status,
		retryable: isRetryable(status, message),
		cause: error,
	});
}

function isRetryable(
	status: number | null,
	message: string | undefined,
): boolean {
	if (status !== null) {
		if (status === 408 || status === 409 || status === 425) return true;
		if (status === 429 || status >= 500) return true;
	}
	if (message === undefined) return false;
	return /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network error|rate limit|overloaded/i.test(
		message,
	);
}
