import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
	type BackgroundDrainResult,
	type BackgroundJob,
	type BackgroundJobContext,
	LATEST_SCHEMA_VERSION,
	type LlmClient,
	StoryStore,
	type TimelineNode,
	createBackgroundJobRegistry,
	drainBackgroundJobs,
	enqueueMissingJobs,
	readGapWorkBacklog,
} from "../src/index.js";
import { MIGRATIONS, applyMigrations } from "../src/store/migrations.js";
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

describe("故事级任务按种类入队", () => {
	it("写入 node_id 为空的任务，重复调用返回同一行", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });

		const [opening] = store.enqueueStoryBackgroundJobs({
			storyId: "s1",
			kinds: ["opening"],
			createdAt: FIXED_ISO,
		});
		expect(opening?.nodeId).toBeNull();
		expect(opening?.kind).toBe("opening");
		expect(opening?.status).toBe("pending");
		expect(opening?.attempts).toBe(0);
		expect(opening?.createdAt).toBe(FIXED_ISO);

		const again = store.enqueueStoryBackgroundJobs({
			storyId: "s1",
			kinds: ["opening"],
		});
		expect(again.map((job) => job.id)).toEqual([opening?.id]);
		expect(store.listBackgroundJobs({ storyId: "s1" })).toHaveLength(1);
	});

	it("已完成的任务翻回待办，执行中的任务保持不动", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const [job] = store.enqueueStoryBackgroundJobs({
			storyId: "s1",
			kinds: ["opening"],
		});
		if (job === undefined) throw new Error("测试任务没有入队");
		store.startBackgroundJob(job.id);
		const running = store.enqueueStoryBackgroundJobs({
			storyId: "s1",
			kinds: ["opening"],
		});
		expect(running[0]?.status).toBe("running");

		store.finishBackgroundJob(job.id);
		const reopened = store.enqueueStoryBackgroundJobs({
			storyId: "s1",
			kinds: ["opening"],
		});
		expect(reopened[0]?.id).toBe(job.id);
		expect(reopened[0]?.status).toBe("pending");
		expect(reopened[0]?.finishedAt).toBeNull();
	});

	it("类型列表为空时不建任务，重复类型与空类型直接抛错", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });

		expect(
			store.enqueueStoryBackgroundJobs({ storyId: "s1", kinds: [] }),
		).toEqual([]);
		expect(() =>
			store.enqueueStoryBackgroundJobs({
				storyId: "s1",
				kinds: ["opening", "opening"],
			}),
		).toThrow("重复");
		expect(() =>
			store.enqueueStoryBackgroundJobs({ storyId: "s1", kinds: [""] }),
		).toThrow("非空字符串");
		expect(() =>
			store.enqueueStoryBackgroundJobs({
				storyId: "missing",
				kinds: ["opening"],
			}),
		).toThrow("故事不存在");
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

	it("取消本轮时正在执行的任务退回 pending，不消耗执行次数", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const controller = new AbortController();
		let started = false;
		const registry = createBackgroundJobRegistry({
			events: async ({ signal }) => {
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
			},
		});
		const drain = drainBackgroundJobs({
			store,
			registry,
			client: unusedClient,
			storyId: "s1",
			signal: controller.signal,
			now: () => FIXED_NOW,
		});
		await vi.waitFor(() => expect(started).toBe(true));
		controller.abort(new Error("服务端关闭"));

		const result = await drain;
		expect(result.runs).toHaveLength(1);
		expect(result.runs[0]).toMatchObject({
			status: "pending",
			attempts: 0,
			error: "本轮执行被取消，任务退回待办",
		});
		const jobs = store.listBackgroundJobs({ storyId: "s1" });
		expect(jobs).toHaveLength(2);
		expect(jobs.every((job) => job.status === "pending")).toBe(true);
		expect(jobs.every((job) => job.attempts === 0)).toBe(true);
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

describe("后台任务档位", () => {
	it("可延后档只在长间隙或会话结束后执行", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const executed: string[] = [];
		const registry = createBackgroundJobRegistry({
			settle: {
				handler: (context) => {
					executed.push(`settle:${context.job.nodeId}`);
				},
				enqueue: "settled",
			},
			events: {
				handler: (context) => {
					executed.push(`events:${context.job.nodeId}`);
				},
				tier: "deferred",
			},
		});
		const drain = (options: {
			readonly gapSeconds?: number;
			readonly sessionEnded?: boolean;
		}) =>
			drainBackgroundJobs({
				store,
				registry,
				client: unusedClient,
				storyId: "s1",
				kinds: ["settle", "events"],
				now: () => FIXED_NOW,
				...options,
			});

		const short = await drain({ gapSeconds: 30 });
		expect(executed).toEqual(["settle:n-a"]);
		expect(short.discarded).toBe(0);
		expect(
			store.listBackgroundJobs({ storyId: "s1", kinds: ["events"] }),
		).toHaveLength(2);

		const boundary = await drain({ gapSeconds: 211 });
		expect(executed).toEqual(["settle:n-a"]);
		expect(boundary.runs).toEqual([]);

		store.updateStorySettings("s1", { gapPlanSeconds: 30 });
		await drain({ gapSeconds: 30 });
		expect(executed).toEqual(["settle:n-a", "events:n-a", "events:n-b"]);

		store.appendNode({
			id: "n-d",
			storyId: "s1",
			parentId: "n-c",
			role: "user",
			raw: "楼层 n-d",
		});
		await drain({ gapSeconds: 0, sessionEnded: true });
		expect(executed).toContain("events:n-c");
	});

	it("没有声明档位的任务按 gap 处理，非法档位抛错", () => {
		const registry = createBackgroundJobRegistry({
			events: () => undefined,
			summary: { handler: () => undefined, tier: "deferred" },
		});
		expect(registry.get("events")?.tier).toBe("gap");
		expect(registry.get("summary")?.tier).toBe("deferred");
		expect(() =>
			createBackgroundJobRegistry({
				events: { handler: () => undefined, tier: "later" as never },
			}),
		).toThrow("档位不合法");
	});

	it("间隙秒数不是非负数字时抛错", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const registry = createBackgroundJobRegistry({ events: () => undefined });
		await expect(
			drainBackgroundJobs({
				store,
				registry,
				client: unusedClient,
				storyId: "s1",
				gapSeconds: -1,
			}),
		).rejects.toThrow("间隙秒数");
	});
});

