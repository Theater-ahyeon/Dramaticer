// StoryStore 的领域仓储：开场候选（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import { randomUUID } from "node:crypto";
import { isJsonObject } from "../../json.js";
import {
	type AppendOpeningCandidatesInput,
	type ChooseOpeningCandidateResult,
	type ListOpeningCandidatesOptions,
	type OpeningCandidateRecord,
	type OpeningPackRecord,
	type SaveOpeningPackInput,
	isOpeningCandidateStatus,
} from "../settings.js";
import { StoreRepo } from "./base.js";
import { assertNonEmptyString } from "./shared.js";

interface OpeningPackRow {
	readonly story_id: string;
	readonly payload: string;
	readonly input_hash: string;
	readonly source_node_id: string | null;
	readonly created_at: string;
}

interface OpeningCandidateRow {
	readonly id: string;
	readonly story_id: string;
	readonly ordinal: number;
	readonly raw: string;
	readonly status: string;
	readonly created_at: string;
}

function rowToOpeningPack(row: OpeningPackRow): OpeningPackRecord {
	const payload = JSON.parse(row.payload) as unknown;
	if (!isJsonObject(payload)) {
		throw new Error(`故事 ${row.story_id} 的开局包内容必须是 JSON 对象`);
	}
	return {
		storyId: row.story_id,
		payload,
		inputHash: row.input_hash,
		sourceNodeId: row.source_node_id,
		createdAt: row.created_at,
	};
}

