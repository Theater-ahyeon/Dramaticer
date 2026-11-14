import type { HistoryBlockPolicy } from "../blocks/history.js";
import type {
	ContextSlotProvider,
	ContextSlotProviders,
} from "../context/assembler.js";
import {
	CONTEXT_SLOT_NAMES,
	type ContextSlotName,
} from "../context/template.js";
import type { DirectorOrganizationKind } from "../director/organization.js";
import type { DirectorConfig, DirectorMechanism } from "../director/types.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import type { RerankClient } from "../llm/rerank.js";
import type { StoryStore } from "../store/story-store.js";
import type { WorldModelKind } from "../world-model/types.js";
import { BUILTIN_PLUGINS } from "./builtin.js";
import type { PluginDefinition, PluginKernel } from "./contracts.js";
import { createPluginKernel } from "./runtime.js";
import {
	CHARACTER_SLOT_PLUGIN,
	DIRECTOR_SLOT_PLUGIN,
	HISTORY_SLOT_PLUGIN,
	LORE_SLOT_PLUGIN,
	MEMORY_SLOT_PLUGIN,
	NAIVE_SLOT_PLUGINS,
	PERSONA_SLOT_PLUGIN,
	PROFILE_SLOT_PLUGIN,
	RAW_HISTORY_SLOT_PLUGIN,
	REUNION_SLOT_PLUGIN,
	SCENE_CARD_SLOT_PLUGIN,
	SCENE_SLOT_PLUGIN,
	STATE_SLOT_PLUGIN,
	SUMMARY_SLOT_PLUGIN,
	USER_WILL_SLOT_PLUGIN,
} from "./slots.js";

/** 一组槽位插件装载后的产物：内核负责生命周期，提供者快照供组装器使用。 */
export interface ChatSlotSet {
	readonly kernel: PluginKernel;
	readonly providers: ContextSlotProviders;
}

/** 从内核读出当前每个槽位的第一个提供者；没有注册的槽位不出现在结果里。 */
export function collectSlotProviders(
	kernel: PluginKernel,
): ContextSlotProviders {
	const providers: Partial<Record<ContextSlotName, ContextSlotProvider>> = {};
	for (const name of CONTEXT_SLOT_NAMES) {
		const entry = kernel.slotProviderEntry(name);
		if (entry === null) continue;
		providers[name] = { ...entry.provider, plugin: entry.plugin };
	}
	return providers;
}

async function composeSlotSet(
	plugins: readonly PluginDefinition[],
	configs: Readonly<Record<string, unknown>>,
): Promise<ChatSlotSet> {
	const kernel = await createPluginKernel({ plugins, configs });
	const failed = kernel
		.snapshot()
		.plugins.filter((plugin) => plugin.state !== "active");
	if (failed.length > 0) {
		const reasons = failed
			.map((plugin) => `${plugin.name}：${plugin.reason ?? "没有激活"}`)
			.join("；");
		await kernel.dispose();
		throw new Error(`槽位插件没有激活：${reasons}`);
	}
	return { kernel, providers: collectSlotProviders(kernel) };
}

export interface NaiveChatSlotsOptions {
	readonly store: StoryStore;
	/** 为空表示故事还没有导入角色卡，角色槽位记为缺失。 */
	readonly characterPrompt: string | null;
	/** 玩家人设；为空时 persona 槽位记为缺失。 */
	readonly persona: string | null;
	/** 最多带最近多少楼原文，默认 20。 */
	readonly historyLimit?: number;
}

/**
 * 朴素模式（B0）的槽位集合：角色、persona 与最近若干楼原文。
 * 不提供台账、记忆、lore、摘要、现场分析与导演槽位。
 */
export async function createNaiveChatSlots(
	options: NaiveChatSlotsOptions,
): Promise<ChatSlotSet> {
	return composeSlotSet(NAIVE_SLOT_PLUGINS, {
		[CHARACTER_SLOT_PLUGIN]: { prompt: options.characterPrompt },
		[PERSONA_SLOT_PLUGIN]: { persona: options.persona },
		[RAW_HISTORY_SLOT_PLUGIN]: {
			store: options.store,
			limit: options.historyLimit,
		},
	});
}

export interface StandardChatSlotsOptions {
	readonly store: StoryStore;
	/** 为空表示故事还没有导入角色卡，角色槽位记为缺失。 */
	readonly characterPrompt: string | null;
	readonly embedder?: EmbeddingClient | null;
	readonly reranker?: RerankClient | null;
	readonly directorConfig?: DirectorConfig;
	readonly directorOrganization?: DirectorOrganizationKind;
	readonly mechanisms?: readonly DirectorMechanism[];
	/** 块的 prompt 视图策略；不设置时使用默认策略。 */
	readonly historyBlockPolicy?: HistoryBlockPolicy;
	/** 世界模型的表示方式；不设置时使用台账。 */
	readonly worldModel?: WorldModelKind;
}

/** 生产对话与回放评测共用的槽位集合；人设槽位由朴素模式装载。 */
export async function createStandardChatSlots(
	options: StandardChatSlotsOptions,
): Promise<ChatSlotSet> {
	const embedder = options.embedder ?? null;
	const reranker = options.reranker ?? null;
	return composeSlotSet(BUILTIN_PLUGINS, {
		[CHARACTER_SLOT_PLUGIN]: { prompt: options.characterPrompt },
		[PERSONA_SLOT_PLUGIN]: { persona: null },
		[HISTORY_SLOT_PLUGIN]: {
			store: options.store,
			policy: options.historyBlockPolicy,
		},
		[STATE_SLOT_PLUGIN]: {
			store: options.store,
			worldModel: options.worldModel,
		},
		[SUMMARY_SLOT_PLUGIN]: { store: options.store },
		[MEMORY_SLOT_PLUGIN]: {
			store: options.store,
			embedder,
			reranker,
		},
		[LORE_SLOT_PLUGIN]: { store: options.store },
		[SCENE_SLOT_PLUGIN]: { store: options.store },
		[PROFILE_SLOT_PLUGIN]: { store: options.store },
		[REUNION_SLOT_PLUGIN]: {
			store: options.store,
			config: options.directorConfig,
			organization: options.directorOrganization,
		},
		[SCENE_CARD_SLOT_PLUGIN]: { store: options.store },
		[DIRECTOR_SLOT_PLUGIN]: {
			store: options.store,
			config: options.directorConfig,
			organization: options.directorOrganization,
			mechanisms: options.mechanisms,
		},
		[USER_WILL_SLOT_PLUGIN]: { store: options.store },
	});
}
