import type { LlmClient } from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";
import type {
	BackgroundJob,
	BackgroundJobRegistry,
	BackgroundJobStatus,
} from "./types.js";

export const MAX_BACKGROUND_JOB_ATTEMPTS = 3;
export const DEFAULT_BACKGROUND_JOB_LIMIT = 20;
export const MAX_BACKGROUND_JOB_LIMIT = 1_000;

export interface EnqueueMissingJobsOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly kinds: readonly string[];
	readonly now?: () => number;
}

/** 为已确认楼层补建指定类型的任务；重复调用不产生重复行。 */
export function enqueueMissingJobs(
	options: EnqueueMissingJobsOptions,
): BackgroundJob[] {
	const now = options.now ?? Date.now;
	return options.store.enqueueMissingBackgroundJobs({
		storyId: options.storyId,
		kinds: options.kinds,
		createdAt: new Date(now()).toISOString(),
	});
}

export interface DrainBackgroundJobsOptions {
	readonly store: StoryStore;
	readonly registry: BackgroundJobRegistry;
	readonly client: LlmClient;
	readonly storyId: string;
	/** 只处理这些类型；不设置时使用注册表里的全部类型。 */
	readonly kinds?: readonly string[];
	readonly limit?: number;
	readonly maxAttempts?: number;
	readonly now?: () => number;
}

export interface BackgroundJobRun {
	readonly jobId: number;
	readonly nodeId: string;
	readonly kind: string;
	readonly status: BackgroundJobStatus;
	readonly attempts: number;
	readonly error: string | null;
}

export interface BackgroundDrainResult {
	/** 本轮补建的任务数。 */
	readonly enqueued: number;
	readonly runs: readonly BackgroundJobRun[];
}

/**
 * 补齐缺失任务后按创建顺序执行一轮。每个任务本轮最多执行一次；
 * 失败的任务退回 pending，累计执行次数达到上限后标为 failed。
 */
export async function drainBackgroundJobs(
	options: DrainBackgroundJobsOptions,
): Promise<BackgroundDrainResult> {
	const { store, registry, storyId } = options;
	if (!store.getStory(storyId)) {
		throw new Error(`故事不存在：${storyId}`);
	}
	const kinds = resolveKinds(registry, options.kinds);
	const limit = options.limit ?? DEFAULT_BACKGROUND_JOB_LIMIT;
	if (
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > MAX_BACKGROUND_JOB_LIMIT
	) {
		throw new Error(
			`后台任务条数必须是 1 到 ${MAX_BACKGROUND_JOB_LIMIT} 之间的整数`,
		);
	}
	const maxAttempts = options.maxAttempts ?? MAX_BACKGROUND_JOB_ATTEMPTS;
	if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
		throw new Error("后台任务的最大执行次数必须是正整数");
	}
	const now = options.now ?? Date.now;

	const enqueued = enqueueMissingJobs({
		store,
		storyId,
		kinds,
		now,
	});
	const pending = store.listBackgroundJobs({
		storyId,
		status: "pending",
		kinds,
		limit,
	});
	const runs: BackgroundJobRun[] = [];
	for (const job of pending) {
		const handler = registry.get(job.kind);
		if (handler === undefined) {
			throw new Error(`没有注册后台任务类型 ${job.kind}`);
		}
		const running = store.startBackgroundJob(
			job.id,
			new Date(now()).toISOString(),
		);
		try {
			await handler({ store, client: options.client, job: running });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const failed = store.failBackgroundJob(job.id, {
				error: message.length > 0 ? message : "后台任务执行失败",
				maxAttempts,
				finishedAt: new Date(now()).toISOString(),
			});
			runs.push({
				jobId: failed.id,
				nodeId: failed.nodeId,
				kind: failed.kind,
				status: failed.status,
				attempts: failed.attempts,
				error: failed.lastError,
			});
			continue;
		}
		const done = store.finishBackgroundJob(
			job.id,
			new Date(now()).toISOString(),
		);
		runs.push({
			jobId: done.id,
			nodeId: done.nodeId,
			kind: done.kind,
			status: done.status,
			attempts: done.attempts,
			error: done.lastError,
		});
	}
	return { enqueued: enqueued.length, runs };
}

function resolveKinds(
	registry: BackgroundJobRegistry,
	requested: readonly string[] | undefined,
): string[] {
	const kinds: string[] = [];
	for (const kind of requested ?? [...registry.keys()]) {
		if (typeof kind !== "string" || kind.length === 0) {
			throw new Error("后台任务类型必须是非空字符串");
		}
		if (!registry.has(kind)) {
			throw new Error(`没有注册后台任务类型 ${kind}`);
		}
		if (kinds.includes(kind)) {
			throw new Error(`后台任务类型重复：${kind}`);
		}
		kinds.push(kind);
	}
	return kinds;
}
