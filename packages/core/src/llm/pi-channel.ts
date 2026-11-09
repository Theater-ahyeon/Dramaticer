import {
	type AssistantMessage,
	type Model,
	type Context as PiContext,
	type Message as PiMessage,
	type Usage as PiUsage,
	type SimpleStreamOptions,
	normalizeContext,
} from "@earendil-works/pi-ai";
import { streamSimple as googleStreamSimple } from "@earendil-works/pi-ai/api/google-generative-ai";
import { streamSimple as googleVertexStreamSimple } from "@earendil-works/pi-ai/api/google-vertex";
import { streamSimple as openAiStreamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import type { JsonObject } from "../json.js";
import type { LlmChannelApi } from "./channels.js";
import { createEventStream } from "./event-stream.js";
import {
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
			this.buildContext(
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
			return toProviderResult(message, status, request.signal);
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

	private buildContext(
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
			const content: AssistantMessage["content"] = [];
			if (message.content.length > 0) {
				content.push({ type: "text", text: message.content });
			}
			for (const call of message.toolCalls ?? []) {
				content.push({
					type: "toolCall",
					id: call.id,
					name: call.name,
					arguments: call.arguments,
				});
			}
			return {
				role: "assistant",
				content,
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

function toProviderResult(
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
			toolCalls.push({
				id: block.id,
				name: block.name,
				arguments: block.arguments as JsonObject,
			});
		}
	}
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
		retryable:
			failed && !signal?.aborted && isRetryable(status, message.errorMessage),
		status,
		errorMessage: message.errorMessage ?? null,
		continuation:
			text.length > 0 || reasoning.length > 0 ? { text, reasoning } : null,
	};
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
