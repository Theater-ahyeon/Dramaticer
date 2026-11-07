import { isDeepStrictEqual } from "node:util";
import {
	type JsonObject,
	type JsonValue,
	isJsonObject,
} from "@dramaticer/core";
import type { StChatEntry } from "../chat-jsonl.js";
import { parseChatJsonlFile } from "../chat-jsonl.js";
import {
	currentSwipeIndex,
	messageNodeId,
	parseMessageIndex,
	swipeNodeId,
} from "../node-id.js";
import { readSnapshot } from "../state-diff.js";
import { requireNonEmpty } from "./shared.js";

export type StateAnswer = string | number | boolean;

/** 生成的一条状态题。path 是完整状态路径，question 里的路径去掉了顶层的 stat_data。 */
export interface StateQuestion {
	readonly id: string;
	readonly story: string;
	readonly askAtNode: string;
	readonly question: string;
	readonly answer: StateAnswer;
	readonly evidenceNodes: readonly string[];
	readonly kind: "state";
	readonly path: readonly string[];
}

export interface StateQuestionOptions {
	readonly storyId: string;
	/** 楼层 id 的前缀，默认等于 storyId，与导入器保持一致。 */
	readonly idPrefix?: string;
	/** 提问楼层与证据楼层的最小间隔，默认 30。 */
	readonly minGap?: number;
	readonly minQuestions?: number;
	readonly maxQuestions?: number;
	/** 变化次数超过这个值的变量视为每楼都在变，默认 10。 */
	readonly maxChanges?: number;
	/** 完整状态路径（包含 stat_data）的最大段数，默认 5。 */
	readonly maxPathDepth?: number;
	/** 答案序列化后的最大长度，默认 80。 */
	readonly maxAnswerLength?: number;
	/** 每条路径最多出多少题；缺省时按题目下限平均分配。 */
	readonly maxPerPath?: number;
	/** 允许一个故事出 0 道题（新语料里楼层太短时使用）。 */
	readonly allowEmpty?: boolean;
}

export interface StateQuestionStats {
	readonly story: string;
	readonly messageCount: number;
	readonly updateCount: number;
	readonly pathCount: number;
	readonly candidateCount: number;
	readonly questionCount: number;
	readonly minGap: number;
	readonly maxGap: number;
}

export interface StateQuestionBuildResult {
	readonly questions: readonly StateQuestion[];
	readonly stats: StateQuestionStats;
}

export interface StateQuestionFailure {
	readonly id: string;
	readonly reason: string;
}

export interface StateQuestionVerification {
	readonly checked: number;
	readonly failures: readonly StateQuestionFailure[];
}

interface PathChange {
	readonly index: number;
	/** undefined 表示这个变量在该楼层被删除。 */
	readonly value: JsonValue | undefined;
}

interface TrackedPath {
	readonly parts: readonly string[];
	readonly changes: PathChange[];
}

interface FlatValue {
	readonly parts: readonly string[];
	readonly serialized: string;
	readonly value: JsonValue;
}

interface FloorState {
	readonly messageCount: number;
	readonly updateCount: number;
	readonly lastIndex: number;
	readonly floors: readonly (JsonObject | null)[];
	readonly swipes: readonly number[];
	readonly paths: Map<string, TrackedPath>;
}

interface Candidate {
	readonly parts: readonly string[];
	readonly pathKey: string;
	readonly startIndex: number;
	readonly askIndex: number;
	readonly value: StateAnswer;
	readonly changeCount: number;
	readonly gap: number;
}

interface ResolvedOptions {
	readonly storyId: string;
	readonly idPrefix: string;
	readonly minGap: number;
	readonly minQuestions: number;
	readonly maxQuestions: number;
	readonly maxChanges: number;
	readonly maxPathDepth: number;
	readonly maxAnswerLength: number;
	readonly maxPerPath: number | null;
	readonly allowEmpty: boolean;
}

const EXCLUDED_ROOTS: Readonly<Record<string, true>> = {
	initialized_lorebooks: true,
	schema: true,
	display_data: true,
	delta_data: true,
};

/**
 * 从聊天记录里按规则生成状态题：在第 Y 楼问“第 X 楼之后某变量的值是什么”，
 * 答案取稳定区间内的快照值，证据是第 X 楼。
 *
 * 只保留 Y − X ≥ minGap、变量变化次数不超过 maxChanges 的候选题。
 */
