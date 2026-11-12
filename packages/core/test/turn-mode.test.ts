import { describe, expect, it } from "vitest";
import {
	type LlmResult,
	type LlmStreamingClient,
	type LlmToolCall,
	type StoryStore,
	createDefaultContextTemplate,
	createEventStream,
	createHistorySlotProvider,
	createStaticSlotProvider,
	runChatTurn,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const USAGE = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

const SEARCH: LlmToolCall = {
	id: "call-1",
	name: "state_get",
	arguments: {},
};

interface Round {
	readonly text: string;
	readonly toolCalls?: readonly LlmToolCall[];
	readonly attempts?: number;
}

function createScriptedClient(rounds: readonly Round[]): {
	client: LlmStreamingClient;
	requests: number[];
} {
	const requests: number[] = [];
	const client: LlmStreamingClient = {
		async complete() {
			throw new Error("本测试不使用 complete");
		},
		stream() {
			const round = rounds[requests.length];
			if (round === undefined) {
				throw new Error(`没有为第 ${requests.length + 1} 次请求准备回复`);
			}
			requests.push(requests.length + 1);
			const toolCalls = round.toolCalls ?? [];
			const result: LlmResult = {
				text: round.text,
				reasoning: "",
				toolCalls,
				finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
				stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
				model: "fake-model",
				channel: "fake-channel",
				usage: USAGE,
				raw: null,
				cached: false,
				attempts: round.attempts ?? 1,
				rounds: 1,
				truncation: null,
				continuation:
					round.text.length > 0 ? { text: round.text, reasoning: "" } : null,
			};
			return createEventStream(async (emit) => {
				for (const char of round.text) {
					emit({ type: "text_delta", delta: char });
				}
				return result;
			});
		},
	};
	return { client, requests };
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "模式测试" });
	store.appendNode({
		id: "n-greeting",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "井底的风还在吹。",
	});
}

function providers(store: StoryStore) {
	return {
		character: createStaticSlotProvider(
			[{ role: "system", content: "你扮演山神。" }],
			"card:山神",
		),
		history: createHistorySlotProvider(store, { limit: 10 }),
	};
}

