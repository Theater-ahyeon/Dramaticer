import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonPackage, StoryCanonPageView } from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

async function startTestServer(): Promise<{
	readonly running: RunningServer;
	readonly origin: string;
}> {
	const workDir = mkdtempSync(join(import.meta.dirname, ".tmp-canon-page-"));
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
			title: "原著页测试",
			filename: "page.txt",
			encoding: "utf-8",
			charCount: 300,
			chapterCount: 3,
			hasText: true,
		},
		chapters: [1, 2, 3].map((ordinal) => ({
			ordinal,
			volumeTitle: null,
			title: `第${ordinal}章`,
			kind: "chapter" as const,
			charCount: 100,
			paragraphCount: 1,
			paragraphs: [`第${ordinal}章的原文。`],
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
		events: [1, 2, 3].map((ordinal) => ({
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
			isTurningPoint: ordinal === 2,
		})),
		voices: [
			{
				chapterOrdinal: 1,
				ordinal: 1,
				character: "少年",
				kind: "speech",
				text: "我回来了。",
			},
		],
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

async function createCanonStory(origin: string): Promise<string> {
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
	return startedBody.story.id;
}

async function readPage(
	origin: string,
	storyId: string,
): Promise<StoryCanonPageView> {
	const response = await fetch(`${origin}/api/stories/${storyId}/canon/page`);
	expect(response.status).toBe(200);
	return (await response.json()) as StoryCanonPageView;
}

describe("原著页接口", () => {
	it("按格编辑、读回分页、撤销与回到旧版本", async () => {
		const { origin } = await startTestServer();
		const storyId = await createCanonStory(origin);
		const page = await readPage(origin, storyId);
		if (page.bound === null) throw new Error("原著页没有绑定");
		expect(page.bound.bookTitle).toBe("原著页测试");
		expect(page.bound.events.map((event) => event.state)).toEqual([
			"current",
			"future",
			"future",
		]);
		const first = page.bound.events[0];
		if (first === undefined) throw new Error("缺少第一件事件");
		expect(first.title).toBe("事件1");
		expect(first.voices[0]?.text).toBe("我回来了。");
		expect(first.passage).toEqual(["第1章的原文。"]);

		const edited = await post(
			origin,
			`/api/stories/${storyId}/canon/events/${first.id}/edit`,
			{
				field: "summary",
				value: "守门人多问了一句。",
			},
		);
		expect(edited.status).toBe(200);
		const editedBody = (await edited.json()) as StoryCanonPageView;
		const editedFirst = editedBody.bound?.events[0];
		expect(editedFirst?.summary).toBe("守门人多问了一句。");
		expect(editedFirst?.editedFields).toEqual(["summary"]);
		expect(editedFirst?.versions).toHaveLength(1);
		expect(editedFirst?.versions[0]?.source).toBe("player");

		const voicesEdit = await post(
			origin,
			`/api/stories/${storyId}/canon/events/${first.id}/edit`,
			{
				field: "voices",
				value: [{ character: "少年", kind: "thought", text: "雨太大了。" }],
			},
		);
		expect(voicesEdit.status).toBe(200);
		const voicesBody = (await voicesEdit.json()) as StoryCanonPageView;
		expect(voicesBody.bound?.events[0]?.voices[0]?.text).toBe("雨太大了。");

		const persisted = await readPage(origin, storyId);
		expect(persisted.bound?.events[0]?.summary).toBe("守门人多问了一句。");
		expect(persisted.bound?.events[0]?.versions).toHaveLength(2);

		const undone = await post(
			origin,
			`/api/stories/${storyId}/canon/events/${first.id}/rollback`,
			{ field: "summary" },
		);
		expect(undone.status).toBe(200);
		const undoneBody = (await undone.json()) as StoryCanonPageView;
		const undoneFirst = undoneBody.bound?.events[0];
		expect(undoneFirst?.summary).toBe("第1章的概要。");
		expect(undoneFirst?.versions).toHaveLength(3);
		expect(undoneFirst?.versions[0]?.source).toBe("rollback");

		// 按格撤销：话术回到抽取结果。
		const restored = await post(
			origin,
			`/api/stories/${storyId}/canon/events/${first.id}/rollback`,
			{ field: "voices" },
		);
		expect(restored.status).toBe(200);
		const restoredBody = (await restored.json()) as StoryCanonPageView;
		expect(restoredBody.bound?.events[0]?.voices[0]?.text).toBe("我回来了。");

		// 回到指定版本：缩写改两版后回到较早的一版。
		for (const value of ["缩写甲", "缩写乙"]) {
			const response = await post(
				origin,
				`/api/stories/${storyId}/canon/events/${first.id}/edit`,
				{ field: "digest", value },
			);
			expect(response.status).toBe(200);
		}
		const digestPage = await readPage(origin, storyId);
		const digestVersions =
			digestPage.bound?.events[0]?.versions.filter(
				(version) => version.field === "digest",
			) ?? [];
		expect(digestVersions.map((version) => version.value)).toEqual([
			"缩写乙",
			"缩写甲",
		]);
		const older = digestVersions[1];
		if (older === undefined) throw new Error("缺少较早的缩写版本");
		const reverted = await post(
			origin,
			`/api/stories/${storyId}/canon/events/${first.id}/rollback`,
			{ versionId: older.id },
		);
		expect(reverted.status).toBe(200);
		const revertedBody = (await reverted.json()) as StoryCanonPageView;
		expect(revertedBody.bound?.events[0]?.digest).toBe("缩写甲");
		expect(revertedBody.bound?.events[0]?.versions[0]?.source).toBe("rollback");
	});

	it("未来事件也能改；非法格与非本故事事件被拒绝", async () => {
		const { origin } = await startTestServer();
		const storyId = await createCanonStory(origin);
		const page = await readPage(origin, storyId);
		if (page.bound === null) throw new Error("原著页没有绑定");
		const future = page.bound.events[2];
		if (future === undefined) throw new Error("缺少第三件事件");

		const edited = await post(
			origin,
			`/api/stories/${storyId}/canon/events/${future.id}/edit`,
			{ field: "title", value: "渡口提前" },
		);
		expect(edited.status).toBe(200);
		const body = (await edited.json()) as StoryCanonPageView;
		expect(body.bound?.events[2]?.title).toBe("渡口提前");
		expect(body.bound?.events[2]?.state).toBe("future");

		const invalid = await post(
			origin,
			`/api/stories/${storyId}/canon/events/${future.id}/edit`,
			{ field: "participants", value: [] },
		);
		expect(invalid.status).toBe(400);

		const missing = await post(
			origin,
			`/api/stories/${storyId}/canon/events/999999/edit`,
			{ field: "title", value: "不存在" },
		);
		expect(missing.status).toBe(400);
	});

	it("没有绑定原著时返回空分页", async () => {
		const { origin } = await startTestServer();
		const created = await post(origin, "/api/stories", { title: "普通故事" });
		expect(created.status).toBe(201);
		const story = (await created.json()) as { readonly id: string };
		const page = await readPage(origin, story.id);
		expect(page).toEqual({ bound: null });
	});
});
