// StoryStore 的领域仓储：记忆事件、分块、向量与检索（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import { randomUUID } from "node:crypto";
import {
	DEFAULT_MEMORY_EVENT_LIMIT,
	DEFAULT_MEMORY_EVENT_SOURCE,
	type GetEventsForPathOptions,
	MAX_MEMORY_EVENT_LIMIT,
	type MemoryEvent,
	type NewMemoryEventInput,
} from "../../memory/event.js";
import { buildTrigramQuery } from "../../retrieval/chunk-index.js";
import type { NodeTextMatch } from "../../timeline.js";
import { StoreRepo } from "./base.js";
import {
	assertNonEmptyString,
	optionalTrimmedString,
	parseStoredNameArray,
} from "./shared.js";

interface NodeTextRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly score: number;
	readonly snippet: string;
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
	readonly source: string;
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
	readonly source: string;
	readonly createdAt: string;
}

interface ChunkRow {
	readonly chunk_id: number;
	readonly story_id: string;
	readonly node_id: string;
	readonly parent_ordinal: number | null;
	readonly parent_text: string | null;
	readonly score: number;
}

interface ChunkTextRow {
	readonly chunk_id: number;
	readonly text: string;
}

interface ChunkIdentityRow {
	readonly story_id: string;
	readonly node_id: string;
}

interface ChunkVectorRow {
	readonly chunk_id: number;
	readonly story_id: string;
	readonly node_id: string;
	readonly parent_ordinal: number | null;
	readonly parent_text: string | null;
	readonly distance: number;
}

interface NodeChunkVectorRow {
	readonly chunk_id: number;
	readonly ordinal: number;
	readonly embedding: Buffer;
}

export interface SearchNodeTextOptions {
	readonly storyId?: string;
	readonly limit?: number;
}

export interface SearchChunksOptions {
	readonly storyId: string;
	/** 只搜索该节点祖先路径上的楼层，排除该节点自身与其他分支。 */
	readonly beforeNodeId?: string;
	readonly limit?: number;
}

export interface ChunkSearchMatch {
	readonly storyId: string;
	readonly nodeId: string;
	readonly chunkId: number;
	/** 父段在楼层内的序号；旧分块没有父段。 */
	readonly parentOrdinal: number | null;
	/** 命中后应注入的父段文本；旧分块为 null。 */
	readonly parentText: string | null;
	/** FTS5 的 bm25 原始分数，越小越相关。 */
	readonly score: number;
}

export interface ChunkWithoutVector {
	readonly chunkId: number;
	readonly text: string;
}

export interface ChunkVectorInput {
	readonly chunkId: number;
	readonly embedding: readonly number[];
}

export interface ChunkVectorForNode {
	readonly chunkId: number;
	readonly ordinal: number;
	readonly vector: readonly number[];
}

export interface SearchVectorsOptions {
	readonly storyId: string;
	/** 只搜索该节点祖先路径上的楼层，排除该节点自身与其他分支。 */
	readonly beforeNodeId?: string;
	readonly limit?: number;
}

export interface VectorSearchMatch {
	readonly storyId: string;
	readonly nodeId: string;
	readonly chunkId: number;
	/** 父段在楼层内的序号；旧分块没有父段。 */
	readonly parentOrdinal: number | null;
	/** 命中后应注入的父段文本；旧分块为 null。 */
	readonly parentText: string | null;
	/** 向量的 L2 距离，越小越接近。 */
	readonly distance: number;
}

export interface RecordEventExtractionsInput {
	readonly storyId: string;
	/** 本次窗口内的助手楼层；没有事件的楼层也要传。 */
	readonly nodeIds: readonly string[];
	readonly events: readonly NewMemoryEventInput[];
	readonly createdAt?: string;
}

const DEFAULTS = {
	searchLimit: 20,
	maxSearchLimit: 1000,
	minQueryLength: 3,
} as const;

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

