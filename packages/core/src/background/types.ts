import type { LlmClient } from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";

export type BackgroundJobStatus = "pending" | "running" | "done" | "failed";

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

/** 任务类型到处理器的映射；drain 按这里的类型补齐任务。 */
export type BackgroundJobRegistry = ReadonlyMap<string, BackgroundJobHandler>;
