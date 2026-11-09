import {
	type ContextSlotProviders,
	type ContextTemplate,
	DEFAULT_CONTEXT_TEMPLATE_ID,
	type DirectorConfig,
	type DirectorMechanism,
	type EmbeddingClient,
	type EventPoolUpsertResult,
	type HistoryBlockPolicy,
	type NpcAgendaUpsertResult,
	type RerankClient,
	type StoryStore,
	type StructuredOutputMode,
	createDefaultContextTemplate,
	createStandardChatProviders,
} from "@dramaticer/core";
import type { StCharacterCard } from "../character-card.js";
import { importDramaticerExtension } from "../dramaticer-extension.js";
import {
	type EntityImportResult,
	importCharacterCardEntity,
} from "../entity-import.js";
import {
	type LoreImportResult,
	importCharacterBookLore,
	importWorldInfoLore,
} from "../lore-import.js";
import type { StWorldInfo } from "../world-info.js";
import { renderCharacterPrompt } from "./character.js";

export interface ImportCardContentOptions {
	readonly card: StCharacterCard;
	readonly worlds?: readonly StWorldInfo[];
}

export interface ImportedLoreTotals {
	readonly inserted: number;
	readonly existing: number;
	readonly skipped: number;
}

export interface ImportedCardContent {
	readonly characterPrompt: string;
	readonly cardName: string;
	readonly entities: EntityImportResult;
	readonly lore: ImportedLoreTotals;
	readonly events: EventPoolUpsertResult;
	readonly npcAgendas: NpcAgendaUpsertResult;
}

function addEntities(
	total: EntityImportResult,
	next: EntityImportResult,
): EntityImportResult {
	return {
		created: total.created + next.created,
		merged: total.merged + next.merged,
		aliases: total.aliases + next.aliases,
		skipped: total.skipped + next.skipped,
	};
}

function addLore(
	total: ImportedLoreTotals,
	next: LoreImportResult,
): ImportedLoreTotals {
	return {
		inserted: total.inserted + next.inserted,
		existing: total.existing + next.existing,
		skipped: total.skipped + next.skipped,
	};
}

/** 把角色卡、卡内世界书、外部世界书与原生扩展导入故事。 */
export function importCardContent(
	store: StoryStore,
	storyId: string,
	options: ImportCardContentOptions,
): ImportedCardContent {
	const { card } = options;
	let entities = importCharacterCardEntity(store, storyId, card);
	let lore: ImportedLoreTotals = { inserted: 0, existing: 0, skipped: 0 };
	if (card.characterBook !== null) {
		const result = importCharacterBookLore(
			store,
			storyId,
			card.characterBook,
			card.name,
		);
		entities = addEntities(entities, result.entities);
		lore = addLore(lore, result);
	}
	for (const worldInfo of options.worlds ?? []) {
		const result = importWorldInfoLore(store, storyId, worldInfo);
		entities = addEntities(entities, result.entities);
		lore = addLore(lore, result);
	}
	const extension = importDramaticerExtension(store, storyId, card);
	return {
		characterPrompt: renderCharacterPrompt(card),
		cardName: card.name,
		entities,
		lore,
		events: extension.events,
		npcAgendas: extension.npcAgendas,
	};
}

export interface CreateChatProvidersOptions {
	readonly card: StCharacterCard;
	readonly embedder?: EmbeddingClient | null;
	readonly reranker?: RerankClient | null;
	readonly directorConfig?: DirectorConfig;
	readonly mechanisms?: readonly DirectorMechanism[];
	/** 故事设置里的历史块策略；不设置时使用默认策略。 */
	readonly historyBlockPolicy?: HistoryBlockPolicy;
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
		reranker: options.reranker,
		directorConfig: options.directorConfig,
		mechanisms: options.mechanisms,
		historyBlockPolicy: options.historyBlockPolicy,
	});
}

/** 故事指向库里的模板时读取它；为空或指向内置模板时用默认模板。 */
export function resolveStoryContextTemplate(
	store: StoryStore,
	templateId: string | null,
	mode: StructuredOutputMode,
): ContextTemplate {
	if (templateId === null || templateId === DEFAULT_CONTEXT_TEMPLATE_ID) {
		return createDefaultContextTemplate({ structuredOutput: mode });
	}
	const record = store.getContextTemplate(templateId);
	if (record === null) {
		throw new Error(`故事引用的上下文模板不存在：${templateId}`);
	}
	return record.template;
}
