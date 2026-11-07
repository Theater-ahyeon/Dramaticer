import type { StoryStore } from "../store/story-store.js";
import type { BackgroundJobCounts } from "./types.js";

/** 关键间隙工作的积压情况。 */
export interface GapWorkBacklog {
	readonly counts: BackgroundJobCounts;
	/** 下一轮开始前还没做完的比例：未完成占全部有效任务，没有任务时为 0。 */
	readonly unfinishedRatio: number;
}

/**
 * 读出关键间隙工作的完成情况。被丢弃的任务不再属于当前路径，不计入比例。
 */
export function readGapWorkBacklog(
	store: StoryStore,
	storyId: string,
	kinds: readonly string[],
): GapWorkBacklog {
	const counts = store.countBackgroundJobs({ storyId, kinds });
	const unfinished = counts.pending + counts.running;
	const total = unfinished + counts.done + counts.failed;
	return {
		counts,
		unfinishedRatio: total === 0 ? 0 : unfinished / total,
	};
}
