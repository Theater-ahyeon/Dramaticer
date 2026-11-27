import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	CANON_PACKAGE_FORMAT,
	CANON_PACKAGE_VERSION,
	type CanonPackage,
	createLoreSlotProvider,
} from "@dramaticer/core";
import type {
	CanonCompiledView,
	ImportCanonPackageResult,
	StartCanonStoryResult,
	StoryCanonView,
	StoryEntitiesView,
	StoryView,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-canon-start-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

async function startTestServer(): Promise<RunningServer> {
	const dir = tempDir();
	const webRoot = join(dir, "web");
	mkdirSync(webRoot, { recursive: true });
	writeFileSync(
		join(webRoot, "index.html"),
		"<!doctype html><title>应用</title>",
	);
	const running = await startServer({
		dbPath: join(dir, "story.db"),
		webRoot,
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => {},
	});
	onTestFinished(() => running.close());
	return running;
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

async function get<T>(origin: string, path: string): Promise<T> {
	const response = await fetch(`${origin}${path}`);
	expect(response.status).toBe(200);
	return (await response.json()) as T;
}

function samplePackage(): CanonPackage {
	return {
		format: CANON_PACKAGE_FORMAT,
		version: CANON_PACKAGE_VERSION,
		exportedAt: "2026-11-27T00:00:00.000Z",
		book: {
			title: "合成原著",
			filename: "sample.txt",
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
		})),
		entities: [
			{
				name: "少年",
				aliases: ["小年"],
				kind: "人物",
				lead: "山门里的少年弟子。",
				base: "第1章 少年是山门弟子。",
				baseEntries: [{ chapterOrdinal: 1, text: "少年是山门弟子。" }],
				firstChapterOrdinal: 1,
				lastChapterOrdinal: 1,
			},
			{
				name: "守门人",
				aliases: [],
				kind: "人物",
				lead: "看守山门的老者。",
				base: "第1章 守门人在雨夜放少年进山。",
				baseEntries: [{ chapterOrdinal: 1, text: "守门人在雨夜放少年进山。" }],
				firstChapterOrdinal: 1,
				lastChapterOrdinal: 1,
			},
			{
				name: "旧剑",
				aliases: [],
				kind: "物品",
				lead: "藏在石缝里的旧剑。",
				base: "第2章 旧剑从石缝里被取出。",
				baseEntries: [{ chapterOrdinal: 2, text: "旧剑从石缝里被取出。" }],
				firstChapterOrdinal: 2,
				lastChapterOrdinal: 2,
			},
		],
		events: [
			{
				chapterOrdinal: 1,
				seq: 1,
				title: "雨夜入门",
				summary: "守门人在雨夜放少年进山。",
				digest: "雨下了一夜。少年叩门。守门人开了门。",
				participants: ["少年", "守门人"],
				location: "山门",
				timeText: "雨夜",
				paragraphStart: 1,
				paragraphEnd: 1,
				isInterlude: false,
				timelineOrder: 1,
				isTurningPoint: false,
			},
			{
				chapterOrdinal: 2,
				seq: 1,
				title: "旧剑出土",
				summary: "少年从石缝里取出一把旧剑。",
				digest: "石缝里有光。少年伸手。旧剑出土。",
				participants: ["少年"],
				location: "后山",
				timeText: null,
				paragraphStart: 1,
				paragraphEnd: 1,
				isInterlude: false,
				timelineOrder: 2,
				isTurningPoint: true,
			},
		],
		voices: [],
		facts: [],
	};
}

const CARD = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "叙述者",
		description: "只提供文风与规则的叙述者。",
		first_mes: "卡的开场白不应该替换原著开局。",
		character_book: {
			name: "文风",
			entries: [
				{
					id: 1,
					keys: ["文风"],
					comment: "文风守则",
					content: "文风：句子短，第二人称，禁止出现括号。",
					enabled: true,
					constant: true,
				},
			],
		},
	},
};

