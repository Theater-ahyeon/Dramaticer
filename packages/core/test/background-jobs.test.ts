import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	type BackgroundJobContext,
	type LlmClient,
	type StoryStore,
	type TimelineNode,
	createBackgroundJobRegistry,
	drainBackgroundJobs,
	enqueueMissingJobs,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const FIXED_ISO = new Date(FIXED_NOW).toISOString();

const unusedClient: LlmClient = {
	async complete(): Promise<never> {
		throw new Error("后台任务测试不应该调用模型");
	},
};

function appendNode(
	store: StoryStore,
	id: string,
	parentId: string | null,
): TimelineNode {
	return store.appendNode({
		id,
		storyId: "s1",
		parentId,
		role: parentId === null ? "assistant" : "user",
		raw: `楼层 ${id}`,
	});
}

/** 返回已确认的 a、b 与还在末端、尚未确认的 c。 */
function seedStory(store: StoryStore): {
	readonly a: TimelineNode;
	readonly b: TimelineNode;
	readonly c: TimelineNode;
} {
	store.createStory({ id: "s1", title: "测试" });
	const a = appendNode(store, "n-a", null);
	const b = appendNode(store, "n-b", a.id);
	const c = appendNode(store, "n-c", b.id);
	return { a, b, c };
}

function kindsOf(jobs: readonly BackgroundJob[]): string[] {
	return jobs.map((job) => `${job.nodeId}:${job.kind}`);
}

describe("后台任务入队", () => {
	it("只为已确认楼层补建任务，重复调用不产生重复行", () => {
		const { store } = openTempStore();
		seedStory(store);

		const created = enqueueMissingJobs({
			store,
			storyId: "s1",
			kinds: ["events", "summary"],
			now: () => FIXED_NOW,
		});
		expect(kindsOf(created)).toEqual([
			"n-a:events",
			"n-a:summary",
			"n-b:events",
			"n-b:summary",
		]);
		expect(created.every((job) => job.status === "pending")).toBe(true);
		expect(created.every((job) => job.attempts === 0)).toBe(true);
		expect(created.every((job) => job.createdAt === FIXED_ISO)).toBe(true);

		const again = enqueueMissingJobs({
			store,
			storyId: "s1",
			kinds: ["events", "summary"],
			now: () => FIXED_NOW,
		});
		expect(again).toEqual([]);
		expect(store.listBackgroundJobs({ storyId: "s1" })).toHaveLength(4);
	});

	it("类型列表为空时不建任务，重复类型与空类型直接抛错", () => {
		const { store } = openTempStore();
		seedStory(store);

		expect(enqueueMissingJobs({ store, storyId: "s1", kinds: [] })).toEqual([]);
		expect(() =>
			enqueueMissingJobs({ store, storyId: "s1", kinds: ["events", "events"] }),
		).toThrow("重复");
		expect(() =>
			enqueueMissingJobs({ store, storyId: "s1", kinds: [""] }),
		).toThrow("非空字符串");
		expect(() =>
			enqueueMissingJobs({ store, storyId: "missing", kinds: ["events"] }),
		).toThrow("故事不存在");
	});

	it("数据库触发器拒绝 story_id 与楼层不一致的任务", () => {
		const { store, path } = openTempStore();
		seedStory(store);
		const raw = new Database(path);
		try {
			expect(() =>
				raw
					.prepare(
						`INSERT INTO background_jobs
							(story_id, node_id, kind, status, attempts, created_at)
						VALUES ('other', 'n-a', 'events', 'pending', 0, ?)`,
					)
					.run(FIXED_ISO),
			).toThrow("story_id");
		} finally {
			raw.close();
		}
	});
});

