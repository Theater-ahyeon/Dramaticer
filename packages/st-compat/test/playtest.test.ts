import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type LlmChannelsConfig,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	StoryStore,
	createBackgroundJobRegistry,
	createDefaultContextTemplate,
	createEventStream,
	createNaiveContextTemplate,
	createStandardChatSlots,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import { runPlaytestCli } from "../src/evalset/playtest-cli.js";
import {
	type PlaytestOptions,
	type PlaytestRecord,
	parsePlaytestJsonl,
	parseUserMessage,
	runPlaytest,
	serializePlaytestRecord,
} from "../src/evalset/playtest.js";
import { parseTurnJudgeOutput } from "../src/evalset/turn-judge.js";

const STORY_ID = "playtest-story";
const CARD_PROMPT = "你扮演山神，用冷静的旁观者口吻叙述。";
const REPLY = `山门在你面前缓缓打开。
<state_update>{"path":["clue","c1","text"],"op":"set","value":"门后的脚步声"}</state_update>`;

const USAGE: LlmUsage = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

const createdDirs: string[] = [];

afterEach(() => {
	for (const dir of createdDirs.splice(0)) {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
});

function makeDir(): string {
	const dir = mkdtempSync(path.join(import.meta.dirname, ".tmp-playtest-"));
	createdDirs.push(dir);
	return dir;
}

function makeResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake",
		usage: USAGE,
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: text.length === 0 ? null : { text, reasoning: "" },
	};
}

interface RecordedWriter {
	readonly client: LlmStreamingClient;
	readonly requests: LlmRequest[];
}

function createWriter(text = REPLY): RecordedWriter {
	const requests: LlmRequest[] = [];
	const result = makeResult(text);
	return {
		requests,
		client: {
			async complete() {
				return result;
			},
			stream(request) {
				requests.push(request);
				return createEventStream(async (emit) => {
					for (const char of text) {
						emit({ type: "text_delta", delta: char });
					}
					return result;
				});
			},
		},
	};
}

interface RecordedUser {
	readonly client: LlmStreamingClient;
	readonly requests: LlmRequest[];
}

function createUser(
	messages: readonly string[] | ((call: number) => string),
): RecordedUser {
	const requests: LlmRequest[] = [];
	let call = 0;
	const next = (): string => {
		call += 1;
		return typeof messages === "function"
			? messages(call)
			: (messages[call - 1] ?? "{}");
	};
	return {
		requests,
		client: {
			async complete(request) {
				requests.push(request);
				return makeResult(next());
			},
			stream(request) {
				requests.push(request);
				const text = next();
				return createEventStream(async (emit) => {
					emit({ type: "text_delta", delta: text });
					return makeResult(text);
				});
			},
		},
	};
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: STORY_ID, title: "试玩测试" });
	store.updateStorySettings(STORY_ID, {
		characterPrompt: CARD_PROMPT,
		persona: "你是刚踏入山门的剑客。",
	});
	store.appendNode({
		id: `${STORY_ID}-greeting`,
		storyId: STORY_ID,
		parentId: null,
		role: "assistant",
		raw: "山门的铜环在风里轻响。",
	});
}

async function playtestOptions(
	store: StoryStore,
	overrides: Partial<PlaytestOptions> = {},
): Promise<PlaytestOptions> {
	const writer = createWriter();
	const user = createUser((round) =>
		JSON.stringify({ message: `第 ${round} 轮：我环视四周。` }),
	);
	return {
		store,
		storyId: STORY_ID,
		rounds: 5,
		profile: "native",
		seed: 7,
		assistant: { client: writer.client, model: "main" },
		user: { client: user.client, model: "background" },
		turn: {
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: (
				await createStandardChatSlots({
					store,
					characterPrompt: CARD_PROMPT,
					directorConfig: DEFAULT_DIRECTOR_CONFIG,
				})
			).providers,
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			toolTransport: "native",
			maxTokens: 512,
			temperature: 0.8,
			reasoning: "low",
		},
		onRecord: () => undefined,
		...overrides,
	};
}

function openStore(dir: string): StoryStore {
	const store = StoryStore.open(path.join(dir, "story.db"));
	seedStory(store);
	return store;
}