export async function buildStateQuestions(
	entries: AsyncIterable<StChatEntry> | Iterable<StChatEntry>,
	options: StateQuestionOptions,
): Promise<StateQuestionBuildResult> {
	const resolved = resolveOptions(options);
	const state = await collectFloorState(entries);
	if (state.messageCount === 0) {
		throw new Error("聊天记录只有头部，没有楼层");
	}
	const candidates = buildCandidates(state, resolved);
	const selected = selectCandidates(candidates, resolved);
	if (selected.length === 0 && resolved.allowEmpty) {
		return {
			questions: [],
			stats: {
				story: resolved.storyId,
				messageCount: state.messageCount,
				updateCount: state.updateCount,
				pathCount: state.paths.size,
				candidateCount: candidates.length,
				questionCount: 0,
				minGap: 0,
				maxGap: 0,
			},
		};
	}
	if (selected.length < resolved.minQuestions) {
		if (candidates.length === 0) {
			throw new Error(`故事 ${resolved.storyId} 没有满足间隔要求的状态题候选`);
		}
		throw new Error(
			`故事 ${resolved.storyId} 只能生成 ${selected.length} 道状态题，低于下限 ${resolved.minQuestions}`,
		);
	}

	const questions = selected.map((candidate) =>
		toQuestion(candidate, state, resolved),
	);
	const gaps = selected.map((candidate) => candidate.gap);
	return {
		questions,
		stats: {
			story: resolved.storyId,
			messageCount: state.messageCount,
			updateCount: state.updateCount,
			pathCount: state.paths.size,
			candidateCount: candidates.length,
			questionCount: questions.length,
			minGap: gaps.length === 0 ? 0 : Math.min(...gaps),
			maxGap: gaps.length === 0 ? 0 : Math.max(...gaps),
		},
	};
}

export async function buildStateQuestionsFromFile(
	filePath: string,
	options: StateQuestionOptions,
): Promise<StateQuestionBuildResult> {
	return buildStateQuestions(parseChatJsonlFile(filePath), options);
}

/**
 * 核对题目：重新解析聊天，检查提问楼层和证据楼层时刻的状态都与 answer 一致。
 * 这条路径不依赖生成阶段留下的任何中间结果。
 */
export async function verifyStateQuestions(
	entries: AsyncIterable<StChatEntry> | Iterable<StChatEntry>,
	questions: readonly StateQuestion[],
	options: Pick<StateQuestionOptions, "storyId" | "idPrefix">,
): Promise<StateQuestionVerification> {
	const storyId = requireNonEmpty(options.storyId, "故事 id");
	const idPrefix = options.idPrefix ?? storyId;
	const state = await collectFloorState(entries);
	const failures: StateQuestionFailure[] = [];

	for (const question of questions) {
		const failure = verifyQuestion(question, state, storyId, idPrefix);
		if (failure) failures.push(failure);
	}
	return { checked: questions.length, failures };
}

export async function verifyStateQuestionsFromFile(
	filePath: string,
	questions: readonly StateQuestion[],
	options: Pick<StateQuestionOptions, "storyId" | "idPrefix">,
): Promise<StateQuestionVerification> {
	return verifyStateQuestions(parseChatJsonlFile(filePath), questions, options);
}

function resolveOptions(options: StateQuestionOptions): ResolvedOptions {
	const storyId = requireNonEmpty(options.storyId, "故事 id");
	const minGap = options.minGap ?? 30;
	const minQuestions = options.minQuestions ?? 50;
	const maxQuestions = options.maxQuestions ?? 100;
	const maxChanges = options.maxChanges ?? 10;
	const maxPathDepth = options.maxPathDepth ?? 5;
	const maxAnswerLength = options.maxAnswerLength ?? 80;
	if (!Number.isInteger(minGap) || minGap < 1) {
		throw new Error("minGap 必须是正整数");
	}
	if (!Number.isInteger(minQuestions) || minQuestions < 1) {
		throw new Error("minQuestions 必须是正整数");
	}
	if (!Number.isInteger(maxQuestions) || maxQuestions < minQuestions) {
		throw new Error("maxQuestions 必须是不小于 minQuestions 的整数");
	}
	if (!Number.isInteger(maxChanges) || maxChanges < 1) {
		throw new Error("maxChanges 必须是正整数");
	}
	if (!Number.isInteger(maxPathDepth) || maxPathDepth < 1) {
		throw new Error("maxPathDepth 必须是正整数");
	}
	if (!Number.isInteger(maxAnswerLength) || maxAnswerLength < 1) {
		throw new Error("maxAnswerLength 必须是正整数");
	}
	const maxPerPath = options.maxPerPath ?? null;
	if (
		maxPerPath !== null &&
		(!Number.isInteger(maxPerPath) || maxPerPath < 1)
	) {
		throw new Error("maxPerPath 必须是正整数");
	}
	return {
		storyId,
		idPrefix: options.idPrefix ?? storyId,
		minGap,
		minQuestions,
		maxQuestions,
		maxChanges,
		maxPathDepth,
		maxAnswerLength,
		maxPerPath,
		allowEmpty: options.allowEmpty === true,
	};
}

