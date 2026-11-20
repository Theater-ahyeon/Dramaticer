// StoryStore 的领域仓储：现场分析、百科修订、场记、场次归档与控制、摘要与章节压缩（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import { randomUUID } from "node:crypto";
import type { PlayerEditKind } from "../../edits/index.js";
import { type JsonValue, isJsonObject } from "../../json.js";
import {
	type SceneInformed,
	assertSceneInformedList,
	assertSceneProfileUpdates,
} from "../../ledger/character-profile.js";
import {
	type GapPassRun,
	type NewGapPassRun,
	assertGapPassDroppedEntries,
	assertGapPassRejections,
} from "../../ledger/gap-pass.js";
import {
	type NewSceneArchive,
	type SceneArchive,
	assertNewSceneArchive,
	assertSceneStateChanges,
} from "../../ledger/scene-archive.js";
import {
	type NewSceneControl,
	type SceneControl,
	type SceneControlKind,
	assertSceneControlKind,
	assertSceneControlPayload,
} from "../../ledger/scene-control.js";
import {
	type NewSceneLog,
	type SceneLog,
	assertNewSceneLog,
	assertSceneCard,
	assertSceneLogConditions,
	assertSceneLogQuotes,
	assertSceneLogStates,
} from "../../ledger/scene-log.js";
import { isSceneBoundary } from "../../ledger/scenes.js";
import { LEDGER_SOURCES, type LedgerSource } from "../../ledger/schema.js";
import { assertLedgerRepairs } from "../../ledger/settlement.js";
import {
	type ChapterCompression,
	type NewChapterCompressionInput,
	assertCompressionSections,
	formatCompressionSections,
	isCompressionLevel,
} from "../../memory/compression.js";
import type { NewSceneAnalysis, SceneAnalysis } from "../../memory/scene.js";
import {
	type NewSummaryInput,
	type Summary,
	isSummaryLevel,
} from "../../memory/summary.js";
import { createTokenEstimator } from "../../tokens.js";
import type { NewWikiRevision, WikiRevision } from "../../world-model/wiki.js";
import { StoreRepo } from "./base.js";
import {
	assertNonEmptyString,
	normaliseStoryTime,
	readBooleanColumn,
} from "./shared.js";

interface SceneAnalysisRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly text: string;
	readonly token_count: number;
	readonly created_at: string;
}

interface SceneLogRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly beat: string;
	readonly present: string;
	readonly scene_ends: number;
	readonly scene_card: string | null;
	readonly bits: string;
	readonly conditions: string;
	readonly states: string;
	readonly quote_submitted: number;
	readonly quote_verified: number;
	readonly repairs: string;
	readonly created_at: string;
}

interface SceneArchiveRow {
	readonly end_node_id: string;
	readonly story_id: string;
	readonly start_node_id: string;
	readonly floor_count: number;
	readonly boundary: string;
	readonly summary: string;
	readonly present: string;
	readonly profiles: string;
	readonly informed: string;
	readonly state_changes: string;
	readonly clues_opened: string;
	readonly clues_closed: string;
	readonly created_at: string;
}

interface SceneControlRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly kind: string;
	readonly payload: string;
	readonly created_at: string;
}

interface WikiRevisionRow {
	readonly id: number;
	readonly story_id: string;
	readonly entity_id: string;
	readonly node_id: string;
	readonly text: string;
	readonly story_time_start: string | null;
	readonly story_time_end: string | null;
	readonly source: string;
	readonly created_at: string;
}

interface GapPassRunRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly rejected_segments: string;
	readonly dropped_entries: string;
	readonly created_at: string;
}

interface SummaryRow {
	readonly id: string;
	readonly story_id: string;
	readonly level: string;
	readonly start_node_id: string;
	readonly end_node_id: string;
	readonly text: string;
	readonly token_count: number;
	readonly created_at: string;
}

interface ChapterCompressionRow {
	readonly id: string;
	readonly story_id: string;
	readonly level: string;
	readonly start_node_id: string;
	readonly end_node_id: string;
	readonly sections: string;
	readonly token_count: number;
	readonly created_at: string;
}

interface NormalisedSummary {
	readonly id: string;
	readonly storyId: string;
	readonly level: Summary["level"];
	readonly startNodeId: string;
	readonly endNodeId: string;
	readonly text: string;
	readonly tokenCount: number;
	readonly createdAt: string;
}

const estimateTokens = createTokenEstimator();

function rowToSceneAnalysis(row: SceneAnalysisRow): SceneAnalysis {
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		text: row.text,
		tokenCount: row.token_count,
		createdAt: row.created_at,
	};
}

