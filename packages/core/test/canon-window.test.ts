import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	CANON_PACKAGE_FORMAT,
	CANON_PACKAGE_VERSION,
	type CanonPackage,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	advanceCanonCursor,
	assembleContext,
	createDefaultContextTemplate,
	createSceneLogHandler,
	createStandardChatSlots,
	importCanonPackage,
	resolveCanonCursor,
	startCanonFromHere,
	startCanonStory,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const SECRET = "守门人是反派密探";
const FUTURE_ENTITY = "少女";

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
			title: "合成长篇",
			filename: "long.txt",
			encoding: "utf-8",
			charCount: 1_000,
			chapterCount: 5,
			hasText: true,
		},
		chapters: [
			chapter(1, ["山门外的雨下了整夜。守门人放少年进山。"]),
			chapter(2, ["少年从石缝里取出一把旧剑。"]),
			chapter(3, ["山门前站着一个少女。"]),
			chapter(4, ["渡口的雾很重。"]),
			chapter(5, ["守门人摘下斗笠，说自己一直在等这一天。"]),
		],
		entities: [
			{
				name: "少年",
				aliases: [],
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
				aliases: ["老门房"],
				kind: "人物",
				lead: "看守山门的老者。",
				base: "第1章 守门人在雨夜放少年进山。\n第5章 守门人是反派密探。",
				baseEntries: [
					{ chapterOrdinal: 1, text: "守门人在雨夜放少年进山。" },
					{ chapterOrdinal: 5, text: SECRET },
				],
				firstChapterOrdinal: 1,
				lastChapterOrdinal: 5,
			},
			{
				name: FUTURE_ENTITY,
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
				participants: [FUTURE_ENTITY],
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
			{
				chapterOrdinal: 5,
				seq: 1,
				title: "真相",
				summary: "守门人揭开自己的身份。",
				digest: "斗笠落地。老者笑了。",
				participants: ["守门人", "少年"],
				location: "山门",
				timeText: null,
				paragraphStart: 1,
				paragraphEnd: 1,
				isInterlude: false,
				timelineOrder: 5,
				isTurningPoint: true,
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
				chapterOrdinal: 1,
				ordinal: 2,
				character: "少年",
				kind: "thought",
				text: "雨真大。",
			},
			{
				chapterOrdinal: 5,
				ordinal: 1,
				character: "守门人",
				kind: "speech",
				text: "我一直在等这一天。",
			},
		],
		facts: [
			{
				chapterOrdinal: 5,
				entityName: "守门人",
				aliases: [],
				entityKind: "人物",
				fact: SECRET,
			},
		],
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
	options: {
		readonly name?: string;
		readonly kind?: "canon" | "custom";
		readonly startEventTitle?: string;
	} = {},
): { storyId: string; headId: string } {
	const storyId = store.createStory({ title: "游玩的同人" }).id;
	const events = store.listCanonEvents(bookId);
	const startEvent =
		options.startEventTitle === undefined
			? events[0]
			: events.find((event) => event.title === options.startEventTitle);
	if (startEvent === undefined) throw new Error("合成原著缺少开局事件");
	const result = startCanonStory(store, {
		storyId,
		bookId,
		startEventId: startEvent.id,
		identity: {
			kind: options.kind ?? "custom",
			name: options.name ?? "旅人",
			persona: "从山下来的旅人。",
		},
	});
	return { storyId, headId: result.openingNode.id };
}

function appendUser(
	store: StoryStore,
	storyId: string,
	parentId: string,
	raw = "我站在石阶上，没有出声。",
): string {
	return store.appendNode({ storyId, parentId, role: "user", raw }).id;
}

async function assemble(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	options: { readonly push?: "advance" | null } = {},
) {
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
		directorPush: options.push ?? null,
	});
}

function joined(assembled: Awaited<ReturnType<typeof assemble>>): string {
	return assembled.messages.map((message) => message.content).join("\n");
}

function llmResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: {
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cachedTokens: null,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

function createFakeClient(replies: readonly string[]): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const client: LlmClient = {
		async complete(request) {
			requests.push(request);
			const reply = replies[requests.length - 1];
			if (reply === undefined) throw new Error("假客户端没有更多回复");
			return llmResult(reply);
		},
	};
	return { client, requests };
}

function jobFor(storyId: string, nodeId: string): BackgroundJob {
	const now = new Date().toISOString();
	return {
		id: 1,
		storyId,
		nodeId,
		kind: "scene_log",
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: now,
		startedAt: now,
		finishedAt: null,
	};
}

function sceneLogReply(canonCompleted?: boolean): string {
	return JSON.stringify({
		beat: "试探",
		states: [],
		present: ["少年", "守门人"],
		sceneEnds: false,
		...(canonCompleted === undefined ? {} : { canonCompleted }),
	});
}

