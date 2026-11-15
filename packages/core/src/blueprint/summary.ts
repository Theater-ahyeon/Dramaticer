import type { DirectorLineState } from "../director/lines.js";
import {
	type MilestoneProgress,
	readMilestoneProgress,
	selectActiveMilestone,
} from "./milestones.js";
import {
	type BlueprintEntry,
	type BlueprintMilestone,
	type BlueprintVolume,
	assertBlueprintEntries,
} from "./story-blueprint.js";

/** 写作上下文能看到的蓝图摘要；完整蓝图只留在导演层。 */
export interface WritingBlueprintSummary {
	/** 当前卷；蓝图里没有卷时为 null。 */
	readonly volume: {
		readonly id: string;
		readonly title: string;
		readonly coreQuestion: string;
	} | null;
	/** 最近一个未达成里程碑；没有未达成里程碑时为 null。 */
	readonly milestone: {
		readonly id: string;
		readonly want: string;
	} | null;
	/** 还没有写进伏笔账的前提条件，按蓝图里的顺序。 */
	readonly seeds: readonly string[];
}

export interface FormattedBlueprintSummary {
	readonly text: string;
	readonly source: string;
}

function toVolumeSummary(
	volume: BlueprintVolume,
): WritingBlueprintSummary["volume"] {
	return {
		id: volume.id,
		title: volume.title,
		coreQuestion: volume.coreQuestion,
	};
}

function findVolume(
	entries: readonly BlueprintEntry[],
	volumeId: string,
): BlueprintVolume | null {
	const found = entries.find(
		(entry): entry is BlueprintVolume =>
			entry.kind === "volume" && entry.id === volumeId,
	);
	return found ?? null;
}

/**
 * 当前卷取最近一个未达成里程碑所属的卷；全部达成时取规划顺序里最后一个
 * 里程碑的卷，没有里程碑时取 id 最小的卷。任何一档都只给出卷的核心问题。
 */
function selectCurrentVolume(
	entries: readonly BlueprintEntry[],
	progress: readonly MilestoneProgress[],
	active: MilestoneProgress | null,
): WritingBlueprintSummary["volume"] {
	const planned: BlueprintMilestone | null =
		active?.milestone ?? progress.at(-1)?.milestone ?? null;
	if (planned !== null) {
		const volume = findVolume(entries, planned.volumeId);
		if (volume !== null) return toVolumeSummary(volume);
	}
	const volumes = entries
		.filter((entry): entry is BlueprintVolume => entry.kind === "volume")
		.sort((left, right) =>
			left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
		);
	const first = volumes[0];
	return first === undefined ? null : toVolumeSummary(first);
}

/**
 * 从蓝图与伏笔账读出写作摘要。完整蓝图不进入返回值：只取当前卷的核心问题、
 * 最近一个里程碑的方向与还没写进伏笔账的前提条件。
 */
export function readWritingBlueprintSummary(
	entries: readonly BlueprintEntry[],
	states: readonly DirectorLineState[],
	historyLineIds: readonly string[],
): WritingBlueprintSummary | null {
	const parsed = assertBlueprintEntries(entries, "写作上下文之前的蓝图");
	if (parsed.length === 0) return null;
	const progress = readMilestoneProgress(parsed, states, historyLineIds);
	const active = selectActiveMilestone(progress);
	const seeds =
		active === null
			? []
			: active.milestone.prerequisites.filter((_prerequisite, index) =>
					active.missingLineIds.includes(active.lineIds[index] as string),
				);
	return {
		volume: selectCurrentVolume(parsed, progress, active),
		milestone:
			active === null
				? null
				: { id: active.milestone.id, want: active.milestone.want },
		seeds,
	};
}

/**
 * 拼成注入文本；三项都没有可写内容时返回 null，调用方据此不产生空段。
 * `source` 只写卷与里程碑的 id 和待埋条数，不写条目原文。
 */
export function formatWritingBlueprintSummary(
	summary: WritingBlueprintSummary,
): FormattedBlueprintSummary | null {
	const blocks: string[] = [];
	if (summary.volume !== null) {
		const { title, coreQuestion } = summary.volume;
		if (title.length > 0 || coreQuestion.length > 0) {
			const head = title.length === 0 ? "当前卷" : `当前卷：${title}`;
			blocks.push(
				coreQuestion.length === 0
					? head
					: `${head}（核心问题：${coreQuestion}）`,
			);
		}
	}
	if (summary.milestone !== null && summary.milestone.want.length > 0) {
		blocks.push(`最近的里程碑：${summary.milestone.want}`);
	}
	if (summary.seeds.length > 0) {
		blocks.push(
			`本章该埋的线：\n${summary.seeds.map((seed) => `- ${seed}`).join("\n")}`,
		);
	}
	if (blocks.length === 0) return null;
	return {
		text: `蓝图摘要：\n${blocks.join("\n")}`,
		source: `blueprint:卷 ${summary.volume?.id ?? "无"}，里程碑 ${summary.milestone?.id ?? "无"}，待埋 ${summary.seeds.length} 条`,
	};
}
