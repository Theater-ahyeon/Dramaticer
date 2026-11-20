// StoryStore 的领域仓储：导演计划、节拍、桥段、事件池与 NPC 议程（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import { parseContextCondition } from "../../context/condition.js";
import type { ContextCondition } from "../../context/template.js";
import {
	type DirectorBit,
	type DirectorBitJudgments,
	type NewDirectorBitJudgmentsInput,
	type ReplaceDirectorBitsInput,
	assertDirectorBitJudgments,
	parseDirectorBitDefinitions,
} from "../../director/bits.js";
import {
	type DirectorBeatState,
	type DirectorPlan,
	type DirectorPlanEntries,
	type DirectorPlanMergeResult,
	type DirectorPlanMergeSource,
	type DirectorPlanSource,
	type NewDirectorBeatStateInput,
	type StoredDirectorArc,
	type StoredDirectorBeat,
	type StoredDirectorSequence,
	isDirectorPlanSource,
	parseDirectorPlan,
} from "../../director/plan.js";
import type {
	AdvanceNpcAgendasInput,
	EventPoolEntry,
	EventPoolUpsertResult,
	NewEventPoolEntryInput,
	NewNpcAgendaInput,
	NpcAgenda,
	NpcAgendaUpsertResult,
} from "../../director/pool.js";
import {
	type MemoryEvent,
	NPC_AGENDA_EVENT_SOURCE,
} from "../../memory/event.js";
import { serializeJsonValue } from "../json-value.js";
import { StoreRepo } from "./base.js";
import { assertNonEmptyString } from "./shared.js";

interface DirectorBitRow {
	readonly story_id: string;
	readonly bit_id: string;
	readonly payload: string;
	readonly source: string;
	readonly created_at: string;
}

interface DirectorBitJudgmentRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly fingerprint: string;
	readonly judgments: string;
	readonly created_at: string;
}

interface StoryArcRow {
	readonly story_id: string;
	readonly arc_id: string;
	readonly title: string;
	readonly through_line: string;
	readonly difficulty: number;
	readonly red_lines: string;
	readonly source: string;
	readonly ordinal: number;
	readonly created_at: string;
	readonly updated_at: string;
}

interface StorySequenceRow {
	readonly story_id: string;
	readonly sequence_id: string;
	readonly arc_id: string;
	readonly ordinal: number;
	readonly title: string;
	readonly source: string;
	readonly created_at: string;
	readonly updated_at: string;
}

interface StoryBeatRow {
	readonly story_id: string;
	readonly beat_id: string;
	readonly sequence_id: string;
	readonly ordinal: number;
	readonly goal: string;
	readonly entry_signs: string;
	readonly fit_points: string;
	readonly source: string;
	readonly created_at: string;
	readonly updated_at: string;
}

interface DirectorBeatStateRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly beat_id: string;
	readonly completed: number;
	readonly created_at: string;
}

interface EventPoolRow {
	readonly story_id: string;
	readonly source_id: string;
	readonly text: string;
	readonly preconditions: string | null;
	readonly cooldown: number;
	readonly enabled: number;
	readonly source: string;
	readonly created_at: string;
}

interface NpcAgendaRow {
	readonly story_id: string;
	readonly entity_id: string;
	readonly goal: string;
	readonly every_chapters: number;
	readonly importance: number;
	readonly progress: string;
	readonly last_advanced_node_id: string | null;
	readonly created_at: string;
	readonly updated_at: string;
}

interface NormalisedEventPoolEntry {
	readonly storyId: string;
	readonly sourceId: string;
	readonly text: string;
	readonly preconditions: ContextCondition | null;
	readonly cooldown: number;
	readonly enabled: boolean;
	readonly source: string;
	readonly createdAt: string;
}

interface NormalisedNpcAgenda {
	readonly storyId: string;
	readonly entityId: string;
	readonly goal: string;
	readonly everyChapters: number;
	readonly importance: number;
	readonly createdAt: string;
}

