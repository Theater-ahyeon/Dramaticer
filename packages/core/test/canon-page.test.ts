import { describe, expect, it } from "vitest";
import {
	CANON_PACKAGE_FORMAT,
	CANON_PACKAGE_VERSION,
	type CanonPackage,
	type StoryStore,
	assembleContext,
	buildCanonWindow,
	createDefaultContextTemplate,
	createStandardChatSlots,
	editCanonEvent,
	importCanonPackage,
	listCanonEventVersions,
	listEffectiveCanonTimeline,
	readEffectiveCanonEvent,
	rollbackCanonEvent,
	setCanonWindowMode,
	startCanonStory,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIRST_TITLE = "雨夜入门";

function chapter(
	ordinal: number,
	paragraphs: readonly string[],
): CanonPackage["chapters"][number] {
	return {
		ordinal,
		volumeTitle: null,
		title: `第${ordinal}章`,
		kind: "chapter",
		charCount: paragraphs.join("").length,
		paragraphCount: paragraphs.length,
		paragraphs,
	};
}

function samplePackage(): CanonPackage {
	return {
		format: CANON_PACKAGE_FORMAT,
		version: CANON_PACKAGE_VERSION,
		exportedAt: "2026-11-27T00:00:00.000Z",
		book: {
			title: "玩家改原著的合成长篇",
			filename: "long.txt",
			encoding: "utf-8",
			charCount: 200,
			chapterCount: 4,
			hasText: true,
		},
		chapters: [
			chapter(1, ["山门外的雨下了整夜。守门人放少年进山。"]),
			chapter(2, ["少年从石缝里取出一把旧剑。"]),
			chapter(3, ["山门前站着一个少女。"]),
			chapter(4, ["渡口的雾很重。"]),
		],
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
		],
		events: [
			{
				chapterOrdinal: 1,
				seq: 1,
				title: FIRST_TITLE,
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
				digest: "石缝里有光。旧剑出土。",
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
				digest: "山门有人等。少女抬头。",
				participants: ["少年"],
				location: "山门",
				timeText: null,
				paragraphStart: 1,
				paragraphEnd: 1,
				isInterlude: false,
				timelineOrder: 3,
				isTurningPoint: false,
			},
			{
				chapterOrdinal: 4,
				seq: 1,
				title: "渡口",
				summary: "少年在渡口等船。",
				digest: "雾很重。船还没来。",
				participants: ["少年"],
				location: "渡口",
				timeText: null,
				paragraphStart: 1,
				paragraphEnd: 1,
				isInterlude: false,
				timelineOrder: 4,
				isTurningPoint: false,
			},
		],
		voices: [
			{
				chapterOrdinal: 1,
				ordinal: 1,
				character: "守门人",
				kind: "speech",
				text: "进来吧。",
			},
			{
				chapterOrdinal: 2,
				ordinal: 1,
				character: "少年",
				kind: "thought",
				text: "这把剑是我的。",
			},
		],
		facts: [],
	};
}

function openBook(): { store: StoryStore; bookId: string } {
	const { store } = openTempStore();
	const bookId = importCanonPackage(store, samplePackage()).book.id;
	return { store, bookId };
}

function start(
	store: StoryStore,
	bookId: string,
): { storyId: string; headId: string; events: readonly { id: number }[] } {
	const storyId = store.createStory({ title: "改原著的同人" }).id;
	const events = store.listCanonEvents(bookId);
	const first = events[0];
	if (first === undefined) throw new Error("合成原著缺少事件");
	const result = startCanonStory(store, {
		storyId,
		bookId,
		startEventId: first.id,
		identity: { kind: "custom", name: "旅人", persona: "从山下来的旅人。" },
	});
	return { storyId, headId: result.openingNode.id, events };
}

function appendUser(
	store: StoryStore,
	storyId: string,
	parentId: string,
	raw = "我站在石阶上，没有出声。",
): string {
	return store.appendNode({ storyId, parentId, role: "user", raw }).id;
}

async function assemble(store: StoryStore, storyId: string, nodeId: string) {
	const settings = store.getStorySettings(storyId);
	const slots = await createStandardChatSlots({
		store,
		characterPrompt: null,
		persona: settings.persona,
	});
	return await assembleContext({
		template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
		budgetTokens: 20_000,
		storyId,
		nodeId,
		providers: slots.providers,
		directorPush: null,
	});
}