describe("过期任务丢弃", () => {
	it("楼层不在当前路径上时丢弃任务，切回分支后重新入队", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const executed: string[] = [];
		const registry = createBackgroundJobRegistry({
			events: (context) => {
				executed.push(context.job.nodeId);
			},
		});
		const drain = () =>
			drainBackgroundJobs({
				store,
				registry,
				client: unusedClient,
				storyId: "s1",
				kinds: ["events"],
				now: () => FIXED_NOW,
			});

		await enqueueMissingJobs({
			store,
			storyId: "s1",
			kinds: ["events"],
			now: () => FIXED_NOW,
		});
		const branch = store.swipeNode("n-b", "另一条分支的楼层");
		store.setHead("s1", branch.id);

		const second = await drain();
		expect(second.discarded).toBe(1);
		expect(second.runs).toEqual([
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
				status: "discarded",
				attempts: 0,
				error: null,
			},
		]);
		expect(store.getBackgroundJob(2)?.status).toBe("discarded");
		expect(store.countBackgroundJobs({ storyId: "s1" })).toEqual({
			pending: 0,
			running: 0,
			done: 1,
			failed: 0,
			discarded: 1,
		});
		expect(executed).toEqual(["n-a"]);

		store.setHead("s1", "n-b");
		const third = await drain();
		expect(third.enqueued).toBe(1);
		expect(store.getBackgroundJob(2)).toMatchObject({
			status: "done",
			attempts: 1,
		});
		expect(executed).toContain("n-b");
	});

	it("只有 pending 任务可以丢弃", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const registry = createBackgroundJobRegistry({ events: () => undefined });
		await drainBackgroundJobs({
			store,
			registry,
			client: unusedClient,
			storyId: "s1",
			kinds: ["events"],
		});
		expect(() => store.discardBackgroundJob(1)).toThrow("只有 pending");
	});
});

