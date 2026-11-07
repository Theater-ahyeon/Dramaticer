import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { isJsonObject } from "../json.js";
import type {
	NewStateDiff,
	NodeTextMatch,
	StateDiff,
	StateDiffOp,
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
