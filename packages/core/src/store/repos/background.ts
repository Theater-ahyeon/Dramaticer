// StoryStore 的领域仓储：后台任务队列（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import {
	type BackgroundJob,
	type BackgroundJobCounts,
	type BackgroundJobEnqueueCondition,
	type BackgroundJobStatus,
	isBackgroundJobEnqueueCondition,
} from "../../background/types.js";
import { StoreRepo } from "./base.js";
import { assertNonEmptyString } from "./shared.js";

interface BackgroundJobRow {
	readonly id: number;
	readonly story_id: string;
	readonly node_id: string | null;
	readonly kind: string;
	readonly status: string;
	readonly attempts: number;
	readonly last_error: string | null;
	readonly created_at: string;
	readonly started_at: string | null;
	readonly finished_at: string | null;
	readonly llm_calls?: number;
	readonly llm_tokens?: number;
}

export interface EnqueueBackgroundJobsInput {
	readonly storyId: string;
	readonly kinds: readonly string[];
	/** 每种任务类型的入队条件；缺省为 confirmed。 */
	readonly conditions?: Readonly<Record<string, BackgroundJobEnqueueCondition>>;
	readonly createdAt?: string;
}

export interface EnqueueStoryBackgroundJobsInput {
	readonly storyId: string;
	readonly kinds: readonly string[];
	readonly createdAt?: string;
}

export interface ListBackgroundJobsOptions {
	readonly storyId?: string;
	readonly status?: BackgroundJobStatus;
	readonly kinds?: readonly string[];
	readonly limit?: number;
}

export interface CountBackgroundJobsOptions {
	readonly storyId: string;
	readonly kinds?: readonly string[];
}

export interface FailBackgroundJobInput {
	readonly error: string;
	readonly maxAttempts: number;
	readonly finishedAt?: string;
}

function isBackgroundJobStatus(value: unknown): value is BackgroundJobStatus {
	return (
		value === "pending" ||
		value === "running" ||
		value === "done" ||
		value === "failed" ||
		value === "discarded"
	);
}

function assertBackgroundJobId(value: unknown): asserts value is number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`后台任务 id 必须是正整数：${String(value)}`);
	}
}

