/** 自动试玩的续跑文件：跨会话累积每轮记录，续跑时按同一故事继续。 */

import type {
	PlaytestBackgroundRecord,
	PlaytestCandidateRecord,
	PlaytestDirectorRecord,
	PlaytestMechanismRecord,
	PlaytestOperationRecord,
	PlaytestRecord,
	PlaytestRoundRecord,
	PlaytestScheduleView,
	PlaytestUsage,
} from "./records";

export const PLAYTEST_PROGRESS_VERSION = 1;

export interface PlaytestProgress {
	readonly version: typeof PLAYTEST_PROGRESS_VERSION;
	readonly storyId: string;
	readonly storyTitle: string;
	readonly dbPath: string;
	readonly channelsPath: string;
	readonly rounds: number;
	readonly schedule: PlaytestScheduleView;
	readonly startedAt: string;
	readonly records: readonly PlaytestRecord[];
}

export interface PlaytestProgressExpectation {
	readonly storyTitle: string;
	readonly dbPath: string;
	readonly channelsPath: string;
	readonly rounds: number;
	readonly schedule: PlaytestScheduleView;
}

type UnknownRecord = Record<string, unknown>;

/** 严格解析续跑文件；损坏或版本不符的文件直接失败，不静默重开一轮试玩。 */
export function parsePlaytestProgress(text: string): PlaytestProgress {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`续跑文件不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const record = asRecord(value, "progress");
	const version = asInteger(record.version, "progress.version", 1);
	if (version !== PLAYTEST_PROGRESS_VERSION) {
		throw new Error(
			`续跑文件版本 ${version} 不受支持，需要 ${PLAYTEST_PROGRESS_VERSION}`,
		);
	}
	const rounds = asInteger(record.rounds, "progress.rounds", 2);
	const records = asArray(record.records, "progress.records").map(
		(item, index) => parseRecord(item, `progress.records[${index}]`),
	);
	assertRecordSequence(records, rounds);
	return {
		version: PLAYTEST_PROGRESS_VERSION,
		storyId: asString(record.storyId, "progress.storyId"),
		storyTitle: asString(record.storyTitle, "progress.storyTitle"),
		dbPath: asString(record.dbPath, "progress.dbPath"),
		channelsPath: asString(record.channelsPath, "progress.channelsPath"),
		rounds,
		schedule: parseSchedule(record.schedule, "progress.schedule"),
		startedAt: asString(record.startedAt, "progress.startedAt"),
		records,
	};
}

/** 续跑必须沿用同一份数据库、渠道、故事标题与排期，否则说明文件与运行环境不配套。 */
export function assertPlaytestProgressMatches(
	progress: PlaytestProgress,
	expected: PlaytestProgressExpectation,
): void {
	if (progress.storyTitle !== expected.storyTitle) {
		throw mismatch("storyTitle", progress.storyTitle, expected.storyTitle);
	}
	if (progress.rounds !== expected.rounds) {
		throw mismatch("rounds", String(progress.rounds), String(expected.rounds));
	}
	if (progress.dbPath !== expected.dbPath) {
		throw mismatch("dbPath", progress.dbPath, expected.dbPath);
	}
	if (progress.channelsPath !== expected.channelsPath) {
		throw mismatch(
			"channelsPath",
			progress.channelsPath,
			expected.channelsPath,
		);
	}
	for (const key of [
		"swipeAt",
		"editAt",
		"branchAt",
		"candidateAt",
		"optionAt",
	] as const) {
		const actual = progress.schedule[key];
		const wanted = expected.schedule[key];
		if (
			actual.length !== wanted.length ||
			actual.some((value, index) => value !== wanted[index])
		) {
			throw mismatch(`schedule.${key}`, actual.join(","), wanted.join(","));
		}
	}
}

export function completedRoundCount(
	records: readonly PlaytestRecord[],
): number {
	let count = 0;
	for (const record of records) {
		if (record.kind === "round") count += 1;
	}
	return count;
}

/** 续跑时重建线索首次出现的轮次：记录里有开线轮次，其余当前未兑现的按试玩前已存在处理。 */
export function rebuildClueFirstSeen(
	records: readonly PlaytestRecord[],
	openClueIds: Iterable<string>,
): Map<string, number> {
	const firstSeen = new Map<string, number>();
	for (const record of records) {
		if (record.kind !== "round") continue;
		for (const clueId of record.newClueIds) {
			firstSeen.set(clueId, record.round);
		}
	}
	for (const clueId of openClueIds) {
		if (!firstSeen.has(clueId)) firstSeen.set(clueId, 0);
	}
	return firstSeen;
}

function mismatch(field: string, actual: string, expected: string): Error {
	return new Error(
		`续跑文件与当前配置不一致（${field}：文件为 ${actual}，当前为 ${expected}）；换回原来的 PLAYTEST_DB、PLAYTEST_CHANNELS 与排期，或删除续跑文件重新开始`,
	);
}

function assertRecordSequence(
	records: readonly PlaytestRecord[],
	rounds: number,
): void {
	if (records.length > rounds) {
		throw new Error(`续跑文件记录数 ${records.length} 超过设定轮数 ${rounds}`);
	}
	let next = 1;
	for (const record of records) {
		if (record.round !== next) {
			throw new Error(
				`续跑文件的轮次必须从 1 连续递增：期望第 ${next} 轮，实际第 ${record.round} 轮`,
			);
		}
		next += 1;
		if (record.kind === "failure" && record !== records.at(-1)) {
			throw new Error("续跑文件的失败记录之后不应再有记录");
		}
	}
}

function parseRecord(value: unknown, path: string): PlaytestRecord {
	const record = asRecord(value, path);
	const kind = asString(record.kind, `${path}.kind`);
	if (kind === "failure") {
		return {
			kind: "failure",
			round: asInteger(record.round, `${path}.round`, 1),
			stepId: asString(record.stepId, `${path}.stepId`),
			error: asString(record.error, `${path}.error`),
			screenshot: asString(record.screenshot, `${path}.screenshot`),
			createdAt: asString(record.createdAt, `${path}.createdAt`),
		};
	}
	if (kind !== "round") {
		throw new Error(`${path}.kind 只能是 round 或 failure：${kind}`);
	}
	return parseRoundRecord(record, path);
}

function parseRoundRecord(
	record: UnknownRecord,
	path: string,
): PlaytestRoundRecord {
	return {
		kind: "round",
		round: asInteger(record.round, `${path}.round`, 1),
		userNodeId: asString(record.userNodeId, `${path}.userNodeId`),
		assistantNodeId: asString(
			record.assistantNodeId,
			`${path}.assistantNodeId`,
		),
		traceNodeId: asNullableString(record.traceNodeId, `${path}.traceNodeId`),
		user: asString(record.user, `${path}.user`),
		assistant: asString(record.assistant, `${path}.assistant`),
		turnMode: asString(record.turnMode, `${path}.turnMode`),
		firstTokenMs: asNullableNumber(record.firstTokenMs, `${path}.firstTokenMs`),
		durationMs: asNumber(record.durationMs, `${path}.durationMs`),
		usage: parseUsage(record.usage, `${path}.usage`),
		ledgerDiffCount: asInteger(
			record.ledgerDiffCount,
			`${path}.ledgerDiffCount`,
			0,
		),
		newClueIds: asStringArray(record.newClueIds, `${path}.newClueIds`),
		fulfilledClueIds: asStringArray(
			record.fulfilledClueIds,
			`${path}.fulfilledClueIds`,
		),
		fulfilledClueAges: asIntegerArray(
			record.fulfilledClueAges,
			`${path}.fulfilledClueAges`,
			0,
		),
		director: parseDirector(record.director, `${path}.director`),
		candidateActions: parseCandidate(
			record.candidateActions,
			`${path}.candidateActions`,
		),
		openingCandidates: parseCandidate(
			record.openingCandidates,
			`${path}.openingCandidates`,
		),
		operations: asArray(record.operations, `${path}.operations`).map(
			(operation, index) =>
				parseOperation(operation, `${path}.operations[${index}]`),
		),
		background: parseBackground(record.background, `${path}.background`),
		screenshot: asString(record.screenshot, `${path}.screenshot`),
		createdAt: asString(record.createdAt, `${path}.createdAt`),
	};
}

function parseOperation(value: unknown, path: string): PlaytestOperationRecord {
	const record = asRecord(value, path);
	const kind = asString(record.kind, `${path}.kind`);
	if (kind !== "swipe" && kind !== "edit" && kind !== "branch") {
		throw new Error(`${path}.kind 不是已知操作：${kind}`);
	}
	return {
		kind,
		round: asInteger(record.round, `${path}.round`, 1),
		stepId: asString(record.stepId, `${path}.stepId`),
		fromNodeId: asString(record.fromNodeId, `${path}.fromNodeId`),
		toNodeId: asString(record.toNodeId, `${path}.toNodeId`),
		text: asNullableString(record.text, `${path}.text`),
	};
}

function parseUsage(value: unknown, path: string): PlaytestUsage {
	const record = asRecord(value, path);
	return {
		promptTokens: asNullableNumber(record.promptTokens, `${path}.promptTokens`),
		completionTokens: asNullableNumber(
			record.completionTokens,
			`${path}.completionTokens`,
		),
		totalTokens: asNullableNumber(record.totalTokens, `${path}.totalTokens`),
		reasoningTokens: asNullableNumber(
			record.reasoningTokens,
			`${path}.reasoningTokens`,
		),
	};
}

function parseDirector(
	value: unknown,
	path: string,
): PlaytestDirectorRecord | null {
	if (value === null) return null;
	const record = asRecord(value, path);
	return {
		directive: asNullableString(record.directive, `${path}.directive`),
		mechanisms: asArray(record.mechanisms, `${path}.mechanisms`).map(
			(mechanism, index) =>
				parseMechanism(mechanism, `${path}.mechanisms[${index}]`),
		),
	};
}

function parseMechanism(value: unknown, path: string): PlaytestMechanismRecord {
	const record = asRecord(value, path);
	return {
		name: asString(record.name, `${path}.name`),
		triggered: asBoolean(record.triggered, `${path}.triggered`),
		reason: asString(record.reason, `${path}.reason`),
	};
}

function parseCandidate(
	value: unknown,
	path: string,
): PlaytestCandidateRecord | null {
	if (value === null) return null;
	const record = asRecord(value, path);
	return {
		count: asInteger(record.count, `${path}.count`, 0),
		visible: asBoolean(record.visible, `${path}.visible`),
		pickedText: asNullableString(record.pickedText, `${path}.pickedText`),
	};
}

function parseBackground(
	value: unknown,
	path: string,
): PlaytestBackgroundRecord | null {
	if (value === null) return null;
	const record = asRecord(value, path);
	return {
		pending: asInteger(record.pending, `${path}.pending`, 0),
		running: asInteger(record.running, `${path}.running`, 0),
		failed: asInteger(record.failed, `${path}.failed`, 0),
	};
}

function parseSchedule(value: unknown, path: string): PlaytestScheduleView {
	const record = asRecord(value, path);
	return {
		swipeAt: asIntegerArray(record.swipeAt, `${path}.swipeAt`, 0),
		editAt: asIntegerArray(record.editAt, `${path}.editAt`, 0),
		branchAt: asIntegerArray(record.branchAt, `${path}.branchAt`, 0),
		candidateAt: asIntegerArray(record.candidateAt, `${path}.candidateAt`, 0),
		optionAt: asIntegerArray(record.optionAt, `${path}.optionAt`, 0),
	};
}

function asRecord(value: unknown, path: string): UnknownRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} 必须是对象`);
	}
	return value as UnknownRecord;
}

function asArray(value: unknown, path: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${path} 必须是数组`);
	return value;
}

function asString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${path} 必须是非空字符串`);
	}
	return value;
}

function asNullableString(value: unknown, path: string): string | null {
	if (value === null) return null;
	return asString(value, path);
}

function asBoolean(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${path} 必须是布尔值`);
	return value;
}

function asNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${path} 必须是有限数字`);
	}
	return value;
}

function asNullableNumber(value: unknown, path: string): number | null {
	if (value === null) return null;
	return asNumber(value, path);
}

function asInteger(value: unknown, path: string, min: number): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
		throw new Error(`${path} 必须是不小于 ${min} 的整数`);
	}
	return value;
}

function asStringArray(value: unknown, path: string): string[] {
	return asArray(value, path).map((item, index) =>
		asString(item, `${path}[${index}]`),
	);
}

function asIntegerArray(value: unknown, path: string, min: number): number[] {
	return asArray(value, path).map((item, index) =>
		asInteger(item, `${path}[${index}]`, min),
	);
}
