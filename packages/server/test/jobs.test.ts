import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StoryJobsView } from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-jobs-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

function writeWeb(root: string): void {
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "index.html"), "<!doctype html><title>应用</title>");
}

async function startTestServer(): Promise<RunningServer> {
	const dir = tempDir();
	const webRoot = join(dir, "web");
	writeWeb(webRoot);
	const running = await startServer({
		dbPath: join(dir, "story.db"),
		webRoot,
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => undefined,
	});
	onTestFinished(() => running.close());
	return running;
}

describe("GET /api/stories/:id/jobs", () => {
	it("返回各状态计数与最近的失败错误", async () => {
		const running = await startTestServer();
		const store = running.store;
		store.createStory({ id: "s1", title: "测试故事" });
		store.appendNode({
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场",
		});
		const [job] = store.enqueueMissingBackgroundJobs({
			storyId: "s1",
			kinds: ["probe"],
			conditions: { probe: "settled" },
			createdAt: "2026-11-08T00:00:00.000Z",
		});
		if (job === undefined) throw new Error("测试任务没有入队");
		store.startBackgroundJob(job.id, "2026-11-08T00:00:01.000Z");
		store.failBackgroundJob(job.id, {
			error: "模拟失败",
			maxAttempts: 1,
			finishedAt: "2026-11-08T00:00:02.000Z",
		});

		const response = await fetch(`${running.origin}/api/stories/s1/jobs`);
		expect(response.status).toBe(200);
		const view = (await response.json()) as StoryJobsView;
		expect(view.storyId).toBe("s1");
		expect(view.counts).toEqual({
			pending: 0,
			running: 0,
			done: 0,
			failed: 1,
			discarded: 0,
		});
		expect(view.recentErrors).toEqual([
			{
				jobId: job.id,
				nodeId: job.nodeId,
				kind: "probe",
				status: "failed",
				attempts: 1,
				error: "模拟失败",
				recordedAt: "2026-11-08T00:00:02.000Z",
			},
		]);
	});

	it("按实际模型调用分三类：每楼预算、一次性导入、插图", async () => {
		const running = await startTestServer();
		const store = running.store;
		store.createStory({ id: "s1", title: "测试故事" });
		store.appendNode({
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场",
		});
		const run = (
			kind: string,
			condition: "settled" | "story",
			calls: number,
			tokens: number,
		) => {
			const [job] =
				condition === "story"
					? store.enqueueStoryBackgroundJobs({
							storyId: "s1",
							kinds: [kind],
							createdAt: "2026-11-24T00:00:00.000Z",
						})
					: store.enqueueMissingBackgroundJobs({
							storyId: "s1",
							kinds: [kind],
							conditions: { [kind]: "settled" },
							createdAt: "2026-11-24T00:00:00.000Z",
						});
			if (job === undefined) throw new Error(`${kind} 没有入队`);
			store.startBackgroundJob(job.id);
			store.addBackgroundJobUsage(job.id, { calls, tokens });
			store.finishBackgroundJob(job.id);
		};
		run("scene_log", "settled", 1, 400);
		run("scene_archive", "story", 1, 600);
		run("opening", "story", 2, 900);
		run("illustrate", "story", 1, 0);
		// 不调模型的任务（向量入库）不算调用。
		run("embeddings", "settled", 0, 0);

		const view = (await (
			await fetch(`${running.origin}/api/stories/s1/jobs`)
		).json()) as StoryJobsView;
		expect(view.calls).toEqual({
			perFloor: 2,
			oneTime: 2,
			images: 1,
			floors: 1,
			perFloorTokens: 1000,
			oneTimeTokens: 900,
		});
	});

	it("故事不存在返回 404，非 GET 返回 405", async () => {
		const running = await startTestServer();
		const missing = await fetch(`${running.origin}/api/stories/missing/jobs`);
		expect(missing.status).toBe(404);
		const wrongMethod = await fetch(
			`${running.origin}/api/stories/missing/jobs`,
			{
				method: "POST",
			},
		);
		expect(wrongMethod.status).toBe(405);
	});
});

describe("服务启动时的后台任务恢复", () => {
	it("把上一个进程遗留的 running 任务退回待办", async () => {
		const dir = tempDir();
		const dbPath = join(dir, "story.db");
		const webRoot = join(dir, "web");
		writeWeb(webRoot);
		const first = await startServer({
			dbPath,
			webRoot,
			host: "127.0.0.1",
			port: 0,
			password: null,
			log: () => undefined,
		});
		first.store.createStory({ id: "s1", title: "测试故事" });
		first.store.appendNode({
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场",
		});
		const [job] = first.store.enqueueMissingBackgroundJobs({
			storyId: "s1",
			kinds: ["probe"],
			conditions: { probe: "settled" },
			createdAt: "2026-11-08T00:00:00.000Z",
		});
		if (job === undefined) throw new Error("测试任务没有入队");
		first.store.startBackgroundJob(job.id, "2026-11-08T00:00:01.000Z");
		expect(first.store.getBackgroundJob(job.id)?.status).toBe("running");
		await first.close();

		const second = await startServer({
			dbPath,
			webRoot,
			host: "127.0.0.1",
			port: 0,
			password: null,
			log: () => undefined,
		});
		onTestFinished(() => second.close());
		expect(second.store.getBackgroundJob(job.id)).toMatchObject({
			status: "pending",
			attempts: 0,
			startedAt: null,
			finishedAt: null,
		});
	});
});