async function collectFloorState(
	entries: AsyncIterable<StChatEntry> | Iterable<StChatEntry>,
): Promise<FloorState> {
	const floors: (JsonObject | null)[] = [];
	const swipes: number[] = [];
	const paths = new Map<string, TrackedPath>();
	let current: JsonObject | null = null;
	let previous: Map<string, FlatValue> | null = null;
	let messageCount = 0;
	let updateCount = 0;
	let lastIndex = -1;

	for await (const entry of entries) {
		if (entry.kind === "header") continue;
		const message = entry.message;
		lastIndex = message.index;
		messageCount += 1;
		const snapshot = readSnapshot(
			message.variables,
			`第 ${message.index + 1} 楼`,
		);
		if (snapshot !== null) {
			updateCount += 1;
			const flat = flattenSnapshot(snapshot);
			for (const [key, value] of flat) {
				if (previous?.get(key)?.serialized === value.serialized) continue;
				recordChange(paths, value.parts, value.value, message.index);
			}
			for (const [key, value] of previous ?? []) {
				if (flat.has(key)) continue;
				recordChange(paths, value.parts, undefined, message.index);
			}
			previous = flat;
			current = snapshot;
		}
		floors[message.index] = current;
		swipes[message.index] = currentSwipeIndex(message);
	}

	return { messageCount, updateCount, lastIndex, floors, swipes, paths };
}

function flattenSnapshot(root: JsonObject): Map<string, FlatValue> {
	const out = new Map<string, FlatValue>();
	collectFlat(root, [], out);
	return out;
}

function collectFlat(
	value: JsonValue,
	parts: readonly string[],
	out: Map<string, FlatValue>,
): void {
	if (isJsonObject(value)) {
		const keys = Object.keys(value);
		if (keys.length === 0) {
			out.set(JSON.stringify(parts), {
				parts,
				serialized: "{}",
				value,
			});
			return;
		}
		for (const key of keys) {
			collectFlat(value[key], [...parts, key], out);
		}
		return;
	}
	out.set(JSON.stringify(parts), {
		parts,
		serialized: JSON.stringify(value),
		value,
	});
}

function recordChange(
	paths: Map<string, TrackedPath>,
	parts: readonly string[],
	value: JsonValue | undefined,
	index: number,
): void {
	const key = JSON.stringify(parts);
	let tracked = paths.get(key);
	if (!tracked) {
		tracked = { parts, changes: [] };
		paths.set(key, tracked);
	}
	tracked.changes.push({ index, value });
}

function buildCandidates(
	state: FloorState,
	options: ResolvedOptions,
): Candidate[] {
	const candidates: Candidate[] = [];
	for (const [pathKey, tracked] of state.paths) {
		const parts = tracked.parts;
		if (!isQuestionPath(parts, options.maxPathDepth)) continue;
		if (tracked.changes.length > options.maxChanges) continue;
		for (let index = 0; index < tracked.changes.length; index += 1) {
			const change = tracked.changes[index];
			if (!change) continue;
			if (change.value === undefined) continue;
			const next = tracked.changes[index + 1];
			const askIndex = (next?.index ?? state.lastIndex + 1) - 1;
			const gap = askIndex - change.index;
			if (gap < options.minGap) continue;
			const value = normalizeAnswer(change.value);
			if (value === undefined) continue;
			if (JSON.stringify(value).length > options.maxAnswerLength) continue;
			candidates.push({
				parts,
				pathKey,
				startIndex: change.index,
				askIndex,
				value,
				changeCount: tracked.changes.length,
				gap,
			});
		}
	}
	return candidates;
}

function isQuestionPath(
	parts: readonly string[],
	maxPathDepth: number,
): boolean {
	if (parts.length === 0 || parts.length > maxPathDepth) return false;
	const root = parts[0];
	if (root === undefined || EXCLUDED_ROOTS[root] === true) return false;
	return parts.every((part) => !part.startsWith("_"));
}

