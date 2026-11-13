import type {
	StEjsGenerationRun,
	StEjsGenerationScheduler,
	StEjsGenerationTask,
} from "../st-ejs/index.js";
import type { StHelperSlashGenerationRequest } from "./slash.js";

/**
 * 脚本发起的生成只登记后台请求，不进入回合内（I6、I11）。队列复用 EJS
 * 生成调度器的卡级限流，宿主在间隙 `drain`；脚本拿到的结果是请求 id，
 * 生成完成后用 `/genresult` 读取。Trace 只统计脚本发起的请求，与模板
 * 发起的请求分开。
 */

export const ST_HELPER_GENERATION_OUTCOMES = [
	"submitted",
	"completed",
	"failed",
	"rejected",
] as const;

export type StHelperGenerationOutcome =
	(typeof ST_HELPER_GENERATION_OUTCOMES)[number];

export class StHelperGenerationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StHelperGenerationError";
	}
}

export interface StHelperGenerationTraceEntry {
	readonly kind: "generation";
	readonly plugin: string;
	readonly requestId: string | null;
	readonly command: "gen" | "genraw";
	readonly outcome: StHelperGenerationOutcome;
	readonly reason: string | null;
	readonly durationMs: number;
	readonly at: string;
}

export interface StHelperGenerationCounts {
	readonly submitted: number;
	readonly pending: number;
	readonly running: number;
	readonly completed: number;
	readonly failed: number;
	readonly rejected: number;
}

export interface StHelperGenerationQueueOptions {
	/** 与 EJS 模板共用的调度器；卡级上限由它统一计算。 */
	readonly scheduler: StEjsGenerationScheduler;
	readonly storyId: string;
	/** 卡级限流的键；宿主会话用角色卡名称。 */
	readonly cardId: string;
	readonly nodeId: string | null;
	readonly plugin?: string;
	readonly onTrace?: (entry: StHelperGenerationTraceEntry) => void;
	readonly maxTraceEntries?: number;
	readonly now?: () => number;
}

export interface StHelperGenerationDrainOptions {
	readonly signal?: AbortSignal;
}

export interface StHelperGenerationDrainResult {
	/** 只包含脚本发起的请求；同一调度器上的模板请求不在其中。 */
	readonly runs: readonly StEjsGenerationRun[];
	readonly counts: StHelperGenerationCounts;
}

const DEFAULT_MAX_TRACE_ENTRIES = 200;

function assertNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new StHelperGenerationError(`${label}必须是非空字符串`);
	}
	return value;
}

