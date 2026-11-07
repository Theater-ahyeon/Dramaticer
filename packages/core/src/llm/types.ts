import type { JsonObject } from "../json.js";

export type LlmRole = "system" | "user" | "assistant";

/**
 * 一条发给模型的消息。工具往返需要三种额外信息：助手消息里的工具调用、
 * 工具结果对应的调用 id，以及工具名（部分渠道要求结果带上它）。
 */
export type LlmMessage =
	| {
			readonly role: LlmRole;
			readonly content: string;
			readonly toolCalls?: readonly LlmToolCall[];
	  }
	| {
			readonly role: "tool";
			readonly content: string;
			readonly toolCallId: string;
			readonly toolName: string;
			readonly isError?: boolean;
	  };

export type LlmReasoningLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

export type LlmStopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export type LlmTruncationReason = "length" | "unclosed_tag" | "abrupt_end";

/** 已经生成、等待接着写的内容。 */
export interface LlmContinuation {
	readonly text: string;
	readonly reasoning: string;
}

export interface LlmToolDefinition {
	readonly name: string;
	readonly description: string;
	/** JSON Schema 对象，描述工具参数的形状。 */
	readonly parameters: Record<string, unknown>;
}

export interface LlmToolCall {
	readonly id: string;
	readonly name: string;
	readonly arguments: JsonObject;
}

export interface LlmRequest {
	readonly messages: readonly LlmMessage[];
	/** 提供给模型的工具；不设置时不发送工具定义。 */
	readonly tools?: readonly LlmToolDefinition[];
	/** 模型别名，由渠道配置解析；不设置时使用客户端的默认模型。 */
	readonly model?: string;
	readonly temperature?: number;
	readonly maxTokens?: number;
	/** 思考档位；不设置时使用渠道默认行为。 */
	readonly reasoning?: LlmReasoningLevel;
	/** 把已有内容交给模型接着写；聊天历史仍放在 messages 里。 */
	readonly continuation?: LlmContinuation;
	readonly signal?: AbortSignal;
}

export interface LlmUsage {
	readonly promptTokens: number | null;
	readonly completionTokens: number | null;
	readonly totalTokens: number | null;
	readonly reasoningTokens: number | null;
	readonly cachedTokens: number | null;
}

export interface LlmResult {
	readonly text: string;
	readonly reasoning: string;
	readonly toolCalls: readonly LlmToolCall[];
	readonly finishReason: string | null;
	readonly stopReason: LlmStopReason;
	readonly model: string;
	/** 实际使用的渠道 id；缓存命中或没有发出请求时为 null。 */
	readonly channel: string | null;
	readonly usage: LlmUsage;
	readonly raw: unknown;
	/** 命中本地缓存时为 true，此时没有发出网络请求。 */
	readonly cached: boolean;
	/** 实际发出的请求次数，包含重试与续写；缓存命中为 0。 */
	readonly attempts: number;
	/** 成功完成的模型回复数量，包含续写轮次。 */
	readonly rounds: number;
	readonly truncation: LlmTruncationReason | null;
	/** 还有内容可接着写时不为 null。 */
	readonly continuation: LlmContinuation | null;
}

export type LlmStreamEvent =
	| { readonly type: "text_delta"; readonly delta: string }
	| { readonly type: "thinking_delta"; readonly delta: string };

export interface LlmStream extends AsyncIterable<LlmStreamEvent> {
	result(): Promise<LlmResult>;
}

export interface LlmContinuationOptions {
	/** 首轮之后最多续写几次，默认 1；0 表示不续写。 */
	readonly maxRounds?: number;
	/** 哪些截断原因触发自动续写，默认只续写 stopReason 为 length 的情况。 */
	readonly continueOn?: readonly LlmTruncationReason[];
	/** 期望成对出现的标签名，用来检测未闭合的块。 */
	readonly expectedTags?: readonly string[];
	/** 句子结束字符集合，用于 abrupt_end 判定。 */
	readonly terminators?: string;
	/** 是否把没有以结束字符收尾的内容判为突然中断，默认 false。 */
	readonly detectAbruptEnd?: boolean;
}

export interface LlmCallOptions {
	readonly continuation?: LlmContinuationOptions;
}

/** 后台任务只依赖这个接口，测试可以注入假实现。 */
export interface LlmClient {
	complete(request: LlmRequest, options?: LlmCallOptions): Promise<LlmResult>;
}

export interface LlmStreamingClient extends LlmClient {
	stream(request: LlmRequest, options?: LlmCallOptions): LlmStream;
}

/** 模型层的连接参数；具体模型的能力由 LlmModelInfo 描述。 */
export interface LlmChannelLimits {
	readonly requestsPerMinute: number;
	readonly maxRetries: number;
	readonly retryBaseDelayMs: number;
}

export interface LlmModelInfo {
	readonly id: string;
	readonly contextWindow: number;
	readonly maxTokens: number;
	readonly reasoning: boolean;
}

export interface LlmProviderRequest {
	readonly model: LlmModelInfo;
	readonly messages: readonly LlmMessage[];
	readonly tools?: readonly LlmToolDefinition[];
	readonly temperature?: number;
	readonly maxTokens?: number;
	readonly reasoning?: LlmReasoningLevel;
	readonly continuation?: LlmContinuation;
	readonly signal?: AbortSignal;
}

export interface LlmProviderResult {
	readonly text: string;
	readonly reasoning: string;
	readonly toolCalls: readonly LlmToolCall[];
	readonly finishReason: string | null;
	readonly stopReason: LlmStopReason;
	readonly model: string;
	readonly usage: LlmUsage;
	readonly raw: unknown;
	readonly retryable: boolean;
	readonly status: number | null;
	readonly errorMessage: string | null;
	readonly continuation: LlmContinuation | null;
}

export interface LlmProviderStreamEvent {
	readonly type: "text_delta" | "thinking_delta";
	readonly delta: string;
}

/** 一个渠道适配器；路由只依赖这个接口，测试可以模拟失败的提供方。 */
export interface LlmChannel extends LlmChannelLimits {
	readonly id: string;
	readonly baseUrl: string;
	readonly apiKey: string;
	stream(request: LlmProviderRequest): LlmProviderStream;
}

export interface LlmProviderStream
	extends AsyncIterable<LlmProviderStreamEvent> {
	result(): Promise<LlmProviderResult>;
}

export class LlmProviderError extends Error {
	readonly status: number | null;
	readonly retryable: boolean;

	constructor(
		message: string,
		options: {
			readonly status?: number | null;
			readonly retryable?: boolean;
			readonly cause?: unknown;
		} = {},
	) {
		super(message, { cause: options.cause });
		this.name = "LlmProviderError";
		this.status = options.status ?? null;
		this.retryable = options.retryable ?? false;
	}
}

export interface LlmChannelFailure {
	readonly channel: string;
	readonly error: unknown;
}

export class LlmAllChannelsFailedError extends Error {
	readonly failures: readonly LlmChannelFailure[];

	constructor(model: string, failures: readonly LlmChannelFailure[]) {
		const detail = failures
			.map(
				(failure) =>
					`${failure.channel}：${
						failure.error instanceof Error
							? failure.error.message
							: String(failure.error)
					}`,
			)
			.join("；");
		super(`模型 ${model} 的所有渠道都失败了：${detail}`);
		this.name = "LlmAllChannelsFailedError";
		this.failures = failures;
	}
}
