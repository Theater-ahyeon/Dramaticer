import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
	LlmChannelsConfig,
	LlmClient,
	LlmRequest,
	LlmResult,
	LlmStream,
} from "@dramaticer/core";
import type {
	CanonCompiledView,
	CanonEstimateView,
	CanonExtractionOverviewView,
	CanonExtractionView,
	CanonPackageView,
	ImportCanonBookResult,
	ImportCanonPackageResult,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

const FIXTURES = join(
	import.meta.dirname,
	"..",
	"..",
	"core",
	"test",
	"fixtures",
);

function config(): LlmChannelsConfig {
	return {
		channels: new Map(),
		models: new Map([
			[
				"background",
				{
					alias: "background",
					id: "fake-background",
					contextWindow: 32_768,
					maxTokens: 4_096,
					reasoning: false,
					enabled: true,
					channels: [],
					tools: null,
					probe: null,
				},
			],
		]),
		roles: new Map([["settler", "background"]]),
		embeddings: new Map(),
		reranker: null,
	};
}

function userText(request: LlmRequest): string {
	return (
		request.messages.find((message) => message.role === "user")?.content ?? ""
	);
}

function fakeResponse(request: LlmRequest): string {
	const user = userText(request);
	const match = /<块 段落="(\d+)-(\d+)">\n([\s\S]*?)\n<\/块>/.exec(user);
	const start = Number(match?.[1] ?? "1");
	const end = Number(match?.[2] ?? "1");
	const text = match?.[3] ?? "";
	const name = ["少年", "守门人", "师父", "林言"].find((item) =>
		text.includes(item),
	);
	return JSON.stringify({
		events: [
			{
				title: `服务端事件 ${start}`,
				summary: "合成事件。",
				digest: "第一句。第二句。第三句。",
				participants: name === undefined ? [] : [name],
				location: "山门",
				time: "清晨",
				paragraphStart: start,
				paragraphEnd: end,
				isInterlude: false,
			},
		],
		voices:
			name === undefined
				? []
				: [{ character: name, kind: "speech", text: "合成原话。" }],
		facts:
			name === undefined
				? []
				: [{ name, aliases: [], kind: "人物", fact: "合成事实。" }],
	});
}

function fakeResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-background",
		channel: "fake",
		usage: {
			promptTokens: 90,
			completionTokens: 40,
			totalTokens: 130,
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
	return (
		request.messages.find((message) => message.role === "system")?.content ?? ""
	);
}

/** 汇编三类提示词的假回复；抽取提示词返回 null 交给 fakeResponse。 */
function compileResponse(request: LlmRequest): string | null {
	const system = systemText(request);
	if (system.includes("人物与别名合并器")) {
		return JSON.stringify({ merges: [] });
	}
	if (system.includes("时间线编者")) {
		return JSON.stringify({ turningPoints: [] });
	}
	if (!system.includes("人物页编者")) return null;
	const blocks = [
		...userText(request).matchAll(
			/<实体 名="([^"]+)" 类别="[^"]*" 首章="(\d+)" 末章="(\d+)">([\s\S]*?)<\/实体>/g,
		),
	];
	return JSON.stringify({
		entities: blocks.map((block) => {
			const name = block[1] ?? "";
			const chapters = new Set<number>();
			for (const entry of (block[4] ?? "").matchAll(/\[第 (\d+) 章\]/g)) {
				chapters.add(Number(entry[1]));
			}
			return {
				name,
				lead: `${name}的服务端合成简介。`,
				entries: [...chapters]
					.sort((left, right) => left - right)
					.map((chapter) => ({
						chapter,
						text: `到第 ${chapter} 章时关于${name}的合成底色。`,
					})),
			};
		}),
	});
}

function fakeClient(): LlmClient {
	return {
		async complete(request) {
			const compiled = compileResponse(request);
			return fakeResult(compiled ?? fakeResponse(request));
		},
	};
}

function asStreaming(client: LlmClient): LlmClient & {
	stream: () => LlmStream;
} {
	return {
		complete: (request, options) => client.complete(request, options),
		stream() {
			throw new Error("测试不使用流式");
		},
	};
}

interface TestServer {
	readonly running: RunningServer;
	readonly dir: string;
}

async function startTestServer(withChannels: boolean): Promise<TestServer> {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-canon-extract-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
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
		...(withChannels
			? {
					channels: {
						load: async () => config(),
						createClient: () => asStreaming(fakeClient()),
					},
				}
			: {}),
		log: () => {},
	});
	onTestFinished(() => running.close());
	return { running, dir };
}

async function importSample(origin: string): Promise<ImportCanonBookResult> {
	const response = await fetch(`${origin}/api/canon/books`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			filename: "云海纪事.txt",
			dataBase64: readFileSync(join(FIXTURES, "canon-sample.txt")).toString(
				"base64",
			),
		}),
	});
	expect(response.status).toBe(201);
	return (await response.json()) as ImportCanonBookResult;
}

