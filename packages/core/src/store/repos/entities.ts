// StoryStore 的领域仓储：实体、实体候选与角色外观（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import { randomUUID } from "node:crypto";
import {
	type Entity,
	type EntityKind,
	type NewEntityInput,
	isEntityKind,
	normalizeEntityName,
} from "../../entity.js";
import {
	type CharacterVisualProfileRecord,
	type SaveCharacterVisualProfilesInput,
	assertCharacterVisualProfile,
	assertUniqueVisualProfiles,
	isVisualProfileSource,
} from "../../images/types.js";
import type {
	EntityCandidate,
	NewEntityCandidateInput,
} from "../../ledger/settlement.js";
import { serializeJsonValue } from "../json-value.js";
import { StoreRepo } from "./base.js";
import { assertNonEmptyString } from "./shared.js";

interface EntityCandidateRow {
	readonly story_id: string;
	readonly normalized_name: string;
	readonly kind: string;
	readonly hits: number;
	readonly first_node_id: string;
	readonly created_at: string;
}

interface CharacterVisualProfileRow {
	readonly story_id: string;
	readonly character: string;
	readonly profile: string;
	readonly source: string;
	readonly created_at: string;
	readonly updated_at: string;
}

interface EntityRow {
	readonly id: string;
	readonly story_id: string;
	readonly kind: string;
	readonly name: string;
	readonly description: string;
	readonly source: string;
	readonly created_at: string;
}

interface EntityAliasRow {
	readonly alias: string;
}

export interface ListEntitiesOptions {
	readonly kind?: EntityKind;
}

export interface ResolveEntitiesOptions {
	readonly storyId?: string;
}

interface NormalisedAlias {
	readonly alias: string;
	readonly normalized: string;
}

function normaliseAliases(aliases: readonly string[]): NormalisedAlias[] {
	if (!Array.isArray(aliases)) {
		throw new Error("实体别名必须是数组");
	}
	const seen = new Set<string>();
	const result: NormalisedAlias[] = [];
	for (const alias of aliases) {
		assertNonEmptyString(alias, "实体别名");
		const normalized = normalizeEntityName(alias);
		if (normalized.length === 0) {
			throw new Error(`实体别名去掉标点与空白后为空：${alias}`);
		}
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		result.push({ alias, normalized });
	}
	return result;
}

