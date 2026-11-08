import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import type { StoryStore } from "../store/story-store.js";

export const DIRECTOR_PLAN_SOURCES = ["player", "model", "import"] as const;

export type DirectorPlanSource = (typeof DIRECTOR_PLAN_SOURCES)[number];

export function isDirectorPlanSource(
	value: unknown,
): value is DirectorPlanSource {
	return (
		typeof value === "string" &&
		(DIRECTOR_PLAN_SOURCES as readonly string[]).includes(value)
	);
}

/** 计划行只能由后台规划器或卡导入合并，玩家行由整份替换写入。 */
export type DirectorPlanMergeSource = Exclude<DirectorPlanSource, "player">;

export interface DirectorBeat {
	readonly id: string;
	readonly goal: string;
	/** 观众能观察到的起始迹象，至少一条。 */
	readonly entrySigns: readonly string[];
	/** 具体到人和事的契合点，至少一条。 */
	readonly fitPoints: readonly string[];
}

export interface DirectorSequence {
	readonly id: string;
	readonly title: string;
	readonly beats: readonly DirectorBeat[];
}

export interface DirectorArc {
	readonly id: string;
	readonly title: string;
	readonly throughLine: string;
	/** 0 到 1 之间，越大越难推进。 */
	readonly difficulty: number;
	readonly redLines: readonly string[];
	readonly sequences: readonly DirectorSequence[];
}

export interface DirectorPlan {
	readonly arcs: readonly DirectorArc[];
}

export interface DirectorPlanEntryBase {
	readonly source: DirectorPlanSource;
	readonly ordinal: number;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface StoredDirectorArc extends DirectorPlanEntryBase {
	readonly id: string;
	readonly title: string;
	readonly throughLine: string;
	readonly difficulty: number;
	readonly redLines: readonly string[];
}

export interface StoredDirectorSequence extends DirectorPlanEntryBase {
	readonly id: string;
	readonly arcId: string;
	readonly title: string;
}

export interface StoredDirectorBeat extends DirectorPlanEntryBase {
	readonly id: string;
	readonly sequenceId: string;
	readonly goal: string;
	readonly entrySigns: readonly string[];
	readonly fitPoints: readonly string[];
}

/** 存储层读出的计划行；调用方按 `ordinal` 还原嵌套结构。 */
export interface DirectorPlanEntries {
	readonly arcs: readonly StoredDirectorArc[];
	readonly sequences: readonly StoredDirectorSequence[];
	readonly beats: readonly StoredDirectorBeat[];
}

export interface DirectorPlanMergeResult {
	readonly inserted: number;
	readonly updated: number;
	readonly skipped: number;
}

export interface DirectorBeatState {
	readonly nodeId: string;
	readonly storyId: string;
	readonly beatId: string;
	readonly completed: boolean;
	readonly createdAt: string;
}

export interface NewDirectorBeatStateInput {
	readonly nodeId: string;
	readonly storyId: string;
	readonly beatId: string;
	readonly completed: boolean;
	readonly createdAt?: string;
}

/** 当前拍连同它所在的弧线与序列，供短线层写决策信号。 */
export interface ResolvedDirectorBeat {
	readonly arc: DirectorArc;
	readonly sequence: DirectorSequence;
	readonly beat: DirectorBeat;
}

/** 只读还原计划需要的存储方法；排障与结算各自只拿得到一部分。 */
export type DirectorPlanReader = Pick<StoryStore, "listDirectorPlanEntries">;

/** 解析当前拍需要的存储方法。 */
export type DirectorBeatResolver = DirectorPlanReader &
	Pick<StoryStore, "getNode" | "listDirectorBeatStatesAlongPath">;

const ARC_KEYS = [
	"id",
	"title",
	"throughLine",
	"difficulty",
	"redLines",
	"sequences",
];
const SEQUENCE_KEYS = ["id", "title", "beats"];
const BEAT_KEYS = ["id", "goal", "entrySigns", "fitPoints"];

/**
 * 外部写入与模型输出的唯一校验入口。未知字段、空字符串、重复 id、
 * 越界难度与空的起始迹象或契合点都抛错，并指出 JSON 路径。
 */
export function parseDirectorPlan(value: unknown, path = "plan"): DirectorPlan {
	const root = assertPlainObject(value, path);
	rejectUnknownKeys(root, ["arcs"], path);
	if (!Array.isArray(root.arcs)) {
		throw new Error(`${path}.arcs 必须是数组`);
	}
	const arcIds = new Set<string>();
	const sequenceIds = new Set<string>();
	const beatIds = new Set<string>();
	const arcs = root.arcs.map((item, index) =>
		parseArc(item, `${path}.arcs[${index}]`, arcIds, sequenceIds, beatIds),
	);
	return { arcs };
}

function parseArc(
	value: unknown,
	path: string,
	arcIds: Set<string>,
	sequenceIds: Set<string>,
	beatIds: Set<string>,
): DirectorArc {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, ARC_KEYS, path);
	const id = readUniqueId(object.id, `${path}.id`, arcIds);
	const title = readNonEmptyString(object.title, `${path}.title`);
	const throughLine = readNonEmptyString(
		object.throughLine,
		`${path}.throughLine`,
	);
	const difficulty = object.difficulty;
	if (
		typeof difficulty !== "number" ||
		!Number.isFinite(difficulty) ||
		difficulty < 0 ||
		difficulty > 1
	) {
		throw new Error(`${path}.difficulty 必须是 0 到 1 之间的数字`);
	}
	const redLines = readStringArray(object.redLines, `${path}.redLines`, true);
	if (!Array.isArray(object.sequences)) {
		throw new Error(`${path}.sequences 必须是数组`);
	}
	const sequences = object.sequences.map((item, index) =>
		parseSequence(item, `${path}.sequences[${index}]`, sequenceIds, beatIds),
	);
	return { id, title, throughLine, difficulty, redLines, sequences };
}

