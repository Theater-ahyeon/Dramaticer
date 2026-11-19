import type { BackgroundJobEntry } from "../background/registry.js";
import type { BackgroundJobRegistry } from "../background/types.js";
import type { BackgroundJobType } from "../background/types.js";
import {
	BLUEPRINT_SUGGESTION_JOB_KIND,
	blueprintSuggestionNeedsRun,
	createBlueprintSuggestionHandler,
} from "../blueprint/suggestions.js";
import {
	PLAN_PREPARE_JOB_KIND,
	PLAN_REVIEW_JOB_KIND,
	createPlanPrepareHandler,
	createPlanReviewHandler,
	planPrepareNeedsRun,
	planReviewNeedsRun,
} from "../chat/plan-turn.js";
import {
	DIRECTOR_BITS_JOB_KIND,
	createDirectorBitJudgmentsHandler,
} from "../director/bit-judgments.js";
import {
	CANDIDATE_ACTIONS_JOB_KIND,
	createCandidateActionsHandler,
} from "../director/candidates.js";
import {
	CHAPTER_PLAN_JOB_KIND,
	chapterPlanNeedsRun,
	createChapterPlanHandler,
} from "../director/chapter-plan.js";
import {
	DIRECTOR_PLAN_JOB_KIND,
	createDirectorPlanHandler,
	directorPlanNeedsRun,
} from "../director/planner.js";
import {
	VISUAL_PROFILE_JOB_KIND,
	createVisualProfileHandler,
	visualProfileNeedsRun,
} from "../images/profiles.js";
import {
	ILLUSTRATE_JOB_KIND,
	type IllustrateHandlerOptions,
	createIllustrateHandler,
	illustrateNeedsRun,
} from "../images/queue.js";
import { GAP_PASS_JOB_KIND, createGapPassHandler } from "../ledger/gap-pass.js";
import {
	MEMORY_REVISION_JOB_KIND,
	createMemoryRevisionHandler,
} from "../ledger/revision.js";
import {
	SCENE_ARCHIVE_JOB_KIND,
	createSceneArchiveHandler,
	createSceneArchiveNeedsRun,
} from "../ledger/scene-archive.js";
import {
	SCENE_LOG_JOB_KIND,
	createSceneLogHandler,
} from "../ledger/scene-log.js";
import { SETTLE_JOB_KIND, createSettleHandler } from "../ledger/settle.js";
import {
	USER_WILL_JOB_KIND,
	createUserWillHandler,
} from "../ledger/user-will.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import type { LlmClient } from "../llm/types.js";
import {
	COMPRESSION_JOB_KIND,
	createCompressionHandler,
} from "../memory/compression.js";
import {
	EMBEDDINGS_JOB_KIND,
	createEmbeddingsHandler,
} from "../memory/embed.js";
import { createEventExtractionHandler } from "../memory/extract.js";
import {
	IMPORT_KIND_JOB_KIND,
	createImportKindSuggestionHandler,
	importKindSuggestionsNeedRun,
} from "../memory/import-kind-suggest.js";
import {
	LORE_PREFILTER_JOB_KIND,
	createLorePrefilterHandler,
} from "../memory/lore-prefilter.js";
import {
	NPC_AGENDA_JOB_KIND,
	createNpcAgendaHandler,
} from "../memory/npc-agenda.js";
import { SCENE_JOB_KIND, createSceneHandler } from "../memory/scene.js";
import { createSummaryHandler } from "../memory/summarize.js";
import {
	OPENING_CANDIDATES_JOB_KIND,
	createOpeningCandidatesHandler,
	openingCandidatesNeedRun,
} from "../opening/candidates.js";
import {
	OPENING_JOB_KIND,
	createOpeningHandler,
	openingPackNeedsRun,
} from "../opening/opening.js";
import type { PluginDefinition } from "./contracts.js";
import { createStaticKernel } from "./static-kernel.js";

/** 内置后台任务插件：每个插件向内核注册一种任务类型。 */
export interface BackgroundJobPlugin extends PluginDefinition {
	readonly kind: string;
	readonly entry: BackgroundJobEntry;
}

export const EVENTS_JOB_PLUGIN = "background.events";
export const SUMMARY_JOB_PLUGIN = "background.summary";
export const COMPRESSION_JOB_PLUGIN = "background.compression";
export const NPC_AGENDA_JOB_PLUGIN = "background.npc-agenda";
export const LORE_PREFILTER_JOB_PLUGIN = "background.lore-prefilter";
export const IMPORT_KIND_JOB_PLUGIN = "background.import-kind";
export const SETTLE_JOB_PLUGIN = "background.settle";
export const SCENE_JOB_PLUGIN = "background.scene";
export const USER_WILL_JOB_PLUGIN = "background.user-will";
export const MEMORY_REVISION_JOB_PLUGIN = "background.memory-revision";
export const GAP_PASS_JOB_PLUGIN = "background.gap-pass";
export const SCENE_LOG_JOB_PLUGIN = "background.scene-log";
export const SCENE_ARCHIVE_JOB_PLUGIN = "background.scene-archive";
export const OPENING_JOB_PLUGIN = "background.opening";
export const OPENING_CANDIDATES_JOB_PLUGIN = "background.opening-candidates";
export const VISUAL_PROFILE_JOB_PLUGIN = "background.visual-profile";
export const ILLUSTRATE_JOB_PLUGIN = "background.illustrate";
export const DIRECTOR_PLAN_JOB_PLUGIN = "background.director-plan";
export const CHAPTER_PLAN_JOB_PLUGIN = "background.chapter-plan";
export const BLUEPRINT_SUGGESTION_JOB_PLUGIN =
	"background.blueprint-suggestion";
