import type {
	DirectorPlanMergeResult,
	EventPoolUpsertResult,
	NewEventPoolEntryInput,
	NewNpcAgendaInput,
	NpcAgendaUpsertResult,
	StoryStore,
} from "@dramaticer/core";
import {
	mergePlannedArcs,
	normalizeEntityName,
	parseDramaticerCardExtension,
} from "@dramaticer/core";
import type { StCharacterCard } from "./character-card.js";

export interface DramaticerExtensionImportOptions {
	/** 事件池的来源标记，默认 `card-extension`。 */
	readonly source?: string;
}

export interface DramaticerExtensionImportResult {
	readonly events: EventPoolUpsertResult;
	readonly npcAgendas: NpcAgendaUpsertResult;
	readonly arcs: DirectorPlanMergeResult;
}

/**
 * 把卡的 `extensions.dramaticer` 导入事件池、NPC 议程与导演计划。NPC 名称或别名先
 * 解析成角色实体，找不到或对应多个实体都抛错；重复导入只更新内容，不产生重复行。
 */
export function importDramaticerExtension(
	store: StoryStore,
	storyId: string,
	card: StCharacterCard,
	options: DramaticerExtensionImportOptions = {},
): DramaticerExtensionImportResult {
	if (!store.getStory(storyId)) {
		throw new Error(`故事不存在：${storyId}`);
	}
	const extension = parseDramaticerCardExtension(card.extensions.dramaticer);
	const source = options.source ?? "card-extension";

	const eventInputs: NewEventPoolEntryInput[] = extension.events.map(
		(event) => ({
			storyId,
			sourceId: event.id,
			text: event.text,
			preconditions: event.preconditions,
			cooldown: event.cooldown,
			enabled: event.enabled,
			source,
		}),
	);
	const agendaInputs: NewNpcAgendaInput[] = extension.npcAgendas.map(
		(agenda, index) => {
			if (normalizeEntityName(agenda.npc).length === 0) {
				throw new Error(
					`extensions.dramaticer.npcAgendas[${index}].npc 去掉标点与空白后为空`,
				);
			}
			const candidates = store
				.resolveEntities(agenda.npc, { storyId })
				.filter((entity) => entity.kind === "character");
			const [entity, ...rest] = candidates;
			if (entity === undefined) {
				throw new Error(
					`extensions.dramaticer.npcAgendas[${index}].npc 找不到角色实体：${agenda.npc}`,
				);
			}
			if (rest.length > 0) {
				throw new Error(
					`extensions.dramaticer.npcAgendas[${index}].npc 对应多个角色实体：${agenda.npc}`,
				);
			}
			return {
				storyId,
				entityId: entity.id,
				goal: agenda.goal,
				everyChapters: agenda.everyChapters,
				importance: agenda.importance,
			};
		},
	);

	return {
		events: store.upsertEventPool(eventInputs),
		npcAgendas: store.upsertNpcAgendas(agendaInputs),
		arcs: mergePlannedArcs(store, storyId, { arcs: extension.arcs }, "import"),
	};
}
