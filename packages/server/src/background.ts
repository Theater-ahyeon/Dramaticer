import {
	type BackgroundJobRegistry,
	type EmbeddingClient,
	ILLUSTRATE_JOB_KIND,
	type IllustrateHandlerOptions,
	type LlmClient,
	type StoryStore,
	createDefaultBackgroundJobRegistry,
	drainBackgroundJobs,
	readStoryBackgroundSwitches,
	resolveStoryBackgroundKinds,
} from "@dramaticer/core";

/** 调度只用运行时里的后台客户端与 embedding 客户端；测试可以给别的实现。 */
export interface BackgroundRuntime {
	readonly backgroundClient: LlmClient | null;
	readonly plannerClient: LlmClient | null;
	readonly embedder: EmbeddingClient | null;
}

export interface BackgroundRuntimeSource {
	get(storyId: string): Promise<BackgroundRuntime>;
}

export type BackgroundRegistryFactory = (
	runtime: BackgroundRuntime,
) => BackgroundJobRegistry;

export interface BackgroundSchedulerOptions {
	readonly store: StoryStore;
	readonly runtime: BackgroundRuntimeSource;
	readonly createRegistry?: BackgroundRegistryFactory;
	readonly log: (line: string) => void;
	readonly limit?: number;
	readonly now?: () => number;
	/** 生图队列；不设置时不注册 illustrate 任务。 */
	readonly illustrate?: IllustrateHandlerOptions | null;
}

/**
 * 回合结束后在后台补建并执行任务。队列按最近调度的故事优先，任何时刻只有一个
 * drain 在跑；每个 drain 内部也按任务创建顺序逐个执行。
 */
export class BackgroundScheduler {
	readonly #store: StoryStore;
	readonly #runtime: BackgroundRuntimeSource;
	readonly #createRegistry: BackgroundRegistryFactory;
	readonly #log: (line: string) => void;
	readonly #limit: number | undefined;
	readonly #now: (() => number) | undefined;
	readonly #illustrate: IllustrateHandlerOptions | null;
	readonly #queue: string[] = [];
	readonly #priorities = new Map<string, number>();
	#nextPriority = 0;
	readonly #controller = new AbortController();
	#pump: Promise<void> | null = null;
	#closed = false;

	constructor(options: BackgroundSchedulerOptions) {
		this.#store = options.store;
		this.#runtime = options.runtime;
		this.#createRegistry =
			options.createRegistry ??
			((runtime) =>
				createDefaultBackgroundJobRegistry({
					embedder: runtime.embedder,
					plannerClient: runtime.plannerClient,
					illustrate: this.#illustrate,
				}));
		this.#log = options.log;
		this.#limit = options.limit;
		this.#now = options.now;
		this.#illustrate = options.illustrate ?? null;
	}

	/** 把一个故事排进后台队列；最近调度的故事排在最前，重复调度只保留一次。 */
	schedule(storyId: string): void {
		if (this.#closed) return;
		const index = this.#queue.indexOf(storyId);
		if (index !== -1) this.#queue.splice(index, 1);
		this.#nextPriority += 1;
		this.#priorities.set(storyId, this.#nextPriority);
		this.#queue.unshift(storyId);
		if (this.#pump === null) this.#pump = this.#runQueue();
	}

	/** 等到队列里所有已排的任务都结束；服务端关闭时用它收尾。 */
	async waitForIdle(): Promise<void> {
		while (this.#pump !== null) await this.#pump;
	}

	/** 停止接收新任务，中止正在执行的处理器，并等队列退出。 */
	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#queue.length = 0;
		if (!this.#controller.signal.aborted) {
			this.#controller.abort(new Error("服务端关闭"));
		}
		await this.waitForIdle();
	}

	async #runQueue(): Promise<void> {
		try {
			while (!this.#closed) {
				const storyId = this.#queue.shift();
				if (storyId === undefined) break;
				let more = false;
				try {
					more = await this.#runStory(storyId);
				} catch (error) {
					this.#log(
						`后台任务失败：${error instanceof Error ? error.message : String(error)}`,
					);
				}
				if (!more || this.#closed) {
					this.#priorities.delete(storyId);
					continue;
				}
				// 按最近一次调度排序放回队列：更新的故事排在它前面，旧的积压排在后面。
				const priority = this.#priorities.get(storyId) ?? 0;
				let index = 0;
				while (
					index < this.#queue.length &&
					(this.#priorities.get(this.#queue[index] ?? "") ?? 0) > priority
				) {
					index += 1;
				}
				this.#queue.splice(index, 0, storyId);
			}
		} finally {
			this.#pump = null;
		}
	}

	/** 跑一轮任务；还有下一轮可跑时返回 true。 */
	async #runStory(storyId: string): Promise<boolean> {
		const runtime = await this.#runtime.get(storyId);
		const client = runtime.backgroundClient;
		if (client === null) {
			this.#log("后台任务跳过：没有可用的后台客户端");
			return false;
		}
		const registry = this.#createRegistry(runtime);
		const kinds = resolveStoryBackgroundKinds(
			registry,
			readStoryBackgroundSwitches(this.#store, storyId),
		);
		if (kinds.length === 0) return false;
		const limitOpt = this.#limit === undefined ? {} : { limit: this.#limit };
		const result = await drainBackgroundJobs({
			store: this.#store,
			registry,
			client,
			storyId,
			kinds,
			...limitOpt,
			// 服务端不知道玩家下次什么时候输入；一轮结束后按间隙已经耗尽处理。
			sessionEnded: true,
			signal: this.#controller.signal,
			...(this.#now === undefined ? {} : { now: this.#now }),
		});
		// 画面整理会插一批待出图记录；队列已经取过待办，这里补一轮只跑插图。
		const followsImageOrganize =
			registry.has(ILLUSTRATE_JOB_KIND) &&
			this.#store.countBackgroundJobs({
				storyId,
				kinds: [ILLUSTRATE_JOB_KIND],
			}).pending > 0;
		let runs = result.runs;
		if (followsImageOrganize && !this.#controller.signal.aborted) {
			const followUp = await drainBackgroundJobs({
				store: this.#store,
				registry,
				client,
				storyId,
				kinds: [ILLUSTRATE_JOB_KIND],
				...limitOpt,
				sessionEnded: true,
				signal: this.#controller.signal,
				...(this.#now === undefined ? {} : { now: this.#now }),
			});
			runs = [...runs, ...followUp.runs];
		}
		const failed = runs.filter((run) => run.status === "failed").length;
		this.#log(
			`后台任务 ${storyId}：新增 ${result.enqueued} 条，执行 ${runs.length} 条（失败 ${failed}，丢弃 ${result.discarded}）`,
		);
		// 仅在显式配置单轮上限、且本轮跑满上限、未遇到失败退回 pending 时换手给其他故事。
		const stalled = runs.some((run) => run.status === "pending");
		const pending = this.#store.countBackgroundJobs({ storyId }).pending;
		return (
			this.#limit !== undefined &&
			!stalled &&
			runs.length >= this.#limit &&
			pending > 0
		);
	}
}
