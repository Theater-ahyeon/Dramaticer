import { createHash } from "node:crypto";
import type {
	DirectorLine,
	DirectorLineDiff,
	DirectorLineState,
} from "../director/lines.js";
import {
	type BlueprintEntry,
	type BlueprintMilestone,
	assertBlueprintEntries,
} from "./story-blueprint.js";

/** 里程碑的前提条件生成的伏笔线 id 前缀。 */
export const MILESTONE_PROMISE_LINE_ID_PREFIX = "milestone.";

/** id 摘要取十六进制字符数；加上前缀仍在线的 id 上限之内。 */
const MILESTONE_LINE_ID_HASH_CHARS = 16;

/** 前提条件的伏笔线在伏笔账里固定写成这句阻碍。 */
const MILESTONE_PROMISE_OBSTACLE = "还没有铺垫好";

/**
 * 一条前提条件对应一条稳定的伏笔线：id 由里程碑 id 与条件文本取摘要，
 * 条件顺序变化或同批其它条件增删都不会换 id。
 */
export function milestonePromiseLineId(
	milestoneId: string,
	prerequisite: string,
): string {
	if (milestoneId.trim().length === 0) {
		throw new Error("里程碑 id 必须是非空字符串");
	}
	if (prerequisite.trim().length === 0) {
		throw new Error("里程碑的前提条件必须是非空字符串");
	}
	const digest = createHash("sha256")
		.update(`${milestoneId}\u0000${prerequisite}`)
		.digest("hex")
		.slice(0, MILESTONE_LINE_ID_HASH_CHARS);
	return `${MILESTONE_PROMISE_LINE_ID_PREFIX}${digest}`;
}

/** 把一条前提条件写成伏笔账里的 promise 线。 */
export function milestonePromiseLine(
	milestone: BlueprintMilestone,
	prerequisiteIndex: number,
): DirectorLine {
	const prerequisite = milestone.prerequisites[prerequisiteIndex];
	if (prerequisite === undefined) {
		throw new Error(
			`里程碑 ${milestone.id} 没有第 ${prerequisiteIndex} 条前提条件`,
		);
	}
	return {
		id: milestonePromiseLineId(milestone.id, prerequisite),
		kind: "promise",
		who: `里程碑 ${milestone.id}`,
		want: prerequisite,
		obstacle: MILESTONE_PROMISE_OBSTACLE,
		countdown: null,
		preparations: [],
	};
}

/** 一个里程碑在伏笔账里的进展。 */
export interface MilestoneProgress {
	readonly milestone: BlueprintMilestone;
	/** 与 `prerequisites` 一一对应的线 id。 */
	readonly lineIds: readonly string[];
	/** 还没有出现在当前路径上的线 id；这些是程序要补写的。 */
	readonly missingLineIds: readonly string[];
	/** 当前仍然打开的铺垫线。 */
	readonly openLineIds: readonly string[];
	/**
	 * 前提条件都写过而且都已经关闭。没有前提条件的里程碑无法由伏笔账
	 * 证明达成，这里恒为 false，章级规划会继续把它当作最近的方向。
	 */
	readonly reached: boolean;
}

/**
 * 里程碑按 `after` 排先后；同一层内按 id 排序，保证同一份蓝图的顺序稳定。
 * `after` 的引用存在且不成环已由 `assertBlueprintEntries` 校验。
 */
export function orderMilestonesForPlanning(
	milestones: readonly BlueprintMilestone[],
): BlueprintMilestone[] {
	const byId = new Map(milestones.map((entry) => [entry.id, entry] as const));
	const pending = new Set(byId.keys());
	const done = new Set<string>();
	const ordered: BlueprintMilestone[] = [];
	while (pending.size > 0) {
		const ready = [...pending]
			.filter((id) =>
				(byId.get(id) as BlueprintMilestone).after.every((afterId) =>
					done.has(afterId),
				),
			)
			.sort();
		if (ready.length === 0) {
			throw new Error("里程碑的先后约束成环，无法排出规划顺序");
		}
		for (const id of ready) {
			ordered.push(byId.get(id) as BlueprintMilestone);
			done.add(id);
			pending.delete(id);
		}
	}
	return ordered;
}

/**
 * 按蓝图层面的里程碑顺序算出每条的铺垫进展。`historyLineIds` 是当前路径上
 * 出现过的全部线 id：已经关闭的铺垫线不会再被补写。
 */
export function readMilestoneProgress(
	entries: readonly BlueprintEntry[],
	states: readonly DirectorLineState[],
	historyLineIds: readonly string[],
	label = "里程碑铺垫",
): MilestoneProgress[] {
	const parsed = assertBlueprintEntries(entries, `${label}之前的蓝图`);
	const openLineIds = new Set(states.map((state) => state.line.id));
	const history = new Set(historyLineIds);
	const milestones = parsed.filter(
		(entry): entry is BlueprintMilestone => entry.kind === "milestone",
	);
	return orderMilestonesForPlanning(milestones).map((milestone) => {
		const lineIds = milestone.prerequisites.map((prerequisite) =>
			milestonePromiseLineId(milestone.id, prerequisite),
		);
		const missingLineIds = lineIds.filter((id) => !history.has(id));
		const openIds = lineIds.filter((id) => openLineIds.has(id));
		return {
			milestone,
			lineIds,
			missingLineIds,
			openLineIds: openIds,
			reached:
				milestone.prerequisites.length > 0 &&
				missingLineIds.length === 0 &&
				openIds.length === 0,
		};
	});
}

/** 最近一个未达成的里程碑；全部达成或者没有里程碑时为 null。 */
export function selectActiveMilestone(
	progress: readonly MilestoneProgress[],
): MilestoneProgress | null {
	return progress.find((item) => !item.reached) ?? null;
}

/** 读取蓝图与伏笔账，直接得到章级规划要用的里程碑。 */
export function readActiveMilestone(
	entries: readonly BlueprintEntry[],
	states: readonly DirectorLineState[],
	historyLineIds: readonly string[],
): MilestoneProgress | null {
	return selectActiveMilestone(
		readMilestoneProgress(entries, states, historyLineIds),
	);
}

/** 把还没写进伏笔账的前提条件补成 promise 线。 */
export function planMilestonePromiseDiffs(
	active: MilestoneProgress | null,
): DirectorLineDiff[] {
	if (active === null) return [];
	const missing = new Set(active.missingLineIds);
	const diffs: DirectorLineDiff[] = [];
	for (
		let index = 0;
		index < active.milestone.prerequisites.length;
		index += 1
	) {
		const line = milestonePromiseLine(active.milestone, index);
		if (missing.has(line.id)) diffs.push({ action: "set", line });
	}
	return diffs;
}
