import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	type EmbeddingClient,
	GAP_PASS_JOB_KIND,
	type LlmChannelsConfig,
	type LlmClient,
	StoryStore,
	createBackgroundJobRegistry,
	runWorkCli,
} from "../src/index.js";

const FIXED_NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

const fakeClient: LlmClient = {
	async complete(): Promise<never> {
		throw new Error("后台任务测试不应该调用模型");
	},
};

function createConfig(
	withBackground: boolean,
	withEmbeddings = false,
): LlmChannelsConfig {
	const channel = (id: string) => ({
		id,
		api: "openai-completions" as const,
		baseUrl: "http://localhost:1234",
		apiKey: "",
		requestsPerMinute: 0,
		maxRetries: 0,
		retryBaseDelayMs: 0,
		timeoutMs: 1_000,
	});
	const model = (alias: string) => ({
		alias,
		id: "fake-model",
		channels: [alias],
		contextWindow: 8_192,
		maxTokens: 1_024,
		reasoning: true,
		probe: null,
	});
	const channels = new Map([["main", channel("main")]]);
	const models = new Map([["main", model("main")]]);
	if (withBackground) {
		channels.set("bg", channel("bg"));
		models.set("background", model("background"));
	}
	const embeddings = new Map([
		[
			"default",
			{
				id: "default",
				api: "openai-embeddings" as const,
				baseUrl: "http://127.0.0.1:1234/v1",
				apiKey: "",
				model: "fake-embedding",
				dimensions: 1024,
				batchSize: 32,
				requestsPerMinute: 0,
				maxRetries: 0,
				retryBaseDelayMs: 0,
				timeoutMs: 1_000,
			},
		],
	]);
	return {
		channels,
		models,
		roles: new Map(),
		embeddings: withEmbeddings ? embeddings : new Map(),
	};
}

function createTempDb(): string {
	const dbPath = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-work-cli-")),
		"story.db",
	);
	onTestFinished(() => {
		rmSync(dirname(dbPath), { recursive: true, force: true, maxRetries: 5 });
	});
	const store = StoryStore.open(dbPath);
	try {
		store.createStory({ id: "s1", title: "测试" });
		const a = store.appendNode({
			id: "n-a",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "已确认的楼层",
		});
		store.appendNode({
			id: "n-b",
			storyId: "s1",
			parentId: a.id,
			role: "user",
			raw: "当前末端",
		});
	} finally {
		store.close();
	}
	return dbPath;
}