async function getExtraction(
	origin: string,
	bookId: string,
): Promise<CanonExtractionView> {
	const response = await fetch(`${origin}/api/canon/books/${bookId}/extract`);
	expect(response.status).toBe(200);
	return (await response.json()) as CanonExtractionView;
}

async function waitForDone(
	origin: string,
	bookId: string,
): Promise<CanonExtractionView> {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const view = await getExtraction(origin, bookId);
		if (view.extraction.status === "done") return view;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("抽取没有在 10 秒内完成");
}

describe("原著抽取接口", () => {
	it("预估、开始、进度与单章重跑都走后台模型", async () => {
		const { running } = await startTestServer(true);
		const origin = running.origin;
		const imported = await importSample(origin);
		const bookId = imported.book.id;

		const estimateResponse = await fetch(
			`${origin}/api/canon/books/${bookId}/estimate`,
		);
		expect(estimateResponse.status).toBe(200);
		const estimate = (await estimateResponse.json()) as CanonEstimateView;
		expect(estimate.chapterCount).toBe(8);
		expect(estimate.model).toBe("background");
		expect(estimate.estimatedCost).toBeGreaterThan(0);

		const startResponse = await fetch(
			`${origin}/api/canon/books/${bookId}/extract/start`,
			{ method: "POST" },
		);
		expect(startResponse.status).toBe(202);
		const started = (await startResponse.json()) as CanonExtractionView;
		expect(started.extraction.status).toBe("running");

		const done = await waitForDone(origin, bookId);
		expect(done.extraction.doneChapters).toBe(8);
		expect(done.extraction.llmCalls).toBe(8);
		expect(done.extraction.llmTokens).toBe(8 * 130);
		expect(
			done.chapters.every((item) => item.extraction?.status === "done"),
		).toBe(true);
		expect(done.events.length).toBeGreaterThan(0);
		expect(done.events[0]?.chapterOrdinal).toBeGreaterThanOrEqual(1);

		// 已完成的书再暂停不会改状态。
		const pausedResponse = await fetch(
			`${origin}/api/canon/books/${bookId}/extract/pause`,
			{ method: "POST" },
		);
		expect(pausedResponse.status).toBe(200);
		const paused = (await pausedResponse.json()) as CanonExtractionView;
		expect(paused.extraction.status).toBe("done");

		const chapter = done.chapters[1]?.chapter;
		expect(chapter).toBeDefined();
		if (chapter === undefined) return;
		const rerunResponse = await fetch(
			`${origin}/api/canon/books/${bookId}/chapters/${chapter.id}/extract`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mode: "full" }),
			},
		);
		expect(rerunResponse.status).toBe(202);
		const deadline = Date.now() + 10_000;
		let rerun: CanonExtractionView = done;
		while (Date.now() < deadline) {
			rerun = await getExtraction(origin, bookId);
			const chapterState = rerun.chapters.find(
				(item) => item.chapter.id === chapter.id,
			);
			if (
				rerun.extraction.status === "done" &&
				chapterState?.extraction?.status === "done" &&
				rerun.events.some((event) => event.chapterId === chapter.id)
			) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		expect(rerun.events.some((event) => event.chapterId === chapter.id)).toBe(
			true,
		);

		const overviewResponse = await fetch(`${origin}/api/canon/extract`);
		expect(overviewResponse.status).toBe(200);
		const overview =
			(await overviewResponse.json()) as CanonExtractionOverviewView;
		const entry = overview.books.find((item) => item.book.id === bookId);
		expect(entry?.extraction?.llmCalls).toBeGreaterThan(8);
	});

	it("没有配置渠道时开始抽取返回 409", async () => {
		const { running } = await startTestServer(false);
		const origin = running.origin;
		const imported = await importSample(origin);
		const response = await fetch(
			`${origin}/api/canon/books/${imported.book.id}/extract/start`,
			{ method: "POST" },
		);
		expect(response.status).toBe(409);
	});
});

async function getCompiled(
	origin: string,
	bookId: string,
	upToChapter?: number,
): Promise<CanonCompiledView> {
	const query = upToChapter === undefined ? "" : `?upToChapter=${upToChapter}`;
	const response = await fetch(
		`${origin}/api/canon/books/${bookId}/compiled${query}`,
	);
	expect(response.status).toBe(200);
	return (await response.json()) as CanonCompiledView;
}

