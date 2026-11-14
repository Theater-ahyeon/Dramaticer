import type { HistoryBlockPolicy } from "../blocks/history.js";
import {
	createCharacterSlotProvider,
	createDirectorSlotProvider,
	createHistorySlotProvider,
	createLoreSlotProvider,
	createMemorySlotProvider,
	createPersonaSlotProvider,
	createProfileSlotProvider,
	createRawHistorySlotProvider,
	createReunionSlotProvider,
	createSceneCardSlotProvider,
	createSceneSlotProvider,
	createStateSlotProvider,
	createSummarySlotProvider,
	createUserWillSlotProvider,
} from "../chat/providers.js";
import type { DirectorOrganizationKind } from "../director/organization.js";
import type { DirectorConfig, DirectorMechanism } from "../director/types.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import type { RerankClient } from "../llm/rerank.js";
import type { StoryStore } from "../store/story-store.js";
import type { TokenEstimator } from "../tokens.js";
import type { WorldModelKind } from "../world-model/types.js";
import type { PluginDefinition } from "./contracts.js";

/**
 * 内置槽位插件：每个插件向内核注册一个上下文槽位提供者。
 * 依赖（存储、客户端、选项）按插件名从内核配置里取，插件本身不持有存储。
 */

export const CHARACTER_SLOT_PLUGIN = "slot.character";
export const PERSONA_SLOT_PLUGIN = "slot.persona";
export const HISTORY_SLOT_PLUGIN = "slot.history";
export const RAW_HISTORY_SLOT_PLUGIN = "slot.history.raw";
export const STATE_SLOT_PLUGIN = "slot.state";
export const SUMMARY_SLOT_PLUGIN = "slot.summary";
export const MEMORY_SLOT_PLUGIN = "slot.memory";
export const LORE_SLOT_PLUGIN = "slot.lore";
export const SCENE_SLOT_PLUGIN = "slot.scene";
export const PROFILE_SLOT_PLUGIN = "slot.profile";
export const REUNION_SLOT_PLUGIN = "slot.reunion";
export const SCENE_CARD_SLOT_PLUGIN = "slot.scene-card";
export const DIRECTOR_SLOT_PLUGIN = "slot.director";
export const USER_WILL_SLOT_PLUGIN = "slot.user-will";

export interface CharacterSlotConfig {
	/** 为空表示故事没有导入角色卡，插件不注册槽位。 */
	readonly prompt: string | null;
}

export interface PersonaSlotConfig {
	/** 为空表示故事没有设置人设，插件不注册槽位。 */
	readonly persona: string | null;
}

export interface HistorySlotConfig {
	readonly store: StoryStore;
	readonly limit?: number;
	readonly policy?: HistoryBlockPolicy;
	readonly recentRawFloors?: number;
	readonly estimator?: TokenEstimator;
}

export interface RawHistorySlotConfig {
	readonly store: StoryStore;
	readonly limit?: number;
}

export interface SummarySlotConfig {
	readonly store: StoryStore;
	readonly tokenLimit?: number;
	readonly compressionTokenLimit?: number;
	readonly tokenEstimator?: TokenEstimator;
}

export interface MemorySlotConfig {
	readonly store: StoryStore;
	readonly limit?: number;
	readonly embedder?: EmbeddingClient | null;
	readonly reranker?: RerankClient | null;
}

export interface LoreSlotConfig {
	readonly store: StoryStore;
	readonly tokenLimit?: number;
	readonly tokenEstimator?: TokenEstimator;
}

export interface DirectorSlotConfig {
	readonly store: StoryStore;
	readonly config?: DirectorConfig;
	readonly organization?: DirectorOrganizationKind;
	readonly mechanisms?: readonly DirectorMechanism[];
}

export interface StoreSlotConfig {
	readonly store: StoryStore;
}

function slotConfig(plugin: string, config: unknown): Record<string, unknown> {
	if (typeof config !== "object" || config === null || Array.isArray(config)) {
		throw new Error(`槽位插件 ${plugin} 的配置必须是对象`);
	}
	return config as Record<string, unknown>;
}

