import type { LlmClient, LlmMessage } from "@dramaticer/core";

/**
 * 模板发起的生成只登记请求，不进入回合内（I6、I11）。宿主在间隙调用
 * `drain` 用后台客户端执行；同一张卡同时最多保留 `maxPendingPerCard`
 * 条未完成请求，超出的模板调用直接失败。
 */

export const ST_EJS_GENERATION_STATUSES = [
	"pending",
	"running",
	"done",
	"failed",
] as const;

export type StEjsGenerationStatus = (typeof ST_EJS_GENERATION_STATUSES)[number];

export class StEjsGenerationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StEjsGenerationError";
	}
}

export class StEjsGenerationLimitError extends StEjsGenerationError {
	readonly cardId: string;
	readonly limit: number;

	constructor(cardId: string, limit: number) {
		super(`卡 ${cardId} 的待执行生成已经有 ${limit} 条，模板不能再发起`);
		this.name = "StEjsGenerationLimitError";
		this.cardId = cardId;
		this.limit = limit;
	}
}

/** 模板可以传到 `generate` 的参数。 */
export interface StEjsGenerationContent {
	readonly prompt: string;
	readonly systemPrompt?: string;
	readonly maxTokens?: number;
}

/** 调度器保存的完整请求；来源由流水线绑定，不由模板提供。 */
export interface StEjsGenerationSubmission extends StEjsGenerationContent {
	readonly storyId: string;
	readonly cardId: string;
	readonly nodeId: string | null;
}

export interface StEjsGenerationTask extends StEjsGenerationSubmission {
	readonly id: string;
	readonly status: StEjsGenerationStatus;
	readonly text: string | null;
	readonly error: string | null;
	readonly createdAt: string;
	readonly startedAt: string | null;
	readonly finishedAt: string | null;
}

export interface StEjsGenerationCounts {
	readonly pending: number;
	readonly running: number;
	readonly done: number;
	readonly failed: number;
	readonly total: number;
}

export interface StEjsGenerationRun {
	readonly id: string;
	readonly cardId: string;
	readonly status: "done" | "failed";
	readonly text: string | null;
	readonly error: string | null;
	readonly durationMs: number;
}

export interface StEjsGenerationDrainResult {
	readonly runs: readonly StEjsGenerationRun[];
	readonly counts: StEjsGenerationCounts;
}

/**
 * 模板里的 `generate(prompt, { system, maxTokens })` 与 `getGenerated(id)`。
 * 流水线把这个接口绑定到当前故事、卡与楼层。
 */
export interface StEjsGenerationSink {
	submit(content: StEjsGenerationContent): string;
	read(id: string): string;
}

export interface StEjsGenerationRunnerInput {
	readonly prompt: string;
	readonly systemPrompt?: string;
	readonly maxTokens?: number;
	readonly signal?: AbortSignal;
}

/** 后台执行一条模板生成；由宿主提供，通常是后台角色的 `LlmClient`。 */
export type StEjsGenerationRunner = (
	input: StEjsGenerationRunnerInput,
) => Promise<string>;

export interface StEjsGenerationSchedulerOptions {
	readonly run: StEjsGenerationRunner;
	/** 同一张卡最多保留多少条未完成请求；默认 4。 */
	readonly maxPendingPerCard?: number;
	readonly now?: () => number;
}

export interface StEjsGenerationDrainOptions {
	/** 只执行这张卡的请求。 */
	readonly cardId?: string;
	/** 只执行这些请求 id；与 `cardId` 同时给出时两个条件都要满足。 */
	readonly ids?: readonly string[];
	readonly signal?: AbortSignal;
}

const DEFAULT_MAX_PENDING_PER_CARD = 4;

/** `drain` 的 ids 过滤表；空数组表示不执行任何请求。 */
function readDrainIds(value: readonly string[]): ReadonlySet<string> {
	if (!Array.isArray(value)) {
		throw new StEjsGenerationError("drain 的 ids 必须是数组");
	}
	const ids = new Set<string>();
	for (const [index, id] of value.entries()) {
		if (typeof id !== "string" || id.trim().length === 0) {
			throw new StEjsGenerationError(`drain 的 ids[${index}] 必须是请求 id`);
		}
		if (ids.has(id)) {
			throw new StEjsGenerationError(`drain 的 ids[${index}] 重复：${id}`);
		}
		ids.add(id);
	}
	return ids;
}

function assertNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new StEjsGenerationError(`${label}必须是非空字符串`);
	}
	return value;
}

