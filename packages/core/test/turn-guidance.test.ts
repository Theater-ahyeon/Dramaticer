import { describe, expect, it } from "vitest";
import {
	type LlmCallOptions,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmToolCall,
	type StoryStore,
	TURN_GUIDANCE_PREFIX,
	TurnGuidanceController,
	TurnGuidanceError,
	type TurnRunHandle,
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

function createScriptedClient(
	rounds: readonly Round[],
	onRound?: (index: number) => void,
): { client: LlmStreamingClient; requests: LlmRequest[] } {
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
			requests.push({ ...request, messages: [...request.messages] });
			onRound?.(index);
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
	store.createStory({ id: "s1", title: "运行中追加要求" });
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

function turnInput(
	store: StoryStore,
	client: LlmStreamingClient,
	onTurnStarted: (handle: TurnRunHandle | null) => void,
) {
	return {
		store,
		client,
		storyId: "s1",
		userText: "我点亮火把。",
		template: createDefaultContextTemplate({
			structuredOutput: "function-call",
		}),
		providers: providers(store),
		budgetTokens: 4_000,
		structuredOutput: "function-call" as const,
		turnMode: "deep" as const,
		onTurnStarted: (started: { readonly handle: TurnRunHandle | null }) => {
			onTurnStarted(started.handle);
		},
	};
}

function userTexts(request: LlmRequest): readonly string[] {
	return request.messages
		.filter((message) => message.role === "user")
		.map((message) => message.content);
}

describe("深回合运行中追加要求", () => {
	it("指引出现在下一次请求里，不写楼层，运行结束后拒绝追加", async () => {
		const { store } = openTempStore();
		seedStory(store);
		let handle: TurnRunHandle | null = null;
		const { client, requests } = createScriptedClient(
			[
				{
					text: "",
					toolCalls: [{ id: "call-1", name: "state_get", arguments: {} }],
				},
				{ text: "山神收回了手。" },
			],
			(index) => {
				if (index === 0) {
					handle?.pushGuidance("不要杀他");
					handle?.pushGuidance("让他先说完");
				}
				if (index === 1) handle?.pushGuidance("迟到的要求");
			},
		);

		const result = await runChatTurn(
			turnInput(store, client, (started) => {
				handle = started;
			}),
		);

		expect(requests).toHaveLength(2);
		const expected = [
			`${TURN_GUIDANCE_PREFIX}\n不要杀他`,
			`${TURN_GUIDANCE_PREFIX}\n让他先说完`,
		];
		expect(userTexts(requests[0] as LlmRequest)).not.toContain(expected[0]);
		expect(userTexts(requests[1] as LlmRequest).slice(-2)).toEqual(expected);
		expect(result.node.raw).toBe("山神收回了手。");
		expect(store.listStoryNodes("s1")).toHaveLength(3);

		const runId = result.trace.run?.runId as string;
		const steering = store
			.listTurnRunEvents(runId)
			.filter((event) => event.kind === "steering");
		expect(steering.map((event) => event.payload)).toEqual([
			{ textLength: 4 },
			{ textLength: 5 },
			{ textLength: 5 },
		]);
		expect(JSON.stringify(steering)).not.toContain("不要杀他");

		const closed = handle as TurnRunHandle | null;
		let rejection: unknown = null;
		try {
			closed?.pushGuidance("已经结束了");
		} catch (error) {
			rejection = error;
		}
		expect(rejection).toBeInstanceOf(TurnGuidanceError);
		expect((rejection as TurnGuidanceError).reason).toBe("closed");
	});

	it("队列上限、文本长度与关闭状态都拒绝追加", () => {
		const accepted: string[] = [];
		const controller = new TurnGuidanceController("run-1", (text) => {
			accepted.push(text);
		});
		controller.push(" 第一条 ");
		controller.push("第二条");
		expect(controller.drain()).toEqual(["第一条", "第二条"]);
		expect(accepted).toEqual(["第一条", "第二条"]);
		expect(controller.pendingCount).toBe(0);

		for (let index = 0; index < 5; index += 1) {
			controller.push(`第 ${index} 条`);
		}
		expect(controller.pendingCount).toBe(5);
		expect(() => controller.push("第六条")).toThrowError(
			expect.objectContaining({ reason: "queue_full" }),
		);
		expect(controller.drain()).toEqual([
			"第 0 条",
			"第 1 条",
			"第 2 条",
			"第 3 条",
			"第 4 条",
		]);

		expect(() => controller.push("   ")).toThrowError(
			expect.objectContaining({ reason: "empty" }),
		);
		expect(() => controller.push("字".repeat(2_001))).toThrowError(
			expect.objectContaining({ reason: "too_long" }),
		);
		controller.push("字".repeat(2_000));
		expect(controller.drain()).toHaveLength(1);

		controller.close();
		expect(() => controller.push("结束以后")).toThrowError(
			expect.objectContaining({ reason: "closed" }),
		);
	});
});
