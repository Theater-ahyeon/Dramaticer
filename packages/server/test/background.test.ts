import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	type BackgroundJobContext,
	type BackgroundJobRegistry,
	type LlmClient,
	StoryStore,
	createBackgroundJobRegistry,
} from "@dramaticer/core";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
	type BackgroundRuntimeSource,
	BackgroundScheduler,
} from "../src/background.js";

const unusedClient: LlmClient = {
	async complete() {
		throw new Error("测试不发起模型请求");
	},
};

function tempStore(): StoryStore {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-background-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	const store = StoryStore.open(join(dir, "story.db"));
	onTestFinished(() => store.close());
	return store;
}

function runtimeSource(): BackgroundRuntimeSource {
	return {
		async get() {
			return {
				backgroundClient: unusedClient,
				plannerClient: null,
				embedder: null,
			};
		},
	};
}

function seedStory(store: StoryStore, storyId: string): void {
	store.createStory({ id: storyId, title: storyId });
	store.appendNode({
		storyId,
		parentId: null,
		role: "assistant",
		raw: "开场",
	});
}

function registryOf(
	handler: (context: BackgroundJobContext) => Promise<void> | void,
): BackgroundJobRegistry {
	return createBackgroundJobRegistry({
		step: { handler, enqueue: "settled" },
	});
}

describe("server 后台任务调度", () => {
	it("回合排入后台队列后执行任务并写入状态", async () => {
		const store = tempStore();
		seedStory(store, "s1");
		const seen: string[] = [];
		const scheduler = new BackgroundScheduler({
			store,
			runtime: runtimeSource(),
			createRegistry: () =>
				registryOf(({ job }) => {
					seen.push(job.storyId);
				}),
			log: () => undefined,
		});
		scheduler.schedule("s1");
		await scheduler.waitForIdle();
		expect(seen).toEqual(["s1"]);
		expect(store.countBackgroundJobs({ storyId: "s1" })).toMatchObject({
			pending: 0,
			done: 1,
			failed: 0,
		});
		await scheduler.close();
	});

	it("多个故事按排入顺序逐个执行，任一时刻只有一个处理器在跑", async () => {
		const store = tempStore();
		seedStory(store, "s1");
		seedStory(store, "s2");
		const gate = Promise.withResolvers<void>();
		const started: string[] = [];
		const order: string[] = [];
		let active = 0;
		let maxActive = 0;
		const scheduler = new BackgroundScheduler({
			store,
			runtime: runtimeSource(),
			createRegistry: () =>
				registryOf(async ({ job }) => {
					started.push(job.storyId);
					active += 1;
					maxActive = Math.max(maxActive, active);
					await gate.promise;
					active -= 1;
					order.push(job.storyId);
				}),
			log: () => undefined,
		});
		scheduler.schedule("s1");
		scheduler.schedule("s2");
		await vi.waitFor(() => expect(started).toEqual(["s1"]));
		expect(order).toEqual([]);
		gate.resolve();
		await scheduler.waitForIdle();
		expect(started).toEqual(["s1", "s2"]);
		expect(order).toEqual(["s1", "s2"]);
		expect(maxActive).toBe(1);
		await scheduler.close();
	});

	it("连续失败累计到上限后标为 failed 并保留错误", async () => {
		const store = tempStore();
		seedStory(store, "s1");
		const scheduler = new BackgroundScheduler({
			store,
			runtime: runtimeSource(),
			createRegistry: () =>
				registryOf(() => {
					throw new Error("模拟失败");
				}),
			log: () => undefined,
		});
		scheduler.schedule("s1");
		await scheduler.waitForIdle();
		expect(store.countBackgroundJobs({ storyId: "s1" })).toMatchObject({
			pending: 1,
			failed: 0,
		});
		scheduler.schedule("s1");
		await scheduler.waitForIdle();
		scheduler.schedule("s1");
		await scheduler.waitForIdle();
		expect(store.countBackgroundJobs({ storyId: "s1" })).toMatchObject({
			pending: 0,
			failed: 1,
		});
		const failed = store
			.listBackgroundJobs({ storyId: "s1" })
			.find((job) => job.status === "failed");
		expect(failed?.attempts).toBe(3);
		expect(failed?.lastError).toBe("模拟失败");
		await scheduler.close();
	});

	it("关闭调度时中止正在执行的处理器并把任务退回待办", async () => {
		const store = tempStore();
		seedStory(store, "s1");
		let started = false;
		const scheduler = new BackgroundScheduler({
			store,
			runtime: runtimeSource(),
			createRegistry: () =>
				registryOf(async ({ signal }) => {
					started = true;
					const aborted = Promise.withResolvers<void>();
					if (signal?.aborted === true) {
						aborted.resolve();
					} else {
						signal?.addEventListener("abort", () => aborted.resolve(), {
							once: true,
						});
					}
					await aborted.promise;
					throw signal?.reason ?? new Error("取消");
				}),
			log: () => undefined,
		});
		scheduler.schedule("s1");
		await vi.waitFor(() => expect(started).toBe(true));
		await scheduler.close();
		expect(store.countBackgroundJobs({ storyId: "s1" })).toMatchObject({
			pending: 1,
			running: 0,
		});
		const job = store.listBackgroundJobs({ storyId: "s1" })[0];
		expect(job?.attempts).toBe(0);
		expect(job?.status).toBe("pending");
	});
});
