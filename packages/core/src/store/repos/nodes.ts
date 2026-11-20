// StoryStore 的领域仓储：楼层树、路径与 head，偏好记录（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import { randomUUID } from "node:crypto";
import {
	type CardDecisionPreferencePayload,
	type EditPreferencePayload,
	type ListPreferenceEventsOptions,
	type NewPreferenceEventInput,
	type PreferenceEvent,
	type PreferenceEventKind,
	type PreferenceEventPayload,
	type SwipePreferencePayload,
	assertPreferencePayload,
	isPreferenceEventKind,
} from "../../preferences/events.js";
import { normalizeRetrievalText } from "../../retrieval/chunk-index.js";
import { chunkText, chunkTextByParent } from "../../retrieval/chunk-text.js";
import type { TimelineNode, TimelineRole } from "../../timeline.js";
import { StoreRepo } from "./base.js";
import { assertNonEmptyString } from "./shared.js";

interface NodeRow {
	readonly id: string;
	readonly story_id: string;
	readonly parent_id: string | null;
	readonly role: string;
	readonly raw: string;
	readonly created_at: string;
}

interface PreferenceEventRow {
	readonly id: string;
	readonly story_id: string;
	readonly node_id: string;
	readonly kind: string;
	readonly payload: string;
	readonly created_at: string;
}

export interface AppendNodeInput {
	readonly id?: string;
	readonly storyId: string;
	readonly parentId: string | null;
	readonly role: TimelineRole;
	readonly raw: string;
	readonly createdAt?: string;
	/** 为 false 时只写入楼层、不移动 head；后台存下的回复版本用它。 */
	readonly moveHead?: boolean;
}

