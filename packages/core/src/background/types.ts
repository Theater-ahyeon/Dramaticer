import type { LlmClient } from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";

export type BackgroundJobStatus =
	| "pending"
	| "running"
	| "done"
	| "failed"
	/** 任务所在楼层已经不在当前 head 路径上，执行前被丢弃。 */
	| "discarded";

/** 每个状态的任务条数。 */
export interface BackgroundJobCounts {
	readonly pending: number;
	readonly running: number;
	readonly done: number;
	readonly failed: number;
	readonly discarded: number;
}

/**
 * 任务档位：gap 是下一轮开始前要用的工作，deferred 可以等到长间隙或
 * 会话结束后再执行。
 */
export const BACKGROUND_JOB_TIERS = ["gap", "deferred"] as const;
export type BackgroundJobTier = (typeof BACKGROUND_JOB_TIERS)[number];

export function isBackgroundJobTier(
	value: unknown,
): value is BackgroundJobTier {
	return (
		typeof value === "string" &&
		(BACKGROUND_JOB_TIERS as readonly string[]).includes(value)
	);
}

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

/**
 * 处理器抛出它表示依赖的任务还没完成：任务退回 pending，并且不消耗执行次数。
 */
export class BackgroundJobDeferredError extends Error {
	constructor(message = "后台任务的依赖还没有完成，下一轮再试") {
		super(message);
		this.name = "BackgroundJobDeferredError";
	}
}

export type BackgroundJobHandler = (
	context: BackgroundJobContext,
) => Promise<void> | void;

/** 一种后台任务类型：处理器加上它的入队条件与档位。 */
export interface BackgroundJobType {
	readonly handler: BackgroundJobHandler;
	readonly enqueue: BackgroundJobEnqueueCondition;
	readonly tier: BackgroundJobTier;
}

/** 任务类型到任务定义的映射；drain 按这里的类型补齐任务。 */
export type BackgroundJobRegistry = ReadonlyMap<string, BackgroundJobType>;
