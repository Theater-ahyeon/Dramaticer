import { describe, expect, it } from "vitest";
import {
	type LlmStreamingClient,
	REROLL_REASONS,
	REROLL_REASON_LABELS,
	REROLL_REASON_WILLS,
	type StoryStore,
	applyRerollReasonWill,
	assertRerollReason,
	createDefaultContextTemplate,
	createEventStream,
	createHistorySlotProvider,
	createStateSlotProvider,
	createStaticSlotProvider,
	formatRerollCorrection,
	generateAssistantTurn,
	isRerollReason,
	readLedger,
	regenerateAssistantTurn,
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

function scriptedClient(texts: readonly string[]): {
	client: LlmStreamingClient;
	requests: {
		messages: readonly { role: string; content: string }[];
	}[];
} {
	const requests: { messages: readonly { role: string; content: string }[] }[] =
		[];
	const client: LlmStreamingClient = {
		async complete() {
			throw new Error("本测试不使用 complete");
		},
		stream(request) {
			const index = requests.length;
			const text = texts[index];
			if (text === undefined) {
				throw new Error(`没有为第 ${index + 1} 次请求准备回复`);
			}
			requests.push({ messages: request.messages });
			return createEventStream(async (emit) => {
				emit({ type: "text_delta", delta: text });
				return {
					text,
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
					continuation: { text, reasoning: "" },
				};
			});
		},
	};
	return { client, requests };
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "重 roll 原因" });
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
		state: createStateSlotProvider(store),
	};
}

function turnBase(store: StoryStore) {
	return {
		store,
		storyId: "s1",
		template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
		providers: providers(store),
		budgetTokens: 4_000,
		structuredOutput: "text-tags" as const,
		model: "fake",
	};
}

describe("重 roll 原因", () => {
	it("六项原因各有标签与长期说法，未知取值被拒绝", () => {
		expect(REROLL_REASONS).toEqual([
			"not-progressed",
			"ignored-instruction",
			"too-short",
			"off-character",
			"format",
			"avoid-line",
		]);
		for (const reason of REROLL_REASONS) {
			expect(REROLL_REASON_LABELS[reason].length).toBeGreaterThan(0);
			expect(REROLL_REASON_WILLS[reason].length).toBeGreaterThan(0);
		}
		expect(isRerollReason("too-short")).toBe(true);
		expect(isRerollReason("太短")).toBe(false);
		expect(() => assertRerollReason("shorter")).toThrow(/只能是/);
	});

	it("原因进入偏好载荷、用户意志与本次请求的纠正段", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const first = await runChatTurn({
			...turnBase(store),
			client: scriptedClient(["第一次回复。"]).client,
			userText: "我推开山门。",
		});

		const scripted = scriptedClient(["重写后的回复。"]);
		const regenerated = await regenerateAssistantTurn({
			...turnBase(store),
			client: scripted.client,
			assistantNodeId: first.node.id,
			rerollReason: "not-progressed",
		});

		const events = store.listPreferenceEvents("s1", { kind: "swipe" });
		expect(events).toHaveLength(1);
		expect(events[0]?.payload).toEqual({
			abandonedNodeId: first.node.id,
			acceptedNodeId: regenerated.node.id,
			reason: "not-progressed",
		});
		expect(regenerated.trace.rerollReason).toBe("not-progressed");

		const wills = readLedger(store, regenerated.node.id, ["userWill"]);
		expect(wills).toBeDefined();
		const entries = Object.values(wills as Record<string, unknown>);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			kind: "correction",
			text: REROLL_REASON_WILLS["not-progressed"],
			sourceNodeId: first.userNode.id,
		});

		const last = scripted.requests[0]?.messages.at(-1);
		expect(last?.role).toBe("system");
		expect(last?.content).toBe(formatRerollCorrection("not-progressed"));
	});

	it("没有原因的重 roll 不写用户意志，Trace 记 null", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const first = await runChatTurn({
			...turnBase(store),
			client: scriptedClient(["第一次回复。"]).client,
			userText: "我推开山门。",
		});
		const regenerated = await regenerateAssistantTurn({
			...turnBase(store),
			client: scriptedClient(["第二次回复。"]).client,
			assistantNodeId: first.node.id,
		});
		expect(regenerated.trace.rerollReason).toBeNull();
		expect(
			readLedger(store, regenerated.node.id, ["userWill"]),
		).toBeUndefined();
		const events = store.listPreferenceEvents("s1", { kind: "swipe" });
		expect(events[0]?.payload).toEqual({
			abandonedNodeId: first.node.id,
			acceptedNodeId: regenerated.node.id,
		});
	});

	it("同一原因连续两次只写一条纠正", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const first = await runChatTurn({
			...turnBase(store),
			client: scriptedClient(["第一次回复。"]).client,
			userText: "我推开山门。",
		});
		const second = await regenerateAssistantTurn({
			...turnBase(store),
			client: scriptedClient(["第二次回复。"]).client,
			assistantNodeId: first.node.id,
			rerollReason: "too-short",
		});
		const third = await regenerateAssistantTurn({
			...turnBase(store),
			client: scriptedClient(["第三次回复。"]).client,
			assistantNodeId: second.node.id,
			rerollReason: "too-short",
		});
		const wills = readLedger(store, third.node.id, ["userWill"]);
		expect(Object.keys(wills as Record<string, unknown>)).toHaveLength(1);
		expect(store.listPreferenceEvents("s1", { kind: "swipe" })).toHaveLength(2);
	});

	it("普通生成带原因直接拒绝，非法原因在写楼层前拒绝", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const user = store.appendNode({
			storyId: "s1",
			parentId: "n-greeting",
			role: "user",
			raw: "我站在原地。",
		});
		await expect(
			generateAssistantTurn({
				...turnBase(store),
				client: scriptedClient(["不应被调用"]).client,
				userNodeId: user.id,
				rerollReason: "too-short",
			}),
		).rejects.toThrow(/只用于重新生成/);

		const first = await runChatTurn({
			...turnBase(store),
			client: scriptedClient(["第一次回复。"]).client,
			userText: "我推开山门。",
		});
		await expect(
			regenerateAssistantTurn({
				...turnBase(store),
				client: scriptedClient(["不应被调用"]).client,
				assistantNodeId: first.node.id,
				// @ts-expect-error 未知原因必须在运行时拒绝
				rerollReason: "shorter",
			}),
		).rejects.toThrow(/只能是/);
		expect(store.getHead("s1")?.id).toBe(first.node.id);
	});

	it("原因写入是玩家来源的事实，已存在时返回 false", () => {
		const { store } = openTempStore();
		seedStory(store);
		const user = store.appendNode({
			storyId: "s1",
			parentId: "n-greeting",
			role: "user",
			raw: "我推门进去。",
		});
		const wrote = applyRerollReasonWill({
			store,
			storyId: "s1",
			nodeId: user.id,
			sourceNodeId: user.id,
			reason: "format",
			createdAt: "2026-11-14T00:00:00.000Z",
		});
		expect(wrote).toBe(true);
		const again = applyRerollReasonWill({
			store,
			storyId: "s1",
			nodeId: user.id,
			sourceNodeId: user.id,
			reason: "format",
		});
		expect(again).toBe(false);
		const diffs = store.getStateDiffs(user.id);
		expect(diffs).toHaveLength(1);
		expect(diffs[0]?.source).toBe("player");
		expect(diffs[0]?.reason).toBe("重 roll 原因：格式乱");
	});
});
