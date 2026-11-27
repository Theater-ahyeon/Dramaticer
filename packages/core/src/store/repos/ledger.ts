// StoryStore 的领域仓储：状态 diff、结算、变更卡、状态快照与玩家修改（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import {
	type NewPlayerEdit,
	type PlayerEdit,
	type PlayerEditKind,
	type PlayerEditSource,
	isPlayerEditKind,
} from "../../edits/index.js";
import { type JsonValue, isJsonObject } from "../../json.js";
import {
	LEDGER_CHANGE_CARD_SOURCES,
	LEDGER_CHANGE_CARD_STATUSES,
	type LedgerChangeCard,
	type LedgerChangeCardSource,
	type LedgerChangeCardStatus,
	type NewLedgerChangeCardInput,
	assertLedgerBeforeEntries,
	assertLedgerChangeCardDiffs,
	isLedgerChangeCardStatus,
} from "../../ledger/cards.js";
import {
	LEDGER_SOURCES,
	type LedgerSource,
	assertLedgerConfidence,
} from "../../ledger/schema.js";
import {
	type LedgerSettlement,
	type NewLedgerSettlement,
	assertLedgerRepairs,
} from "../../ledger/settlement.js";
import { applyStateDiffsTo } from "../../state.js";
import type {
	NewStateDiff,
	StateDiff,
	StateDiffOp,
	StateSnapshot,
	StoryTime,
} from "../../timeline.js";
import { serializeJsonValue } from "../json-value.js";
import { StoreRepo } from "./base.js";
import { assertNonEmptyString, normaliseStoryTime } from "./shared.js";

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
	readonly story_time_start: string | null;
	readonly story_time_end: string | null;
	readonly confidence: number | null;
	readonly created_at: string;
}

interface LedgerSettlementRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly source: string;
	readonly added_count: number;
	readonly repairs: string;
	readonly created_at: string;
}

interface LedgerChangeCardRow {
	readonly id: string;
	readonly story_id: string;
	readonly source: string;
	readonly assistant_conversation_id: string | null;
	readonly source_node_id: string;
	readonly text: string;
	readonly diffs: string;
	readonly before: string;
	readonly status: string;
	readonly rejection_reason: string | null;
	readonly created_at: string;
	readonly decided_at: string | null;
}

interface StateSnapshotRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly state: string;
	readonly computed_at: string;
}

interface NormalisedStateDiff {
	readonly storyId: string;
	readonly nodeId: string;
	readonly path: readonly string[];
	readonly op: StateDiffOp;
	readonly valueJson: string | null;
	readonly reason: string | null;
	readonly source: string;
	readonly storyTime: StoryTime | null;
	readonly confidence: number | null;
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
		storyTime:
			row.story_time_start === null && row.story_time_end === null
				? null
				: { start: row.story_time_start, end: row.story_time_end },
		confidence: row.confidence,
		createdAt: row.created_at,
	};
}

function rowToLedgerSettlement(row: LedgerSettlementRow): LedgerSettlement {
	if (!(LEDGER_SOURCES as readonly string[]).includes(row.source)) {
		throw new Error(`楼层 ${row.node_id} 的结算来源不合法：${row.source}`);
	}
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		source: row.source as LedgerSource,
		addedCount: row.added_count,
		repairs: assertLedgerRepairs(
			JSON.parse(row.repairs) as unknown,
			`楼层 ${row.node_id} 的结算记录`,
		),
		createdAt: row.created_at,
	};
}