describe("入队只看当前路径", () => {
	interface BranchScenario {
		readonly store: StoryStore;
		readonly executed: string[];
		readonly oldJobIds: readonly number[];
		readonly drain: () => Promise<BackgroundDrainResult>;
	}

	/** 旧分支有 `oldFloorCount` 个楼层；入队旧分支任务后从 n-c 切到新分支。 */
	async function openBranchScenario(
		oldFloorCount: number,
	): Promise<BranchScenario> {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "分支测试" });
		const append = (
			id: string,
			parentId: string | null,
			role: "assistant" | "user",
		) =>
			store.appendNode({
				id,
				storyId: "s1",
				parentId,
				role,
				raw: `楼层 ${id}`,
			});
		append("n-a", null, "assistant");
		append("n-b", "n-a", "user");
		append("n-c", "n-b", "assistant");
		let parentId = "n-c";
		for (let index = 1; index <= oldFloorCount; index += 1) {
			const id = `n-old-${index}`;
			append(id, parentId, index % 2 === 1 ? "user" : "assistant");
			parentId = id;
		}
		const queued = await enqueueMissingJobs({
			store,
			storyId: "s1",
			kinds: ["events"],
			now: () => FIXED_NOW,
		});
		const oldJobIds = queued
			.filter((job) => job.nodeId?.startsWith("n-old-") === true)
			.map((job) => job.id);
		if (oldJobIds.length === 0) throw new Error("旧分支任务没有入队");

		store.setHead("s1", "n-c");
		append("n-new", "n-c", "user");
		append("n-new-reply", "n-new", "assistant");

		const executed: string[] = [];
		const registry = createBackgroundJobRegistry({
			events: (context) => {
				executed.push(String(context.job.nodeId));
			},
		});
		return {
			store,
			executed,
			oldJobIds,
			drain: () =>
				drainBackgroundJobs({
					store,
					registry,
					client: unusedClient,
					storyId: "s1",
					kinds: ["events"],
					now: () => FIXED_NOW,
				}),
		};
	}

	it(
		"放弃分支后用 drain 推进当前路径上的任务",
		{ timeout: 30_000 },
		async () => {
			const scenario = await openBranchScenario(5);
			const result = await scenario.drain();
			expect(
				result.runs
					.filter((run) => run.status === "done")
					.map((run) => run.nodeId),
			).toEqual(["n-a", "n-b", "n-c", "n-new"]);
			expect(result.discarded).toBe(4);
			expect(scenario.executed).toEqual(["n-a", "n-b", "n-c", "n-new"]);
		},
		{ timeout: 30_000 },
	);

	it(
		"旧分支任务保持 discarded，后续入队不再翻回",
		{ timeout: 30_000 },
		async () => {
			const scenario = await openBranchScenario(5);
			await scenario.drain();
			const jobId = scenario.oldJobIds[0] as number;
			expect(scenario.store.getBackgroundJob(jobId)?.status).toBe("discarded");

			const second = await scenario.drain();
			expect(second.enqueued).toBe(0);
			expect(second.runs).toEqual([]);
			const third = await scenario.drain();
			expect(third.enqueued).toBe(0);
			expect(third.runs).toEqual([]);
			expect(scenario.store.getBackgroundJob(jobId)?.status).toBe("discarded");
			expect(
				scenario.store.countBackgroundJobs({
					storyId: "s1",
					kinds: ["events"],
				}),
			).toEqual({
				pending: 0,
				running: 0,
				done: 4,
				failed: 0,
				discarded: 4,
			});
		},
		{ timeout: 30_000 },
	);

	it(
		"切回旧分支后任务重新入队并执行",
		{ timeout: 30_000 },
		async () => {
			const scenario = await openBranchScenario(5);
			await scenario.drain();
			scenario.store.setHead("s1", "n-old-5");
			const result = await scenario.drain();
			expect(result.enqueued).toBe(4);
			expect(
				result.runs.map((run) => `${String(run.nodeId)}:${run.status}`),
			).toEqual([
				"n-old-1:done",
				"n-old-2:done",
				"n-old-3:done",
				"n-old-4:done",
			]);
			expect(scenario.executed.slice(-4)).toEqual([
				"n-old-1",
				"n-old-2",
				"n-old-3",
				"n-old-4",
			]);
		},
		{ timeout: 30_000 },
	);

	it(
		"旧分支任务不再占据队列头部",
		{ timeout: 30_000 },
		async () => {
			const scenario = await openBranchScenario(25);
			const first = await scenario.drain();
			expect(first.discarded).toBe(17);
			expect(scenario.executed).not.toContain("n-new");

			const second = await scenario.drain();
			expect(second.discarded).toBe(7);
			expect(second.enqueued).toBe(0);
			expect(scenario.executed).toContain("n-new");

			const third = await scenario.drain();
			expect(third).toEqual({ enqueued: 0, discarded: 0, runs: [] });
			expect(
				scenario.store.listBackgroundJobs({
					storyId: "s1",
					status: "pending",
				}),
			).toEqual([]);
		},
		{ timeout: 30_000 },
	);
});

