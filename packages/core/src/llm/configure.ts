import {
	type LlmChannelConfig,
	type LlmChannelsConfig,
	validateRoleModelFamilies,
} from "./channels.js";
import { PiLlmChannel } from "./pi-channel.js";
import { type LlmRoute, LlmRouter } from "./router.js";
import type { LlmChannel, LlmStreamingClient } from "./types.js";

export interface CreateLlmClientOptions {
	readonly defaultModel?: string;
	readonly cacheDir?: string | null;
	readonly sleep?: (
		ms: number,
		signal: AbortSignal | undefined,
	) => Promise<void>;
	readonly now?: () => number;
	/** Vertex 与 Google 适配器读取项目、区域与凭证路径；缺省用进程环境。 */
	readonly env?: Readonly<Record<string, string | undefined>>;
}

/** 按单个渠道配置创建适配器，渠道体检与路由共用。 */
export function createLlmChannel(
	config: LlmChannelConfig,
	env: Readonly<Record<string, string | undefined>> = process.env,
): LlmChannel {
	return new PiLlmChannel({
		id: config.id,
		api: config.api,
		baseUrl: config.baseUrl,
		apiKey: config.apiKey,
		requestsPerMinute: config.requestsPerMinute,
		maxRetries: config.maxRetries,
		retryBaseDelayMs: config.retryBaseDelayMs,
		timeoutMs: config.timeoutMs,
		env,
	});
}

/** 按渠道配置创建 pi 支持的模型客户端。 */
export function createLlmClient(
	config: LlmChannelsConfig,
	options: CreateLlmClientOptions = {},
): LlmStreamingClient {
	validateRoleModelFamilies(config);
	const defaultModel =
		options.defaultModel === undefined
			? undefined
			: config.models.get(options.defaultModel);
	if (defaultModel !== undefined && !defaultModel.enabled) {
		throw new Error(`模型 ${defaultModel.alias} 已经被停用`);
	}
	const channels = new Map<string, LlmChannel>();
	for (const channelConfig of config.channels.values()) {
		channels.set(
			channelConfig.id,
			createLlmChannel(channelConfig, options.env ?? process.env),
		);
	}
	const routes = new Map<string, LlmRoute>();
	for (const model of config.models.values()) {
		if (!model.enabled) continue;
		routes.set(model.alias, {
			model: {
				id: model.id,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				reasoning: model.reasoning,
			},
			channels: model.channels,
		});
	}
	return new LlmRouter({
		channels,
		routes,
		defaultModel: options.defaultModel,
		cacheDir: options.cacheDir,
		sleep: options.sleep,
		now: options.now,
	});
}
