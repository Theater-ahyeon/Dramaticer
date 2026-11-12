import {
	CANDIDATE_ACTIONS_JOB_KIND,
	createCandidateActionsHandler,
} from "../director/candidates.js";
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
import { createBackgroundJobRegistry } from "./registry.js";
import type { BackgroundJobRegistry } from "./types.js";

export interface DefaultBackgroundRegistryOptions {
	/** 没有 embedding 客户端时不注册向量任务。 */
	readonly embedder?: EmbeddingClient | null;
	/** 规划器专用客户端；不设置时规划任务使用任务上下文里的后台客户端。 */
	readonly plannerClient?: LlmClient | null;
	/** 生图队列；不设置时不注册 illustrate 任务。 */
	readonly illustrate?: IllustrateHandlerOptions | null;
}

/** 生产环境与自动试玩共用的任务注册表。 */
export function createDefaultBackgroundJobRegistry(
	options: DefaultBackgroundRegistryOptions = {},
): BackgroundJobRegistry {
	const embedder = options.embedder ?? null;
	const plannerClient = options.plannerClient ?? null;
	return createBackgroundJobRegistry({
		events: { handler: createEventExtractionHandler(), tier: "deferred" },
		summary: { handler: createSummaryHandler(), tier: "deferred" },
		[COMPRESSION_JOB_KIND]: {
			handler: createCompressionHandler(),
			tier: "deferred",
		},
		[NPC_AGENDA_JOB_KIND]: {
			handler: createNpcAgendaHandler(),
			tier: "deferred",
		},
		[LORE_PREFILTER_JOB_KIND]: {
			handler: createLorePrefilterHandler(),
			enqueue: "settled",
			tier: "gap",
		},
		[SETTLE_JOB_KIND]: {
			handler: createSettleHandler(),
			enqueue: "settled",
		},
		[SCENE_JOB_KIND]: {
			handler: createSceneHandler(),
			enqueue: "settled",
		},
		[USER_WILL_JOB_KIND]: {
			handler: createUserWillHandler(),
			enqueue: "settled",
		},
		[MEMORY_REVISION_JOB_KIND]: {
			handler: createMemoryRevisionHandler(),
			enqueue: "settled",
		},
		[GAP_PASS_JOB_KIND]: {
			handler: createGapPassHandler(),
			enqueue: "settled",
		},
		[OPENING_JOB_KIND]: {
			handler: createOpeningHandler(),
			enqueue: "story",
			needsRun: openingPackNeedsRun,
		},
		[OPENING_CANDIDATES_JOB_KIND]: {
			handler: createOpeningCandidatesHandler(),
			enqueue: "story",
			needsRun: openingCandidatesNeedRun,
		},
		[VISUAL_PROFILE_JOB_KIND]: {
			handler: createVisualProfileHandler(),
			enqueue: "story",
			tier: "gap",
			needsRun: visualProfileNeedsRun,
		},
		...(options.illustrate === undefined || options.illustrate === null
			? {}
			: {
					[ILLUSTRATE_JOB_KIND]: {
						handler: createIllustrateHandler(options.illustrate),
						enqueue: "story" as const,
						tier: "gap" as const,
						needsRun: illustrateNeedsRun,
					},
				}),
		[DIRECTOR_PLAN_JOB_KIND]: {
			handler: createDirectorPlanHandler({
				...(plannerClient === null ? {} : { client: plannerClient }),
			}),
			enqueue: "story",
			tier: "deferred",
			needsRun: directorPlanNeedsRun,
		},
		[CANDIDATE_ACTIONS_JOB_KIND]: {
			handler: createCandidateActionsHandler({
				...(plannerClient === null ? {} : { client: plannerClient }),
			}),
			enqueue: "settled",
			tier: "gap",
		},
		...(embedder === null
			? {}
			: {
					[EMBEDDINGS_JOB_KIND]: createEmbeddingsHandler({ embedder }),
				}),
	});
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
