import {
	type AssistantConversation,
	type EmbeddingClient,
	type LlmChannelsConfig,
	type LlmStreamingClient,
	type LlmToolTransport,
	type RerankClient,
	createEmbeddingClient,
	createLlmClient,
	createRerankClient,
	resolveDefaultMaxTokens,
	resolveModelForRole,
	resolveToolTransport,
} from "@dramaticer/core";
import type {
	RuntimeClientFactory,
	RuntimeEmbedderFactory,
} from "./runtime.js";

const DEFAULT_EMBEDDING_ALIAS = "default";

/** 一次助手运行需要的模型与检索客户端；与故事运行时相互独立。 */
export interface AssistantRuntime {
	readonly client: LlmStreamingClient;
	readonly modelAlias: string;
	readonly maxTokens: number;
	readonly toolTransport: LlmToolTransport;
	readonly embedder: EmbeddingClient | null;
	readonly reranker: RerankClient | null;
}

export interface AssistantRuntimeManagerOptions {
	readonly loadConfig: () => Promise<LlmChannelsConfig>;
	readonly createClient?: RuntimeClientFactory;
	readonly createEmbedder?: RuntimeEmbedderFactory;
}

/**
 * 助手运行时：默认用 `roles.writer` 解析到的模型，会话的 `model_alias`
 * 可以覆盖；模型停用或不存在时直接失败，不静默换模型。
 */
export class AssistantRuntimeManager {
	readonly #loadConfig: () => Promise<LlmChannelsConfig>;
	readonly #createClient: RuntimeClientFactory;
	readonly #createEmbedder: RuntimeEmbedderFactory;

	constructor(options: AssistantRuntimeManagerOptions) {
		this.#loadConfig = options.loadConfig;
		this.#createClient =
			options.createClient ??
			((config, alias) =>
				createLlmClient(config, { defaultModel: alias, cacheDir: null }));
		this.#createEmbedder =
			options.createEmbedder ?? ((config) => createEmbeddingClient(config));
	}

	async get(
		conversation: Pick<AssistantConversation, "modelAlias">,
	): Promise<AssistantRuntime> {
		const config = await this.#loadConfig();
		const modelAlias =
			conversation.modelAlias ?? resolveModelForRole(config, "writer");
		const model = config.models.get(modelAlias);
		if (model === undefined) {
			throw new Error(`助手模型 ${modelAlias} 不在渠道配置里`);
		}
		if (!model.enabled) {
			throw new Error(`助手模型 ${modelAlias} 已经被停用`);
		}
		return {
			client: this.#createClient(config, modelAlias),
			modelAlias,
			maxTokens: resolveDefaultMaxTokens(config, modelAlias),
			toolTransport: resolveToolTransport(model),
			embedder: config.embeddings.has(DEFAULT_EMBEDDING_ALIAS)
				? this.#createEmbedder(config)
				: null,
			reranker: createRerankClient(config),
		};
	}
}