function requireSlotStore(
	plugin: string,
	values: Record<string, unknown>,
): StoryStore {
	const store = values.store;
	if (typeof store !== "object" || store === null) {
		throw new Error(`槽位插件 ${plugin} 的配置缺少 store`);
	}
	return store as StoryStore;
}

function optionalSlotText(
	plugin: string,
	values: Record<string, unknown>,
	field: string,
): string | null {
	const value = values[field];
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") {
		throw new Error(`槽位插件 ${plugin} 的配置 ${field} 必须是字符串`);
	}
	return value;
}

export const characterSlotPlugin: PluginDefinition = {
	name: CHARACTER_SLOT_PLUGIN,
	apply(context, config) {
		const values = slotConfig(CHARACTER_SLOT_PLUGIN, config);
		const prompt = optionalSlotText(CHARACTER_SLOT_PLUGIN, values, "prompt");
		if (prompt === null || prompt.trim().length === 0) return;
		context.slot("character", createCharacterSlotProvider(prompt));
	},
};

export const personaSlotPlugin: PluginDefinition = {
	name: PERSONA_SLOT_PLUGIN,
	apply(context, config) {
		const values = slotConfig(PERSONA_SLOT_PLUGIN, config);
		const persona = optionalSlotText(PERSONA_SLOT_PLUGIN, values, "persona");
		if (persona === null || persona.trim().length === 0) return;
		context.slot("persona", createPersonaSlotProvider(persona));
	},
};

export const historySlotPlugin: PluginDefinition = {
	name: HISTORY_SLOT_PLUGIN,
	apply(context, config) {
		const values = slotConfig(HISTORY_SLOT_PLUGIN, config);
		const store = requireSlotStore(HISTORY_SLOT_PLUGIN, values);
		context.slot(
			"history",
			createHistorySlotProvider(store, {
				limit: values.limit as number | undefined,
				policy: values.policy as HistoryBlockPolicy | undefined,
				recentRawFloors: values.recentRawFloors as number | undefined,
				estimator: values.estimator as TokenEstimator | undefined,
			}),
		);
	},
};

export const rawHistorySlotPlugin: PluginDefinition = {
	name: RAW_HISTORY_SLOT_PLUGIN,
	apply(context, config) {
		const values = slotConfig(RAW_HISTORY_SLOT_PLUGIN, config);
		const store = requireSlotStore(RAW_HISTORY_SLOT_PLUGIN, values);
		context.slot(
			"history",
			createRawHistorySlotProvider(store, {
				limit: values.limit as number | undefined,
			}),
		);
	},
};

export const stateSlotPlugin: PluginDefinition = {
	name: STATE_SLOT_PLUGIN,
	apply(context, config) {
		const values = slotConfig(STATE_SLOT_PLUGIN, config);
		context.slot(
			"state",
			createStateSlotProvider(requireSlotStore(STATE_SLOT_PLUGIN, values), {
				worldModel: values.worldModel as WorldModelKind | undefined,
			}),
		);
	},
};

export const sceneSlotPlugin: PluginDefinition = {
	name: SCENE_SLOT_PLUGIN,
	apply(context, config) {
		const values = slotConfig(SCENE_SLOT_PLUGIN, config);
		context.slot(
			"scene",
			createSceneSlotProvider(requireSlotStore(SCENE_SLOT_PLUGIN, values)),
		);
	},
};

export const profileSlotPlugin: PluginDefinition = {
	name: PROFILE_SLOT_PLUGIN,
	apply(context, config) {
		const values = slotConfig(PROFILE_SLOT_PLUGIN, config);
		context.slot(
			"profile",
			createProfileSlotProvider(requireSlotStore(PROFILE_SLOT_PLUGIN, values)),
		);
	},
};

export const reunionSlotPlugin: PluginDefinition = {
	name: REUNION_SLOT_PLUGIN,
	apply(context, config) {
		const values = slotConfig(REUNION_SLOT_PLUGIN, config);
		context.slot(
			"reunion",
			createReunionSlotProvider(requireSlotStore(REUNION_SLOT_PLUGIN, values), {
				recentFloors: values.recentFloors as number | undefined,
				unresolvedLimit: values.unresolvedLimit as number | undefined,
				directorConfig: values.config as DirectorConfig | undefined,
				directorOrganization: values.organization as
					| DirectorOrganizationKind
					| undefined,
			}),
		);
	},
};