function rowToLedgerChangeCard(row: LedgerChangeCardRow): LedgerChangeCard {
	if (!(LEDGER_CHANGE_CARD_SOURCES as readonly string[]).includes(row.source)) {
		throw new Error(`变更卡 ${row.id} 的来源不合法：${row.source}`);
	}
	if (!isLedgerChangeCardStatus(row.status)) {
		throw new Error(`变更卡 ${row.id} 的状态不合法：${row.status}`);
	}
	const diffs = assertLedgerChangeCardDiffs(
		JSON.parse(row.diffs) as unknown,
		`变更卡 ${row.id} 的 diffs`,
	);
	return {
		id: row.id,
		storyId: row.story_id,
		source: row.source as LedgerChangeCardSource,
		assistantConversationId: row.assistant_conversation_id,
		sourceNodeId: row.source_node_id,
		text: row.text,
		diffs,
		before: assertLedgerBeforeEntries(
			JSON.parse(row.before) as unknown,
			diffs,
			`变更卡 ${row.id} 的 before`,
		),
		status: row.status,
		rejectionReason: row.rejection_reason,
		createdAt: row.created_at,
		decidedAt: row.decided_at,
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

export class LedgerRepo extends StoreRepo {
	appendStateDiff(input: NewStateDiff): StateDiff {
		const [stored] = this.appendStateDiffs([input]);
		if (!stored) {
			throw new Error("状态 diff 写入失败");
		}
		return stored;
	}

	appendStateDiffs(rawInputs: readonly NewStateDiff[]): StateDiff[] {
		if (!Array.isArray(rawInputs)) {
			throw new Error("状态 diff 必须是数组");
		}
		const inputs = this.#dropLockedStateDiffs(rawInputs);
		if (inputs.length === 0) {
			return [];
		}
		const normalised = inputs.map((input, index) =>
			this.#normaliseStateDiff(input, index),
		);
		const createdAt = new Date().toISOString();
		const insert = this.db.prepare(
			`INSERT INTO state_diffs (story_id, node_id, ordinal, path, op, value, reason, source, story_time_start, story_time_end, confidence, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const nextOrdinal = this.db.prepare(
			"SELECT COALESCE(MAX(ordinal), -1) + 1 AS next_ordinal FROM state_diffs WHERE node_id = ?",
		);
		// 写入新的 diff 后，该楼层及其全部后代的快照都已过期。
		const invalidateSnapshots = this.db.prepare(
			`WITH RECURSIVE affected(node_id) AS (
				SELECT id FROM nodes WHERE id = ?
				UNION ALL
				SELECT nodes.id FROM nodes JOIN affected ON nodes.parent_id = affected.node_id
			)
			DELETE FROM state_snapshots WHERE node_id IN (SELECT node_id FROM affected)`,
		);
		const run = this.db.transaction(
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
						diff.storyTime?.start ?? null,
						diff.storyTime?.end ?? null,
						diff.confidence,
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
						storyTime: diff.storyTime,
						confidence: diff.confidence,
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
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.db
			.prepare(
				"SELECT * FROM state_diffs WHERE node_id = ? ORDER BY ordinal ASC",
			)
			.all(nodeId) as StateDiffRow[];
		return rows.map(rowToStateDiff);
	}

	/**
	 * 删除某个楼层上的状态 diff；结算器替换不合格条目时使用。
	 * 传入不属于该楼层的 id 时整次抛错，不删除任何行。
	 */
	deleteStateDiffs(nodeId: string, ids: readonly number[]): number {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		if (!Array.isArray(ids)) {
			throw new Error("要删除的状态 diff id 必须是数组");
		}
		if (ids.length === 0) return 0;
		for (const id of ids) {
			if (!Number.isInteger(id) || id < 1) {
				throw new Error(`状态 diff id 必须是正整数：${String(id)}`);
			}
		}
		const remove = this.db.prepare(
			"DELETE FROM state_diffs WHERE id = ? AND node_id = ?",
		);
		const invalidateSnapshots = this.db.prepare(
			`WITH RECURSIVE affected(node_id) AS (
				SELECT id FROM nodes WHERE id = ?
				UNION ALL
				SELECT nodes.id FROM nodes JOIN affected ON nodes.parent_id = affected.node_id
			)
			DELETE FROM state_snapshots WHERE node_id IN (SELECT node_id FROM affected)`,
		);
		return this.db.transaction((): number => {
			for (const id of ids) {
				const info = remove.run(id, nodeId);
				if (info.changes !== 1) {
					throw new Error(`楼层 ${nodeId} 没有 id 为 ${id} 的状态 diff`);
				}
			}
			invalidateSnapshots.run(nodeId);
			return ids.length;
		})();
	}

	/** 按路径顺序（根在前）累加所需的全部状态 diff。 */
	getStateDiffsAlongPath(nodeId: string): StateDiff[] {
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
				SELECT state_diffs.*
				FROM state_diffs JOIN chain ON state_diffs.node_id = chain.node_id
				ORDER BY chain.depth DESC, state_diffs.ordinal ASC`,
			)
			.all(nodeId) as StateDiffRow[];
		return rows.map(rowToStateDiff);
	}

	/** 统计路径上的 diff 条数，不读取 diff 内容。 */
	countStateDiffsAlongPath(nodeId: string): number {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
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

	/** 记录一个楼层的结算结果；同一楼层只允许结算一次。 */
	recordLedgerSettlement(input: NewLedgerSettlement): LedgerSettlement {
		assertNonEmptyString(input.nodeId, "结算记录的楼层 id");
		assertNonEmptyString(input.storyId, "结算记录的故事 id");
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`结算记录的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		if (!(LEDGER_SOURCES as readonly string[]).includes(input.source)) {
			throw new Error(
				`结算记录的来源只能是 ${LEDGER_SOURCES.join("、")}，收到 ${JSON.stringify(input.source)}`,
			);
		}
		if (!Number.isInteger(input.addedCount) || input.addedCount < 0) {
			throw new Error("结算记录的新增条数必须是非负整数");
		}
		const repairs = assertLedgerRepairs(input.repairs, `楼层 ${input.nodeId}`);
		if (this.getLedgerSettlement(input.nodeId) !== null) {
			throw new Error(`楼层 ${input.nodeId} 已经结算过`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "结算记录的创建时间");
		this.db
			.prepare(
				`INSERT INTO ledger_settlements
					(node_id, story_id, source, added_count, repairs, created_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.nodeId,
				input.storyId,
				input.source,
				input.addedCount,
				JSON.stringify(repairs),
				createdAt,
			);
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			source: input.source,
			addedCount: input.addedCount,
			repairs,
			createdAt,
		};
	}

	/** 读取某个楼层的结算结果；没有结算过时返回 null。 */
	getLedgerSettlement(nodeId: string): LedgerSettlement | null {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM ledger_settlements WHERE node_id = ?")
			.get(nodeId) as LedgerSettlementRow | undefined;
		return row === undefined ? null : rowToLedgerSettlement(row);
	}

	/** 按创建顺序列出故事的结算记录。 */
	listLedgerSettlements(storyId: string): LedgerSettlement[] {
		assertNonEmptyString(storyId, "结算记录的故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT * FROM ledger_settlements
				WHERE story_id = ?
				ORDER BY created_at ASC, node_id ASC`,
			)
			.all(storyId) as LedgerSettlementRow[];
		return rows.map(rowToLedgerSettlement);
	}

	/**
	 * 沿当前路径取最多 limit 个已落定、尚未结算的助手楼层，按从旧到新排列。
	 * 已落定指正文生成完成；中止保存的部分正文不算。
	 */
	listUnsettledSettledAssistantNodes(storyId: string, limit: number): string[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		if (!Number.isInteger(limit) || limit < 1) {
			throw new Error("结算窗口的楼层数必须是正整数");
		}
		const head = this.store.getHead(storyId);
		if (head === null) return [];
		const rows = this.db
			.prepare(
				`WITH RECURSIVE chain(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, chain.depth + 1
					FROM nodes JOIN chain ON nodes.id = chain.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT nodes.id AS node_id
				FROM nodes
				JOIN chain ON nodes.id = chain.node_id
				LEFT JOIN traces ON traces.node_id = nodes.id
				WHERE nodes.role = 'assistant'
					AND COALESCE(json_extract(traces.trace, '$.llm.stopReason'), '') <> 'aborted'
					AND COALESCE(json_extract(traces.trace, '$.profile'), 'native') <> 'naive'
					AND NOT EXISTS (
						SELECT 1 FROM ledger_settlements
						WHERE ledger_settlements.node_id = nodes.id
					)
				ORDER BY chain.depth DESC
				LIMIT ?`,
			)
			.all(head.id, limit) as { readonly node_id: string }[];
		return rows.map((row) => row.node_id);
	}

	/** 写入一张变更卡；同一 id 只能写一次。 */
	insertLedgerChangeCard(input: NewLedgerChangeCardInput): LedgerChangeCard {
		assertNonEmptyString(input.id, "变更卡 id");
		assertNonEmptyString(input.storyId, "变更卡的故事 id");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (
			!(LEDGER_CHANGE_CARD_SOURCES as readonly string[]).includes(input.source)
		) {
			throw new Error(
				`变更卡的来源只能是 ${LEDGER_CHANGE_CARD_SOURCES.join("、")}，收到 ${JSON.stringify(input.source)}`,
			);
		}
		const assistantConversationId = input.assistantConversationId ?? null;
		if (input.source === "assistant") {
			if (assistantConversationId === null) {
				throw new Error("助手生成的变更卡必须写明 assistantConversationId");
			}
			const conversation = this.store.getAssistantConversation(
				assistantConversationId,
			);
			if (conversation === null) {
				throw new Error(`助手会话不存在：${assistantConversationId}`);
			}
			if (
				conversation.storyId !== null &&
				conversation.storyId !== input.storyId
			) {
				throw new Error(
					`变更卡的 storyId 与会话所属故事不一致：${input.storyId}`,
				);
			}
		} else if (assistantConversationId !== null) {
			throw new Error("只有助手生成的变更卡可以带 assistantConversationId");
		}
		const node = this.store.getNode(input.sourceNodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.sourceNodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`变更卡的 storyId 与来源楼层所属故事不一致：${input.storyId}`,
			);
		}
		if (typeof input.text !== "string" || input.text.trim().length === 0) {
			throw new Error("变更卡的说明必须是非空字符串");
		}
		if (!isLedgerChangeCardStatus(input.status)) {
			throw new Error(
				`变更卡的状态只能是 ${LEDGER_CHANGE_CARD_STATUSES.join("、")}，收到 ${String(input.status)}`,
			);
		}
		const diffs = assertLedgerChangeCardDiffs(
			input.diffs,
			`变更卡 ${input.id}`,
		);
		if (diffs.length === 0 && input.status !== "rejected") {
			throw new Error(`变更卡 ${input.id} 没有修改内容`);
		}
		const before = assertLedgerBeforeEntries(
			input.before,
			diffs,
			`变更卡 ${input.id} 的 before`,
		);
		const rejectionReason = input.rejectionReason ?? null;
		if (input.status === "rejected") {
			if (rejectionReason === null || rejectionReason.trim().length === 0) {
				throw new Error("被拒绝的变更卡必须写明原因");
			}
		} else if (rejectionReason !== null) {
			throw new Error("只有被拒绝的变更卡可以带拒绝原因");
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "变更卡的创建时间");
		const decidedAt = input.decidedAt ?? null;
		if (input.status === "pending") {
			if (decidedAt !== null) {
				throw new Error("待定变更卡不能有决定时间");
			}
		} else if (decidedAt === null) {
			throw new Error("已决定的变更卡必须有决定时间");
		}
		if (this.getLedgerChangeCard(input.id) !== null) {
			throw new Error(`变更卡已存在：${input.id}`);
		}
		this.db
			.prepare(
				`INSERT INTO ledger_change_cards
					(id, story_id, source, assistant_conversation_id, source_node_id, text, diffs, before, status, rejection_reason, created_at, decided_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.id,
				input.storyId,
				input.source,
				assistantConversationId,
				input.sourceNodeId,
				input.text,
				JSON.stringify(diffs),
				JSON.stringify(before),
				input.status,
				rejectionReason,
				createdAt,
				decidedAt,
			);
		const card = this.getLedgerChangeCard(input.id);
		if (card === null) {
			throw new Error(`变更卡 ${input.id} 写入后读取失败`);
		}
		return card;
	}

	/** 读取一张变更卡；不存在时返回 null。 */
	getLedgerChangeCard(cardId: string): LedgerChangeCard | null {
		assertNonEmptyString(cardId, "变更卡 id");
		const row = this.db
			.prepare("SELECT * FROM ledger_change_cards WHERE id = ?")
			.get(cardId) as LedgerChangeCardRow | undefined;
		return row === undefined ? null : rowToLedgerChangeCard(row);
	}

	/** 按创建顺序列出故事的变更卡，可以按状态过滤。 */
	listLedgerChangeCards(
		storyId: string,
		options: { readonly status?: LedgerChangeCardStatus } = {},
	): LedgerChangeCard[] {
		assertNonEmptyString(storyId, "变更卡的故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const status = options.status;
		if (status !== undefined && !isLedgerChangeCardStatus(status)) {
			throw new Error(
				`变更卡的状态只能是 ${LEDGER_CHANGE_CARD_STATUSES.join("、")}，收到 ${String(status)}`,
			);
		}
		const rows =
			status === undefined
				? (this.db
						.prepare(
							`SELECT * FROM ledger_change_cards
							WHERE story_id = ?
							ORDER BY created_at ASC, id ASC`,
						)
						.all(storyId) as LedgerChangeCardRow[])
				: (this.db
						.prepare(
							`SELECT * FROM ledger_change_cards
							WHERE story_id = ? AND status = ?
							ORDER BY created_at ASC, id ASC`,
						)
						.all(storyId, status) as LedgerChangeCardRow[]);
		return rows.map(rowToLedgerChangeCard);
	}

	/** 更新变更卡的状态与决定时间；卡片不能退回待定。 */
	updateLedgerChangeCardStatus(
		cardId: string,
		status: LedgerChangeCardStatus,
		decidedAt: string,
	): LedgerChangeCard {
		assertNonEmptyString(cardId, "变更卡 id");
		if (!isLedgerChangeCardStatus(status)) {
			throw new Error(
				`变更卡的状态只能是 ${LEDGER_CHANGE_CARD_STATUSES.join("、")}，收到 ${String(status)}`,
			);
		}
		if (status === "pending") {
			throw new Error("变更卡不能退回待定状态");
		}
		assertNonEmptyString(decidedAt, "变更卡的决定时间");
		return this.db.transaction((): LedgerChangeCard => {
			const existing = this.getLedgerChangeCard(cardId);
			if (existing === null) {
				throw new Error(`变更卡不存在：${cardId}`);
			}
			const info = this.db
				.prepare(
					"UPDATE ledger_change_cards SET status = ?, decided_at = ? WHERE id = ?",
				)
				.run(status, decidedAt, cardId);
			if (info.changes !== 1) {
				throw new Error(`变更卡不存在：${cardId}`);
			}
			if (status === "approved" || status === "rejected") {
				this.store.recordPreference({
					storyId: existing.storyId,
					nodeId: existing.sourceNodeId,
					kind: "card_decision",
					payload: { cardId, decision: status },
					createdAt: decidedAt,
				});
			}
			const card = this.getLedgerChangeCard(cardId);
			if (card === null) {
				throw new Error(`变更卡 ${cardId} 更新后读取失败`);
			}
			return card;
		})();
	}

	/** 追加一条玩家修改；这张表没有更新与删除接口。 */
	savePlayerEdit(input: NewPlayerEdit): PlayerEdit {
		assertNonEmptyString(input.storyId, "修改的故事 id");
		assertNonEmptyString(input.target, "修改的对象");
		if (!isPlayerEditKind(input.kind)) {
			throw new Error(`修改的种类不合法：${String(input.kind)}`);
		}
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const nodeId = input.nodeId ?? null;
		if (
			nodeId !== null &&
			this.store.getNode(nodeId)?.storyId !== input.storyId
		) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const value = input.value ?? null;
		const createdAt = new Date().toISOString();
		const source = input.source ?? "player";
		const result = this.db
			.prepare(
				`INSERT INTO player_edits (story_id, node_id, kind, target, value, locked, disabled, source, note, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.storyId,
				nodeId,
				input.kind,
				input.target,
				value === null ? null : JSON.stringify(value),
				input.locked === true ? 1 : 0,
				input.disabled === true ? 1 : 0,
				source,
				input.note ?? null,
				createdAt,
			);
		return {
			id: Number(result.lastInsertRowid),
			storyId: input.storyId,
			nodeId,
			kind: input.kind,
			target: input.target,
			value,
			locked: input.locked === true,
			disabled: input.disabled === true,
			source,
			note: input.note ?? null,
			createdAt,
		};
	}

	/** 故事里的全部修改，按写入顺序；可以按种类与对象过滤。 */
	listPlayerEdits(
		storyId: string,
		filter: { kind?: PlayerEditKind; target?: string } = {},
	): PlayerEdit[] {
		const where = ["story_id = ?"];
		const args: string[] = [storyId];
		if (filter.kind !== undefined) {
			where.push("kind = ?");
			args.push(filter.kind);
		}
		if (filter.target !== undefined) {
			where.push("target = ?");
			args.push(filter.target);
		}
		const rows = this.db
			.prepare(
				`SELECT * FROM player_edits WHERE ${where.join(" AND ")} ORDER BY id`,
			)
			.all(...args) as {
			id: number;
			story_id: string;
			node_id: string | null;
			kind: string;
			target: string;
			value: string | null;
			locked: number;
			disabled: number;
			source: string;
			note: string | null;
			created_at: string;
		}[];
		return rows.map((row) => ({
			id: row.id,
			storyId: row.story_id,
			nodeId: row.node_id,
			kind: row.kind as PlayerEditKind,
			target: row.target,
			value: row.value === null ? null : (JSON.parse(row.value) as JsonValue),
			locked: row.locked === 1,
			disabled: row.disabled === 1,
			source: row.source as PlayerEditSource,
			note: row.note,
			createdAt: row.created_at,
		}));
	}

	/**
	 * 后台写向玩家锁定的状态路径时丢弃这一条并留痕；玩家自己的写入不受限。
	 * 锁定按写入楼层所在的路径判断，另一条分支上的锁不生效。
	 */
	#dropLockedStateDiffs(inputs: readonly NewStateDiff[]): NewStateDiff[] {
		const first = inputs[0];
		if (
			first === undefined ||
			inputs.every((item) => item.source === "player")
		) {
			return [...inputs];
		}
		const rows = this.db
			.prepare(
				"SELECT node_id, target, locked, source FROM player_edits WHERE story_id = ? AND kind = 'state' ORDER BY id",
			)
			.all(first.storyId) as {
			node_id: string | null;
			target: string;
			locked: number;
			source: string;
		}[];
		if (rows.length === 0) return [...inputs];
		const paths = new Map<string, Set<string>>();
		const kept: NewStateDiff[] = [];
		for (const input of inputs) {
			if (input.source === "player") {
				kept.push(input);
				continue;
			}
			let ids = paths.get(input.nodeId);
			if (ids === undefined) {
				ids = new Set(
					this.store.getPathToNode(input.nodeId).map((node) => node.id),
				);
				paths.set(input.nodeId, ids);
			}
			const target = JSON.stringify(input.path);
			let locked = false;
			for (const row of rows) {
				if (row.target !== target || row.source === "rejected") continue;
				if (row.node_id !== null && !ids.has(row.node_id)) continue;
				locked = row.locked === 1;
			}
			if (!locked) {
				kept.push(input);
				continue;
			}
			this.store.recordMemoryRejection({
				storyId: input.storyId,
				nodeId: input.nodeId,
				kind: "state",
				text: `${input.path.join(".")} ← ${input.op === "set" ? JSON.stringify(input.value) : "删除"}`,
				reason: `与玩家锁定的事实冲突，${input.source} 的写入没有生效`,
			});
		}
		return kept;
	}

	/**
	 * 读取某个楼层末端的累计状态。缓存未命中时从父楼层的快照叠加
	 * 本楼层的 diff 计算，并把结果写入缓存；从根节点开始的路径只计算一次。
	 */
	getStateSnapshot(nodeId: string): StateSnapshot {
		const node = this.store.getNode(nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const cached = this.db
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
		this.db
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
		const head = this.store.getHead(storyId);
		return head === null ? null : this.getStateSnapshot(head.id);
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
		const node = this.store.getNode(input.nodeId);
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
			storyTime: normaliseStoryTime(input.storyTime, label),
			confidence: assertLedgerConfidence(
				input.confidence,
				`${label} 的 confidence`,
			),
		};
	}
}
