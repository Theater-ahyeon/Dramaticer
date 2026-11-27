import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import type { StoryStore } from "../store/story-store.js";

/** 线的种类：主线问题、人物关系线、对手的图谋、伏笔与约定。 */
export const DIRECTOR_LINE_KINDS = [
	"main",
	"relationship",
	"opposition",
	"promise",
] as const;

export type DirectorLineKind = (typeof DIRECTOR_LINE_KINDS)[number];

export const DIRECTOR_LINE_KIND_LABELS: Record<DirectorLineKind, string> = {
	main: "主线问题",
	relationship: "人物关系线",
	opposition: "对手的图谋",
	promise: "伏笔与约定",
};

export const DIRECTOR_LINE_DIFF_ACTIONS = ["set", "delete"] as const;

export type DirectorLineDiffAction =
	(typeof DIRECTOR_LINE_DIFF_ACTIONS)[number];

/** 一个楼层最多的线修改条数。 */
export const MAX_DIRECTOR_LINE_DIFFS_PER_FLOOR = 50;

/** 一条线后台预备的发展最多三条。 */
export const MAX_DIRECTOR_LINE_PREPARATIONS = 3;

/** 线 id 的最大长度。 */
export const MAX_DIRECTOR_LINE_ID_CHARS = 64;

/** 线里单个文本字段的最大长度。 */
export const MAX_DIRECTOR_LINE_TEXT_CHARS = 500;

/**
 * 一条线。倒计时的单位是助手楼层：每生成一楼故事时间往前走一拍，
 * `countdown` 减去从上次被触及到现在的助手楼层数。
 */
export interface DirectorLine {
	/** 故事内唯一。 */
	readonly id: string;
	readonly kind: DirectorLineKind;
	/** 谁想要什么。 */
	readonly who: string;
	readonly want: string;
	/** 阻碍与代价。 */
	readonly obstacle: string;
	/** 还要多少拍到点；null 表示没有倒计时。 */
	readonly countdown: number | null;
	/** 后台预备的两三种发展。 */
	readonly preparations: readonly string[];
	/** 到点时即使玩家正在自己写也可以打断；每场最多一次。只在为真时出现。 */
	readonly mustInterrupt?: boolean;
}

/** 楼层上的一条线修改；`set` 带完整线，`delete` 只带 id。 */
export type DirectorLineDiff =
	| { readonly action: "set"; readonly line: DirectorLine }
	| { readonly action: "delete"; readonly id: string };

/** 一个楼层保存的线修改集合。 */
export interface DirectorLineRecord {
	readonly nodeId: string;
	readonly storyId: string;
	readonly diffs: readonly DirectorLineDiff[];
	readonly createdAt: string;
}

export interface NewDirectorLineRecordInput {
	readonly nodeId: string;
	readonly storyId: string;
	readonly diffs: readonly DirectorLineDiff[];
	readonly createdAt?: string;
}

/** 沿路径累加后的一条线；冷热是相对于当前路径的助手楼层深度。 */
export interface DirectorLineState {
	readonly line: DirectorLine;
	/** 第一次写入这条线时的助手楼层数。 */
	readonly openedDepth: number;
	/** 最近一次写入这条线时的助手楼层数。 */
	readonly lastTouchedDepth: number;
}

/**
 * 路径上出现过的全部线 id，包括后来被删除的线。清理过的线不在
 * `readDirectorLineStates` 里，判断一条铺垫是否已经写过要用这个集合。
 */
export function collectDirectorLineHistoryIds(
	records: readonly DirectorLineRecord[],
): string[] {
	const ids: string[] = [];
	for (const record of records) {
		for (const diff of record.diffs) {
			ids.push(diff.action === "set" ? diff.line.id : diff.id);
		}
	}
	return ids;
}

const LINE_KEYS = [
	"id",
	"kind",
	"who",
	"want",
	"obstacle",
	"countdown",
	"preparations",
	"mustInterrupt",
];

export function isDirectorLineKind(value: unknown): value is DirectorLineKind {
	return (
		typeof value === "string" &&
		(DIRECTOR_LINE_KINDS as readonly string[]).includes(value)
	);
}

