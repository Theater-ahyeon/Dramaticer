import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type BackgroundJobRegistry,
	type LlmCallOptions,
	type LlmChannelsConfig,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type LlmStream,
	type LlmStreamingClient,
	OPENING_CANDIDATES_JOB_KIND,
	OPENING_JOB_KIND,
	createBackgroundJobRegistry,
	createOpeningCandidatesHandler,
	createOpeningHandler,
	openingCandidatesNeedRun,
	openingPackNeedsRun,
} from "@dramaticer/core";
import type {
	ApiErrorResponse,
	StoryOpeningGenerateResult,
	StoryOpeningPickResult,
	StoryOpeningsView,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-openings-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
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

const OPENING_PACK = JSON.stringify({
	place: "山门",
	time: "清晨",
	participants: [{ name: "云裳", wants: "守住山门" }],
	conflict: "魔修逼近山门",
	directions: ["迎敌", "退守大殿", "去剑冢取剑"],
});

function candidatesJson(label: string): string {
	return JSON.stringify({
		candidates: Array.from(
			{ length: 3 },
			(_, index) => `${label}${index + 1}：山风卷着雪，云裳按住剑柄。`,
		),
	});
}

/** 按系统提示词区分开局包与开场候选，忽略其余请求；发请求前等待闸门。 */
class OpeningClient implements LlmStreamingClient {
	readonly requests: LlmRequest[] = [];
	readonly #gate: Promise<void>;

	constructor(gate: Promise<void>) {
		this.#gate = gate;
	}

	async complete(request: LlmRequest, _options?: LlmCallOptions) {
		this.requests.push(request);
		await this.#gate;
		const system = request.messages[0]?.content ?? "";
		if (system.includes("开局导演")) return llmResult(OPENING_PACK);
		if (system.includes("开场作者")) {
			const label = `第${this.requests.length}批·`;
			return llmResult(candidatesJson(label));
		}
		throw new Error(`测试没有准备的请求：${system.slice(0, 20)}`);
	}

	stream(): LlmStream {
		throw new Error("开局测试不发起流式请求");
	}
}

function fakeConfig(): LlmChannelsConfig {
	return {
		channels: new Map([
			[
				"fake",
				{
					id: "fake",
					api: "openai-completions",
					baseUrl: "http://127.0.0.1:9",
					apiKey: "",
					requestsPerMinute: 0,
					maxRetries: 0,
					retryBaseDelayMs: 0,
					timeoutMs: 1_000,
				},
			],
		]),
		models: new Map(
			["main", "background"].map((alias) => [
				alias,
				{
					alias,
					id: `${alias}-model`,
					contextWindow: 8_192,
					maxTokens: 1_024,
					reasoning: true,
					channels: ["fake"],
					tools: null,
					probe: null,
				},
			]),
		),
		roles: new Map(),
		embeddings: new Map(),
	};
}

function openingRegistry(): BackgroundJobRegistry {
	return createBackgroundJobRegistry({
		[OPENING_JOB_KIND]: {
			handler: createOpeningHandler(),
			enqueue: "story",
			needsRun: openingPackNeedsRun,
		},
		[OPENING_CANDIDATES_JOB_KIND]: {
			handler: createOpeningCandidatesHandler(),
			enqueue: "story",
			needsRun: openingCandidatesNeedRun,
		},
	});
}

const cardData = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "云裳",
		description: "青云宗剑修",
		first_mes: "山门外的风很冷。",
	},
};

interface TestServer {
	readonly running: RunningServer;
	readonly gate: () => void;
}

async function startTestServer(): Promise<TestServer> {
	const dir = tempDir();
	const webRoot = join(dir, "web");
	mkdirSync(webRoot, { recursive: true });
	writeFileSync(
		join(webRoot, "index.html"),
		"<!doctype html><title>应用</title>",
	);
	const paused = Promise.withResolvers<void>();
	const client = new OpeningClient(paused.promise);
	const running = await startServer({
		dbPath: join(dir, "story.db"),
		webRoot,
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => {},
		channels: {
			load: async () => fakeConfig(),
			createClient: () => client,
			createBackgroundRegistry: () => openingRegistry(),
		},
	});
	onTestFinished(() => running.close());
	onTestFinished(() => paused.resolve());
	return { running, gate: () => paused.resolve() };
}

