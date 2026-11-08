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