function assertNodeId(value: unknown): string | null {
	if (value === null) return null;
	return assertNonEmptyString(value, "脚本生成的楼层 id");
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * 脚本发起的生成队列。`enqueue` 只校验并入队，返回请求 id；模型调用只
 * 发生在 `drain`，由宿主在间隙用后台渠道执行。
 */
export class StHelperGenerationQueue {
	readonly #scheduler: StEjsGenerationScheduler;
	readonly #storyId: string;
	readonly #cardId: string;
	readonly #nodeId: string | null;
	readonly #plugin: string;
	readonly #onTrace: ((entry: StHelperGenerationTraceEntry) => void) | null;
	readonly #maxTraceEntries: number;
	readonly #now: () => number;
	readonly #ids = new Set<string>();
	readonly #commands = new Map<string, "gen" | "genraw">();
	readonly #trace: StHelperGenerationTraceEntry[] = [];
	#rejected = 0;

	constructor(options: StHelperGenerationQueueOptions) {
		const plugin = options.plugin ?? "st-helper-host";
		this.#scheduler = options.scheduler;
		this.#storyId = assertNonEmptyString(options.storyId, "脚本生成的故事 id");
		this.#cardId = assertNonEmptyString(options.cardId, "脚本生成的卡 id");
		this.#nodeId = assertNodeId(options.nodeId);
		this.#plugin = assertNonEmptyString(plugin, "脚本生成的插件名");
		this.#onTrace = options.onTrace ?? null;
		this.#maxTraceEntries =
			options.maxTraceEntries ?? DEFAULT_MAX_TRACE_ENTRIES;
		this.#now = options.now ?? Date.now;
	}

	get trace(): readonly StHelperGenerationTraceEntry[] {
		return [...this.#trace];
	}

	/**
	 * 登记一条脚本生成并返回请求 id。超出卡级上限、参数非法与调度器拒绝
	 * 都记一条 `rejected` 后原样抛出。
	 */
	enqueue(request: StHelperSlashGenerationRequest): string {
		const command = request.command;
		try {
			if (command !== "gen" && command !== "genraw") {
				throw new StHelperGenerationError(
					`脚本生成的命令必须是 gen 或 genraw：${String(command)}`,
				);
			}
			const prompt = assertNonEmptyString(request.prompt, "脚本生成的 prompt");
			const systemPrompt =
				request.system === null
					? undefined
					: assertNonEmptyString(request.system, "脚本生成的 system");
			const maxTokens =
				request.maxTokens === null
					? undefined
					: assertPositiveInteger(request.maxTokens, "脚本生成的 maxTokens");
			const id = this.#scheduler.submit({
				storyId: this.#storyId,
				cardId: this.#cardId,
				nodeId: this.#nodeId,
				prompt,
				...(systemPrompt === undefined ? {} : { systemPrompt }),
				...(maxTokens === undefined ? {} : { maxTokens }),
			});
			this.#ids.add(id);
			this.#commands.set(id, command);
			this.#record({
				plugin: this.#plugin,
				requestId: id,
				command,
				outcome: "submitted",
				reason: null,
				durationMs: 0,
			});
			return id;
		} catch (error) {
			this.#rejected += 1;
			this.#record({
				plugin: this.#plugin,
				requestId: null,
				command: command === "genraw" ? "genraw" : "gen",
				outcome: "rejected",
				reason: errorText(error),
				durationMs: 0,
			});
			throw error;
		}
	}

	/** 生成完成后的正文；未完成或失败时返回空串。 */
	read(id: string): string {
		this.#requireRequestId(id);
		return this.#scheduler.getGenerated(id);
	}

	get(id: string): StEjsGenerationTask | null {
		if (!this.#ids.has(id)) return null;
		return this.#scheduler.get(id);
	}

	getCounts(): StHelperGenerationCounts {
		const counts = {
			submitted: 0,
			pending: 0,
			running: 0,
			completed: 0,
			failed: 0,
			rejected: this.#rejected,
		};
		for (const id of this.#ids) {
			const task = this.#scheduler.get(id);
			if (task === null) continue;
			counts.submitted += 1;
			if (task.status === "pending") counts.pending += 1;
			else if (task.status === "running") counts.running += 1;
			else if (task.status === "done") counts.completed += 1;
			else counts.failed += 1;
		}
		return counts;
	}

	/**
	 * 在间隙执行本队列登记的请求；模板发起的请求留在调度器上，由 EJS
	 * 自己的 `drain` 执行。执行顺序就是入队顺序。
	 */
	async drain(
		options: StHelperGenerationDrainOptions = {},
	): Promise<StHelperGenerationDrainResult> {
		const pending = [...this.#ids].filter(
			(id) => this.#scheduler.get(id)?.status === "pending",
		);
		if (pending.length === 0) {
			return { runs: [], counts: this.getCounts() };
		}
		const result = await this.#scheduler.drain({
			ids: pending,
			...(options.signal === undefined ? {} : { signal: options.signal }),
		});
		const runs: StEjsGenerationRun[] = [];
		for (const run of result.runs) {
			const command = this.#commands.get(run.id);
			if (!this.#ids.has(run.id) || command === undefined) continue;
			runs.push(run);
			this.#record({
				plugin: this.#plugin,
				requestId: run.id,
				command,
				outcome: run.status === "done" ? "completed" : "failed",
				reason: run.error,
				durationMs: run.durationMs,
			});
		}
		return { runs, counts: this.getCounts() };
	}

	#requireRequestId(id: string): void {
		if (typeof id !== "string" || id.trim().length === 0) {
			throw new StHelperGenerationError("生成请求 id 必须是非空字符串");
		}
		if (!this.#ids.has(id)) {
			throw new StHelperGenerationError(`未知的脚本生成请求：${id}`);
		}
	}

	#record(entry: {
		readonly plugin: string;
		readonly requestId: string | null;
		readonly command: "gen" | "genraw";
		readonly outcome: StHelperGenerationOutcome;
		readonly reason: string | null;
		readonly durationMs: number;
	}): void {
		const entryWithMeta: StHelperGenerationTraceEntry = {
			kind: "generation",
			...entry,
			at: new Date(this.#now()).toISOString(),
		};
		this.#trace.push(entryWithMeta);
		if (this.#trace.length > this.#maxTraceEntries) this.#trace.shift();
		this.#onTrace?.(entryWithMeta);
	}
}

function assertPositiveInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new StHelperGenerationError(`${label}必须是正整数`);
	}
	return value;
}
