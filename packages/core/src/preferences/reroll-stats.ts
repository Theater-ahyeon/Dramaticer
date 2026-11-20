import {
	type DirectorInterferenceStats,
	readDirectorInterferenceStats,
} from "../director/interference.js";
import type { StoryStore } from "../store/story-store.js";
import {
	REROLL_REASONS,
	REROLL_REASON_LABELS,
	type RerollReason,
	isRerollReason,
} from "./reroll.js";

// 北极星指标（DESIGN §14.1，refactor/04）：每百楼带原因重写率。只读已有的偏好记录
// （swipe 事件）与楼层树，不新增存储，不调用模型；报告只有数字，没有原文。

/** 前几楼单独统计：开局的重写多半在调卡，和之后的稳定期分开看。 */
export const EARLY_FLOOR_LIMIT = 10;

export type RerollRateReason = RerollReason | "none";

export interface RerollRateRow {
	readonly reason: RerollRateReason;
	readonly label: string;
	/** 1–10 楼里的重写次数。 */
	readonly early: number;
	/** 10 楼之后的重写次数。 */
	readonly late: number;
}

export interface RerollRateSpan {
	/** 这一段当前路径上的回复楼层数。 */
	readonly floors: number;
	readonly rerolls: number;
	/** 每百楼重写次数；没有楼层时为 0。 */
	readonly perHundred: number;
}

export interface RerollRateReport {
	readonly storyId: string;
	readonly early: RerollRateSpan;
	readonly late: RerollRateSpan;
	readonly total: RerollRateSpan;
	/** 按原因分开；顺序固定，最后一行是「未选原因」。 */
	readonly reasons: readonly RerollRateRow[];
	/** 导演开、关两组的干扰统计（「没听我的」「别推这条线」）。 */
	readonly interference: DirectorInterferenceStats;
}

function span(floors: number, rerolls: number): RerollRateSpan {
	return {
		floors,
		rerolls,
		perHundred: floors === 0 ? 0 : Math.round((rerolls / floors) * 1000) / 10,
	};
}

export function readRerollRates(
	store: StoryStore,
	storyId: string,
): RerollRateReport {
	if (!store.getStory(storyId)) throw new Error(`故事不存在：${storyId}`);
	const nodes = store.listStoryNodes(storyId);
	const byId = new Map(nodes.map((node) => [node.id, node] as const));
	// 楼号：从根到这一楼路径上的回复楼层数（swipe 产生的兄弟楼层同号）。
	const floorNumber = new Map<string, number>();
	const numberOf = (id: string): number => {
		const known = floorNumber.get(id);
		if (known !== undefined) return known;
		const node = byId.get(id);
		if (node === undefined) return 0;
		const parent = node.parentId === null ? 0 : numberOf(node.parentId);
		const value = parent + (node.role === "assistant" ? 1 : 0);
		floorNumber.set(id, value);
		return value;
	};

	const head = store.getHead(storyId);
	const committed =
		head === null
			? 0
			: store.getPathToNode(head.id).filter((node) => node.role === "assistant")
					.length;
	const earlyFloors = Math.min(committed, EARLY_FLOOR_LIMIT);
	const lateFloors = Math.max(0, committed - EARLY_FLOOR_LIMIT);

	const counts = new Map<RerollRateReason, { early: number; late: number }>();
	for (const reason of [...REROLL_REASONS, "none" as const]) {
		counts.set(reason, { early: 0, late: 0 });
	}
	for (const event of store.listPreferenceEvents(storyId, { kind: "swipe" })) {
		const payload = event.payload as {
			readonly abandonedNodeId?: string;
			readonly reason?: unknown;
		};
		const reason: RerollRateReason = isRerollReason(payload.reason)
			? payload.reason
			: "none";
		const floor =
			payload.abandonedNodeId === undefined
				? 0
				: numberOf(payload.abandonedNodeId);
		const bucket = counts.get(reason);
		if (bucket === undefined) continue;
		if (floor > 0 && floor <= EARLY_FLOOR_LIMIT) bucket.early += 1;
		else bucket.late += 1;
	}
	const reasons: RerollRateRow[] = [...counts.entries()].map(
		([reason, count]) => ({
			reason,
			label: reason === "none" ? "未选原因" : REROLL_REASON_LABELS[reason],
			...count,
		}),
	);
	const earlyTotal = reasons.reduce((sum, row) => sum + row.early, 0);
	const lateTotal = reasons.reduce((sum, row) => sum + row.late, 0);
	return {
		storyId,
		early: span(earlyFloors, earlyTotal),
		late: span(lateFloors, lateTotal),
		total: span(committed, earlyTotal + lateTotal),
		reasons,
		interference: readDirectorInterferenceStats(store, storyId),
	};
}

/** 命令行用的纯文本表；只有数字和原因名。 */
export function formatRerollRates(report: RerollRateReport): string {
	const per = (count: number, floors: number) =>
		floors === 0 ? "—" : ((count / floors) * 100).toFixed(1);
	const lines = [
		`故事 ${report.storyId}：${report.total.floors} 楼，重写 ${report.total.rerolls} 次，每百楼 ${report.total.perHundred}`,
		`  1–${EARLY_FLOOR_LIMIT} 楼：${report.early.floors} 楼，${report.early.rerolls} 次，每百楼 ${report.early.perHundred}`,
		`  之后：${report.late.floors} 楼，${report.late.rerolls} 次，每百楼 ${report.late.perHundred}`,
		"  原因              1–10 楼（每百楼）  之后（每百楼）",
	];
	for (const row of report.reasons) {
		lines.push(
			`  ${row.label.padEnd(8, "　")}  ${String(row.early).padStart(4)}（${per(row.early, report.early.floors)}）  ${String(row.late).padStart(4)}（${per(row.late, report.late.floors)}）`,
		);
	}
	const group = (
		name: string,
		value: DirectorInterferenceStats["directorOn"],
	) =>
		`  导演${name}：${value.floors} 楼，没听我的 ${value.ignoredInstruction}，别推这条线 ${value.avoidLine}，占比 ${(value.ratio * 100).toFixed(1)}%`;
	lines.push(group("开", report.interference.directorOn));
	lines.push(group("关", report.interference.directorOff));
	return lines.join("\n");
}
