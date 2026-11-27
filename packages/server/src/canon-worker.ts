/** 原著抽取的后台调度：不绑定故事，也不占故事的每楼后台调用预算（I11）。 */
import {
	type LlmClient,
	type StoryStore,
	extractCanonChapter,
	finalizeCanonExtraction,
	runCanonBookExtraction,
	runCanonCompilation,
} from "@dramaticer/core";

/** 后台模型客户端与别名；story 运行时的 `bookBackground()` 直接满足这个形状。 */
export interface CanonWorkerRuntime {
	readonly client: LlmClient;
	readonly model: string;
}

export interface CanonWorkerRuntimeSource {
	get(): Promise<CanonWorkerRuntime | null>;
}

export interface CanonExtractionWorkerOptions {
	readonly store: StoryStore;
	readonly runtime: CanonWorkerRuntimeSource;
	readonly log: (line: string) => void;
}

interface CanonWorkerTask {
	readonly bookId: string;
	readonly chapterId: string | null;
	readonly mode: "resume" | "full";
	readonly kind: "extract" | "compile";
}

/**
 * 一次只跑一本书的章节（或单章重跑）。暂停由路由写库，
 * 引擎在每块之间检查状态；关闭服务时中止正在进行的请求并等循环退出。
 */
export class CanonExtractionWorker {
	readonly #store: StoryStore;
	readonly #runtime: CanonWorkerRuntimeSource;
	readonly #log: (line: string) => void;
	readonly #queue: CanonWorkerTask[] = [];
	readonly #controller = new AbortController();
	#pump: Promise<void> | null = null;
	#activeBookId: string | null = null;
	#activeKind: CanonWorkerTask["kind"] | null = null;
	#closed = false;

	constructor(options: CanonExtractionWorkerOptions) {
		this.#store = options.store;
		this.#runtime = options.runtime;
		this.#log = options.log;
	}

	startBook(bookId: string): void {
		this.#enqueue({ bookId, chapterId: null, mode: "resume", kind: "extract" });
	}

	reextractChapter(
		bookId: string,
		chapterId: string,
		mode: "resume" | "full",
	): void {
		this.#enqueue({ bookId, chapterId, mode, kind: "extract" });
	}

	startCompile(bookId: string): void {
		this.#enqueue({ bookId, chapterId: null, mode: "resume", kind: "compile" });
	}

	/** 预估页显示的后台模型；没有可用模型时返回 null。 */
	async modelAlias(): Promise<string | null> {
		try {
			return (await this.#runtime.get())?.model ?? null;
		} catch {
			return null;
		}
	}

	async waitForIdle(): Promise<void> {
		while (this.#pump !== null) await this.#pump;
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#queue.length = 0;
		if (!this.#controller.signal.aborted) {
			this.#controller.abort(new Error("服务端关闭"));
		}
		await this.waitForIdle();
	}

	#enqueue(task: CanonWorkerTask): void {
		if (this.#closed) return;
		if (
			this.#activeBookId === task.bookId &&
			this.#activeKind === task.kind &&
			task.chapterId === null
		) {
			return;
		}
		const duplicate = this.#queue.some(
			(item) =>
				item.bookId === task.bookId &&
				item.chapterId === task.chapterId &&
				item.mode === task.mode &&
				item.kind === task.kind,
		);
		if (!duplicate) this.#queue.push(task);
		if (this.#pump === null) this.#pump = this.#runQueue();
	}

	async #runQueue(): Promise<void> {
		try {
			while (!this.#closed) {
				const task = this.#queue.shift();
				if (task === undefined) break;
				this.#activeBookId = task.bookId;
				this.#activeKind = task.kind;
				try {
					await this.#runTask(task);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					this.#log(
						task.kind === "compile"
							? `全书汇编失败：${message}`
							: `原著抽取失败：${message}`,
					);
					try {
						if (task.kind === "compile") {
							this.#store.finishCanonCompilation(
								task.bookId,
								"failed",
								message,
							);
						} else {
							this.#store.finishCanonExtraction(task.bookId, "failed", message);
						}
					} catch {
						// 书可能已被删除；没有可写的进度行。
					}
				} finally {
					this.#activeBookId = null;
					this.#activeKind = null;
				}
			}
		} finally {
			this.#pump = null;
		}
	}

	async #runTask(task: CanonWorkerTask): Promise<void> {
		const pending =
			task.kind === "compile"
				? this.#store.getCanonCompilation(task.bookId)?.status === "running"
				: this.#store.getCanonExtraction(task.bookId)?.status === "running";
		// 排队期间被暂停或取消的任务不启动；开始按钮会重新排进来。
		if (!pending) return;
		const runtime = await this.#runtime.get();
		if (runtime === null) {
			if (task.kind === "compile") {
				this.#store.finishCanonCompilation(
					task.bookId,
					"failed",
					"没有可用的后台模型：在设置里配置 background 或 settler 角色",
				);
			} else {
				this.#store.finishCanonExtraction(
					task.bookId,
					"failed",
					"没有可用的后台模型：在设置里配置 background 或 settler 角色",
				);
			}
			return;
		}
		if (task.kind === "compile") {
			await runCanonCompilation({
				store: this.#store,
				client: runtime.client,
				model: runtime.model,
				bookId: task.bookId,
				signal: this.#controller.signal,
			});
			return;
		}
		if (task.chapterId === null) {
			await runCanonBookExtraction({
				store: this.#store,
				client: runtime.client,
				model: runtime.model,
				bookId: task.bookId,
				signal: this.#controller.signal,
			});
			return;
		}
		await extractCanonChapter({
			store: this.#store,
			client: runtime.client,
			model: runtime.model,
			bookId: task.bookId,
			chapterId: task.chapterId,
			mode: task.mode,
			signal: this.#controller.signal,
		});
		if (this.#store.getCanonExtraction(task.bookId)?.status === "running") {
			finalizeCanonExtraction(this.#store, task.bookId);
		}
	}
}