function assertNodeId(value: unknown): string | null {
	if (value === null) return null;
	return assertNonEmptyString(value, "生成请求的楼层 id");
}

function assertPositiveInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new StEjsGenerationError(`${label}必须是正整数`);
	}
	return value;
}

/**
 * 模板传入的选项：`system` 是系统提示，`maxTokens` 是输出上限。
 * 未知键与非法类型直接拒绝，避免模板把错字静默丢掉。
 */
export function normalizeStEjsGenerationOptions(value: unknown): {
	readonly systemPrompt?: string;
	readonly maxTokens?: number;
} {
	if (value === undefined || value === null) return {};
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new StEjsGenerationError("generate 的选项必须是对象");
	}
	const input = value as Record<string, unknown>;
	for (const key of Object.keys(input)) {
		if (key !== "system" && key !== "maxTokens") {
			throw new StEjsGenerationError(`generate 的选项不支持 ${key}`);
		}
	}
	const result: { systemPrompt?: string; maxTokens?: number } = {};
	if (input.system !== undefined) {
		if (typeof input.system !== "string") {
			throw new StEjsGenerationError("generate 的 system 必须是字符串");
		}
		result.systemPrompt = input.system;
	}
	if (input.maxTokens !== undefined) {
		result.maxTokens = assertPositiveInteger(
			input.maxTokens,
			"generate 的 maxTokens",
		);
	}
	return result;
}

interface MutableTask {
	readonly id: string;
	readonly storyId: string;
	readonly cardId: string;
	readonly nodeId: string | null;
	readonly prompt: string;
	readonly systemPrompt?: string;
	readonly maxTokens?: number;
	readonly createdAt: string;
	status: StEjsGenerationStatus;
	text: string | null;
	error: string | null;
	startedAt: string | null;
	finishedAt: string | null;
}

function snapshot(task: MutableTask): StEjsGenerationTask {
	return {
		id: task.id,
		storyId: task.storyId,
		cardId: task.cardId,
		nodeId: task.nodeId,
		prompt: task.prompt,
		...(task.systemPrompt === undefined
			? {}
			: { systemPrompt: task.systemPrompt }),
		...(task.maxTokens === undefined ? {} : { maxTokens: task.maxTokens }),
		createdAt: task.createdAt,
		status: task.status,
		text: task.text,
		error: task.error,
		startedAt: task.startedAt,
		finishedAt: task.finishedAt,
	};
}

/**
 * 模板生成的请求队列。`submit` 只入队并返回请求 id，绝不调用模型；
 * `drain` 按入队顺序逐条执行，宿主在回合结束之后调用它。
 */
export class StEjsGenerationScheduler {
	readonly #run: StEjsGenerationRunner;
	readonly #maxPendingPerCard: number;
	readonly #now: () => number;
	readonly #tasks = new Map<string, MutableTask>();
	#sequence = 0;
	#draining = false;

	constructor(options: StEjsGenerationSchedulerOptions) {
		if (typeof options.run !== "function") {
			throw new StEjsGenerationError("生成队列必须提供执行函数");
		}
		this.#run = options.run;
		this.#maxPendingPerCard =
			options.maxPendingPerCard === undefined
				? DEFAULT_MAX_PENDING_PER_CARD
				: assertPositiveInteger(
						options.maxPendingPerCard,
						"每张卡的待执行上限",
					);
		this.#now = options.now ?? Date.now;
	}

	submit(input: StEjsGenerationSubmission): string {
		const storyId = assertNonEmptyString(input.storyId, "生成请求的故事 id");
		const cardId = assertNonEmptyString(input.cardId, "生成请求的卡 id");
		const nodeId = assertNodeId(input.nodeId);
		const prompt = assertNonEmptyString(input.prompt, "生成请求的 prompt");
		if (
			input.systemPrompt !== undefined &&
			typeof input.systemPrompt !== "string"
		) {
			throw new StEjsGenerationError("生成请求的 system 必须是字符串");
		}
		const maxTokens =
			input.maxTokens === undefined
				? undefined
				: assertPositiveInteger(input.maxTokens, "生成请求的 maxTokens");
		const pending = this.getCounts(cardId);
		if (pending.pending + pending.running >= this.#maxPendingPerCard) {
			throw new StEjsGenerationLimitError(cardId, this.#maxPendingPerCard);
		}
		this.#sequence += 1;
		const id = `st-ejs-gen-${this.#sequence}`;
		this.#tasks.set(id, {
			id,
			storyId,
			cardId,
			nodeId,
			prompt,
			...(input.systemPrompt === undefined
				? {}
				: { systemPrompt: input.systemPrompt }),
			...(maxTokens === undefined ? {} : { maxTokens }),
			createdAt: new Date(this.#now()).toISOString(),
			status: "pending",
			text: null,
			error: null,
			startedAt: null,
			finishedAt: null,
		});
		return id;
	}

