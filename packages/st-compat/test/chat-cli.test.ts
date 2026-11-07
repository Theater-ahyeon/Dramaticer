import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type LlmChannelsConfig,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	StoryStore,
	createEventStream,
} from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { parseCharacterCardFile } from "../src/character-card.js";
import { renderCharacterPrompt } from "../src/chat/character.js";
import { type ChatCliDependencies, runChatCli } from "../src/chat/cli.js";

const cardPath = join(import.meta.dirname, "fixtures", "chat-card.json");
const REPLY = `山门在你面前缓缓打开。
<state_update>{"path":["场景","地点"],"op":"set","value":"山门"}</state_update>`;

function createTempDb(): string {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-chat-cli-")),
		"story.db",
	);
	onTestFinished(() => {
		rmSync(dirname(path), { recursive: true, force: true, maxRetries: 5 });
	});
	return path;
}

function createConfig(): LlmChannelsConfig {
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
	return {
		channels: new Map([
			["main", channel("main")],
			["bg", channel("bg")],
		]),
		models: new Map([
			["main", model("main")],
			["background", model("background")],
		]),
		embeddings: new Map(),
	};
}

interface FakeChatClient {
	readonly client: LlmStreamingClient;
	readonly requests: LlmRequest[];
}

function createFakeClient(): FakeChatClient {
	const requests: LlmRequest[] = [];
	const result: LlmResult = {
		text: REPLY,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake",
		usage: {
			promptTokens: 5,
			completionTokens: 6,
			totalTokens: 11,
			reasoningTokens: 0,
			cachedTokens: 0,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: { text: REPLY, reasoning: "" },
	};
	return {
		requests,
		client: {
			async complete() {
				return result;
			},
			stream(request) {
				requests.push(request);
				return createEventStream(async (emit) => {
					for (const char of REPLY) {
						emit({ type: "text_delta", delta: char });
					}
					return result;
				});
			},
		},
	};
}

function dependencies(
	fake: FakeChatClient,
	logs: string[],
	output: string[],
): ChatCliDependencies {
	return {
		loadEnv: () => undefined,
		loadConfig: async () => createConfig(),
		createClient: () => fake.client,
		log: (message) => {
			logs.push(message);
		},
		write: (text) => {
			output.push(text);
		},
	};
}

describe("dramaticer chat", () => {
	it("首次运行导入角色卡、生成一层并把 Trace 写进数据库", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();
		const logs: string[] = [];
		const output: string[] = [];
		const result = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
				"--model",
				"main",
			],
			dependencies(fake, logs, output),
		);

		expect(fake.requests).toHaveLength(1);
		expect(fake.requests[0]?.tools).toBeUndefined();
		expect(output.join("")).toBe(`${REPLY}\n`);
		expect(logs).toContain("已创建故事 s1");
		expect(logs.some((line) => line.includes("状态变更 1 条"))).toBe(true);
		expect(result.stateDiffs).toHaveLength(1);
		expect(result.trace.structured.mode).toBe("text-tags");

		const store = StoryStore.open(dbPath);
		try {
			const story = store.getStory("s1");
			expect(story?.title).toBe("山神");
			const nodes = store.getPathToNode(result.node.id);
			expect(nodes.map((node) => node.role)).toEqual([
				"assistant",
				"user",
				"assistant",
			]);
			expect(nodes[0]?.raw).toBe("山门为你打开。");
			expect(nodes[1]?.raw).toBe("我推开山门。");
			expect(nodes[2]?.raw).toBe(REPLY);
			const trace = store.getTurnTrace(nodes[2]?.id ?? "");
			expect(trace?.context.entries.map((entry) => entry.segmentId)).toEqual([
				"character",
				"lore",
				"state",
				"summary",
				"memory",
				"director",
				"protocol",
				"history",
			]);
			expect(trace?.structured.acceptedStateUpdates).toBe(1);
			const entity = store.findEntityByName("s1", "山神");
			expect(entity?.kind).toBe("character");
			expect(entity?.aliases).toEqual(["山神"]);
		} finally {
			store.close();
		}
	});

	it("第二次运行接在已有楼层后面，并在上下文里带上状态", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();
		const first = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
			],
			dependencies(fake, [], []),
		);
		const second = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我往里走。",
				"--db",
				dbPath,
			],
			dependencies(fake, [], []),
		);

		expect(second.userNode.parentId).toBe(first.node.id);
		const store = StoryStore.open(dbPath);
		try {
			const nodes = store.getPathToNode(second.node.id);
			expect(nodes).toHaveLength(5);
			expect(nodes.map((node) => node.raw)).toEqual([
				"山门为你打开。",
				"我推开山门。",
				REPLY,
				"我往里走。",
				REPLY,
			]);
			const trace = store.getTurnTrace(second.node.id);
			const stateEntry = trace?.context.entries.find(
				(entry) => entry.segmentId === "state",
			);
			expect(stateEntry?.status).toBe("included");
			expect(stateEntry?.source).toBe("state:1 条 diff");
		} finally {
			store.close();
		}
	});

	it("对话轮次只创建正文客户端，不触碰后台模型", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();
		const aliases: string[] = [];
		await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
			],
			{
				...dependencies(fake, [], []),
				createClient: (_config, alias) => {
					aliases.push(alias);
					return fake.client;
				},
			},
		);

		expect(aliases).toEqual(["main"]);
		expect(fake.requests).toHaveLength(1);
	});

	it("参数错误给出用法", async () => {
		const fake = createFakeClient();
		const deps = dependencies(fake, [], []);
		await expect(runChatCli(["chat", "--story", "s1"], deps)).rejects.toThrow(
			"--card",
		);
		await expect(
			runChatCli(
				["chat", "--story", "s1", "--card", cardPath, "--user", "你好", "--db"],
				deps,
			),
		).rejects.toThrow("--db");
		await expect(
			runChatCli(
				[
					"chat",
					"--story",
					"s1",
					"--card",
					cardPath,
					"--user",
					"你好",
					"--budget",
					"-1",
				],
				deps,
			),
		).rejects.toThrow("--budget");
		await expect(
			runChatCli(
				[
					"chat",
					"--story",
					"s1",
					"--card",
					cardPath,
					"--user",
					"你好",
					"--unknown",
					"x",
				],
				deps,
			),
		).rejects.toThrow("不认识的参数");
	});
});

describe("renderCharacterPrompt", () => {
	it("只拼接非空的角色卡字段", async () => {
		const card = await parseCharacterCardFile(cardPath);
		const prompt = renderCharacterPrompt(card);
		expect(prompt).toContain("你扮演的角色：山神");
		expect(prompt).toContain("守护山门的神灵。");
		expect(prompt).toContain("寡言，重视承诺。");
		expect(prompt).not.toContain("对话示例");
		expect(prompt).not.toContain("系统提示");
	});
});
