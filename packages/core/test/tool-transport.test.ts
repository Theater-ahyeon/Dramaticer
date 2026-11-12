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

function createScriptedClient(rounds: readonly Round[]): {
	client: LlmStreamingClient;
	requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const client: LlmStreamingClient = {
		async complete() {
			throw new Error("本测试不使用 complete");
		},
		stream(request, _options?: LlmCallOptions) {
			const index = requests.length;
			const round = rounds[index];
			if (round === undefined) {
				throw new Error(`没有为第 ${index + 1} 次请求准备回复`);
			}
			requests.push(request);
			return createEventStream(async (emit) => {
				// 逐字发送，覆盖工具标签被拆到多个增量的情况
				for (const char of round.text) {
					emit({ type: "text_delta", delta: char });
				}
				const result: LlmResult = {
					text: round.text,
					reasoning: "",
					toolCalls: round.toolCalls ?? [],
					finishReason:
						(round.toolCalls ?? []).length > 0 ? "tool_calls" : "stop",
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
				return result;
			});
		},
	};
	return { client, requests };
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "工具传输" });
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

describe("文本协议的工具传输", () => {
	it("解析工具调用，正文与原生函数调用一致", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client: textClient, requests } = createScriptedClient([
			{
				text: '<tool name="memory_search">{"query":"青铜匕首"}</tool>',
			},
			{ text: "我想起了井底的匕首。" },
		]);
		const visible: string[] = [];
		const textResult = await runChatTurn({
			store,
			client: textClient,
			storyId: "s1",
			userText: "我回想井底的东西。",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
			toolTransport: "text",
			onTextDelta: (delta) => {
				visible.push(delta);
			},
		});

		expect(requests).toHaveLength(2);
		expect(requests[0]?.tools).toBeUndefined();
		const protocol = requests[0]?.messages.find(
			(message) =>
				message.role === "system" &&
				message.content.includes('<tool name="工具名">'),
		);
		expect(protocol).toBeDefined();
		expect(protocol?.content).toContain("memory_search");
		const toolResult = requests[1]?.messages.find(
			(message) => message.role === "tool",
		);
		expect(toolResult).toMatchObject({
			role: "tool",
			toolName: "memory_search",
			isError: false,
		});
		expect(toolResult?.content).toContain("井底的青铜匕首还在");
		expect(textResult.node.raw).toBe("我想起了井底的匕首。");
		expect(textResult.trace.tools).toEqual({
			transport: "text",
			rounds: 1,
			maxRounds: 3,
			capped: false,
			calls: [
				{
					name: "memory_search",
					ok: true,
					error: null,
					permission: "read",
				},
			],
			rejected: [],
		});
		expect(visible.join("")).not.toContain("<tool");

		const native = createScriptedClient([
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
		const { store: nativeStore } = openTempStore();
		seedStory(nativeStore);
		const nativeResult = await runChatTurn({
			store: nativeStore,
			client: native.client,
			storyId: "s1",
			userText: "我回想井底的东西。",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(nativeStore),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
		});
		expect(nativeResult.node.raw).toBe(textResult.node.raw);
		expect(nativeResult.trace.tools.calls).toEqual(
			textResult.trace.tools.calls,
		);
		expect(nativeResult.trace.tools.rounds).toBe(textResult.trace.tools.rounds);
	});

	it("非法 JSON 与未知工具都写回错误结果，正文继续", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{
				text: '<tool name="memory_search">{"query": 青铜}</tool><tool name="teleport">{}</tool>',
			},
			{ text: "我想不起来。" },
		]);
		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我努力回想。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			toolTransport: "text",
		});

		const toolResults = (requests[1]?.messages ?? []).filter(
			(message) => message.role === "tool",
		);
		expect(toolResults).toHaveLength(2);
		expect(toolResults[0]).toMatchObject({
			toolName: "memory_search",
			isError: true,
		});
		expect(toolResults[0]?.content).toContain("参数不是合法 JSON");
		expect(toolResults[1]).toMatchObject({
			toolName: "teleport",
			isError: true,
		});
		expect(toolResults[1]?.content).toContain("未知工具：teleport");
		expect(result.node.raw).toBe("我想不起来。");
		expect(result.trace.tools.calls).toEqual([
			{
				name: "memory_search",
				ok: false,
				error: expect.stringContaining("参数不是合法 JSON"),
				permission: "read",
			},
		]);
		expect(result.trace.tools.rejected).toEqual([
			{ name: "teleport", reason: "未知工具：teleport" },
		]);
	});

	it("最后一轮的未知工具也记进 Trace", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{ text: '<tool name="teleport">{}</tool>风停了。' },
		]);
		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我等着。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			toolTransport: "text",
		});

		expect(requests).toHaveLength(1);
		expect(result.node.raw).toBe("风停了。");
		expect(result.trace.tools.calls).toEqual([]);
		expect(result.trace.tools.rejected).toEqual([
			{ name: "teleport", reason: "未知工具：teleport" },
		]);
	});

	it("写入工具只收集，工具结果里只做确认", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{
				text: '<tool name="state_update">{"path":["角色","山神","情绪"],"op":"set","value":"警觉"}</tool><tool name="state_get">{}</tool>',
			},
			{ text: "他抬起眼睛。" },
		]);
		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我问他井底是谁。",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
			toolTransport: "text",
		});

		const toolResults = (requests[1]?.messages ?? []).filter(
			(message) => message.role === "tool",
		);
		expect(toolResults).toHaveLength(2);
		const writeResult = toolResults.find(
			(message) =>
				message.role === "tool" && message.toolName === "state_update",
		);
		expect(writeResult).toMatchObject({ isError: false });
		expect(writeResult?.content).toContain("已记录");
		expect(result.stateDiffs).toHaveLength(1);
		expect(result.stateDiffs[0]).toMatchObject({
			path: ["角色", "山神", "情绪"],
			value: "警觉",
			source: "model",
		});
		expect(result.trace.tools.calls).toEqual([
			{ name: "state_get", ok: true, error: null, permission: "read" },
		]);
		expect(result.trace.tools.rejected).toEqual([]);
	});

	it("文本协议同样受读取工具软上限约束", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const call = '<tool name="state_get">{}</tool>';
		const { client, requests } = createScriptedClient([
			{ text: call },
			{ text: call },
			{ text: `井底传来回声。${call}` },
		]);
		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我听井底的声音。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			toolTransport: "text",
			maxReadRounds: 2,
		});

		expect(requests).toHaveLength(3);
		expect(result.node.raw).toBe("井底传来回声。");
		expect(result.trace.tools).toEqual({
			transport: "text",
			rounds: 2,
			maxRounds: 2,
			capped: true,
			calls: [
				{ name: "state_get", ok: true, error: null, permission: "read" },
				{ name: "state_get", ok: true, error: null, permission: "read" },
			],
			rejected: [],
		});
	});

	it("流式输出里不出现工具调用片段", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createScriptedClient([
			{
				text: '我先看看。<tool name="state_get">{}</tool>',
			},
			{ text: "看完了。" },
		]);
		const visible: string[] = [];
		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我检查状态。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			toolTransport: "text",
			onTextDelta: (delta) => {
				visible.push(delta);
			},
		});

		expect(visible.join("")).not.toContain("<tool");
		expect(result.node.raw).toBe("看完了。");
	});
});
