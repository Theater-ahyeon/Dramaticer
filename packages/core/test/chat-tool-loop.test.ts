import { describe, expect, it } from "vitest";
import {
	type LlmCallOptions,
	type LlmRequest,
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

interface Round {
	readonly text: string;
	readonly toolCalls?: readonly LlmToolCall[];
}

function resultOf(round: Round): LlmResult {
	return {
		text: round.text,
		reasoning: "",
		toolCalls: round.toolCalls ?? [],
		finishReason: (round.toolCalls ?? []).length > 0 ? "tool_calls" : "stop",
		stopReason: (round.toolCalls ?? []).length > 0 ? "toolUse" : "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: USAGE,
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation:
			round.text.length > 0 ? { text: round.text, reasoning: "" } : null,
	};
}

function createScriptedClient(
	rounds: readonly Round[],
	onRound?: (round: Round, controller: AbortController) => void,
): {
	client: LlmStreamingClient;
	requests: LlmRequest[];
	options: (LlmCallOptions | undefined)[];
	controller: AbortController;
} {
	const requests: LlmRequest[] = [];
	const callOptions: (LlmCallOptions | undefined)[] = [];
	const controller = new AbortController();
	const client: LlmStreamingClient = {
		async complete() {
			throw new Error("本测试不使用 complete");
		},
		stream(request, callOption) {
			const index = requests.length;
			const round = rounds[index];
			if (round === undefined) {
				throw new Error(`没有为第 ${index + 1} 次请求准备回复`);
			}
			requests.push(request);
			callOptions.push(callOption);
			return createEventStream(async (emit) => {
				const result = resultOf(round);
				for (const char of round.text) {
					emit({ type: "text_delta", delta: char });
				}
				onRound?.(round, controller);
				return result;
			});
		},
	};
	return { client, requests, options: callOptions, controller };
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "工具往返" });
	store.appendNode({
		id: "n-greeting",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "井底的青铜匕首还在。",
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

const template = () =>
	createDefaultContextTemplate({ structuredOutput: "function-call" });

describe("单轮执行器的读取工具循环", () => {
	it("第一轮调用 memory_search，检索结果进入第二轮请求", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{
				text: "",
				toolCalls: [
					{
						id: "call-1",
						name: "memory_search",
						arguments: { query: "青铜匕首" },
					},
				],
			},
			{ text: "我想起了井底的匕首。" },
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我回想井底的东西。",
			template: template(),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
			model: "fake",
		});

		expect(requests).toHaveLength(2);
		expect(requests[0]?.tools?.map((tool) => tool.name)).toEqual([
			"state_update",
			"plot_note",
			"memory_search",
			"lore_lookup",
			"state_get",
		]);
		const secondMessages = requests[1]?.messages ?? [];
		const assistantCall = secondMessages.find(
			(message) =>
				message.role === "assistant" &&
				(message.toolCalls ?? []).some((call) => call.name === "memory_search"),
		);
		expect(assistantCall).toBeDefined();
		const toolResult = secondMessages.find(
			(message) => message.role === "tool",
		);
		expect(toolResult).toMatchObject({
			role: "tool",
			toolCallId: "call-1",
			toolName: "memory_search",
			isError: false,
		});
		expect(toolResult?.content).toContain("井底的青铜匕首还在");

		expect(result.node.raw).toBe("我想起了井底的匕首。");
		expect(result.trace.tools).toEqual({
			transport: "native",
			rounds: 1,
			maxRounds: 3,
			capped: false,
			calls: [{ name: "memory_search", ok: true, error: null }],
			rejected: [],
		});
		expect(result.trace.llm).toMatchObject({
			usage: {
				promptTokens: 20,
				completionTokens: 40,
				totalTokens: 60,
			},
			attempts: 2,
			rounds: 2,
		});
		expect(result.blocks).toEqual([
			{ kind: "text", text: "我想起了井底的匕首。" },
		]);
	});

	it("连续请求工具时在软上限 3 轮后收束，保留最后一轮的正文", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const search: LlmToolCall = {
			id: "call-x",
			name: "state_get",
			arguments: {},
		};
		const { client, requests } = createScriptedClient([
			{ text: "", toolCalls: [search] },
			{ text: "", toolCalls: [{ ...search, id: "call-y" }] },
			{ text: "", toolCalls: [{ ...search, id: "call-w" }] },
			{ text: "井底传来回声。", toolCalls: [{ ...search, id: "call-z" }] },
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我听井底的声音。",
			template: template(),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
		});

		expect(requests).toHaveLength(4);
		expect(result.node.raw).toBe("井底传来回声。");
		expect(result.trace.tools).toEqual({
			transport: "native",
			rounds: 3,
			maxRounds: 3,
			capped: true,
			calls: [
				{ name: "state_get", ok: true, error: null },
				{ name: "state_get", ok: true, error: null },
				{ name: "state_get", ok: true, error: null },
			],
			rejected: [],
		});
	});

	it("参数非法的工具调用不执行，错误写回工具结果", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{
				text: "",
				toolCalls: [
					{
						id: "bad-1",
						name: "memory_search",
						arguments: { query: "井底", limit: 99 },
					},
				],
			},
			{ text: "我想不起来。" },
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我努力回想。",
			template: template(),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
		});

		const toolResult = requests[1]?.messages.find(
			(message) => message.role === "tool",
		);
		expect(toolResult).toMatchObject({
			role: "tool",
			toolName: "memory_search",
			isError: true,
		});
		expect(toolResult?.content).toContain(
			"memory_search.limit 必须是 1 到 12 之间的整数",
		);
		expect(result.trace.tools).toEqual({
			transport: "native",
			rounds: 1,
			maxRounds: 3,
			capped: false,
			calls: [
				{
					name: "memory_search",
					ok: false,
					error: expect.stringContaining(
						"memory_search.limit 必须是 1 到 12 之间的整数",
					),
				},
			],
			rejected: [],
		});
	});

	it("写入工具只收集，不执行；读取工具与写入工具可以出现在同一轮", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{
				text: "",
				toolCalls: [
					{
						id: "read-1",
						name: "state_get",
						arguments: {},
					},
					{
						id: "write-1",
						name: "state_update",
						arguments: {
							path: ["角色", "山神", "情绪"],
							op: "set",
							value: "警觉",
						},
					},
				],
			},
			{
				text: "他抬起眼睛。",
				toolCalls: [
					{
						id: "write-2",
						name: "plot_note",
						arguments: { text: "井底的回声来自另一个人" },
					},
				],
			},
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我问他井底是谁。",
			template: template(),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
		});

		expect(
			requests[1]?.messages.filter((message) => message.role === "tool"),
		).toHaveLength(1);
		expect(result.stateDiffs).toHaveLength(1);
		expect(result.stateDiffs[0]).toMatchObject({
			path: ["角色", "山神", "情绪"],
			value: "警觉",
			source: "model",
		});
		expect(result.plotNotes.map((note) => note.text)).toEqual([
			"井底的回声来自另一个人",
		]);
		expect(result.trace.tools).toEqual({
			transport: "native",
			rounds: 1,
			maxRounds: 3,
			capped: false,
			calls: [{ name: "state_get", ok: true, error: null }],
			rejected: [],
		});
	});

	it("中止信号在工具执行前生效", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, controller } = createScriptedClient(
			[
				{
					text: "",
					toolCalls: [
						{
							id: "call-1",
							name: "memory_search",
							arguments: { query: "匕首" },
						},
					],
				},
			],
			() => controller.abort(new Error("测试中止")),
		);

		await expect(
			runChatTurn({
				store,
				client,
				storyId: "s1",
				userText: "我回想。",
				template: template(),
				providers: providers(store),
				budgetTokens: 4_000,
				structuredOutput: "function-call",
				signal: controller.signal,
			}),
		).rejects.toThrow("测试中止");
		expect(store.getPathToHead("s1").map((node) => node.role)).toEqual([
			"assistant",
			"user",
		]);
	});

	it("文本标签模式不提供工具定义，也没有工具轮次", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{ text: "风从井口吹下来。" },
		]);

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我抬头看。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
		});

		expect(requests[0]?.tools).toBeUndefined();
		expect(result.trace.tools).toEqual({
			transport: "native",
			rounds: 0,
			maxRounds: 3,
			capped: false,
			calls: [],
			rejected: [],
		});
	});
});
