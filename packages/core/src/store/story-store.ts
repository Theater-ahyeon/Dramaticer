import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type {
	NewStateDiff,
	NodeTextMatch,
	StateDiff,
	StateDiffOp,
	Story,
	TimelineNode,
	TimelineRole,
} from "../timeline.js";
import { serializeJsonValue } from "./json-value.js";
import { LATEST_SCHEMA_VERSION, applyMigrations } from "./migrations.js";

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

interface NormalisedStateDiff {
	readonly storyId: string;
	readonly nodeId: string;
	readonly path: readonly string[];
	readonly op: StateDiffOp;
	readonly valueJson: string | null;
	readonly reason: string | null;
	readonly source: string;
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

function rowToStateDiff(row: StateDiffRow): StateDiff {
	return {
		id: row.id,
		storyId: row.story_id,
		nodeId: row.node_id,
		ordinal: row.ordinal,
		path: JSON.parse(row.path) as string[],
		op: row.op as StateDiffOp,
		value: row.value === null ? null : JSON.parse(row.value),
		reason: row.reason,
		source: row.source,
		createdAt: row.created_at,
	};
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

	getLatestSchemaVersion(): number {
		return LATEST_SCHEMA_VERSION;
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
		this.#db
			.prepare(
				`INSERT INTO nodes (id, story_id, parent_id, role, raw, created_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(id, input.storyId, input.parentId, input.role, input.raw, createdAt);
		const node = this.getNode(id);
		if (!node) {
			throw new Error(`楼层节点写入后读取失败：${id}`);
		}
		return node;
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
				return stored;
			},
		);
		return run(normalised);
	}

	/** 读取某个楼层节点产生的状态 diff，按写入顺序排列。 */
	getStateDiffs(nodeId: string): StateDiff[] {
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
		if (
			!Array.isArray(input.path) ||
			input.path.length === 0 ||
			input.path.some(
				(segment) => typeof segment !== "string" || segment.length === 0,
			)
		) {
			throw new Error(`${label} 的 path 必须是非空字符串组成的非空数组`);
		}
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
