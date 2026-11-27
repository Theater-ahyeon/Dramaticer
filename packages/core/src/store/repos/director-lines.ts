// StoryStore 的领域仓储：导演的剧情线、伏笔、章节复盘、候选行动与决策（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import { randomUUID } from "node:crypto";
import {
	type DirectorCandidateAction,
	type ReplaceDirectorCandidateActionsOptions,
	isDirectorCandidateKind,
} from "../../director/candidates.js";
import {
	type DirectorChapterPlanRecord,
	type DirectorChapterReview,
	type NewDirectorChapterPlanInput,
	type NewDirectorChapterReviewInput,
	assertChapterReviewMatchesLines,
	assertDirectorChapterReviewPayload,
} from "../../director/chapter.js";
import {
	type DirectorLineRecord,
	type DirectorLineState,
	type NewDirectorLineRecordInput,
	applyDirectorLineDiffs,
	assertDirectorLine,
	assertDirectorLineDiffs,
	assertPromiseBudget,
} from "../../director/lines.js";
import {
	type DirectorNoteEntry,
	type DirectorNoteRecord,
	type NewDirectorNoteInput,
	applyDirectorNoteDiffs,
	assertDirectorNoteDiffs,
} from "../../director/notes.js";
import type {
	DirectorDecision,
	DirectorMechanismRecord,
	NewDirectorDecisionInput,
} from "../../director/types.js";
import type { PlayerEdit } from "../../edits/index.js";
import { type JsonObject, isJsonObject } from "../../json.js";
import {
	type NewPlotNoteInput,
	type PlotNote,
	isPlotNoteStatus,
} from "../../memory/plot-note.js";
import { readStoryPromiseLimit } from "../../settings/features.js";
import { serializeJsonValue } from "../json-value.js";
import { StoreRepo } from "./base.js";
import { assertNonEmptyString, optionalTrimmedString } from "./shared.js";

interface DirectorNoteRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly diffs: string;
	readonly created_at: string;
}

interface DirectorLineRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly diffs: string;
	readonly created_at: string;
}

interface DirectorChapterReviewRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly payload: string;
	readonly created_at: string;
}

interface PlotNoteRow {
	readonly id: string;
	readonly story_id: string;
	readonly source_node_id: string;
	readonly text: string;
	readonly status: string;
	readonly created_at: string;
	readonly fulfilled_at: string | null;
}

interface DirectorDecisionRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly directive: string | null;
	readonly mechanisms: string;
	readonly signals: string;
	readonly created_at: string;
}

interface DirectorCandidateActionRow {
	readonly id: string;
	readonly story_id: string;
	readonly node_id: string;
	readonly ordinal: number;
	readonly kind: string;
	readonly text: string;
	readonly created_at: string;
}

interface NormalisedPlotNote {
	readonly id: string;
	readonly storyId: string;
	readonly sourceNodeId: string;
	readonly text: string;
	readonly createdAt: string;
}

interface NormalisedDirectorDecision {
	readonly nodeId: string;
	readonly storyId: string;
	readonly directive: string | null;
	readonly mechanisms: readonly DirectorMechanismRecord[];
	readonly signals: JsonObject;
	readonly createdAt: string;
}

function rowToDirectorNote(row: DirectorNoteRow): DirectorNoteRecord {
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		diffs: assertDirectorNoteDiffs(
			JSON.parse(row.diffs) as unknown,
			`楼层 ${row.node_id} 的导演手记`,
		),
		createdAt: row.created_at,
	};
}

function rowToDirectorLine(row: DirectorLineRow): DirectorLineRecord {
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		diffs: assertDirectorLineDiffs(
			JSON.parse(row.diffs) as unknown,
			`楼层 ${row.node_id} 的线修改`,
		),
		createdAt: row.created_at,
	};
}

function rowToDirectorChapterReview(
	row: DirectorChapterReviewRow,
): DirectorChapterReview {
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		payload: assertDirectorChapterReviewPayload(
			JSON.parse(row.payload) as unknown,
			`楼层 ${row.node_id} 的章末清点`,
		),
		createdAt: row.created_at,
	};
}

