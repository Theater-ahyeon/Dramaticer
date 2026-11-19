import { CANDIDATE_ACTIONS_JOB_KIND } from "../director/candidates.js";
import { GAP_PASS_JOB_KIND } from "../ledger/gap-pass.js";
import { SCENE_ARCHIVE_JOB_KIND } from "../ledger/scene-archive.js";
import { SCENE_LOG_JOB_KIND } from "../ledger/scene-log.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import type { LlmClient } from "../llm/types.js";
import {
	type BackgroundJobPluginOptions,
	createBackgroundJobPlugins,
	createBackgroundJobRegistryFromPlugins,
} from "../plugins/background-jobs.js";
import { readStoryFeatureState } from "../settings/features.js";
import type { StoryStore } from "../store/story-store.js";
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
	/** 每楼一次场记调用；关闭时这一类型既不建任务也不执行。 */
	readonly sceneLogEnabled: boolean;
	/** 场次归档；依赖场记。不设置时跟随 `sceneLogEnabled`。 */
	readonly archiveEnabled?: boolean;
	/** 候选行动（功能页「行动选项」）；不设置时照常运行。 */
	readonly choicesEnabled?: boolean;
	readonly gapPassEnabled: boolean;
	/** 只跑指定类型；不设置时使用注册表里的全部类型。 */
	readonly requested?: string | null;
}

/**
 * 合并调用与场记的开关按故事读取：关闭时这一类型既不建任务也不执行，其余
 * 类型照常。不认识的类型留在列表里，交给 drain 报错。
 */
export function resolveStoryBackgroundKinds(
	registry: BackgroundJobRegistry,
	options: StoryBackgroundKindsOptions,
): string[] {
	const kinds =
		options.requested === undefined || options.requested === null
			? [...registry.keys()]
			: [options.requested];
	const archiveEnabled =
		options.sceneLogEnabled &&
		(options.archiveEnabled ?? options.sceneLogEnabled);
	return kinds.filter(
		(kind) =>
			(options.sceneLogEnabled || kind !== SCENE_LOG_JOB_KIND) &&
			(archiveEnabled || kind !== SCENE_ARCHIVE_JOB_KIND) &&
			(options.choicesEnabled !== false ||
				kind !== CANDIDATE_ACTIONS_JOB_KIND) &&
			(options.gapPassEnabled || kind !== GAP_PASS_JOB_KIND),
	);
}

/**
 * 故事的后台开关：功能页的「场记」「档案归档」与旧的 `sceneLogEnabled` 设置
 * 任一打开就运行。功能页是玩家看得见的那份，必须真的生效；旧设置保留给
 * CLI 与评测脚本强制打开。
 */
export function readStoryBackgroundSwitches(
	store: StoryStore,
	storyId: string,
): Pick<
	StoryBackgroundKindsOptions,
	"sceneLogEnabled" | "archiveEnabled" | "choicesEnabled" | "gapPassEnabled"
> {
	const settings = store.getStorySettings(storyId);
	const features = readStoryFeatureState(store, storyId).values;
	return {
		sceneLogEnabled: settings.sceneLogEnabled || features.scribe === true,
		archiveEnabled: settings.sceneLogEnabled || features.archive === true,
		choicesEnabled: features.choices === true,
		gapPassEnabled: settings.gapPassEnabled,
	};
}
