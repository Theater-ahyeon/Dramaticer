import { CANDIDATE_ACTIONS_JOB_KIND } from "../director/candidates.js";
import { VISUAL_PROFILE_JOB_KIND } from "../images/profiles.js";
import { GAP_PASS_JOB_KIND } from "../ledger/gap-pass.js";
import { MEMORY_REVISION_JOB_KIND } from "../ledger/revision.js";
import { SCENE_ARCHIVE_JOB_KIND } from "../ledger/scene-archive.js";
import { SCENE_LOG_JOB_KIND } from "../ledger/scene-log.js";
import { SETTLE_JOB_KIND } from "../ledger/settle.js";
import { USER_WILL_JOB_KIND } from "../ledger/user-will.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import type { LlmClient } from "../llm/types.js";
import { IMPORT_KIND_JOB_KIND } from "../memory/import-kind-suggest.js";
import { LORE_PREFILTER_JOB_KIND } from "../memory/lore-prefilter.js";
import { SCENE_JOB_KIND } from "../memory/scene.js";
import { OPENING_CANDIDATES_JOB_KIND } from "../opening/candidates.js";
import { OPENING_JOB_KIND } from "../opening/opening.js";
import {
	type BackgroundJobPluginOptions,
	createBackgroundJobPlugins,
	createBackgroundJobRegistryFromPlugins,
} from "../plugins/background-jobs.js";
import { readStoryFeatureState } from "../settings/features.js";
import type { StoryStore } from "../store/story-store.js";
import type { BackgroundJobRegistry } from "./types.js";

/**
 * 一次性的导入类任务：不计入每楼后台调用预算（v5 §3.2），检视器单独显示。
 * 插图另算一类，不在这里。
 */
export const ONE_TIME_JOB_KINDS: readonly string[] = [
	OPENING_JOB_KIND,
	OPENING_CANDIDATES_JOB_KIND,
	IMPORT_KIND_JOB_KIND,
	VISUAL_PROFILE_JOB_KIND,
];

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

/**
 * 场记打开时它就是每楼唯一的「局面更新」调用（v5 §3.2）：状态、在场者、场次边界、
 * 行动选项、事件与用户意志都在这一次里产出，下面这些每楼的分散调用不再建任务。
 * 场记关掉时它们照旧运行。
 */
export const MERGED_INTO_SITUATION: readonly string[] = [
	"events",
	SETTLE_JOB_KIND,
	SCENE_JOB_KIND,
	USER_WILL_JOB_KIND,
	MEMORY_REVISION_JOB_KIND,
	CANDIDATE_ACTIONS_JOB_KIND,
	LORE_PREFILTER_JOB_KIND,
];

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
			// 指名要跑的类型（CLI 的 --kind）照跑，不被合并规则挡掉。
			!(
				options.sceneLogEnabled &&
				(options.requested ?? null) === null &&
				MERGED_INTO_SITUATION.includes(kind)
			) &&
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