function post(origin: string, path: string, body: unknown): Promise<Response> {
	return fetch(`${origin}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function errorBody(response: Response): Promise<ApiErrorResponse> {
	return (await response.json()) as ApiErrorResponse;
}

describe("开局任务入队", () => {
	it("导入卡后立即入队两条故事级任务，选中候选后生成接口返回 409", async () => {
		const { running, gate } = await startTestServer();
		const store = running.store;

		const created = await post(running.origin, "/api/stories", {
			id: "s1",
			title: "山门",
		});
		expect(created.status).toBe(201);
		expect(
			store.listBackgroundJobs({
				storyId: "s1",
				kinds: [OPENING_JOB_KIND, OPENING_CANDIDATES_JOB_KIND],
			}),
		).toEqual([]);

		const imported = await post(running.origin, "/api/stories/s1/import", {
			card: { format: "json", data: JSON.stringify(cardData) },
		});
		expect(imported.status).toBe(200);
		const queued = store.listBackgroundJobs({
			storyId: "s1",
			kinds: [OPENING_JOB_KIND, OPENING_CANDIDATES_JOB_KIND],
		});
		expect(queued.map((job) => job.kind).sort()).toEqual([
			OPENING_JOB_KIND,
			OPENING_CANDIDATES_JOB_KIND,
		]);
		expect(queued.every((job) => job.nodeId === null)).toBe(true);
		expect(store.getOpeningPack("s1")).toBeNull();
		expect(store.listOpeningCandidates("s1")).toEqual([]);

		gate();
		await vi.waitFor(
			() => {
				expect(store.getOpeningPack("s1")).not.toBeNull();
				expect(store.listOpeningCandidates("s1")).toHaveLength(3);
			},
			{ timeout: 10_000 },
		);

		const firstGenerate = await post(
			running.origin,
			"/api/stories/s1/openings/generate",
			{},
		);
		expect(firstGenerate.status).toBe(202);
		const firstJob = (await firstGenerate.json()) as StoryOpeningGenerateResult;
		expect(firstJob).toMatchObject({
			storyId: "s1",
			kind: OPENING_CANDIDATES_JOB_KIND,
		});
		await vi.waitFor(
			() => expect(store.listOpeningCandidates("s1")).toHaveLength(6),
			{ timeout: 10_000 },
		);

		const secondGenerate = await post(
			running.origin,
			"/api/stories/s1/openings/generate",
			{},
		);
		expect(secondGenerate.status).toBe(202);
		const secondJob =
			(await secondGenerate.json()) as StoryOpeningGenerateResult;
		expect(secondJob.jobId).toBe(firstJob.jobId);
		await vi.waitFor(
			() => expect(store.listOpeningCandidates("s1")).toHaveLength(9),
			{ timeout: 10_000 },
		);

		const candidates = store.listOpeningCandidates("s1");
		expect(candidates.map((item) => item.ordinal)).toEqual([
			0, 1, 2, 3, 4, 5, 6, 7, 8,
		]);
		expect(candidates.every((item) => item.status === "pending")).toBe(true);

		const picked = candidates[0];
		if (picked === undefined) throw new Error("测试没有生成候选");
		const pick = await post(
			running.origin,
			`/api/stories/s1/openings/${picked.id}/pick`,
			{},
		);
		expect(pick.status).toBe(200);
		const pickResult = (await pick.json()) as StoryOpeningPickResult;
		expect(pickResult.node.role).toBe("assistant");
		expect(pickResult.node.raw).toBe(picked.raw);
		expect(pickResult.path.nodes).toHaveLength(1);
		expect(
			store
				.listOpeningCandidates("s1", { status: "discarded" })
				.map((item) => item.id),
		).toEqual(candidates.slice(1).map((item) => item.id));

		const blocked = await post(
			running.origin,
			"/api/stories/s1/openings/generate",
			{},
		);
		expect(blocked.status).toBe(409);
		const body = await errorBody(blocked);
		expect(body.error.code).toBe("conflict");
	});

	it("故事不存在时生成接口 404，候选列表仍然可读", async () => {
		const { running } = await startTestServer();
		const missing = await post(
			running.origin,
			"/api/stories/missing/openings/generate",
			{},
		);
		expect(missing.status).toBe(404);

		await post(running.origin, "/api/stories", { id: "s2", title: "空故事" });
		const list = await fetch(`${running.origin}/api/stories/s2/openings`);
		expect(list.status).toBe(200);
		expect(((await list.json()) as StoryOpeningsView).candidates).toEqual([]);
	});
});
