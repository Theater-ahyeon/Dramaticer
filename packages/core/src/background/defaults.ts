import { GAP_PASS_JOB_KIND } from "../ledger/gap-pass.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import type { LlmClient } from "../llm/types.js";
import {
	type BackgroundJobPluginOptions,
	createBackgroundJobPlugins,
	createBackgroundJobRegistryFromPlugins,
} from "../plugins/background-jobs.js";
import type { BackgroundJobRegistry } from "./types.js";

export interface DefaultBackgroundRegistryOptions {
	/** 没有 embedding 客户端时不注册向量任务。 */
	readonly embedder?: EmbeddingClient | null;
	/** 规划器专用客户端；不设置时规划任务使用任务上下文里的后台客户端。 */
	readonly plannerClient?: LlmClient | null;
	/** 生图队列；不设置时不注册 illustrate 任务。 */
	readonly illustrate?: BackgroundJobPluginOptions["illustrate"];
}

/** 生产环境与自动试玩共用的任务注册表。 */
export function createDefaultBackgroundJobRegistry(
	options: DefaultBackgroundRegistryOptions = {},
): BackgroundJobRegistry {
	return createBackgroundJobRegistryFromPlugins(
		createBackgroundJobPlugins(options),
	);
}

export interface StoryBackgroundKindsOptions {
	readonly gapPassEnabled: boolean;
	/** 只跑指定类型；不设置时使用注册表里的全部类型。 */
	readonly requested?: string | null;
}

/**
 * 合并调用的开关按故事读取：关闭时这一类型既不建任务也不执行，其余类型
 * 照常。不认识的类型留在列表里，交给 drain 报错。
 */
export function resolveStoryBackgroundKinds(
	registry: BackgroundJobRegistry,
	options: StoryBackgroundKindsOptions,
): string[] {
	const kinds =
		options.requested === undefined || options.requested === null
			? [...registry.keys()]
			: [options.requested];
	if (options.gapPassEnabled) return kinds;
	return kinds.filter((kind) => kind !== GAP_PASS_JOB_KIND);
}
