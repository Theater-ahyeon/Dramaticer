import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonPackage, StoryCanonView } from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

async function startTestServer(): Promise<{
	readonly running: RunningServer;
	readonly origin: string;
}> {
	const workDir = mkdtempSync(join(import.meta.dirname, ".tmp-canon-window-"));
	onTestFinished(() =>
		rmSync(workDir, { recursive: true, force: true, maxRetries: 5 }),
	);
	const dbPath = join(workDir, "story.db");
	const webRoot = join(workDir, "web");
	mkdirSync(webRoot, { recursive: true });
	writeFileSync(
		join(webRoot, "index.html"),
		"<!doctype html><title>应用</title>",
	);
	const running = await startServer({
		dbPath,
		webRoot,
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => {},
	});
	onTestFinished(() => running.close());
	return { running, origin: running.origin };
}

function packageView(): CanonPackage {
	return {
		format: "dramaticer-canon-package",
		version: 1,
		exportedAt: "2026-11-27T00:00:00.000Z",
		book: {
			title: "窗口测试原著",
			filename: null,
			encoding: "utf-8",
			charCount: 100,
			chapterCount: 5,
			hasText: false,
		},
		chapters: [1, 2, 3, 4, 5].map((ordinal) => ({
			ordinal,
			volumeTitle: null,
			title: `第${ordinal}章`,
			kind: "chapter" as const,
			charCount: 20,
			paragraphCount: 1,
		})),
		entities: [
			{
				name: "少年",
				aliases: [],
				kind: "人物",
				lead: "山门里的少年弟子。",
				base: "第1章 少年是山门弟子。",
				baseEntries: [{ chapterOrdinal: 1, text: "少年是山门弟子。" }],
				firstChapterOrdinal: 1,
				lastChapterOrdinal: 1,
			},
		],
		events: [1, 2, 3, 4, 5].map((ordinal) => ({
			chapterOrdinal: ordinal,
			seq: 1,
			title: `事件${ordinal}`,
			summary: `第${ordinal}章的概要。`,
			digest: `第${ordinal}章的缩写。`,
			participants: ["少年"],
			location: "山门",
			timeText: null,
			paragraphStart: 1,
			paragraphEnd: 1,
			isInterlude: false,
			timelineOrder: ordinal,
			isTurningPoint: ordinal === 5,
		})),
		voices: [],
		facts: [],
	};
}

async function post(
	origin: string,
	path: string,
	body: unknown,
): Promise<Response> {
	return fetch(`${origin}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function patch(
	origin: string,
	path: string,
	body: unknown,
): Promise<Response> {
	return fetch(`${origin}${path}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function createCanonStory(origin: string): Promise<{
	readonly storyId: string;
	readonly view: StoryCanonView;
}> {
	const imported = await post(origin, "/api/canon/packages/import", {
		package: packageView(),
	});
	expect(imported.status).toBe(201);
	const importedBody = (await imported.json()) as {
		readonly book: { readonly id: string };
	};
	const started = await post(origin, "/api/canon/start-story", {
		bookId: importedBody.book.id,
		identityKind: "custom",
		playerName: "旅人",
		persona: "从山下来的旅人。",
	});
	expect(started.status).toBe(201);
	const startedBody = (await started.json()) as {
		readonly story: { readonly id: string };
	};
	const response = await fetch(
		`${origin}/api/stories/${startedBody.story.id}/canon`,
	);
	expect(response.status).toBe(200);
	return {
		storyId: startedBody.story.id,
		view: (await response.json()) as StoryCanonView,
	};
}

describe("原著窗口接口", () => {
	it("默认概要加话术；打开全书、切换原文、推进 N 件与从这里开始都生效", async () => {
		const { origin } = await startTestServer();
		const { storyId, view } = await createCanonStory(origin);
		expect(view.bound).not.toBeNull();
		const bound = view.bound;
		if (bound === null) throw new Error("原著绑定读取失败");
		expect(bound.windowMode).toBe("summary_voice");
		expect(bound.pendingAdvance).toBe(0);
		expect(bound.allowFullBookSpoilers).toBe(false);
		expect(bound.currentEvent?.title).toBe("事件1");
		expect(bound.timeline).toHaveLength(5);
		expect(bound.cursor?.fromHere).toBe(false);

		const settings = await patch(
			origin,
			`/api/stories/${storyId}/canon/settings`,
			{ allowFullBookSpoilers: true, windowMode: "full_text" },
		);
		expect(settings.status).toBe(200);
		const settingsBody = (await settings.json()) as StoryCanonView;
		expect(settingsBody.bound?.allowFullBookSpoilers).toBe(true);
		expect(settingsBody.bound?.windowMode).toBe("full_text");

		const advanced = await post(
			origin,
			`/api/stories/${storyId}/canon/advance`,
			{ count: 2 },
		);
		expect(advanced.status).toBe(200);
		const advancedBody = (await advanced.json()) as StoryCanonView;
		expect(advancedBody.bound?.pendingAdvance).toBe(2);

		const target = bound.timeline[2];
		if (target === undefined) throw new Error("缺少第三件事件");
		const jumped = await post(origin, `/api/stories/${storyId}/canon/cursor`, {
			eventId: target.id,
		});
		expect(jumped.status).toBe(200);
		const jumpedBody = (await jumped.json()) as {
			readonly cursor: { readonly eventId: number; readonly fromHere: boolean };
			readonly canon: StoryCanonView;
		};
		expect(jumpedBody.cursor.eventId).toBe(target.id);
		expect(jumpedBody.cursor.fromHere).toBe(true);
		expect(jumpedBody.canon.bound?.currentEvent?.title).toBe("事件3");
		expect(jumpedBody.canon.bound?.pendingAdvance).toBe(0);
	});

	it("未绑定原著的故事没有窗口设置；非法窗口模式被拒绝", async () => {
		const { origin } = await startTestServer();
		const created = await post(origin, "/api/stories", { title: "普通故事" });
		expect(created.status).toBe(201);
		const story = (await created.json()) as { readonly id: string };
		const read = await fetch(`${origin}/api/stories/${story.id}/canon`);
		expect(read.status).toBe(200);
		expect((await read.json()) as StoryCanonView).toEqual({ bound: null });
		const settings = await patch(
			origin,
			`/api/stories/${story.id}/canon/settings`,
			{ windowMode: "full_text" },
		);
		expect(settings.status).toBe(404);

		const { storyId } = await createCanonStory(origin);
		const invalid = await patch(
			origin,
			`/api/stories/${storyId}/canon/settings`,
			{ windowMode: "everything" },
		);
		expect(invalid.status).toBe(400);
	});
});