async function waitForCompiled(
	origin: string,
	bookId: string,
): Promise<CanonCompiledView> {
	const deadline = Date.now() + 10_000;
	let last: CanonCompiledView | null = null;
	while (Date.now() < deadline) {
		const view = await getCompiled(origin, bookId);
		last = view;
		if (view.compilation.status === "done") return view;
		if (view.compilation.status === "failed") break;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(
		`汇编没有完成：${last?.compilation.status ?? "无记录"} ${last?.compilation.lastError ?? ""}`,
	);
}

async function postJson(url: string, body: unknown): Promise<Response> {
	return fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("全书汇编与原著包接口", () => {
	it("汇编、按游标预览、导出与导入一条链路", async () => {
		const { running } = await startTestServer(true);
		const origin = running.origin;
		const imported = await importSample(origin);
		const bookId = imported.book.id;
		expect(imported.book.hasText).toBe(true);

		// 抽取完成前不能汇编。
		const tooEarly = await fetch(
			`${origin}/api/canon/books/${bookId}/compile`,
			{ method: "POST" },
		);
		expect(tooEarly.status).toBe(409);

		await fetch(`${origin}/api/canon/books/${bookId}/extract/start`, {
			method: "POST",
		});
		await waitForDone(origin, bookId);

		const startCompile = await fetch(
			`${origin}/api/canon/books/${bookId}/compile`,
			{ method: "POST" },
		);
		expect(startCompile.status).toBe(202);
		const started = (await startCompile.json()) as CanonCompiledView;
		expect(started.compilation.status).toBe("running");

		const compiled = await waitForCompiled(origin, bookId);
		expect(compiled.entities.length).toBeGreaterThan(0);
		expect(compiled.entities.every((entity) => entity.lead.length > 0)).toBe(
			true,
		);
		expect(
			compiled.entities.every((entity) => entity.baseEntries.length > 0),
		).toBe(true);
		const main = compiled.events.filter((event) => !event.isInterlude);
		const interludes = compiled.events.filter((event) => event.isInterlude);
		expect(
			main
				.map((event) => event.timelineOrder)
				.sort((a, b) => (a ?? 0) - (b ?? 0)),
		).toEqual(main.map((_, index) => index + 1));
		expect(interludes.every((event) => event.timelineOrder === null)).toBe(
			true,
		);
		expect(compiled.compilation.llmCalls).toBeGreaterThanOrEqual(3);

		const preview = await getCompiled(origin, bookId, 1);
		expect(preview.worldIndex?.text).toContain("世界索引：");
		expect(preview.pages?.length ?? 0).toBeGreaterThan(0);
		for (const page of preview.pages ?? []) {
			expect(page.entries.every((entry) => entry.chapterOrdinal <= 1)).toBe(
				true,
			);
		}

		const exportResponse = await fetch(
			`${origin}/api/canon/books/${bookId}/export?includeText=0`,
		);
		expect(exportResponse.status).toBe(200);
		expect(exportResponse.headers.get("content-disposition")).toContain(
			"attachment",
		);
		const pkg = (await exportResponse.json()) as CanonPackageView;
		const serialized = JSON.stringify(pkg);
		expect(serialized).not.toContain("山门外的雨下了整夜");
		expect(serialized).not.toContain('"paragraphs"');

		const withTextResponse = await fetch(
			`${origin}/api/canon/books/${bookId}/export?includeText=1`,
		);
		const withText = (await withTextResponse.json()) as CanonPackageView;
		expect(withText.chapters[0]?.paragraphs?.length ?? 0).toBeGreaterThan(0);

		const importResponse = await postJson(
			`${origin}/api/canon/packages/import`,
			{ package: pkg },
		);
		expect(importResponse.status).toBe(201);
		const copy = (await importResponse.json()) as ImportCanonPackageResult;
		expect(copy.book.hasText).toBe(false);
		expect(copy.book.status).toBe("extracted");
		const copyCompiled = await getCompiled(origin, copy.book.id);
		expect(copyCompiled.compilation.status).toBe("done");
		expect(copyCompiled.compilation.llmCalls).toBe(0);
		expect(copyCompiled.entities).toHaveLength(compiled.entities.length);
		const copyExtraction = await fetch(
			`${origin}/api/canon/books/${copy.book.id}/extract`,
		);
		const copyExtractionView =
			(await copyExtraction.json()) as CanonExtractionView;
		expect(copyExtractionView.extraction.status).toBe("done");
		expect(copyExtractionView.extraction.llmCalls).toBe(0);
		const copyPreview = await getCompiled(origin, copy.book.id, 1);
		expect(copyPreview.worldIndex?.text).toContain("世界索引：");

		// 不含原文的原著包不需要再汇编。
		const recompile = await fetch(
			`${origin}/api/canon/books/${copy.book.id}/compile`,
			{ method: "POST" },
		);
		expect(recompile.status).toBe(409);

		const overviewResponse = await fetch(`${origin}/api/canon/extract`);
		const overview =
			(await overviewResponse.json()) as CanonExtractionOverviewView;
		const entry = overview.books.find((item) => item.book.id === bookId);
		expect(entry?.compilation?.status).toBe("done");
		expect(entry?.compilation?.llmCalls).toBeGreaterThanOrEqual(3);
	});

	it("拒绝别的 JSON 与错误的 includeText", async () => {
		const { running } = await startTestServer(true);
		const origin = running.origin;
		const imported = await importSample(origin);
		const bad = await postJson(`${origin}/api/canon/packages/import`, {
			package: { format: "not-a-package" },
		});
		expect(bad.status).toBe(400);
		const badQuery = await fetch(
			`${origin}/api/canon/books/${imported.book.id}/export?includeText=2`,
		);
		expect(badQuery.status).toBe(400);
	});
});
