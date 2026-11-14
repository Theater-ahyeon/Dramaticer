import {
	type JsonObject,
	assertPlainObject,
	rejectUnknownKeys,
} from "../json.js";
import type { SceneCard } from "../ledger/scene-log.js";
import type { StoryStore } from "../store/story-store.js";
import type { DirectorConfig } from "./types.js";

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

const LINE_KEYS = [
	"id",
	"kind",
	"who",
	"want",
	"obstacle",
	"countdown",
	"preparations",
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

/** 八种动作；标识符用英文，标签进 Trace 与 explain。 */
export const DIRECTOR_ACTION_KINDS = [
	"yield",
	"catch",
	"escalate",
	"intrude",
	"fulfill",
	"reveal",
	"breathe",
	"transition",
] as const;

export type DirectorActionKind = (typeof DIRECTOR_ACTION_KINDS)[number];

export const DIRECTOR_ACTION_LABELS: Record<DirectorActionKind, string> = {
	yield: "让位",
	catch: "接球",
	escalate: "加码",
	intrude: "闯入",
	fulfill: "兑现",
	reveal: "揭示",
	breathe: "喘息",
	transition: "转场",
};

/** 同一动作最多连用几次。 */
export const MAX_CONSECUTIVE_DIRECTOR_ACTIONS = 3;

/** 玩家消息去掉空白后达到这个字数才算写了具体行动。 */
export const PLAYER_DIRECTION_MIN_CHARS = 12;

/** 连续多少楼没有状态变化算「过于顺利」。 */
export const DIRECTOR_SMOOTH_FLOORS = 2;

/** 连续多少楼高强度之后转入喘息。 */
export const DIRECTOR_INTENSE_FLOORS = 2;

/** 对手的图谋在最近几楼内被触及算与当前话题相关。 */
export const DIRECTOR_REVEAL_HOT_FLOORS = 2;

/** 动作选择读取的场记楼层数。 */
export const DIRECTOR_ACTION_FLOOR_WINDOW = 6;

/** 动作建议的优先级；线引擎只产出一条建议，这个值只写进决策记录。 */
export const DIRECTOR_ACTION_PRIORITY = 50;

/** 一个助手楼层的观察：场记节拍、在场者、这一楼是否收尾与状态变化条数。 */
export interface DirectorActionFloor {
	/** 场记的节拍标签；这一楼没有场记记录时为 null。 */
	readonly beat: string | null;
	readonly present: readonly string[];
	readonly sceneEnds: boolean;
	/** 这一楼开新场时写下的场面卡；其余楼层为 null。 */
	readonly sceneCard?: SceneCard | null;
	/** 这一楼写入台账的硬状态条数。 */
	readonly stateChanges: number;
}

/** 动作选择只读这三个配置：停滞阈值、伏笔年龄与高强度门槛。 */
export type DirectorActionConfig = Pick<
	DirectorConfig,
	"stallFloors" | "clueAgeWarning" | "tensionStateDiffsPerFloor"
>;

export interface DirectorActionInput {
	/** 当前路径上的助手楼层数。 */
	readonly floorDepth: number;
	/** 本轮玩家消息；没有时为 null。 */
	readonly playerMessage: string | null;
	/** 玩家选择的推进档位；null 表示常规回合。 */
	readonly push: DirectorPush | null;
	/** 最近几个助手楼层的观察，最新在前。 */
	readonly floors: readonly DirectorActionFloor[];
	/** 沿路径累加后的线。 */
	readonly lines: readonly DirectorLineState[];
	/** 最近用过的动作，最新在前。 */
	readonly recentActions: readonly DirectorActionKind[];
	readonly config: DirectorActionConfig;
}

export interface DirectorActionSelection {
	readonly action: DirectorActionKind;
	readonly label: string;
	/** 选择这个动作的程序理由；写进决策记录与 explain。 */
	readonly reason: string;
	/** 动作锚定的线；没有线时为 null。 */
	readonly lineId: string | null;
	readonly directive: string;
	readonly signals: JsonObject;
}

interface ActionCandidate {
	readonly action: DirectorActionKind;
	readonly reason: string;
	readonly lineId: string | null;
	readonly directive: string;
}

export function isDirectorActionKind(
	value: unknown,
): value is DirectorActionKind {
	return (
		typeof value === "string" &&
		(DIRECTOR_ACTION_KINDS as readonly string[]).includes(value)
	);
}

function normalizedLength(value: string | null): number {
	if (value === null) return 0;
	return value.replace(/\s+/gu, "").length;
}

/** 最近两个动作相同且会变成第三个时，禁止再选这个动作。 */
export function blockedDirectorAction(
	recentActions: readonly DirectorActionKind[],
): DirectorActionKind | null {
	if (recentActions.length < MAX_CONSECUTIVE_DIRECTOR_ACTIONS - 1) return null;
	const [newest, previous] = recentActions;
	if (newest === undefined || newest !== previous) return null;
	return newest;
}

function consecutiveFloors(
	floors: readonly DirectorActionFloor[],
	matches: (floor: DirectorActionFloor) => boolean,
): number {
	let count = 0;
	for (const floor of floors) {
		if (!matches(floor)) break;
		count += 1;
	}
	return count;
}

function readAnchorLine(
	lines: readonly DirectorLineState[],
	side: "hot" | "cold",
): DirectorLineState | null {
	let best: DirectorLineState | null = null;
	for (const state of lines) {
		if (
			best === null ||
			(side === "hot"
				? state.lastTouchedDepth > best.lastTouchedDepth
				: state.lastTouchedDepth < best.lastTouchedDepth)
		) {
			best = state;
		}
	}
	return best;
}

/**
 * 八种动作由程序按场记记录与线状态选择，不调用模型、不读磁盘。
 * 顺序即优先级：让位、闯入、兑现、揭示、转场、喘息、加码、接球。
 */
export function selectDirectorAction(
	input: DirectorActionInput,
): DirectorActionSelection | null {
	const { floors, lines, config, floorDepth } = input;
	if (!Number.isInteger(floorDepth) || floorDepth < 0) {
		throw new Error(
			`动作选择的 floorDepth 必须是非负整数，收到 ${String(floorDepth)}`,
		);
	}
	if (!Number.isInteger(config.stallFloors) || config.stallFloors < 1) {
		throw new Error("动作选择的 stallFloors 必须是正整数");
	}
	if (!Number.isInteger(config.clueAgeWarning) || config.clueAgeWarning < 0) {
		throw new Error("动作选择的 clueAgeWarning 必须是非负整数");
	}
	if (
		!Number.isInteger(config.tensionStateDiffsPerFloor) ||
		config.tensionStateDiffsPerFloor < 1
	) {
		throw new Error("动作选择的 tensionStateDiffsPerFloor 必须是正整数");
	}
	const latest = floors[0] ?? null;
	const present = latest === null ? [] : latest.present;
	const candidates = buildActionCandidates(input);
	const blocked = blockedDirectorAction(input.recentActions);
	const chosen =
		candidates.find((candidate) => candidate.action !== blocked) ?? null;
	const signals: JsonObject = {
		floorDepth,
		push: input.push ?? null,
		recentActions: [...input.recentActions],
		blockedAction: blocked,
		candidates: candidates.map((candidate) => candidate.action),
		present: [...present],
		sceneGoal: latest?.sceneCard?.change ?? null,
		lineCount: lines.length,
		stallFloors: config.stallFloors,
		clueAgeWarning: config.clueAgeWarning,
	};
	if (chosen === null) return null;
	return {
		action: chosen.action,
		label: DIRECTOR_ACTION_LABELS[chosen.action],
		reason: chosen.reason,
		lineId: chosen.lineId,
		directive: chosen.directive,
		signals: {
			...signals,
			action: chosen.action,
			label: DIRECTOR_ACTION_LABELS[chosen.action],
			reason: chosen.reason,
			lineId: chosen.lineId,
		},
	};
}

/** 玩家这一轮写了具体行动时的让位候选；让位在所有推进档位里都排第一。 */
function playerDirectionCandidate(
	input: DirectorActionInput,
	hot: DirectorLineState | null,
): ActionCandidate | null {
	const length = normalizedLength(input.playerMessage);
	if (length < PLAYER_DIRECTION_MIN_CHARS) return null;
	return {
		action: "yield",
		reason: `玩家这一轮写了 ${length} 个字的具体行动`,
		lineId: hot === null ? null : hot.line.id,
		directive:
			hot === null
				? "玩家已经给出具体行动；本轮以玩家的行动为准。"
				: `玩家已经给出具体行动；此处的局面是：${formatDirectorLine(hot.line)}。`,
	};
}

function formatSceneCard(card: SceneCard): string {
	const wants = card.present
		.map((actor) => `${actor.who}想要${actor.want}`)
		.join("；");
	return `这一场还没有结束：${wants}。这一场结束时应该改变的是：${card.change}`;
}

function catchCandidate(
	hot: DirectorLineState | null,
	card: SceneCard | null,
): ActionCandidate {
	if (card !== null) {
		return {
			action: "catch",
			lineId: hot === null ? null : hot.line.id,
			reason: `这一场结束时应该改变的是「${card.change}」，还没有达成`,
			directive:
				hot === null
					? `${formatSceneCard(card)}。`
					: `${formatSceneCard(card)}；${formatDirectorLine(hot.line)}。`,
		};
	}
	return {
		action: "catch",
		lineId: hot === null ? null : hot.line.id,
		reason: hot === null ? "场面还没有结束" : "场面还没有结束，接住最热的线",
		directive:
			hot === null
				? "这一场还没有结束，眼前的事情还没了结。"
				: `这一场还没有结束：${formatDirectorLine(hot.line)}。`,
	};
}

function escalateCandidate(cold: DirectorLineState | null): ActionCandidate {
	return {
		action: "escalate",
		lineId: cold === null ? null : cold.line.id,
		reason:
			cold === null
				? "这一场已经收尾，下一件事还没有着落"
				: `这一场已经收尾，从最冷的线「${cold.line.id}」取一条阻碍`,
		directive:
			cold === null
				? "这一场已经收尾；下一件事还没有着落。"
				: `局面过于顺利；${cold.line.who}的阻碍找上门来——${cold.line.obstacle}。`,
	};
}

/** 倒计时余量最小的线；没有带倒计时的线时为 null。 */
function soonestCountdownLine(
	lines: readonly DirectorLineState[],
	floorDepth: number,
): { readonly state: DirectorLineState; readonly remaining: number } | null {
	let best: { state: DirectorLineState; remaining: number } | null = null;
	for (const state of lines) {
		const remaining = directorLineRemaining(state, floorDepth);
		if (remaining === null) continue;
		if (best === null || remaining < best.remaining) {
			best = { state, remaining };
		}
	}
	return best;
}

/**
 * 推进三档：推进选接球或加码，快速推进让这一场收尾并转场，
 * 大幅推进跳到下一个倒计时到点的时刻。让位已由调用方排在最前。
 */
function buildPushCandidates(
	input: DirectorActionInput,
	hot: DirectorLineState | null,
): ActionCandidate[] {
	const { push, lines, floors, floorDepth } = input;
	const latest = floors[0] ?? null;
	const sceneEnded = latest?.sceneEnds === true;
	const card = latest?.sceneCard ?? null;
	if (push === "advance") {
		return sceneEnded
			? [
					escalateCandidate(readAnchorLine(lines, "cold")),
					catchCandidate(hot, card),
				]
			: [
					catchCandidate(hot, card),
					escalateCandidate(readAnchorLine(lines, "cold")),
				];
	}
	if (push === "quick") {
		return [
			{
				action: "transition",
				lineId: hot === null ? null : hot.line.id,
				reason:
					card === null
						? "玩家选择了快速推进：让这一场达成目标并转场"
						: `玩家选择了快速推进：让这一场达成目标（${card.change}）并转场`,
				directive:
					card !== null
						? `这一场到此收尾：${card.change}。时间向前走一截。`
						: hot === null
							? "这一场到此收尾；时间向前走一截。"
							: `这一场到此收尾：${formatDirectorLine(hot.line)}。时间向前走一截。`,
			},
			catchCandidate(hot, card),
		];
	}
	const soonest = soonestCountdownLine(lines, floorDepth);
	if (soonest === null) {
		return [
			{
				action: "transition",
				lineId: hot === null ? null : hot.line.id,
				reason: "玩家选择了大幅推进；没有带倒计时的线，时间向前走一截",
				directive:
					hot === null
						? "时间向前跳过一段空白。"
						: `时间向前跳过一段空白；${formatDirectorLine(hot.line)}。`,
			},
			catchCandidate(hot, card),
		];
	}
	return [
		{
			action: "intrude",
			lineId: soonest.state.line.id,
			reason: `玩家选择了大幅推进：跳到线「${soonest.state.line.id}」倒计时到点的时刻（余量 ${soonest.remaining}）`,
			directive: `时间向前跳到线「${soonest.state.line.id}」到点的那一刻：${formatDirectorLine(soonest.state.line)}。`,
		},
		{
			action: "transition",
			lineId: hot === null ? null : hot.line.id,
			reason: "玩家选择了大幅推进；时间向前走一截",
			directive:
				hot === null
					? "时间向前走一截。"
					: `时间向前走一截；${formatDirectorLine(hot.line)}。`,
		},
	];
}

function buildActionCandidates(input: DirectorActionInput): ActionCandidate[] {
	const candidates: ActionCandidate[] = [];
	const { floors, lines, config, floorDepth } = input;
	const latest = floors[0] ?? null;
	const present = latest === null ? [] : latest.present;
	const hot = readAnchorLine(lines, "hot");

	const direction = playerDirectionCandidate(input, hot);
	if (direction !== null) candidates.push(direction);
	if (input.push !== null && input.push !== undefined) {
		candidates.push(...buildPushCandidates(input, hot));
		return candidates;
	}

	let due: DirectorLineState | null = null;
	let dueRemaining: number | null = null;
	for (const state of lines) {
		const remaining = directorLineRemaining(state, floorDepth);
		if (remaining === null || remaining > 0) continue;
		if (due === null || remaining < (dueRemaining as number)) {
			due = state;
			dueRemaining = remaining;
		}
	}
	if (due !== null) {
		candidates.push({
			action: "intrude",
			lineId: due.line.id,
			reason: `线「${due.line.id}」的倒计时到点（余量 ${String(dueRemaining)}）`,
			directive: `${due.line.who}的倒计时到点：${due.line.want}；${due.line.obstacle}。`,
		});
	}

	let promise: DirectorLineState | null = null;
	let promiseAge = 0;
	for (const state of lines) {
		if (state.line.kind !== "promise") continue;
		const age = floorDepth - state.lastTouchedDepth;
		if (age < config.clueAgeWarning) continue;
		if (promise === null || age > promiseAge) {
			promise = state;
			promiseAge = age;
		}
	}
	if (promise !== null) {
		candidates.push({
			action: "fulfill",
			lineId: promise.line.id,
			reason: `伏笔「${promise.line.id}」已经 ${promiseAge} 楼没有被触及，达到 ${config.clueAgeWarning}`,
			directive: `伏笔到兑现的时候：${formatDirectorLine(promise.line)}。`,
		});
	}

	let scheme: DirectorLineState | null = null;
	for (const state of lines) {
		if (state.line.kind !== "opposition") continue;
		if (!present.includes(state.line.who)) continue;
		if (floorDepth - state.lastTouchedDepth > DIRECTOR_REVEAL_HOT_FLOORS) {
			continue;
		}
		if (scheme === null || state.lastTouchedDepth > scheme.lastTouchedDepth) {
			scheme = state;
		}
	}
	if (scheme !== null) {
		candidates.push({
			action: "reveal",
			lineId: scheme.line.id,
			reason: `${scheme.line.who}在场，图谋「${scheme.line.id}」最近 ${floorDepth - scheme.lastTouchedDepth} 楼内被触及`,
			directive: `${scheme.line.who}在场，${scheme.line.want}这件事一直没有说出口。`,
		});
	}

	const idleFloors = consecutiveFloors(
		floors,
		(floor) => floor.stateChanges === 0,
	);
	if (latest?.sceneEnds) {
		candidates.push({
			action: "transition",
			reason: "最近一楼的场记标记这一场已经结束",
			lineId: hot === null ? null : hot.line.id,
			directive:
				hot === null
					? "这一场已经收尾；时间向前走一截。"
					: `这一场已经收尾；${formatDirectorLine(hot.line)}。`,
		});
	} else if (idleFloors >= config.stallFloors) {
		candidates.push({
			action: "transition",
			reason: `连续 ${idleFloors} 楼没有状态变化，达到停滞阈值 ${config.stallFloors}`,
			lineId: hot === null ? null : hot.line.id,
			directive:
				hot === null
					? `连续 ${idleFloors} 楼没有状态变化；时间向前走一截。`
					: `连续 ${idleFloors} 楼没有状态变化；${formatDirectorLine(hot.line)}。`,
		});
	}

	const intenseFloors = consecutiveFloors(
		floors,
		(floor) => floor.stateChanges >= config.tensionStateDiffsPerFloor,
	);
	if (intenseFloors >= DIRECTOR_INTENSE_FLOORS) {
		const where = present.length === 0 ? "" : `${present.join("、")}这里`;
		candidates.push({
			action: "breathe",
			reason: `连续 ${intenseFloors} 楼每楼至少 ${config.tensionStateDiffsPerFloor} 条状态变化`,
			lineId: hot === null ? null : hot.line.id,
			directive:
				where === ""
					? "连续几楼局势紧绷；此刻暂时缓了下来。"
					: `连续几楼局势紧绷；${where}暂时缓了下来。`,
		});
	}

	const smoothFloors = consecutiveFloors(
		floors,
		(floor) => floor.stateChanges === 0,
	);
	const obstacleLine = readAnchorLine(lines, "cold");
	if (smoothFloors >= DIRECTOR_SMOOTH_FLOORS && obstacleLine !== null) {
		candidates.push({
			action: "escalate",
			lineId: obstacleLine.line.id,
			reason: `连续 ${smoothFloors} 楼没有状态变化，从线「${obstacleLine.line.id}」取一条阻碍`,
			directive: `局面过于顺利；${obstacleLine.line.who}的阻碍找上门来——${obstacleLine.line.obstacle}。`,
		});
	}

	const latestCard = latest?.sceneCard ?? null;
	const catchDirective =
		latestCard === null
			? hot === null
				? null
				: `这一场还没有结束：${formatDirectorLine(hot.line)}。`
			: hot === null
				? `${formatSceneCard(latestCard)}。`
				: `${formatSceneCard(latestCard)}；${formatDirectorLine(hot.line)}。`;
	if (catchDirective !== null && (latest === null || !latest.sceneEnds)) {
		candidates.push({
			action: "catch",
			lineId: hot === null ? null : hot.line.id,
			reason:
				latestCard !== null
					? `这一场结束时应该改变的是「${latestCard.change}」，这一场还没有结束`
					: latest === null
						? "还没有场记记录，按场面没有结束处理"
						: "最近一楼的场记没有标记场面结束",
			directive: catchDirective,
		});
	}

	return candidates;
}

/**
 * 读取动作选择的输入：当前路径上的场记观察、线状态、玩家消息与最近用过的动作。
 * 只读数据库，不调用模型。
 */
export function readDirectorActionInput(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	config: DirectorActionConfig,
	push: DirectorPush | null = null,
): DirectorActionInput {
	if (!store.getStory(storyId)) {
		throw new Error(`故事不存在：${storyId}`);
	}
	const node = store.getNode(nodeId);
	if (!node) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	if (node.storyId !== storyId) {
		throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	const path = store.getPathToNode(nodeId);
	const assistantFloors = path.filter((item) => item.role === "assistant");
	const window = assistantFloors.slice(-DIRECTOR_ACTION_FLOOR_WINDOW);
	const floors = [...window].reverse().map((item): DirectorActionFloor => {
		const scene = store.getSceneLog(item.id);
		return {
			beat: scene === null ? null : scene.beat,
			present: scene === null ? [] : scene.present,
			sceneEnds: scene === null ? false : scene.sceneEnds,
			sceneCard: scene === null ? null : scene.sceneCard,
			stateChanges: store.getStateDiffs(item.id).length,
		};
	});
	const lastPlayer = [...path].reverse().find((item) => item.role === "user");
	const recentActions: DirectorActionKind[] = [];
	for (const decision of store.getDirectorDecisionsAlongPath(nodeId)) {
		if (decision.nodeId === nodeId) continue;
		const action = decision.signals.action;
		if (!isDirectorActionKind(action)) continue;
		recentActions.push(action);
	}
	return {
		floorDepth: assistantFloors.length,
		playerMessage: lastPlayer === undefined ? null : lastPlayer.raw,
		push,
		floors,
		lines: store.readDirectorLineStates(nodeId),
		recentActions: recentActions.slice(-MAX_CONSECUTIVE_DIRECTOR_ACTIONS + 1),
		config,
	};
}
