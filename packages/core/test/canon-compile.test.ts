import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	type CanonBookRecord,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	StoryStore,
	buildCanonStartingPages,
	buildCanonWorldIndex,
	exportCanonPackage,
	importCanonPackage,
	parseCanonPackage,
	runCanonBookExtraction,
	runCanonCompilation,
} from "../src/index.js";

function openStore(): StoryStore {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-canon-compile-"));
	const store = StoryStore.open(join(dir, "story.db"));
	onTestFinished(() => {
		store.close();
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return store;
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

function systemText(request: LlmRequest): string {
	return request.messages.find((item) => item.role === "system")?.content ?? "";
}

function userText(request: LlmRequest): string {
	return request.messages.find((item) => item.role === "user")?.content ?? "";
}

function event(input: {
	title: string;
	summary: string;
	participants: readonly string[];
	isInterlude?: boolean;
}): unknown {
	return {
		title: input.title,
		summary: input.summary,
		digest: "第一句。第二句。第三句。",
		participants: input.participants,
		location: null,
		time: null,
		paragraphStart: 1,
		paragraphEnd: 1,
		isInterlude: input.isInterlude ?? false,
	};
}

const EXTRACTION_RESPONSES: Readonly<Record<string, string>> = {
	"1": JSON.stringify({
		events: [
			event({
				title: "入山门",
				summary: "林言在师父面前走进山门。",
				participants: ["林言", "师父"],
			}),
		],
		voices: [{ character: "林言", kind: "speech", text: "弟子来了。" }],
		facts: [
			{ name: "林言", aliases: [], kind: "人物", fact: "刚入山门的弟子。" },
			{ name: "师父", aliases: [], kind: "人物", fact: "山门的掌门。" },
			{ name: "山门", aliases: [], kind: "地点", fact: "山腰上的旧山门。" },
		],
	}),
	"2": JSON.stringify({
		events: [
			event({
				title: "读信",
				summary: "小言在灯下读一封旧信。",
				participants: ["小言"],
			}),
		],
		voices: [{ character: "小言", kind: "thought", text: "这封信是谁写的。" }],
		facts: [
			{ name: "小言", aliases: [], kind: "人物", fact: "喜欢在夜里读信。" },
		],
	}),
	"3": JSON.stringify({
		events: [
			event({
				title: "拔剑",
				summary: "林公子在山门前拔剑。",
				participants: ["林公子"],
			}),
			event({
				title: "旧剑回忆",
				summary: "林公子想起小时候见过这把剑。",
				participants: ["林公子"],
				isInterlude: true,
			}),
		],
		voices: [
			{ character: "林公子", kind: "speech", text: "这一剑我练了十年。" },
		],
		facts: [
			{ name: "林公子", aliases: [], kind: "人物", fact: "剑术在同辈里出众。" },
		],
	}),
	"4": JSON.stringify({
		events: [
			event({
				title: "身世",
				summary: "师父说林言是魔教后人。",
				participants: ["师父", "林言"],
			}),
		],
		voices: [{ character: "师父", kind: "speech", text: "你并非凡人之子。" }],
		facts: [
			{
				name: "林言",
				aliases: [],
				kind: "人物",
				fact: "身世是魔教后人，这一章才揭晓。",
			},
			{ name: "魔教", aliases: [], kind: "势力", fact: "早已覆灭的旧势力。" },
		],
	}),
};

function extractionClient(): LlmClient {
	return {
		async complete(request) {
			const ordinal = /<本章 序号="(\d+)"/.exec(userText(request))?.[1] ?? "0";
			const text = EXTRACTION_RESPONSES[ordinal];
			if (text === undefined) throw new Error(`没有第 ${ordinal} 章的假回复`);
			return result(text);
		},
	};
}

function compileResponse(user: string, system: string): string {
	if (system.includes("人物与别名合并器")) {
		return JSON.stringify({
			merges: [
				{
					canonicalName: "林言",
					names: ["林言", "小言", "林公子"],
					aliases: ["小言", "林公子"],
				},
			],
		});
	}
	if (system.includes("时间线编者")) {
		const lines = [...user.matchAll(/- \[(\d+)\] 第 \d+ 章 .*：([^\n]*)/g)];
		const turning = lines.find((line) => (line[2] ?? "").includes("魔教"));
		return JSON.stringify({
			turningPoints: turning === undefined ? [] : [Number(turning[1])],
		});
	}
	if (system.includes("人物页编者")) {
		const blocks = [
			...user.matchAll(/<实体 名="([^"]+)"[^>]*>([\s\S]*?)<\/实体>/g),
		];
		return JSON.stringify({
			entities: blocks.map((block) => {
				const name = block[1] ?? "";
				const body = block[2] ?? "";
				const seenChapters = new Set<number>();
				const entries: { chapter: number; text: string }[] = [];
				for (const entry of body.matchAll(/\[第 (\d+) 章\] ([^\n]*)/g)) {
					const chapter = Number(entry[1]);
					if (seenChapters.has(chapter)) continue;
					seenChapters.add(chapter);
					entries.push({ chapter, text: entry[2] ?? "" });
				}
				return {
					name,
					lead: `合成简介：山门故事里的${name}。`,
					entries,
				};
			}),
		});
	}
	throw new Error("未知的汇编提示词");
}

function compileClient(calls: string[]): LlmClient {
	return {
		async complete(request) {
			const system = systemText(request);
			calls.push(system);
			return result(compileResponse(userText(request), system));
		},
	};
}

function makeBook(store: StoryStore): CanonBookRecord {
	return store.createCanonBook({
		title: "合成原著",
		encoding: "utf-8",
		chapters: [
			{
				volumeTitle: null,
				title: "第一章 入山门",
				kind: "chapter",
				paragraphs: ["林言推开山门，师父在门后等他。"],
			},
			{
				volumeTitle: null,
				title: "第二章 读信",
				kind: "chapter",
				paragraphs: ["小言在灯下读一封旧信。"],
			},
			{
				volumeTitle: null,
				title: "第三章 拔剑",
				kind: "chapter",
				paragraphs: ["林公子在山门前拔剑，剑光很亮。"],
			},
			{
				volumeTitle: null,
				title: "第四章 身世",
				kind: "chapter",
				paragraphs: ["师父说林言其实是魔教后人。"],
			},
		],
	}).book;
}

async function extractAndCompile(
	store: StoryStore,
	book: CanonBookRecord,
): Promise<readonly string[]> {
	await runCanonBookExtraction({
		store,
		client: extractionClient(),
		model: "background",
		bookId: book.id,
	});
	const calls: string[] = [];
	await runCanonCompilation({
		store,
		client: compileClient(calls),
		model: "background",
		bookId: book.id,
	});
	return calls;
}

describe("全书汇编", () => {
	it("合并跨章别名，事件、话术与事实一起归一", async () => {
		const store = openStore();
		const book = makeBook(store);
		const calls = await extractAndCompile(store, book);
		expect(calls.length).toBeGreaterThan(0);
		const entities = store.listCanonEntities(book.id);
		const names = entities.map((entity) => entity.name);
		expect(names).toContain("林言");
		expect(names).not.toContain("小言");
		expect(names).not.toContain("林公子");
		const merged = entities.find((entity) => entity.name === "林言");
		expect(merged?.aliases.sort()).toEqual(["小言", "林公子"].sort());
		expect(merged?.firstChapterOrdinal).toBe(1);
		expect(merged?.lastChapterOrdinal).toBe(4);

		const events = store.listCanonEvents(book.id);
		for (const item of events) {
			expect(item.participants).not.toContain("小言");
			expect(item.participants).not.toContain("林公子");
		}
		expect(events.some((item) => item.participants.includes("林言"))).toBe(
			true,
		);
		expect(
			store
				.listCanonVoices(book.id)
				.every((voice) => voice.character !== "小言"),
		).toBe(true);
		expect(
			store
				.listCanonFacts(book.id)
				.every((fact) => fact.entityName !== "林公子"),
		).toBe(true);
		const compilation = store.getCanonCompilation(book.id);
		expect(compilation?.status).toBe("done");
		expect(compilation?.llmCalls).toBe(3);
	});

	it("排定主时间线与关键转折，插叙不进主线", async () => {
		const store = openStore();
		const book = makeBook(store);
		await extractAndCompile(store, book);
		const events = store.listCanonEvents(book.id);
		const main = events
			.filter((item) => !item.isInterlude)
			.sort(
				(left, right) => (left.timelineOrder ?? 0) - (right.timelineOrder ?? 0),
			);
		expect(main.map((item) => item.timelineOrder)).toEqual([1, 2, 3, 4]);
		expect(main.map((item) => item.chapterOrdinal)).toEqual([1, 2, 3, 4]);
		const interlude = events.find((item) => item.isInterlude);
		expect(interlude?.timelineOrder).toBeNull();
		const turning = events.filter((item) => item.isTurningPoint);
		expect(turning).toHaveLength(1);
		expect(turning[0]?.title).toBe("身世");
	});

	it("实体页有带章节锚点的底色，按游标切片不泄露后期内容", async () => {
		const store = openStore();
		const book = makeBook(store);
		await extractAndCompile(store, book);
		const compiled = store.listCanonCompiledEntities(book.id);
		const lin = compiled.find((entity) => entity.name === "林言");
		expect(lin?.lead.length).toBeGreaterThan(0);
		expect(lin?.baseEntries.map((entry) => entry.chapterOrdinal)).toEqual([
			1, 2, 3, 4,
		]);
		expect(lin?.base).toContain("第4章");

		const early = buildCanonStartingPages(store, book.id, 2);
		const earlyLin = early.find((page) => page.name === "林言");
		expect(earlyLin?.entries.map((entry) => entry.chapterOrdinal)).toEqual([
			1, 2,
		]);
		expect(earlyLin?.base).not.toContain("魔教");
		expect(earlyLin?.now).toBe("");
		expect(earlyLin?.past).toEqual([]);
		expect(early.map((page) => page.name)).not.toContain("魔教");

		const worldIndex = buildCanonWorldIndex(store, book.id, 2);
		expect(worldIndex?.text).toContain("林言——");
		expect(worldIndex?.text).not.toContain("魔教");
		const lateIndex = buildCanonWorldIndex(store, book.id, 4);
		expect(lateIndex?.lines.map((line) => line.entityName)).toContain("魔教");
	});

	it("默认导出不含原文；导入到全新数据库后直接是已汇编状态", async () => {
		const store = openStore();
		const book = makeBook(store);
		await extractAndCompile(store, book);
		const pkg = exportCanonPackage(store, book.id);
		const serialized = JSON.stringify(pkg);
		expect(serialized).not.toContain("林言推开山门，师父在门后等他。");
		expect(serialized).not.toContain('"paragraphs"');
		for (const chapter of pkg.chapters) {
			expect(chapter.paragraphs).toBeUndefined();
		}
		expect(pkg.book.hasText).toBe(true);
		expect(pkg.entities.map((entity) => entity.name)).toContain("林言");
		expect(pkg.events.some((item) => item.isTurningPoint)).toBe(true);
		expect(pkg.events.some((item) => item.timelineOrder === null)).toBe(true);

		const withText = exportCanonPackage(store, book.id, { includeText: true });
		expect(withText.chapters[0]?.paragraphs).toEqual([
			"林言推开山门，师父在门后等他。",
		]);

		const freshStore = openStore();
		const copy = importCanonPackage(
			freshStore,
			JSON.parse(serialized) as unknown,
		);
		const importedBook = copy.book;
		expect(importedBook.hasText).toBe(false);
		expect(importedBook.status).toBe("extracted");
		expect(copy.chapters).toHaveLength(4);
		expect(freshStore.getCanonCompilation(importedBook.id)?.status).toBe(
			"done",
		);
		const extraction = freshStore.getCanonExtraction(importedBook.id);
		expect(extraction?.status).toBe("done");
		expect(extraction?.llmCalls).toBe(0);
		expect(freshStore.getCanonCompilation(importedBook.id)?.llmCalls).toBe(0);
		expect(freshStore.listCanonCompiledEntities(importedBook.id)).toHaveLength(
			pkg.entities.length,
		);
		const freshEvents = freshStore.listCanonEvents(importedBook.id);
		expect(freshEvents).toHaveLength(pkg.events.length);
		expect(freshEvents.filter((item) => item.isTurningPoint)).toHaveLength(
			pkg.events.filter((item) => item.isTurningPoint).length,
		);
		expect(
			freshStore.listCanonTimeline(importedBook.id)[0]?.timelineOrder,
		).toBe(1);
		expect(freshStore.listCanonVoices(importedBook.id)).toHaveLength(
			pkg.voices.length,
		);
		expect(freshStore.listCanonFacts(importedBook.id)).toHaveLength(
			pkg.facts.length,
		);
		expect(
			buildCanonWorldIndex(freshStore, importedBook.id, 2)?.text,
		).toContain("林言——");
	});

	it("拒绝别的 JSON 与不支持的版本", () => {
		const store = openStore();
		const book = makeBook(store);
		expect(() => parseCanonPackage({ format: "something-else" })).toThrow(
			"不是 Dramaticer 原著包",
		);
		expect(() =>
			parseCanonPackage({ format: "dramaticer-canon-package", version: 99 }),
		).toThrow("不支持的原著包版本");
		expect(book.hasText).toBe(true);
	});
});