describe("进程中断后的恢复", () => {
	it("把 running 退回 pending 并撤销执行次数，其它状态不动", () => {
		const { store } = openTempStore();
		seedStory(store);
		const jobs = store.enqueueMissingBackgroundJobs({
			storyId: "s1",
			kinds: ["events", "summary"],
			createdAt: FIXED_ISO,
		});
		const done = jobs[0];
		const failed = jobs[1];
		const discarded = jobs[2];
		const interrupted = jobs[3];
		if (
			done === undefined ||
			failed === undefined ||
			discarded === undefined ||
			interrupted === undefined
		) {
			throw new Error("测试任务没有全部入队");
		}
		store.startBackgroundJob(done.id, FIXED_ISO);
		store.finishBackgroundJob(done.id, FIXED_ISO);
		store.startBackgroundJob(failed.id, FIXED_ISO);
		store.failBackgroundJob(failed.id, {
			error: "重试次数用尽",
			maxAttempts: 1,
			finishedAt: FIXED_ISO,
		});
		store.discardBackgroundJob(discarded.id, FIXED_ISO);
		store.startBackgroundJob(interrupted.id, FIXED_ISO);
		store.failBackgroundJob(interrupted.id, {
			error: "旧错误",
			maxAttempts: 3,
			finishedAt: FIXED_ISO,
		});
		store.startBackgroundJob(interrupted.id, FIXED_ISO);

		expect(store.requeueRunningBackgroundJobs("s1")).toBe(1);
		expect(store.getBackgroundJob(interrupted.id)).toMatchObject({
			status: "pending",
			attempts: 1,
			lastError: "旧错误",
			startedAt: null,
			finishedAt: null,
		});
		expect(store.getBackgroundJob(done.id)).toMatchObject({ status: "done" });
		expect(store.getBackgroundJob(failed.id)).toMatchObject({
			status: "failed",
		});
		expect(store.getBackgroundJob(discarded.id)).toMatchObject({
			status: "discarded",
		});
		expect(store.requeueRunningBackgroundJobs("s1")).toBe(0);

		store.createStory({ id: "s2", title: "别的故事" });
		appendOtherStoryNode(store);
		const [otherJob] = store.enqueueMissingBackgroundJobs({
			storyId: "s2",
			kinds: ["events"],
			conditions: { events: "settled" },
			createdAt: FIXED_ISO,
		});
		if (otherJob === undefined) throw new Error("别的故事任务没有入队");
		store.startBackgroundJob(otherJob.id, FIXED_ISO);
		expect(store.requeueRunningBackgroundJobs("s1")).toBe(0);
		expect(store.getBackgroundJob(otherJob.id)?.status).toBe("running");
		expect(store.requeueRunningBackgroundJobs()).toBe(1);
		expect(store.getBackgroundJob(otherJob.id)).toMatchObject({
			status: "pending",
			attempts: 0,
		});
	});

	it(
		"恢复后 drain 重新执行它，执行次数不重复累计",
		{ timeout: 30_000 },
		async () => {
			const { store } = openTempStore();
			seedStory(store);
			const [interrupted] = store.enqueueMissingBackgroundJobs({
				storyId: "s1",
				kinds: ["events"],
				createdAt: FIXED_ISO,
			});
			if (interrupted === undefined) throw new Error("测试任务没有入队");
			store.startBackgroundJob(interrupted.id, FIXED_ISO);
			expect(store.getBackgroundJob(interrupted.id)).toMatchObject({
				status: "running",
				attempts: 1,
			});

			expect(store.requeueRunningBackgroundJobs()).toBe(1);
			const executed: string[] = [];
			const result = await drainBackgroundJobs({
				store,
				registry: createBackgroundJobRegistry({
					events: (context) => {
						executed.push(String(context.job.nodeId));
					},
				}),
				client: unusedClient,
				storyId: "s1",
				kinds: ["events"],
				now: () => FIXED_NOW,
			});
			expect(result.enqueued).toBe(0);
			expect(executed).toContain("n-a");
			expect(store.getBackgroundJob(interrupted.id)).toMatchObject({
				status: "done",
				attempts: 1,
				startedAt: FIXED_ISO,
				finishedAt: FIXED_ISO,
			});
		},
	);

	function appendOtherStoryNode(store: StoryStore): TimelineNode {
		return store.appendNode({
			storyId: "s2",
			parentId: null,
			role: "assistant",
			raw: "另一个故事的开场",
		});
	}
});