export const CANDIDATE_ACTIONS_JOB_PLUGIN = "background.candidate-actions";
export const DIRECTOR_BITS_JOB_PLUGIN = "background.director-bits";
export const EMBEDDINGS_JOB_PLUGIN = "background.embeddings";

/** 建立插件定义；入队条件、档位与 needsRun 由内核注册表校验。 */
export function backgroundJobPlugin(
	plugin: string,
	kind: string,
	entry: BackgroundJobEntry,
): BackgroundJobPlugin {
	return {
		name: plugin,
		kind,
		entry,
		apply(context) {
			context.backgroundJob(kind, entry);
		},
	};
}

/** 没有运行环境依赖的内置任务类型。 */
export const BACKGROUND_JOB_PLUGINS: readonly BackgroundJobPlugin[] = [
	backgroundJobPlugin(EVENTS_JOB_PLUGIN, "events", {
		handler: createEventExtractionHandler(),
		tier: "deferred",
	}),
	backgroundJobPlugin(SUMMARY_JOB_PLUGIN, "summary", {
		handler: createSummaryHandler(),
		tier: "deferred",
	}),
	backgroundJobPlugin(COMPRESSION_JOB_PLUGIN, COMPRESSION_JOB_KIND, {
		handler: createCompressionHandler(),
		tier: "deferred",
	}),
	backgroundJobPlugin(NPC_AGENDA_JOB_PLUGIN, NPC_AGENDA_JOB_KIND, {
		handler: createNpcAgendaHandler(),
		tier: "deferred",
	}),
	backgroundJobPlugin(LORE_PREFILTER_JOB_PLUGIN, LORE_PREFILTER_JOB_KIND, {
		handler: createLorePrefilterHandler(),
		enqueue: "settled",
		tier: "gap",
	}),
	backgroundJobPlugin(IMPORT_KIND_JOB_PLUGIN, IMPORT_KIND_JOB_KIND, {
		handler: createImportKindSuggestionHandler(),
		enqueue: "story",
		tier: "gap",
		needsRun: importKindSuggestionsNeedRun,
	}),
	backgroundJobPlugin(SETTLE_JOB_PLUGIN, SETTLE_JOB_KIND, {
		handler: createSettleHandler(),
		enqueue: "settled",
	}),
	backgroundJobPlugin(SCENE_JOB_PLUGIN, SCENE_JOB_KIND, {
		handler: createSceneHandler(),
		enqueue: "settled",
	}),
	backgroundJobPlugin(USER_WILL_JOB_PLUGIN, USER_WILL_JOB_KIND, {
		handler: createUserWillHandler(),
		enqueue: "settled",
	}),
	backgroundJobPlugin(MEMORY_REVISION_JOB_PLUGIN, MEMORY_REVISION_JOB_KIND, {
		handler: createMemoryRevisionHandler(),
		enqueue: "settled",
	}),
	backgroundJobPlugin(GAP_PASS_JOB_PLUGIN, GAP_PASS_JOB_KIND, {
		handler: createGapPassHandler(),
		enqueue: "settled",
	}),
	backgroundJobPlugin(SCENE_LOG_JOB_PLUGIN, SCENE_LOG_JOB_KIND, {
		handler: createSceneLogHandler(),
		enqueue: "settled",
	}),
	backgroundJobPlugin(SCENE_ARCHIVE_JOB_PLUGIN, SCENE_ARCHIVE_JOB_KIND, {
		handler: createSceneArchiveHandler(),
		enqueue: "story",
		tier: "gap",
		needsRun: createSceneArchiveNeedsRun(),
	}),
	backgroundJobPlugin(OPENING_JOB_PLUGIN, OPENING_JOB_KIND, {
		handler: createOpeningHandler(),
		enqueue: "story",
		needsRun: openingPackNeedsRun,
	}),
	backgroundJobPlugin(
		OPENING_CANDIDATES_JOB_PLUGIN,
		OPENING_CANDIDATES_JOB_KIND,
		{
			handler: createOpeningCandidatesHandler(),
			enqueue: "story",
			needsRun: openingCandidatesNeedRun,
		},
	),
	backgroundJobPlugin(VISUAL_PROFILE_JOB_PLUGIN, VISUAL_PROFILE_JOB_KIND, {
		handler: createVisualProfileHandler(),
		enqueue: "story",
		tier: "gap",
		needsRun: visualProfileNeedsRun,
	}),
];