function rowToSceneLog(row: SceneLogRow): SceneLog {
	const label = `楼层 ${row.node_id} 的场记记录`;
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		beat: row.beat,
		present: readStringArray(row.present, `${label}.present`),
		sceneEnds: readBooleanColumn(row.scene_ends, `${label}.scene_ends`),
		sceneCard:
			row.scene_card === null
				? null
				: assertSceneCard(
						JSON.parse(row.scene_card) as unknown,
						`${label}.scene_card`,
					),
		bits: readStringArray(row.bits, `${label}.bits`),
		conditions: assertSceneLogConditions(
			JSON.parse(row.conditions) as unknown,
			`${label}.conditions`,
		),
		states: assertSceneLogStates(
			JSON.parse(row.states) as unknown,
			`${label}.states`,
		),
		quotes: assertSceneLogQuotes(
			{
				submitted: row.quote_submitted,
				verified: row.quote_verified,
			},
			`${label}.quotes`,
		),
		repairs: assertLedgerRepairs(
			JSON.parse(row.repairs) as unknown,
			`${label}.repairs`,
		),
		createdAt: row.created_at,
	};
}

function rowToSceneArchive(row: SceneArchiveRow): SceneArchive {
	const label = `楼层 ${row.end_node_id} 的场次归档`;
	if (!isSceneBoundary(row.boundary)) {
		throw new Error(`${label}.boundary 不合法：${row.boundary}`);
	}
	return {
		endNodeId: row.end_node_id,
		storyId: row.story_id,
		startNodeId: row.start_node_id,
		floorCount: row.floor_count,
		boundary: row.boundary,
		summary: row.summary,
		present: readStringArray(row.present, `${label}.present`),
		profiles: assertSceneProfileUpdates(
			JSON.parse(row.profiles) as unknown,
			`${label}.profiles`,
		),
		informed: assertSceneInformedList(
			JSON.parse(row.informed) as unknown,
			`${label}.informed`,
		),
		stateChanges: assertSceneStateChanges(
			JSON.parse(row.state_changes) as unknown,
			`${label}.stateChanges`,
		),
		cluesOpened: readStringArray(row.clues_opened, `${label}.cluesOpened`),
		cluesClosed: readStringArray(row.clues_closed, `${label}.cluesClosed`),
		createdAt: row.created_at,
	};
}

/**
 * 知情记录只能引用当前路径上更早的已归档场次；引用同一场或未来场次时
 * 推导出的知情关系不成立，所以在写入前拒绝。
 */
function assertSceneArchiveInformedReferences(
	informed: readonly SceneInformed[],
	getArchive: (endNodeId: string) => SceneArchive | null,
	endPosition: number,
	path: readonly { readonly id: string }[],
): void {
	for (const entry of informed) {
		const factPosition = path.findIndex((node) => node.id === entry.factId);
		if (factPosition === -1 || factPosition >= endPosition) {
			throw new Error(
				`场次归档.informed 的 factId 必须是当前路径上更早的楼层：${entry.factId}`,
			);
		}
		if (getArchive(entry.factId) === null) {
			throw new Error(
				`场次归档.informed 的 factId 还没有归档：${entry.factId}`,
			);
		}
	}
}

function rowToSceneControl(row: SceneControlRow): SceneControl {
	const kind = assertSceneControlKind(
		row.kind,
		`楼层 ${row.node_id} 的场面控制种类`,
	);
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		kind,
		payload: assertSceneControlPayload(
			kind,
			JSON.parse(row.payload) as unknown,
			`楼层 ${row.node_id} 的场面控制载荷`,
		),
		createdAt: row.created_at,
	};
}

function readStringArray(value: string, label: string): readonly string[] {
	const parsed = JSON.parse(value) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error(`${label} 必须是数组`);
	}
	return parsed.map((item, index) => {
		if (typeof item !== "string" || item.length === 0) {
			throw new Error(`${label}[${index}] 必须是非空字符串`);
		}
		return item;
	});
}