describe("回合模式与读取工具软上限", () => {
	it("默认是快回合，软上限 3，Trace 记录模式与上限", async () => {
		const { store } = openTempStore();
		seedStory(store);
		expect(store.getStorySettings("s1")).toMatchObject({
			turnMode: "fast",
			maxReadRounds: 3,
		});
		const { client, requests } = createScriptedClient([
			{ text: "风停了。", toolCalls: [] },
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我抬头。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
		});

		expect(requests.length).toBe(1);
		expect(result.trace.turnMode).toBe("fast");
		expect(result.trace.tools).toEqual({
			transport: "native",
			rounds: 0,
			maxRounds: 3,
			capped: false,
			calls: [],
			rejected: [],
		});
	});

	it("故事设置锁定深回合时按深回合运行并记录上限", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.updateStorySettings("s1", { turnMode: "deep" });
		const { client, requests } = createScriptedClient([
			{ text: "井底有回声。" },
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我往下看。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
		});

		expect(requests.length).toBe(1);
		expect(result.trace.turnMode).toBe("deep");
		expect(result.trace.deep).toEqual({
			maxToolCalls: 40,
			maxDurationMs: 600_000,
			toolCallCount: 0,
			durationMs: expect.any(Number),
			stopReason: "completed",
		});
		expect(result.node.raw).toBe("井底有回声。");
	});

	it("单轮参数请求深回合时同样按深回合运行", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{ text: "风从井口下来。" },
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我往下看。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			turnMode: "deep",
		});

		expect(requests.length).toBe(1);
		expect(result.trace.turnMode).toBe("deep");
		expect(result.trace.deep?.stopReason).toBe("completed");
	});

	it("第 41 次工具调用被拒绝，运行正常收束并记录 max_tool_calls", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const calls = Array.from({ length: 41 }, (_, index) => ({
			...SEARCH,
			id: `call-${index + 1}`,
		}));
		const { client, requests } = createScriptedClient([
			{ text: "", toolCalls: calls },
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我把井底翻了个遍。",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
			turnMode: "deep",
		});

		expect(requests.length).toBe(1);
		expect(result.trace.turnMode).toBe("deep");
		expect(result.trace.deep).toMatchObject({
			maxToolCalls: 40,
			toolCallCount: 40,
			stopReason: "max_tool_calls",
		});
		expect(result.trace.tools.calls).toHaveLength(41);
		expect(result.trace.tools.calls.slice(0, 40)).toEqual(
			calls.slice(0, 40).map(() => ({
				name: "state_get",
				ok: true,
				error: null,
			})),
		);
		expect(result.trace.tools.calls[40]).toMatchObject({
			name: "state_get",
			ok: false,
			error: expect.stringContaining("工具调用次数已达上限"),
		});
	});

	it("假时钟越过时长上限后不再发出请求，记录 timeout", async () => {
		const { store } = openTempStore();
		seedStory(store);
		let clock = 0;
		const { client, requests } = createScriptedClient([
			{ text: "", toolCalls: [SEARCH] },
			{ text: "不该被调用。" },
		]);
		const withClock: LlmStreamingClient = {
			complete: () => client.complete(),
			stream: (request, options) => {
				const stream = client.stream(request, options);
				return {
					[Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
					result: async () => {
						const result = await stream.result();
						clock = 600_000;
						return result;
					},
				};
			},
		};

		const result = await runChatTurn({
			store,
			client: withClock,
			storyId: "s1",
			userText: "我等着。",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
			turnMode: "deep",
			now: () => clock,
		});

		expect(requests.length).toBe(1);
		expect(result.trace.deep).toMatchObject({
			maxDurationMs: 600_000,
			stopReason: "timeout",
			durationMs: 600_000,
		});
	});

	it("上限以内的工具调用不受限制", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const calls = Array.from({ length: 39 }, (_, index) => ({
			...SEARCH,
			id: `call-${index + 1}`,
		}));
		const { client, requests } = createScriptedClient([
			{ text: "", toolCalls: calls },
			{ text: "井底只有风声。" },
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我继续查。",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
			turnMode: "deep",
		});

		expect(requests.length).toBe(2);
		expect(result.trace.deep).toMatchObject({
			toolCallCount: 39,
			stopReason: "completed",
		});
		expect(result.node.raw).toBe("井底只有风声。");
	});

	it("深回合里的工具失败与重试不改变模式", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{
				text: "",
				toolCalls: [{ ...SEARCH, arguments: { path: 42 } }],
				attempts: 2,
			},
			{ text: "我揉了揉眼睛。" },
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我看井底。",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
			turnMode: "deep",
		});

		expect(requests.length).toBe(2);
		expect(result.trace.turnMode).toBe("deep");
		expect(result.trace.llm.attempts).toBe(3);
		expect(result.trace.deep?.stopReason).toBe("completed");
		expect(result.trace.tools.calls).toEqual([
			{
				name: "state_get",
				ok: false,
				error: expect.stringContaining("state_get.path"),
			},
		]);
	});

	it("单轮参数可以覆盖故事锁定的深回合，模式仍是玩家指定的值", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.updateStorySettings("s1", { turnMode: "deep" });
		const { client, requests } = createScriptedClient([
			{ text: "风从井口落下来。" },
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我往下看。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			turnMode: "fast",
		});

		expect(requests.length).toBe(1);
		expect(result.trace.turnMode).toBe("fast");
	});

	it("单轮参数可以收紧软上限，达到上限时收束并记录", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{ text: "", toolCalls: [SEARCH] },
			{ text: "井底什么也没有。", toolCalls: [SEARCH] },
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我听井底。",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
			maxReadRounds: 1,
		});

		expect(requests.length).toBe(2);
		expect(result.trace.turnMode).toBe("fast");
		expect(result.trace.tools).toEqual({
			transport: "native",
			rounds: 1,
			maxRounds: 1,
			capped: true,
			calls: [{ name: "state_get", ok: true, error: null }],
			rejected: [],
		});
	});

	it("软上限为 0 时一次工具也不执行，模式不变", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.updateStorySettings("s1", { maxReadRounds: 0 });
		const { client, requests } = createScriptedClient([
			{ text: "井底没有声音。", toolCalls: [SEARCH] },
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我听井底。",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
		});

		expect(requests.length).toBe(1);
		expect(result.trace.turnMode).toBe("fast");
		expect(result.trace.tools).toEqual({
			transport: "native",
			rounds: 0,
			maxRounds: 0,
			capped: true,
			calls: [],
			rejected: [],
		});
	});

	it("工具失败与模型重试都不改变模式", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{
				text: "",
				toolCalls: [{ ...SEARCH, arguments: { path: 42 } }],
				attempts: 2,
			},
			{ text: "我揉了揉眼睛。" },
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我看井底。",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
		});

		expect(requests.length).toBe(2);
		expect(result.trace.turnMode).toBe("fast");
		expect(result.trace.llm.attempts).toBe(3);
		expect(result.trace.tools.capped).toBe(false);
		expect(result.trace.tools.calls).toEqual([
			{
				name: "state_get",
				ok: false,
				error: expect.stringContaining("state_get.path"),
			},
		]);
	});

	it("故事设置变化不改变模式，只改变下一轮的软上限", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.updateStorySettings("s1", { budgetTokens: 5_000 });
		const { client } = createScriptedClient([{ text: "风还在吹。" }]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我站着。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
		});

		expect(result.trace.turnMode).toBe("fast");
		expect(result.trace.tools.maxRounds).toBe(3);
	});
});