export interface BackgroundJobPluginOptions {
	/** 没有 embedding 客户端时不注册向量任务。 */
	readonly embedder?: EmbeddingClient | null;
	/** 规划器专用客户端；不设置时规划任务使用任务上下文里的后台客户端。 */
	readonly plannerClient?: LlmClient | null;
	/** 生图队列；不设置时不注册 illustrate 任务。 */
	readonly illustrate?: IllustrateHandlerOptions | null;
}

function plannerOptions(plannerClient: LlmClient | null): {
	client?: LlmClient;
} {
	return plannerClient === null ? {} : { client: plannerClient };
}

/** 运行时依赖按选项补齐任务类型；不设置依赖时不注册对应任务。 */
export function createBackgroundJobPlugins(
	options: BackgroundJobPluginOptions = {},
): readonly BackgroundJobPlugin[] {
	const embedder = options.embedder ?? null;
	const plannerClient = options.plannerClient ?? null;
	const illustrate = options.illustrate ?? null;
	const plugins: BackgroundJobPlugin[] = [...BACKGROUND_JOB_PLUGINS];
	if (illustrate !== null) {
		plugins.push(
			backgroundJobPlugin(ILLUSTRATE_JOB_PLUGIN, ILLUSTRATE_JOB_KIND, {
				handler: createIllustrateHandler(illustrate),
				enqueue: "story",
				tier: "gap",
				needsRun: illustrateNeedsRun,
			}),
		);
	}
	plugins.push(
		backgroundJobPlugin(DIRECTOR_PLAN_JOB_PLUGIN, DIRECTOR_PLAN_JOB_KIND, {
			handler: createDirectorPlanHandler(plannerOptions(plannerClient)),
			enqueue: "story",
			tier: "deferred",
			needsRun: directorPlanNeedsRun,
		}),
		backgroundJobPlugin("job:plan-prepare", PLAN_PREPARE_JOB_KIND, {
			handler: createPlanPrepareHandler(),
			enqueue: "story",
			tier: "gap",
			needsRun: planPrepareNeedsRun,
		}),
		backgroundJobPlugin("job:plan-review", PLAN_REVIEW_JOB_KIND, {
			handler: createPlanReviewHandler(),
			enqueue: "story",
			tier: "gap",
			needsRun: planReviewNeedsRun,
		}),
		backgroundJobPlugin(CHAPTER_PLAN_JOB_PLUGIN, CHAPTER_PLAN_JOB_KIND, {
			handler: createChapterPlanHandler(plannerOptions(plannerClient)),
			enqueue: "story",
			tier: "deferred",
			needsRun: chapterPlanNeedsRun,
		}),
		backgroundJobPlugin(
			BLUEPRINT_SUGGESTION_JOB_PLUGIN,
			BLUEPRINT_SUGGESTION_JOB_KIND,
			{
				handler: createBlueprintSuggestionHandler(
					plannerOptions(plannerClient),
				),
				enqueue: "story",
				tier: "gap",
				needsRun: blueprintSuggestionNeedsRun,
			},
		),
		backgroundJobPlugin(
			CANDIDATE_ACTIONS_JOB_PLUGIN,
			CANDIDATE_ACTIONS_JOB_KIND,
			{
				handler: createCandidateActionsHandler(plannerOptions(plannerClient)),
				enqueue: "settled",
				tier: "gap",
			},
		),
		backgroundJobPlugin(DIRECTOR_BITS_JOB_PLUGIN, DIRECTOR_BITS_JOB_KIND, {
			handler: createDirectorBitJudgmentsHandler(plannerOptions(plannerClient)),
			enqueue: "settled",
			tier: "gap",
		}),
	);
	if (embedder !== null) {
		plugins.push(
			backgroundJobPlugin(EMBEDDINGS_JOB_PLUGIN, EMBEDDINGS_JOB_KIND, {
				handler: createEmbeddingsHandler({ embedder }),
			}),
		);
	}
	return plugins;
}

/**
 * 建立任务注册表：每个插件都必须装载成功，缺失的任务类型直接抛错，
 * 不静默降级。
 */
export function createBackgroundJobRegistryFromPlugins(
	plugins: readonly BackgroundJobPlugin[],
): BackgroundJobRegistry {
	const kernel = createStaticKernel(plugins);
	const registry = new Map<string, BackgroundJobType>();
	for (const plugin of plugins) {
		const status = kernel.status(plugin.name);
		if (status.state !== "active") {
			throw new Error(
				`后台任务插件 ${plugin.name} 没有激活：${status.reason ?? "未知原因"}`,
			);
		}
		const type = kernel.backgroundJob(plugin.kind);
		if (type === null) {
			throw new Error(
				`后台任务插件 ${plugin.name} 没有注册类型 ${plugin.kind}`,
			);
		}
		registry.set(plugin.kind, type);
	}
	return registry;
}
