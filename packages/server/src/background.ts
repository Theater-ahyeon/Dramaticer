import {
	type BackgroundJobRegistry,
	type EmbeddingClient,
	type LlmClient,
	type StoryStore,
	createDefaultBackgroundJobRegistry,
	drainBackgroundJobs,
	resolveStoryBackgroundKinds,
} from "@dramaticer/core";

/** 调度只用运行时里的后台客户端与 embedding 客户端；测试可以给别的实现。 */
export interface BackgroundRuntime {
	readonly backgroundClient: LlmClient | null;
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
}

/**
 * 回合结束后在后台补建并执行任务。队列按故事先来先做，任何时刻只有一个
 * drain 在跑；每个 drain 内部也按任务创建顺序逐个执行。
 */
export class BackgroundScheduler {
	readonly #store: StoryStore;
	readonly #runtime: BackgroundRuntimeSource;
	readonly #createRegistry: BackgroundRegistryFactory;
	readonly #log: (line: string) => void;
	readonly #limit: number | undefined;
	readonly #now: (() => number) | undefined;
	readonly #queue: string[] = [];
	readonly #controller = new AbortController();
	#pump: Promise<void> | null = null;
	#closed = false;

	constructor(options: BackgroundSchedulerOptions) {
		this.#store = options.store;
		this.#runtime = options.runtime;
		this.#createRegistry =
			options.createRegistry ??
			((runtime) =>
				createDefaultBackgroundJobRegistry({ embedder: runtime.embedder }));
		this.#log = options.log;
		this.#limit = options.limit;
		this.#now = options.now;
	}

	/** 把一个故事排进后台队列；同一个故事已经在队列里时合并成一次。 */
	schedule(storyId: string): void {
		if (this.#closed) return;
		if (!this.#queue.includes(storyId)) this.#queue.push(storyId);
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
				try {
					await this.#runStory(storyId);
				} catch (error) {
					this.#log(
						`后台任务失败：${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
		} finally {
			this.#pump = null;
		}
	}

	async #runStory(storyId: string): Promise<void> {
		const runtime = await this.#runtime.get(storyId);
		const client = runtime.backgroundClient;
		if (client === null) {
			this.#log("后台任务跳过：没有可用的后台客户端");
			return;
		}
		const registry = this.#createRegistry(runtime);
		const kinds = resolveStoryBackgroundKinds(registry, {
			gapPassEnabled: this.#store.getStorySettings(storyId).gapPassEnabled,
		});
		if (kinds.length === 0) return;
		const result = await drainBackgroundJobs({
			store: this.#store,
			registry,
			client,
			storyId,
			kinds,
			...(this.#limit === undefined ? {} : { limit: this.#limit }),
			// 服务端不知道玩家下次什么时候输入；一轮结束后按间隙已经耗尽处理。
			sessionEnded: true,
			signal: this.#controller.signal,
			...(this.#now === undefined ? {} : { now: this.#now }),
		});
		const failed = result.runs.filter((run) => run.status === "failed").length;
		this.#log(
			`后台任务 ${storyId}：新增 ${result.enqueued} 条，执行 ${result.runs.length} 条（失败 ${failed}，丢弃 ${result.discarded}）`,
		);
	}
}
