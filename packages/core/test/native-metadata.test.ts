import type {
	AssistantMessage,
	Model,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	FAST_TURN_TOOLS,
	type LlmCallOptions,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmToolCall,
	type LlmToolDefinition,
	buildPiContext,
	createEventStream,
	providerResultFromMessage,
	runModelTurns,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const USAGE = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

const THOUGHT_SIGNATURE = "CAIS+gemini-thought-signature/+=";
const TEXT_SIGNATURE = "gemini-text-signature";
const THINKING_SIGNATURE = "gemini-thinking-signature";

function piModel(): Model<"google-generative-ai"> {
	return {
		id: "gemini-fixture",
		name: "gemini-fixture",
		api: "google-generative-ai",
		provider: "google",
		baseUrl: "https://example.invalid",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		reasoning: true,
		contextWindow: 131_072,
		maxTokens: 8_192,
	};
}

function assistantMessage(
	content: AssistantMessage["content"],
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "google-generative-ai",
		provider: "google",
		model: "gemini-fixture",
		responseModel: "gemini-fixture-001",
		usage: {
			input: 10,
			output: 20,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 30,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 1,
	};
}

const LEDGER_TOOL: LlmToolDefinition = {
	name: "ledger_read",
	description: "读取台账",
	parameters: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
};

describe("渠道原生元数据", () => {
	it("Gemini 的工具调用签名在第二轮请求里逐字节一致", () => {
		const response = providerResultFromMessage(
			assistantMessage([
				{
					type: "thinking",
					thinking: "先看台账。",
					thinkingSignature: THINKING_SIGNATURE,
				} satisfies ThinkingContent,
				{
					type: "text",
					text: "我查一下。",
					textSignature: TEXT_SIGNATURE,
				} satisfies TextContent,
				{
					type: "toolCall",
					id: "call-1",
					name: "ledger_read",
					arguments: {},
					thoughtSignature: THOUGHT_SIGNATURE,
				} satisfies ToolCall,
			]),
			200,
			undefined,
		);

		expect(response.native).toEqual({
			content: [
				{
					type: "thinking",
					thinking: "先看台账。",
					thinkingSignature: THINKING_SIGNATURE,
				},
				{
					type: "text",
					text: "我查一下。",
					textSignature: TEXT_SIGNATURE,
				},
				{
					type: "toolCall",
					id: "call-1",
					name: "ledger_read",
					arguments: {},
					thoughtSignature: THOUGHT_SIGNATURE,
				},
			],
		});
		expect(response.toolCalls).toHaveLength(1);
		expect(response.toolCalls[0]?.native).toEqual({
			thoughtSignature: THOUGHT_SIGNATURE,
		});
		expect(response.toolCalls[0]?.arguments).toEqual({});

		const context = buildPiContext(
			[
				{ role: "user", content: "看看台账。" },
				{
					role: "assistant",
					content: response.text,
					toolCalls: response.toolCalls,
					native: response.native,
				},
				{
					role: "tool",
					toolCallId: "call-1",
					toolName: "ledger_read",
					content: "台账为空。",
				},
			],
			undefined,
			piModel(),
			[LEDGER_TOOL],
		);
		const assistant = context.messages[1];
		if (assistant === undefined || assistant.role !== "assistant") {
			throw new Error("第二条消息不是助手消息");
		}
		const thinking = assistant.content.find(
			(block) => block.type === "thinking",
		);
		const text = assistant.content.find((block) => block.type === "text");
		const call = assistant.content.find((block) => block.type === "toolCall");
		expect(thinking?.thinkingSignature).toBe(THINKING_SIGNATURE);
		expect(text?.textSignature).toBe(TEXT_SIGNATURE);
		expect(call?.thoughtSignature).toBe(THOUGHT_SIGNATURE);
		expect(
			Buffer.from(call?.thoughtSignature ?? "").equals(
				Buffer.from(THOUGHT_SIGNATURE),
			),
		).toBe(true);
	});

	it("没有签名的响应不产生 native 对象", () => {
		const response = providerResultFromMessage(
			assistantMessage([
				{ type: "text", text: "台账为空。" } satisfies TextContent,
				{
					type: "toolCall",
					id: "call-2",
					name: "ledger_read",
					arguments: {},
				} satisfies ToolCall,
			]),
			200,
			undefined,
		);

		expect(response.native).toBeUndefined();
		expect(response.toolCalls[0]?.native).toBeUndefined();

		const context = buildPiContext(
			[
				{
					role: "assistant",
					content: response.text,
					toolCalls: response.toolCalls,
				},
			],
			undefined,
			piModel(),
			[LEDGER_TOOL],
		);
		const assistant = context.messages[0];
		if (assistant === undefined || assistant.role !== "assistant") {
			throw new Error("第一条消息不是助手消息");
		}
		const call = assistant.content.find((block) => block.type === "toolCall");
		expect(call?.thoughtSignature).toBeUndefined();
		expect(call?.namespace).toBeUndefined();
	});

	it("深回合工具循环把 native 与工具调用原生字段带进下一次请求", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "原生元数据" });
		const userNode = store.appendNode({
			id: "n-user",
			storyId: "s1",
			parentId: null,
			role: "user",
			raw: "看看台账。",
		});

		const native = {
			content: [
				{
					type: "toolCall" as const,
					id: "call-1",
					name: "ledger_read",
					arguments: {},
					thoughtSignature: THOUGHT_SIGNATURE,
				},
			],
		};
		const rounds: LlmResult[] = [
			{
				text: "",
				reasoning: "",
				toolCalls: [
					{
						id: "call-1",
						name: "ledger_read",
						arguments: {},
						native: { thoughtSignature: THOUGHT_SIGNATURE },
					},
				],
				finishReason: "tool_calls",
				stopReason: "toolUse",
				model: "fake-model",
				channel: "fake-channel",
				usage: USAGE,
				raw: null,
				native,
				cached: false,
				attempts: 1,
				rounds: 1,
				truncation: null,
				continuation: null,
			},
			{
				text: "台账为空。",
				reasoning: "",
				toolCalls: [],
				finishReason: "stop",
				stopReason: "stop",
				model: "fake-model",
				channel: "fake-channel",
				usage: USAGE,
				raw: null,
				cached: false,
				attempts: 1,
				rounds: 1,
				truncation: null,
				continuation: { text: "台账为空。", reasoning: "" },
			},
		];
		const requests: LlmRequest[] = [];
		const client: LlmStreamingClient = {
			async complete() {
				throw new Error("本测试不使用 complete");
			},
			stream(request, _options?: LlmCallOptions) {
				const round = rounds[requests.length];
				if (round === undefined) {
					throw new Error("没有为这次请求准备回复");
				}
				requests.push(request);
				return createEventStream(async (emit) => {
					for (const char of round.text) {
						emit({ type: "text_delta", delta: char });
					}
					return round;
				});
			},
		};

		await runModelTurns({
			client,
			messages: [{ role: "user", content: "看看台账。" }],
			tools: FAST_TURN_TOOLS.tools,
			toolContext: {
				store,
				storyId: "s1",
				beforeNodeId: userNode.id,
			},
		});

		expect(requests).toHaveLength(2);
		const replayed = requests[1]?.messages.find(
			(message) => message.role === "assistant",
		);
		expect(replayed?.native).toEqual(native);
		if (replayed === undefined || replayed.role !== "assistant") {
			throw new Error("第二次请求里没有助手消息");
		}
		expect(replayed.toolCalls).toHaveLength(1);
		expect(replayed.toolCalls?.[0]?.native).toEqual({
			thoughtSignature: THOUGHT_SIGNATURE,
		});
		expect(replayed.native?.content[0]?.thoughtSignature).toBe(
			THOUGHT_SIGNATURE,
		);
	});
});
