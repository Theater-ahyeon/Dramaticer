import {
	BUILTIN_PLUGINS,
	type CardDependencyCatalog,
	type CardDependencyReport,
	type ContextSlotProviders,
	type ContextTemplate,
	DEFAULT_CONTEXT_TEMPLATE_ID,
	type DeclarativePlugin,
	type DirectorConfig,
	type DirectorMechanism,
	type EmbeddingClient,
	type EventPoolUpsertResult,
	type HistoryBlockPolicy,
	type NpcAgendaUpsertResult,
	type RerankClient,
	type StoryStore,
	type StructuredOutputMode,
	checkCardDependencies,
	createDefaultContextTemplate,
	createStandardChatSlots,
	parseDramaticerCardExtension,
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
	/** 本机已安装的声明式插件与玩法包；内置插件和卡随附插件自动计入。 */
	readonly availableDependencies?: CardDependencyCatalog;
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
	readonly dependencies: CardDependencyReport;
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

/**
 * 内置插件、调用方给出的已安装清单与卡随附插件合并成一份可用清单；
 * 同名时卡随附的版本优先，因为这张卡接下来加载的就是它。
 */
function mergeAvailableDependencies(
	installed: CardDependencyCatalog | undefined,
	bundled: readonly DeclarativePlugin[],
): CardDependencyCatalog {
	const plugins = new Map<
		string,
		{ readonly name: string; readonly version?: string }
	>();
	for (const plugin of BUILTIN_PLUGINS) {
		plugins.set(plugin.name, { name: plugin.name });
	}
	for (const entry of installed?.plugins ?? []) {
		plugins.set(entry.name, entry);
	}
	for (const plugin of bundled) {
		plugins.set(plugin.name, { name: plugin.name, version: plugin.version });
	}
	const playpacks = new Map<
		string,
		{ readonly name: string; readonly version?: string }
	>();
	for (const entry of installed?.playpacks ?? []) {
		playpacks.set(entry.name, entry);
	}
	return {
		plugins: [...plugins.values()],
		playpacks: [...playpacks.values()],
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
	const cardExtension = parseDramaticerCardExtension(
		card.extensions.dramaticer,
	);
	return {
		characterPrompt: renderCharacterPrompt(card),
		cardName: card.name,
		entities,
		lore,
		events: extension.events,
		npcAgendas: extension.npcAgendas,
		dependencies: checkCardDependencies(
			{
				requires: cardExtension.requires,
				recommends: cardExtension.recommends,
			},
			mergeAvailableDependencies(
				options.availableDependencies,
				cardExtension.plugins,
			),
		),
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

/**
 * 生产对话与回放评测共用的槽位集合：从角色卡渲染提示词后交给 core；
 * 槽位由 core 的内置槽位插件注册，调用方拿到的是装载后的提供者快照。
 */
export async function createChatProviders(
	store: StoryStore,
	options: CreateChatProvidersOptions,
): Promise<ContextSlotProviders> {
	const slots = await createStandardChatSlots({
		store,
		characterPrompt: renderCharacterPrompt(options.card),
		embedder: options.embedder,
		reranker: options.reranker,
		directorConfig: options.directorConfig,
		mechanisms: options.mechanisms,
		historyBlockPolicy: options.historyBlockPolicy,
	});
	return slots.providers;
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