describe("间隙积压", () => {
	it("按状态读出关键间隙工作的未完成比例", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const registry = createBackgroundJobRegistry({
			events: () => undefined,
			summary: { handler: () => undefined, tier: "deferred" },
		});
		await drainBackgroundJobs({
			store,
			registry,
			client: unusedClient,
			storyId: "s1",
			kinds: ["events", "summary"],
			limit: 1,
			sessionEnded: true,
			now: () => FIXED_NOW,
		});
		const backlog = readGapWorkBacklog(store, "s1", ["events"]);
		expect(backlog.counts).toEqual({
			pending: 1,
			running: 0,
			done: 1,
			failed: 0,
			discarded: 0,
		});
		expect(backlog.unfinishedRatio).toBe(0.5);
		expect(readGapWorkBacklog(store, "s1", ["missing"]).unfinishedRatio).toBe(
			0,
		);
		expect(() =>
			store.countBackgroundJobs({ storyId: "s1", kinds: ["events", "events"] }),
		).toThrow("重复");
	});
});

describe("schema 迁移 v26", () => {
	it("升级保留已有后台任务，并允许丢弃状态", () => {
		const dir = mkdtempSync(join(import.meta.dirname, ".tmp-migrate-"));
		const path = join(dir, "story.db");
		onTestFinished(() => {
			rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
		});
		const raw = new Database(path);
		sqliteVec.load(raw);
		applyMigrations(
			raw,
			MIGRATIONS.filter((migration) => migration.version <= 25),
		);
		expect(raw.pragma("user_version", { simple: true })).toBe(25);
		raw
			.prepare("INSERT INTO stories (id, title, created_at) VALUES (?, ?, ?)")
			.run("s1", "测试", FIXED_ISO);
		raw
			.prepare(
				"INSERT INTO nodes (id, story_id, parent_id, role, raw, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run("n-a", "s1", null, "assistant", "楼层", FIXED_ISO);
		raw
			.prepare(
				`INSERT INTO background_jobs
					(story_id, node_id, kind, status, attempts, created_at)
				VALUES (?, ?, ?, 'pending', 2, ?)`,
			)
			.run("s1", "n-a", "events", FIXED_ISO);
		raw.close();

		const store = StoryStore.open(path);
		try {
			expect(store.getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION);
			expect(store.getBackgroundJob(1)).toMatchObject({
				nodeId: "n-a",
				kind: "events",
				status: "pending",
				attempts: 2,
			});
			expect(store.getStorySettings("s1").gapPlanSeconds).toBe(212);
			expect(store.discardBackgroundJob(1).status).toBe("discarded");
		} finally {
			store.close();
		}
	});
});
