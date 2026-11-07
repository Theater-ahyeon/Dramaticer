import type { LlmChannelsConfig } from "./channels.js";
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

/** 按渠道配置创建 pi 支持的模型客户端。 */
export function createLlmClient(
	config: LlmChannelsConfig,
	options: CreateLlmClientOptions = {},
): LlmStreamingClient {
	const channels = new Map<string, LlmChannel>();
	for (const channelConfig of config.channels.values()) {
		channels.set(
			channelConfig.id,
			new PiLlmChannel({
				id: channelConfig.id,
				api: channelConfig.api,
				baseUrl: channelConfig.baseUrl,
				apiKey: channelConfig.apiKey,
				requestsPerMinute: channelConfig.requestsPerMinute,
				maxRetries: channelConfig.maxRetries,
				retryBaseDelayMs: channelConfig.retryBaseDelayMs,
				timeoutMs: channelConfig.timeoutMs,
			}),
		);
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