function rowToOpeningCandidate(
	row: OpeningCandidateRow,
): OpeningCandidateRecord {
	if (!isOpeningCandidateStatus(row.status)) {
		throw new Error(`开场候选 ${row.id} 的状态不合法：${row.status}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		ordinal: row.ordinal,
		raw: row.raw,
		status: row.status,
		createdAt: row.created_at,
	};
}

export class OpeningsRepo extends StoreRepo {
	/** 写入开局包；同一故事只保留一行，重复生成覆盖旧内容。 */
	saveOpeningPack(input: SaveOpeningPackInput): OpeningPackRecord {
		assertNonEmptyString(input.storyId, "开局包的故事 id");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!isJsonObject(input.payload)) {
			throw new Error("开局包的内容必须是 JSON 对象");
		}
		assertNonEmptyString(input.inputHash, "开局包的输入摘要");
		if (input.sourceNodeId !== null) {
			assertNonEmptyString(input.sourceNodeId, "开局包的来源楼层 id");
			const node = this.store.getNode(input.sourceNodeId);
			if (!node) {
				throw new Error(`楼层节点不存在：${input.sourceNodeId}`);
			}
			if (node.storyId !== input.storyId) {
				throw new Error(
					`开局包的来源楼层 ${input.sourceNodeId} 属于另一个故事`,
				);
			}
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "开局包的创建时间");
		this.db
			.prepare(
				`INSERT INTO opening_packs
					(story_id, payload, input_hash, source_node_id, created_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT (story_id) DO UPDATE SET
					payload = excluded.payload,
					input_hash = excluded.input_hash,
					source_node_id = excluded.source_node_id,
					created_at = excluded.created_at`,
			)
			.run(
				input.storyId,
				JSON.stringify(input.payload),
				input.inputHash,
				input.sourceNodeId,
				createdAt,
			);
		const saved = this.getOpeningPack(input.storyId);
		if (saved === null) {
			throw new Error(`开局包写入后读取失败：${input.storyId}`);
		}
		return saved;
	}

	/** 读取故事的开局包；没有生成过时返回 null。 */
	getOpeningPack(storyId: string): OpeningPackRecord | null {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM opening_packs WHERE story_id = ?")
			.get(storyId) as OpeningPackRow | undefined;
		return row === undefined ? null : rowToOpeningPack(row);
	}

	/**
	 * 追加一批开场候选。编号接着故事里已有的最大编号，批内按给定顺序；
	 * 已有候选的状态不变。
	 */
	appendOpeningCandidates(
		input: AppendOpeningCandidatesInput,
	): OpeningCandidateRecord[] {
		assertNonEmptyString(input.storyId, "开场候选的故事 id");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!Array.isArray(input.raws) || input.raws.length === 0) {
			throw new Error("开场候选至少需要一段正文");
		}
		for (const raw of input.raws) {
			if (typeof raw !== "string" || raw.trim().length === 0) {
				throw new Error("开场候选的正文必须是非空字符串");
			}
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "开场候选的创建时间");
		const insert = this.db.prepare(
			`INSERT INTO opening_candidates
				(id, story_id, ordinal, raw, status, created_at)
			VALUES (?, ?, ?, ?, 'pending', ?)`,
		);
		return this.db.transaction((): OpeningCandidateRecord[] => {
			const row = this.db
				.prepare(
					"SELECT COALESCE(MAX(ordinal) + 1, 0) AS next FROM opening_candidates WHERE story_id = ?",
				)
				.get(input.storyId) as { readonly next: number };
			const created: OpeningCandidateRecord[] = [];
			input.raws.forEach((raw, index) => {
				const id = randomUUID();
				insert.run(id, input.storyId, row.next + index, raw, createdAt);
				const candidate = this.getOpeningCandidate(id);
				if (candidate === null) {
					throw new Error(`开场候选写入后读取失败：${id}`);
				}
				created.push(candidate);
			});
			return created;
		})();
	}

	/** 按追加顺序列出故事的开场候选；可以只看某个状态。 */
	listOpeningCandidates(
		storyId: string,
		options: ListOpeningCandidatesOptions = {},
	): OpeningCandidateRecord[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		if (
			options.status !== undefined &&
			!isOpeningCandidateStatus(options.status)
		) {
			throw new Error(`开场候选的状态不合法：${String(options.status)}`);
		}
		const rows =
			options.status === undefined
				? (this.db
						.prepare(
							"SELECT * FROM opening_candidates WHERE story_id = ? ORDER BY ordinal ASC",
						)
						.all(storyId) as OpeningCandidateRow[])
				: (this.db
						.prepare(
							"SELECT * FROM opening_candidates WHERE story_id = ? AND status = ? ORDER BY ordinal ASC",
						)
						.all(storyId, options.status) as OpeningCandidateRow[]);
		return rows.map(rowToOpeningCandidate);
	}

	/** 读取一条开场候选；不存在时返回 null。 */
	getOpeningCandidate(id: string): OpeningCandidateRecord | null {
		assertNonEmptyString(id, "开场候选 id");
		const row = this.db
			.prepare("SELECT * FROM opening_candidates WHERE id = ?")
			.get(id) as OpeningCandidateRow | undefined;
		return row === undefined ? null : rowToOpeningCandidate(row);
	}

	/**
	 * 选中一条待选候选：把它的正文原样追加为故事根部的助手楼层并设为当前开场，
	 * 状态改为 chosen，同一故事其余待选候选改为 discarded。
	 */
	chooseOpeningCandidate(
		id: string,
		options: { readonly chosenAt?: string } = {},
	): ChooseOpeningCandidateResult {
		assertNonEmptyString(id, "开场候选 id");
		const chosenAt = options.chosenAt ?? new Date().toISOString();
		assertNonEmptyString(chosenAt, "开场候选的选中时间");
		return this.db.transaction((): ChooseOpeningCandidateResult => {
			const candidate = this.getOpeningCandidate(id);
			if (candidate === null) {
				throw new Error(`开场候选不存在：${id}`);
			}
			if (candidate.status !== "pending") {
				throw new Error(
					`开场候选 ${id} 的状态是 ${candidate.status}，只有 pending 可以选中`,
				);
			}
			// 开场白也是根部助手楼层；只要还没开玩（全是根部助手楼层），候选就能替换开场。
			const started = this.db
				.prepare(
					"SELECT id FROM nodes WHERE story_id = ? AND (parent_id IS NOT NULL OR role != 'assistant') LIMIT 1",
				)
				.get(candidate.storyId) as { id: string } | undefined;
			if (started !== undefined) {
				throw new Error(
					`故事 ${candidate.storyId} 已经有楼层 ${started.id}，开场候选只能替换开场`,
				);
			}
			const node = this.store.appendNode({
				storyId: candidate.storyId,
				parentId: null,
				role: "assistant",
				raw: candidate.raw,
				createdAt: chosenAt,
			});
			this.db
				.prepare("UPDATE opening_candidates SET status = 'chosen' WHERE id = ?")
				.run(id);
			this.db
				.prepare(
					"UPDATE opening_candidates SET status = 'discarded' WHERE story_id = ? AND status = 'pending'",
				)
				.run(candidate.storyId);
			const updated = this.getOpeningCandidate(id);
			if (updated === null) {
				throw new Error(`开场候选状态更新后读取失败：${id}`);
			}
			return { candidate: updated, node };
		})();
	}
}
