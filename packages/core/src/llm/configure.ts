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
}

/** 按单个渠道配置创建适配器，渠道体检与路由共用。 */
export function createLlmChannel(config: LlmChannelConfig): LlmChannel {
	return new PiLlmChannel({
		id: config.id,
		api: config.api,
		baseUrl: config.baseUrl,
		apiKey: config.apiKey,
		requestsPerMinute: config.requestsPerMinute,
		maxRetries: config.maxRetries,
		retryBaseDelayMs: config.retryBaseDelayMs,
		timeoutMs: config.timeoutMs,
	});
}

/** 按渠道配置创建 pi 支持的模型客户端。 */
export function createLlmClient(
	config: LlmChannelsConfig,
	options: CreateLlmClientOptions = {},
): LlmStreamingClient {
	validateRoleModelFamilies(config);
	const channels = new Map<string, LlmChannel>();
	for (const channelConfig of config.channels.values()) {
		channels.set(channelConfig.id, createLlmChannel(channelConfig));
	}
	const routes = new Map<string, LlmRoute>();
	for (const model of config.models.values()) {
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