function rowToCharacterVisualProfile(
	row: CharacterVisualProfileRow,
): CharacterVisualProfileRecord {
	if (!isVisualProfileSource(row.source)) {
		throw new Error(
			`故事 ${row.story_id} 的视觉档案 ${row.character} 来源不合法：${row.source}`,
		);
	}
	const profile = assertCharacterVisualProfile(
		JSON.parse(row.profile) as unknown,
		`故事 ${row.story_id} 的视觉档案 ${row.character}`,
	);
	if (profile.character !== row.character) {
		throw new Error(
			`故事 ${row.story_id} 的视觉档案人物 ${row.character} 与内容 ${profile.character} 不一致`,
		);
	}
	return {
		storyId: row.story_id,
		character: row.character,
		profile,
		source: row.source,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToEntityCandidate(row: EntityCandidateRow): EntityCandidate {
	if (!isEntityKind(row.kind)) {
		throw new Error(
			`实体候选 ${row.normalized_name} 的类别不合法：${row.kind}`,
		);
	}
	return {
		storyId: row.story_id,
		normalizedName: row.normalized_name,
		kind: row.kind,
		hits: row.hits,
		firstNodeId: row.first_node_id,
		createdAt: row.created_at,
	};
}

export class EntitiesRepo extends StoreRepo {
	/**
	 * 按规范化名称合并：同一故事里的同名实体只有一行，重复导入只补别名。
	 * 名称本身总是登记为别名，因此 resolveEntities 也能按名称命中。
	 */
	upsertEntity(input: NewEntityInput): Entity {
		assertNonEmptyString(input.storyId, "故事 id");
		if (!isEntityKind(input.kind)) {
			throw new Error(`实体类型不合法：${String(input.kind)}`);
		}
		assertNonEmptyString(input.name, "实体名称");
		assertNonEmptyString(input.source, "实体来源");
		const description = input.description ?? "";
		if (typeof description !== "string") {
			throw new Error("实体描述必须是字符串");
		}
		const normalizedName = normalizeEntityName(input.name);
		if (normalizedName.length === 0) {
			throw new Error(`实体名称去掉标点与空白后为空：${input.name}`);
		}
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (input.id !== undefined) {
			assertNonEmptyString(input.id, "实体 id");
		}
		const aliases = normaliseAliases(input.aliases ?? []);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "实体的创建时间");
		const existing = this.db
			.prepare(
				`SELECT id, story_id, kind, name, description, source, created_at
				FROM entities WHERE story_id = ? AND normalized_name = ?`,
			)
			.get(input.storyId, normalizedName) as EntityRow | undefined;
		const insertAlias = this.db.prepare(
			`INSERT INTO entity_aliases (entity_id, story_id, alias, normalized_alias)
			VALUES (?, ?, ?, ?)
			ON CONFLICT (entity_id, normalized_alias) DO NOTHING`,
		);
		return this.db.transaction((): Entity => {
			if (existing) {
				for (const alias of aliases) {
					insertAlias.run(
						existing.id,
						input.storyId,
						alias.alias,
						alias.normalized,
					);
				}
				const merged = this.getEntity(existing.id);
				if (!merged) {
					throw new Error(`实体读取失败：${existing.id}`);
				}
				return merged;
			}
			const id = input.id ?? randomUUID();
			if (this.getEntity(id)) {
				throw new Error(`实体已存在：${id}`);
			}
			this.db
				.prepare(
					`INSERT INTO entities
						(id, story_id, kind, name, normalized_name, description, source, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					id,
					input.storyId,
					input.kind,
					input.name,
					normalizedName,
					description,
					input.source,
					createdAt,
				);
			insertAlias.run(id, input.storyId, input.name, normalizedName);
			for (const alias of aliases) {
				insertAlias.run(id, input.storyId, alias.alias, alias.normalized);
			}
			const entity = this.getEntity(id);
			if (!entity) {
				throw new Error(`实体写入后读取失败：${id}`);
			}
			return entity;
		})();
	}

	getEntity(id: string): Entity | null {
		const row = this.db
			.prepare(
				`SELECT id, story_id, kind, name, description, source, created_at
				FROM entities WHERE id = ?`,
			)
			.get(id) as EntityRow | undefined;
		return row ? this.#rowToEntity(row) : null;
	}

	findEntityByName(storyId: string, name: string): Entity | null {
		assertNonEmptyString(storyId, "故事 id");
		assertNonEmptyString(name, "实体名称");
		const normalized = normalizeEntityName(name);
		if (normalized.length === 0) return null;
		const row = this.db
			.prepare(
				`SELECT id, story_id, kind, name, description, source, created_at
				FROM entities WHERE story_id = ? AND normalized_name = ?`,
			)
			.get(storyId, normalized) as EntityRow | undefined;
		return row ? this.#rowToEntity(row) : null;
	}

	listEntities(storyId: string, options: ListEntitiesOptions = {}): Entity[] {
		assertNonEmptyString(storyId, "故事 id");
		if (options.kind !== undefined && !isEntityKind(options.kind)) {
			throw new Error(`实体类型不合法：${String(options.kind)}`);
		}
		const rows = this.db
			.prepare(
				`SELECT id, story_id, kind, name, description, source, created_at
				FROM entities
				WHERE story_id = @storyId AND (@kind IS NULL OR kind = @kind)
				ORDER BY row_id ASC`,
			)
			.all({ storyId, kind: options.kind ?? null }) as EntityRow[];
		return rows.map((row) => this.#rowToEntity(row));
	}

	/**
	 * 按规范化后的别名返回全部命中的实体。不同实体可以共用同一个别名
	 * （例如角色名同时作为某个世界书词条的主关键词），调用方拿到全部候选。
	 */
	resolveEntities(
		alias: string,
		options: ResolveEntitiesOptions = {},
	): Entity[] {
		assertNonEmptyString(alias, "实体别名");
		const normalized = normalizeEntityName(alias);
		if (normalized.length === 0) {
			throw new Error(`实体别名去掉标点与空白后为空：${alias}`);
		}
		if (options.storyId !== undefined) {
			assertNonEmptyString(options.storyId, "故事 id");
			if (!this.store.getStory(options.storyId)) {
				throw new Error(`故事不存在：${options.storyId}`);
			}
		}
		const rows = this.db
			.prepare(
				`SELECT e.id, e.story_id, e.kind, e.name, e.description, e.source, e.created_at
				FROM entities AS e
				JOIN entity_aliases AS a ON a.entity_id = e.id
				WHERE a.normalized_alias = @normalized
					AND (@storyId IS NULL OR e.story_id = @storyId)
				ORDER BY e.row_id ASC`,
			)
			.all({
				normalized,
				storyId: options.storyId ?? null,
			}) as EntityRow[];
		return rows.map((row) => this.#rowToEntity(row));
	}

	addEntityAlias(entityId: string, alias: string): Entity {
		assertNonEmptyString(entityId, "实体 id");
		const entity = this.getEntity(entityId);
		if (!entity) {
			throw new Error(`实体不存在：${entityId}`);
		}
		assertNonEmptyString(alias, "实体别名");
		const normalized = normalizeEntityName(alias);
		if (normalized.length === 0) {
			throw new Error(`实体别名去掉标点与空白后为空：${alias}`);
		}
		this.db
			.prepare(
				`INSERT INTO entity_aliases (entity_id, story_id, alias, normalized_alias)
				VALUES (?, ?, ?, ?)
				ON CONFLICT (entity_id, normalized_alias) DO NOTHING`,
			)
			.run(entity.id, entity.storyId, alias, normalized);
		const updated = this.getEntity(entity.id);
		if (!updated) {
			throw new Error(`实体读取失败：${entity.id}`);
		}
		return updated;
	}

	#rowToEntity(row: EntityRow): Entity {
		if (!isEntityKind(row.kind)) {
			throw new Error(`实体 ${row.id} 的类型不合法：${row.kind}`);
		}
		const aliases = this.db
			.prepare(
				"SELECT alias FROM entity_aliases WHERE entity_id = ? ORDER BY rowid ASC",
			)
			.all(row.id) as EntityAliasRow[];
		return {
			id: row.id,
			storyId: row.story_id,
			kind: row.kind,
			name: row.name,
			description: row.description,
			source: row.source,
			createdAt: row.created_at,
			aliases: aliases.map((alias) => alias.alias),
		};
	}

	/** 列出故事的视觉档案，按写入顺序。 */
	listCharacterVisualProfiles(storyId: string): CharacterVisualProfileRecord[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				"SELECT * FROM character_visual_profiles WHERE story_id = ? ORDER BY rowid ASC",
			)
			.all(storyId) as CharacterVisualProfileRow[];
		return rows.map(rowToCharacterVisualProfile);
	}

	/** 读取一个故事里某个人的视觉档案；没有时返回 null。 */
	getCharacterVisualProfile(
		storyId: string,
		character: string,
	): CharacterVisualProfileRecord | null {
		assertNonEmptyString(storyId, "故事 id");
		assertNonEmptyString(character, "视觉档案的人物名");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const row = this.db
			.prepare(
				"SELECT * FROM character_visual_profiles WHERE story_id = ? AND character = ?",
			)
			.get(storyId, character.trim()) as CharacterVisualProfileRow | undefined;
		return row === undefined ? null : rowToCharacterVisualProfile(row);
	}

	/**
	 * 保存一批视觉档案；同一个故事里的同一人物覆盖原行，不新增。
	 * 创建时间只在首次写入时确定，更新时间每次刷新。
	 */
	saveCharacterVisualProfiles(
		input: SaveCharacterVisualProfilesInput,
	): CharacterVisualProfileRecord[] {
		assertNonEmptyString(input.storyId, "视觉档案的故事 id");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!isVisualProfileSource(input.source)) {
			throw new Error(`视觉档案的来源不合法：${String(input.source)}`);
		}
		if (!Array.isArray(input.profiles) || input.profiles.length === 0) {
			throw new Error("视觉档案至少需要一条");
		}
		const profiles = input.profiles.map((profile, index) =>
			assertCharacterVisualProfile(profile, `视觉档案[${index}]`),
		);
		assertUniqueVisualProfiles(profiles);
		const createdAt = input.createdAt ?? new Date().toISOString();
		const updatedAt = input.updatedAt ?? createdAt;
		assertNonEmptyString(createdAt, "视觉档案的创建时间");
		assertNonEmptyString(updatedAt, "视觉档案的更新时间");
		const upsert = this.db.prepare(
			`INSERT INTO character_visual_profiles
				(story_id, character, profile, source, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (story_id, character) DO UPDATE SET
				profile = excluded.profile,
				source = excluded.source,
				updated_at = excluded.updated_at`,
		);
		this.db.transaction(() => {
			for (const profile of profiles) {
				upsert.run(
					input.storyId,
					profile.character,
					serializeJsonValue(profile, `视觉档案 ${profile.character}`),
					input.source,
					createdAt,
					updatedAt,
				);
			}
		})();
		return profiles.map((profile) => {
			const saved = this.getCharacterVisualProfile(
				input.storyId,
				profile.character,
			);
			if (saved === null) {
				throw new Error(`视觉档案写入后读取失败：${profile.character}`);
			}
			return saved;
		});
	}

	/**
	 * 记录一次未知实体名称的出现；同一故事、同一规范化名称与类别只累加
	 * 命中次数，首个楼层保持第一次出现的位置。
	 */
	upsertEntityCandidate(input: NewEntityCandidateInput): EntityCandidate {
		assertNonEmptyString(input.storyId, "实体候选的故事 id");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!isEntityKind(input.kind)) {
			throw new Error(`实体候选的 kind 不合法：${String(input.kind)}`);
		}
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`实体候选的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const normalizedName = normalizeEntityName(input.name);
		if (normalizedName.length === 0) {
			throw new Error(`实体名称去掉标点与空白后为空：${input.name}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "实体候选的创建时间");
		this.db
			.prepare(
				`INSERT INTO entity_candidates
					(story_id, normalized_name, kind, hits, first_node_id, created_at)
				VALUES (?, ?, ?, 1, ?, ?)
				ON CONFLICT (story_id, normalized_name, kind)
				DO UPDATE SET hits = hits + 1`,
			)
			.run(input.storyId, normalizedName, input.kind, input.nodeId, createdAt);
		const row = this.db
			.prepare(
				`SELECT * FROM entity_candidates
				WHERE story_id = ? AND normalized_name = ? AND kind = ?`,
			)
			.get(input.storyId, normalizedName, input.kind) as
			| EntityCandidateRow
			| undefined;
		if (row === undefined) {
			throw new Error(`实体候选写入后读取失败：${normalizedName}`);
		}
		return rowToEntityCandidate(row);
	}

	/** 列出故事里还没有建档的实体名称，按规范化名称与类别排序。 */
	listEntityCandidates(storyId: string): EntityCandidate[] {
		assertNonEmptyString(storyId, "实体候选的故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT * FROM entity_candidates
				WHERE story_id = ?
				ORDER BY normalized_name ASC, kind ASC`,
			)
			.all(storyId) as EntityCandidateRow[];
		return rows.map(rowToEntityCandidate);
	}
}
