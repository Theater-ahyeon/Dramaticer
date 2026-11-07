import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type {
	BackgroundJob,
	BackgroundJobStatus,
} from "../background/types.js";
import {
	type Entity,
	type EntityKind,
	type NewEntityInput,
	isEntityKind,
	normalizeEntityName,
} from "../entity.js";
import { isJsonObject } from "../json.js";
import {
	DEFAULT_MEMORY_EVENT_LIMIT,
	type GetEventsForPathOptions,
	MAX_MEMORY_EVENT_LIMIT,
	type MemoryEvent,
	type NewMemoryEventInput,
} from "../memory/event.js";
import { applyStateDiffsTo } from "../state.js";
import type {
	NewStateDiff,
	NodeTextMatch,
	StateDiff,
	StateDiffOp,
	StateSnapshot,
	Story,
	TimelineNode,
	TimelineRole,
} from "../timeline.js";
import type { TurnTrace } from "../trace.js";
import { serializeJsonValue } from "./json-value.js";
import { applyMigrations } from "./migrations.js";

interface StoryRow {
	readonly id: string;
	readonly title: string;
	readonly created_at: string;
}

interface NodeRow {
	readonly id: string;
	readonly story_id: string;
	readonly parent_id: string | null;
	readonly role: string;
	readonly raw: string;
	readonly created_at: string;
}

interface StateDiffRow {
	readonly id: number;
	readonly story_id: string;
	readonly node_id: string;
	readonly ordinal: number;
	readonly path: string;
	readonly op: string;
	readonly value: string | null;
	readonly reason: string | null;
	readonly source: string;
	readonly created_at: string;
}

interface NodeTextRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly score: number;
	readonly snippet: string;
}

interface TraceRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly trace: string;
}

interface StateSnapshotRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly state: string;
	readonly computed_at: string;
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

interface BackgroundJobRow {
	readonly id: number;
	readonly story_id: string;
	readonly node_id: string;
	readonly kind: string;
	readonly status: string;
	readonly attempts: number;
	readonly last_error: string | null;
	readonly created_at: string;
	readonly started_at: string | null;
	readonly finished_at: string | null;
}

interface MemoryEventRow {
	readonly id: string;
	readonly story_id: string;
	readonly source_node_id: string;
	readonly ordinal: number;
	readonly story_time: string | null;
	readonly location: string | null;
	readonly participants: string;
	readonly importance: number;
	readonly knowers: string;
	readonly text: string;
	readonly created_at: string;
}

interface NormalisedMemoryEvent {
	readonly id: string;
	readonly storyId: string;
	readonly sourceNodeId: string;
	readonly ordinal: number;
	readonly storyTime: string | null;
	readonly location: string | null;
	readonly participants: readonly string[];
	readonly importance: number;
	readonly knowers: readonly string[];
	readonly text: string;
	readonly createdAt: string;
}

export interface CreateStoryInput {
	readonly id?: string;
	readonly title: string;
	readonly createdAt?: string;
}

export interface AppendNodeInput {
	readonly id?: string;
	readonly storyId: string;
	readonly parentId: string | null;
	readonly role: TimelineRole;
	readonly raw: string;
	readonly createdAt?: string;
}

export interface SearchNodeTextOptions {
	readonly storyId?: string;
	readonly limit?: number;
}

export interface ListEntitiesOptions {
	readonly kind?: EntityKind;
}

export interface ResolveEntitiesOptions {
	readonly storyId?: string;
}

export interface EnqueueBackgroundJobsInput {
	readonly storyId: string;
	readonly kinds: readonly string[];
	readonly createdAt?: string;
}

export interface ListBackgroundJobsOptions {
	readonly storyId?: string;
	readonly status?: BackgroundJobStatus;
	readonly kinds?: readonly string[];
	readonly limit?: number;
}

export interface FailBackgroundJobInput {
	readonly error: string;
	readonly maxAttempts: number;
	readonly finishedAt?: string;
}

interface NormalisedStateDiff {
	readonly storyId: string;
	readonly nodeId: string;
	readonly path: readonly string[];
	readonly op: StateDiffOp;
	readonly valueJson: string | null;
	readonly reason: string | null;
	readonly source: string;
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

const DEFAULTS = {
	searchLimit: 20,
	maxSearchLimit: 1000,
	minQueryLength: 3,
} as const;

function assertNonEmptyString(
	value: unknown,
	label: string,
): asserts value is string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
}

function optionalTrimmedString(value: unknown, label: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串或 null`);
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new Error(`${label} 不能是空字符串`);
	}
	return trimmed;
}

function normaliseNameArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是字符串数组`);
	}
	return value.map((item, index) => {
		if (typeof item !== "string") {
			throw new Error(`${label}[${index}] 必须是字符串`);
		}
		const trimmed = item.trim();
		if (trimmed.length === 0) {
			throw new Error(`${label}[${index}] 不能是空字符串`);
		}
		return trimmed;
	});
}

