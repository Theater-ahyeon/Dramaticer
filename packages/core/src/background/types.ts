import type { LlmClient } from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";

export type BackgroundJobStatus = "pending" | "running" | "done" | "failed";

/**
 * 入队条件：confirmed 要求楼层已有子节点（旧行为），settled 只要求助手楼层
 * 的正文已经生成完成，不要求玩家已经确认。
 */
export const BACKGROUND_JOB_ENQUEUE_CONDITIONS = [
	"confirmed",
	"settled",
] as const;
export type BackgroundJobEnqueueCondition =
	(typeof BACKGROUND_JOB_ENQUEUE_CONDITIONS)[number];

export function isBackgroundJobEnqueueCondition(
	value: unknown,
): value is BackgroundJobEnqueueCondition {
	return (
		typeof value === "string" &&
		(BACKGROUND_JOB_ENQUEUE_CONDITIONS as readonly string[]).includes(value)
	);
}

export interface BackgroundJob {
	readonly id: number;
	readonly storyId: string;
	readonly nodeId: string;
	readonly kind: string;
	readonly status: BackgroundJobStatus;
	/** 已开始执行的次数；每次执行前加一。 */
	readonly attempts: number;
	/** 最近一次失败的错误信息；重试成功后清空。 */
	readonly lastError: string | null;
	readonly createdAt: string;
	readonly startedAt: string | null;
	readonly finishedAt: string | null;
}

export interface BackgroundJobContext {
	readonly store: StoryStore;
	readonly client: LlmClient;
	readonly job: BackgroundJob;
}

export type BackgroundJobHandler = (
	context: BackgroundJobContext,
) => Promise<void> | void;

/** 一种后台任务类型：处理器加上它的入队条件。 */
export interface BackgroundJobType {
	readonly handler: BackgroundJobHandler;
	readonly enqueue: BackgroundJobEnqueueCondition;
}

/** 任务类型到任务定义的映射；drain 按这里的类型补齐任务。 */
export type BackgroundJobRegistry = ReadonlyMap<string, BackgroundJobType>;