function rowToWikiRevision(row: WikiRevisionRow): WikiRevision {
	if (!(LEDGER_SOURCES as readonly string[]).includes(row.source)) {
		throw new Error(`实体档案修订 ${row.id} 的来源不合法：${row.source}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		entityId: row.entity_id,
		nodeId: row.node_id,
		text: row.text,
		storyTime:
			row.story_time_start === null && row.story_time_end === null
				? null
				: { start: row.story_time_start, end: row.story_time_end },
		source: row.source as LedgerSource,
		createdAt: row.created_at,
	};
}

function rowToGapPassRun(row: GapPassRunRow): GapPassRun {
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		rejectedSegments: assertGapPassRejections(
			JSON.parse(row.rejected_segments) as unknown,
			`楼层 ${row.node_id} 的合并调用记录`,
		),
		droppedEntries: assertGapPassDroppedEntries(
			JSON.parse(row.dropped_entries) as unknown,
			`楼层 ${row.node_id} 的合并调用记录`,
		),
		createdAt: row.created_at,
	};
}

function rowToSummary(row: SummaryRow): Summary {
	if (!isSummaryLevel(row.level)) {
		throw new Error(`摘要 ${row.id} 的级别不合法：${row.level}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		level: row.level,
		startNodeId: row.start_node_id,
		endNodeId: row.end_node_id,
		text: row.text,
		tokenCount: row.token_count,
		createdAt: row.created_at,
	};
}

function rowToChapterCompression(
	row: ChapterCompressionRow,
): ChapterCompression {
	if (!isCompressionLevel(row.level)) {
		throw new Error(`压缩 ${row.id} 的级别不合法：${row.level}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(row.sections);
	} catch (error) {
		throw new Error(`压缩 ${row.id} 的 sections 不是合法 JSON`, {
			cause: error,
		});
	}
	return {
		id: row.id,
		storyId: row.story_id,
		level: row.level,
		startNodeId: row.start_node_id,
		endNodeId: row.end_node_id,
		sections: assertCompressionSections(parsed, `压缩 ${row.id} 的 sections`),
		tokenCount: row.token_count,
		createdAt: row.created_at,
	};
}

export class ScenesRepo extends StoreRepo {
	/** 写入一个楼层的现场分析；同一楼层重复执行覆盖同一行。 */
	saveSceneAnalysis(input: NewSceneAnalysis): SceneAnalysis {
		assertNonEmptyString(input.nodeId, "现场分析的楼层 id");
		assertNonEmptyString(input.storyId, "现场分析的故事 id");
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`现场分析的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		if (typeof input.text !== "string" || input.text.trim().length === 0) {
			throw new Error("现场分析的正文必须是非空字符串");
		}
		if (!Number.isInteger(input.tokenCount) || input.tokenCount < 0) {
			throw new Error("现场分析的 token 数必须是非负整数");
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "现场分析的创建时间");
		this.db
			.prepare(
				`INSERT INTO scene_analyses (node_id, story_id, text, token_count, created_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT (node_id) DO UPDATE SET
					text = excluded.text,
					token_count = excluded.token_count,
					created_at = excluded.created_at`,
			)
			.run(
				input.nodeId,
				input.storyId,
				input.text,
				input.tokenCount,
				createdAt,
			);
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			text: input.text,
			tokenCount: input.tokenCount,
			createdAt,
		};
	}

	/** 读取一个楼层的现场分析；没有时返回 null。 */
	getSceneAnalysis(nodeId: string): SceneAnalysis | null {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM scene_analyses WHERE node_id = ?")
			.get(nodeId) as SceneAnalysisRow | undefined;
		return row === undefined ? null : rowToSceneAnalysis(row);
	}

	/** 沿节点所在的路径取最近一层的现场分析；没有时返回 null。 */
	getLatestSceneAnalysisOnPath(nodeId: string): SceneAnalysis | null {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare(
				`WITH RECURSIVE chain(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, chain.depth + 1
					FROM nodes JOIN chain ON nodes.id = chain.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT scene_analyses.*
				FROM scene_analyses JOIN chain ON scene_analyses.node_id = chain.node_id
				ORDER BY chain.depth ASC
				LIMIT 1`,
			)
			.get(nodeId) as SceneAnalysisRow | undefined;
		return row === undefined ? null : rowToSceneAnalysis(row);
	}

	/**
	 * 追加实体档案修订。只追加，不覆盖：同一实体在同一楼层可以有多个版本，
	 * 读取时按当前路径取最新一版。
	 */
	appendWikiRevisions(inputs: readonly NewWikiRevision[]): WikiRevision[] {
		if (!Array.isArray(inputs)) {
			throw new Error("实体档案修订必须是数组");
		}
		if (inputs.length === 0) return [];
		const normalised = inputs.map((input, index) =>
			this.#normaliseWikiRevision(input, index),
		);
		const insert = this.db.prepare(
			`INSERT INTO world_wiki_revisions
				(story_id, entity_id, node_id, text, story_time_start, story_time_end, source, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const run = this.db.transaction(
			(revisions: readonly NewWikiRevision[]): WikiRevision[] => {
				const stored: WikiRevision[] = [];
				for (const revision of revisions) {
					const createdAt = revision.createdAt ?? new Date().toISOString();
					assertNonEmptyString(createdAt, "实体档案修订的创建时间");
					const info = insert.run(
						revision.storyId,
						revision.entityId,
						revision.nodeId,
						revision.text,
						revision.storyTime?.start ?? null,
						revision.storyTime?.end ?? null,
						revision.source,
						createdAt,
					);
					stored.push({
						id: Number(info.lastInsertRowid),
						storyId: revision.storyId,
						entityId: revision.entityId,
						nodeId: revision.nodeId,
						text: revision.text,
						storyTime: revision.storyTime ?? null,
						source: revision.source,
						createdAt,
					});
				}
				return stored;
			},
		);
		return run(normalised);
	}

	/** 按当前路径取实体档案修订，根在前；越早的版本排在前面。 */
	listWikiRevisionsAlongPath(nodeId: string): WikiRevision[] {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.db
			.prepare(
				`WITH RECURSIVE chain(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, chain.depth + 1
					FROM nodes JOIN chain ON nodes.id = chain.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT world_wiki_revisions.*
				FROM world_wiki_revisions
					JOIN chain ON world_wiki_revisions.node_id = chain.node_id
				ORDER BY chain.depth DESC, world_wiki_revisions.id ASC`,
			)
			.all(nodeId) as WikiRevisionRow[];
		return rows.map(rowToWikiRevision);
	}

	/** 记录的逐字出处；与事件表分开存，事件表保持只追加。 */
	saveMemoryEventQuotes(
		storyId: string,
		items: readonly { eventId: string; quote: string }[],
	): void {
		const insert = this.db.prepare(
			"INSERT OR IGNORE INTO memory_event_quotes (event_id, story_id, quote) VALUES (?, ?, ?)",
		);
		this.db.transaction(() => {
			for (const item of items) insert.run(item.eventId, storyId, item.quote);
		})();
	}

	getMemoryEventQuotes(storyId: string): Map<string, string> {
		const rows = this.db
			.prepare(
				"SELECT event_id, quote FROM memory_event_quotes WHERE story_id = ?",
			)
			.all(storyId) as { event_id: string; quote: string }[];
		return new Map(rows.map((row) => [row.event_id, row.quote] as const));
	}

	/** 被拒绝的记忆写入：出处对不上的记录、写向锁定项的后台修改。 */
	recordMemoryRejection(input: {
		storyId: string;
		nodeId: string | null;
		kind: string;
		text: string;
		reason: string;
	}): void {
		this.db
			.prepare(
				`INSERT INTO memory_rejections (story_id, node_id, kind, text, reason, created_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.storyId,
				input.nodeId,
				input.kind,
				input.text,
				input.reason,
				new Date().toISOString(),
			);
	}

	listMemoryRejections(
		storyId: string,
		limit = 50,
	): {
		id: number;
		nodeId: string | null;
		kind: string;
		text: string;
		reason: string;
		createdAt: string;
	}[] {
		const rows = this.db
			.prepare(
				"SELECT * FROM memory_rejections WHERE story_id = ? ORDER BY id DESC LIMIT ?",
			)
			.all(storyId, limit) as {
			id: number;
			node_id: string | null;
			kind: string;
			text: string;
			reason: string;
			created_at: string;
		}[];
		return rows.map((row) => ({
			id: row.id,
			nodeId: row.node_id,
			kind: row.kind,
			text: row.text,
			reason: row.reason,
			createdAt: row.created_at,
		}));
	}

	/** 写入一个楼层的合并调用执行记录；同一楼层重复执行覆盖同一行。 */
	saveGapPassRun(input: NewGapPassRun): GapPassRun {
		assertNonEmptyString(input.nodeId, "合并调用记录的楼层 id");
		assertNonEmptyString(input.storyId, "合并调用记录的故事 id");
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`合并调用记录的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const rejectedSegments = assertGapPassRejections(
			input.rejectedSegments,
			"合并调用记录的 rejectedSegments",
		);
		const droppedEntries = assertGapPassDroppedEntries(
			input.droppedEntries ?? [],
			"合并调用记录的 droppedEntries",
		);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "合并调用记录的创建时间");
		this.db
			.prepare(
				`INSERT INTO gap_pass_runs (node_id, story_id, rejected_segments, dropped_entries, created_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT (node_id) DO UPDATE SET
					rejected_segments = excluded.rejected_segments,
					dropped_entries = excluded.dropped_entries,
					created_at = excluded.created_at`,
			)
			.run(
				input.nodeId,
				input.storyId,
				JSON.stringify(rejectedSegments),
				JSON.stringify(droppedEntries),
				createdAt,
			);
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			rejectedSegments,
			droppedEntries,
			createdAt,
		};
	}

	/** 读取一个楼层的合并调用执行记录；没有时返回 null。 */
	getGapPassRun(nodeId: string): GapPassRun | null {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM gap_pass_runs WHERE node_id = ?")
			.get(nodeId) as GapPassRunRow | undefined;
		return row === undefined ? null : rowToGapPassRun(row);
	}

	/** 写入一个楼层的场记记录；同一楼层重复执行覆盖同一行。 */
	saveSceneLog(input: NewSceneLog): SceneLog {
		const normalised = assertNewSceneLog(input);
		const node = this.store.getNode(normalised.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${normalised.nodeId}`);
		}
		if (node.storyId !== normalised.storyId) {
			throw new Error(
				`场记记录的 storyId 与楼层所属故事不一致：${normalised.storyId}`,
			);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "场记记录的创建时间");
		this.db
			.prepare(
				`INSERT INTO scene_logs
					(node_id, story_id, beat, present, scene_ends, scene_card, bits,
					 conditions, states, quote_submitted, quote_verified, repairs,
					 created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (node_id) DO UPDATE SET
					beat = excluded.beat,
					present = excluded.present,
					scene_ends = excluded.scene_ends,
					scene_card = excluded.scene_card,
					bits = excluded.bits,
					conditions = excluded.conditions,
					states = excluded.states,
					quote_submitted = excluded.quote_submitted,
					quote_verified = excluded.quote_verified,
					repairs = excluded.repairs,
					created_at = excluded.created_at`,
			)
			.run(
				normalised.nodeId,
				normalised.storyId,
				normalised.beat,
				JSON.stringify(normalised.present),
				normalised.sceneEnds ? 1 : 0,
				normalised.sceneCard === null
					? null
					: JSON.stringify(normalised.sceneCard),
				JSON.stringify(normalised.bits),
				JSON.stringify(normalised.conditions),
				JSON.stringify(normalised.states),
				normalised.quotes.submitted,
				normalised.quotes.verified,
				JSON.stringify(normalised.repairs),
				createdAt,
			);
		return { ...normalised, createdAt };
	}

	/** 读取一个楼层的场记记录；没有时返回 null。 */
	getSceneLog(nodeId: string): SceneLog | null {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM scene_logs WHERE node_id = ?")
			.get(nodeId) as SceneLogRow | undefined;
		return row === undefined ? null : rowToSceneLog(row);
	}

	/** 沿节点所在的路径取最近一层的场记记录；没有时返回 null。 */
	getLatestSceneLogOnPath(nodeId: string): SceneLog | null {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare(
				`WITH RECURSIVE chain(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, chain.depth + 1
					FROM nodes JOIN chain ON nodes.id = chain.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT scene_logs.*
				FROM scene_logs JOIN chain ON scene_logs.node_id = chain.node_id
				ORDER BY chain.depth ASC
				LIMIT 1`,
			)
			.get(nodeId) as SceneLogRow | undefined;
		return row === undefined ? null : rowToSceneLog(row);
	}

	/**
	 * 某一类对象在当前路径上被玩家锁定的值；后台写入前用它判断是否只能留作建议。
	 * 只查修改表，避免存储层反过来引用投影模块。
	 */
	#lockedEditValue(
		storyId: string,
		kind: PlayerEditKind,
		target: string,
		nodeId: string,
	): JsonValue | null {
		const rows = this.db
			.prepare(
				`SELECT node_id, value, locked FROM player_edits
				WHERE story_id = ? AND kind = ? AND target = ? AND source != 'rejected'
				ORDER BY id`,
			)
			.all(storyId, kind, target) as {
			node_id: string | null;
			value: string | null;
			locked: number;
		}[];
		if (rows.length === 0) return null;
		const pathIds = new Set(
			this.store.getPathToNode(nodeId).map((node) => node.id),
		);
		let locked = false;
		let value: JsonValue | null = null;
		for (const row of rows) {
			if (row.node_id !== null && !pathIds.has(row.node_id)) continue;
			locked = row.locked === 1;
			value = row.value === null ? null : (JSON.parse(row.value) as JsonValue);
		}
		return locked ? value : null;
	}

	/** 写入一场的归档；同一场次（结束楼层）重复执行覆盖同一行。 */
	saveSceneArchive(input: NewSceneArchive): SceneArchive {
		const normalised = assertNewSceneArchive(input);
		const end = this.store.getNode(normalised.endNodeId);
		if (!end) {
			throw new Error(`楼层节点不存在：${normalised.endNodeId}`);
		}
		if (end.storyId !== normalised.storyId) {
			throw new Error(
				`场次归档的 storyId 与结束楼层所属故事不一致：${normalised.storyId}`,
			);
		}
		if (end.role !== "assistant") {
			throw new Error(`场次归档只能挂在助手楼层上：${normalised.endNodeId}`);
		}
		const start = this.store.getNode(normalised.startNodeId);
		if (!start) {
			throw new Error(`楼层节点不存在：${normalised.startNodeId}`);
		}
		if (start.storyId !== normalised.storyId) {
			throw new Error(
				`场次归档的起始楼层 ${normalised.startNodeId} 属于另一个故事`,
			);
		}
		if (start.role !== "assistant") {
			throw new Error(
				`场次归档的起始楼层必须是助手楼层：${normalised.startNodeId}`,
			);
		}
		const path = this.store.getPathToNode(normalised.endNodeId);
		const endPosition = path.findIndex(
			(node) => node.id === normalised.endNodeId,
		);
		const startPosition = path.findIndex(
			(node) => node.id === normalised.startNodeId,
		);
		if (startPosition === -1) {
			throw new Error(
				`场次归档的起始楼层 ${normalised.startNodeId} 不在结束楼层 ${normalised.endNodeId} 的路径上`,
			);
		}
		assertSceneArchiveInformedReferences(
			normalised.informed,
			(endNodeId) => this.getSceneArchive(endNodeId),
			endPosition,
			path,
		);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "场次归档的创建时间");
		const previousSummary = this.getSceneArchive(normalised.endNodeId)?.summary;
		const lockedSummary = this.#lockedEditValue(
			normalised.storyId,
			"summary",
			normalised.endNodeId,
			normalised.endNodeId,
		);
		const playerSummary =
			isJsonObject(lockedSummary) &&
			typeof lockedSummary.text === "string" &&
			lockedSummary.text.trim().length > 0
				? lockedSummary.text
				: null;
		// 锁定时保留上一份自动摘要：玩家的版本由投影叠加显示，恢复时还能回到自动内容。
		const summary =
			playerSummary === null
				? normalised.summary
				: (previousSummary ?? normalised.summary);
		this.db
			.prepare(
				`INSERT INTO scene_archives
					(end_node_id, story_id, start_node_id, floor_count, boundary,
					 summary, present, profiles, informed, state_changes,
					 clues_opened, clues_closed, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (end_node_id) DO UPDATE SET
					start_node_id = excluded.start_node_id,
					floor_count = excluded.floor_count,
					boundary = excluded.boundary,
					summary = excluded.summary,
					present = excluded.present,
					profiles = excluded.profiles,
					informed = excluded.informed,
					state_changes = excluded.state_changes,
					clues_opened = excluded.clues_opened,
					clues_closed = excluded.clues_closed,
					created_at = excluded.created_at`,
			)
			.run(
				normalised.endNodeId,
				normalised.storyId,
				normalised.startNodeId,
				normalised.floorCount,
				normalised.boundary,
				summary,
				JSON.stringify(normalised.present),
				JSON.stringify(normalised.profiles),
				JSON.stringify(normalised.informed),
				JSON.stringify(normalised.stateChanges),
				JSON.stringify(normalised.cluesOpened),
				JSON.stringify(normalised.cluesClosed),
				createdAt,
			);
		if (playerSummary !== null && previousSummary !== normalised.summary) {
			this.recordMemoryRejection({
				storyId: normalised.storyId,
				nodeId: normalised.endNodeId,
				kind: "summary",
				text: normalised.summary,
				reason: "场次摘要被玩家锁定，后台整理的内容只留作未采用的版本",
			});
		}
		return { ...normalised, summary, createdAt };
	}

	/** 读取一场的归档；没有时返回 null。 */
	getSceneArchive(endNodeId: string): SceneArchive | null {
		if (!this.store.getNode(endNodeId)) {
			throw new Error(`楼层节点不存在：${endNodeId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM scene_archives WHERE end_node_id = ?")
			.get(endNodeId) as SceneArchiveRow | undefined;
		return row === undefined ? null : rowToSceneArchive(row);
	}

	/** 按路径顺序读出已经归档的场次；分支切换后只返回当前分支上的场次。 */
	listSceneArchivesAlongPath(nodeId: string): SceneArchive[] {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.db
			.prepare(
				`WITH RECURSIVE chain(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, chain.depth + 1
					FROM nodes JOIN chain ON nodes.id = chain.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT scene_archives.*
				FROM scene_archives JOIN chain ON scene_archives.end_node_id = chain.node_id
				ORDER BY chain.depth DESC`,
			)
			.all(nodeId) as SceneArchiveRow[];
		return rows.map(rowToSceneArchive);
	}

	/** 写入一条场面控制；同一楼层同一操作覆盖同一行。 */
	saveSceneControl(input: NewSceneControl): SceneControl {
		assertNonEmptyString(input.storyId, "场面控制的故事 id");
		assertNonEmptyString(input.nodeId, "场面控制的楼层 id");
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`场面控制的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const kind = assertSceneControlKind(input.kind);
		const payload = assertSceneControlPayload(
			kind,
			input.payload,
			"场面控制的载荷",
		);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "场面控制的创建时间");
		this.db
			.prepare(
				`INSERT INTO scene_controls (node_id, story_id, kind, payload, created_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT (node_id, kind) DO UPDATE SET
					payload = excluded.payload,
					created_at = excluded.created_at`,
			)
			.run(
				input.nodeId,
				input.storyId,
				kind,
				JSON.stringify(payload),
				createdAt,
			);
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			kind,
			payload,
			createdAt,
		};
	}

	/** 读取一个楼层的场面控制；没有时返回 null。 */
	getSceneControl(nodeId: string, kind: SceneControlKind): SceneControl | null {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM scene_controls WHERE node_id = ? AND kind = ?")
			.get(nodeId, assertSceneControlKind(kind)) as SceneControlRow | undefined;
		return row === undefined ? null : rowToSceneControl(row);
	}

	/** 沿楼层所在路径读出某一种场面控制落在哪些楼层。 */
	listSceneControlKindsOnPath(
		nodeId: string,
		kind: SceneControlKind,
	): ReadonlySet<string> {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.db
			.prepare(
				`WITH RECURSIVE chain(node_id) AS (
					SELECT id FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id
					FROM nodes JOIN chain ON nodes.id = chain.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT scene_controls.node_id
				FROM scene_controls JOIN chain ON scene_controls.node_id = chain.node_id
				WHERE scene_controls.kind = ?`,
			)
			.all(nodeId, assertSceneControlKind(kind)) as {
			readonly node_id: string;
		}[];
		return new Set(rows.map((row) => row.node_id));
	}

	/**
	 * 写入一条摘要。起点必须是终点的祖先，text 去掉首尾空白后必须非空；
	 * token_count 在这里用统一估算器计算。
	 */
	insertSummary(input: NewSummaryInput): Summary {
		const summary = this.#normaliseSummary(input);
		this.db
			.prepare(
				`INSERT INTO summaries
					(id, story_id, level, start_node_id, end_node_id, text, token_count, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				summary.id,
				summary.storyId,
				summary.level,
				summary.startNodeId,
				summary.endNodeId,
				summary.text,
				summary.tokenCount,
				summary.createdAt,
			);
		return {
			id: summary.id,
			storyId: summary.storyId,
			level: summary.level,
			startNodeId: summary.startNodeId,
			endNodeId: summary.endNodeId,
			text: summary.text,
			tokenCount: summary.tokenCount,
			createdAt: summary.createdAt,
		};
	}

	/** 起止节点都在 head 的路径上、且起点在终点之前的摘要才有效。 */
	isSummaryValid(summary: Summary, headNodeId: string): boolean {
		const head = this.store.getNode(headNodeId);
		if (!head) {
			throw new Error(`楼层节点不存在：${headNodeId}`);
		}
		if (head.storyId !== summary.storyId) return false;
		const path = this.store.getPathToNode(headNodeId);
		const startIndex = path.findIndex(
			(node) => node.id === summary.startNodeId,
		);
		if (startIndex === -1) return false;
		const endIndex = path.findIndex((node) => node.id === summary.endNodeId);
		return endIndex !== -1 && startIndex < endIndex;
	}

	/** 只返回在当前 head 路径上仍然有效的摘要；先章节后主线，各自从早到晚。 */
	getValidSummaries(storyId: string, headNodeId: string): Summary[] {
		assertNonEmptyString(storyId, "故事 id");
		const head = this.store.getNode(headNodeId);
		if (!head) {
			throw new Error(`楼层节点不存在：${headNodeId}`);
		}
		if (head.storyId !== storyId) {
			throw new Error(`楼层节点 ${headNodeId} 属于另一个故事 ${head.storyId}`);
		}
		const rows = this.db
			.prepare(
				`WITH RECURSIVE path(node_id, position) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, path.position + 1
					FROM path JOIN nodes ON nodes.id = path.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT s.*
				FROM summaries AS s
				JOIN path AS start ON start.node_id = s.start_node_id
				JOIN path AS end ON end.node_id = s.end_node_id
				WHERE s.story_id = ?
					AND start.position > end.position
				ORDER BY (s.level = 'chapter') DESC, end.position DESC`,
			)
			.all(headNodeId, storyId) as SummaryRow[];
		return rows.map(rowToSummary);
	}

	/**
	 * 写入一条八段式压缩。起点必须是终点的祖先，八段必须齐全且都是非空字符串；
	 * token_count 在这里按渲染后的八段正文计算。同一区间重复写入由唯一约束拒绝。
	 */
	insertChapterCompression(
		input: NewChapterCompressionInput,
	): ChapterCompression {
		const compression = this.#normaliseCompression(input);
		this.db
			.prepare(
				`INSERT INTO chapter_compressions
					(id, story_id, level, start_node_id, end_node_id, sections, token_count, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				compression.id,
				compression.storyId,
				compression.level,
				compression.startNodeId,
				compression.endNodeId,
				JSON.stringify(compression.sections),
				compression.tokenCount,
				compression.createdAt,
			);
		return compression;
	}

	/** 起止节点都在 head 的路径上、且起点在终点之前的压缩才有效。 */
	isCompressionValid(
		compression: ChapterCompression,
		headNodeId: string,
	): boolean {
		const head = this.store.getNode(headNodeId);
		if (!head) {
			throw new Error(`楼层节点不存在：${headNodeId}`);
		}
		if (head.storyId !== compression.storyId) return false;
		const path = this.store.getPathToNode(headNodeId);
		const startIndex = path.findIndex(
			(node) => node.id === compression.startNodeId,
		);
		if (startIndex === -1) return false;
		const endIndex = path.findIndex(
			(node) => node.id === compression.endNodeId,
		);
		return endIndex !== -1 && startIndex < endIndex;
	}

	/** 只返回在当前 head 路径上仍然有效的压缩；先章节后主线，各自从早到晚。 */
	getValidCompressions(
		storyId: string,
		headNodeId: string,
	): ChapterCompression[] {
		assertNonEmptyString(storyId, "故事 id");
		const head = this.store.getNode(headNodeId);
		if (!head) {
			throw new Error(`楼层节点不存在：${headNodeId}`);
		}
		if (head.storyId !== storyId) {
			throw new Error(`楼层节点 ${headNodeId} 属于另一个故事 ${head.storyId}`);
		}
		const rows = this.db
			.prepare(
				`WITH RECURSIVE path(node_id, position) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, path.position + 1
					FROM path JOIN nodes ON nodes.id = path.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT c.*
				FROM chapter_compressions AS c
				JOIN path AS start ON start.node_id = c.start_node_id
				JOIN path AS end ON end.node_id = c.end_node_id
				WHERE c.story_id = ?
					AND start.position > end.position
				ORDER BY (c.level = 'chapter') DESC, end.position DESC`,
			)
			.all(headNodeId, storyId) as ChapterCompressionRow[];
		return rows.map(rowToChapterCompression);
	}

	#normaliseCompression(input: NewChapterCompressionInput): ChapterCompression {
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error("压缩必须是对象");
		}
		assertNonEmptyString(input.storyId, "压缩的 storyId");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!isCompressionLevel(input.level)) {
			throw new Error(`压缩级别不合法：${String(input.level)}`);
		}
		assertNonEmptyString(input.startNodeId, "压缩的 startNodeId");
		assertNonEmptyString(input.endNodeId, "压缩的 endNodeId");
		const start = this.store.getNode(input.startNodeId);
		if (!start) {
			throw new Error(`压缩的起点楼层不存在：${input.startNodeId}`);
		}
		if (start.storyId !== input.storyId) {
			throw new Error(
				`压缩的起点楼层属于另一个故事 ${start.storyId}：${input.startNodeId}`,
			);
		}
		const end = this.store.getNode(input.endNodeId);
		if (!end) {
			throw new Error(`压缩的终点楼层不存在：${input.endNodeId}`);
		}
		if (end.storyId !== input.storyId) {
			throw new Error(
				`压缩的终点楼层属于另一个故事 ${end.storyId}：${input.endNodeId}`,
			);
		}
		const sections = assertCompressionSections(
			input.sections,
			"压缩的 sections",
		);
		const path = this.store.getPathToNode(input.endNodeId);
		const startIndex = path.findIndex((node) => node.id === input.startNodeId);
		if (startIndex === -1) {
			throw new Error(
				`压缩的起点必须是终点的祖先：${input.startNodeId} 不在 ${input.endNodeId} 的路径上`,
			);
		}
		if (startIndex === path.length - 1) {
			throw new Error("压缩的起点必须在终点之前");
		}
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "压缩的 id");
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "压缩的 createdAt");
		return {
			id,
			storyId: input.storyId,
			level: input.level,
			startNodeId: input.startNodeId,
			endNodeId: input.endNodeId,
			sections,
			tokenCount: estimateTokens(formatCompressionSections(sections)),
			createdAt,
		};
	}

	#normaliseSummary(input: NewSummaryInput): NormalisedSummary {
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error("摘要必须是对象");
		}
		assertNonEmptyString(input.storyId, "摘要的 storyId");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!isSummaryLevel(input.level)) {
			throw new Error(`摘要级别不合法：${String(input.level)}`);
		}
		assertNonEmptyString(input.startNodeId, "摘要的 startNodeId");
		assertNonEmptyString(input.endNodeId, "摘要的 endNodeId");
		const start = this.store.getNode(input.startNodeId);
		if (!start) {
			throw new Error(`摘要的起点楼层不存在：${input.startNodeId}`);
		}
		if (start.storyId !== input.storyId) {
			throw new Error(
				`摘要的起点楼层属于另一个故事 ${start.storyId}：${input.startNodeId}`,
			);
		}
		const end = this.store.getNode(input.endNodeId);
		if (!end) {
			throw new Error(`摘要的终点楼层不存在：${input.endNodeId}`);
		}
		if (end.storyId !== input.storyId) {
			throw new Error(
				`摘要的终点楼层属于另一个故事 ${end.storyId}：${input.endNodeId}`,
			);
		}
		if (typeof input.text !== "string") {
			throw new Error("摘要的 text 必须是字符串");
		}
		const text = input.text.trim();
		if (text.length === 0) {
			throw new Error("摘要的 text 不能是空字符串");
		}
		const path = this.store.getPathToNode(input.endNodeId);
		const startIndex = path.findIndex((node) => node.id === input.startNodeId);
		if (startIndex === -1) {
			throw new Error(
				`摘要的起点必须是终点的祖先：${input.startNodeId} 不在 ${input.endNodeId} 的路径上`,
			);
		}
		if (startIndex === path.length - 1) {
			throw new Error("摘要的起点必须在终点之前");
		}
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "摘要的 id");
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "摘要的 createdAt");
		return {
			id,
			storyId: input.storyId,
			level: input.level,
			startNodeId: input.startNodeId,
			endNodeId: input.endNodeId,
			text,
			tokenCount: estimateTokens(text),
			createdAt,
		};
	}

	#normaliseWikiRevision(
		input: NewWikiRevision,
		index: number,
	): NewWikiRevision {
		const label = `实体档案修订[${index}]`;
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error(`${label} 必须是对象`);
		}
		assertNonEmptyString(input.storyId, `${label} 的 storyId`);
		assertNonEmptyString(input.entityId, `${label} 的 entityId`);
		assertNonEmptyString(input.nodeId, `${label} 的 nodeId`);
		if (!(LEDGER_SOURCES as readonly string[]).includes(input.source)) {
			throw new Error(
				`${label} 的 source 只能是 ${LEDGER_SOURCES.join("、")}，收到 ${JSON.stringify(input.source)}`,
			);
		}
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`${label} 指向的楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`${label} 的 storyId 与楼层节点所属故事不一致：${input.storyId}`,
			);
		}
		if (typeof input.text !== "string" || input.text.trim().length === 0) {
			throw new Error(`${label} 的正文必须是非空字符串`);
		}
		return {
			storyId: input.storyId,
			entityId: input.entityId,
			nodeId: input.nodeId,
			text: input.text,
			storyTime: normaliseStoryTime(input.storyTime, label),
			source: input.source,
			...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
		};
	}
}