function isTimelineRole(value: unknown): value is TimelineRole {
	return value === "system" || value === "user" || value === "assistant";
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

function rowToPreferenceEvent(row: PreferenceEventRow): PreferenceEvent {
	if (!isPreferenceEventKind(row.kind)) {
		throw new Error(`偏好记录 ${row.id} 的种类不合法：${row.kind}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		nodeId: row.node_id,
		kind: row.kind,
		payload: assertPreferencePayload(
			row.kind,
			JSON.parse(row.payload) as unknown,
			`偏好记录 ${row.id} 的载荷`,
		),
		createdAt: row.created_at,
	};
}

export class NodesRepo extends StoreRepo {
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
		if (!this.store.getStory(input.storyId)) {
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
		const insertNode = this.db.prepare(
			`INSERT INTO nodes (id, story_id, parent_id, role, raw, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`,
		);
		const moveHead = this.db.prepare(
			"UPDATE stories SET head_node_id = ? WHERE id = ?",
		);
		return this.db.transaction((): TimelineNode => {
			insertNode.run(
				id,
				input.storyId,
				input.parentId,
				input.role,
				input.raw,
				createdAt,
			);
			if (input.moveHead !== false) moveHead.run(id, input.storyId);
			this.indexNodeChunks({
				id,
				storyId: input.storyId,
				raw: input.raw,
			});
			const node = this.getNode(id);
			if (!node) {
				throw new Error(`楼层节点写入后读取失败：${id}`);
			}
			return node;
		})();
	}

	getNode(id: string): TimelineNode | null {
		const row = this.db
			.prepare(
				"SELECT id, story_id, parent_id, role, raw, created_at FROM nodes WHERE id = ?",
			)
			.get(id) as NodeRow | undefined;
		return row ? rowToNode(row) : null;
	}

	/** 按创建顺序列出故事的楼层节点；用于构建分支树。 */
	listStoryNodes(storyId: string): TimelineNode[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT id, story_id, parent_id, role, raw, created_at
				FROM nodes
				WHERE story_id = ?
				ORDER BY created_at ASC, row_id ASC`,
			)
			.all(storyId) as NodeRow[];
		return rows.map(rowToNode);
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
		const row = this.db
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
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const node = this.getNode(nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		if (node.storyId !== storyId) {
			throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
		}
		this.db
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
		return this.db.transaction((): TimelineNode => {
			const node = this.#appendSibling(nodeId, raw);
			this.recordPreference({
				storyId: node.storyId,
				nodeId: node.id,
				kind: "swipe",
				payload: { abandonedNodeId: nodeId, acceptedNodeId: node.id },
				createdAt: node.createdAt,
			});
			return node;
		})();
	}

	/** 以某个楼层为参照新建一条回复版本；head 不动，玩家自己切换过去。 */
	appendReplyVariant(nodeId: string, raw: string): TimelineNode {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (typeof raw !== "string" || raw.trim().length === 0) {
			throw new Error("回复版本的原文必须是非空字符串");
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
			moveHead: false,
		});
	}

	/** 编辑某条回复：旧节点保留为兄弟节点，编辑后的内容写入新节点。 */
	editNode(nodeId: string, raw: string): TimelineNode {
		return this.db.transaction((): TimelineNode => {
			const node = this.#appendSibling(nodeId, raw);
			this.recordPreference({
				storyId: node.storyId,
				nodeId: node.id,
				kind: "edit",
				payload: { beforeNodeId: nodeId, afterNodeId: node.id },
				createdAt: node.createdAt,
			});
			return node;
		})();
	}

	/** 用户基于某个节点继续发言时，该节点即被确认；有子节点就是已确认。 */
	isNodeConfirmed(nodeId: string): boolean {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
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

	/**
	 * 追加一条偏好信号。只写本表，不进入剧情上下文、预算、检索与导演。
	 * 与对应操作放在同一个事务里，任一步失败时操作与记录一起回滚。
	 */
	recordPreference(input: NewPreferenceEventInput): PreferenceEvent {
		assertNonEmptyString(input.storyId, "偏好记录的故事 id");
		assertNonEmptyString(input.nodeId, "偏好记录的楼层 id");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!isPreferenceEventKind(input.kind)) {
			throw new Error(`偏好记录的种类不合法：${String(input.kind)}`);
		}
		const node = this.getNode(input.nodeId);
		if (!node) {
			throw new Error(`偏好记录的楼层不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`偏好记录的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const payload = assertPreferencePayload(input.kind, input.payload);
		this.#assertPreferenceReferences(
			input.kind,
			input.storyId,
			input.nodeId,
			payload,
		);
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "偏好记录 id");
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "偏好记录时间");
		this.db
			.prepare(
				`INSERT INTO preference_events (id, story_id, node_id, kind, payload, created_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				input.storyId,
				input.nodeId,
				input.kind,
				JSON.stringify(payload),
				createdAt,
			);
		return {
			id,
			storyId: input.storyId,
			nodeId: input.nodeId,
			kind: input.kind,
			payload,
			createdAt,
		};
	}

	/** 按创建顺序列出故事的偏好记录，可以按种类过滤。 */
	listPreferenceEvents(
		storyId: string,
		options: ListPreferenceEventsOptions = {},
	): PreferenceEvent[] {
		assertNonEmptyString(storyId, "偏好记录的故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const kind = options.kind;
		if (kind !== undefined && !isPreferenceEventKind(kind)) {
			throw new Error(`偏好记录的种类不合法：${String(kind)}`);
		}
		const rows =
			kind === undefined
				? (this.db
						.prepare(
							`SELECT * FROM preference_events
							WHERE story_id = ?
							ORDER BY created_at ASC, rowid ASC`,
						)
						.all(storyId) as PreferenceEventRow[])
				: (this.db
						.prepare(
							`SELECT * FROM preference_events
							WHERE story_id = ? AND kind = ?
							ORDER BY created_at ASC, rowid ASC`,
						)
						.all(storyId, kind) as PreferenceEventRow[]);
		return rows.map(rowToPreferenceEvent);
	}

	#assertPreferenceReferences(
		kind: PreferenceEventKind,
		storyId: string,
		nodeId: string,
		payload: PreferenceEventPayload,
	): void {
		if (kind === "swipe") {
			const { abandonedNodeId, acceptedNodeId } =
				payload as SwipePreferencePayload;
			if (acceptedNodeId !== nodeId) {
				throw new Error(
					`swipe 的 acceptedNodeId ${acceptedNodeId} 必须等于记录的所在楼层 ${nodeId}`,
				);
			}
			this.#assertPreferenceNodeInStory(
				abandonedNodeId,
				storyId,
				"被放弃的楼层",
			);
		} else if (kind === "edit") {
			const { beforeNodeId, afterNodeId } = payload as EditPreferencePayload;
			if (afterNodeId !== nodeId) {
				throw new Error(
					`edit 的 afterNodeId ${afterNodeId} 必须等于记录的所在楼层 ${nodeId}`,
				);
			}
			this.#assertPreferenceNodeInStory(beforeNodeId, storyId, "编辑前的楼层");
		} else if (kind === "card_decision") {
			const { cardId } = payload as CardDecisionPreferencePayload;
			const card = this.store.getLedgerChangeCard(cardId);
			if (card === null) {
				throw new Error(`变更卡不存在：${cardId}`);
			}
			if (card.storyId !== storyId) {
				throw new Error(`变更卡 ${cardId} 属于另一个故事 ${card.storyId}`);
			}
			if (card.sourceNodeId !== nodeId) {
				throw new Error(
					`card_decision 的所在楼层 ${nodeId} 必须与变更卡的来源楼层 ${card.sourceNodeId} 一致`,
				);
			}
		}
	}

	#assertPreferenceNodeInStory(
		nodeId: string,
		storyId: string,
		label: string,
	): void {
		const node = this.getNode(nodeId);
		if (!node) {
			throw new Error(`${label}不存在：${nodeId}`);
		}
		if (node.storyId !== storyId) {
			throw new Error(`${label} ${nodeId} 属于另一个故事 ${node.storyId}`);
		}
	}

	/** 统计路径上已确认（有子节点）的助手楼层数，包含给定节点自身。 */
	countConfirmedAssistantNodesOnPath(nodeId: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare(
				`WITH RECURSIVE path(node_id) AS (
					SELECT id FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id
					FROM path JOIN nodes ON nodes.id = path.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT COUNT(*) AS count
				FROM path
				JOIN nodes ON nodes.id = path.node_id
				WHERE nodes.role = 'assistant'
					AND EXISTS (
						SELECT 1 FROM nodes AS child WHERE child.parent_id = nodes.id
					)`,
			)
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	/** 把楼层的原文切成检索块并写入 FTS；已存在的块由唯一约束挡住，可重复调用。 */
	indexNodeChunks(node: {
		readonly id: string;
		readonly storyId: string;
		readonly raw: string;
	}): void {
		const insertChunk = this.db.prepare(
			`INSERT INTO chunks (story_id, node_id, ordinal, text, parent_ordinal, parent_text)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (node_id, ordinal) DO NOTHING`,
		);
		const insertText = this.db.prepare(
			`INSERT INTO chunks_fts (rowid, text, node_id, story_id)
			VALUES (?, ?, ?, ?)`,
		);
		const fragments =
			this.chunkStrategy === "parent-child"
				? chunkTextByParent(node.raw)
				: chunkText(node.raw).map((text) => ({
						parentOrdinal: null,
						parentText: null,
						text,
					}));
		for (const [ordinal, fragment] of fragments.entries()) {
			const normalized = normalizeRetrievalText(fragment.text);
			if (normalized === "") continue;
			const info = insertChunk.run(
				node.storyId,
				node.id,
				ordinal,
				fragment.text,
				fragment.parentOrdinal,
				fragment.parentText,
			);
			if (info.changes !== 1) continue;
			insertText.run(info.lastInsertRowid, normalized, node.id, node.storyId);
		}
	}
}