function parseSequence(
	value: unknown,
	path: string,
	sequenceIds: Set<string>,
	beatIds: Set<string>,
): DirectorSequence {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, SEQUENCE_KEYS, path);
	const id = readUniqueId(object.id, `${path}.id`, sequenceIds);
	const title = readNonEmptyString(object.title, `${path}.title`);
	if (!Array.isArray(object.beats)) {
		throw new Error(`${path}.beats 必须是数组`);
	}
	const beats = object.beats.map((item, index) =>
		parseBeat(item, `${path}.beats[${index}]`, beatIds),
	);
	return { id, title, beats };
}

function parseBeat(
	value: unknown,
	path: string,
	beatIds: Set<string>,
): DirectorBeat {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, BEAT_KEYS, path);
	const id = readUniqueId(object.id, `${path}.id`, beatIds);
	const goal = readNonEmptyString(object.goal, `${path}.goal`);
	const entrySigns = readStringArray(
		object.entrySigns,
		`${path}.entrySigns`,
		false,
	);
	const fitPoints = readStringArray(
		object.fitPoints,
		`${path}.fitPoints`,
		false,
	);
	return { id, goal, entrySigns, fitPoints };
}

function readUniqueId(value: unknown, path: string, seen: Set<string>): string {
	const id = readNonEmptyString(value, path);
	if (seen.has(id)) {
		throw new Error(`${path} 重复：${id}`);
	}
	seen.add(id);
	return id;
}

function readNonEmptyString(value: unknown, path: string): string {
	if (typeof value !== "string") {
		throw new Error(`${path} 必须是字符串`);
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new Error(`${path} 不能是空字符串`);
	}
	return trimmed;
}

function readStringArray(
	value: unknown,
	path: string,
	allowEmpty: boolean,
): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`${path} 必须是字符串数组`);
	}
	if (!allowEmpty && value.length === 0) {
		throw new Error(`${path} 至少要有一条`);
	}
	return value.map((item, index) =>
		readNonEmptyString(item, `${path}[${index}]`),
	);
}

/** 按弧线、序列、节拍各自的 `ordinal` 还原嵌套结构。 */
export function readDirectorPlan(
	store: DirectorPlanReader,
	storyId: string,
): DirectorPlan {
	const entries = store.listDirectorPlanEntries(storyId);
	const sequencesByArc = new Map<string, StoredDirectorSequence[]>();
	for (const sequence of entries.sequences) {
		const list = sequencesByArc.get(sequence.arcId);
		if (list === undefined) {
			sequencesByArc.set(sequence.arcId, [sequence]);
		} else {
			list.push(sequence);
		}
	}
	const beatsBySequence = new Map<string, StoredDirectorBeat[]>();
	for (const beat of entries.beats) {
		const list = beatsBySequence.get(beat.sequenceId);
		if (list === undefined) {
			beatsBySequence.set(beat.sequenceId, [beat]);
		} else {
			list.push(beat);
		}
	}
	return {
		arcs: entries.arcs.map((arc) => ({
			id: arc.id,
			title: arc.title,
			throughLine: arc.throughLine,
			difficulty: arc.difficulty,
			redLines: [...arc.redLines],
			sequences: (sequencesByArc.get(arc.id) ?? []).map((sequence) => ({
				id: sequence.id,
				title: sequence.title,
				beats: (beatsBySequence.get(sequence.id) ?? []).map((beat) => ({
					id: beat.id,
					goal: beat.goal,
					entrySigns: [...beat.entrySigns],
					fitPoints: [...beat.fitPoints],
				})),
			})),
		})),
	};
}

/** 玩家整份替换计划；所有行标为 `player`。 */
export function replaceDirectorPlan(
	store: StoryStore,
	storyId: string,
	plan: DirectorPlan,
): void {
	store.replaceDirectorPlan(storyId, parseDirectorPlan(plan), "player");
}

/**
 * 后台规划器与卡导入的写入入口：按 id 更新或追加，不删除任何行，
 * 也不覆盖来源为 `player` 的行。
 */
export function mergePlannedArcs(
	store: StoryStore,
	storyId: string,
	plan: DirectorPlan,
	source: DirectorPlanMergeSource,
): DirectorPlanMergeResult {
	if (source !== "model" && source !== "import") {
		throw new Error(
			`合并导演计划的来源只能是 model 或 import，实际为 ${source}`,
		);
	}
	return store.mergeDirectorPlan(storyId, parseDirectorPlan(plan), source);
}

/**
 * 从给定楼层沿当前路径向前找最近一条拍状态：完成时前进到下一拍，
 * 没有状态时从第一拍开始，计划耗尽返回 null。其他分支的状态不参与。
 */
export function resolveCurrentBeat(
	store: DirectorBeatResolver,
	storyId: string,
	nodeId: string,
): ResolvedDirectorBeat | null {
	const node = store.getNode(nodeId);
	if (node === null) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	if (node.storyId !== storyId) {
		throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	const plan = readDirectorPlan(store, storyId);
	const flat: ResolvedDirectorBeat[] = [];
	for (const arc of plan.arcs) {
		for (const sequence of arc.sequences) {
			for (const beat of sequence.beats) {
				flat.push({ arc, sequence, beat });
			}
		}
	}
	if (flat.length === 0) return null;
	const states = store.listDirectorBeatStatesAlongPath(nodeId);
	for (const state of states) {
		const index = flat.findIndex((entry) => entry.beat.id === state.beatId);
		if (index === -1) continue;
		if (!state.completed) return flat[index] ?? null;
		return flat[index + 1] ?? null;
	}
	return flat[0] ?? null;
}