function isTimelineRole(value: unknown): value is TimelineRole {
	return value === "system" || value === "user" || value === "assistant";
}

function rowToStory(row: StoryRow): Story {
	return {
		id: row.id,
		title: row.title,
		createdAt: row.created_at,
	};
}

function rowToNode(row: NodeRow): TimelineNode {
	return {
		id: row.id,
		storyId: row.story_id,
		parentId: row.parent_id,
		role: row.role as TimelineRole,
		raw: row.raw,
		createdAt: row.created_at,
	};
}

function assertStateDiffPath(
	value: unknown,
	label: string,
): asserts value is string[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.some((segment) => typeof segment !== "string" || segment.length === 0)
	) {
		throw new Error(`${label} 的 path 必须是非空字符串组成的非空数组`);
	}
}

function rowToStateDiff(row: StateDiffRow): StateDiff {
	const path: unknown = JSON.parse(row.path);
	assertStateDiffPath(path, `状态 diff ${row.id}`);
	return {
		id: row.id,
		storyId: row.story_id,
		nodeId: row.node_id,
		ordinal: row.ordinal,
		path,
		op: row.op as StateDiffOp,
		value: row.value === null ? null : JSON.parse(row.value),
		reason: row.reason,
		source: row.source,
		createdAt: row.created_at,
	};
}

function rowToStateSnapshot(row: StateSnapshotRow): StateSnapshot {
	const parsed: unknown = JSON.parse(row.state);
	if (!isJsonObject(parsed)) {
		throw new Error(`楼层 ${row.node_id} 的状态快照不是 JSON 对象`);
	}
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		state: parsed,
		computedAt: row.computed_at,
	};
}

function isBackgroundJobStatus(value: unknown): value is BackgroundJobStatus {
	return (
		value === "pending" ||
		value === "running" ||
		value === "done" ||
		value === "failed"
	);
}

function assertBackgroundJobId(value: unknown): asserts value is number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`后台任务 id 必须是正整数：${String(value)}`);
	}
}