	/** 已完成的正文；未完成或失败时返回空串，详情用 `get` 读取。 */
	getGenerated(id: string): string {
		const task = this.#tasks.get(id);
		return task?.status === "done" ? (task.text ?? "") : "";
	}

	get(id: string): StEjsGenerationTask | null {
		const task = this.#tasks.get(id);
		return task === undefined ? null : snapshot(task);
	}

	getCounts(cardId?: string): StEjsGenerationCounts {
		const counts = {
			pending: 0,
			running: 0,
			done: 0,
			failed: 0,
			total: 0,
		};
		for (const task of this.#tasks.values()) {
			if (cardId !== undefined && task.cardId !== cardId) continue;
			counts.total += 1;
			counts[task.status] += 1;
		}
		return counts;
	}

	/**
	 * 执行当前待办；快照在开始时确定，执行期间新入队的请求留到下一次。
	 * 正在执行时再次调用直接失败，宿主本就应该串行调度。
	 */
	async drain(
		options: StEjsGenerationDrainOptions = {},
	): Promise<StEjsGenerationDrainResult> {
		if (this.#draining) {
			throw new StEjsGenerationError("生成队列已经在执行");
		}
		const cardId =
			options.cardId === undefined
				? undefined
				: assertNonEmptyString(options.cardId, "drain 的卡 id");
		const filter = options.ids === undefined ? null : readDrainIds(options.ids);
		const targetIds: string[] = [];
		for (const task of this.#tasks.values()) {
			if (task.status !== "pending") continue;
			if (cardId !== undefined && task.cardId !== cardId) continue;
			if (filter !== null && !filter.has(task.id)) continue;
			targetIds.push(task.id);
		}
		this.#draining = true;
		try {
			const runs: StEjsGenerationRun[] = [];
			for (const id of targetIds) {
				if (options.signal?.aborted === true) break;
				const task = this.#tasks.get(id);
				if (task === undefined || task.status !== "pending") continue;
				task.status = "running";
				task.startedAt = new Date(this.#now()).toISOString();
				const startedAt = this.#now();
				try {
					const text = await this.#run({
						prompt: task.prompt,
						...(task.systemPrompt === undefined
							? {}
							: { systemPrompt: task.systemPrompt }),
						...(task.maxTokens === undefined
							? {}
							: { maxTokens: task.maxTokens }),
						...(options.signal === undefined ? {} : { signal: options.signal }),
					});
					if (typeof text !== "string") {
						throw new StEjsGenerationError("生成执行函数必须返回字符串");
					}
					task.status = "done";
					task.text = text;
					task.error = null;
					runs.push({
						id,
						cardId: task.cardId,
						status: "done",
						text,
						error: null,
						durationMs: this.#now() - startedAt,
					});
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					task.status = "failed";
					task.text = null;
					task.error = message;
					runs.push({
						id,
						cardId: task.cardId,
						status: "failed",
						text: null,
						error: message,
						durationMs: this.#now() - startedAt,
					});
				} finally {
					task.finishedAt = new Date(this.#now()).toISOString();
				}
			}
			return { runs, counts: this.getCounts() };
		} finally {
			this.#draining = false;
		}
	}
}

export interface StEjsBackgroundGenerationRunnerOptions {
	/** 后台角色的客户端；调用方从运行时里取，不使用正文客户端。 */
	readonly client: LlmClient;
	readonly model?: string;
}

/** 把模板生成接到后台渠道：一条 system（可选）加一条 user 消息。 */
export function createStEjsBackgroundGenerationRunner(
	options: StEjsBackgroundGenerationRunnerOptions,
): StEjsGenerationRunner {
	const { client, model } = options;
	return async (input) => {
		const messages: LlmMessage[] = [];
		if (input.systemPrompt !== undefined) {
			messages.push({ role: "system", content: input.systemPrompt });
		}
		messages.push({ role: "user", content: input.prompt });
		const result = await client.complete({
			messages,
			...(model === undefined ? {} : { model }),
			...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
			...(input.signal === undefined ? {} : { signal: input.signal }),
		});
		return result.text;
	};
}
