import type { BackgroundJob } from "../background/types.js";
import type { StoryStore } from "../store/story-store.js";
import {
	OPENING_CANDIDATES_JOB_KIND,
	openingCandidatesNeedRun,
} from "./candidates.js";
import { OPENING_JOB_KIND, openingPackNeedsRun } from "./opening.js";

/**
 * 故事创建与导入卡之后入队开局包与开场候选两条故事级任务。
 * 是否真的需要由各自的 needsRun 决定；素材不足时两条都不入队。
 */
export function enqueueOpeningBackgroundJobs(
	store: StoryStore,
	storyId: string,
): BackgroundJob[] {
	const kinds: string[] = [];
	if (openingPackNeedsRun(store, storyId)) kinds.push(OPENING_JOB_KIND);
	if (openingCandidatesNeedRun(store, storyId)) {
		kinds.push(OPENING_CANDIDATES_JOB_KIND);
	}
	if (kinds.length === 0) return [];
	return store.enqueueStoryBackgroundJobs({ storyId, kinds });
}