function rowToBackgroundJob(row: BackgroundJobRow): BackgroundJob {
	if (!isBackgroundJobStatus(row.status)) {
		throw new Error(`后台任务 ${row.id} 的状态不合法：${row.status}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		nodeId: row.node_id,
		kind: row.kind,
		status: row.status,
		attempts: row.attempts,
		lastError: row.last_error,
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

function rowToMemoryEvent(row: MemoryEventRow): MemoryEvent {
	return {
		id: row.id,
		storyId: row.story_id,
		sourceNodeId: row.source_node_id,
		ordinal: row.ordinal,
		storyTime: row.story_time,
		location: row.location,
		participants: parseStoredNameArray(
			row.participants,
			`事件 ${row.id} 的参与者`,
		),
		importance: row.importance,
		knowers: parseStoredNameArray(row.knowers, `事件 ${row.id} 的知情者`),
		text: row.text,
		createdAt: row.created_at,
	};
}

function parseStoredNameArray(value: string, label: string): string[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) {
		throw new Error(`${label}不是字符串数组`);
	}
	return parsed.map((item) => {
		if (typeof item !== "string" || item.length === 0) {
			throw new Error(`${label}不是字符串数组`);
		}
		return item;
	});
}

export class StoryStore {
	readonly #db: Database.Database;

	private constructor(db: Database.Database) {
		this.#db = db;
	}

	static open(path: string): StoryStore {
		assertNonEmptyString(path, "数据库路径");
		const db = new Database(path);
		db.pragma("foreign_keys = ON");
		try {
			applyMigrations(db);
		} catch (error) {
			db.close();
			throw error;
		}
		return new StoryStore(db);
	}

	close(): void {
		this.#db.close();
	}

	getSchemaVersion(): number {
		return this.#db.pragma("user_version", { simple: true }) as number;
	}

	/**
	 * 在单个事务里执行回调。回调可以跨越异步边界（例如流式读取文件），
	 * 失败时回滚并原样抛出错误；事务未提交前其他调用方看不到写入。
	 */
	async runInTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			const result = await fn();
			this.#db.exec("COMMIT");
			return result;
		} catch (error) {
			if (this.#db.inTransaction) this.#db.exec("ROLLBACK");
			throw error;
		}
	}

	createStory(input: CreateStoryInput): Story {
		assertNonEmptyString(input.title, "故事标题");
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "故事 id");
		const createdAt = input.createdAt ?? new Date().toISOString();
		if (this.getStory(id)) {
			throw new Error(`故事已存在：${id}`);
		}
		this.#db
			.prepare("INSERT INTO stories (id, title, created_at) VALUES (?, ?, ?)")
			.run(id, input.title, createdAt);
		const story = this.getStory(id);
		if (!story) {
			throw new Error(`故事写入后读取失败：${id}`);
		}
		return story;
	}

	getStory(id: string): Story | null {
		const row = this.#db
			.prepare("SELECT id, title, created_at FROM stories WHERE id = ?")
			.get(id) as StoryRow | undefined;
		return row ? rowToStory(row) : null;
	}

	listStories(): Story[] {
		const rows = this.#db
			.prepare("SELECT id, title, created_at FROM stories ORDER BY rowid ASC")
			.all() as StoryRow[];
		return rows.map(rowToStory);
	}

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
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (input.id !== undefined) {
			assertNonEmptyString(input.id, "实体 id");
		}
		const aliases = normaliseAliases(input.aliases ?? []);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "实体的创建时间");
		const existing = this.#db
			.prepare(
				`SELECT id, story_id, kind, name, description, source, created_at
				FROM entities WHERE story_id = ? AND normalized_name = ?`,
			)
			.get(input.storyId, normalizedName) as EntityRow | undefined;
		const insertAlias = this.#db.prepare(
			`INSERT INTO entity_aliases (entity_id, story_id, alias, normalized_alias)
			VALUES (?, ?, ?, ?)
			ON CONFLICT (entity_id, normalized_alias) DO NOTHING`,
		);
		return this.#db.transaction((): Entity => {
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
			this.#db
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
		const row = this.#db
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
		const row = this.#db
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
		const rows = this.#db
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
			if (!this.getStory(options.storyId)) {
				throw new Error(`故事不存在：${options.storyId}`);
			}
		}
		const rows = this.#db
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
		this.#db
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
		const aliases = this.#db
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

	appendNode(input: AppendNodeInput): TimelineNode {
		assertNonEmptyString(input.storyId, "故事 id");
		if (!isTimelineRole(input.role)) {
			throw new Error(`楼层角色不合法：${String(input.role)}`);
		}
		if (typeof input.raw !== "string") {
			throw new Error("楼层原文必须是字符串");
		}
		if (input.parentId !== null) {
			assertNonEmptyString(input.parentId, "父节点 id");
		}
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (input.parentId !== null) {
			const parent = this.getNode(input.parentId);
			if (!parent) {
				throw new Error(`父节点不存在：${input.parentId}`);
			}
			if (parent.storyId !== input.storyId) {
				throw new Error(
					`父节点 ${input.parentId} 属于另一个故事 ${parent.storyId}`,
				);
			}
		}
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "楼层 id");
		if (this.getNode(id)) {
			throw new Error(`楼层节点已存在：${id}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		const insertNode = this.#db.prepare(
			`INSERT INTO nodes (id, story_id, parent_id, role, raw, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`,
		);
		const moveHead = this.#db.prepare(
			"UPDATE stories SET head_node_id = ? WHERE id = ?",
		);
		return this.#db.transaction((): TimelineNode => {
			insertNode.run(
				id,
				input.storyId,
				input.parentId,
				input.role,
				input.raw,
				createdAt,
			);
			moveHead.run(id, input.storyId);
			const node = this.getNode(id);
			if (!node) {
				throw new Error(`楼层节点写入后读取失败：${id}`);
			}
			return node;
		})();
	}

	getNode(id: string): TimelineNode | null {
		const row = this.#db
			.prepare(
				"SELECT id, story_id, parent_id, role, raw, created_at FROM nodes WHERE id = ?",
			)
			.get(id) as NodeRow | undefined;
		return row ? rowToNode(row) : null;
	}

	/** 返回从根到指定节点的完整路径，顺序为根在前。 */
	getPathToNode(nodeId: string): TimelineNode[] {
		const start = this.getNode(nodeId);
		if (!start) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const path: TimelineNode[] = [start];
		let current = start;
		while (current.parentId !== null) {
			const parent = this.getNode(current.parentId);
			if (!parent) {
				throw new Error(`楼层树断裂：${current.id} 的父节点缺失`);
			}
			path.push(parent);
			current = parent;
		}
		return path.reverse();
	}

	/** 返回故事的当前分支指针；故事还没有楼层时返回 null。 */
	getHead(storyId: string): TimelineNode | null {
		assertNonEmptyString(storyId, "故事 id");
		const row = this.#db
			.prepare("SELECT head_node_id FROM stories WHERE id = ?")
			.get(storyId) as { readonly head_node_id: string | null } | undefined;
		if (row === undefined) {
			throw new Error(`故事不存在：${storyId}`);
		}
		if (row.head_node_id === null) return null;
		const node = this.getNode(row.head_node_id);
		if (!node) {
			throw new Error(
				`楼层树断裂：故事 ${storyId} 的 head 节点 ${row.head_node_id} 缺失`,
			);
		}
		return node;
	}

	/** 把 head 指向指定楼层，用于切换分支。 */
	setHead(storyId: string, nodeId: string): TimelineNode {
		assertNonEmptyString(storyId, "故事 id");
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const node = this.getNode(nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		if (node.storyId !== storyId) {
			throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
		}
		this.#db
			.prepare("UPDATE stories SET head_node_id = ? WHERE id = ?")
			.run(nodeId, storyId);
		return node;
	}

	/** 返回从根到当前 head 的路径；没有 head 时返回空数组。 */
	getPathToHead(storyId: string): TimelineNode[] {
		const head = this.getHead(storyId);
		return head === null ? [] : this.getPathToNode(head.id);
	}

	/** 以某个楼层为参照重新生成一条回复：新建兄弟节点，旧节点保留。 */
	swipeNode(nodeId: string, raw: string): TimelineNode {
		return this.#appendSibling(nodeId, raw);
	}

	/** 编辑某条回复：旧节点保留为兄弟节点，编辑后的内容写入新节点。 */
	editNode(nodeId: string, raw: string): TimelineNode {
		return this.#appendSibling(nodeId, raw);
	}

	/** 用户基于某个节点继续发言时，该节点即被确认；有子节点就是已确认。 */
	isNodeConfirmed(nodeId: string): boolean {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare("SELECT 1 AS present FROM nodes WHERE parent_id = ? LIMIT 1")
			.get(nodeId) as { readonly present: number } | undefined;
		return row !== undefined;
	}

	#appendSibling(nodeId: string, raw: string): TimelineNode {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (typeof raw !== "string" || raw.length === 0) {
			throw new Error("新建楼层的原文必须是非空字符串");
		}
		const original = this.getNode(nodeId);
		if (!original) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		return this.appendNode({
			storyId: original.storyId,
			parentId: original.parentId,
			role: original.role,
			raw,
		});
	}

	appendStateDiff(input: NewStateDiff): StateDiff {
		const [stored] = this.appendStateDiffs([input]);
		if (!stored) {
			throw new Error("状态 diff 写入失败");
		}
		return stored;
	}

	appendStateDiffs(inputs: readonly NewStateDiff[]): StateDiff[] {
		if (!Array.isArray(inputs)) {
			throw new Error("状态 diff 必须是数组");
		}
		if (inputs.length === 0) {
			return [];
		}
		const normalised = inputs.map((input, index) =>
			this.#normaliseStateDiff(input, index),
		);
		const createdAt = new Date().toISOString();
		const insert = this.#db.prepare(
			`INSERT INTO state_diffs (story_id, node_id, ordinal, path, op, value, reason, source, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const nextOrdinal = this.#db.prepare(
			"SELECT COALESCE(MAX(ordinal), -1) + 1 AS next_ordinal FROM state_diffs WHERE node_id = ?",
		);
		// 写入新的 diff 后，该楼层及其全部后代的快照都已过期。
		const invalidateSnapshots = this.#db.prepare(
			`WITH RECURSIVE affected(node_id) AS (
				SELECT id FROM nodes WHERE id = ?
				UNION ALL
				SELECT nodes.id FROM nodes JOIN affected ON nodes.parent_id = affected.node_id
			)
			DELETE FROM state_snapshots WHERE node_id IN (SELECT node_id FROM affected)`,
		);
		const run = this.#db.transaction(
			(diffs: readonly NormalisedStateDiff[]): StateDiff[] => {
				const ordinals = new Map<string, number>();
				const stored: StateDiff[] = [];
				for (const diff of diffs) {
					let ordinal = ordinals.get(diff.nodeId);
					if (ordinal === undefined) {
						const row = nextOrdinal.get(diff.nodeId) as {
							next_ordinal: number;
						};
						ordinal = row.next_ordinal;
					}
					const info = insert.run(
						diff.storyId,
						diff.nodeId,
						ordinal,
						JSON.stringify(diff.path),
						diff.op,
						diff.valueJson,
						diff.reason,
						diff.source,
						createdAt,
					);
					ordinals.set(diff.nodeId, ordinal + 1);
					stored.push({
						id: Number(info.lastInsertRowid),
						storyId: diff.storyId,
						nodeId: diff.nodeId,
						ordinal,
						path: diff.path,
						op: diff.op,
						value: diff.valueJson === null ? null : JSON.parse(diff.valueJson),
						reason: diff.reason,
						source: diff.source,
						createdAt,
					});
				}
				for (const nodeId of new Set(diffs.map((diff) => diff.nodeId))) {
					invalidateSnapshots.run(nodeId);
				}
				return stored;
			},
		);
		return run(normalised);
	}

	/** 读取某个楼层节点产生的状态 diff，按写入顺序排列。 */
	getStateDiffs(nodeId: string): StateDiff[] {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.#db
			.prepare(
				"SELECT * FROM state_diffs WHERE node_id = ? ORDER BY ordinal ASC",
			)
			.all(nodeId) as StateDiffRow[];
		return rows.map(rowToStateDiff);
	}

	/** 按路径顺序（根在前）累加所需的全部状态 diff。 */
	getStateDiffsAlongPath(nodeId: string): StateDiff[] {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.#db
			.prepare(
				`WITH RECURSIVE chain(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, chain.depth + 1
					FROM nodes JOIN chain ON nodes.id = chain.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT state_diffs.*
				FROM state_diffs JOIN chain ON state_diffs.node_id = chain.node_id
				ORDER BY chain.depth DESC, state_diffs.ordinal ASC`,
			)
			.all(nodeId) as StateDiffRow[];
		return rows.map(rowToStateDiff);
	}

	/** 统计路径上的 diff 条数，不读取 diff 内容。 */
	countStateDiffsAlongPath(nodeId: string): number {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare(
				`WITH RECURSIVE chain(node_id) AS (
					SELECT id FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id
					FROM nodes JOIN chain ON nodes.id = chain.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT COUNT(*) AS count
				FROM state_diffs JOIN chain ON state_diffs.node_id = chain.node_id`,
			)
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	/**
	 * 读取某个楼层末端的累计状态。缓存未命中时从父楼层的快照叠加
	 * 本楼层的 diff 计算，并把结果写入缓存；从根节点开始的路径只计算一次。
	 */
	getStateSnapshot(nodeId: string): StateSnapshot {
		const node = this.getNode(nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const cached = this.#db
			.prepare(
				`SELECT node_id, story_id, state, computed_at
				FROM state_snapshots WHERE node_id = ?`,
			)
			.get(nodeId) as StateSnapshotRow | undefined;
		if (cached !== undefined) {
			const snapshot = rowToStateSnapshot(cached);
			if (snapshot.storyId !== node.storyId) {
				throw new Error(
					`楼层 ${nodeId} 的状态快照与楼层所属故事不一致：${snapshot.storyId}`,
				);
			}
			return snapshot;
		}
		const baseState =
			node.parentId === null ? {} : this.getStateSnapshot(node.parentId).state;
		const state = applyStateDiffsTo(baseState, this.getStateDiffs(nodeId));
		const computedAt = new Date().toISOString();
		this.#db
			.prepare(
				`INSERT INTO state_snapshots (node_id, story_id, state, computed_at)
				VALUES (?, ?, ?, ?)`,
			)
			.run(nodeId, node.storyId, JSON.stringify(state), computedAt);
		return {
			nodeId,
			storyId: node.storyId,
			state,
			computedAt,
		};
	}

	/** 读取当前 head 的累计状态；故事还没有楼层时返回 null。 */
	getStateSnapshotAtHead(storyId: string): StateSnapshot | null {
		const head = this.getHead(storyId);
		return head === null ? null : this.getStateSnapshot(head.id);
	}

	/**
	 * 在一个事务里写入某个楼层抽取出的全部事件。任一条非法时整批回滚。
	 */
	insertMemoryEvents(inputs: readonly NewMemoryEventInput[]): MemoryEvent[] {
		if (!Array.isArray(inputs)) {
			throw new Error("事件记忆必须是数组");
		}
		if (inputs.length === 0) return [];
		const normalised = inputs.map((input, index) =>
			this.#normaliseMemoryEvent(input, index),
		);
		const insert = this.#db.prepare(
			`INSERT INTO memory_events
				(id, story_id, source_node_id, ordinal, story_time, location,
				 participants, importance, knowers, text, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const created: MemoryEvent[] = [];
		this.#db.transaction(() => {
			for (const event of normalised) {
				insert.run(
					event.id,
					event.storyId,
					event.sourceNodeId,
					event.ordinal,
					event.storyTime,
					event.location,
					JSON.stringify(event.participants),
					event.importance,
					JSON.stringify(event.knowers),
					event.text,
					event.createdAt,
				);
				created.push({
					id: event.id,
					storyId: event.storyId,
					sourceNodeId: event.sourceNodeId,
					ordinal: event.ordinal,
					storyTime: event.storyTime,
					location: event.location,
					participants: [...event.participants],
					importance: event.importance,
					knowers: [...event.knowers],
					text: event.text,
					createdAt: event.createdAt,
				});
			}
		})();
		return created;
	}

	/** 按路径顺序（根在前、楼层内按 ordinal）读取事件，支持分页。 */
	getEventsForPath(
		nodeId: string,
		options: GetEventsForPathOptions = {},
	): MemoryEvent[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const limit = options.limit ?? DEFAULT_MEMORY_EVENT_LIMIT;
		if (
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > MAX_MEMORY_EVENT_LIMIT
		) {
			throw new Error(
				`事件条数必须是 1 到 ${MAX_MEMORY_EVENT_LIMIT} 之间的整数`,
			);
		}
		const offset = options.offset ?? 0;
		if (!Number.isInteger(offset) || offset < 0) {
			throw new Error("事件分页偏移量必须是不小于 0 的整数");
		}
		const rows = this.#db
			.prepare(
				`WITH RECURSIVE path(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, path.depth + 1
					FROM path JOIN nodes ON nodes.id = path.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT events.*
				FROM memory_events AS events
				JOIN path ON events.source_node_id = path.node_id
				ORDER BY path.depth DESC, events.ordinal ASC
				LIMIT ? OFFSET ?`,
			)
			.all(nodeId, limit, offset) as MemoryEventRow[];
		return rows.map(rowToMemoryEvent);
	}

	/** 统计某个楼层已经抽取的事件数；重复执行前用它判断是否已经处理过。 */
	countEventsForNode(nodeId: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare(
				"SELECT COUNT(*) AS count FROM memory_events WHERE source_node_id = ?",
			)
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	searchNodeText(
		query: string,
		options: SearchNodeTextOptions = {},
	): NodeTextMatch[] {
		if (typeof query !== "string") {
			throw new Error("检索语句必须是字符串");
		}
		const trimmed = query.trim();
		const length = [...trimmed].length;
		if (length < DEFAULTS.minQueryLength) {
			throw new Error(
				`全文检索至少需要 ${DEFAULTS.minQueryLength} 个字符（trigram 分词）`,
			);
		}
		if (trimmed.includes("\u0000")) {
			throw new Error("全文检索语句不能包含空字符");
		}
		const limit = options.limit ?? DEFAULTS.searchLimit;
		if (
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > DEFAULTS.maxSearchLimit
		) {
			throw new Error(
				`检索条数必须是 1 到 ${DEFAULTS.maxSearchLimit} 之间的整数`,
			);
		}
		if (options.storyId !== undefined) {
			assertNonEmptyString(options.storyId, "故事 id");
		}
		const phrase = `"${trimmed.replaceAll('"', '""')}"`;
		const rows = this.#db
			.prepare(
				`SELECT node_id, story_id,
					bm25(node_text) AS score,
					snippet(node_text, 2, '[', ']', '…', 12) AS snippet
				FROM node_text
				WHERE node_text MATCH @query
					AND (@storyId IS NULL OR story_id = @storyId)
				ORDER BY score ASC, rowid ASC
				LIMIT @limit`,
			)
			.all({
				query: phrase,
				storyId: options.storyId ?? null,
				limit,
			}) as NodeTextRow[];
		return rows.map((row) => ({
			nodeId: row.node_id,
			storyId: row.story_id,
			score: row.score,
			snippet: row.snippet,
		}));
	}

	/** 保存一轮生成的 Trace；一个楼层只能写一次。 */
	saveTurnTrace(trace: TurnTrace): void {
		assertNonEmptyString(trace.nodeId, "Trace 的 nodeId");
		assertNonEmptyString(trace.storyId, "Trace 的 storyId");
		assertNonEmptyString(trace.createdAt, "Trace 的 createdAt");
		const node = this.getNode(trace.nodeId);
		if (!node) {
			throw new Error(`Trace 指向的楼层节点不存在：${trace.nodeId}`);
		}
		if (node.storyId !== trace.storyId) {
			throw new Error(
				`Trace 的 storyId 与楼层节点所属故事不一致：${trace.storyId}`,
			);
		}
		if (node.parentId !== trace.parentNodeId) {
			throw new Error(
				`Trace 的 parentNodeId 与楼层节点的父节点不一致：${trace.nodeId}`,
			);
		}
		const existing = this.#db
			.prepare("SELECT node_id FROM traces WHERE node_id = ?")
			.get(trace.nodeId) as { node_id: string } | undefined;
		if (existing) {
			throw new Error(`楼层 ${trace.nodeId} 已经写过 Trace`);
		}
		this.#db
			.prepare(
				`INSERT INTO traces (node_id, story_id, trace, created_at)
				VALUES (?, ?, ?, ?)`,
			)
			.run(trace.nodeId, trace.storyId, JSON.stringify(trace), trace.createdAt);
	}

	getTurnTrace(nodeId: string): TurnTrace | null {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare("SELECT node_id, story_id, trace FROM traces WHERE node_id = ?")
			.get(nodeId) as TraceRow | undefined;
		if (row === undefined) return null;
		const parsed: unknown = JSON.parse(row.trace);
		if (
			!isJsonObject(parsed) ||
			parsed.nodeId !== row.node_id ||
			parsed.storyId !== row.story_id
		) {
			throw new Error(`楼层 ${nodeId} 的 Trace 记录与楼层不一致`);
		}
		return parsed as unknown as TurnTrace;
	}

	/** 为故事里已确认（有子节点）的楼层补建缺失的后台任务。 */
	enqueueMissingBackgroundJobs(
		input: EnqueueBackgroundJobsInput,
	): BackgroundJob[] {
		assertNonEmptyString(input.storyId, "故事 id");
		if (!Array.isArray(input.kinds)) {
			throw new Error("后台任务类型必须是数组");
		}
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const kinds: string[] = [];
		for (const kind of input.kinds) {
			assertNonEmptyString(kind, "后台任务类型");
			if (kind !== kind.trim()) {
				throw new Error(`后台任务类型不能包含首尾空白：${kind}`);
			}
			if (kinds.includes(kind)) {
				throw new Error(`后台任务类型重复：${kind}`);
			}
			kinds.push(kind);
		}
		if (kinds.length === 0) return [];
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "后台任务的创建时间");
		const nodes = this.#db
			.prepare(
				`SELECT id FROM nodes
				WHERE story_id = ?
					AND EXISTS (SELECT 1 FROM nodes AS child WHERE child.parent_id = nodes.id)
				ORDER BY row_id ASC`,
			)
			.all(input.storyId) as { readonly id: string }[];
		const insert = this.#db.prepare(
			`INSERT INTO background_jobs
				(story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at)
			VALUES (?, ?, ?, 'pending', 0, NULL, ?, NULL, NULL)
			ON CONFLICT (node_id, kind) DO NOTHING`,
		);
		const created: BackgroundJob[] = [];
		this.#db.transaction(() => {
			for (const node of nodes) {
				for (const kind of kinds) {
					const info = insert.run(input.storyId, node.id, kind, createdAt);
					if (info.changes !== 1) continue;
					const job = this.getBackgroundJob(Number(info.lastInsertRowid));
					if (!job) {
						throw new Error(
							`后台任务写入后读取失败：${String(info.lastInsertRowid)}`,
						);
					}
					created.push(job);
				}
			}
		})();
		return created;
	}

	getBackgroundJob(id: number): BackgroundJob | null {
		assertBackgroundJobId(id);
		const row = this.#db
			.prepare("SELECT * FROM background_jobs WHERE id = ?")
			.get(id) as BackgroundJobRow | undefined;
		return row ? rowToBackgroundJob(row) : null;
	}

	listBackgroundJobs(options: ListBackgroundJobsOptions = {}): BackgroundJob[] {
		if (options.storyId !== undefined) {
			assertNonEmptyString(options.storyId, "故事 id");
		}
		if (
			options.status !== undefined &&
			!isBackgroundJobStatus(options.status)
		) {
			throw new Error(`后台任务状态不合法：${String(options.status)}`);
		}
		const kinds: string[] = [];
		if (options.kinds !== undefined) {
			if (!Array.isArray(options.kinds)) {
				throw new Error("后台任务类型必须是数组");
			}
			for (const kind of options.kinds) {
				assertNonEmptyString(kind, "后台任务类型");
				if (kinds.includes(kind)) {
					throw new Error(`后台任务类型重复：${kind}`);
				}
				kinds.push(kind);
			}
			if (kinds.length === 0) return [];
		}
		const limit = options.limit ?? -1;
		if (typeof limit !== "number" || !Number.isInteger(limit) || limit === 0) {
			throw new Error("后台任务条数必须是非零整数");
		}
		const params: Record<string, unknown> = {
			storyId: options.storyId ?? null,
			status: options.status ?? null,
			limit,
		};
		let kindClause = "";
		if (kinds.length > 0) {
			const placeholders = kinds.map((kind, index) => {
				params[`kind${index}`] = kind;
				return `@kind${index}`;
			});
			kindClause = ` AND kind IN (${placeholders.join(", ")})`;
		}
		const rows = this.#db
			.prepare(
				`SELECT * FROM background_jobs
				WHERE (@storyId IS NULL OR story_id = @storyId)
					AND (@status IS NULL OR status = @status)${kindClause}
				ORDER BY created_at ASC, id ASC
				LIMIT @limit`,
			)
			.all(params) as BackgroundJobRow[];
		return rows.map(rowToBackgroundJob);
	}

	/** 把 pending 任务标为 running，并累计执行次数。 */
	startBackgroundJob(id: number, startedAt?: string): BackgroundJob {
		const job = this.#requireBackgroundJob(id);
		if (job.status !== "pending") {
			throw new Error(
				`后台任务 ${id} 的状态是 ${job.status}，只有 pending 可以开始执行`,
			);
		}
		const at = startedAt ?? new Date().toISOString();
		assertNonEmptyString(at, "后台任务的开始时间");
		this.#db
			.prepare(
				`UPDATE background_jobs
				SET status = 'running', attempts = attempts + 1, started_at = ?, finished_at = NULL
				WHERE id = ?`,
			)
			.run(at, id);
		return this.#requireBackgroundJob(id);
	}

	/** 把 running 任务标为 done，并清空上一次失败的错误。 */
	finishBackgroundJob(id: number, finishedAt?: string): BackgroundJob {
		const job = this.#requireBackgroundJob(id);
		if (job.status !== "running") {
			throw new Error(
				`后台任务 ${id} 的状态是 ${job.status}，只有 running 可以完成`,
			);
		}
		const at = finishedAt ?? new Date().toISOString();
		assertNonEmptyString(at, "后台任务的完成时间");
		this.#db
			.prepare(
				`UPDATE background_jobs
				SET status = 'done', last_error = NULL, finished_at = ?
				WHERE id = ?`,
			)
			.run(at, id);
		return this.#requireBackgroundJob(id);
	}

	/**
	 * 记录一次失败：执行次数达到上限时标为 failed，否则退回 pending 等待下一轮。
	 */
	failBackgroundJob(id: number, input: FailBackgroundJobInput): BackgroundJob {
		const job = this.#requireBackgroundJob(id);
		if (job.status !== "running") {
			throw new Error(
				`后台任务 ${id} 的状态是 ${job.status}，只有 running 可以记录失败`,
			);
		}
		assertNonEmptyString(input.error, "后台任务的错误信息");
		if (
			typeof input.maxAttempts !== "number" ||
			!Number.isInteger(input.maxAttempts) ||
			input.maxAttempts < 1
		) {
			throw new Error("后台任务的最大执行次数必须是正整数");
		}
		const at = input.finishedAt ?? new Date().toISOString();
		assertNonEmptyString(at, "后台任务的完成时间");
		const exhausted = job.attempts >= input.maxAttempts;
		this.#db
			.prepare(
				`UPDATE background_jobs
				SET status = ?, last_error = ?, started_at = ?, finished_at = ?
				WHERE id = ?`,
			)
			.run(
				exhausted ? "failed" : "pending",
				input.error,
				exhausted ? job.startedAt : null,
				exhausted ? at : null,
				id,
			);
		return this.#requireBackgroundJob(id);
	}

	#requireBackgroundJob(id: number): BackgroundJob {
		const job = this.getBackgroundJob(id);
		if (!job) {
			throw new Error(`后台任务不存在：${id}`);
		}
		return job;
	}

	#normaliseMemoryEvent(
		input: NewMemoryEventInput,
		index: number,
	): NormalisedMemoryEvent {
		const label = `事件记忆[${index}]`;
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error(`${label} 必须是对象`);
		}
		assertNonEmptyString(input.storyId, `${label} 的 storyId`);
		assertNonEmptyString(input.sourceNodeId, `${label} 的 sourceNodeId`);
		const node = this.getNode(input.sourceNodeId);
		if (!node) {
			throw new Error(`${label} 指向的楼层节点不存在：${input.sourceNodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`${label} 的 storyId 与楼层节点所属故事不一致：${input.storyId}`,
			);
		}
		if (
			typeof input.ordinal !== "number" ||
			!Number.isInteger(input.ordinal) ||
			input.ordinal < 0
		) {
			throw new Error(`${label} 的 ordinal 必须是不小于 0 的整数`);
		}
		if (typeof input.text !== "string" || input.text.trim().length === 0) {
			throw new Error(`${label} 的 text 必须是非空字符串`);
		}
		if (
			typeof input.importance !== "number" ||
			!Number.isFinite(input.importance) ||
			input.importance < 0 ||
			input.importance > 1
		) {
			throw new Error(`${label} 的 importance 必须在 0 到 1 之间`);
		}
		const storyTime = optionalTrimmedString(
			input.storyTime,
			`${label} 的 storyTime`,
		);
		const location = optionalTrimmedString(
			input.location,
			`${label} 的 location`,
		);
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, `${label} 的 id`);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, `${label} 的 createdAt`);
		return {
			id,
			storyId: input.storyId,
			sourceNodeId: input.sourceNodeId,
			ordinal: input.ordinal,
			storyTime,
			location,
			participants: normaliseNameArray(
				input.participants,
				`${label} 的 participants`,
			),
			importance: input.importance,
			knowers: normaliseNameArray(input.knowers, `${label} 的 knowers`),
			text: input.text,
			createdAt,
		};
	}

	#normaliseStateDiff(input: NewStateDiff, index: number): NormalisedStateDiff {
		const label = `状态 diff[${index}]`;
		if (input === null || typeof input !== "object") {
			throw new Error(`${label} 必须是对象`);
		}
		assertNonEmptyString(input.storyId, `${label} 的 storyId`);
		assertNonEmptyString(input.nodeId, `${label} 的 nodeId`);
		assertNonEmptyString(input.source, `${label} 的 source`);
		const op = input.op as string;
		if (op !== "set" && op !== "delete") {
			throw new Error(`${label} 的 op 不合法：${op}`);
		}
		assertStateDiffPath(input.path, label);
		const node = this.getNode(input.nodeId);
		if (!node) {
			throw new Error(`${label} 指向的楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`${label} 的 storyId 与楼层节点所属故事不一致：${input.storyId}`,
			);
		}
		const reason = input.reason ?? null;
		if (reason !== null && typeof reason !== "string") {
			throw new Error(`${label} 的 reason 必须是字符串或 null`);
		}
		let valueJson: string | null = null;
		if (input.op === "set") {
			valueJson = serializeJsonValue(input.value, `${label} 的 value`);
		} else if ("value" in input && input.value !== undefined) {
			throw new Error(`${label} 的 op 为 delete 时不能携带 value`);
		}
		return {
			storyId: input.storyId,
			nodeId: input.nodeId,
			path: input.path,
			op,
			valueJson,
			reason,
			source: input.source,
		};
	}
}
