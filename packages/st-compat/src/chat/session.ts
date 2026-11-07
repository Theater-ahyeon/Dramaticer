import {
	type ContextSlotProviders,
	type DirectorConfig,
	type DirectorMechanism,
	type EmbeddingClient,
	type StoryStore,
	createStandardChatProviders,
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

export interface ImportedCardContent {
	readonly characterPrompt: string;
	readonly cardName: string;
}

/** 把角色卡、卡内世界书、外部世界书与原生扩展导入故事。 */
export function importCardContent(
	store: StoryStore,
	storyId: string,
	options: ImportCardContentOptions,
): ImportedCardContent {
	const { card } = options;
	importCharacterCardEntity(store, storyId, card);
	if (card.characterBook !== null) {
		importCharacterBookLore(store, storyId, card.characterBook, card.name);
	}
	for (const worldInfo of options.worlds ?? []) {
		importWorldInfoLore(store, storyId, worldInfo);
	}
	importDramaticerExtension(store, storyId, card);
	return { characterPrompt: renderCharacterPrompt(card), cardName: card.name };
}

export interface CreateChatProvidersOptions {
	readonly card: StCharacterCard;
	readonly embedder?: EmbeddingClient | null;
	readonly directorConfig?: DirectorConfig;
	readonly mechanisms?: readonly DirectorMechanism[];
}

/** 生产对话与回放评测共用的槽位集合：从角色卡渲染提示词后交给 core。 */
export function createChatProviders(
	store: StoryStore,
	options: CreateChatProvidersOptions,
): ContextSlotProviders {
	return createStandardChatProviders({
		store,
		characterPrompt: renderCharacterPrompt(options.card),
		embedder: options.embedder,
		directorConfig: options.directorConfig,
		mechanisms: options.mechanisms,
	});
}
