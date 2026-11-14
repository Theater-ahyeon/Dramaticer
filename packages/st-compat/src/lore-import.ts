import type {
	JsonObject,
	NewLoreEntryInput,
	StoryStore,
} from "@dramaticer/core";
import {
	type EntityImportResult,
	importWorldInfoEntities,
	usableAliases,
	worldEntryName,
} from "./entity-import.js";
import { buildWorldbookAuditEntries } from "./import-audit.js";
import { type StWorldInfo, worldInfoFromCharacterBook } from "./world-info.js";

export interface LoreImportOptions {
	/** 来源前缀，默认 `world-info`；完整来源是 `<前缀>:<世界书名称>:<条目键>`。 */
	readonly source?: string;
	/** 世界书名称；没有时用 `StWorldInfo.name`，再没有时用 `world`。 */
	readonly worldName?: string;
}

export interface LoreImportResult {
	/** 本次真正写入的条数 */
	readonly inserted: number;
	/** 同一来源已经存在、被跳过的条数 */
	readonly existing: number;
	/** 停用、没有名称或正文为空的条数 */
	readonly skipped: number;
	readonly entities: EntityImportResult;
}

/**
 * 世界书条目转换成通用 lore 条目：先导入实体，再把条目关联到实体。
 * 来源里带上世界书名称与条目键，重复导入同一份世界书不会产生重复行。
 */
export function importWorldInfoLore(
	store: StoryStore,
	storyId: string,
	worldInfo: StWorldInfo,
	options: LoreImportOptions = {},
): LoreImportResult {
	const sourcePrefix = options.source ?? "world-info";
	const worldName = options.worldName ?? worldInfo.name ?? "world";
	const entities = importWorldInfoEntities(store, storyId, worldInfo, {
		source: sourcePrefix,
	});
	const inputs: NewLoreEntryInput[] = [];
	let skipped = 0;
	for (const entry of worldInfo.entries) {
		if (entry.disabled) {
			skipped += 1;
			continue;
		}
		const name = worldEntryName(entry);
		const content = entry.content.trim();
		if (name === null || content.length === 0) {
			skipped += 1;
			continue;
		}
		const entity = store.findEntityByName(storyId, name);
		if (entity === null) {
			throw new Error(
				`世界书条目 "${entry.sourceKey}" 的实体没有导入成功：${name}`,
			);
		}
		inputs.push({
			storyId,
			entityId: entity.id,
			name,
			content,
			constant: entry.constant,
			keywords: usableAliases(entry.keys),
			source: `${sourcePrefix}:${worldName}:${entry.sourceKey}`,
		});
	}
	const inserted = store.insertLoreEntries(inputs);
	// 审计覆盖全部条目（含停用与空内容），来源与 lore 条目一致；lore 写入失败时不留半截记录。
	store.saveImportAuditEntries(
		storyId,
		buildWorldbookAuditEntries(worldInfo, {
			source: sourcePrefix,
			worldName,
		}),
	);
	return {
		inserted: inserted.length,
		existing: inputs.length - inserted.length,
		skipped,
		entities,
	};
}

/** 角色卡内嵌世界书的条目导入，来源前缀默认 `character-book`。 */
export function importCharacterBookLore(
	store: StoryStore,
	storyId: string,
	book: JsonObject,
	characterName: string,
	options: LoreImportOptions = {},
): LoreImportResult {
	return importWorldInfoLore(
		store,
		storyId,
		worldInfoFromCharacterBook(book, characterName),
		{
			source: options.source ?? "character-book",
			worldName: options.worldName ?? characterName,
		},
	);
}
