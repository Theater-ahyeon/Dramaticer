import type { LlmClient } from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";
import {
	type BackgroundJob,
	BackgroundJobDeferredError,
	type BackgroundJobEnqueueCondition,
	type BackgroundJobRegistry,
	type BackgroundJobStatus,
} from "./types.js";

export const MAX_BACKGROUND_JOB_ATTEMPTS = 3;
export const DEFAULT_BACKGROUND_JOB_LIMIT = 20;
export const MAX_BACKGROUND_JOB_LIMIT = 1_000;

export interface EnqueueMissingJobsOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly kinds: readonly string[];
	/** 每种任务类型的入队条件；缺省为 confirmed。 */
	readonly conditions?: Readonly<Record<string, BackgroundJobEnqueueCondition>>;
	readonly now?: () => number;
}

/** 按任务类型的入队条件补建任务；重复调用不产生重复行。 */
export function enqueueMissingJobs(
	options: EnqueueMissingJobsOptions,
): BackgroundJob[] {
	const now = options.now ?? Date.now;
	return options.store.enqueueMissingBackgroundJobs({
		storyId: options.storyId,
		kinds: options.kinds,
		conditions: options.conditions,
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
	/** 本轮离上一次回复落定的秒数；不传时按 0 算。 */
	readonly gapSeconds?: number;
	/** 会话已经结束：不看间隙长短，可延后档同样执行。 */
	readonly sessionEnded?: boolean;
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
	/** 本轮因为楼层不在当前路径上而丢弃的任务数。 */
	readonly discarded: number;
	readonly runs: readonly BackgroundJobRun[];
}

/**
 * 补齐缺失任务后按创建顺序执行一轮。每个任务本轮最多执行一次；
 * 失败的任务退回 pending，累计执行次数达到上限后标为 failed。
 * 可延后档只在长间隙或会话结束后执行；楼层已经不在当前路径上的任务直接丢弃。
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
	const gapSeconds = options.gapSeconds ?? 0;
	if (
		typeof gapSeconds !== "number" ||
		!Number.isFinite(gapSeconds) ||
		gapSeconds < 0
	) {
		throw new Error("本轮间隙秒数必须是非负数字");
	}
	const now = options.now ?? Date.now;
	const gapPlanSeconds = store.getStorySettings(storyId).gapPlanSeconds;
	const runDeferred =
		options.sessionEnded === true || gapSeconds >= gapPlanSeconds;
	const executableKinds = runDeferred
		? kinds
		: kinds.filter((kind) => registry.get(kind)?.tier === "gap");

	const enqueued = enqueueMissingJobs({
		store,
		storyId,
		kinds,
		conditions: Object.fromEntries(
			kinds.map((kind) => [kind, registry.get(kind)?.enqueue ?? "confirmed"]),
		),
		now,
	});
	const headPath = store.getPathToHead(storyId);
	const activeNodeIds =
		headPath.length === 0 ? null : new Set(headPath.map((node) => node.id));
	const pending = store.listBackgroundJobs({
		storyId,
		status: "pending",
		kinds: executableKinds,
		limit,
	});
	const runs: BackgroundJobRun[] = [];
	let discarded = 0;
	for (const job of pending) {
		const type = registry.get(job.kind);
		if (type === undefined) {
			throw new Error(`没有注册后台任务类型 ${job.kind}`);
		}
		if (activeNodeIds !== null && !activeNodeIds.has(job.nodeId)) {
			const dropped = store.discardBackgroundJob(
				job.id,
				new Date(now()).toISOString(),
			);
			discarded += 1;
			runs.push({
				jobId: dropped.id,
				nodeId: dropped.nodeId,
				kind: dropped.kind,
				status: dropped.status,
				attempts: dropped.attempts,
				error: dropped.lastError,
			});
			continue;
		}
		const running = store.startBackgroundJob(
			job.id,
			new Date(now()).toISOString(),
		);
		try {
			await type.handler({ store, client: options.client, job: running });
		} catch (error) {
			if (error instanceof BackgroundJobDeferredError) {
				const deferred = store.deferBackgroundJob(job.id);
				runs.push({
					jobId: deferred.id,
					nodeId: deferred.nodeId,
					kind: deferred.kind,
					status: deferred.status,
					attempts: deferred.attempts,
					error: deferred.lastError,
				});
				continue;
			}
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
	return { enqueued: enqueued.length, discarded, runs };
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