function rowToPlotNote(row: PlotNoteRow): PlotNote {
	if (!isPlotNoteStatus(row.status)) {
		throw new Error(`剧情笔记 ${row.id} 的状态不合法：${row.status}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		sourceNodeId: row.source_node_id,
		text: row.text,
		status: row.status,
		createdAt: row.created_at,
		fulfilledAt: row.fulfilled_at,
	};
}

function rowToDirectorDecision(row: DirectorDecisionRow): DirectorDecision {
	const mechanisms = parseStoredMechanisms(row.mechanisms, row.node_id);
	const parsedSignals: unknown = JSON.parse(row.signals);
	if (!isJsonObject(parsedSignals)) {
		throw new Error(`楼层 ${row.node_id} 的导演决策 signals 不是 JSON 对象`);
	}
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		directive: row.directive,
		mechanisms,
		signals: parsedSignals,
		createdAt: row.created_at,
	};
}

function rowToDirectorCandidateAction(
	row: DirectorCandidateActionRow,
): DirectorCandidateAction {
	if (!isDirectorCandidateKind(row.kind)) {
		throw new Error(`候选行动 ${row.id} 的 kind 不合法：${row.kind}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		nodeId: row.node_id,
		ordinal: row.ordinal,
		kind: row.kind,
		text: row.text,
		createdAt: row.created_at,
	};
}

function parseStoredMechanisms(
	value: string,
	nodeId: string,
): DirectorMechanismRecord[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) {
		throw new Error(`楼层 ${nodeId} 的导演决策 mechanisms 不是数组`);
	}
	return parsed.map((entry, index) => {
		if (!isJsonObject(entry)) {
			throw new Error(
				`楼层 ${nodeId} 的导演决策 mechanisms[${index}] 不是对象`,
			);
		}
		const { name, triggered, reason } = entry;
		if (typeof name !== "string" || name.length === 0) {
			throw new Error(
				`楼层 ${nodeId} 的导演决策 mechanisms[${index}].name 不合法`,
			);
		}
		if (typeof triggered !== "boolean") {
			throw new Error(
				`楼层 ${nodeId} 的导演决策 mechanisms[${index}].triggered 不合法`,
			);
		}
		if (typeof reason !== "string" || reason.length === 0) {
			throw new Error(
				`楼层 ${nodeId} 的导演决策 mechanisms[${index}].reason 不合法`,
			);
		}
		return { name, triggered, reason };
	});
}