function rowToStoredDirectorArc(row: StoryArcRow): StoredDirectorArc {
	if (!isDirectorPlanSource(row.source)) {
		throw new Error(`弧线 ${row.arc_id} 的来源不合法：${row.source}`);
	}
	return {
		id: row.arc_id,
		title: row.title,
		throughLine: row.through_line,
		difficulty: row.difficulty,
		redLines: parseStoredStringArray(
			row.red_lines,
			`弧线 ${row.arc_id} 的 redLines`,
		),
		source: row.source,
		ordinal: row.ordinal,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToStoredDirectorSequence(
	row: StorySequenceRow,
): StoredDirectorSequence {
	if (!isDirectorPlanSource(row.source)) {
		throw new Error(`序列 ${row.sequence_id} 的来源不合法：${row.source}`);
	}
	return {
		id: row.sequence_id,
		arcId: row.arc_id,
		title: row.title,
		source: row.source,
		ordinal: row.ordinal,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToStoredDirectorBeat(row: StoryBeatRow): StoredDirectorBeat {
	if (!isDirectorPlanSource(row.source)) {
		throw new Error(`节拍 ${row.beat_id} 的来源不合法：${row.source}`);
	}
	return {
		id: row.beat_id,
		sequenceId: row.sequence_id,
		goal: row.goal,
		entrySigns: parseStoredStringArray(
			row.entry_signs,
			`节拍 ${row.beat_id} 的 entrySigns`,
		),
		fitPoints: parseStoredStringArray(
			row.fit_points,
			`节拍 ${row.beat_id} 的 fitPoints`,
		),
		source: row.source,
		ordinal: row.ordinal,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function parseStoredStringArray(value: string, label: string): string[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) {
		throw new Error(`${label} 不是字符串数组`);
	}
	return parsed.map((item, index) => {
		if (typeof item !== "string") {
			throw new Error(`${label}[${index}] 必须是字符串`);
		}
		return item;
	});
}

function rowToDirectorBeatState(row: DirectorBeatStateRow): DirectorBeatState {
	if (row.completed !== 0 && row.completed !== 1) {
		throw new Error(`楼层 ${row.node_id} 的拍状态 completed 不是 0 或 1`);
	}
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		beatId: row.beat_id,
		completed: row.completed === 1,
		createdAt: row.created_at,
	};
}

function parseStoredCondition(value: string, label: string): ContextCondition {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error(`${label}不是合法 JSON`);
	}
	return parseContextCondition(parsed, label);
}

function rowToEventPoolEntry(row: EventPoolRow): EventPoolEntry {
	return {
		storyId: row.story_id,
		sourceId: row.source_id,
		text: row.text,
		preconditions:
			row.preconditions === null
				? null
				: parseStoredCondition(
						row.preconditions,
						`事件池条目 ${row.source_id} 的 preconditions`,
					),
		cooldown: row.cooldown,
		enabled: row.enabled === 1,
		source: row.source,
		createdAt: row.created_at,
	};
}

function rowToNpcAgenda(row: NpcAgendaRow): NpcAgenda {
	return {
		storyId: row.story_id,
		entityId: row.entity_id,
		goal: row.goal,
		everyChapters: row.every_chapters,
		importance: row.importance,
		progress: row.progress,
		lastAdvancedNodeId: row.last_advanced_node_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export class DirectorPlanRepo extends StoreRepo {
	/** 读出故事的全部计划行，按各自 `ordinal` 排序；嵌套结构由调用方还原。 */
	listDirectorPlanEntries(storyId: string): DirectorPlanEntries {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const arcRows = this.db
			.prepare(
				"SELECT * FROM story_arcs WHERE story_id = ? ORDER BY ordinal ASC, arc_id ASC",
			)
			.all(storyId) as StoryArcRow[];
		const sequenceRows = this.db
			.prepare(
				"SELECT * FROM story_sequences WHERE story_id = ? ORDER BY ordinal ASC, sequence_id ASC",
			)
			.all(storyId) as StorySequenceRow[];
		const beatRows = this.db
			.prepare(
				"SELECT * FROM story_beats WHERE story_id = ? ORDER BY ordinal ASC, beat_id ASC",
			)
			.all(storyId) as StoryBeatRow[];
		return {
			arcs: arcRows.map(rowToStoredDirectorArc),
			sequences: sequenceRows.map(rowToStoredDirectorSequence),
			beats: beatRows.map(rowToStoredDirectorBeat),
		};
	}

	/** 整份替换计划；所有行标为 `source`，旧行在同一事务里删除。 */
	replaceDirectorPlan(
		storyId: string,
		plan: DirectorPlan,
		source: DirectorPlanSource = "player",
	): void {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		if (!isDirectorPlanSource(source)) {
			throw new Error(`导演计划的来源不合法：${String(source)}`);
		}
		const normalized = parseDirectorPlan(plan);
		const now = new Date().toISOString();
		const insertArc = this.db.prepare(
			`INSERT INTO story_arcs
				(story_id, arc_id, title, through_line, difficulty, red_lines, source, ordinal, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const insertSequence = this.db.prepare(
			`INSERT INTO story_sequences
				(story_id, sequence_id, arc_id, ordinal, title, source, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const insertBeat = this.db.prepare(
			`INSERT INTO story_beats
				(story_id, beat_id, sequence_id, ordinal, goal, entry_signs, fit_points, source, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		this.db.transaction(() => {
			this.db
				.prepare("DELETE FROM story_beats WHERE story_id = ?")
				.run(storyId);
			this.db
				.prepare("DELETE FROM story_sequences WHERE story_id = ?")
				.run(storyId);
			this.db.prepare("DELETE FROM story_arcs WHERE story_id = ?").run(storyId);
			normalized.arcs.forEach((arc, arcIndex) => {
				insertArc.run(
					storyId,
					arc.id,
					arc.title,
					arc.throughLine,
					arc.difficulty,
					JSON.stringify(arc.redLines),
					source,
					arcIndex,
					now,
					now,
				);
				arc.sequences.forEach((sequence, sequenceIndex) => {
					insertSequence.run(
						storyId,
						sequence.id,
						arc.id,
						sequenceIndex,
						sequence.title,
						source,
						now,
						now,
					);
					sequence.beats.forEach((beat, beatIndex) => {
						insertBeat.run(
							storyId,
							beat.id,
							sequence.id,
							beatIndex,
							beat.goal,
							JSON.stringify(beat.entrySigns),
							JSON.stringify(beat.fitPoints),
							source,
							now,
							now,
						);
					});
				});
			});
		})();
	}

	/**
	 * 后台规划器与卡导入的合并写入：按 id 更新或追加，不删除任何行，
	 * `player` 行保持原样。新行追加在各自列表末尾。
	 */
	mergeDirectorPlan(
		storyId: string,
		plan: DirectorPlan,
		source: DirectorPlanMergeSource,
	): DirectorPlanMergeResult {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		if (source !== "model" && source !== "import") {
			throw new Error(
				`合并导演计划的来源只能是 model 或 import，实际为 ${String(source)}`,
			);
		}
		const normalized = parseDirectorPlan(plan);
		const now = new Date().toISOString();
		const insertArc = this.db.prepare(
			`INSERT INTO story_arcs
				(story_id, arc_id, title, through_line, difficulty, red_lines, source, ordinal, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const updateArc = this.db.prepare(
			`UPDATE story_arcs
			SET title = ?, through_line = ?, difficulty = ?, red_lines = ?,
				source = ?, updated_at = ?
			WHERE story_id = ? AND arc_id = ?`,
		);
		const insertSequence = this.db.prepare(
			`INSERT INTO story_sequences
				(story_id, sequence_id, arc_id, ordinal, title, source, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const updateSequence = this.db.prepare(
			`UPDATE story_sequences SET title = ?, source = ?, updated_at = ?
			WHERE story_id = ? AND sequence_id = ?`,
		);
		const insertBeat = this.db.prepare(
			`INSERT INTO story_beats
				(story_id, beat_id, sequence_id, ordinal, goal, entry_signs, fit_points, source, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const updateBeat = this.db.prepare(
			`UPDATE story_beats
			SET goal = ?, entry_signs = ?, fit_points = ?, source = ?, updated_at = ?
			WHERE story_id = ? AND beat_id = ?`,
		);
		return this.db.transaction((): DirectorPlanMergeResult => {
			const arcRows = new Map<string, StoryArcRow>();
			for (const row of this.db
				.prepare("SELECT * FROM story_arcs WHERE story_id = ?")
				.all(storyId) as StoryArcRow[]) {
				arcRows.set(row.arc_id, row);
			}
			const sequenceRows = new Map<string, StorySequenceRow>();
			const nextSequenceOrdinal = new Map<string, number>();
			for (const row of this.db
				.prepare("SELECT * FROM story_sequences WHERE story_id = ?")
				.all(storyId) as StorySequenceRow[]) {
				sequenceRows.set(row.sequence_id, row);
				nextSequenceOrdinal.set(
					row.arc_id,
					Math.max(nextSequenceOrdinal.get(row.arc_id) ?? 0, row.ordinal + 1),
				);
			}
			const beatRows = new Map<string, StoryBeatRow>();
			const nextBeatOrdinal = new Map<string, number>();
			for (const row of this.db
				.prepare("SELECT * FROM story_beats WHERE story_id = ?")
				.all(storyId) as StoryBeatRow[]) {
				beatRows.set(row.beat_id, row);
				nextBeatOrdinal.set(
					row.sequence_id,
					Math.max(nextBeatOrdinal.get(row.sequence_id) ?? 0, row.ordinal + 1),
				);
			}
			let nextArcOrdinal = 0;
			for (const row of arcRows.values()) {
				nextArcOrdinal = Math.max(nextArcOrdinal, row.ordinal + 1);
			}
			let inserted = 0;
			let updated = 0;
			let skipped = 0;
			for (const arc of normalized.arcs) {
				const existingArc = arcRows.get(arc.id);
				if (existingArc === undefined) {
					insertArc.run(
						storyId,
						arc.id,
						arc.title,
						arc.throughLine,
						arc.difficulty,
						JSON.stringify(arc.redLines),
						source,
						nextArcOrdinal,
						now,
						now,
					);
					nextArcOrdinal += 1;
					inserted += 1;
					nextSequenceOrdinal.set(arc.id, 0);
				} else if (existingArc.source === "player") {
					skipped += 1;
				} else {
					updateArc.run(
						arc.title,
						arc.throughLine,
						arc.difficulty,
						JSON.stringify(arc.redLines),
						source,
						now,
						storyId,
						arc.id,
					);
					updated += 1;
				}
				for (const sequence of arc.sequences) {
					const existingSequence = sequenceRows.get(sequence.id);
					if (existingSequence === undefined) {
						const ordinal = nextSequenceOrdinal.get(arc.id) ?? 0;
						insertSequence.run(
							storyId,
							sequence.id,
							arc.id,
							ordinal,
							sequence.title,
							source,
							now,
							now,
						);
						nextSequenceOrdinal.set(arc.id, ordinal + 1);
						inserted += 1;
						nextBeatOrdinal.set(sequence.id, 0);
					} else {
						if (existingSequence.arc_id !== arc.id) {
							throw new Error(
								`序列 ${sequence.id} 已属于弧线 ${existingSequence.arc_id}，不能改挂到 ${arc.id}`,
							);
						}
						if (existingSequence.source === "player") {
							skipped += 1;
						} else {
							updateSequence.run(
								sequence.title,
								source,
								now,
								storyId,
								sequence.id,
							);
							updated += 1;
						}
					}
					for (const beat of sequence.beats) {
						const existingBeat = beatRows.get(beat.id);
						if (existingBeat === undefined) {
							const ordinal = nextBeatOrdinal.get(sequence.id) ?? 0;
							insertBeat.run(
								storyId,
								beat.id,
								sequence.id,
								ordinal,
								beat.goal,
								JSON.stringify(beat.entrySigns),
								JSON.stringify(beat.fitPoints),
								source,
								now,
								now,
							);
							nextBeatOrdinal.set(sequence.id, ordinal + 1);
							inserted += 1;
						} else {
							if (existingBeat.sequence_id !== sequence.id) {
								throw new Error(
									`节拍 ${beat.id} 已属于序列 ${existingBeat.sequence_id}，不能改挂到 ${sequence.id}`,
								);
							}
							if (existingBeat.source === "player") {
								skipped += 1;
							} else {
								updateBeat.run(
									beat.goal,
									JSON.stringify(beat.entrySigns),
									JSON.stringify(beat.fitPoints),
									source,
									now,
									storyId,
									beat.id,
								);
								updated += 1;
							}
						}
					}
				}
			}
			return { inserted, updated, skipped };
		})();
	}

	/** 读取某个楼层的拍状态；没有写过时返回 null。 */
	getDirectorBeatState(nodeId: string): DirectorBeatState | null {
		assertNonEmptyString(nodeId, "楼层节点 id");
		const node = this.store.getNode(nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM director_beat_states WHERE node_id = ?")
			.get(nodeId) as DirectorBeatStateRow | undefined;
		if (row === undefined) return null;
		if (row.story_id !== node.storyId) {
			throw new Error(`楼层 ${nodeId} 的拍状态与楼层所属故事不一致`);
		}
		return rowToDirectorBeatState(row);
	}

	/** 写入某个楼层的拍状态；同一楼层重复写入覆盖旧记录。 */
	saveDirectorBeatState(input: NewDirectorBeatStateInput): DirectorBeatState {
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error("拍状态必须是对象");
		}
		assertNonEmptyString(input.nodeId, "拍状态的 nodeId");
		assertNonEmptyString(input.storyId, "拍状态的 storyId");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`拍状态的 storyId 与楼层节点所属故事不一致：${input.storyId}`,
			);
		}
		assertNonEmptyString(input.beatId, "拍状态的 beatId");
		if (typeof input.completed !== "boolean") {
			throw new Error("拍状态的 completed 必须是布尔值");
		}
		const beat = this.db
			.prepare(
				"SELECT 1 AS found FROM story_beats WHERE story_id = ? AND beat_id = ?",
			)
			.get(input.storyId, input.beatId) as
			| { readonly found: number }
			| undefined;
		if (beat === undefined) {
			throw new Error(`节拍不存在：${input.beatId}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "拍状态的 createdAt");
		this.db
			.prepare(
				`INSERT INTO director_beat_states
					(node_id, story_id, beat_id, completed, created_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(node_id) DO UPDATE SET
					beat_id = excluded.beat_id,
					completed = excluded.completed,
					created_at = excluded.created_at`,
			)
			.run(
				input.nodeId,
				input.storyId,
				input.beatId,
				input.completed ? 1 : 0,
				createdAt,
			);
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			beatId: input.beatId,
			completed: input.completed,
			createdAt,
		};
	}

	/** 按从给定楼层到根的路径顺序返回拍状态，最近一条在前。 */
	listDirectorBeatStatesAlongPath(nodeId: string): DirectorBeatState[] {
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
				SELECT s.*
				FROM director_beat_states AS s
				JOIN path ON path.node_id = s.node_id
				ORDER BY path.depth ASC`,
			)
			.all(nodeId) as DirectorBeatStateRow[];
		return rows.map(rowToDirectorBeatState);
	}

	/**
	 * 用一次导入的小品替换故事里的全部小品。表以 `(story_id, bit_id)` 为主键，
	 * 重复导入不保留旧条目；判断缓存不在这里清理，指纹不匹配时自然失效。
	 */
	replaceDirectorBits(input: ReplaceDirectorBitsInput): number {
		assertNonEmptyString(input.storyId, "剧情小品的 storyId");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const bits = parseDirectorBitDefinitions(
			input.bits,
			`故事 ${input.storyId} 的剧情小品`,
		);
		const source = input.source ?? "card-extension";
		assertNonEmptyString(source, "剧情小品的来源");
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "剧情小品的创建时间");
		this.db.transaction(() => {
			this.db
				.prepare("DELETE FROM story_director_bits WHERE story_id = ?")
				.run(input.storyId);
			const insert = this.db.prepare(
				`INSERT INTO story_director_bits
					(story_id, bit_id, payload, source, created_at)
				VALUES (?, ?, ?, ?, ?)`,
			);
			for (const bit of bits) {
				insert.run(
					input.storyId,
					bit.id,
					serializeJsonValue(bit, `剧情小品 ${bit.id}`),
					source,
					createdAt,
				);
			}
		})();
		return bits.length;
	}

	/** 读出故事的全部剧情小品，按导入顺序；保存时已经过完整校验。 */
	listDirectorBits(storyId: string): DirectorBit[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				"SELECT * FROM story_director_bits WHERE story_id = ? ORDER BY rowid ASC",
			)
			.all(storyId) as DirectorBitRow[];
		const payloads = rows.map((row) => {
			try {
				return JSON.parse(row.payload) as unknown;
			} catch {
				throw new Error(`剧情小品 ${row.bit_id} 的 payload 不是合法 JSON`);
			}
		});
		const bits = parseDirectorBitDefinitions(
			payloads,
			`故事 ${storyId} 的剧情小品`,
		);
		return bits;
	}

	/**
	 * 写入某个楼层的自然语言条件判断；同一楼层重复执行覆盖旧结果。
	 * 条件文本变化由指纹识别，旧结果不再复用。
	 */
	saveDirectorBitJudgments(
		input: NewDirectorBitJudgmentsInput,
	): DirectorBitJudgments {
		assertNonEmptyString(input.storyId, "条件判断的 storyId");
		assertNonEmptyString(input.nodeId, "条件判断的 nodeId");
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`条件判断的 storyId 与楼层节点所属故事不一致：${input.storyId}`,
			);
		}
		assertNonEmptyString(input.fingerprint, "条件判断的指纹");
		const judgments = assertDirectorBitJudgments(
			input.judgments,
			"条件判断的 judgments",
		);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "条件判断的创建时间");
		this.db
			.prepare(
				`INSERT INTO story_director_bit_judgments
					(node_id, story_id, fingerprint, judgments, created_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(node_id) DO UPDATE SET
					fingerprint = excluded.fingerprint,
					judgments = excluded.judgments,
					created_at = excluded.created_at`,
			)
			.run(
				input.nodeId,
				input.storyId,
				input.fingerprint,
				serializeJsonValue(judgments, "条件判断的 judgments"),
				createdAt,
			);
		return {
			storyId: input.storyId,
			nodeId: input.nodeId,
			fingerprint: input.fingerprint,
			judgments,
			createdAt,
		};
	}

	/** 沿当前路径找最近一层（含自身）的自然语言条件判断；没有时返回 null。 */
	findDirectorBitJudgments(nodeId: string): DirectorBitJudgments | null {
		assertNonEmptyString(nodeId, "楼层节点 id");
		const node = this.store.getNode(nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare(
				`WITH RECURSIVE path(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, path.depth + 1
					FROM path JOIN nodes ON nodes.id = path.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT j.*
				FROM path
				JOIN story_director_bit_judgments AS j ON j.node_id = path.node_id
				ORDER BY path.depth ASC
				LIMIT 1`,
			)
			.get(nodeId) as DirectorBitJudgmentRow | undefined;
		if (row === undefined) return null;
		if (row.story_id !== node.storyId) {
			throw new Error(`楼层 ${nodeId} 的条件判断与楼层所属故事不一致`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(row.judgments);
		} catch {
			throw new Error(`楼层 ${row.node_id} 的条件判断不是合法 JSON`);
		}
		return {
			storyId: row.story_id,
			nodeId: row.node_id,
			fingerprint: row.fingerprint,
			judgments: assertDirectorBitJudgments(
				parsed,
				`楼层 ${row.node_id} 的条件判断`,
			),
			createdAt: row.created_at,
		};
	}

	/**
	 * 写入事件池。`(story_id, source_id)` 唯一：同一事件的重复导入更新正文、
	 * 条件与冷却，保留首次导入的创建时间。
	 */
	upsertEventPool(
		inputs: readonly NewEventPoolEntryInput[],
	): EventPoolUpsertResult {
		if (!Array.isArray(inputs)) {
			throw new Error("事件池必须是数组");
		}
		if (inputs.length === 0) return { inserted: 0, updated: 0 };
		const normalised = inputs.map((input, index) =>
			this.#normaliseEventPoolEntry(input, index),
		);
		const seen = new Set<string>();
		for (const entry of normalised) {
			const key = `${entry.storyId}\u0000${entry.sourceId}`;
			if (seen.has(key)) {
				throw new Error(
					`同一次写入里事件池条目的 sourceId 重复：${entry.sourceId}`,
				);
			}
			seen.add(key);
		}
		const exists = this.db.prepare(
			"SELECT 1 AS present FROM event_pool WHERE story_id = ? AND source_id = ?",
		);
		const upsert = this.db.prepare(
			`INSERT INTO event_pool
				(story_id, source_id, text, preconditions, cooldown, enabled, source, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (story_id, source_id) DO UPDATE SET
				text = excluded.text,
				preconditions = excluded.preconditions,
				cooldown = excluded.cooldown,
				enabled = excluded.enabled,
				source = excluded.source`,
		);
		const result: { inserted: number; updated: number } = {
			inserted: 0,
			updated: 0,
		};
		this.db.transaction(() => {
			for (const entry of normalised) {
				const existing =
					exists.get(entry.storyId, entry.sourceId) !== undefined;
				upsert.run(
					entry.storyId,
					entry.sourceId,
					entry.text,
					entry.preconditions === null
						? null
						: serializeJsonValue(
								entry.preconditions,
								`事件池条目 ${entry.sourceId} 的 preconditions`,
							),
					entry.cooldown,
					entry.enabled ? 1 : 0,
					entry.source,
					entry.createdAt,
				);
				if (existing) {
					result.updated += 1;
				} else {
					result.inserted += 1;
				}
			}
		})();
		return result;
	}

	/** 按导入顺序列出故事里的事件池。 */
	listEventPool(storyId: string): EventPoolEntry[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT * FROM event_pool
				WHERE story_id = ?
				ORDER BY rowid ASC`,
			)
			.all(storyId) as EventPoolRow[];
		return rows.map(rowToEventPoolEntry);
	}

	/**
	 * 写入 NPC 议程。`(story_id, entity_id)` 唯一：重复导入更新目标、章节间隔与
	 * 重要度，保留已有的进度与上次推进楼层。
	 */
	upsertNpcAgendas(
		inputs: readonly NewNpcAgendaInput[],
	): NpcAgendaUpsertResult {
		if (!Array.isArray(inputs)) {
			throw new Error("NPC 议程必须是数组");
		}
		if (inputs.length === 0) return { inserted: 0, updated: 0 };
		const normalised = inputs.map((input, index) =>
			this.#normaliseNpcAgenda(input, index),
		);
		const seen = new Set<string>();
		for (const agenda of normalised) {
			const key = `${agenda.storyId}\u0000${agenda.entityId}`;
			if (seen.has(key)) {
				throw new Error(`同一次写入里 NPC 议程的实体重复：${agenda.entityId}`);
			}
			seen.add(key);
		}
		const exists = this.db.prepare(
			"SELECT 1 AS present FROM npc_agendas WHERE story_id = ? AND entity_id = ?",
		);
		const upsert = this.db.prepare(
			`INSERT INTO npc_agendas
				(story_id, entity_id, goal, every_chapters, importance, progress, last_advanced_node_id, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, '', NULL, ?, ?)
			ON CONFLICT (story_id, entity_id) DO UPDATE SET
				goal = excluded.goal,
				every_chapters = excluded.every_chapters,
				importance = excluded.importance,
				updated_at = excluded.updated_at`,
		);
		const result: { inserted: number; updated: number } = {
			inserted: 0,
			updated: 0,
		};
		const now = new Date().toISOString();
		this.db.transaction(() => {
			for (const agenda of normalised) {
				const existing =
					exists.get(agenda.storyId, agenda.entityId) !== undefined;
				upsert.run(
					agenda.storyId,
					agenda.entityId,
					agenda.goal,
					agenda.everyChapters,
					agenda.importance,
					agenda.createdAt,
					now,
				);
				if (existing) {
					result.updated += 1;
				} else {
					result.inserted += 1;
				}
			}
		})();
		return result;
	}

	/** 按首次导入顺序列出故事里的 NPC 议程。 */
	listNpcAgendas(storyId: string): NpcAgenda[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT * FROM npc_agendas
				WHERE story_id = ?
				ORDER BY rowid ASC`,
			)
			.all(storyId) as NpcAgendaRow[];
		return rows.map(rowToNpcAgenda);
	}

	/**
	 * 在一个事务里推进多条 NPC 议程：更新进度与推进楼层，并为每条写一条
	 * “与此同时”事件。任一条非法时整批回滚。事件的 ordinal 接在该楼层已有
	 * 事件之后，避免与事件抽取写入的行冲突。
	 */
	advanceNpcAgendas(input: AdvanceNpcAgendasInput): MemoryEvent[] {
		assertNonEmptyString(input.storyId, "故事 id");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		assertNonEmptyString(input.nodeId, "楼层节点 id");
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(`楼层节点属于另一个故事：${input.nodeId}`);
		}
		if (!Array.isArray(input.advances)) {
			throw new Error("NPC 议程推进必须是数组");
		}
		if (input.advances.length === 0) return [];
		const selectAgenda = this.db.prepare(
			"SELECT * FROM npc_agendas WHERE story_id = ? AND entity_id = ?",
		);
		const seen = new Set<string>();
		const prepared: {
			readonly entityId: string;
			readonly name: string;
			readonly progress: string;
			readonly importance: number;
		}[] = [];
		input.advances.forEach((advance, index) => {
			const label = `NPC 议程推进[${index}]`;
			if (
				advance === null ||
				typeof advance !== "object" ||
				Array.isArray(advance)
			) {
				throw new Error(`${label} 必须是对象`);
			}
			assertNonEmptyString(advance.entityId, `${label} 的 entityId`);
			if (seen.has(advance.entityId)) {
				throw new Error(`${label} 的实体重复：${advance.entityId}`);
			}
			seen.add(advance.entityId);
			if (
				typeof advance.progress !== "string" ||
				advance.progress.trim().length === 0
			) {
				throw new Error(`${label} 的 progress 必须是非空字符串`);
			}
			const row = selectAgenda.get(input.storyId, advance.entityId) as
				| NpcAgendaRow
				| undefined;
			if (row === undefined) {
				throw new Error(`${label} 找不到 NPC 议程：${advance.entityId}`);
			}
			const entity = this.store.getEntity(advance.entityId);
			if (entity === null) {
				throw new Error(`${label} 对应的实体不存在：${advance.entityId}`);
			}
			prepared.push({
				entityId: advance.entityId,
				name: entity.name,
				progress: advance.progress.trim(),
				importance: row.importance,
			});
		});
		const countRow = this.db
			.prepare(
				"SELECT COUNT(*) AS count FROM memory_events WHERE source_node_id = ?",
			)
			.get(input.nodeId) as { readonly count: number };
		const ordinalBase = countRow.count;
		const update = this.db.prepare(
			`UPDATE npc_agendas
			SET progress = ?, last_advanced_node_id = ?, updated_at = ?
			WHERE story_id = ? AND entity_id = ?`,
		);
		const now = new Date().toISOString();
		let created: MemoryEvent[] = [];
		this.db.transaction(() => {
			for (const item of prepared) {
				const result = update.run(
					item.progress,
					input.nodeId,
					now,
					input.storyId,
					item.entityId,
				);
				if (result.changes !== 1) {
					throw new Error(`NPC 议程更新失败：${item.entityId}`);
				}
			}
			created = this.store.insertMemoryEvents(
				prepared.map((item, index) => ({
					storyId: input.storyId,
					sourceNodeId: input.nodeId,
					ordinal: ordinalBase + index,
					participants: [item.name],
					knowers: [item.name],
					importance: item.importance,
					text: `与此同时：${item.progress}`,
					source: NPC_AGENDA_EVENT_SOURCE,
				})),
			);
		})();
		return created;
	}

	#normaliseEventPoolEntry(
		input: NewEventPoolEntryInput,
		index: number,
	): NormalisedEventPoolEntry {
		const label = `事件池条目[${index}]`;
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error(`${label} 必须是对象`);
		}
		assertNonEmptyString(input.storyId, `${label} 的 storyId`);
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		assertNonEmptyString(input.sourceId, `${label} 的 sourceId`);
		const sourceId = input.sourceId.trim();
		if (sourceId.length === 0) {
			throw new Error(`${label} 的 sourceId 不能是空字符串`);
		}
		if (typeof input.text !== "string") {
			throw new Error(`${label} 的 text 必须是字符串`);
		}
		const text = input.text.trim();
		if (text.length === 0) {
			throw new Error(`${label} 的 text 不能是空字符串`);
		}
		const preconditions = input.preconditions ?? null;
		if (preconditions !== null) {
			parseContextCondition(preconditions, `${label} 的 preconditions`, {
				allowSwitch: false,
			});
		}
		const cooldown = input.cooldown ?? 0;
		if (
			typeof cooldown !== "number" ||
			!Number.isInteger(cooldown) ||
			cooldown < 0
		) {
			throw new Error(`${label} 的 cooldown 必须是非负整数`);
		}
		const enabled = input.enabled ?? true;
		if (typeof enabled !== "boolean") {
			throw new Error(`${label} 的 enabled 必须是布尔值`);
		}
		const source = input.source ?? "manual";
		if (typeof source !== "string" || source.trim().length === 0) {
			throw new Error(`${label} 的 source 必须是非空字符串`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, `${label} 的 createdAt`);
		return {
			storyId: input.storyId,
			sourceId,
			text,
			preconditions,
			cooldown,
			enabled,
			source: source.trim(),
			createdAt,
		};
	}

	#normaliseNpcAgenda(
		input: NewNpcAgendaInput,
		index: number,
	): NormalisedNpcAgenda {
		const label = `NPC 议程[${index}]`;
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error(`${label} 必须是对象`);
		}
		assertNonEmptyString(input.storyId, `${label} 的 storyId`);
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		assertNonEmptyString(input.entityId, `${label} 的 entityId`);
		const entity = this.store.getEntity(input.entityId);
		if (!entity) {
			throw new Error(`${label} 指向的实体不存在：${input.entityId}`);
		}
		if (entity.storyId !== input.storyId) {
			throw new Error(
				`${label} 的 storyId 与实体所属故事不一致：${input.storyId}`,
			);
		}
		if (typeof input.goal !== "string") {
			throw new Error(`${label} 的 goal 必须是字符串`);
		}
		const goal = input.goal.trim();
		if (goal.length === 0) {
			throw new Error(`${label} 的 goal 不能是空字符串`);
		}
		const everyChapters = input.everyChapters ?? 1;
		if (
			typeof everyChapters !== "number" ||
			!Number.isInteger(everyChapters) ||
			everyChapters < 1
		) {
			throw new Error(`${label} 的 everyChapters 必须是正整数`);
		}
		const importance = input.importance ?? 0.5;
		if (
			typeof importance !== "number" ||
			!Number.isFinite(importance) ||
			importance < 0 ||
			importance > 1
		) {
			throw new Error(`${label} 的 importance 必须是 0 到 1 之间的数字`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, `${label} 的 createdAt`);
		return {
			storyId: input.storyId,
			entityId: entity.id,
			goal,
			everyChapters,
			importance,
			createdAt,
		};
	}
}
