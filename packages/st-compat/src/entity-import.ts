import {
	type NewEntityInput,
	type StoryStore,
	normalizeEntityName,
} from "@dramaticer/core";
import type { StCharacterCard } from "./character-card.js";
import type { StWorldInfo, StWorldInfoEntry } from "./world-info.js";

export interface EntityImportOptions {
	/** 写入 `entities.source` 的来源标记 */
	readonly source?: string;
}

export interface EntityImportResult {
	/** 新建的实体数 */
	readonly created: number;
	/** 命中同名实体、只补别名的实体数 */
	readonly merged: number;
	/** 新增的显式别名数；实体名称本身不算 */
	readonly aliases: number;
	/** 缺少可用名称、没有导入的条目数 */
	readonly skipped: number;
}

interface MutableImportResult {
	created: number;
	merged: number;
	aliases: number;
	skipped: number;
}

interface UpsertOutcome {
	readonly created: boolean;
	readonly aliases: number;
}

function emptyResult(): MutableImportResult {
	return { created: 0, merged: 0, aliases: 0, skipped: 0 };
}

function usableAliases(aliases: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const alias of aliases) {
		const trimmed = alias.trim();
		if (trimmed.length === 0) continue;
		const normalized = normalizeEntityName(trimmed);
		if (normalized.length === 0 || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(trimmed);
	}
	return result;
}

/** 导入前统计新增的别名，避免把重复导入算成新增。 */
function upsertTracked(
	store: StoryStore,
	input: NewEntityInput,
): UpsertOutcome {
	const existing = store.findEntityByName(input.storyId, input.name);
	const known = new Set((existing?.aliases ?? []).map(normalizeEntityName));
	const name = normalizeEntityName(input.name);
	let added = 0;
	for (const alias of input.aliases ?? []) {
		const normalized = normalizeEntityName(alias);
		if (normalized === name || known.has(normalized)) continue;
		known.add(normalized);
		added += 1;
	}
	store.upsertEntity(input);
	return { created: existing === null, aliases: added };
}

function accumulate(result: MutableImportResult, outcome: UpsertOutcome): void {
	if (outcome.created) {
		result.created += 1;
	} else {
		result.merged += 1;
	}
	result.aliases += outcome.aliases;
}

export function importCharacterCardEntity(
	store: StoryStore,
	storyId: string,
	card: StCharacterCard,
	options: EntityImportOptions = {},
): EntityImportResult {
	const name = card.name.trim();
	if (name.length === 0) {
		throw new Error("角色卡缺少名称，无法导入实体");
	}
	const aliases: string[] = [];
	const nickname = card.nickname?.trim() ?? "";
	if (nickname.length > 0) aliases.push(nickname);
	const result = emptyResult();
	accumulate(
		result,
		upsertTracked(store, {
			storyId,
			kind: "character",
			name,
			description: card.description,
			source: options.source ?? "character-card",
			aliases,
		}),
	);
	return result;
}

function worldEntryName(entry: StWorldInfoEntry): string | null {
	const comment = entry.comment.trim();
	if (comment.length > 0) return comment;
	for (const key of entry.keys) {
		const trimmed = key.trim();
		if (trimmed.length > 0 && normalizeEntityName(trimmed).length > 0) {
			return trimmed;
		}
	}
	return null;
}

/**
 * 世界书条目导入为 `lore` 实体：注释（没有注释时用第一个主关键词）作为名称，
 * 全部主关键词作为别名。关键词里只有标点或空白的会被丢弃。
 */
export function importWorldInfoEntities(
	store: StoryStore,
	storyId: string,
	worldInfo: StWorldInfo,
	options: EntityImportOptions = {},
): EntityImportResult {
	const result = emptyResult();
	const source = options.source ?? "world-info";
	for (const entry of worldInfo.entries) {
		const name = worldEntryName(entry);
		if (name === null) {
			result.skipped += 1;
			continue;
		}
		const aliases = usableAliases(entry.keys);
		accumulate(
			result,
			upsertTracked(store, {
				storyId,
				kind: "lore",
				name,
				description: entry.content,
				source,
				aliases,
			}),
		);
	}
	return result;
}