describe("后台任务执行", () => {
	it("执行一次处理器后标为 done，并把任务与依赖一起交给处理器", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const seen: BackgroundJobContext[] = [];
		const registry = createBackgroundJobRegistry({
			events: (context) => {
				seen.push(context);
			},
		});

		const result = await drainBackgroundJobs({
			store,
			registry,
			client: unusedClient,
			storyId: "s1",
			now: () => FIXED_NOW,
		});

		expect(result.enqueued).toBe(2);
		expect(result.runs).toEqual([
			{
				jobId: 1,
				nodeId: "n-a",
				kind: "events",
				status: "done",
				attempts: 1,
				error: null,
			},
			{
				jobId: 2,
				nodeId: "n-b",
				kind: "events",
				status: "done",
				attempts: 1,
				error: null,
			},
		]);
		expect(seen).toHaveLength(2);
		expect(seen[0]?.store).toBe(store);
		expect(seen[0]?.client).toBe(unusedClient);
		expect(seen[0]?.job.nodeId).toBe("n-a");
		expect(seen[0]?.job.status).toBe("running");
		const jobs = store.listBackgroundJobs({ storyId: "s1" });
		expect(jobs.every((job) => job.status === "done")).toBe(true);
		expect(jobs.every((job) => job.startedAt === FIXED_ISO)).toBe(true);
		expect(jobs.every((job) => job.finishedAt === FIXED_ISO)).toBe(true);

		const second = await drainBackgroundJobs({
			store,
			registry,
			client: unusedClient,
			storyId: "s1",
			now: () => FIXED_NOW,
		});
		expect(second.enqueued).toBe(0);
		expect(second.runs).toEqual([]);
	});

	it("失败后退回 pending，累计 3 次执行后标为 failed 并保留最后错误", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const a = appendNode(store, "n-a", null);
		appendNode(store, "n-b", a.id);
		let attempt = 0;
		const registry = createBackgroundJobRegistry({
			events: (context) => {
				attempt = context.job.attempts;
				throw new Error(`第 ${attempt} 次失败`);
			},
		});

		const first = await drainBackgroundJobs({
			store,
			registry,
			client: unusedClient,
			storyId: "s1",
			kinds: ["events"],
			limit: 1,
			now: () => FIXED_NOW,
		});
		expect(first.runs[0]).toMatchObject({
			status: "pending",
			attempts: 1,
			error: "第 1 次失败",
		});

		const second = await drainBackgroundJobs({
			store,
			registry,
			client: unusedClient,
			storyId: "s1",
			kinds: ["events"],
			limit: 1,
			now: () => FIXED_NOW,
		});
		expect(second.runs[0]).toMatchObject({
			status: "pending",
			attempts: 2,
			error: "第 2 次失败",
		});

		const third = await drainBackgroundJobs({
			store,
			registry,
			client: unusedClient,
			storyId: "s1",
			kinds: ["events"],
			limit: 1,
			now: () => FIXED_NOW,
		});
		expect(third.runs[0]).toMatchObject({
			status: "failed",
			attempts: 3,
			error: "第 3 次失败",
		});
		const failed = store.getBackgroundJob(1);
		expect(failed?.status).toBe("failed");
		expect(failed?.lastError).toBe("第 3 次失败");
		expect(failed?.finishedAt).toBe(FIXED_ISO);
		expect(failed?.startedAt).toBe(FIXED_ISO);

		const fourth = await drainBackgroundJobs({
			store,
			registry,
			client: unusedClient,
			storyId: "s1",
			kinds: ["events"],
			limit: 1,
			now: () => FIXED_NOW,
		});
		expect(fourth.runs).toEqual([]);
		expect(attempt).toBe(3);
	});

	it("重试成功后清空错误并保留执行次数", async () => {
		const { store } = openTempStore();
		seedStory(store);
		let calls = 0;
		const registry = createBackgroundJobRegistry({
			events: () => {
				calls += 1;
				if (calls === 1) throw new Error("网络抖动");
			},
		});
		const drain = () =>
			drainBackgroundJobs({
				store,
				registry,
				client: unusedClient,
				storyId: "s1",
				kinds: ["events"],
				limit: 1,
				now: () => FIXED_NOW,
			});

		expect((await drain()).runs[0]).toMatchObject({
			status: "pending",
			error: "网络抖动",
		});
		expect((await drain()).runs[0]).toMatchObject({
			status: "done",
			attempts: 2,
			error: null,
		});
		expect(store.getBackgroundJob(1)?.lastError).toBeNull();
	});

	it("--kind 对应的 kinds 只补建并执行指定类型", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const executed: string[] = [];
		const registry = createBackgroundJobRegistry({
			events: (context) => {
				executed.push(`events:${context.job.nodeId}`);
			},
			summary: (context) => {
				executed.push(`summary:${context.job.nodeId}`);
			},
		});

		const first = await drainBackgroundJobs({
			store,
			registry,
			client: unusedClient,
			storyId: "s1",
			kinds: ["summary"],
			now: () => FIXED_NOW,
		});
		expect(first.enqueued).toBe(2);
		expect(first.runs.map((run) => run.kind)).toEqual(["summary", "summary"]);
		expect(executed).toEqual(["summary:n-a", "summary:n-b"]);
		expect(store.listBackgroundJobs({ storyId: "s1" })).toHaveLength(2);

		await drainBackgroundJobs({
			store,
			registry,
			client: unusedClient,
			storyId: "s1",
			kinds: ["events"],
			now: () => FIXED_NOW,
		});
		expect(executed).toEqual([
			"summary:n-a",
			"summary:n-b",
			"events:n-a",
			"events:n-b",
		]);
		expect(store.listBackgroundJobs({ storyId: "s1" })).toHaveLength(4);

		await expect(
			drainBackgroundJobs({
				store,
				registry,
				client: unusedClient,
				storyId: "s1",
				kinds: ["unknown"],
			}),
		).rejects.toThrow("没有注册后台任务类型 unknown");
	});

	it("limit 按创建顺序截断，未执行的任务保持 pending", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const registry = createBackgroundJobRegistry({
			events: () => undefined,
		});

		const result = await drainBackgroundJobs({
			store,
			registry,
			client: unusedClient,
			storyId: "s1",
			limit: 1,
			now: () => FIXED_NOW,
		});
		expect(result.enqueued).toBe(2);
		expect(result.runs.map((run) => run.nodeId)).toEqual(["n-a"]);
		const jobs = store.listBackgroundJobs({ storyId: "s1" });
		expect(jobs.map((job) => job.status)).toEqual(["done", "pending"]);
	});

	it("只扫描指定故事的楼层，缺失故事直接抛错", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.createStory({ id: "s2", title: "另一个故事" });
		store.appendNode({
			id: "m-a",
			storyId: "s2",
			parentId: null,
			role: "assistant",
			raw: "另一个故事的楼层",
		});
		const registry = createBackgroundJobRegistry({ events: () => undefined });

		const result = await drainBackgroundJobs({
			store,
			registry,
			client: unusedClient,
			storyId: "s2",
			now: () => FIXED_NOW,
		});
		expect(result.enqueued).toBe(0);
		expect(result.runs).toEqual([]);
		expect(store.listBackgroundJobs({ storyId: "s1" })).toEqual([]);

		await expect(
			drainBackgroundJobs({
				store,
				registry,
				client: unusedClient,
				storyId: "missing",
			}),
		).rejects.toThrow("故事不存在");
	});
});