export class DirectorLinesRepo extends StoreRepo {
	/** 写入一个楼层的导演手记修改；每个楼层只有一行，重复写入直接失败。 */
	saveDirectorNotes(input: NewDirectorNoteInput): DirectorNoteRecord {
		assertNonEmptyString(input.nodeId, "导演手记的楼层 id");
		assertNonEmptyString(input.storyId, "导演手记的故事 id");
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`导演手记的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const diffs = assertDirectorNoteDiffs(input.diffs, "导演手记的 diffs");
		if (diffs.length === 0) {
			throw new Error("导演手记的 diffs 至少要有一条");
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "导演手记的创建时间");
		this.db
			.prepare(
				`INSERT INTO director_notes (node_id, story_id, diffs, created_at)
				VALUES (?, ?, ?, ?)`,
			)
			.run(input.nodeId, input.storyId, JSON.stringify(diffs), createdAt);
		return { nodeId: input.nodeId, storyId: input.storyId, diffs, createdAt };
	}

	/** 读取一个楼层的手记修改；没有记录时返回 null。 */
	getDirectorNotes(nodeId: string): DirectorNoteRecord | null {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM director_notes WHERE node_id = ?")
			.get(nodeId) as DirectorNoteRow | undefined;
		return row === undefined ? null : rowToDirectorNote(row);
	}

	/**
	 * 沿节点所在的路径从根到该楼层逐楼应用手记修改：后写的楼层覆盖同名键，
	 * `delete` 移除键。其他分支的记录不参与累加。
	 */
	readDirectorNoteEntries(nodeId: string): DirectorNoteEntry[] {
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
				SELECT director_notes.*
				FROM director_notes JOIN chain ON director_notes.node_id = chain.node_id
				ORDER BY chain.depth DESC`,
			)
			.all(nodeId) as DirectorNoteRow[];
		let entries: DirectorNoteEntry[] = [];
		for (const row of rows) {
			entries = applyDirectorNoteDiffs(entries, rowToDirectorNote(row).diffs);
		}
		return entries;
	}

	/** 写入一个楼层的线修改；每个楼层只有一行，重复写入直接失败。 */
	saveDirectorLines(input: NewDirectorLineRecordInput): DirectorLineRecord {
		assertNonEmptyString(input.nodeId, "线修改的楼层 id");
		assertNonEmptyString(input.storyId, "线修改的故事 id");
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`线修改的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const diffs = assertDirectorLineDiffs(input.diffs, "线修改的 diffs");
		if (diffs.length === 0) {
			throw new Error("线修改的 diffs 至少要有一条");
		}
		const edits = this.#lineEditsOnPath(input.nodeId, input.storyId);
		for (const diff of diffs) {
			const id = diff.action === "set" ? diff.line.id : diff.id;
			if (edits.get(id)?.locked === true) {
				throw new Error(`剧情线 ${id} 已被玩家锁定，后台只能提建议`);
			}
		}
		assertPromiseBudget(
			this.readDirectorLineStates(input.nodeId),
			diffs,
			readStoryPromiseLimit(this.store, input.storyId),
		);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "线修改的创建时间");
		this.db
			.prepare(
				`INSERT INTO director_lines (node_id, story_id, diffs, created_at)
				VALUES (?, ?, ?, ?)`,
			)
			.run(input.nodeId, input.storyId, JSON.stringify(diffs), createdAt);
		return { nodeId: input.nodeId, storyId: input.storyId, diffs, createdAt };
	}

	/** 玩家撤回一条线：恢复之前导演不再选它。重复撤回只保留第一次。 */
	muteDirectorLine(
		storyId: string,
		lineId: string,
		nodeId: string | null,
	): void {
		assertNonEmptyString(storyId, "撤回剧情线的故事 id");
		assertNonEmptyString(lineId, "撤回的剧情线 id");
		if (!this.store.getStory(storyId))
			throw new Error(`故事不存在：${storyId}`);
		this.db
			.prepare(
				`INSERT OR IGNORE INTO director_muted_lines (story_id, line_id, node_id, created_at)
				VALUES (?, ?, ?, ?)`,
			)
			.run(storyId, lineId, nodeId, new Date().toISOString());
	}

	/** 恢复一条被撤回的线；返回是否真的恢复了。 */
	unmuteDirectorLine(storyId: string, lineId: string): boolean {
		return (
			this.db
				.prepare(
					"DELETE FROM director_muted_lines WHERE story_id = ? AND line_id = ?",
				)
				.run(storyId, lineId).changes > 0
		);
	}

	listMutedDirectorLines(
		storyId: string,
	): { lineId: string; nodeId: string | null; createdAt: string }[] {
		const rows = this.db
			.prepare(
				"SELECT line_id, node_id, created_at FROM director_muted_lines WHERE story_id = ? ORDER BY created_at, line_id",
			)
			.all(storyId) as {
			line_id: string;
			node_id: string | null;
			created_at: string;
		}[];
		return rows.map((row) => ({
			lineId: row.line_id,
			nodeId: row.node_id,
			createdAt: row.created_at,
		}));
	}

	/** 读取一个楼层的线修改；没有记录时返回 null。 */
	getDirectorLines(nodeId: string): DirectorLineRecord | null {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM director_lines WHERE node_id = ?")
			.get(nodeId) as DirectorLineRow | undefined;
		return row === undefined ? null : rowToDirectorLine(row);
	}

	/**
	 * 沿节点所在的路径从根到该楼层逐楼应用线修改；楼层深度是路径上
	 * 已经出现的助手楼层数，冷热据此计算。其他分支的记录不参与累加。
	 */
	readDirectorLineStates(nodeId: string): DirectorLineState[] {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const depths = new Map<string, number>();
		let depth = 0;
		for (const item of this.store.getPathToNode(nodeId)) {
			if (item.role === "assistant") depth += 1;
			depths.set(item.id, depth);
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
				SELECT director_lines.*
				FROM director_lines JOIN chain ON director_lines.node_id = chain.node_id
				ORDER BY chain.depth DESC`,
			)
			.all(nodeId) as DirectorLineRow[];
		let states: DirectorLineState[] = [];
		for (const row of rows) {
			const rowDepth = depths.get(row.node_id);
			if (rowDepth === undefined) {
				throw new Error(`线修改的楼层 ${row.node_id} 不在路径上`);
			}
			states = applyDirectorLineDiffs(
				states,
				rowToDirectorLine(row).diffs,
				rowDepth,
			);
		}
		return this.#applyLineEdits(nodeId, states, depth);
	}

	/**
	 * 玩家对剧情线的直接修改叠在规划结果上：改过的线以玩家的内容为准，
	 * 停用的线不再出现。只看当前路径上的修改，另一条分支不受影响。
	 */
	#applyLineEdits(
		nodeId: string,
		states: DirectorLineState[],
		depth: number,
	): DirectorLineState[] {
		const node = this.store.getNode(nodeId);
		if (!node) return states;
		const latest = this.#lineEditsOnPath(nodeId, node.storyId);
		if (latest.size === 0) return states;
		const map = new Map(states.map((state) => [state.line.id, state] as const));
		for (const [target, edit] of latest) {
			if (edit.disabled) {
				map.delete(target);
				continue;
			}
			if (edit.value === null) continue;
			const existing = map.get(target);
			map.set(target, {
				line: assertDirectorLine(edit.value, `剧情线 ${target} 的修改`),
				openedDepth: existing?.openedDepth ?? depth,
				lastTouchedDepth: existing?.lastTouchedDepth ?? depth,
			});
		}
		return [...map.values()].sort((left, right) =>
			left.line.id < right.line.id ? -1 : left.line.id > right.line.id ? 1 : 0,
		);
	}

	/** 当前路径上每条线最后一条生效的玩家修改；被挡下的后台写入不算。 */
	#lineEditsOnPath(nodeId: string, storyId: string): Map<string, PlayerEdit> {
		const latest = new Map<string, PlayerEdit>();
		const edits = this.store.listPlayerEdits(storyId, { kind: "line" });
		if (edits.length === 0) return latest;
		const ids = new Set(
			this.store.getPathToNode(nodeId).map((item) => item.id),
		);
		for (const edit of edits) {
			if (edit.source === "rejected") continue;
			if (edit.nodeId !== null && !ids.has(edit.nodeId)) continue;
			latest.set(edit.target, edit);
		}
		return latest;
	}

	/** 沿节点所在的路径按从旧到新的顺序读出线修改记录；其他分支不参与。 */
	listDirectorLinesAlongPath(nodeId: string): DirectorLineRecord[] {
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
				SELECT director_lines.*
				FROM director_lines JOIN chain ON director_lines.node_id = chain.node_id
				ORDER BY chain.depth DESC`,
			)
			.all(nodeId) as DirectorLineRow[];
		return rows.map(rowToDirectorLine);
	}

	/**
	 * 写入一个楼层的章末清点；记录只追加，同一楼层重复写入直接失败。
	 * 写入前逐条核对当前路径上的伏笔与聚焦的线。
	 */
	saveDirectorChapterReview(
		input: NewDirectorChapterReviewInput,
	): DirectorChapterReview {
		assertNonEmptyString(input.nodeId, "章末清点的楼层 id");
		assertNonEmptyString(input.storyId, "章末清点的故事 id");
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`章末清点的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const payload = assertDirectorChapterReviewPayload(
			input.payload,
			"章末清点的 payload",
		);
		assertChapterReviewMatchesLines(
			payload,
			this.readDirectorLineStates(input.nodeId),
			"章末清点的 payload",
		);
		if (this.getDirectorChapterReview(input.nodeId) !== null) {
			throw new Error(`楼层 ${input.nodeId} 已经有章末清点记录`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "章末清点的创建时间");
		this.db
			.prepare(
				`INSERT INTO director_chapter_reviews (node_id, story_id, payload, created_at)
				VALUES (?, ?, ?, ?)`,
			)
			.run(input.nodeId, input.storyId, JSON.stringify(payload), createdAt);
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			payload,
			createdAt,
		};
	}

	/**
	 * 章级规划一次写入章末清点与线修改；两者在同一事务里。清点先写入并
	 * 对照清点之前的线，随后应用线修改（作废的伏笔在这里删除）。同一楼层
	 * 已经有清点时直接失败，重复调用不会追加。
	 */
	saveDirectorChapterPlan(
		input: NewDirectorChapterPlanInput,
	): DirectorChapterPlanRecord {
		assertNonEmptyString(input.nodeId, "章级规划的楼层 id");
		assertNonEmptyString(input.storyId, "章级规划的故事 id");
		const diffs = assertDirectorLineDiffs(input.diffs, "章级规划的 diffs");
		const review = assertDirectorChapterReviewPayload(
			input.review,
			"章级规划的 review",
		);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "章级规划的创建时间");
		return this.db.transaction((): DirectorChapterPlanRecord => {
			if (this.getDirectorChapterReview(input.nodeId) !== null) {
				throw new Error(`楼层 ${input.nodeId} 已经有章末清点记录`);
			}
			const saved = this.saveDirectorChapterReview({
				nodeId: input.nodeId,
				storyId: input.storyId,
				payload: review,
				createdAt,
			});
			const lines =
				diffs.length === 0
					? null
					: this.saveDirectorLines({
							nodeId: input.nodeId,
							storyId: input.storyId,
							diffs,
							createdAt,
						});
			return { lines, review: saved };
		})();
	}

	/** 读取一个楼层的章末清点；没有记录时返回 null。 */
	getDirectorChapterReview(nodeId: string): DirectorChapterReview | null {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM director_chapter_reviews WHERE node_id = ?")
			.get(nodeId) as DirectorChapterReviewRow | undefined;
		return row === undefined ? null : rowToDirectorChapterReview(row);
	}

	/** 沿节点所在的路径按从旧到新的顺序读出章末清点；其他分支不参与。 */
	listDirectorChapterReviewsAlongPath(nodeId: string): DirectorChapterReview[] {
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
				SELECT director_chapter_reviews.*
				FROM director_chapter_reviews
				JOIN chain ON director_chapter_reviews.node_id = chain.node_id
				ORDER BY chain.depth DESC`,
			)
			.all(nodeId) as DirectorChapterReviewRow[];
		return rows.map(rowToDirectorChapterReview);
	}

	/** 写入一批剧情笔记；整批在一个事务里，任一条非法就全部回滚。 */
	insertPlotNotes(inputs: readonly NewPlotNoteInput[]): PlotNote[] {
		if (!Array.isArray(inputs)) {
			throw new Error("剧情笔记必须是数组");
		}
		if (inputs.length === 0) return [];
		const normalised = inputs.map((input, index) =>
			this.#normalisePlotNote(input, index),
		);
		const insert = this.db.prepare(
			`INSERT INTO plot_notes
				(id, story_id, source_node_id, text, status, created_at, fulfilled_at)
			VALUES (?, ?, ?, ?, 'open', ?, NULL)`,
		);
		const created: PlotNote[] = [];
		this.db.transaction(() => {
			for (const note of normalised) {
				insert.run(
					note.id,
					note.storyId,
					note.sourceNodeId,
					note.text,
					note.createdAt,
				);
				created.push({
					id: note.id,
					storyId: note.storyId,
					sourceNodeId: note.sourceNodeId,
					text: note.text,
					status: "open",
					createdAt: note.createdAt,
					fulfilledAt: null,
				});
			}
		})();
		return created;
	}

	/** 按创建顺序返回故事里尚未兑现的剧情笔记。 */
	getOpenPlotNotes(storyId: string): PlotNote[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT * FROM plot_notes
				WHERE story_id = ? AND status = 'open'
				ORDER BY row_id ASC`,
			)
			.all(storyId) as PlotNoteRow[];
		return rows.map(rowToPlotNote);
	}

	/** 把一条未兑现的剧情笔记标记为已兑现；已兑现的再次兑现直接抛错。 */
	fulfillPlotNote(noteId: string, at: string): PlotNote {
		assertNonEmptyString(noteId, "剧情笔记 id");
		assertNonEmptyString(at, "兑现时间");
		const row = this.db
			.prepare("SELECT * FROM plot_notes WHERE id = ?")
			.get(noteId) as PlotNoteRow | undefined;
		if (!row) {
			throw new Error(`剧情笔记不存在：${noteId}`);
		}
		const note = rowToPlotNote(row);
		if (note.status !== "open") {
			throw new Error(`剧情笔记已经兑现：${noteId}`);
		}
		this.db
			.prepare(
				"UPDATE plot_notes SET status = 'fulfilled', fulfilled_at = ? WHERE id = ?",
			)
			.run(at, noteId);
		return { ...note, status: "fulfilled", fulfilledAt: at };
	}

	/** 统计某个楼层新建的剧情笔记数；已兑现的笔记同样计入。 */
	countPlotNotesForNode(nodeId: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare(
				"SELECT COUNT(*) AS count FROM plot_notes WHERE source_node_id = ?",
			)
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	/**
	 * 整批替换某个楼层的候选行动：同一事务里删除旧行再按给定顺序写入，
	 * 重复执行不新增行。
	 */
	replaceDirectorCandidateActions(
		input: ReplaceDirectorCandidateActionsOptions,
	): DirectorCandidateAction[] {
		assertNonEmptyString(input.storyId, "候选行动的故事 id");
		assertNonEmptyString(input.nodeId, "候选行动的楼层 id");
		const node = this.store.getNode(input.nodeId);
		if (node === null) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`候选行动的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		if (!Array.isArray(input.actions) || input.actions.length === 0) {
			throw new Error("候选行动至少需要一条");
		}
		for (const action of input.actions) {
			if (!isDirectorCandidateKind(action.kind)) {
				throw new Error(`候选行动的 kind 不合法：${String(action.kind)}`);
			}
			if (typeof action.text !== "string" || action.text.trim().length === 0) {
				throw new Error("候选行动的正文必须是非空字符串");
			}
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "候选行动的创建时间");
		const insert = this.db.prepare(
			`INSERT INTO director_candidate_actions
				(id, story_id, node_id, ordinal, kind, text, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
		);
		return this.db.transaction((): DirectorCandidateAction[] => {
			this.db
				.prepare("DELETE FROM director_candidate_actions WHERE node_id = ?")
				.run(input.nodeId);
			input.actions.forEach((action, ordinal) => {
				insert.run(
					randomUUID(),
					input.storyId,
					input.nodeId,
					ordinal,
					action.kind,
					action.text.trim(),
					createdAt,
				);
			});
			return this.listDirectorCandidateActions(input.nodeId);
		})();
	}

	/** 按 `ordinal` 读出某个楼层的候选行动；没有时返回空数组。 */
	listDirectorCandidateActions(nodeId: string): DirectorCandidateAction[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.db
			.prepare(
				"SELECT * FROM director_candidate_actions WHERE node_id = ? ORDER BY ordinal ASC",
			)
			.all(nodeId) as DirectorCandidateActionRow[];
		return rows.map(rowToDirectorCandidateAction);
	}

	/**
	 * 写入某个楼层的旧版导演决策。每拍动作选择删除后运行时不再调用，
	 * 只为旧数据迁移与测试夹具保留；同一楼层重复写入会覆盖旧记录。
	 */
	saveDirectorDecision(input: NewDirectorDecisionInput): DirectorDecision {
		const normalised = this.#normaliseDirectorDecision(input);
		this.db
			.prepare(
				`INSERT INTO director_decisions
					(node_id, story_id, directive, mechanisms, signals, created_at)
				VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT(node_id) DO UPDATE SET
					directive = excluded.directive,
					mechanisms = excluded.mechanisms,
					signals = excluded.signals,
					created_at = excluded.created_at`,
			)
			.run(
				normalised.nodeId,
				normalised.storyId,
				normalised.directive,
				serializeJsonValue(normalised.mechanisms, "导演决策的 mechanisms"),
				serializeJsonValue(normalised.signals, "导演决策的 signals"),
				normalised.createdAt,
			);
		return {
			nodeId: normalised.nodeId,
			storyId: normalised.storyId,
			directive: normalised.directive,
			mechanisms: normalised.mechanisms,
			signals: normalised.signals,
			createdAt: normalised.createdAt,
		};
	}

	/** 读取某个楼层的导演决策；没有评估过时返回 null。 */
	getDirectorDecision(nodeId: string): DirectorDecision | null {
		assertNonEmptyString(nodeId, "楼层节点 id");
		const node = this.store.getNode(nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM director_decisions WHERE node_id = ?")
			.get(nodeId) as DirectorDecisionRow | undefined;
		if (row === undefined) return null;
		if (row.story_id !== node.storyId) {
			throw new Error(`楼层 ${nodeId} 的导演决策与楼层所属故事不一致`);
		}
		return rowToDirectorDecision(row);
	}

	/** 按根到给定楼层的路径顺序返回决策记录，其他分支的记录不参与。 */
	getDirectorDecisionsAlongPath(nodeId: string): DirectorDecision[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
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
				SELECT d.*
				FROM director_decisions AS d
				JOIN path ON path.node_id = d.node_id
				ORDER BY path.depth DESC`,
			)
			.all(nodeId) as DirectorDecisionRow[];
		return rows.map(rowToDirectorDecision);
	}

	#normalisePlotNote(
		input: NewPlotNoteInput,
		index: number,
	): NormalisedPlotNote {
		const label = `剧情笔记[${index}]`;
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error(`${label} 必须是对象`);
		}
		assertNonEmptyString(input.storyId, `${label} 的 storyId`);
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
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
		if (typeof input.text !== "string") {
			throw new Error(`${label} 的 text 必须是字符串`);
		}
		const text = input.text.trim();
		if (text.length === 0) {
			throw new Error(`${label} 的 text 不能是空字符串`);
		}
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, `${label} 的 id`);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, `${label} 的 createdAt`);
		return {
			id,
			storyId: input.storyId,
			sourceNodeId: input.sourceNodeId,
			text,
			createdAt,
		};
	}

	#normaliseDirectorDecision(
		input: NewDirectorDecisionInput,
	): NormalisedDirectorDecision {
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error("导演决策必须是对象");
		}
		assertNonEmptyString(input.nodeId, "导演决策的 nodeId");
		assertNonEmptyString(input.storyId, "导演决策的 storyId");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`导演决策的 storyId 与楼层节点所属故事不一致：${input.storyId}`,
			);
		}
		const directive =
			input.directive === null
				? null
				: optionalTrimmedString(input.directive, "导演决策的 directive");
		if (!Array.isArray(input.mechanisms) || input.mechanisms.length === 0) {
			throw new Error("导演决策的 mechanisms 必须是非空数组");
		}
		const mechanisms: DirectorMechanismRecord[] = [];
		for (const [index, entry] of input.mechanisms.entries()) {
			const label = `导演决策的 mechanisms[${index}]`;
			if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
				throw new Error(`${label} 必须是对象`);
			}
			if (typeof entry.name !== "string" || entry.name.trim().length === 0) {
				throw new Error(`${label}.name 必须是非空字符串`);
			}
			const name = entry.name.trim();
			if (mechanisms.some((record) => record.name === name)) {
				throw new Error(`${label}.name 重复：${name}`);
			}
			if (typeof entry.triggered !== "boolean") {
				throw new Error(`${label}.triggered 必须是布尔值`);
			}
			if (
				typeof entry.reason !== "string" ||
				entry.reason.trim().length === 0
			) {
				throw new Error(`${label}.reason 必须是非空字符串`);
			}
			const reason = entry.reason.trim();
			mechanisms.push({ name, triggered: entry.triggered, reason });
		}
		if (!isJsonObject(input.signals)) {
			throw new Error("导演决策的 signals 必须是 JSON 对象");
		}
		serializeJsonValue(input.signals, "导演决策的 signals");
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "导演决策的 createdAt");
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			directive,
			mechanisms,
			signals: input.signals,
			createdAt,
		};
	}
}