function rowToBackgroundJob(row: BackgroundJobRow): BackgroundJob {
	if (!isBackgroundJobStatus(row.status)) {
		throw new Error(`后台任务 ${row.id} 的状态不合法：${row.status}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		nodeId: row.node_id,
		kind: row.kind,
		status: row.status,
		attempts: row.attempts,
		lastError: row.last_error,
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		llmCalls: row.llm_calls ?? 0,
		llmTokens: row.llm_tokens ?? 0,
	};
}

export class BackgroundRepo extends StoreRepo {
	/** 按任务类型的入队条件为故事补建缺失的后台任务。 */
	enqueueMissingBackgroundJobs(
		input: EnqueueBackgroundJobsInput,
	): BackgroundJob[] {
		assertNonEmptyString(input.storyId, "故事 id");
		if (!Array.isArray(input.kinds)) {
			throw new Error("后台任务类型必须是数组");
		}
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const kinds: string[] = [];
		for (const kind of input.kinds) {
			assertNonEmptyString(kind, "后台任务类型");
			if (kind !== kind.trim()) {
				throw new Error(`后台任务类型不能包含首尾空白：${kind}`);
			}
			if (kinds.includes(kind)) {
				throw new Error(`后台任务类型重复：${kind}`);
			}
			kinds.push(kind);
		}
		if (kinds.length === 0) return [];
		const declared = input.conditions ?? {};
		for (const [kind, condition] of Object.entries(declared)) {
			if (!kinds.includes(kind)) {
				throw new Error(`后台任务类型 ${kind} 不在本次入队的类型列表里`);
			}
			if (!isBackgroundJobEnqueueCondition(condition)) {
				throw new Error(
					`后台任务类型 ${kind} 的入队条件不合法：${String(condition)}`,
				);
			}
		}
		const conditionFor = (kind: string): BackgroundJobEnqueueCondition =>
			Object.hasOwn(declared, kind)
				? (declared[kind] ?? "confirmed")
				: "confirmed";
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "后台任务的创建时间");
		const requiresSettled = kinds.some(
			(kind) => conditionFor(kind) === "settled",
		);
		const requiresConfirmed = kinds.some(
			(kind) => conditionFor(kind) === "confirmed",
		);
		const nodeIds = this.store
			.getPathToHead(input.storyId)
			.map((node) => node.id);
		const pathNodeIds = new Set(nodeIds);
		const confirmed = requiresConfirmed
			? new Set(
					(
						this.db
							.prepare(
								`SELECT DISTINCT parent.id AS id
								FROM nodes child
								JOIN nodes parent ON parent.id = child.parent_id
								LEFT JOIN traces ON traces.node_id = parent.id
								WHERE child.story_id = ?
									AND COALESCE(json_extract(traces.trace, '$.profile'), 'native') <> 'naive'`,
							)
							.all(input.storyId) as { readonly id: string }[]
					)
						.filter((row) => pathNodeIds.has(row.id))
						.map((row) => row.id),
				)
			: new Set<string>();
		const settled = requiresSettled
			? new Set(
					(
						this.db
							.prepare(
								`SELECT nodes.id AS id
								FROM nodes
								LEFT JOIN traces ON traces.node_id = nodes.id
								WHERE nodes.story_id = ?
									AND nodes.role = 'assistant'
									AND COALESCE(json_extract(traces.trace, '$.llm.stopReason'), '') <> 'aborted'
									AND COALESCE(json_extract(traces.trace, '$.profile'), 'native') <> 'naive'`,
							)
							.all(input.storyId) as { readonly id: string }[]
					)
						.filter((row) => pathNodeIds.has(row.id))
						.map((row) => row.id),
				)
			: new Set<string>();
		const insert = this.db.prepare(
			`INSERT INTO background_jobs
				(story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at)
			VALUES (?, ?, ?, 'pending', 0, NULL, ?, NULL, NULL)
			ON CONFLICT (node_id, kind) DO UPDATE SET
				status = 'pending',
				last_error = NULL,
				started_at = NULL,
				finished_at = NULL
			WHERE background_jobs.status = 'discarded'
			RETURNING id`,
		);
		const insertStoryJob = this.db.prepare(
			`INSERT INTO background_jobs
				(story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at)
			VALUES (?, NULL, ?, 'pending', 0, NULL, ?, NULL, NULL)
			ON CONFLICT (story_id, kind) WHERE node_id IS NULL DO UPDATE SET
				status = 'pending',
				last_error = NULL,
				started_at = NULL,
				finished_at = NULL
			WHERE background_jobs.status IN ('done', 'failed', 'discarded')
			RETURNING id`,
		);
		const created: BackgroundJob[] = [];
		this.db.transaction(() => {
			for (const nodeId of nodeIds) {
				for (const kind of kinds) {
					const condition = conditionFor(kind);
					if (condition === "story") continue;
					const eligible =
						condition === "settled"
							? settled.has(nodeId)
							: confirmed.has(nodeId);
					if (!eligible) continue;
					const row = insert.get(input.storyId, nodeId, kind, createdAt) as
						| { readonly id: number }
						| undefined;
					if (row === undefined) continue;
					const job = this.getBackgroundJob(row.id);
					if (!job) {
						throw new Error(`后台任务写入后读取失败：${String(row.id)}`);
					}
					created.push(job);
				}
			}
			for (const kind of kinds) {
				if (conditionFor(kind) !== "story") continue;
				const row = insertStoryJob.get(input.storyId, kind, createdAt) as
					| { readonly id: number }
					| undefined;
				if (row === undefined) continue;
				const job = this.getBackgroundJob(row.id);
				if (!job) {
					throw new Error(`后台任务写入后读取失败：${String(row.id)}`);
				}
				created.push(job);
			}
		})();
		return created;
	}

	/**
	 * 按任务类型入队故事级任务（node_id 为空），不判断这是不是当前需要的任务；
	 * 同一类型已经有待办或执行中的行时原样返回，已完成、失败或丢弃的行翻回 pending。
	 */
	enqueueStoryBackgroundJobs(
		input: EnqueueStoryBackgroundJobsInput,
	): BackgroundJob[] {
		assertNonEmptyString(input.storyId, "故事 id");
		if (!Array.isArray(input.kinds)) {
			throw new Error("后台任务类型必须是数组");
		}
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const kinds: string[] = [];
		for (const kind of input.kinds) {
			assertNonEmptyString(kind, "后台任务类型");
			if (kind !== kind.trim()) {
				throw new Error(`后台任务类型不能包含首尾空白：${kind}`);
			}
			if (kinds.includes(kind)) {
				throw new Error(`后台任务类型重复：${kind}`);
			}
			kinds.push(kind);
		}
		if (kinds.length === 0) return [];
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "后台任务的创建时间");
		const select = this.db.prepare(
			`SELECT * FROM background_jobs
			WHERE story_id = ? AND node_id IS NULL AND kind = ?`,
		);
		const insert = this.db.prepare(
			`INSERT INTO background_jobs
				(story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at)
			VALUES (?, NULL, ?, 'pending', 0, NULL, ?, NULL, NULL)`,
		);
		const reopen = this.db.prepare(
			`UPDATE background_jobs
			SET status = 'pending', last_error = NULL, started_at = NULL, finished_at = NULL
			WHERE id = ? AND status IN ('done', 'failed', 'discarded')`,
		);
		const jobs: BackgroundJob[] = [];
		this.db.transaction(() => {
			for (const kind of kinds) {
				const existing = select.get(input.storyId, kind) as
					| BackgroundJobRow
					| undefined;
				if (existing === undefined) {
					insert.run(input.storyId, kind, createdAt);
				} else if (
					existing.status === "done" ||
					existing.status === "failed" ||
					existing.status === "discarded"
				) {
					reopen.run(existing.id);
				}
				const row = select.get(input.storyId, kind) as BackgroundJobRow;
				jobs.push(rowToBackgroundJob(row));
			}
		})();
		return jobs;
	}

	/** 每个状态的任务条数；可以只看指定的任务类型。 */
	countBackgroundJobs(
		options: CountBackgroundJobsOptions,
	): BackgroundJobCounts {
		assertNonEmptyString(options.storyId, "故事 id");
		const kinds: string[] = [];
		if (options.kinds !== undefined) {
			if (!Array.isArray(options.kinds)) {
				throw new Error("后台任务类型必须是数组");
			}
			for (const kind of options.kinds) {
				assertNonEmptyString(kind, "后台任务类型");
				if (kinds.includes(kind)) {
					throw new Error(`后台任务类型重复：${kind}`);
				}
				kinds.push(kind);
			}
			if (kinds.length === 0) {
				return { pending: 0, running: 0, done: 0, failed: 0, discarded: 0 };
			}
		}
		const params: Record<string, unknown> = { storyId: options.storyId };
		let kindClause = "";
		if (kinds.length > 0) {
			const placeholders = kinds.map((kind, index) => {
				params[`kind${index}`] = kind;
				return `@kind${index}`;
			});
			kindClause = ` AND kind IN (${placeholders.join(", ")})`;
		}
		const rows = this.db
			.prepare(
				`SELECT status, COUNT(*) AS count FROM background_jobs
				WHERE story_id = @storyId${kindClause}
				GROUP BY status`,
			)
			.all(params) as { readonly status: string; readonly count: number }[];
		const counts: Record<string, number> = {
			pending: 0,
			running: 0,
			done: 0,
			failed: 0,
			discarded: 0,
		};
		for (const row of rows) {
			if (!isBackgroundJobStatus(row.status)) {
				throw new Error(`后台任务的状态不合法：${row.status}`);
			}
			counts[row.status] = row.count;
		}
		return {
			pending: counts.pending ?? 0,
			running: counts.running ?? 0,
			done: counts.done ?? 0,
			failed: counts.failed ?? 0,
			discarded: counts.discarded ?? 0,
		};
	}

	getBackgroundJob(id: number): BackgroundJob | null {
		assertBackgroundJobId(id);
		const row = this.db
			.prepare("SELECT * FROM background_jobs WHERE id = ?")
			.get(id) as BackgroundJobRow | undefined;
		return row ? rowToBackgroundJob(row) : null;
	}

	listBackgroundJobs(options: ListBackgroundJobsOptions = {}): BackgroundJob[] {
		if (options.storyId !== undefined) {
			assertNonEmptyString(options.storyId, "故事 id");
		}
		if (
			options.status !== undefined &&
			!isBackgroundJobStatus(options.status)
		) {
			throw new Error(`后台任务状态不合法：${String(options.status)}`);
		}
		const kinds: string[] = [];
		if (options.kinds !== undefined) {
			if (!Array.isArray(options.kinds)) {
				throw new Error("后台任务类型必须是数组");
			}
			for (const kind of options.kinds) {
				assertNonEmptyString(kind, "后台任务类型");
				if (kinds.includes(kind)) {
					throw new Error(`后台任务类型重复：${kind}`);
				}
				kinds.push(kind);
			}
			if (kinds.length === 0) return [];
		}
		const limit = options.limit ?? -1;
		if (typeof limit !== "number" || !Number.isInteger(limit) || limit === 0) {
			throw new Error("后台任务条数必须是非零整数");
		}
		const params: Record<string, unknown> = {
			storyId: options.storyId ?? null,
			status: options.status ?? null,
			limit,
		};
		let kindClause = "";
		if (kinds.length > 0) {
			const placeholders = kinds.map((kind, index) => {
				params[`kind${index}`] = kind;
				return `@kind${index}`;
			});
			kindClause = ` AND kind IN (${placeholders.join(", ")})`;
		}
		const rows = this.db
			.prepare(
				`SELECT * FROM background_jobs
				WHERE (@storyId IS NULL OR story_id = @storyId)
					AND (@status IS NULL OR status = @status)${kindClause}
				ORDER BY created_at ASC, id ASC
				LIMIT @limit`,
			)
			.all(params) as BackgroundJobRow[];
		return rows.map(rowToBackgroundJob);
	}

	/**
	 * 进程在执行中途退出后，running 行既不会被 drain 取到，也不计入待办。
	 * 启动时把它们退回 pending，并撤销开始执行时累计的那一次；其它状态不动。
	 */
	requeueRunningBackgroundJobs(storyId?: string): number {
		if (storyId !== undefined) assertNonEmptyString(storyId, "故事 id");
		const result = this.db
			.prepare(
				`UPDATE background_jobs
				SET status = 'pending', attempts = MAX(attempts - 1, 0), started_at = NULL, finished_at = NULL
				WHERE status = 'running' AND (@storyId IS NULL OR story_id = @storyId)`,
			)
			.run({ storyId: storyId ?? null });
		return result.changes;
	}

	/** 把 pending 任务标为 running，并累计执行次数。 */
	startBackgroundJob(id: number, startedAt?: string): BackgroundJob {
		const job = this.#requireBackgroundJob(id);
		if (job.status !== "pending") {
			throw new Error(
				`后台任务 ${id} 的状态是 ${job.status}，只有 pending 可以开始执行`,
			);
		}
		const at = startedAt ?? new Date().toISOString();
		assertNonEmptyString(at, "后台任务的开始时间");
		this.db
			.prepare(
				`UPDATE background_jobs
				SET status = 'running', attempts = attempts + 1, started_at = ?, finished_at = NULL
				WHERE id = ?`,
			)
			.run(at, id);
		return this.#requireBackgroundJob(id);
	}

	/** 累加一次执行里实际发出的模型调用与 token；成功、失败、退回都要记。 */
	addBackgroundJobUsage(
		id: number,
		usage: { readonly calls: number; readonly tokens: number },
	): void {
		assertBackgroundJobId(id);
		if (usage.calls === 0 && usage.tokens === 0) return;
		this.db
			.prepare(
				`UPDATE background_jobs
				SET llm_calls = llm_calls + ?, llm_tokens = llm_tokens + ?
				WHERE id = ?`,
			)
			.run(
				Math.max(0, Math.trunc(usage.calls)),
				Math.max(0, Math.trunc(usage.tokens)),
				id,
			);
	}

	/** 把 running 任务标为 done，并清空上一次失败的错误。 */
	finishBackgroundJob(id: number, finishedAt?: string): BackgroundJob {
		const job = this.#requireBackgroundJob(id);
		if (job.status !== "running") {
			throw new Error(
				`后台任务 ${id} 的状态是 ${job.status}，只有 running 可以完成`,
			);
		}
		const at = finishedAt ?? new Date().toISOString();
		assertNonEmptyString(at, "后台任务的完成时间");
		this.db
			.prepare(
				`UPDATE background_jobs
				SET status = 'done', last_error = NULL, finished_at = ?
				WHERE id = ?`,
			)
			.run(at, id);
		return this.#requireBackgroundJob(id);
	}

	/**
	 * 记录一次失败：执行次数达到上限时标为 failed，否则退回 pending 等待下一轮。
	 */
	failBackgroundJob(id: number, input: FailBackgroundJobInput): BackgroundJob {
		const job = this.#requireBackgroundJob(id);
		if (job.status !== "running") {
			throw new Error(
				`后台任务 ${id} 的状态是 ${job.status}，只有 running 可以记录失败`,
			);
		}
		assertNonEmptyString(input.error, "后台任务的错误信息");
		if (
			typeof input.maxAttempts !== "number" ||
			!Number.isInteger(input.maxAttempts) ||
			input.maxAttempts < 1
		) {
			throw new Error("后台任务的最大执行次数必须是正整数");
		}
		const at = input.finishedAt ?? new Date().toISOString();
		assertNonEmptyString(at, "后台任务的完成时间");
		const exhausted = job.attempts >= input.maxAttempts;
		this.db
			.prepare(
				`UPDATE background_jobs
				SET status = ?, last_error = ?, started_at = ?, finished_at = ?
				WHERE id = ?`,
			)
			.run(
				exhausted ? "failed" : "pending",
				input.error,
				exhausted ? job.startedAt : null,
				exhausted ? at : null,
				id,
			);
		return this.#requireBackgroundJob(id);
	}

	/**
	 * 把 running 任务退回 pending，并且不消耗执行次数：任务依赖的其它任务还没完成，
	 * 下一轮再试。
	 */
	deferBackgroundJob(id: number): BackgroundJob {
		const job = this.#requireBackgroundJob(id);
		if (job.status !== "running") {
			throw new Error(
				`后台任务 ${id} 的状态是 ${job.status}，只有 running 可以退回等待`,
			);
		}
		this.db
			.prepare(
				`UPDATE background_jobs
				SET status = 'pending', attempts = attempts - 1, started_at = NULL, finished_at = NULL
				WHERE id = ?`,
			)
			.run(id);
		return this.#requireBackgroundJob(id);
	}

	/** 楼层已经不在当前路径上时把 pending 任务标为 discarded；不会自动重试。 */
	discardBackgroundJob(id: number, finishedAt?: string): BackgroundJob {
		const job = this.#requireBackgroundJob(id);
		if (job.status !== "pending") {
			throw new Error(
				`后台任务 ${id} 的状态是 ${job.status}，只有 pending 可以丢弃`,
			);
		}
		const at = finishedAt ?? new Date().toISOString();
		assertNonEmptyString(at, "后台任务的完成时间");
		this.db
			.prepare(
				`UPDATE background_jobs
				SET status = 'discarded', started_at = NULL, finished_at = ?
				WHERE id = ?`,
			)
			.run(at, id);
		return this.#requireBackgroundJob(id);
	}

	#requireBackgroundJob(id: number): BackgroundJob {
		const job = this.getBackgroundJob(id);
		if (!job) {
			throw new Error(`后台任务不存在：${id}`);
		}
		return job;
	}
}
