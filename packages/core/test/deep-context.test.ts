import { describe, expect, it } from "vitest";
import {
	type LlmCallOptions,
	type LlmMessage,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmToolCall,
	type StoryStore,
	createDefaultContextTemplate,
	createEventStream,
	createHistorySlotProvider,
	createStaticSlotProvider,
	createTokenEstimator,
	pruneToolRoundTrips,
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
	const calls = round.toolCalls ?? [];
	return {
		text: round.text,
		reasoning: "",
		toolCalls: calls,
		finishReason: calls.length > 0 ? "tool_calls" : "stop",
		stopReason: calls.length > 0 ? "toolUse" : "stop",
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
			const round = rounds[requests.length];
			if (round === undefined) {
				throw new Error(`没有为第 ${requests.length + 1} 次请求准备回复`);
			}
			requests.push(request);
			return createEventStream(async (emit) => {
				for (const char of round.text) {
					emit({ type: "text_delta", delta: char });
				}
				return resultOf(round);
			});
		},
	};
	return { client, requests };
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "工具往返上下文" });
	store.appendNode({
		id: "n-root",
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

function stateGetRound(id: string): Round {
	return {
		text: "",
		toolCalls: [{ id, name: "state_get", arguments: {} }],
	};
}

function toolStep(index: number, size: number): LlmMessage[] {
	return [
		{
			role: "assistant",
			content: "",
			toolCalls: [{ id: `call-${index}`, name: "state_get", arguments: {} }],
		},
		{
			role: "tool",
			content: "x".repeat(size),
			toolCallId: `call-${index}`,
			toolName: "state_get",
		},
	];
}

/** 每条工具结果都必须对应同一轮助手消息里的调用，不能留下孤立消息。 */
function assertPaired(messages: readonly LlmMessage[]): void {
	const called = new Set<string>();
	const answered = new Set<string>();
	for (const message of messages) {
		if (message.role === "tool") {
			expect(
				called.has(message.toolCallId),
				`工具结果 ${message.toolCallId} 没有对应的调用`,
			).toBe(true);
			answered.add(message.toolCallId);
			continue;
		}
		for (const call of message.toolCalls ?? []) {
			called.add(call.id);
		}
	}
	for (const id of called) {
		expect(answered.has(id), `工具调用 ${id} 没有对应的结果`).toBe(true);
	}
}

function toolIds(messages: readonly LlmMessage[]): string[] {
	const ids: string[] = [];
	for (const message of messages) {
		if (message.role === "tool") ids.push(message.toolCallId);
	}
	return ids;
}

describe("工具往返的成对省略", () => {
	it("上限以下不做任何省略", () => {
		const messages: LlmMessage[] = [
			{ role: "system", content: "规则。" },
			{ role: "user", content: "我查一下。" },
			...toolStep(1, 40),
			...toolStep(2, 40),
		];
		const result = pruneToolRoundTrips(messages, {
			tokenLimit: 10_000,
			recentToolSteps: 1,
		});
		expect(result.omitted).toBeNull();
		expect(result.messages).toBe(messages);
	});

	it("从最早的一对开始省略，直到只剩最近几步", () => {
		const messages: LlmMessage[] = [
			{ role: "system", content: "规则。" },
			{ role: "user", content: "我查一下。" },
			...toolStep(1, 400),
			...toolStep(2, 400),
			...toolStep(3, 40),
			...toolStep(4, 40),
		];
		const result = pruneToolRoundTrips(messages, {
			tokenLimit: 1,
			recentToolSteps: 1,
		});
		expect(result.omitted).toMatchObject({
			pairs: 3,
			messages: 6,
			reason: "context_limit",
		});
		expect(result.messages.map((message) => message.role)).toEqual([
			"system",
			"user",
			"assistant",
			"tool",
		]);
		expect(toolIds(result.messages)).toEqual(["call-4"]);
		assertPaired(result.messages);

		const estimator = createTokenEstimator();
		const stepTokens = (size: number) =>
			estimator("x".repeat(size)) +
			estimator("state_get") +
			estimator("") +
			estimator("state_get") +
			estimator("{}");
		expect(result.omitted?.tokens).toBe(
			stepTokens(400) + stepTokens(400) + stepTokens(40),
		);
	});

	it("保留最近 deepRecentToolSteps 步，当前步骤不被省略", () => {
		const messages: LlmMessage[] = [
			{ role: "system", content: "规则。" },
			...toolStep(1, 400),
			...toolStep(2, 400),
			...toolStep(3, 400),
			...toolStep(4, 40),
		];
		const result = pruneToolRoundTrips(messages, {
			tokenLimit: 1,
			recentToolSteps: 2,
		});
		expect(result.omitted).toMatchObject({ pairs: 2, messages: 4 });
		expect(toolIds(result.messages)).toEqual(["call-3", "call-4"]);
		assertPaired(result.messages);
	});

	it("工具往返数量不超过保留步数时不省略", () => {
		const messages: LlmMessage[] = [
			{ role: "system", content: "规则。" },
			...toolStep(1, 400),
			...toolStep(2, 400),
		];
		const result = pruneToolRoundTrips(messages, {
			tokenLimit: 1,
			recentToolSteps: 4,
		});
		expect(result.omitted).toBeNull();
		expect(toolIds(result.messages)).toEqual(["call-1", "call-2"]);
	});

	it("非法的上限与保留步数抛错并指出字段", () => {
		expect(() =>
			pruneToolRoundTrips([], { tokenLimit: 0, recentToolSteps: 4 }),
		).toThrow("深回合的工具消息 token 上限 必须是正整数");
		expect(() =>
			pruneToolRoundTrips([], { tokenLimit: 100, recentToolSteps: 0 }),
		).toThrow("深回合保留的最近工具步数 必须是");
	});
});

describe("深回合每次请求前的上下文卫生", () => {
	it("超过上限时省略较早的成对往返并把数字写进 Trace", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.updateStorySettings("s1", {
			deepContextTokenLimit: 1,
			deepRecentToolSteps: 1,
		});
		const { client, requests } = createScriptedClient([
			stateGetRound("call-1"),
			stateGetRound("call-2"),
			stateGetRound("call-3"),
			stateGetRound("call-4"),
			{ text: "看完了。" },
		]);

		const turn = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我四处查。",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
			turnMode: "deep",
		});

		expect(requests).toHaveLength(5);
		for (const request of requests) assertPaired(request.messages);
		expect(toolIds(requests[4]?.messages ?? [])).toEqual(["call-4"]);
		expect(turn.trace.deep?.contextOmitted).toMatchObject({
			pairs: 3,
			messages: 6,
			reason: "context_limit",
		});
		expect(turn.trace.deep?.contextOmitted?.tokens).toBeGreaterThan(0);
	});

	it("上限以下保留全部工具往返，Trace 不写省略记录", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			stateGetRound("call-1"),
			stateGetRound("call-2"),
			{ text: "看完了。" },
		]);

		const turn = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我查两遍。",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
			turnMode: "deep",
		});

		expect(toolIds(requests[2]?.messages ?? [])).toEqual(["call-1", "call-2"]);
		expect(turn.trace.deep?.contextOmitted).toBeUndefined();
	});

	it("快回合不套用这条规则", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.updateStorySettings("s1", {
			deepContextTokenLimit: 1,
			deepRecentToolSteps: 1,
		});
		const { client, requests } = createScriptedClient([
			stateGetRound("call-1"),
			stateGetRound("call-2"),
			{ text: "看完了。" },
		]);

		const turn = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我查两遍。",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
			turnMode: "fast",
		});

		expect(toolIds(requests[2]?.messages ?? [])).toEqual(["call-1", "call-2"]);
		expect(turn.trace.deep).toBeNull();
	});
});
