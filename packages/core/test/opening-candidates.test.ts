import { describe, expect, it } from "vitest";
import {
	type BackgroundDrainResult,
	type LlmChannelsConfig,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	OPENING_CANDIDATES_JOB_KIND,
	type StoryStore,
	createBackgroundJobRegistry,
	createOpeningCandidatesHandler,
	drainBackgroundJobs,
	generateOpeningCandidates,
	openingCandidatesNeedRun,
	parseOpeningCandidatesResponse,
	runOpeningCli,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_NOW = Date.UTC(2026, 10, 8, 12, 0, 0);

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
			if (reply === undefined) {
				throw new Error("假客户端没有更多回复");
			}
			return llmResult(reply);
		},
	};
	return { client, requests };
}

function batchJson(count: number, label = "候选"): string {
	return JSON.stringify({
		candidates: Array.from(
			{ length: count },
			(_, index) => `${label}${index + 1}：你推开门，看见凛站在窗边。`,
		),
	});
}

const registry = createBackgroundJobRegistry({
	[OPENING_CANDIDATES_JOB_KIND]: {
		handler: createOpeningCandidatesHandler(),
		enqueue: "story",
		needsRun: openingCandidatesNeedRun,
	},
});

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "开场候选" });
	store.updateStorySettings("s1", {
		cardName: "凛",
		characterPrompt: "凛是图书委员，性格冷淡。",
	});
	store.upsertEntity({
		storyId: "s1",
		kind: "character",
		name: "凛",
		description: "图书委员",
		source: "test",
	});
	store.insertLoreEntries([
		{
			storyId: "s1",
			name: "常驻设定",
			content: "学校在冬天仍然开放。",
			constant: true,
			source: "test-lore",
		},
	]);
}

function drain(
	store: StoryStore,
	client: LlmClient,
	maxAttempts?: number,
): Promise<BackgroundDrainResult> {
	return drainBackgroundJobs({
		store,
		registry,
		client,
		storyId: "s1",
		kinds: [OPENING_CANDIDATES_JOB_KIND],
		now: () => FIXED_NOW,
		maxAttempts,
	});
}

function createConfig(): LlmChannelsConfig {
	const channel = {
		id: "bg",
		api: "openai-completions" as const,
		baseUrl: "http://localhost:1234",
		apiKey: "",
		requestsPerMinute: 0,
		maxRetries: 0,
		retryBaseDelayMs: 0,
		timeoutMs: 1_000,
	};
	const model = {
		alias: "background",
		id: "fake-model",
		channels: ["bg"],
		contextWindow: 8_192,
		maxTokens: 1_024,
		reasoning: true,
		tools: null,
		probe: null,
	};
	return {
		channels: new Map([["bg", channel]]),
		models: new Map([["background", model]]),
		roles: new Map(),
		embeddings: new Map(),
	};
}

describe("开场候选解析", () => {
	it("接受代码块包裹的整批候选", () => {
		const parsed = parseOpeningCandidatesResponse(
			`\`\`\`json\n${batchJson(3)}\n\`\`\``,
			3,
		);
		expect(parsed).toHaveLength(3);
		expect(parsed[0]).toBe("候选1：你推开门，看见凛站在窗边。");
	});

	it("条数不符、空正文、未知字段与非对象整批拒绝", () => {
		expect(() => parseOpeningCandidatesResponse(batchJson(2), 3)).toThrow(
			"必须是 3 条",
		);
		expect(() =>
			parseOpeningCandidatesResponse('{"candidates":["有正文","   "]}', 2),
		).toThrow("candidates[1]");
		expect(() =>
			parseOpeningCandidatesResponse('{"candidates":["甲","乙"],"extra":1}', 2),
		).toThrow("未知字段");
		expect(() => parseOpeningCandidatesResponse('["甲","乙"]', 2)).toThrow(
			"必须是 JSON 对象",
		);
	});

	it("候选条数只允许 2 或 3", () => {
		expect(() => parseOpeningCandidatesResponse(batchJson(1), 1)).toThrow(
			"2 到 3",
		);
		expect(() => parseOpeningCandidatesResponse(batchJson(4), 4)).toThrow(
			"2 到 3",
		);
	});
});