describe("后台任务状态迁移", () => {
	it("非预期状态的任务拒绝开始、完成与记录失败", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const registry = createBackgroundJobRegistry({
			events: () => undefined,
		});
		await drainBackgroundJobs({
			store,
			registry,
			client: unusedClient,
			storyId: "s1",
			now: () => FIXED_NOW,
		});
		const done = store.getBackgroundJob(1);
		expect(done?.status).toBe("done");

		expect(() => store.startBackgroundJob(1)).toThrow("只有 pending");
		expect(() => store.finishBackgroundJob(1)).toThrow("只有 running");
		expect(() =>
			store.failBackgroundJob(1, { error: "x", maxAttempts: 3 }),
		).toThrow("只有 running");
		expect(() => store.getBackgroundJob(0)).toThrow("正整数");
		expect(store.getBackgroundJob(999)).toBeNull();
	});

	it("任务条数与最大执行次数校验参数", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const registry = createBackgroundJobRegistry({
			events: () => undefined,
		});
		await expect(
			drainBackgroundJobs({
				store,
				registry,
				client: unusedClient,
				storyId: "s1",
				limit: 0,
			}),
		).rejects.toThrow("后台任务条数");
		await expect(
			drainBackgroundJobs({
				store,
				registry,
				client: unusedClient,
				storyId: "s1",
				maxAttempts: 0,
			}),
		).rejects.toThrow("最大执行次数");
		expect(store.listBackgroundJobs({ kinds: [] })).toEqual([]);
	});
});
