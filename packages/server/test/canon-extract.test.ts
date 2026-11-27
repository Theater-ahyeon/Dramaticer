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
	CanonEstimateView,
	CanonExtractionOverviewView,
	CanonExtractionView,
	ImportCanonBookResult,
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

function fakeClient(): LlmClient {
	return {
		async complete(request) {
			return fakeResult(fakeResponse(request));
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