function readText(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串`);
	}
	const text = value.trim();
	if (text.length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	if (text.length > MAX_DIRECTOR_LINE_TEXT_CHARS) {
		throw new Error(`${label} 不能超过 ${MAX_DIRECTOR_LINE_TEXT_CHARS} 字`);
	}
	return text;
}

/** 校验一条线；字段路径写进错误信息。 */
export function assertDirectorLine(
	value: unknown,
	label: string,
): DirectorLine {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, LINE_KEYS, label);
	const id = readText(record.id, `${label}.id`);
	if (id.length > MAX_DIRECTOR_LINE_ID_CHARS) {
		throw new Error(`${label}.id 不能超过 ${MAX_DIRECTOR_LINE_ID_CHARS} 字`);
	}
	if (!isDirectorLineKind(record.kind)) {
		throw new Error(
			`${label}.kind 只能是 ${DIRECTOR_LINE_KINDS.join("、")}，收到 ${JSON.stringify(record.kind)}`,
		);
	}
	const who = readText(record.who, `${label}.who`);
	const want = readText(record.want, `${label}.want`);
	const obstacle = readText(record.obstacle, `${label}.obstacle`);
	const countdown = record.countdown;
	if (
		countdown !== null &&
		(!Number.isInteger(countdown) || (countdown as number) < 0)
	) {
		throw new Error(`${label}.countdown 必须是非负整数或 null`);
	}
	const preparations = record.preparations;
	if (!Array.isArray(preparations)) {
		throw new Error(`${label}.preparations 必须是数组`);
	}
	if (preparations.length > MAX_DIRECTOR_LINE_PREPARATIONS) {
		throw new Error(
			`${label}.preparations 最多 ${MAX_DIRECTOR_LINE_PREPARATIONS} 条`,
		);
	}
	const mustInterrupt = record.mustInterrupt;
	if (mustInterrupt !== undefined && typeof mustInterrupt !== "boolean") {
		throw new Error(`${label}.mustInterrupt 必须是布尔值`);
	}
	const seen = new Set<string>();
	const parsedPreparations = preparations.map((item, index) => {
		const text = readText(item, `${label}.preparations[${index}]`);
		if (seen.has(text)) {
			throw new Error(`${label}.preparations[${index}] 与前面的发展重复`);
		}
		seen.add(text);
		return text;
	});
	return {
		id,
		kind: record.kind,
		who,
		want,
		obstacle,
		countdown: countdown as number | null,
		preparations: parsedPreparations,
		...(mustInterrupt === true ? { mustInterrupt: true } : {}),
	};
}

/** 校验一条线修改；`set` 必须带完整线，`delete` 只带 id。 */
export function assertDirectorLineDiff(
	value: unknown,
	label: string,
): DirectorLineDiff {
	const record = assertPlainObject(value, label);
	const action = record.action;
	if (
		typeof action !== "string" ||
		!(DIRECTOR_LINE_DIFF_ACTIONS as readonly string[]).includes(action)
	) {
		throw new Error(
			`${label}.action 只能是 set 或 delete，收到 ${JSON.stringify(action)}`,
		);
	}
	if (action === "delete") {
		rejectUnknownKeys(record, ["action", "id"], label);
		return { action: "delete", id: readText(record.id, `${label}.id`) };
	}
	rejectUnknownKeys(record, ["action", "line"], label);
	return {
		action: "set",
		line: assertDirectorLine(record.line, `${label}.line`),
	};
}

/** 校验一个楼层的线修改数组；最多 50 条。 */
export function assertDirectorLineDiffs(
	value: unknown,
	label: string,
): DirectorLineDiff[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	if (value.length > MAX_DIRECTOR_LINE_DIFFS_PER_FLOOR) {
		throw new Error(`${label} 最多 ${MAX_DIRECTOR_LINE_DIFFS_PER_FLOOR} 条`);
	}
	return value.map((diff, index) =>
		assertDirectorLineDiff(diff, `${label}[${index}]`),
	);
}

/**
 * 依次应用一个楼层的线修改：`set` 覆盖同 id 的线，`delete` 移除线。
 * 后写的楼层覆盖先前的内容；`openedDepth` 保留第一次写入的位置。
 */
export function applyDirectorLineDiffs(
	states: readonly DirectorLineState[],
	diffs: readonly DirectorLineDiff[],
	depth: number,
): DirectorLineState[] {
	if (!Number.isInteger(depth) || depth < 0) {
		throw new Error(`线的楼层深度必须是非负整数，收到 ${String(depth)}`);
	}
	const map = new Map(states.map((state) => [state.line.id, state] as const));
	for (const diff of diffs) {
		if (diff.action === "set") {
			const existing = map.get(diff.line.id);
			map.set(diff.line.id, {
				line: diff.line,
				openedDepth: existing?.openedDepth ?? depth,
				lastTouchedDepth: depth,
			});
		} else {
			map.delete(diff.id);
		}
	}
	return [...map.values()].sort((left, right) =>
		left.line.id < right.line.id ? -1 : left.line.id > right.line.id ? 1 : 0,
	);
}

/** 线还剩多少拍到点；没有倒计时时为 null。 */
export function directorLineRemaining(
	state: DirectorLineState,
	depth: number,
): number | null {
	const countdown = state.line.countdown;
	if (countdown === null) return null;
	return countdown - (depth - state.lastTouchedDepth);
}

/** 当前打开（未兑现）的伏笔条数。 */
export function countOpenPromises(
	states: readonly DirectorLineState[],
): number {
	return states.filter((state) => state.line.kind === "promise").length;
}

/**
 * 未兑现伏笔的上限：新建伏笔超过上限时拒绝整批修改，
 * 已经在超限状态里的伏笔改内容仍然允许。
 */
export function assertPromiseBudget(
	states: readonly DirectorLineState[],
	diffs: readonly DirectorLineDiff[],
	maxOpenPromises: number,
	label = "线修改",
): void {
	if (!Number.isInteger(maxOpenPromises) || maxOpenPromises < 0) {
		throw new Error("伏笔上限必须是非负整数");
	}
	const before = countOpenPromises(states);
	const after = countOpenPromises(applyDirectorLineDiffs(states, diffs, 0));
	if (after <= maxOpenPromises || after <= before) return;
	throw new Error(
		`${label}会让未兑现伏笔达到 ${after} 条，超过上限 ${maxOpenPromises}`,
	);
}

/** 玩家在选择推进档位；null 表示常规回合。 */
export const DIRECTOR_PUSH_KINDS = ["advance", "quick", "jump"] as const;

export type DirectorPush = (typeof DIRECTOR_PUSH_KINDS)[number];

export const DIRECTOR_PUSH_LABELS: Record<DirectorPush, string> = {
	advance: "推进",
	quick: "快速推进",
	jump: "大幅推进",
};

export function isDirectorPush(value: unknown): value is DirectorPush {
	return (
		typeof value === "string" &&
		(DIRECTOR_PUSH_KINDS as readonly string[]).includes(value)
	);
}

export function assertDirectorPush(
	value: unknown,
	label = "推进档位",
): DirectorPush {
	if (!isDirectorPush(value)) {
		throw new Error(
			`${label}只能是 ${DIRECTOR_PUSH_KINDS.join("、")}，收到 ${JSON.stringify(value)}`,
		);
	}
	return value;
}

/** 线在写作模型眼里的简短写法：谁想要什么，阻碍是什么。 */
export function formatDirectorLine(line: DirectorLine): string {
	return `${line.who}想要${line.want}，阻碍是${line.obstacle}`;
}

export type DirectorIntentKind = "push" | "free" | "none";

export interface DirectorIntent {
	readonly kind: DirectorIntentKind;
	/** 交出方向时的推进档位；其余为 null。 */
	readonly push: DirectorPush | null;
	/** 判断依据，写进决策记录。 */
	readonly basis: string;
}

/** 推进类说法去掉空白与标点后的最长字数；更长的一律当作玩家自己的行动。 */
export const PUSH_PHRASE_MAX_CHARS = 10;

const PUSH_PHRASES: readonly (readonly [DirectorPush, RegExp])[] = [
	["jump", /^(大幅度?|大大)(推进|推动)(剧情)?(发展)?$/u],
	["quick", /^(快速|加快|快点|快进)(推进|推动)?(剧情)?(发展)?$/u],
	[
		"advance",
		/^(继续|接着|然后呢?|往下|下一步|推进|推动)(吧|写|剧情|推进|发展|剧情发展)?$|^(goon|continue|next)$/iu,
	],
];

/**
 * 看内容不看字数：按了推进按钮，或消息是「继续、推进剧情」这类固定说法，
 * 才算把方向交出来；其余自由输入不论长短都是玩家自己的决定。
 */
export function readPlayerIntent(
	playerMessage: string | null,
	push: DirectorPush | null,
): DirectorIntent {
	if (push !== null) {
		return {
			kind: "push",
			push,
			basis: `玩家按了「${DIRECTOR_PUSH_LABELS[push]}」`,
		};
	}
	if (playerMessage === null) {
		return { kind: "none", push: null, basis: "这一轮没有玩家消息" };
	}
	if (playerMessage.trim().length === 0) {
		return { kind: "none", push: null, basis: "这一轮没有玩家消息" };
	}
	const bare = playerMessage.replace(/[\s\p{P}\p{S}]+/gu, "");
	if (bare.length === 0) {
		return { kind: "push", push: "advance", basis: "玩家只发了标点" };
	}
	if (bare.length <= PUSH_PHRASE_MAX_CHARS) {
		for (const [kind, pattern] of PUSH_PHRASES) {
			if (pattern.test(bare)) {
				return {
					kind: "push",
					push: kind,
					basis: `玩家说的是「${DIRECTOR_PUSH_LABELS[kind]}」这类说法`,
				};
			}
		}
	}
	return { kind: "free", push: null, basis: "玩家写了自己的行动" };
}

/** 玩家置顶的线，存在故事级的小配置里。 */
export function readPinnedLineIds(
	store: StoryStore,
	storyId: string,
): string[] {
	const value = store.getStoryValue(storyId, "pinnedLines");
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}
