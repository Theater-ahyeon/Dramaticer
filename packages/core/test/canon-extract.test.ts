import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	type CanonBookRecord,
	type CanonChapterRecord,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	StoryStore,
	estimateCanonExtraction,
	extractCanonChapter,
	finalizeCanonExtraction,
	planCanonChunks,
	rebuildCanonEntityRoster,
	runCanonBookExtraction,
} from "../src/index.js";

function openStore(): StoryStore {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-canon-extract-"));
	const store = StoryStore.open(join(dir, "story.db"));
	onTestFinished(() => {
		store.close();
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return store;
}

function makeBook(
	store: StoryStore,
	chapters: readonly {
		readonly title: string;
		readonly paragraphs: readonly string[];
	}[],
): CanonBookRecord {
	return store.createCanonBook({
		title: "合成原著",
		encoding: "utf-8",
		chapters: chapters.map((chapter) => ({
			volumeTitle: null,
			title: chapter.title,
			kind: "chapter",
			paragraphs: chapter.paragraphs,
		})),
	}).book;
}

function chapterAt(
	store: StoryStore,
	bookId: string,
	ordinal: number,
): CanonChapterRecord {
	const chapter = store
		.listCanonChapterRecords(bookId)
		.find((item) => item.ordinal === ordinal);
	if (chapter === undefined) throw new Error(`没有第 ${ordinal} 章`);
	return chapter;
}

function result(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-background",
		channel: "fake",
		usage: {
			promptTokens: 100,
			completionTokens: 50,
			totalTokens: 150,
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

interface ScriptedClient extends LlmClient {
	readonly requests: LlmRequest[];
}

function scriptedClient(
	handler: (request: LlmRequest, call: number) => string | Promise<string>,
): ScriptedClient {
	const requests: LlmRequest[] = [];
	return {
		requests,
		async complete(request) {
			requests.push(request);
			return result(await handler(request, requests.length));
		},
	};
}

function userText(request: LlmRequest): string {
	const message = request.messages.find((item) => item.role === "user");
	return message?.content ?? "";
}

function parseBlock(user: string): {
	readonly start: number;
	readonly end: number;
	readonly text: string;
} {
	const match = /<块 段落="(\d+)-(\d+)">\n([\s\S]*?)\n<\/块>/.exec(user);
	if (match === null) throw new Error("测试的提示词里没有块");
	return {
		start: Number(match[1]),
		end: Number(match[2]),
		text: match[3] ?? "",
	};
}

function genericResponse(user: string): string {
	const block = parseBlock(user);
	const name =
		["林言", "小言", "师父", "少年", "守门人"].find((item) =>
			block.text.includes(item),
		) ?? "林言";
	return JSON.stringify({
		events: [
			{
				title: `事件 ${block.start}`,
				summary: "一段合成事件。",
				digest: "第一句。第二句。第三句。",
				participants: [name],
				location: "山门",
				time: "当夜",
				paragraphStart: block.start,
				paragraphEnd: block.end,
				isInterlude: false,
			},
		],
		voices: [{ character: name, kind: "speech", text: "这是合成原话。" }],
		facts: [{ name, aliases: [], kind: "人物", fact: "出现在这一段。" }],
	});
}

describe("原著预估", () => {
	it("按 2 万字切块，并给出 token 与参考费率", () => {
		const longParagraph = "风".repeat(1_000);
		const paragraphs = Array.from({ length: 25 }, () => longParagraph);
		const chunks = planCanonChunks(paragraphs);
		expect(chunks).toHaveLength(2);
		expect(chunks[0]).toMatchObject({ startParagraph: 1, endParagraph: 20 });
		expect(chunks[1]).toMatchObject({ startParagraph: 21, endParagraph: 25 });
		const estimate = estimateCanonExtraction({
			bookId: "book",
			model: "background",
			chapters: [{ paragraphs }],
		});
		expect(estimate.chapterCount).toBe(1);
		expect(estimate.charCount).toBe(25_000);
		expect(estimate.chunkCount).toBe(2);
		expect(estimate.inputTokens).toBeGreaterThan(0);
		expect(estimate.outputTokens).toBe(2_400);
		expect(estimate.estimatedCost).toBeGreaterThan(0);
		expect(estimate.note).toContain("参考费率");
		expect(estimate.pricing.reference).toBe(true);
	});

	it("传入单价时按单价算，不再标参考费率", () => {
		const estimate = estimateCanonExtraction({
			bookId: "book",
			model: "background",
			chapters: [{ paragraphs: ["林言推门。"] }],
			pricing: {
				currency: "CNY",
				inputPerMillion: 1,
				outputPerMillion: 2,
				reference: false,
			},
		});
		expect(estimate.pricing.reference).toBe(false);
		expect(estimate.note).not.toContain("参考费率");
		expect(estimate.estimatedCost).toBeGreaterThan(0);
	});
});

describe("原著按章抽取", () => {
	it("假模型下全书抽取完成并落库，每条都带章节锚点", async () => {
		const store = openStore();
		const book = makeBook(store, [
			{ title: "第一章", paragraphs: ["林言推开山门。", "小言抬头看见师父。"] },
			{ title: "第二章", paragraphs: ["师父把旧信交给林言。"] },
		]);
		const client = scriptedClient((request) =>
			genericResponse(userText(request)),
		);
		const extraction = await runCanonBookExtraction({
			store,
			client,
			model: "background",
			bookId: book.id,
		});
		expect(extraction.status).toBe("done");
		expect(extraction.doneChapters).toBe(2);
		expect(extraction.totalChapters).toBe(2);
		expect(extraction.llmCalls).toBe(2);
		expect(extraction.llmTokens).toBe(300);
		expect(store.getCanonBook(book.id)?.status).toBe("extracted");
		const events = store.listCanonEvents(book.id);
		expect(events).toHaveLength(2);
		expect(events[0]?.chapterOrdinal).toBe(1);
		expect(events[1]?.chapterOrdinal).toBe(2);
		expect(store.listCanonVoices(book.id)).toHaveLength(2);
		expect(store.listCanonFacts(book.id)).toHaveLength(2);
		expect(store.listCanonEntities(book.id).map((item) => item.name)).toContain(
			"林言",
		);
	});

	it("暂停后继续，已完成章不重复调用", async () => {
		const store = openStore();
		const book = makeBook(store, [
			{ title: "第一章", paragraphs: ["林言在门口。"] },
			{ title: "第二章", paragraphs: ["林言走进院子。"] },
			{ title: "第三章", paragraphs: ["林言坐下。"] },
		]);
		const firstCalls: number[] = [];
		const pausing = scriptedClient((request) => {
			firstCalls.push(1);
			store.pauseCanonExtraction(book.id);
			return genericResponse(userText(request));
		});
		const paused = await runCanonBookExtraction({
			store,
			client: pausing,
			model: "background",
			bookId: book.id,
		});
		expect(paused.status).toBe("paused");
		expect(paused.doneChapters).toBe(1);
		expect(firstCalls).toHaveLength(1);
		expect(
			store
				.listCanonChapterExtractions(book.id)
				.filter((item) => item.status === "pending"),
		).toHaveLength(2);

		const resumedChapters: number[] = [];
		const resumed = scriptedClient((request) => {
			const ordinal = Number(
				/<本章 序号="(\d+)"/.exec(userText(request))?.[1] ?? "0",
			);
			resumedChapters.push(ordinal);
			return genericResponse(userText(request));
		});
		const finished = await runCanonBookExtraction({
			store,
			client: resumed,
			model: "background",
			bookId: book.id,
		});
		expect(finished.status).toBe("done");
		expect(finished.doneChapters).toBe(3);
		expect(resumedChapters).toEqual([2, 3]);
	});

	it("失败章单独重跑，已完成章的结果保留", async () => {
		const store = openStore();
		const book = makeBook(store, [
			{ title: "第一章", paragraphs: ["林言在门口。"] },
			{ title: "第二章", paragraphs: ["林言走进院子。"] },
			{ title: "第三章", paragraphs: ["林言坐下。"] },
		]);
		const failing = scriptedClient((request) => {
			const user = userText(request);
			if (user.includes('序号="2"')) return "这不是 JSON";
			return genericResponse(user);
		});
		const failed = await runCanonBookExtraction({
			store,
			client: failing,
			model: "background",
			bookId: book.id,
		});
		expect(failed.status).toBe("failed");
		expect(failed.doneChapters).toBe(2);
		expect(failed.failedChapters).toBe(1);
		const chapterTwo = chapterAt(store, book.id, 2);
		expect(store.getCanonChapterExtraction(chapterTwo.id)?.status).toBe(
			"failed",
		);
		expect(
			store.listCanonEvents(book.id, { chapterId: chapterTwo.id }),
		).toHaveLength(0);
		const before = store.listCanonEvents(book.id).length;

		store.markCanonExtractionRunning(book.id, "background");
		const rerun = scriptedClient((request) =>
			genericResponse(userText(request)),
		);
		const rerunResult = await extractCanonChapter({
			store,
			client: rerun,
			model: "background",
			bookId: book.id,
			chapterId: chapterTwo.id,
			mode: "full",
		});
		expect(rerunResult.calls).toBe(1);
		finalizeCanonExtraction(store, book.id);
		expect(store.getCanonExtraction(book.id)?.status).toBe("done");
		expect(
			store.listCanonEvents(book.id, { chapterId: chapterTwo.id }),
		).toHaveLength(1);
		expect(store.listCanonEvents(book.id)).toHaveLength(before + 1);
	});

	it("每章调用附当前名册，别名在抽取阶段归并", async () => {
		const store = openStore();
		const book = makeBook(store, [
			{ title: "第一章", paragraphs: ["林言推门。"] },
			{ title: "第二章", paragraphs: ["小言在灯下读信，林公子没有回头。"] },
		]);
		const prompts: string[] = [];
		const client = scriptedClient((request) => {
			const user = userText(request);
			prompts.push(user);
			if (user.includes('序号="1"')) {
				return JSON.stringify({
					events: [
						{
							title: "推门",
							summary: "林言推门。",
							digest: "第一句。第二句。第三句。",
							participants: ["林言"],
							location: null,
							time: null,
							paragraphStart: 1,
							paragraphEnd: 1,
							isInterlude: false,
						},
					],
					voices: [],
					facts: [
						{
							name: "林言",
							aliases: ["小言", "林公子"],
							kind: "人物",
							fact: "山门弟子。",
						},
					],
				});
			}
			return JSON.stringify({
				events: [
					{
						title: "读信",
						summary: "小言读信。",
						digest: "第一句。第二句。第三句。",
						participants: ["小言"],
						location: null,
						time: null,
						paragraphStart: 1,
						paragraphEnd: 1,
						isInterlude: false,
					},
				],
				voices: [
					{ character: "林公子", kind: "thought", text: "信里写了什么。" },
				],
				facts: [],
			});
		});
		await runCanonBookExtraction({
			store,
			client,
			model: "background",
			bookId: book.id,
		});
		expect(prompts[1]).toContain("林言（别名：小言、林公子）；人物");
		const secondChapter = chapterAt(store, book.id, 2);
		const events = store.listCanonEvents(book.id, {
			chapterId: secondChapter.id,
		});
		expect(events[0]?.participants).toEqual(["林言"]);
		const voices = store.listCanonVoices(book.id, {
			chapterId: secondChapter.id,
		});
		expect(voices[0]?.character).toBe("林言");
	});

	it("插叙、回忆与梦境标为插叙，主时间线查询排除", async () => {
		const store = openStore();
		const book = makeBook(store, [
			{ title: "第一章", paragraphs: ["林言在梦里回到山门。"] },
		]);
		const client = scriptedClient(() =>
			JSON.stringify({
				events: [
					{
						title: "梦中回山",
						summary: "梦见旧事。",
						digest: "第一句。第二句。第三句。",
						participants: ["林言"],
						location: "山门",
						time: "梦中",
						paragraphStart: 1,
						paragraphEnd: 1,
						isInterlude: true,
					},
					{
						title: "醒来",
						summary: "林言醒来。",
						digest: "第一句。第二句。第三句。",
						participants: ["林言"],
						location: null,
						time: "清晨",
						paragraphStart: 1,
						paragraphEnd: 1,
						isInterlude: false,
					},
				],
				voices: [],
				facts: [],
			}),
		);
		await runCanonBookExtraction({
			store,
			client,
			model: "background",
			bookId: book.id,
		});
		expect(store.listCanonEvents(book.id)).toHaveLength(2);
		const timeline = store.listCanonTimeline(book.id);
		expect(timeline).toHaveLength(1);
		expect(timeline[0]?.title).toBe("醒来");
	});

	it("长章按块抽取，不合格的块单独重跑且已通过的块不重跑", async () => {
		const store = openStore();
		const paragraph = (marker: string) =>
			`${marker}林言站在风里。${"风".repeat(970)}`;
		const book = makeBook(store, [
			{
				title: "长章",
				paragraphs: Array.from({ length: 45 }, (_, index) =>
					paragraph(`第${index + 1}段。`),
				),
			},
		]);
		const chapter = chapterAt(store, book.id, 1);
		const firstAttempts = new Map<string, number>();
		const client = scriptedClient((request) => {
			const user = userText(request);
			const block = parseBlock(user);
			const key = `${block.start}-${block.end}`;
			const attempt = (firstAttempts.get(key) ?? 0) + 1;
			firstAttempts.set(key, attempt);
			if (attempt === 1 && key === "21-40") {
				return JSON.stringify({
					events: [
						{
							title: "不存在的人",
							summary: "合成。",
							digest: "第一句。第二句。第三句。",
							participants: ["不存在的人"],
							location: null,
							time: null,
							paragraphStart: block.start,
							paragraphEnd: block.end,
							isInterlude: false,
						},
					],
					voices: [],
					facts: [],
				});
			}
			if (attempt === 1 && key === "41-45") {
				return JSON.stringify({
					events: [
						{
							title: "越界",
							summary: "合成。",
							digest: "第一句。第二句。第三句。",
							participants: ["林言"],
							location: null,
							time: null,
							paragraphStart: block.start,
							paragraphEnd: block.end + 1,
							isInterlude: false,
						},
					],
					voices: [],
					facts: [],
				});
			}
			return genericResponse(user);
		});
		const extraction = await runCanonBookExtraction({
			store,
			client,
			model: "background",
			bookId: book.id,
		});
		expect(extraction.status).toBe("failed");
		const progress = store.getCanonChapterExtraction(chapter.id);
		expect(progress?.chunks.map((chunk) => chunk.status)).toEqual([
			"done",
			"failed",
			"failed",
		]);
		expect(
			store.listCanonEvents(book.id, { chapterId: chapter.id }),
		).toHaveLength(1);

		store.markCanonExtractionRunning(book.id, "background");
		const rerun = scriptedClient((request) =>
			genericResponse(userText(request)),
		);
		const rerunResult = await extractCanonChapter({
			store,
			client: rerun,
			model: "background",
			bookId: book.id,
			chapterId: chapter.id,
			mode: "resume",
		});
		expect(rerunResult.calls).toBe(2);
		const done = store.getCanonChapterExtraction(chapter.id);
		expect(done?.status).toBe("done");
		expect(done?.chunks.map((chunk) => chunk.status)).toEqual([
			"done",
			"done",
			"done",
		]);
		expect(
			store.listCanonEvents(book.id, { chapterId: chapter.id }),
		).toHaveLength(3);
	});

	it("合并章节后章节锚点跟着更新", async () => {
		const store = openStore();
		const book = makeBook(store, [
			{ title: "第一章", paragraphs: ["林言在门口。"] },
			{ title: "第二章", paragraphs: ["林言走进院子。"] },
			{ title: "第三章", paragraphs: ["林言坐下。"] },
			{ title: "第四章", paragraphs: ["林言起身。"] },
		]);
		const client = scriptedClient((request) =>
			genericResponse(userText(request)),
		);
		await runCanonBookExtraction({
			store,
			client,
			model: "background",
			bookId: book.id,
		});
		const fourth = chapterAt(store, book.id, 4);
		expect(
			store.listCanonEvents(book.id, { chapterId: fourth.id })[0]
				?.chapterOrdinal,
		).toBe(4);
		store.mergeCanonChapterWithNext(book.id, chapterAt(store, book.id, 2).id);
		const fourthAfter = store.listCanonChapterRecords(book.id)[2];
		expect(fourthAfter?.id).toBe(fourth.id);
		expect(
			store.listCanonEvents(book.id, { chapterId: fourth.id })[0]
				?.chapterOrdinal,
		).toBe(3);
		expect(store.getCanonExtraction(book.id)?.totalChapters).toBe(3);
	});

	it("整章重跑后名册按剩余结果重建", async () => {
		const store = openStore();
		const book = makeBook(store, [
			{ title: "第一章", paragraphs: ["林言在门口。"] },
			{ title: "第二章", paragraphs: ["林言走进院子。"] },
		]);
		const client = scriptedClient((request) =>
			genericResponse(userText(request)),
		);
		await runCanonBookExtraction({
			store,
			client,
			model: "background",
			bookId: book.id,
		});
		const second = chapterAt(store, book.id, 2);
		store.markCanonExtractionRunning(book.id, "background");
		const empty = scriptedClient(() =>
			JSON.stringify({ events: [], voices: [], facts: [] }),
		);
		await extractCanonChapter({
			store,
			client: empty,
			model: "background",
			bookId: book.id,
			chapterId: second.id,
			mode: "full",
		});
		const roster = rebuildCanonEntityRoster(store, book.id);
		expect(roster.every((item) => item.name !== "师父")).toBe(true);
		expect(roster.length).toBeGreaterThan(0);
	});
});