describe("原著页：按格编辑与撤销", () => {
	it("改标题、概要、缩写、话术、原文后立刻进入窗口与上下文", async () => {
		const { store, bookId } = openBook();
		const { storyId, headId, events } = start(store, bookId);
		const first = events[0];
		if (first === undefined) throw new Error("缺少第一件事件");
		const user = appendUser(store, storyId, headId);

		editCanonEvent(store, storyId, {
			eventId: first.id,
			field: "title",
			value: "雨夜入门·改",
			nodeId: user,
		});
		editCanonEvent(store, storyId, {
			eventId: first.id,
			field: "summary",
			value: "守门人放少年进山，还多问了一句。",
			nodeId: user,
		});
		editCanonEvent(store, storyId, {
			eventId: first.id,
			field: "digest",
			value: "雨下了一夜。守门人开着门等。",
			nodeId: user,
		});
		editCanonEvent(store, storyId, {
			eventId: first.id,
			field: "voices",
			value: [
				{ character: "守门人", kind: "speech", text: "进来吧，孩子。" },
				{ character: "少年", kind: "thought", text: "他身上有旧剑的味道。" },
			],
			nodeId: user,
		});
		editCanonEvent(store, storyId, {
			eventId: first.id,
			field: "passage",
			value: ["改过的原文：门没有关。"],
			nodeId: user,
		});

		const effective = readEffectiveCanonEvent(store, storyId, user, first);
		expect(effective.event.title).toBe("雨夜入门·改");
		expect(effective.event.summary).toContain("多问了一句");
		expect(effective.editedFields.sort()).toEqual(
			["digest", "passage", "summary", "title", "voices"].sort(),
		);
		expect(effective.voices).toHaveLength(2);

		const timeline = listEffectiveCanonTimeline(store, storyId, user);
		expect(timeline.map((entry) => entry.state)).toEqual([
			"current",
			"future",
			"future",
			"future",
		]);
		expect(timeline[0]?.event.title).toBe("雨夜入门·改");

		setCanonWindowMode(store, storyId, "full_text");
		const window = buildCanonWindow(store, storyId, user, { upcoming: 1 });
		expect(window).not.toBeNull();
		expect(window?.current.event.title).toBe("雨夜入门·改");
		expect(window?.current.text).toContain("多问了一句");
		expect(window?.current.text).toContain("进来吧，孩子。");
		expect(window?.current.text).toContain("改过的原文：门没有关。");
		expect(window?.items[0]?.label).toBe("原著 · 雨夜入门·改");

		const assembled = await assemble(store, storyId, user);
		const joined = assembled.messages
			.map((message) => message.content)
			.join("\n");
		expect(joined).toContain("雨夜入门·改");
		expect(joined).toContain("多问了一句");
		expect(joined).toContain("进来吧，孩子。");
		expect(joined).toContain("改过的原文：门没有关。");
		const slot = assembled.trace.entries.find(
			(entry) => entry.slot === "director",
		);
		expect(slot?.items?.[0]?.label).toBe("原著 · 雨夜入门·改");

		// 撤销概要：追加一条回滚记录，旧行不动，窗口立刻恢复原文。
		const before = store.listCanonEventEdits(storyId, first.id);
		rollbackCanonEvent(store, storyId, { eventId: first.id, field: "summary" });
		const after = store.listCanonEventEdits(storyId, first.id);
		expect(after).toHaveLength(before.length + 1);
		const titleEdit = after.find(
			(edit) => edit.field === "title" && edit.source === "player",
		);
		expect(titleEdit?.value).toBe("雨夜入门·改");
		expect(after.at(-1)?.source).toBe("rollback");

		const restored = buildCanonWindow(store, storyId, user, { upcoming: 1 });
		expect(restored?.current.text).toContain("守门人在雨夜放少年进山。");
		expect(restored?.current.text).not.toContain("多问了一句");
		expect(restored?.current.text).toContain("改过的原文：门没有关。");
	});

	it("版本按格保存，回到指定版本生成新记录", () => {
		const { store, bookId } = openBook();
		const { storyId, headId, events } = start(store, bookId);
		const first = events[0];
		if (first === undefined) throw new Error("缺少第一件事件");
		const user = appendUser(store, storyId, headId);

		editCanonEvent(store, storyId, {
			eventId: first.id,
			field: "digest",
			value: "缩写第一版",
			nodeId: user,
		});
		editCanonEvent(store, storyId, {
			eventId: first.id,
			field: "digest",
			value: "缩写第二版",
			nodeId: user,
		});
		const versions = listCanonEventVersions(
			store,
			storyId,
			user,
			first.id,
			"digest",
		);
		expect(versions.map((version) => version.value)).toEqual([
			"缩写第二版",
			"缩写第一版",
		]);
		const target = versions[1];
		if (target === undefined) throw new Error("缺少第一版缩写");
		rollbackCanonEvent(store, storyId, {
			eventId: first.id,
			versionId: target.id,
			nodeId: user,
		});
		const effective = readEffectiveCanonEvent(store, storyId, user, first);
		expect(effective.event.digest).toBe("缩写第一版");
		const newest = store.listCanonEventEdits(storyId, first.id).at(-1);
		expect(newest?.source).toBe("rollback");
		expect(newest?.note).toBe(`回到第 ${target.id} 版`);
	});

	it("按楼层路径分支隔离，另一分支看到原著原样", () => {
		const { store, bookId } = openBook();
		const { storyId, headId, events } = start(store, bookId);
		const first = events[0];
		if (first === undefined) throw new Error("缺少第一件事件");
		const branchA = appendUser(store, storyId, headId, "走左路。");
		const branchB = appendUser(store, storyId, headId, "走右路。");

		editCanonEvent(store, storyId, {
			eventId: first.id,
			field: "title",
			value: "只属于左路",
			nodeId: branchA,
		});
		editCanonEvent(store, storyId, {
			eventId: first.id,
			field: "voices",
			value: [{ character: "守门人", kind: "speech", text: "左路的人。" }],
			nodeId: branchA,
		});

		expect(
			readEffectiveCanonEvent(store, storyId, branchA, first).event.title,
		).toBe("只属于左路");
		expect(
			listCanonEventVersions(store, storyId, branchB, first.id),
		).toHaveLength(0);
		const other = readEffectiveCanonEvent(store, storyId, branchB, first);
		expect(other.event.title).toBe(FIRST_TITLE);
		expect(other.voices[0]?.text).toBe("进来吧。");
	});
});
