import type { LlmClient, LlmResult } from "@dramaticer/core";
import { describe, expect, it } from "vitest";
import {
	MAX_SIMULATED_USER_ATTEMPTS,
	SimulatedUserOutputError,
	generateSimulatedUserMessage,
	parseSimulatedUserMessage,
} from "../src/playtest/user";

function llmResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake",
		channel: null,
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

class FakeClient implements LlmClient {
	readonly calls: string[] = [];
	readonly #outputs: string[];

	constructor(outputs: readonly string[]) {
		this.#outputs = [...outputs];
	}

	async complete(): Promise<LlmResult> {
		const text = this.#outputs.shift() ?? "";
		this.calls.push(text);
		return llmResult(text);
	}
}

describe("模拟用户输出校验", () => {
	it("只接受单个 message 键的非空对象", () => {
		expect(parseSimulatedUserMessage('{"message":"我推开门。"}')).toBe(
			"我推开门。",
		);
		expect(parseSimulatedUserMessage(' {"message":"  好  "} ')).toBe("好");
		expect(parseSimulatedUserMessage("```json\n{}\n```")).toBeNull();
		expect(parseSimulatedUserMessage('{"message":"好","extra":1}')).toBeNull();
		expect(parseSimulatedUserMessage('{"message":""}')).toBeNull();
		expect(parseSimulatedUserMessage('{"message":1}')).toBeNull();
		expect(parseSimulatedUserMessage("[]")).toBeNull();
	});

	it("第一次输出非法时重试并返回合法结果", async () => {
		const client = new FakeClient(["不是 JSON", '{"message":"我停下脚步。"}']);
		const message = await generateSimulatedUserMessage({
			client,
			model: "background-model",
			round: 2,
			transcript: "你：推门。\n剧情：门开了。",
		});
		expect(message).toBe("我停下脚步。");
		expect(client.calls).toHaveLength(2);
	});

	it("连续三次非法后终止并记录尝试次数", async () => {
		const client = new FakeClient(["一", "二", "三"]);
		await expect(
			generateSimulatedUserMessage({
				client,
				model: "background-model",
				round: 1,
				transcript: "（还没有任何对话）",
			}),
		).rejects.toBeInstanceOf(SimulatedUserOutputError);
		expect(client.calls).toHaveLength(MAX_SIMULATED_USER_ATTEMPTS);
	});
});
