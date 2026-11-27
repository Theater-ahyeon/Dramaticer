import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	CANON_PACKAGE_FORMAT,
	CANON_PACKAGE_VERSION,
	type CanonPackage,
	StoryStore,
	importCanonPackage,
	readDirectionView,
	readNotebookPages,
	startCanonStory,
} from "../src/index.js";

function openStore(): StoryStore {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-canon-start-"));
	const store = StoryStore.open(join(dir, "story.db"));
	onTestFinished(() => {
		store.close();
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return store;
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
				base: "第1章 少年是山门弟子。\n第2章 少年得到一把旧剑。",
				baseEntries: [
					{ chapterOrdinal: 1, text: "少年是山门弟子。" },
					{ chapterOrdinal: 2, text: "少年得到一把旧剑。" },
				],
				firstChapterOrdinal: 1,
				lastChapterOrdinal: 2,
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
			{
				name: "少女",
				aliases: [],
				kind: "人物",
				lead: "第三章才出现的少女。",
				base: "第3章 少女在山门前等少年。",
				baseEntries: [{ chapterOrdinal: 3, text: "少女在山门前等少年。" }],
				firstChapterOrdinal: 3,
				lastChapterOrdinal: 3,
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
			{
				chapterOrdinal: 3,
				seq: 1,
				title: "少女现身",
				summary: "少女在山门前等少年。",
				digest: "山门有人等。少女抬头。少年停步。",
				participants: ["少女"],
				location: "山门",
				timeText: null,
				paragraphStart: 1,
				paragraphEnd: 1,
				isInterlude: false,
				timelineOrder: 3,
				isTurningPoint: false,
			},
		],
		voices: [],
		facts: [],
	};
}

describe("从原著开局", () => {
	it("扮演原著人物时不进 NPC 名册，人物页与首楼按开局章节切片", () => {
		const store = openStore();
		const bookId = importCanonPackage(store, samplePackage()).book.id;
		const story = store.createStory({ title: "临时标题" });
		const result = startCanonStory(store, {
			storyId: story.id,
			bookId,
			identity: { kind: "canon", name: "少年" },
		});

		const head = store.getHead(story.id);
		expect(head?.role).toBe("assistant");
		expect(head?.id).toBe(result.openingNode.id);
		expect(head?.raw).toContain("雨夜入门");
		expect(head?.raw).toContain("守门人");
		expect(head?.raw).toContain("你扮演少年");

		const names = store.listEntities(story.id).map((entity) => entity.name);
		expect(names).toContain("守门人");
		expect(names).not.toContain("少年");
		expect(names).not.toContain("旧剑");
		expect(names).not.toContain("少女");

		const binding = store.getStoryCanonBinding(story.id);
		expect(binding?.identityKind).toBe("canon");
		expect(binding?.playerEntityName).toBe("少年");
		expect(binding?.startChapterOrdinal).toBe(1);
		expect(binding?.allowFullBookSpoilers).toBe(false);
		expect(binding?.playerPage?.base).toContain("山门弟子");
		expect(binding?.playerPage?.base).not.toContain("旧剑");

		const persona = store.getStorySettings(story.id).persona ?? "";
		expect(persona).toContain("你扮演少年");
		expect(persona).toContain("山门弟子");
		expect(persona).not.toContain("旧剑");

		const pages = readNotebookPages(store, story.id, head?.id ?? null);
		expect(pages.map((page) => page.name)).toEqual(["守门人"]);
		expect(pages[0]?.base).not.toContain("旧剑");

		const cursor = store.getCanonCursor(story.id, head?.id ?? "");
		expect(cursor?.eventId).toBe(result.event.id);
		expect(cursor?.eventOrdinal).toBe(1);
		expect(cursor?.chapterOrdinal).toBe(1);

		const view = readDirectionView(store, story.id);
		expect(
			view.wants
				.filter((item) => item.text.length > 0)
				.map((item) => item.text),
		).toEqual(["雨夜入门", "旧剑出土", "少女现身"]);
		expect(store.getStory(story.id)?.title).toBe("临时标题");
	});

	it("自创人物写进 persona，全部已出场原著人物正常入库", () => {
		const store = openStore();
		const bookId = importCanonPackage(store, samplePackage()).book.id;
		const story = store.createStory({ title: "自创开局" });
		const events = store.listCanonEvents(bookId);
		const second = events.find((event) => event.title === "旧剑出土");
		if (second === undefined) throw new Error("合成原著缺少第二件事件");
		const result = startCanonStory(store, {
			storyId: story.id,
			bookId,
			startEventId: second.id,
			identity: { kind: "custom", name: "旅人", persona: "从山下来的旅人。" },
		});

		const names = store.listEntities(story.id).map((entity) => entity.name);
		expect(names).toEqual(expect.arrayContaining(["少年", "守门人", "旧剑"]));
		expect(names).not.toContain("少女");
		const persona = store.getStorySettings(story.id).persona ?? "";
		expect(persona).toContain("你扮演旅人");
		expect(persona).toContain("从山下来的旅人。");
		const binding = store.getStoryCanonBinding(story.id);
		expect(binding?.identityKind).toBe("custom");
		expect(binding?.playerEntityName).toBe("旅人");
		expect(binding?.playerPage).toBeNull();
		const head = store.getHead(story.id);
		expect(head?.raw).toContain("旧剑出土");
		const cursor = store.getCanonCursor(story.id, head?.id ?? "");
		expect(cursor?.eventOrdinal).toBe(2);
		expect(cursor?.chapterOrdinal).toBe(2);
		const pages = readNotebookPages(store, story.id, head?.id ?? null);
		expect(pages.length).toBe(3);
		const youth = pages.find((page) => page.name === "少年");
		expect(youth?.base).toContain("旧剑");
		expect(youth?.base).not.toContain("少女");
		expect(result.notebookPages).toBe(3);
	});

	it("开局前没出场的人物、重复绑定与未汇编的原著都会失败", () => {
		const store = openStore();
		const bookId = importCanonPackage(store, samplePackage()).book.id;
		const story = store.createStory({ title: "错误开局" });
		expect(() =>
			startCanonStory(store, {
				storyId: story.id,
				bookId,
				identity: { kind: "canon", name: "少女" },
			}),
		).toThrow("还没有出场");
		expect(() =>
			startCanonStory(store, {
				storyId: story.id,
				bookId,
				identity: { kind: "custom", name: "旅人" },
			}),
		).not.toThrow();
		expect(() =>
			startCanonStory(store, {
				storyId: story.id,
				bookId,
				identity: { kind: "custom", name: "旅人" },
			}),
		).toThrow("已经绑定");

		const draft = store.createCanonBook({
			title: "还没汇编",
			encoding: "utf-8",
			chapters: [
				{
					volumeTitle: null,
					title: "第一章",
					kind: "chapter",
					paragraphs: ["只有一段。"],
				},
			],
		});
		expect(() =>
			startCanonStory(store, {
				storyId: store.createStory({ title: "未编排" }).id,
				bookId: draft.book.id,
				identity: { kind: "custom", name: "旅人" },
			}),
		).toThrow("全书汇编");
	});
});