describe("开场候选任务", () => {
	it("生成 3 条候选但不产生楼层", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([batchJson(3)]);

		expect(openingCandidatesNeedRun(store, "s1")).toBe(true);
		const result = await drain(store, client);
		expect(requests).toHaveLength(1);
		expect(result.enqueued).toBe(1);
		expect(result.runs).toEqual([
			{
				jobId: 1,
				nodeId: null,
				kind: OPENING_CANDIDATES_JOB_KIND,
				status: "done",
				attempts: 1,
				error: null,
			},
		]);

		const candidates = store.listOpeningCandidates("s1");
		expect(candidates).toHaveLength(3);
		expect(candidates.map((item) => item.ordinal)).toEqual([0, 1, 2]);
		expect(candidates.every((item) => item.status === "pending")).toBe(true);
		expect(store.getHead("s1")).toBeNull();
		expect(store.getPathToHead("s1")).toEqual([]);
		expect(openingCandidatesNeedRun(store, "s1")).toBe(false);
	});

	it("已有待选候选时补建任务不再调用模型", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([batchJson(3)]);
		await drain(store, client);
		const second = await drain(store, client);
		expect(requests).toHaveLength(1);
		expect(second.enqueued).toBe(0);
		expect(second.runs).toEqual([]);
		expect(store.listOpeningCandidates("s1")).toHaveLength(3);
	});

	it("手动入队的任务在已有待选候选时追加新一批", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([
			batchJson(3, "第一批"),
			batchJson(3, "第二批"),
		]);
		await drain(store, client);
		const [job] = store.enqueueStoryBackgroundJobs({
			storyId: "s1",
			kinds: [OPENING_CANDIDATES_JOB_KIND],
		});
		expect(job?.status).toBe("pending");

		await drain(store, client);
		expect(requests).toHaveLength(2);
		const candidates = store.listOpeningCandidates("s1");
		expect(candidates).toHaveLength(6);
		expect(candidates.map((item) => item.ordinal)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(candidates.every((item) => item.status === "pending")).toBe(true);
		expect(candidates[3]?.raw).toContain("第二批");
	});

	it("非法输出整批拒绝并保留原因", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([
			JSON.stringify({ candidates: ["只有一条"] }),
		]);
		const result = await drain(store, client, 1);
		expect(result.runs[0]?.status).toBe("failed");
		expect(result.runs[0]?.error).toContain("必须是 3 条");
		expect(store.listOpeningCandidates("s1")).toEqual([]);
	});

	it("故事已经有楼层时不生成候选", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendNode({
			storyId: "s1",
			parentId: null,
			role: "user",
			raw: "我先开口。",
		});
		expect(openingCandidatesNeedRun(store, "s1")).toBe(false);
		const { client, requests } = createFakeClient([]);
		const result = await drain(store, client);
		expect(requests).toEqual([]);
		expect(result.enqueued).toBe(0);
		expect(store.listOpeningCandidates("s1")).toEqual([]);
	});
});

