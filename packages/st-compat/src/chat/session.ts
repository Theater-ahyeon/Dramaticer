import {
	type ContextSlotProviders,
	type DirectorConfig,
	type DirectorMechanism,
	type EmbeddingClient,
	type StoryStore,
	createDirectorSlotProvider,
	createHistorySlotProvider,
	createLoreSlotProvider,
	createMemorySlotProvider,
	createStateSlotProvider,
	createStaticSlotProvider,
	createSummarySlotProvider,
} from "@dramaticer/core";
import type { StCharacterCard } from "../character-card.js";
import { importDramaticerExtension } from "../dramaticer-extension.js";
import { importCharacterCardEntity } from "../entity-import.js";
import {
	importCharacterBookLore,
	importWorldInfoLore,
} from "../lore-import.js";
import type { StWorldInfo } from "../world-info.js";
import { renderCharacterPrompt } from "./character.js";

export interface ImportCardContentOptions {
	readonly card: StCharacterCard;
	readonly worlds?: readonly StWorldInfo[];
}

/** 把角色卡、卡内世界书、外部世界书与原生扩展导入故事。 */
export function importCardContent(
	store: StoryStore,
	storyId: string,
	options: ImportCardContentOptions,
): void {
	const { card } = options;
	importCharacterCardEntity(store, storyId, card);
	if (card.characterBook !== null) {
		importCharacterBookLore(store, storyId, card.characterBook, card.name);
	}
	for (const worldInfo of options.worlds ?? []) {
		importWorldInfoLore(store, storyId, worldInfo);
	}
	importDramaticerExtension(store, storyId, card);
}

export interface CreateChatProvidersOptions {
	readonly card: StCharacterCard;
	readonly embedder?: EmbeddingClient | null;
	readonly directorConfig?: DirectorConfig;
	readonly mechanisms?: readonly DirectorMechanism[];
}

/** 生产对话与回放评测共用的槽位集合。 */
export function createChatProviders(
	store: StoryStore,
	options: CreateChatProvidersOptions,
): ContextSlotProviders {
	const embedder = options.embedder ?? null;
	return {
		character: createStaticSlotProvider(
			[{ role: "system", content: renderCharacterPrompt(options.card) }],
			`card:${options.card.name}`,
		),
		history: createHistorySlotProvider(store),
		state: createStateSlotProvider(store),
		summary: createSummarySlotProvider(store),
		memory: createMemorySlotProvider(store, { embedder }),
		lore: createLoreSlotProvider(store),
		director: createDirectorSlotProvider(store, {
			config: options.directorConfig,
			mechanisms: options.mechanisms,
		}),
	};
}