describe("从原著开局接口", () => {
	it("扮演原著人物并叠加角色卡：卡的开场白不出现，写作条目进上下文", async () => {
		const running = await startTestServer();
		const origin = running.origin;
		const importedResponse = await post(origin, "/api/canon/packages/import", {
			package: samplePackage(),
		});
		expect(importedResponse.status).toBe(201);
		const imported =
			(await importedResponse.json()) as ImportCanonPackageResult;
		const compiled = await get<CanonCompiledView>(
			origin,
			`/api/canon/books/${imported.book.id}/compiled`,
		);
		const first = compiled.events.find((event) => event.title === "雨夜入门");
		if (first === undefined) throw new Error("合成原著缺少开局事件");

		const startResponse = await post(origin, "/api/canon/start-story", {
			bookId: imported.book.id,
			startEventId: first.id,
			identityKind: "canon",
			playerName: "少年",
			card: { format: "json", data: JSON.stringify(CARD) },
		});
		expect(startResponse.status).toBe(201);
		const started = (await startResponse.json()) as StartCanonStoryResult;
		const storyId = started.story.id;
		expect(started.canon.identityKind).toBe("canon");
		expect(started.canon.playerEntityName).toBe("少年");
		expect(started.canon.playerPage?.base).toContain("山门弟子");
		expect(started.canon.cursor?.eventOrdinal).toBe(1);
		expect(started.cardName).toBe("叙述者");

		const head = running.store.getHead(storyId);
		expect(head?.raw).toContain("雨夜入门");
		expect(head?.raw).toContain("你扮演少年");
		expect(head?.raw).not.toContain("卡的开场白不应该替换原著开局");

		const entities = await get<StoryEntitiesView>(
			origin,
			`/api/stories/${storyId}/entities`,
		);
		const names = entities.entities.map((entity) => entity.name);
		expect(names).toContain("守门人");
		expect(names).not.toContain("少年");
		expect(names).not.toContain("叙述者");

		const lore = await get<{
			readonly entries: readonly {
				readonly name: string;
				readonly kind: string;
				readonly constant: boolean;
				readonly content: string;
			}[];
		}>(origin, `/api/stories/${storyId}/lore-copy`);
		const writing = lore.entries.find((entry) => entry.name === "文风守则");
		expect(writing?.kind).toBe("writing");
		expect(writing?.constant).toBe(true);
		expect(writing?.content).toContain("禁止出现括号");

		const provider = createLoreSlotProvider(running.store);
		const content = await provider.provide({
			slot: "lore",
			storyId,
			nodeId: head?.id ?? null,
			switches: {},
			state: null,
		});
		const injected =
			content?.messages.map((message) => message.content).join("\n") ?? "";
		expect(injected).toContain("文风：句子短");
		expect(injected).toContain("禁止出现括号");

		const canon = await get<StoryCanonView>(
			origin,
			`/api/stories/${storyId}/canon`,
		);
		expect(canon.bound?.bookTitle).toBe("合成原著");
		expect(canon.bound?.startEventTitle).toBe("雨夜入门");
		expect(canon.bound?.allowFullBookSpoilers).toBe(false);
	});

	it("自创人物写进 persona；未绑定的故事返回 bound: null", async () => {
		const running = await startTestServer();
		const origin = running.origin;
		const importedResponse = await post(origin, "/api/canon/packages/import", {
			package: samplePackage(),
		});
		const imported =
			(await importedResponse.json()) as ImportCanonPackageResult;
		const compiled = await get<CanonCompiledView>(
			origin,
			`/api/canon/books/${imported.book.id}/compiled`,
		);
		const second = compiled.events.find((event) => event.title === "旧剑出土");
		if (second === undefined) throw new Error("合成原著缺少第二件事件");

		const startResponse = await post(origin, "/api/canon/start-story", {
			title: "旅人的山门",
			bookId: imported.book.id,
			startEventId: second.id,
			identityKind: "custom",
			playerName: "旅人",
			persona: "从山下来的旅人。",
		});
		expect(startResponse.status).toBe(201);
		const started = (await startResponse.json()) as StartCanonStoryResult;
		const storyId = started.story.id;
		expect(started.story.title).toBe("旅人的山门");
		expect(started.canon.identityKind).toBe("custom");
		expect(started.canon.playerPage).toBeNull();
		expect(started.canon.cursor?.eventOrdinal).toBe(2);
		expect(running.store.getStorySettings(storyId).persona).toContain(
			"从山下来的旅人。",
		);
		const entities = await get<StoryEntitiesView>(
			origin,
			`/api/stories/${storyId}/entities`,
		);
		const names = entities.entities.map((entity) => entity.name);
		expect(names).toEqual(expect.arrayContaining(["少年", "守门人", "旧剑"]));

		const blankResponse = await post(origin, "/api/stories", {
			title: "空白",
		});
		expect(blankResponse.status).toBe(201);
		const blank = (await blankResponse.json()) as StoryView;
		const canon = await get<StoryCanonView>(
			origin,
			`/api/stories/${blank.id}/canon`,
		);
		expect(canon.bound).toBeNull();
	});

	it("叠加的卡导入失败时整步回滚，不留半截故事", async () => {
		const running = await startTestServer();
		const origin = running.origin;
		const importedResponse = await post(origin, "/api/canon/packages/import", {
			package: samplePackage(),
		});
		const imported =
			(await importedResponse.json()) as ImportCanonPackageResult;
		const before = (await get<readonly StoryView[]>(origin, "/api/stories"))
			.length;
		const broken = {
			...CARD,
			data: {
				...CARD.data,
				extensions: {
					dramaticer: {
						npcAgendas: [
							{
								npc: "不在场的人",
								goal: "试探少年",
								everyChapters: 1,
								importance: 1,
							},
						],
					},
				},
			},
		};
		const response = await post(origin, "/api/canon/start-story", {
			bookId: imported.book.id,
			identityKind: "canon",
			playerName: "少年",
			card: { format: "json", data: JSON.stringify(broken) },
		});
		expect(response.status).toBe(400);
		const after = (await get<readonly StoryView[]>(origin, "/api/stories"))
			.length;
		expect(after).toBe(before);
	});
});