describe("原著窗口与游标", () => {
	it("每轮给当前一件，推进时给接下来三件，Trace 带原著来源", async () => {
		const { store, bookId } = openBook();
		const { storyId, headId } = start(store, bookId);
		const user = appendUser(store, storyId, headId);

		const regular = await assemble(store, storyId, user);
		const regularText = joined(regular);
		expect(regularText).toContain("【原著窗口】");
		expect(regularText).toContain("雨夜入门");
		expect(regularText).not.toContain("旧剑出土");
		const regularEntry = regular.trace.entries.find(
			(entry) => entry.slot === "director",
		);
		expect(regularEntry?.status).toBe("included");
		expect(regularEntry?.items?.[0]?.source).toMatchObject({
			kind: "canon",
			chapterOrdinal: 1,
		});

		const pushUser = appendUser(store, storyId, headId, "继续");
		const pushed = await assemble(store, storyId, pushUser, {
			push: "advance",
		});
		const pushedText = joined(pushed);
		expect(pushedText).toContain("旧剑出土");
		expect(pushedText).toContain("少女现身");
		expect(pushedText).toContain("渡口");
		const pushedEntry = pushed.trace.entries.find(
			(entry) => entry.slot === "director",
		);
		expect(pushedEntry?.items).toHaveLength(4);
	});

	it("偏离后游标不前进、不强拉回原著", async () => {
		const { store, bookId } = openBook();
		const { storyId, headId } = start(store, bookId);
		const user = appendUser(store, storyId, headId, "我不进山门，转身下山。");
		const assistant = store.appendNode({
			storyId,
			parentId: user,
			role: "assistant",
			raw: "少年没有进山门，沿着石阶往山下走。",
		});
		const { client, requests } = createFakeClient([
			sceneLogReply(false),
			sceneLogReply(true),
		]);
		const handler = createSceneLogHandler();

		await handler({
			store,
			client,
			job: jobFor(storyId, assistant.id),
		});
		expect(requests[0]?.messages[0]?.content).toContain("canonCompleted");
		expect(requests[0]?.messages[1]?.content).toContain("雨夜入门");
		expect(requests[0]?.messages[1]?.content).not.toContain("时刻格式");
		const held = store.getCanonCursor(storyId, assistant.id);
		expect(held?.eventOrdinal).toBe(1);

		const second = appendUser(store, storyId, assistant.id, "继续");
		const next = store.appendNode({
			storyId,
			parentId: second,
			role: "assistant",
			raw: "少年走进山门，雨声落在身后。",
		});
		await handler({ store, client, job: jobFor(storyId, next.id) });
		expect(store.getCanonCursor(storyId, next.id)?.eventOrdinal).toBe(2);
	});

	it("删除楼层或切换分支后回退到父分支的游标", () => {
		const { store, bookId } = openBook();
		const { storyId, headId } = start(store, bookId);
		const events = store.listCanonEvents(bookId);
		const third = events.find((event) => event.title === "少女现身");
		if (third === undefined) throw new Error("缺少第三件事件");
		const branchUser = appendUser(store, storyId, headId);
		const branchA = store.appendNode({
			storyId,
			parentId: branchUser,
			role: "assistant",
			raw: "分支甲。",
		});
		const branchB = store.appendNode({
			storyId,
			parentId: branchUser,
			role: "assistant",
			raw: "分支乙。",
		});
		startCanonFromHere(store, storyId, third.id, branchA.id);
		expect(resolveCanonCursor(store, storyId, branchA.id)?.event.id).toBe(
			third.id,
		);
		store.setHead(storyId, branchB.id);
		expect(resolveCanonCursor(store, storyId, branchB.id)?.eventOrdinal).toBe(
			1,
		);
		store.setHead(storyId, headId);
		expect(resolveCanonCursor(store, storyId, headId)?.eventOrdinal).toBe(1);
	});

	it("死人事件被标注、话术被剔除，缺席参与者标注无法按原著发生", async () => {
		const { store, bookId } = openBook();
		const { storyId, headId } = start(store, bookId);
		store.appendStateDiff({
			storyId,
			nodeId: headId,
			path: ["character", "守门人", "status"],
			op: "set",
			value: "已死",
			source: "settler",
		});
		const user = appendUser(store, storyId, headId);
		const deadText = joined(await assemble(store, storyId, user));
		expect(deadText).toContain("守门人 已死，本局不再出场，无法按原著发生");
		expect(deadText).not.toContain("进来吧。");

		const { store: absentStore, bookId: absentBook } = openBook();
		const absentStory = start(absentStore, absentBook);
		const events = absentStore.listCanonEvents(absentBook);
		const second = events.find((event) => event.title === "旧剑出土");
		if (second === undefined) throw new Error("缺少第二件事件");
		startCanonFromHere(absentStore, absentStory.storyId, second.id);
		absentStore.appendStateDiff({
			storyId: absentStory.storyId,
			nodeId: absentStory.headId,
			path: ["character", "少年", "location"],
			op: "set",
			value: "山门",
			source: "settler",
		});
		const absentHead = absentStore.getHead(absentStory.storyId);
		if (absentHead === null) throw new Error("缺席测试缺少楼层");
		const absentText = joined(
			await assemble(absentStore, absentStory.storyId, absentHead.id),
		);
		expect(absentText).toContain("少年 不在场，无法按原著发生");
	});

	it("后期秘密在游标之前不出现在任何上下文，打开全书开关或游标到达后才可见", async () => {
		const { store, bookId } = openBook();
		const { storyId, headId } = start(store, bookId);
		const user = appendUser(store, storyId, headId);
		const early = joined(await assemble(store, storyId, user));
		expect(early).not.toContain(SECRET);
		expect(early).not.toContain(FUTURE_ENTITY);

		store.updateStoryCanonSettings(storyId, { allowFullBookSpoilers: true });
		const opened = joined(await assemble(store, storyId, user));
		expect(opened).toContain(SECRET);

		const { store: slicedStore, bookId: slicedBook } = openBook();
		const sliced = start(slicedStore, slicedBook);
		const events = slicedStore.listCanonEvents(slicedBook);
		const last = events.find((event) => event.title === "真相");
		if (last === undefined) throw new Error("缺少最后一章的事件");
		startCanonFromHere(slicedStore, sliced.storyId, last.id);
		const slicedHead = slicedStore.getHead(sliced.storyId);
		if (slicedHead === null) throw new Error("切片测试缺少楼层");
		const late = joined(
			await assemble(slicedStore, sliced.storyId, slicedHead.id),
		);
		expect(late).toContain(SECRET);
	});

	it("扮演原著人物时其页面进 persona、不进 NPC 页，知情边界按开局章节初始化", async () => {
		const { store, bookId } = openBook();
		const { storyId, headId } = start(store, bookId, {
			kind: "canon",
			name: "少年",
		});
		const user = appendUser(store, storyId, headId);
		const early = await assemble(store, storyId, user);
		const personaEntries = early.segments.filter(
			(segment) => segment.slot === "persona",
		);
		const personaText = personaEntries
			.flatMap((segment) => segment.messages)
			.map((message) => message.content)
			.join("\n");
		expect(personaText).toContain("你扮演少年。");
		expect(personaText).toContain("少年是山门弟子。");
		expect(personaText).not.toContain("旧剑");
		const pagesText = early.segments
			.filter((segment) => segment.slot === "pages")
			.flatMap((segment) => segment.messages)
			.map((message) => message.content)
			.join("\n");
		expect(pagesText).not.toContain("少年：");

		const events = store.listCanonEvents(bookId);
		const second = events.find((event) => event.title === "旧剑出土");
		if (second === undefined) throw new Error("缺少第二件事件");
		startCanonFromHere(store, storyId, second.id);
		const nextHead = store.getHead(storyId);
		if (nextHead === null) throw new Error("缺少楼层");
		const later = await assemble(store, storyId, nextHead.id);
		const laterPersona = later.segments
			.filter((segment) => segment.slot === "persona")
			.flatMap((segment) => segment.messages)
			.map((message) => message.content)
			.join("\n");
		expect(laterPersona).toContain("少年得到一把旧剑。");
		expect(laterPersona).not.toContain(SECRET);
	});

	it("「从这里开始」先停在该事件，待推进件数让窗口多给几件", async () => {
		const { store, bookId } = openBook();
		const { storyId, headId } = start(store, bookId);
		const events = store.listCanonEvents(bookId);
		const third = events.find((event) => event.title === "少女现身");
		if (third === undefined) throw new Error("缺少第三件事件");
		startCanonFromHere(store, storyId, third.id);
		const user = appendUser(store, storyId, headId, "我站在雨里等了一会儿。");
		const window = joined(await assemble(store, storyId, user));
		expect(window).toContain("少女现身");
		expect(window).not.toContain("渡口");

		store.updateStoryCanonSettings(storyId, { pendingAdvance: 2 });
		const ahead = joined(await assemble(store, storyId, user));
		expect(ahead).toContain("渡口");
		expect(ahead).toContain("真相");

		const assistant = store.appendNode({
			storyId,
			parentId: user,
			role: "assistant",
			raw: "少女在山门前抬头。",
		});
		const { client } = createFakeClient([sceneLogReply(true)]);
		await createSceneLogHandler()({
			store,
			client,
			job: jobFor(storyId, assistant.id),
		});
		// 「从这里开始」的第一楼先消费待演出游标，不直接跳到下一件。
		expect(store.getCanonCursor(storyId, assistant.id)?.eventId).toBe(third.id);
		expect(store.getCanonCursor(storyId, assistant.id)?.fromHere).toBe(false);

		const secondUser = appendUser(store, storyId, assistant.id, "继续");
		const secondAssistant = store.appendNode({
			storyId,
			parentId: secondUser,
			role: "assistant",
			raw: "少女转身走进山门。",
		});
		const { client: nextClient } = createFakeClient([sceneLogReply(true)]);
		await createSceneLogHandler()({
			store,
			client: nextClient,
			job: jobFor(storyId, secondAssistant.id),
		});
		const secondCursor = store.getCanonCursor(storyId, secondAssistant.id);
		expect(secondCursor?.eventOrdinal).toBe(4);
		const advanced = advanceCanonCursor(store, storyId, secondAssistant.id);
		expect(advanced?.eventOrdinal).toBe(5);
	});
});
