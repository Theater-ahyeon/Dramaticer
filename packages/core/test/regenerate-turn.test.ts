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
	createStateSlotProvider,
	createStaticSlotProvider,
	generateAssistantTurn,
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

function createScriptedClient(rounds: readonly Round[]): {
	client: LlmStreamingClient;
	requests: LlmRequest[];
	options: (LlmCallOptions | undefined)[];
} {
	const requests: LlmRequest[] = [];
	const callOptions: (LlmCallOptions | undefined)[] = [];
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
				emit({ type: "text_delta", delta: round.text });
				return result;
			});
		},
	};
	return { client, requests, options: callOptions };
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "重新生成" });
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

const FIRST_REPLY = `第一版回复。
<state_update>{"path":["场景","地点"],"op":"set","value":"山门"}</state_update>
<plot_note>{"text":"门后有人跟踪"}</plot_note>`;

const SECOND_REPLY = `第二版回复。
<state_update>{"path":["场景","地点"],"op":"set","value":"地宫"}</state_update>
<plot_note>{"text":"石壁上有刀痕"}</plot_note>`;

describe("regenerateAssistantTurn", () => {
	it("文本标签模式：新建兄弟楼层，旧楼层与旧 Trace 不变", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const first = await runChatTurn({
			store,
			client: createScriptedClient([{ text: FIRST_REPLY }]).client,
			storyId: "s1",
			userText: "我推开山门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			model: "fake",
		});
		const oldNode = first.node;
		const oldTrace = store.getTurnTrace(oldNode.id);
		const oldDiffs = store.getStateDiffs(oldNode.id);
		expect(oldTrace).not.toBeNull();
		expect(oldDiffs).toHaveLength(1);

		const regenerated = await regenerateAssistantTurn({
			store,
			client: createScriptedClient([{ text: SECOND_REPLY }]).client,
			storyId: "s1",
			assistantNodeId: oldNode.id,
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			model: "fake",
		});

		expect(regenerated.userNode.id).toBe(first.userNode.id);
		expect(regenerated.node.id).not.toBe(oldNode.id);
		expect(regenerated.node.parentId).toBe(first.userNode.id);
		expect(regenerated.node.raw).toBe(SECOND_REPLY);

		expect(store.getNode(oldNode.id)?.raw).toBe(FIRST_REPLY);
		expect(store.getTurnTrace(oldNode.id)).toEqual(oldTrace);
		expect(store.getStateDiffs(oldNode.id)).toEqual(oldDiffs);

		expect(store.getHead("s1")?.id).toBe(regenerated.node.id);
		expect(store.getPathToHead("s1").map((node) => node.id)).toEqual([
			"n-greeting",
			first.userNode.id,
			regenerated.node.id,
		]);

		expect(regenerated.stateDiffs.map((diff) => diff.nodeId)).toEqual([
			regenerated.node.id,
		]);
		expect(store.getStateDiffs(regenerated.node.id)).toEqual(
			regenerated.stateDiffs,
		);

		const notes = store.getOpenPlotNotes("s1");
		expect(notes.map((note) => note.sourceNodeId)).toEqual([
			oldNode.id,
			regenerated.node.id,
		]);
		expect(notes.map((note) => note.text)).toEqual([
			"门后有人跟踪",
			"石壁上有刀痕",
		]);

		expect(store.getTurnTrace(regenerated.node.id)).toMatchObject({
			nodeId: regenerated.node.id,
			parentNodeId: first.userNode.id,
		});
	});

	it("父楼层不是用户楼层、缺少父楼层或楼层不存在时抛错", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendNode({
			id: "n-assistant-child",
			storyId: "s1",
			parentId: "n-greeting",
			role: "assistant",
			raw: "这不是用户说的话。",
		});
		const options = {
			store,
			client: createScriptedClient([{ text: "不应被调用" }]).client,
			storyId: "s1",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags" as const,
		};

		await expect(
			regenerateAssistantTurn({
				...options,
				assistantNodeId: "n-assistant-child",
			}),
		).rejects.toThrow(/角色是 assistant/);
		await expect(
			regenerateAssistantTurn({ ...options, assistantNodeId: "n-greeting" }),
		).rejects.toThrow(/没有父用户楼层/);
		await expect(
			regenerateAssistantTurn({ ...options, assistantNodeId: "n-missing" }),
		).rejects.toThrow(/助手楼层不存在/);
		await expect(
			generateAssistantTurn({
				...options,
				userNodeId: "n-assistant-child",
			}),
		).rejects.toThrow(/角色是 assistant/);
	});

	it("重新生成成功后写一条 swipe 偏好，普通生成不写", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const first = await runChatTurn({
			store,
			client: createScriptedClient([{ text: FIRST_REPLY }]).client,
			storyId: "s1",
			userText: "我推开山门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			model: "fake",
		});
		expect(store.listPreferenceEvents("s1")).toEqual([]);

		const regenerated = await regenerateAssistantTurn({
			store,
			client: createScriptedClient([{ text: SECOND_REPLY }]).client,
			storyId: "s1",
			assistantNodeId: first.node.id,
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			model: "fake",
		});

		const events = store.listPreferenceEvents("s1", { kind: "swipe" });
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			storyId: "s1",
			nodeId: regenerated.node.id,
			kind: "swipe",
			payload: {
				abandonedNodeId: first.node.id,
				acceptedNodeId: regenerated.node.id,
			},
		});
	});

	it("中止但保存了部分正文时同样记录 swipe", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const first = await runChatTurn({
			store,
			client: createScriptedClient([{ text: FIRST_REPLY }]).client,
			storyId: "s1",
			userText: "我推开山门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			model: "fake",
		});

		const controller = new AbortController();
		const emitted = Promise.withResolvers<void>();
		const client: LlmStreamingClient = {
			async complete() {
				throw new Error("中止测试不使用 complete");
			},
			stream() {
				return createEventStream(async (emit) => {
					emit({ type: "text_delta", delta: "山门刚开" });
					emitted.resolve();
					const aborted = Promise.withResolvers<never>();
					controller.signal.addEventListener(
						"abort",
						() => aborted.reject(controller.signal.reason),
						{ once: true },
					);
					await aborted.promise;
				});
			},
		};

		const pending = regenerateAssistantTurn({
			store,
			client,
			storyId: "s1",
			assistantNodeId: first.node.id,
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			signal: controller.signal,
		});
		await emitted.promise;
		controller.abort(new Error("测试中止"));
		const result = await pending;

		expect(result.node.raw).toBe("山门刚开");
		const events = store.listPreferenceEvents("s1", { kind: "swipe" });
		expect(events).toHaveLength(1);
		expect(events[0]?.payload).toEqual({
			abandonedNodeId: first.node.id,
			acceptedNodeId: result.node.id,
		});
	});

	it("生成失败且没有产生楼层时不记录 swipe", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const first = await runChatTurn({
			store,
			client: createScriptedClient([{ text: FIRST_REPLY }]).client,
			storyId: "s1",
			userText: "我推开山门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			model: "fake",
		});
		const headBefore = store.getHead("s1")?.id;

		await expect(
			regenerateAssistantTurn({
				store,
				client: createScriptedClient([]).client,
				storyId: "s1",
				assistantNodeId: first.node.id,
				template: createDefaultContextTemplate({
					structuredOutput: "text-tags",
				}),
				providers: providers(store),
				budgetTokens: 4_000,
				structuredOutput: "text-tags",
				model: "fake",
			}),
		).rejects.toThrow(/没有为第 1 次请求准备回复/);

		expect(store.listPreferenceEvents("s1")).toEqual([]);
		expect(store.getHead("s1")?.id).toBe(headBefore);
	});

	it("函数调用模式仍只有一次主调用与最多 2 轮读取工具", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const userNode = store.appendNode({
			storyId: "s1",
			parentId: "n-greeting",
			role: "user",
			raw: "我回想井底的东西。",
		});
		const oldNode = store.appendNode({
			storyId: "s1",
			parentId: userNode.id,
			role: "assistant",
			raw: "旧回复。",
		});
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
			{
				text: "我想起了井底的匕首。",
				toolCalls: [
					{
						id: "call-2",
						name: "state_update",
						arguments: {
							path: ["记忆", "匕首"],
							op: "set",
							value: "井底",
						},
					},
					{
						id: "call-3",
						name: "plot_note",
						arguments: { text: "匕首可能被人移动过" },
					},
				],
			},
		]);

		const regenerated = await regenerateAssistantTurn({
			store,
			client,
			storyId: "s1",
			assistantNodeId: oldNode.id,
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
			model: "fake",
		});

		expect(requests).toHaveLength(2);
		expect(requests[0]?.tools?.map((tool) => tool.name).slice(0, 2)).toEqual([
			"state_update",
			"plot_note",
		]);
		expect(requests[0]?.tools?.map((tool) => tool.name)).toContain(
			"memory_search",
		);
		expect(regenerated.node.parentId).toBe(userNode.id);
		expect(regenerated.structured.stateUpdates).toHaveLength(1);
		expect(regenerated.structured.notes).toHaveLength(1);
		expect(store.getStateDiffs(regenerated.node.id)).toHaveLength(1);
		expect(
			store
				.getOpenPlotNotes("s1")
				.map((note) => [note.sourceNodeId, note.text]),
		).toEqual([[regenerated.node.id, "匕首可能被人移动过"]]);
		const path = store.getPathToHead("s1");
		expect(path.map((node) => node.id)).toEqual([
			"n-greeting",
			userNode.id,
			regenerated.node.id,
		]);
		expect(path.filter((node) => node.role === "user")).toHaveLength(1);
		expect(store.getNode(oldNode.id)?.raw).toBe("旧回复。");
	});
});
