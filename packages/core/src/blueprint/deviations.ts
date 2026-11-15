import {
	type DirectorLineState,
	collectDirectorLineHistoryIds,
} from "../director/lines.js";
import type { StoryStore } from "../store/story-store.js";
import { readMilestoneProgress } from "./milestones.js";
import type { BlueprintEntry } from "./story-blueprint.js";

/** 章末检查的里程碑四态。 */
export const MILESTONE_DEVIATION_STATES = [
	"achieved",
	"reachable",
	"blocked",
	"lost",
] as const;

export type MilestoneDeviationState =
	(typeof MILESTONE_DEVIATION_STATES)[number];

export const MILESTONE_DEVIATION_STATE_LABELS: Record<
	MilestoneDeviationState,
	string
> = {
	achieved: "已达成",
	reachable: "仍可达",
	blocked: "受阻",
	lost: "已不可能",
};

/** 受阻或已不可能时给玩家的三个选择；系统不替玩家选，也不改写蓝图。 */
export const MILESTONE_DEVIATION_OPTIONS = [
	"adjust-blueprint",
	"pull-back",
	"abandon",
] as const;

export type MilestoneDeviationOption =
	(typeof MILESTONE_DEVIATION_OPTIONS)[number];

export const MILESTONE_DEVIATION_OPTION_LABELS: Record<
	MilestoneDeviationOption,
	string
> = {
	"adjust-blueprint": "调整蓝图",
	"pull-back": "把剧情拉回",
	abandon: "放弃",
};

/** 一个里程碑在章末的检查结果；只有受阻与已不可能带三个选择。 */
export interface MilestoneDeviation {
	readonly milestoneId: string;
	readonly state: MilestoneDeviationState;
	readonly reason: string;
	readonly options: readonly MilestoneDeviationOption[];
}

export interface MilestoneDeviationInput {
	/** 章末清点里声明 `retire` 的伏笔线 id。 */
	readonly retiredLineIds: readonly string[];
	/** 当前路径上的助手楼层数。 */
	readonly floorDepth: number;
	/** 铺垫线多少楼没有被触及算受阻；与导演的兑现阈值同一个配置。 */
	readonly clueAgeWarning: number;
}

function assertNonNegativeInteger(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${label} 必须是非负整数`);
	}
}

/**
 * 逐条判定里程碑状态：
 * - 有前提条件被章末清点作废 → 已不可能；
 * - 前提条件都写进过伏笔账而且都已关闭 → 已达成；
 * - 没有前提条件 → 仍可达（无法由伏笔账证明）；
 * - 还开着的铺垫达到警告线 → 受阻；
 * - 其余 → 仍可达。
 */
export function checkMilestoneDeviation(
	entries: readonly BlueprintEntry[],
	states: readonly DirectorLineState[],
	historyLineIds: readonly string[],
	input: MilestoneDeviationInput,
): MilestoneDeviation[] {
	assertNonNegativeInteger(input.floorDepth, "偏离检查的 floorDepth");
	assertNonNegativeInteger(input.clueAgeWarning, "偏离检查的 clueAgeWarning");
	const retired = new Set(input.retiredLineIds);
	const byLineId = new Map(
		states.map((state) => [state.line.id, state] as const),
	);
	const progress = readMilestoneProgress(entries, states, historyLineIds);
	return progress.map((item) => {
		const retiredLines = item.lineIds.filter((id) => retired.has(id));
		if (retiredLines.length > 0) {
			return {
				milestoneId: item.milestone.id,
				state: "lost",
				reason: `铺垫线 ${retiredLines.join("、")} 在章末清点里被作废`,
				options: [...MILESTONE_DEVIATION_OPTIONS],
			};
		}
		if (item.reached) {
			return {
				milestoneId: item.milestone.id,
				state: "achieved",
				reason: `${item.lineIds.length} 条前提条件都写进过伏笔账并且都已关闭`,
				options: [],
			};
		}
		if (item.lineIds.length === 0) {
			return {
				milestoneId: item.milestone.id,
				state: "reachable",
				reason: "这个里程碑没有前提条件，无法由伏笔账判断进展",
				options: [],
			};
		}
		const staleLineIds = item.openLineIds.filter((id) => {
			const state = byLineId.get(id);
			return (
				state !== undefined &&
				input.floorDepth - state.lastTouchedDepth >= input.clueAgeWarning
			);
		});
		if (staleLineIds.length > 0) {
			return {
				milestoneId: item.milestone.id,
				state: "blocked",
				reason: `铺垫线 ${staleLineIds.join("、")} 已经至少 ${input.clueAgeWarning} 楼没有被触及`,
				options: [...MILESTONE_DEVIATION_OPTIONS],
			};
		}
		return {
			milestoneId: item.milestone.id,
			state: "reachable",
			reason:
				item.missingLineIds.length > 0
					? `还有 ${item.missingLineIds.length} 条前提条件没有写进伏笔账`
					: "铺垫还开着，最近有推进",
			options: [],
		};
	});
}

/**
 * 章末读取当前路径的蓝图、伏笔账与章末清点，得到每个里程碑的状态。
 * 只读，不写数据库，也不改写蓝图。
 */
export function readMilestoneDeviation(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): MilestoneDeviation[] {
	if (store.getStory(storyId) === null) {
		throw new Error(`故事不存在：${storyId}`);
	}
	const node = store.getNode(nodeId);
	if (node === null) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	if (node.storyId !== storyId) {
		throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	const path = store.getPathToNode(nodeId);
	const retiredLineIds = store
		.listDirectorChapterReviewsAlongPath(nodeId)
		.flatMap((review) =>
			review.payload.promises
				.filter((decision) => decision.disposition === "retire")
				.map((decision) => decision.lineId),
		);
	return checkMilestoneDeviation(
		store.readBlueprintEntries(nodeId),
		store.readDirectorLineStates(nodeId),
		collectDirectorLineHistoryIds(store.listDirectorLinesAlongPath(nodeId)),
		{
			retiredLineIds,
			floorDepth: path.filter((item) => item.role === "assistant").length,
			clueAgeWarning:
				store.getStorySettings(storyId).directorConfig.clueAgeWarning,
		},
	);
}