describe("自动试玩", () => {
	it("假客户端下 5 轮跑通，记录字段齐全", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const writer = createWriter();
		const user = createUser((round) =>
			JSON.stringify({ message: `第 ${round} 轮：我环视四周。` }),
		);
		const records: PlaytestRecord[] = [];
		const options = await playtestOptions(store, {
			assistant: { client: writer.client, model: "main" },
			user: { client: user.client, model: "background" },
			onRecord: (record) => {
				records.push(record);
			},
		});
		const result = await runPlaytest(options);

		expect(writer.requests).toHaveLength(5);
		expect(user.requests).toHaveLength(5);
		expect(result.failures).toBe(0);
		expect(result.lastRound).toBe(5);
		expect(records).toHaveLength(5);
		for (const [index, record] of records.entries()) {
			expect(record.status).toBe("done");
			if (record.status !== "done") throw new Error("轮次失败");
			expect(record.round).toBe(index + 1);
			expect(record.profile).toBe("native");
			expect(record.seed).toBe(7);
			expect(record.user).toBe(`第 ${index + 1} 轮：我环视四周。`);
			expect(record.assistant).toBe(REPLY);
			expect(record.userNodeId).not.toBe(record.nodeId);
			expect(record.traceNodeId).toBe(record.nodeId);
			expect(record.ledgerDiffCount).toBe(1);
			expect(record.newClues).toBe(1);
			expect(record.fulfilledClues).toBe(0);
			expect(record.usage.totalTokens).toBe(30);
			expect(record.truncated).toBe(false);
			expect(record.director).not.toBeNull();
			expect(record.trace.model).toBe("fake-model");
			expect(record.trace.profile).toBe("native");
			expect(record.trace.tools.transport).toBe("native");
			expect(record.trace.segments.length).toBeGreaterThan(0);
			expect(record.operations).toEqual([]);
			expect(record.gapWork.unfinishedRatio).toBe(0);
			expect(record.drain).toBeNull();
			expect(record.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		}
		const headPath = store.getPathToHead(STORY_ID);
		expect(headPath.map((node) => node.role)).toEqual([
			"assistant",
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
			"assistant",
		]);
		const jsonl = records.map(serializePlaytestRecord).join("");
		const parsed = parsePlaytestJsonl(jsonl);
		expect(parsed).toHaveLength(5);
		store.close();
	}, 30_000);

	it("模拟用户非法 JSON 重试 3 次后终止", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const writer = createWriter();
		const user = createUser(() => "这不是 JSON");
		const options = await playtestOptions(store, {
			rounds: 1,
			assistant: { client: writer.client, model: "main" },
			user: { client: user.client, model: "background" },
		});
		await expect(runPlaytest(options)).rejects.toThrow("连续 3 次");
		expect(user.requests).toHaveLength(3);
		expect(writer.requests).toHaveLength(0);
		store.close();
	});

	it("模拟用户前两次非法、第三次合法时继续", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const writer = createWriter();
		const user = createUser((call) =>
			call < 3 ? "still not json" : JSON.stringify({ message: "我推门进去。" }),
		);
		const records: PlaytestRecord[] = [];
		const options = await playtestOptions(store, {
			rounds: 1,
			assistant: { client: writer.client, model: "main" },
			user: { client: user.client, model: "background" },
			onRecord: (record) => {
				records.push(record);
			},
		});
		const result = await runPlaytest(options);
		expect(user.requests).toHaveLength(3);
		expect(writer.requests).toHaveLength(1);
		expect(result.records).toHaveLength(1);
		expect(records[0]?.user).toBe("我推门进去。");
		expect(user.requests[0]?.maxTokens).toBeUndefined();
		expect(user.requests[1]?.messages.at(-1)?.content).toContain(
			"still not json",
		);
		expect(user.requests[1]?.messages.at(-1)?.content).toContain("第 2 次尝试");
		expect(user.requests[2]?.messages.at(-1)?.content).not.toBe(
			user.requests[1]?.messages.at(-1)?.content,
		);
		store.close();
	});

	it("严格解析模拟用户输出", () => {
		expect(parseUserMessage('{"message":"走吧。"}')).toBe("走吧。");
		expect(parseUserMessage('  {"message":"走吧。"}  ')).toBe("走吧。");
		expect(parseUserMessage('{"message":"走吧。","extra":1}')).toBeNull();
		expect(parseUserMessage('{"text":"走吧。"}')).toBeNull();
		expect(parseUserMessage("[]")).toBeNull();
		expect(parseUserMessage('```json\n{"message":"走吧。"}\n```')).toBeNull();
		expect(parseUserMessage('{"message":"  "}')).toBeNull();
	});

	it("按轮次执行 swipe、编辑与分支切换", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const writer = createWriter();
		const user = createUser((round) =>
			JSON.stringify({ message: `第 ${round} 轮：我向前走。` }),
		);
		const records: PlaytestRecord[] = [];
		const options = await playtestOptions(store, {
			rounds: 4,
			assistant: { client: writer.client, model: "main" },
			user: { client: user.client, model: "background" },
			operations: { swipeAt: [2], editAt: [3], branchAt: [4] },
			onRecord: (record) => {
				records.push(record);
			},
		});
		await runPlaytest(options);
		expect(writer.requests).toHaveLength(6);
		const second = records[1];
		const third = records[2];
		const fourth = records[3];
		if (
			second?.status !== "done" ||
			third?.status !== "done" ||
			fourth?.status !== "done"
		) {
			throw new Error("轮次失败");
		}
		expect(second.operations.map((operation) => operation.kind)).toEqual([
			"swipe",
		]);
		expect(third.operations.map((operation) => operation.kind)).toEqual([
			"edit",
		]);
		expect(fourth.operations.map((operation) => operation.kind)).toEqual([
			"branch",
		]);
		expect(second.traceNodeId).toBe(second.nodeId);
		expect(third.user).toContain("（我想补充一句。）");
		expect(fourth.nodeId).not.toBe(fourth.traceNodeId);
		const swipeFrom = second.operations[0]?.fromNodeId;
		expect(
			swipeFrom === undefined ? null : store.getNode(swipeFrom),
		).not.toBeNull();
		store.close();
	}, 30_000);

	it("朴素档位不带工具、不写台账、不跑后台任务", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const writer = createWriter();
		const user = createUser(() => JSON.stringify({ message: "我继续走。" }));
		const records: PlaytestRecord[] = [];
		const base = await playtestOptions(store);
		const naiveProviders = {
			character: base.turn.providers.character,
			persona: base.turn.providers.persona,
			history: base.turn.providers.history,
		};
		const options = await playtestOptions(store, {
			rounds: 2,
			profile: "naive",
			assistant: { client: writer.client, model: "main" },
			user: { client: user.client, model: "background" },
			background: {
				client: user.client,
				registry: createBackgroundJobRegistry({}),
			},
			turn: {
				...base.turn,
				template: createNaiveContextTemplate(),
				providers: naiveProviders,
			},
			onRecord: (record) => {
				records.push(record);
			},
		});
		await runPlaytest(options);
		expect(writer.requests[0]?.tools).toBeUndefined();
		for (const record of records) {
			if (record.status !== "done") throw new Error("轮次失败");
			expect(record.ledgerDiffCount).toBe(0);
			expect(record.newClues).toBe(0);
			expect(record.drain).toBeNull();
			expect(record.trace.tools.calls).toEqual([]);
			expect(record.trace.segments.map((entry) => entry.segmentId)).toContain(
				"character",
			);
			expect(
				record.trace.segments.some((entry) =>
					["state", "memory", "director"].includes(entry.segmentId),
				),
			).toBe(false);
		}
		store.close();
	}, 30_000);

	it("每轮裁判记录重 roll 与指令遵循，且不改 head", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const writer = createWriter();
		const user = createUser((round) =>
			JSON.stringify({ message: `第 ${round} 轮：我环视四周。` }),
		);
		const judge = createUser((round) =>
			JSON.stringify({
				reroll: round === 2,
				followed: round !== 2,
				reason: `第 ${round} 轮理由`,
			}),
		);
		const records: PlaytestRecord[] = [];
		const options = await playtestOptions(store, {
			rounds: 2,
			assistant: { client: writer.client, model: "main" },
			user: { client: user.client, model: "background" },
			turnJudge: { client: judge.client, model: "judge" },
			onRecord: (record) => {
				records.push(record);
			},
		});
		const headBefore = store.getHead(STORY_ID);
		await runPlaytest(options);
		const first = records[0];
		const second = records[1];
		if (first?.status !== "done" || second?.status !== "done") {
			throw new Error("轮次失败");
		}
		expect(first.verdict).toMatchObject({
			status: "done",
			reroll: false,
			followed: true,
			reason: "第 1 轮理由",
			attempts: 1,
		});
		expect(second.verdict).toMatchObject({
			status: "done",
			reroll: true,
			followed: false,
			reason: "第 2 轮理由",
		});
		expect(judge.requests).toHaveLength(2);
		expect(headBefore).not.toBeNull();
		expect(store.getHead(STORY_ID)?.id).toBe(second.nodeId);
		store.close();
	}, 30_000);

	it("裁判连续非法时记录失败但试玩继续", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const writer = createWriter();
		const user = createUser(() => JSON.stringify({ message: "我继续走。" }));
		const judge = createUser(() => "不是 JSON");
		const records: PlaytestRecord[] = [];
		const options = await playtestOptions(store, {
			rounds: 2,
			assistant: { client: writer.client, model: "main" },
			user: { client: user.client, model: "background" },
			turnJudge: { client: judge.client, model: "judge" },
			onRecord: (record) => {
				records.push(record);
			},
		});
		const result = await runPlaytest(options);
		expect(result.failures).toBe(0);
		expect(records).toHaveLength(2);
		for (const record of records) {
			if (record.status !== "done") throw new Error("轮次失败");
			expect(record.verdict).toMatchObject({
				status: "failed",
				attempts: 3,
				reroll: null,
				followed: null,
			});
		}
		expect(judge.requests).toHaveLength(6);
		store.close();
	}, 30_000);

	it("严格解析每轮裁判输出", () => {
		expect(
			parseTurnJudgeOutput(
				'{"reroll":true,"followed":false,"reason":"没听指令"}',
			),
		).toEqual({ reroll: true, followed: false, reason: "没听指令" });
		expect(
			parseTurnJudgeOutput('{"reroll":false,"followed":true,"reason":"好"}'),
		).toEqual({ reroll: false, followed: true, reason: "好" });
		expect(
			parseTurnJudgeOutput(
				'{"reroll":false,"followed":true,"reason":"好","extra":1}',
			),
		).toBeNull();
		expect(
			parseTurnJudgeOutput('{"reroll":"no","followed":true,"reason":"好"}'),
		).toBeNull();
		expect(
			parseTurnJudgeOutput('{"reroll":false,"followed":true,"reason":""}'),
		).toBeNull();
		expect(parseTurnJudgeOutput("[]")).toBeNull();
	});

	it("CLI 续跑不重复轮次，不带 --resume 时重写记录", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		store.close();
		const dbPath = path.join(dir, "story.db");
		const outPath = path.join(dir, "playtest.jsonl");
		const writer = createWriter();
		const user = createUser((round) =>
			JSON.stringify({ message: `第 ${round} 轮：我观察四周。` }),
		);
		const config = fakeConfig();
		const dependencies = {
			loadEnv: () => undefined,
			loadConfig: async () => config,
			createClient: (_config: LlmChannelsConfig, alias: string) =>
				alias === "background" ? user.client : writer.client,
			registry: createBackgroundJobRegistry({}),
			log: () => undefined,
		};
		const baseArgs = [
			"--db",
			dbPath,
			"--story",
			STORY_ID,
			"--model",
			"main",
			"--out",
			outPath,
		];
		await runPlaytestCli([...baseArgs, "--rounds", "2"], dependencies);
		expect(readLines(outPath)).toHaveLength(2);
		expect(writer.requests).toHaveLength(2);

		await runPlaytestCli(
			[...baseArgs, "--rounds", "4", "--resume"],
			dependencies,
		);
		expect(writer.requests).toHaveLength(4);
		expect(user.requests).toHaveLength(4);
		const resumed = parsePlaytestJsonl(readFileSync(outPath, "utf8"));
		expect(resumed.map((record) => record.round)).toEqual([1, 2, 3, 4]);

		await runPlaytestCli([...baseArgs, "--rounds", "1"], dependencies);
		expect(writer.requests).toHaveLength(5);
		expect(readLines(outPath)).toHaveLength(1);
	}, 30_000);
});

function readLines(filePath: string): string[] {
	return readFileSync(filePath, "utf8")
		.split(/\r?\n/)
		.filter((line) => line.length > 0);
}

function fakeConfig(): LlmChannelsConfig {
	const channel = (id: string) => ({
		id,
		api: "openai-completions" as const,
		baseUrl: "http://127.0.0.1:1234",
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
		enabled: true,
		tools: null,
		probe: null,
	});
	return {
		channels: new Map([
			["main", channel("main")],
			["background", channel("background")],
		]),
		models: new Map([
			["main", model("main")],
			["background", model("background")],
		]),
		roles: new Map(),
		embeddings: new Map(),
	};
}
