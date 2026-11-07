import Database from "better-sqlite3";
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

interface FakeClientOptions {
	readonly chunks: readonly string[];
	readonly resultText: string;
	readonly toolCalls?: readonly LlmToolCall[];
	readonly reasoning?: string;
}

function splitChunks(text: string, size: number): string[] {
	const chunks: string[] = [];
	for (let index = 0; index < text.length; index += size) {
		chunks.push(text.slice(index, index + size));
	}
	return chunks;
}

function createFakeClient(options: FakeClientOptions): {
	client: LlmStreamingClient;
	requests: LlmRequest[];
	options: (LlmCallOptions | undefined)[];
} {
	const requests: LlmRequest[] = [];
	const callOptions: (LlmCallOptions | undefined)[] = [];
	const reasoning = options.reasoning ?? "";
	const result: LlmResult = {
		text: options.resultText,
		reasoning,
		toolCalls: options.toolCalls ?? [],
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
		continuation:
			options.resultText.length > 0 || reasoning.length > 0
				? { text: options.resultText, reasoning }
				: null,
	};
	return {
		requests,
		options: callOptions,
		client: {
			async complete() {
				return result;
			},
			stream(request, callOption) {
				requests.push(request);
				callOptions.push(callOption);
				return createEventStream(async (emit) => {
					for (const chunk of options.chunks) {
						emit({ type: "text_delta", delta: chunk });
					}
					if (reasoning.length > 0) {
						emit({ type: "thinking_delta", delta: reasoning });
					}
					return result;
				});
			},
		},
	};
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
	store.appendNode({
		id: "n-greeting",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "你好，旅人。",
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

const REPLY_WITH_TAGS = `山门缓缓打开。
<state_update>{"path":["场景","地点"],"op":"set","value":"山门"}</state_update>
<plot_note>{"text":"门后有人跟踪"}</plot_note>`;

describe("runChatTurn", () => {
	it("文本标签模式：流式解析、写入 diff、保存 Trace", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests, options } = createFakeClient({
			chunks: splitChunks(REPLY_WITH_TAGS, 5),
			resultText: REPLY_WITH_TAGS,
		});
		const snapshots: string[] = [];

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我推开山门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			model: "fake",
			onTextDelta: (_delta, snapshot) => {
				snapshots.push(JSON.stringify(snapshot));
			},
		});

		expect(requests).toHaveLength(1);
		const request = requests[0] as LlmRequest;
		expect(request.tools).toBeUndefined();
		expect(request.model).toBe("fake");
		expect(request.messages.map((message) => message.role)).toEqual([
			"system",
			"system",
			"assistant",
			"user",
		]);
		expect(request.messages[0]?.content).toBe("你扮演山神。");
		expect(request.messages[1]?.content).toContain("<state_update>");
		expect(request.messages[3]?.content).toBe("我推开山门。");
		expect(options[0]?.continuation?.expectedTags).toEqual([
			"state_update",
			"plot_note",
		]);

		expect(result.userNode.role).toBe("user");
		expect(result.userNode.parentId).toBe("n-greeting");
		expect(result.node.role).toBe("assistant");
		expect(result.node.parentId).toBe(result.userNode.id);
		expect(result.node.raw).toBe(REPLY_WITH_TAGS);
		expect(store.getPathToNode(result.node.id).map((node) => node.id)).toEqual([
			"n-greeting",
			result.userNode.id,
			result.node.id,
		]);

		expect(result.stateDiffs).toHaveLength(1);
		expect(result.stateDiffs[0]).toMatchObject({
			path: ["场景", "地点"],
			op: "set",
			value: "山门",
			source: "structured-output:text-tags",
		});
		expect(result.structured.notes).toEqual([{ text: "门后有人跟踪" }]);
		expect(result.structured.issues).toEqual([]);
		expect(result.plotNotes).toHaveLength(1);
		expect(result.plotNotes[0]).toMatchObject({
			sourceNodeId: result.node.id,
			text: "门后有人跟踪",
			status: "open",
			fulfilledAt: null,
		});
		expect(store.getOpenPlotNotes("s1")).toEqual(result.plotNotes);

		const stateUpdateBlocks = result.blocks.filter(
			(block) => block.kind === "block" && block.name === "state_update",
		);
		expect(stateUpdateBlocks).toHaveLength(1);
		expect(snapshots.length).toBeGreaterThan(0);
		expect(snapshots.at(-1)).toContain("state_update");

		const trace = store.getTurnTrace(result.node.id);
		expect(trace).toEqual(result.trace);
		expect(trace?.llm).toMatchObject({
			model: "fake-model",
			channel: "fake-channel",
			usage: USAGE,
			stopReason: "stop",
		});
		expect(trace?.timing.firstTokenMs).not.toBeNull();
		expect(
			trace?.context.entries.map((entry) => [entry.segmentId, entry.status]),
		).toEqual([
			["character", "included"],
			["lore", "missing-slot"],
			["state", "missing-slot"],
			["summary", "missing-slot"],
			["memory", "missing-slot"],
			["director", "missing-slot"],
			["protocol", "included"],
			["history", "included"],
		]);
	});

	it("函数调用模式：带工具定义，非法负载记进 Trace", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient({
			chunks: splitChunks("他点了点头。", 3),
			resultText: "他点了点头。",
			toolCalls: [
				{
					id: "c1",
					name: "state_update",
					arguments: { path: ["角色", "好感度"], op: "set", value: 5 },
				},
				{ id: "c2", name: "plot_note", arguments: { text: "伏笔" } },
				{
					id: "c3",
					name: "state_update",
					arguments: { path: [], op: "set", value: 1 },
				},
			],
		});

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我看向他。",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
			model: "fake",
		});

		expect(requests[0]?.tools?.map((tool) => tool.name)).toEqual([
			"state_update",
			"plot_note",
			"memory_search",
			"lore_lookup",
			"state_get",
		]);
		expect(result.stateDiffs).toHaveLength(1);
		expect(result.stateDiffs[0]?.source).toBe(
			"structured-output:function-call",
		);
		expect(result.structured.notes).toHaveLength(1);
		expect(result.plotNotes).toHaveLength(1);
		expect(result.plotNotes[0]).toMatchObject({
			sourceNodeId: result.node.id,
			text: "伏笔",
			status: "open",
		});
		expect(store.getOpenPlotNotes("s1").map((note) => note.text)).toEqual([
			"伏笔",
		]);
		expect(result.structured.issues).toHaveLength(1);
		expect(result.structured.issues[0]?.payload).toBe("state_update");
		expect(result.trace.structured).toMatchObject({
			mode: "function-call",
			acceptedStateUpdates: 1,
			acceptedNotes: 1,
		});
		expect(result.trace.structured.issues).toHaveLength(1);
	});

	it("下一轮历史不带写入标签", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const first = createFakeClient({
			chunks: splitChunks(REPLY_WITH_TAGS, 7),
			resultText: REPLY_WITH_TAGS,
		});
		const firstTurn = await runChatTurn({
			store,
			client: first.client,
			storyId: "s1",
			userText: "我推开山门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
		});

		const second = createFakeClient({
			chunks: splitChunks("前方有雾。", 2),
			resultText: "前方有雾。",
		});
		await runChatTurn({
			store,
			client: second.client,
			storyId: "s1",
			userText: "我继续走。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
		});

		const messages = second.requests[0]?.messages ?? [];
		const historyRoles = messages.slice(-4).map((message) => message.role);
		expect(historyRoles).toEqual(["assistant", "user", "assistant", "user"]);
		const previousReply = messages.find(
			(message) =>
				message.role === "assistant" &&
				message.content.includes("山门缓缓打开"),
		);
		expect(previousReply?.content).not.toContain("<state_update>");
		expect(previousReply?.content).not.toContain("<plot_note>");
	});

	it("流式增量与最终正文不一致时抛错且不写助手楼层", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient({
			chunks: ["短"],
			resultText: "很长",
		});
		await expect(
			runChatTurn({
				store,
				client,
				storyId: "s1",
				userText: "我推开山门。",
				template: createDefaultContextTemplate({
					structuredOutput: "text-tags",
				}),
				providers: providers(store),
				budgetTokens: 4_000,
				structuredOutput: "text-tags",
			}),
		).rejects.toThrow("不一致");
		expect(store.getHead("s1")?.role).toBe("user");
	});

	it("写笔记失败时助手楼层与笔记一起回滚", async () => {
		const { store, path } = openTempStore();
		seedStory(store);
		const raw = new Database(path);
		try {
			raw.exec(`CREATE TRIGGER test_abort_notes
				BEFORE INSERT ON plot_notes
				BEGIN
					SELECT RAISE(ABORT, '笔记写入失败');
				END`);
		} finally {
			raw.close();
		}
		const { client } = createFakeClient({
			chunks: splitChunks(REPLY_WITH_TAGS, 9),
			resultText: REPLY_WITH_TAGS,
		});

		await expect(
			runChatTurn({
				store,
				client,
				storyId: "s1",
				userText: "我推开山门。",
				template: createDefaultContextTemplate({
					structuredOutput: "text-tags",
				}),
				providers: providers(store),
				budgetTokens: 4_000,
				structuredOutput: "text-tags",
			}),
		).rejects.toThrow("笔记写入失败");

		expect(store.getOpenPlotNotes("s1")).toEqual([]);
		expect(store.getPathToHead("s1").map((node) => node.role)).toEqual([
			"assistant",
			"user",
		]);
	});
});