describe("dramaticer work", () => {
	it("执行一轮指定类型的任务并打印统计", async () => {
		const dbPath = createTempDb();
		const executed: string[] = [];
		const logs: string[] = [];
		const createdClients: LlmChannelsConfig[] = [];
		const result = await runWorkCli(
			["work", "--db", dbPath, "--kind", "events"],
			{
				loadEnv: () => undefined,
				loadConfig: async () => createConfig(true),
				createClient: (config) => {
					createdClients.push(config);
					return fakeClient;
				},
				registry: createBackgroundJobRegistry({
					events: (context) => {
						executed.push(context.job.nodeId);
					},
				}),
				now: () => FIXED_NOW,
				log: (message) => {
					logs.push(message);
				},
			},
		);

		expect(result.stories).toBe(1);
		expect(result.enqueued).toBe(1);
		expect(result.runs).toEqual([
			{
				jobId: 1,
				nodeId: "n-a",
				kind: "events",
				status: "done",
				attempts: 1,
				error: null,
			},
		]);
		expect(executed).toEqual(["n-a"]);
		expect(createdClients).toHaveLength(1);
		expect(createdClients[0]?.models.has("background")).toBe(true);
		expect(
			logs.some(
				(line) => line.includes("新增任务 1 条") && line.includes("完成 1"),
			),
		).toBe(true);

		const store = StoryStore.open(dbPath);
		try {
			expect(
				store.listBackgroundJobs({ storyId: "s1", status: "done" }),
			).toHaveLength(1);
		} finally {
			store.close();
		}
	});

	it("不认识的类型、缺失的数据库与参数错误直接抛错", async () => {
		const dbPath = createTempDb();
		const base = {
			loadEnv: () => undefined,
			loadConfig: async () => createConfig(true),
			createClient: () => fakeClient,
			registry: createBackgroundJobRegistry({ events: () => undefined }),
			log: () => undefined,
		};

		await expect(
			runWorkCli(["work", "--db", dbPath, "--kind", "summary"], base),
		).rejects.toThrow("没有注册后台任务类型 summary");
		await expect(
			runWorkCli(
				["work", "--db", join(import.meta.dirname, "missing.db")],
				base,
			),
		).rejects.toThrow("数据库不存在");
		await expect(runWorkCli(["work"], base)).rejects.toThrow("--db");
		await expect(
			runWorkCli(["work", "--db", dbPath, "--limit", "0"], base),
		).rejects.toThrow("--limit");
		await expect(
			runWorkCli(["work", "--db", dbPath, "--unknown", "x"], base),
		).rejects.toThrow("不认识的参数");
	});

	it("默认注册表执行 embeddings 任务并写入向量", async () => {
		const dbPath = createTempDb();
		const embedder: EmbeddingClient = {
			dimensions: 1024,
			async embed(texts) {
				return texts.map(() => new Array<number>(1024).fill(0.5));
			},
		};
		const result = await runWorkCli(
			["work", "--db", dbPath, "--kind", "embeddings"],
			{
				loadEnv: () => undefined,
				loadConfig: async () => createConfig(true, true),
				createClient: () => fakeClient,
				createEmbedder: () => embedder,
				log: () => undefined,
			},
		);
		expect(result.runs).toHaveLength(1);
		expect(result.runs[0]?.kind).toBe("embeddings");
		expect(result.runs[0]?.status).toBe("done");

		const store = StoryStore.open(dbPath);
		try {
			const chunks = store.countChunksForNode("n-a");
			expect(chunks).toBeGreaterThan(0);
			expect(store.countChunkVectorsForNode("n-a")).toBe(chunks);
		} finally {
			store.close();
		}
	});

	it("默认注册表包含 npc_agenda：没有议程时任务完成且不调用模型", async () => {
		const dbPath = createTempDb();
		const result = await runWorkCli(
			["work", "--db", dbPath, "--kind", "npc_agenda"],
			{
				loadEnv: () => undefined,
				loadConfig: async () => createConfig(true),
				createClient: () => fakeClient,
				log: () => undefined,
			},
		);
		expect(result.runs.map((run) => run.kind)).toEqual(["npc_agenda"]);
		expect(result.runs[0]?.status).toBe("done");
		expect(result.runs[0]?.nodeId).toBe("n-a");
	});

	it("合并调用开关关闭时不建任务，打开后建任务并执行", async () => {
		const dbPath = createTempDb();
		const executed: string[] = [];
		const dependencies = {
			loadEnv: () => undefined,
			loadConfig: async () => createConfig(true),
			createClient: () => fakeClient,
			registry: createBackgroundJobRegistry({
				[GAP_PASS_JOB_KIND]: (context) => {
					executed.push(context.job.nodeId);
				},
			}),
			now: () => FIXED_NOW,
			log: () => undefined,
		};
		const disabled = await runWorkCli(["work", "--db", dbPath], dependencies);
		expect(disabled.enqueued).toBe(0);
		expect(disabled.runs).toEqual([]);
		expect(executed).toEqual([]);

		const store = StoryStore.open(dbPath);
		try {
			store.updateStorySettings("s1", { gapPassEnabled: true });
		} finally {
			store.close();
		}
		const enabled = await runWorkCli(["work", "--db", dbPath], dependencies);
		expect(enabled.enqueued).toBe(1);
		expect(enabled.runs.map((run) => `${run.nodeId}:${run.status}`)).toEqual([
			"n-a:done",
		]);
		expect(executed).toEqual(["n-a"]);
	});

	it("渠道配置里没有 background 模型时抛错", async () => {
		const dbPath = createTempDb();
		await expect(
			runWorkCli(["work", "--db", dbPath], {
				loadEnv: () => undefined,
				loadConfig: async () => createConfig(false),
				createClient: () => fakeClient,
				log: () => undefined,
			}),
		).rejects.toThrow("background 模型");
	});
});
