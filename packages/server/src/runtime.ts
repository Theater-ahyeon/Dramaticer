import {
	type ContextSlotProviders,
	type ContextTemplate,
	DEFAULT_CONTEXT_TEMPLATE_ID,
	type EmbeddingClient,
	type LlmChannelsConfig,
	type LlmStreamingClient,
	type StorySettings,
	type StoryStore,
	createDefaultContextTemplate,
	createEmbeddingClient,
	createLlmClient,
	createStandardChatProviders,
	pickDefaultModelAlias,
} from "@dramaticer/core";

/** 按模型别名创建客户端；正文与后台任务各用一份，限速互不影响。 */
export type RuntimeClientFactory = (
	config: LlmChannelsConfig,
	modelAlias: string,
) => LlmStreamingClient;

export type RuntimeEmbedderFactory = (
	config: LlmChannelsConfig,
) => EmbeddingClient;

export const BACKGROUND_MODEL_ALIAS = "background";
export const DEFAULT_EMBEDDING_ALIAS = "default";

/** 一个故事跑一回合需要的全部东西；设置或渠道配置变化后整体重建。 */
export interface StoryRuntime {
	readonly settings: StorySettings;
	readonly modelAlias: string;
	readonly template: ContextTemplate;
	readonly providers: ContextSlotProviders;
	readonly chatClient: LlmStreamingClient;
	readonly backgroundClient: LlmStreamingClient | null;
	readonly embedder: EmbeddingClient | null;
}

export interface StoryRuntimeManagerOptions {
	readonly store: StoryStore;
	readonly loadConfig: () => Promise<LlmChannelsConfig>;
	readonly createClient?: RuntimeClientFactory;
	readonly createEmbedder?: RuntimeEmbedderFactory;
}

interface CachedRuntime {
	readonly key: string;
	readonly runtime: StoryRuntime;
}

/** 设置更新时间或渠道配置内容变化后重建运行时，其余时候复用缓存。 */
export class StoryRuntimeManager {
	readonly #store: StoryStore;
	readonly #loadConfig: () => Promise<LlmChannelsConfig>;
	readonly #createClient: RuntimeClientFactory;
	readonly #createEmbedder: RuntimeEmbedderFactory;
	readonly #cache = new Map<string, CachedRuntime>();

	constructor(options: StoryRuntimeManagerOptions) {
		this.#store = options.store;
		this.#loadConfig = options.loadConfig;
		this.#createClient =
			options.createClient ??
			((config, alias) =>
				createLlmClient(config, { defaultModel: alias, cacheDir: null }));
		this.#createEmbedder =
			options.createEmbedder ?? ((config) => createEmbeddingClient(config));
	}

	async get(storyId: string): Promise<StoryRuntime> {
		const settings = this.#store.getStorySettings(storyId);
		const config = await this.#loadConfig();
		const key = `${settings.updatedAt}\u0000${configFingerprint(config)}`;
		const cached = this.#cache.get(storyId);
		if (cached?.key === key) return cached.runtime;
		const runtime = this.#build(settings, config);
		this.#cache.set(storyId, { key, runtime });
		return runtime;
	}

	#build(settings: StorySettings, config: LlmChannelsConfig): StoryRuntime {
		const modelAlias = settings.model ?? pickDefaultModelAlias(config, "main");
		if (!config.models.has(modelAlias)) {
			throw new Error(`故事设置的模型 ${modelAlias} 不在渠道配置里`);
		}
		const template = resolveTemplate(
			this.#store,
			settings.templateId,
			settings.structuredOutput,
		);
		const embedder = config.embeddings.has(DEFAULT_EMBEDDING_ALIAS)
			? this.#createEmbedder(config)
			: null;
		return {
			settings,
			modelAlias,
			template,
			providers: createStandardChatProviders({
				store: this.#store,
				characterPrompt: settings.characterPrompt,
				embedder,
				directorConfig: settings.directorConfig,
			}),
			chatClient: this.#createClient(config, modelAlias),
			backgroundClient: config.models.has(BACKGROUND_MODEL_ALIAS)
				? this.#createClient(config, BACKGROUND_MODEL_ALIAS)
				: null,
			embedder,
		};
	}
}

function resolveTemplate(
	store: StoryStore,
	templateId: string | null,
	structuredOutput: StorySettings["structuredOutput"],
): ContextTemplate {
	if (templateId === null || templateId === DEFAULT_CONTEXT_TEMPLATE_ID) {
		return createDefaultContextTemplate({ structuredOutput });
	}
	const record = store.getContextTemplate(templateId);
	if (record === null) {
		throw new Error(`故事引用的上下文模板不存在：${templateId}`);
	}
	return record.template;
}

/** 配置对象的稳定指纹；渠道文件改过就会重建客户端。 */
function configFingerprint(config: LlmChannelsConfig): string {
	return JSON.stringify({
		channels: [...config.channels.values()],
		models: [...config.models.values()],
		embeddings: [...config.embeddings.values()],
	});
}