export const sceneCardSlotPlugin: PluginDefinition = {
	name: SCENE_CARD_SLOT_PLUGIN,
	apply(context, config) {
		const values = slotConfig(SCENE_CARD_SLOT_PLUGIN, config);
		context.slot(
			"scene_card",
			createSceneCardSlotProvider(
				requireSlotStore(SCENE_CARD_SLOT_PLUGIN, values),
			),
		);
	},
};

export const userWillSlotPlugin: PluginDefinition = {
	name: USER_WILL_SLOT_PLUGIN,
	apply(context, config) {
		const values = slotConfig(USER_WILL_SLOT_PLUGIN, config);
		context.slot(
			"user_will",
			createUserWillSlotProvider(
				requireSlotStore(USER_WILL_SLOT_PLUGIN, values),
			),
		);
	},
};

export const summarySlotPlugin: PluginDefinition = {
	name: SUMMARY_SLOT_PLUGIN,
	apply(context, config) {
		const values = slotConfig(SUMMARY_SLOT_PLUGIN, config);
		const store = requireSlotStore(SUMMARY_SLOT_PLUGIN, values);
		context.slot(
			"summary",
			createSummarySlotProvider(store, {
				tokenLimit: values.tokenLimit as number | undefined,
				compressionTokenLimit: values.compressionTokenLimit as
					| number
					| undefined,
				tokenEstimator: values.tokenEstimator as TokenEstimator | undefined,
			}),
		);
	},
};

export const memorySlotPlugin: PluginDefinition = {
	name: MEMORY_SLOT_PLUGIN,
	apply(context, config) {
		const values = slotConfig(MEMORY_SLOT_PLUGIN, config);
		const store = requireSlotStore(MEMORY_SLOT_PLUGIN, values);
		context.slot(
			"memory",
			createMemorySlotProvider(store, {
				limit: values.limit as number | undefined,
				embedder: values.embedder as EmbeddingClient | null | undefined,
				reranker: values.reranker as RerankClient | null | undefined,
			}),
		);
	},
};

export const loreSlotPlugin: PluginDefinition = {
	name: LORE_SLOT_PLUGIN,
	apply(context, config) {
		const values = slotConfig(LORE_SLOT_PLUGIN, config);
		const store = requireSlotStore(LORE_SLOT_PLUGIN, values);
		context.slot(
			"lore",
			createLoreSlotProvider(store, {
				tokenLimit: values.tokenLimit as number | undefined,
				tokenEstimator: values.tokenEstimator as TokenEstimator | undefined,
			}),
		);
	},
};

export const directorSlotPlugin: PluginDefinition = {
	name: DIRECTOR_SLOT_PLUGIN,
	apply(context, config) {
		const values = slotConfig(DIRECTOR_SLOT_PLUGIN, config);
		const store = requireSlotStore(DIRECTOR_SLOT_PLUGIN, values);
		context.slot(
			"director",
			createDirectorSlotProvider(store, {
				config: values.config as DirectorConfig | undefined,
				organization: values.organization as
					| DirectorOrganizationKind
					| undefined,
				mechanisms: values.mechanisms as
					| readonly DirectorMechanism[]
					| undefined,
			}),
		);
	},
};

/** 全部内置槽位插件；顺序即内核装载顺序。 */
export const SLOT_PLUGINS: readonly PluginDefinition[] = [
	characterSlotPlugin,
	personaSlotPlugin,
	historySlotPlugin,
	stateSlotPlugin,
	summarySlotPlugin,
	memorySlotPlugin,
	loreSlotPlugin,
	sceneSlotPlugin,
	profileSlotPlugin,
	reunionSlotPlugin,
	sceneCardSlotPlugin,
	directorSlotPlugin,
	userWillSlotPlugin,
];

/** 朴素模式（B0）的槽位插件：角色、人设与最近若干楼原文。 */
export const NAIVE_SLOT_PLUGINS: readonly PluginDefinition[] = [
	characterSlotPlugin,
	personaSlotPlugin,
	rawHistorySlotPlugin,
];
