import type { LlmChannelApi, LlmModelProbe } from "@dramaticer/core";

/** 渠道的脱敏视图；密钥值永远不出现在这里。 */
export interface ChannelView {
	readonly id: string;
	readonly api: LlmChannelApi;
	readonly baseUrl: string;
	/** 密钥引用的环境变量名，例如 `DRAMATICER_MAIN_API_KEY`；没有引用时为 null。 */
	readonly apiKeyEnv: string | null;
	/** 该环境变量当前是否已设置。 */
	readonly apiKeySet: boolean;
	readonly requestsPerMinute: number;
	readonly maxRetries: number;
	readonly retryBaseDelayMs: number;
	readonly timeoutMs: number;
}

export interface ModelView {
	readonly alias: string;
	readonly id: string;
	readonly contextWindow: number;
	readonly maxTokens: number;
	readonly reasoning: boolean;
	/** 渠道 id，按优先级从高到低。 */
	readonly channels: readonly string[];
	readonly probe: LlmModelProbe | null;
}

export interface EmbeddingView {
	readonly id: string;
	readonly api: "openai-embeddings";
	readonly baseUrl: string;
	readonly apiKeyEnv: string | null;
	readonly apiKeySet: boolean;
	readonly model: string;
	readonly dimensions: number;
	readonly batchSize: number;
	readonly requestsPerMinute: number;
	readonly maxRetries: number;
	readonly retryBaseDelayMs: number;
	readonly timeoutMs: number;
}

export interface ChannelsView {
	readonly channels: readonly ChannelView[];
	readonly models: readonly ModelView[];
	readonly embeddings: readonly EmbeddingView[];
}

export interface ChannelUpdateInput {
	readonly api: LlmChannelApi;
	readonly baseUrl: string;
	/** 必须写成环境变量名，服务端保存为 `${变量名}` 引用。 */
	readonly apiKeyEnv: string;
	readonly requestsPerMinute: number;
	readonly maxRetries: number;
	readonly retryBaseDelayMs: number;
	readonly timeoutMs: number;
}

export interface ModelUpdateInput {
	readonly id: string;
	readonly contextWindow: number;
	readonly maxTokens: number;
	readonly reasoning: boolean;
	readonly channels: readonly string[];
}

export interface EmbeddingUpdateInput {
	readonly api: "openai-embeddings";
	readonly baseUrl: string;
	readonly apiKeyEnv: string;
	readonly model: string;
	readonly dimensions: number;
	readonly batchSize: number;
	readonly requestsPerMinute: number;
	readonly maxRetries: number;
	readonly retryBaseDelayMs: number;
	readonly timeoutMs: number;
}

/** 整份渠道配置的替换请求；键是渠道 id、模型别名与 embedding id。 */
export interface ChannelsUpdateRequest {
	readonly channels: Readonly<Record<string, ChannelUpdateInput>>;
	readonly models: Readonly<Record<string, ModelUpdateInput>>;
	readonly embeddings: Readonly<Record<string, EmbeddingUpdateInput>>;
}