function selectCandidates(
	candidates: readonly Candidate[],
	options: ResolvedOptions,
): Candidate[] {
	const groups = new Map<string, Candidate[]>();
	for (const candidate of candidates) {
		const list = groups.get(candidate.pathKey);
		if (list) {
			list.push(candidate);
		} else {
			groups.set(candidate.pathKey, [candidate]);
		}
	}
	for (const list of groups.values()) {
		list.sort((left, right) => {
			if (left.gap !== right.gap) return right.gap - left.gap;
			return left.startIndex - right.startIndex;
		});
	}

	const keys = [...groups.keys()];
	const preferred: string[] = [];
	const single: string[] = [];
	for (const key of keys) {
		const list = groups.get(key);
		if (!list || list.length === 0) continue;
		const changeCount = list[0]?.changeCount ?? 0;
		if (changeCount >= 2) {
			preferred.push(key);
		} else {
			single.push(key);
		}
	}
	const bestGap = (key: string): number => groups.get(key)?.[0]?.gap ?? 0;
	const compareKeys = (left: string, right: string): number => {
		const difference = bestGap(right) - bestGap(left);
		return difference !== 0 ? difference : left.localeCompare(right);
	};
	preferred.sort(compareKeys);
	single.sort(compareKeys);
	const ordered = [...preferred, ...single];

	const roundLimit = options.maxPerPath ?? Number.POSITIVE_INFINITY;
	const selected: Candidate[] = [];
	for (let round = 0; round < roundLimit; round += 1) {
		let added = false;
		for (const key of ordered) {
			const candidate = groups.get(key)?.[round];
			if (!candidate) continue;
			selected.push(candidate);
			added = true;
			if (selected.length >= options.maxQuestions) break;
		}
		if (!added || selected.length >= options.maxQuestions) break;
	}
	selected.sort((left, right) => {
		if (left.askIndex !== right.askIndex) return left.askIndex - right.askIndex;
		return left.pathKey.localeCompare(right.pathKey);
	});
	return selected;
}

function toQuestion(
	candidate: Candidate,
	state: FloorState,
	options: ResolvedOptions,
): StateQuestion {
	const askSwipe = state.swipes[candidate.askIndex];
	const evidenceSwipe = state.swipes[candidate.startIndex];
	if (askSwipe === undefined || evidenceSwipe === undefined) {
		throw new Error(`楼层 ${candidate.askIndex} 缺少 swipe 下标`);
	}
	const label =
		candidate.parts[0] === "stat_data"
			? candidate.parts.slice(1)
			: candidate.parts;
	return {
		id: `state:${options.storyId}:${candidate.askIndex + 1}:${candidate.pathKey}`,
		story: options.storyId,
		askAtNode: swipeNodeId(options.idPrefix, candidate.askIndex, askSwipe),
		question: `在第 ${candidate.startIndex + 1} 楼之后，「${label.join(".")}」的值是什么？`,
		answer: candidate.value,
		evidenceNodes: [
			swipeNodeId(options.idPrefix, candidate.startIndex, evidenceSwipe),
		],
		kind: "state",
		path: candidate.parts,
	};
}

function verifyQuestion(
	question: StateQuestion,
	state: FloorState,
	storyId: string,
	idPrefix: string,
): StateQuestionFailure | null {
	if (question.story !== storyId) {
		return { id: question.id, reason: `题目的故事是 ${question.story}` };
	}
	if (question.kind !== "state") {
		return { id: question.id, reason: "题目类型不是 state" };
	}
	const askIndex = parseMessageIndex(idPrefix, question.askAtNode);
	const evidenceId = question.evidenceNodes[0];
	if (evidenceId === undefined) {
		return { id: question.id, reason: "缺少证据楼层" };
	}
	const evidenceIndex = parseMessageIndex(idPrefix, evidenceId);
	if (evidenceIndex >= askIndex) {
		return { id: question.id, reason: "证据楼层不在提问楼层之前" };
	}
	for (const [label, floorIndex] of [
		["提问楼层", askIndex],
		["证据楼层", evidenceIndex],
	] as const) {
		const raw = resolvePath(state.floors[floorIndex] ?? null, question.path);
		if (raw === undefined) {
			return { id: question.id, reason: `${label}没有这个变量` };
		}
		const actual = normalizeAnswer(raw);
		if (!isDeepStrictEqual(actual, question.answer)) {
			return {
				id: question.id,
				reason: `${label}的值与答案不一致`,
			};
		}
	}
	return null;
}

function resolvePath(
	root: JsonObject | null,
	parts: readonly string[],
): JsonValue | undefined {
	let current: JsonValue = root;
	for (const part of parts) {
		if (!isJsonObject(current) || !Object.hasOwn(current, part)) {
			return undefined;
		}
		current = current[part];
	}
	return current;
}

/** 按完整状态路径取值，并按 MVU 二元组规则取出可以作为答案的标量。 */
export function readStateAnswer(
	root: JsonObject | null,
	parts: readonly string[],
): StateAnswer | undefined {
	const value = resolvePath(root, parts);
	return value === undefined ? undefined : normalizeAnswer(value);
}

/**
 * MVU 用 `["值", "说明"]` 这种二元数组保存变量，题目只问值本身。
 * 其他数组整份比较，无法作为简短答案。
 */
function normalizeAnswer(value: JsonValue): StateAnswer | undefined {
	if (Array.isArray(value)) {
		if (value.length !== 2) return undefined;
		const [first, description] = value;
		if (typeof description !== "string") return undefined;
		return scalarAnswer(first);
	}
	return scalarAnswer(value);
}

function scalarAnswer(value: JsonValue): StateAnswer | undefined {
	if (typeof value === "string") {
		return value.length === 0 ? undefined : value;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value === "boolean") return value;
	return undefined;
}