/** vec0 以 float32 小端二进制返回向量。 */
function decodeEmbedding(value: unknown, label: string): number[] {
	if (!Buffer.isBuffer(value)) {
		throw new Error(`${label} 的向量不是二进制数据`);
	}
	if (value.byteLength % 4 !== 0) {
		throw new Error(`${label} 的向量字节数不是 4 的倍数：${value.byteLength}`);
	}
	const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
	const vector = new Array<number>(value.byteLength / 4);
	for (let index = 0; index < vector.length; index += 1) {
		vector[index] = view.getFloat32(index * 4, true);
	}
	return vector;
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
		source: row.source,
		createdAt: row.created_at,
	};
}

export class MemoryRepo extends StoreRepo {
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
		const insert = this.db.prepare(
			`INSERT INTO memory_events
				(id, story_id, source_node_id, ordinal, story_time, location,
				 participants, importance, knowers, text, source, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const created: MemoryEvent[] = [];
		this.db.transaction(() => {
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
					event.source,
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
					source: event.source,
					createdAt: event.createdAt,
				});
			}
		})();
		return created;
	}

	/**
	 * 列出已经抽取过事件的楼层：已经写入事件或存在抽取记录。
	 * 抽取记录包含没有抽到事件的楼层，用来避免重复抽取。
	 */
	listExtractedEventNodeIds(storyId: string): string[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT source_node_id AS id FROM memory_events
				WHERE story_id = ? AND source = ?
				UNION
				SELECT node_id AS id FROM event_extractions WHERE story_id = ?`,
			)
			.all(storyId, DEFAULT_MEMORY_EVENT_SOURCE, storyId) as {
			readonly id: string;
		}[];
		return rows.map((row) => row.id);
	}

	/**
	 * 在一个事务里写入窗口内的全部事件，并把窗口内每个楼层记为已抽取。
	 * 没有事件的楼层同样写入记录，重跑不会再次抽取。
	 */
	recordEventExtractions(input: RecordEventExtractionsInput): void {
		assertNonEmptyString(input.storyId, "故事 id");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!Array.isArray(input.nodeIds) || input.nodeIds.length === 0) {
			throw new Error("事件抽取窗口的楼层不能为空");
		}
		if (!Array.isArray(input.events)) {
			throw new Error("事件记忆必须是数组");
		}
		const nodeIds = input.nodeIds.map((nodeId, index) => {
			assertNonEmptyString(nodeId, `事件抽取窗口[${index}] 的楼层 id`);
			return nodeId;
		});
		const unique = new Set(nodeIds);
		if (unique.size !== nodeIds.length) {
			throw new Error("事件抽取窗口的楼层重复");
		}
		for (const nodeId of nodeIds) {
			const node = this.store.getNode(nodeId);
			if (!node) {
				throw new Error(`事件抽取窗口指向的楼层节点不存在：${nodeId}`);
			}
			if (node.storyId !== input.storyId) {
				throw new Error(
					`事件抽取窗口的 storyId 与楼层节点所属故事不一致：${input.storyId}`,
				);
			}
			if (node.role !== "assistant") {
				throw new Error(`事件抽取窗口只接受助手楼层：${nodeId}`);
			}
		}
		const normalised = input.events.map((event, index) =>
			this.#normaliseMemoryEvent(event, index),
		);
		const counts = new Map<string, number>(nodeIds.map((id) => [id, 0]));
		for (const event of normalised) {
			if (!unique.has(event.sourceNodeId)) {
				throw new Error(`事件 ${event.sourceNodeId} 的来源楼层不在本次窗口内`);
			}
			counts.set(event.sourceNodeId, (counts.get(event.sourceNodeId) ?? 0) + 1);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "事件抽取记录的创建时间");
		const insertEvent = this.db.prepare(
			`INSERT INTO memory_events
				(id, story_id, source_node_id, ordinal, story_time, location,
				 participants, importance, knowers, text, source, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const insertExtraction = this.db.prepare(
			`INSERT INTO event_extractions (node_id, story_id, event_count, created_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT (node_id) DO UPDATE SET event_count = excluded.event_count`,
		);
		this.db.transaction(() => {
			for (const event of normalised) {
				insertEvent.run(
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
					event.source,
					event.createdAt,
				);
			}
			for (const nodeId of nodeIds) {
				insertExtraction.run(
					nodeId,
					input.storyId,
					counts.get(nodeId) ?? 0,
					createdAt,
				);
			}
		})();
	}

	/** 按路径顺序（根在前、楼层内按 ordinal）读取事件，支持分页。 */
	getEventsForPath(
		nodeId: string,
		options: GetEventsForPathOptions = {},
	): MemoryEvent[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.store.getNode(nodeId)) {
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
		const rows = this.db
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

	/** 读取某个楼层产生的全部事件，按 ordinal 排列。 */
	getEventsForNode(nodeId: string): MemoryEvent[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT * FROM memory_events
				WHERE source_node_id = ?
				ORDER BY ordinal ASC`,
			)
			.all(nodeId) as MemoryEventRow[];
		return rows.map(rowToMemoryEvent);
	}

	/** 统计某个楼层已经写入的事件数；可按来源过滤，重复执行前用它判断是否已经处理过。 */
	countEventsForNode(nodeId: string, source?: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		if (source !== undefined) {
			assertNonEmptyString(source, "事件来源");
		}
		const statement =
			source === undefined
				? "SELECT COUNT(*) AS count FROM memory_events WHERE source_node_id = ?"
				: "SELECT COUNT(*) AS count FROM memory_events WHERE source_node_id = ? AND source = ?";
		const params = source === undefined ? [nodeId] : [nodeId, source];
		const row = this.db.prepare(statement).get(...params) as {
			readonly count: number;
		};
		return row.count;
	}

	/** 统计某个楼层写入的检索块数。 */
	countChunksForNode(nodeId: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT COUNT(*) AS count FROM chunks WHERE node_id = ?")
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	/** 统计某个楼层的父段数；旧分块没有父段时返回 0。 */
	countChunkParentsForNode(nodeId: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare(
				`SELECT COUNT(DISTINCT parent_ordinal) AS count
				FROM chunks
				WHERE node_id = ? AND parent_ordinal IS NOT NULL`,
			)
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	/** 统计某个楼层已经写入的向量数。 */
	countChunkVectorsForNode(nodeId: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT COUNT(*) AS count FROM chunk_vectors WHERE node_id = ?")
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	/** 返回某个楼层里还没有向量的块，按序号排序。 */
	listChunksMissingVectors(nodeId: string): ChunkWithoutVector[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT c.id AS chunk_id, c.text
				FROM chunks AS c
				WHERE c.node_id = ?
					AND NOT EXISTS (
						SELECT 1 FROM chunk_vectors AS v WHERE v.chunk_id = c.id
					)
				ORDER BY c.ordinal ASC`,
			)
			.all(nodeId) as ChunkTextRow[];
		return rows.map((row) => ({ chunkId: row.chunk_id, text: row.text }));
	}

	/** 返回某个楼层已写入的块向量，按块序号排序。 */
	listChunkVectorsForNode(nodeId: string): ChunkVectorForNode[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT c.id AS chunk_id, c.ordinal, v.embedding
				FROM chunks AS c
				JOIN chunk_vectors AS v ON v.chunk_id = c.id
				WHERE c.node_id = ?
				ORDER BY c.ordinal ASC`,
			)
			.all(nodeId) as NodeChunkVectorRow[];
		return rows.map((row) => ({
			chunkId: row.chunk_id,
			ordinal: row.ordinal,
			vector: decodeEmbedding(
				row.embedding,
				`楼层 ${nodeId} 的块 ${row.chunk_id}`,
			),
		}));
	}

	/**
	 * 在同一个事务里写入块向量。向量维度必须与数据库一致；
	 * 块不存在、向量非法或同一块重复写入都直接抛错。
	 */
	insertChunkVectors(inputs: readonly ChunkVectorInput[]): void {
		if (!Array.isArray(inputs)) {
			throw new Error("块向量必须是数组");
		}
		if (inputs.length === 0) return;
		const seen = new Set<number>();
		const rows = inputs.map((input, index) => {
			const label = `块向量[${index}]`;
			if (input === null || typeof input !== "object" || Array.isArray(input)) {
				throw new Error(`${label} 必须是对象`);
			}
			const { chunkId, embedding } = input;
			if (!Number.isInteger(chunkId) || chunkId < 1) {
				throw new Error(`${label}.chunkId 必须是正整数`);
			}
			if (seen.has(chunkId)) {
				throw new Error(`${label} 重复写入块 ${chunkId}`);
			}
			seen.add(chunkId);
			const chunk = this.db
				.prepare("SELECT story_id, node_id FROM chunks WHERE id = ?")
				.get(chunkId) as ChunkIdentityRow | undefined;
			if (!chunk) {
				throw new Error(`${label} 引用了不存在的块 ${chunkId}`);
			}
			return {
				chunkId,
				storyId: chunk.story_id,
				nodeId: chunk.node_id,
				embedding: this.#normaliseEmbedding(embedding, `${label}.embedding`),
			};
		});
		const insert = this.db.prepare(
			`INSERT INTO chunk_vectors (chunk_id, story_id, node_id, embedding)
			VALUES (?, ?, ?, ?)`,
		);
		this.db.transaction(() => {
			for (const row of rows) {
				insert.run(BigInt(row.chunkId), row.storyId, row.nodeId, row.embedding);
			}
		})();
	}

	/**
	 * 按距离检索块向量。给 beforeNodeId 时只搜索它的祖先路径；
	 * 返回顺序是距离从小到大。
	 */
	searchVectors(
		vector: readonly number[],
		options: SearchVectorsOptions,
	): VectorSearchMatch[] {
		assertNonEmptyString(options.storyId, "故事 id");
		if (!this.store.getStory(options.storyId)) {
			throw new Error(`故事不存在：${options.storyId}`);
		}
		const query = this.#normaliseEmbedding(vector, "查询向量");
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
		const beforeNodeId = options.beforeNodeId ?? null;
		if (beforeNodeId !== null) {
			assertNonEmptyString(beforeNodeId, "楼层节点 id");
			const node = this.store.getNode(beforeNodeId);
			if (!node) {
				throw new Error(`楼层节点不存在：${beforeNodeId}`);
			}
			if (node.storyId !== options.storyId) {
				throw new Error(
					`楼层节点 ${beforeNodeId} 属于另一个故事 ${node.storyId}`,
				);
			}
		}
		const rows = this.db
			.prepare(
				`WITH RECURSIVE ancestors(node_id) AS (
					SELECT parent_id FROM nodes WHERE id = @beforeNodeId
					UNION ALL
					SELECT nodes.parent_id
					FROM nodes JOIN ancestors ON nodes.id = ancestors.node_id
					WHERE nodes.parent_id IS NOT NULL
				),
				candidates AS (
					SELECT chunk_id, story_id, node_id, distance
					FROM chunk_vectors
					WHERE embedding MATCH @vector AND k = @limit
						AND story_id = @storyId
						AND (@beforeNodeId IS NULL
							OR node_id IN (SELECT node_id FROM ancestors))
					ORDER BY distance ASC
				)
				SELECT candidates.chunk_id, candidates.story_id, candidates.node_id,
					candidates.distance, chunks.parent_ordinal, chunks.parent_text
				FROM candidates
				JOIN chunks ON chunks.id = candidates.chunk_id
				ORDER BY candidates.distance ASC`,
			)
			.all({
				vector: query,
				limit,
				storyId: options.storyId,
				beforeNodeId,
			}) as ChunkVectorRow[];
		return rows.map((row) => ({
			storyId: row.story_id,
			nodeId: row.node_id,
			chunkId: row.chunk_id,
			parentOrdinal: row.parent_ordinal,
			parentText: row.parent_text,
			distance: row.distance,
		}));
	}

	/**
	 * 在块索引里检索。给 beforeNodeId 时只搜索它的祖先路径，结果是同一楼层
	 * 多个块里分数最好的那一块，因此每个楼层只占一个位次。
	 */
	searchChunks(
		query: string,
		options: SearchChunksOptions,
	): ChunkSearchMatch[] {
		if (typeof query !== "string") {
			throw new Error("检索语句必须是字符串");
		}
		assertNonEmptyString(options.storyId, "故事 id");
		if (!this.store.getStory(options.storyId)) {
			throw new Error(`故事不存在：${options.storyId}`);
		}
		const ftsQuery = buildTrigramQuery(query);
		if (ftsQuery === null) return [];
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
		const beforeNodeId = options.beforeNodeId ?? null;
		if (beforeNodeId !== null) {
			assertNonEmptyString(beforeNodeId, "楼层节点 id");
			const node = this.store.getNode(beforeNodeId);
			if (!node) {
				throw new Error(`楼层节点不存在：${beforeNodeId}`);
			}
			if (node.storyId !== options.storyId) {
				throw new Error(
					`楼层节点 ${beforeNodeId} 属于另一个故事 ${node.storyId}`,
				);
			}
		}
		const rows = this.db
			.prepare(
				`WITH RECURSIVE ancestors(node_id) AS (
					SELECT parent_id FROM nodes WHERE id = @beforeNodeId
					UNION ALL
					SELECT nodes.parent_id
					FROM nodes JOIN ancestors ON nodes.id = ancestors.node_id
					WHERE nodes.parent_id IS NOT NULL
				),
				matches AS (
					SELECT c.id AS chunk_id, c.node_id, c.story_id,
						c.parent_ordinal, c.parent_text,
						bm25(chunks_fts) AS score
					FROM chunks_fts
					JOIN chunks AS c ON c.id = chunks_fts.rowid
					WHERE chunks_fts MATCH @query
						AND c.story_id = @storyId
						AND (@beforeNodeId IS NULL
							OR c.node_id IN (SELECT node_id FROM ancestors))
				),
				ranked AS (
					SELECT chunk_id, node_id, story_id, parent_ordinal, parent_text,
						score,
						ROW_NUMBER() OVER (
							PARTITION BY node_id,
								CASE WHEN parent_ordinal IS NULL THEN 0 ELSE parent_ordinal END
							ORDER BY score ASC, chunk_id ASC
						) AS position
					FROM matches
				)
				SELECT chunk_id, node_id, story_id, parent_ordinal, parent_text, score
				FROM ranked
				WHERE position = 1
				ORDER BY score ASC, chunk_id ASC
				LIMIT @limit`,
			)
			.all({
				query: ftsQuery,
				storyId: options.storyId,
				beforeNodeId,
				limit,
			}) as ChunkRow[];
		return rows.map((row) => ({
			storyId: row.story_id,
			nodeId: row.node_id,
			chunkId: row.chunk_id,
			parentOrdinal: row.parent_ordinal,
			parentText: row.parent_text,
			score: row.score,
		}));
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
		const rows = this.db
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

	#normaliseEmbedding(value: unknown, label: string): Buffer {
		if (!Array.isArray(value)) {
			throw new Error(`${label} 必须是数字数组`);
		}
		if (value.length !== this.embeddingDimensions) {
			throw new Error(
				`${label} 的维度必须是 ${this.embeddingDimensions}，实际为 ${value.length}`,
			);
		}
		const numbers = value.map((item, index) => {
			if (typeof item !== "number" || !Number.isFinite(item)) {
				throw new Error(`${label}[${index}] 必须是有限数字`);
			}
			return item;
		});
		return Buffer.from(new Float32Array(numbers).buffer);
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
		const node = this.store.getNode(input.sourceNodeId);
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
		const source = input.source ?? DEFAULT_MEMORY_EVENT_SOURCE;
		assertNonEmptyString(source, `${label} 的 source`);
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
			source,
			createdAt,
		};
	}
}