describe("选中开场候选", () => {
	it("选中一条成为根部首个助手楼层，其余改为丢弃", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([batchJson(3)]);
		await drain(store, client);
		const [first, second, third] = store.listOpeningCandidates("s1");

		const picked = store.chooseOpeningCandidate(second?.id as string, {
			chosenAt: new Date(FIXED_NOW).toISOString(),
		});
		expect(picked.node.role).toBe("assistant");
		expect(picked.node.parentId).toBeNull();
		expect(picked.node.raw).toBe(second?.raw);
		expect(store.getHead("s1")?.id).toBe(picked.node.id);
		expect(store.getPathToHead("s1").map((node) => node.raw)).toEqual([
			second?.raw,
		]);
		expect(store.getOpeningCandidate(second?.id as string)?.status).toBe(
			"chosen",
		);
		expect(store.getOpeningCandidate(first?.id as string)?.status).toBe(
			"discarded",
		);
		expect(store.getOpeningCandidate(third?.id as string)?.status).toBe(
			"discarded",
		);
		expect(() => store.chooseOpeningCandidate(first?.id as string)).toThrow(
			"只有 pending 可以选中",
		);
	});

	it("重新生成追加新一批且旧批状态不变", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([batchJson(3), batchJson(2, "新批")]);
		await drain(store, client);
		await generateOpeningCandidates({
			store,
			client,
			storyId: "s1",
			count: 2,
			createdAt: new Date(FIXED_NOW + 1_000).toISOString(),
		});

		const candidates = store.listOpeningCandidates("s1");
		expect(candidates).toHaveLength(5);
		expect(candidates.map((item) => item.ordinal)).toEqual([0, 1, 2, 3, 4]);
		expect(candidates.map((item) => item.status)).toEqual([
			"pending",
			"pending",
			"pending",
			"pending",
			"pending",
		]);
		expect(candidates[3]?.raw).toContain("新批1");

		const picked = store.chooseOpeningCandidate(candidates[3]?.id as string);
		expect(store.listOpeningCandidates("s1", { status: "chosen" })).toEqual([
			picked.candidate,
		]);
		expect(store.listOpeningCandidates("s1", { status: "pending" })).toEqual(
			[],
		);
		expect(
			store.listOpeningCandidates("s1", { status: "discarded" }),
		).toHaveLength(4);
	});

	it("选中之后按普通助手楼层参与结算入队", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([batchJson(3)]);
		await drain(store, client);
		const candidate = store.listOpeningCandidates("s1")[0];
		const picked = store.chooseOpeningCandidate(candidate?.id as string);
		const jobs = store.enqueueMissingBackgroundJobs({
			storyId: "s1",
			kinds: ["settle"],
			conditions: { settle: "settled" },
		});
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.nodeId).toBe(picked.node.id);
	});

	it("已有楼层时拒绝选中", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([batchJson(3)]);
		await drain(store, client);
		const candidate = store.listOpeningCandidates("s1")[0];
		store.appendNode({
			storyId: "s1",
			parentId: null,
			role: "user",
			raw: "我先开口。",
		});
		expect(() => store.chooseOpeningCandidate(candidate?.id as string)).toThrow(
			"已经有楼层",
		);
		expect(store.getOpeningCandidate(candidate?.id as string)?.status).toBe(
			"pending",
		);
	});

	it("空正文不进存储", () => {
		const { store } = openTempStore();
		seedStory(store);
		expect(() =>
			store.appendOpeningCandidates({ storyId: "s1", raws: ["   "] }),
		).toThrow("必须是非空字符串");
		expect(store.listOpeningCandidates("s1")).toEqual([]);
	});
});

describe("dramaticer open", () => {
	it("生成、列出与选中", async () => {
		const { store, path } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([batchJson(2)]);
		const logs: string[] = [];
		const dependencies = {
			loadEnv: () => undefined,
			loadConfig: async () => createConfig(),
			createClient: () => client,
			now: () => FIXED_NOW,
			log: (message: string) => {
				logs.push(message);
			},
		};

		const generated = await runOpeningCli(
			["open", "--story", "s1", "--db", path, "--generate", "2"],
			dependencies,
		);
		expect(generated.action).toBe("generate");
		expect(generated.candidates).toHaveLength(2);
		expect(generated.node).toBeNull();
		expect(requests).toHaveLength(1);
		expect(logs[0]).toBe("开场候选 2 条：");

		const listed = await runOpeningCli(
			["open", "--story", "s1", "--db", path],
			dependencies,
		);
		expect(listed.action).toBe("list");
		expect(listed.candidates).toHaveLength(2);

		const picked = await runOpeningCli(
			[
				"open",
				"--story",
				"s1",
				"--db",
				path,
				"--pick",
				listed.candidates[1]?.id as string,
			],
			dependencies,
		);
		expect(picked.action).toBe("pick");
		expect(picked.node?.role).toBe("assistant");
		expect(picked.node?.raw).toBe(listed.candidates[1]?.raw);
		expect(store.getPathToHead("s1")).toHaveLength(1);
	});

	it("参数错误直接失败", async () => {
		const { store, path } = openTempStore();
		seedStory(store);
		await expect(runOpeningCli(["open", "--db", path], {})).rejects.toThrow(
			"--story",
		);
		await expect(
			runOpeningCli(
				["open", "--story", "s1", "--db", path, "--generate", "4"],
				{},
			),
		).rejects.toThrow("2 到 3");
		await expect(
			runOpeningCli(
				["open", "--story", "s1", "--db", path, "--list", "--generate", "2"],
				{},
			),
		).rejects.toThrow("只能选一个");
	});
});
