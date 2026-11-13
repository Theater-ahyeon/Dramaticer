import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import type {
	LlmCallOptions,
	LlmRequest,
	LlmResult,
	LlmStream,
	LlmStreamEvent,
	LlmStreamingClient,
	LlmToolCall,
} from "../src/index.js";
import {
	ASSISTANT_TOOL_NAMES,
	AssistantRunConflictError,
	StoryStore,
	createAssistantTools,
	runAssistantTurn,
} from "../src/index.js";

const USAGE = {
	promptTokens: 21,
	completionTokens: 9,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

function openTempStore(): StoryStore {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-assistant-runtime-")),
		"story.db",
	);
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(path), { recursive: true, force: true, maxRetries: 5 });
	});
	return store;
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "story-1", title: "测试故事" });
	const root = store.appendNode({
		id: "n-root",
		storyId: "story-1",
		parentId: null,
		role: "system",
		raw: "你是故事引擎。",
	});
	store.appendNode({
		id: "n-user",
		storyId: "story-1",
		parentId: root.id,
		role: "user",
		raw: "我推开古老的山门。",
	});
}

interface FakeReply {
	readonly text: string;
	readonly thinking?: string;
	readonly toolCalls?: readonly LlmToolCall[];
	/** 发完正文后挂起，直到请求被中止。 */
	readonly hangAfterText?: boolean;
	/** 发出第一个事件前等待的闸门。 */
	readonly wait?: Promise<void>;
}

class ScriptedClient implements LlmStreamingClient {
	readonly requests: LlmRequest[] = [];
	readonly #replies: FakeReply[];
	readonly #started: (() => void) | null;

	constructor(replies: readonly FakeReply[], onStart?: () => void) {
		this.#replies = [...replies];
		this.#started = onStart ?? null;
	}

	async complete(): Promise<LlmResult> {
		throw new Error("助手运行不应该调用 complete");
	}

	stream(request: LlmRequest, _options?: LlmCallOptions): LlmStream {
		this.requests.push(request);
		this.#started?.();
		const reply = this.#replies.shift();
		if (reply === undefined) {
			throw new Error("测试没有准备这一轮回复");
		}
		const events: LlmStreamEvent[] = [];
		if (reply.thinking !== undefined) {
			events.push({ type: "thinking_delta", delta: reply.thinking });
		}
		for (const char of reply.text) {
			events.push({ type: "text_delta", delta: char });
		}
		const result: LlmResult = {
			text: reply.text,
			reasoning: reply.thinking ?? "",
			toolCalls: reply.toolCalls ?? [],
			finishReason: (reply.toolCalls ?? []).length > 0 ? "tool_calls" : "stop",
			stopReason: (reply.toolCalls ?? []).length > 0 ? "toolUse" : "stop",
			model: "fake-model",
			channel: "fake",
			usage: USAGE,
			raw: null,
			cached: false,
			attempts: 1,
			rounds: 1,
			truncation: null,
			continuation: null,
		};
		let index = 0;
		let waited = false;
		return {
			[Symbol.asyncIterator]() {
				return this;
			},
			async next(): Promise<IteratorResult<LlmStreamEvent>> {
				const signal = request.signal;
				if (signal?.aborted) throw signal.reason;
				if (!waited) {
					waited = true;
					if (reply.wait !== undefined) await reply.wait;
				}
				if (index < events.length) {
					const event = events[index] as LlmStreamEvent;
					index += 1;
					return { done: false, value: event };
				}
				if (reply.hangAfterText === true) {
					if (signal === undefined) {
						throw new Error("挂起的回复需要中止信号");
					}
					const aborted = Promise.withResolvers<never>();
					signal.addEventListener(
						"abort",
						() => aborted.reject(signal.reason),
						{ once: true },
					);
					await aborted.promise;
				}
				return { done: true, value: undefined };
			},
			async result(): Promise<LlmResult> {
				return result;
			},
		};
	}
}

function toolCall(
	id: string,
	name: string,
	args: Record<string, unknown>,
): LlmToolCall {
	return { id, name, arguments: args };
}

describe("助手运行时", () => {
	it("排障问答调用 explain_node 并读回报告，不写楼层与运行表", async () => {
		const store = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "troubleshoot",
		});
		const client = new ScriptedClient([
			{
				text: "",
				toolCalls: [toolCall("call-1", "explain_node", { nodeId: "n-user" })],
			},
			{ text: "楼层 n-user 没有 Trace，因此上下文分段与检索都是没有记录。" },
		]);
		const headBefore = store.getHead("story-1")?.id ?? null;
		const pathBefore = store.getPathToHead("story-1").map((node) => node.raw);
		const nodeCountBefore = store.getPathToHead("story-1").length;
		const result = await runAssistantTurn({
			store,
			client,
			conversationId: conversation.id,
			userText: "为什么这一楼忘了山门？",
			systemPrompt: "你是排障助手。",
		});
		expect(result.status).toBe("completed");
		expect(result.stopReason).toBe("completed");
		expect(result.text).toContain("没有记录");
		expect(result.userMessage.role).toBe("user");
		expect(result.assistantMessage?.role).toBe("assistant");

		const messages = store.getAssistantMessages(conversation.id);
		expect(messages.map((message) => message.role)).toEqual([
			"user",
			"tool",
			"assistant",
		]);
		const toolMessage = messages[1];
		expect(toolMessage?.toolName).toBe("explain_node");
		expect(JSON.stringify(toolMessage?.toolResult)).toContain("没有记录");

		const events = store.listAssistantEvents(conversation.id);
		expect(events.map((event) => event.kind)).toEqual(
			expect.arrayContaining([
				"started",
				"tool.call",
				"tool.result",
				"usage",
				"completed",
			]),
		);
		const updated = store.getAssistantConversation(conversation.id);
		expect(updated?.status).toBe("completed");
		const completed = events.find((event) => event.kind === "completed");
		expect(completed?.payload.stopReason).toBe("completed");
		expect(store.getHead("story-1")?.id ?? null).toBe(headBefore);
		expect(store.getPathToHead("story-1").map((node) => node.raw)).toEqual(
			pathBefore,
		);
		expect(store.getPathToHead("story-1").length).toBe(nodeCountBefore);
		expect(store.listTurnRuns("story-1")).toEqual([]);
		expect(store.getTurnTrace("n-user")).toBeNull();
		expect(store.getStateDiffs("n-user")).toEqual([]);
	});

	it("工具集只有只读工具，没有写入与生图工具", () => {
		const store = openTempStore();
		seedStory(store);
		const tools = createAssistantTools({ store, storyId: null });
		expect(tools.map((tool) => tool.name)).toEqual([...ASSISTANT_TOOL_NAMES]);
		expect(tools.every((tool) => tool.permission === "read")).toBe(true);
		const names = tools.map((tool) => tool.name);
		for (const forbidden of [
			"draft_write",
			"draft_commit",
			"note_write",
			"ledger_write",
			"illustrate",
		]) {
			expect(names).not.toContain(forbidden);
		}
	});

	it("工具结果超过上限时截断并写明截断位置", async () => {
		const store = openTempStore();
		seedStory(store);
		store.updateStorySettings("story-1", {
			characterPrompt: "设定".repeat(20_000),
		});
		const tools = createAssistantTools({
			store,
			storyId: "story-1",
		});
		const settings = tools.find((tool) => tool.name === "settings_read");
		if (settings?.execute === undefined) {
			throw new Error("settings_read 没有执行函数");
		}
		const content = await settings.execute({});
		expect(typeof content).toBe("string");
		const text = content as string;
		expect(text).toContain("工具结果已截断");
		expect(text).toContain("截断位置 32000");
		expect(text.length).toBeLessThan(40_100);
	});

	it("同一会话并发启动被拒绝", async () => {
		const store = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "troubleshoot",
		});
		const gate = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		const client = new ScriptedClient(
			[{ text: "第一轮", wait: gate.promise }],
			() => started.resolve(),
		);
		const first = runAssistantTurn({
			store,
			client,
			conversationId: conversation.id,
			userText: "第一句",
			systemPrompt: "你是排障助手。",
		});
		await started.promise;
		await expect(
			runAssistantTurn({
				store,
				client,
				conversationId: conversation.id,
				userText: "第二句",
				systemPrompt: "你是排障助手。",
			}),
		).rejects.toBeInstanceOf(AssistantRunConflictError);
		gate.resolve();
		const result = await first;
		expect(result.status).toBe("completed");
		expect(
			store
				.getAssistantMessages(conversation.id)
				.filter((message) => message.role === "user"),
		).toHaveLength(1);
	});

	it("取消把状态写成 cancelled 并保留已生成的正文", async () => {
		const store = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "guide",
		});
		const controller = new AbortController();
		const firstDelta = Promise.withResolvers<void>();
		const client = new ScriptedClient([{ text: "部分", hangAfterText: true }]);
		const running = runAssistantTurn({
			store,
			client,
			conversationId: conversation.id,
			userText: "怎么用？",
			systemPrompt: "你是使用指南。",
			signal: controller.signal,
			onEvent: (event) => {
				if (event.kind === "text.delta") firstDelta.resolve();
			},
		});
		await firstDelta.promise;
		controller.abort(new Error("玩家取消"));
		const result = await running;
		expect(result.status).toBe("cancelled");
		expect(result.text).toBe("部分");
		expect(result.assistantMessage?.text).toBe("部分");
		expect(store.getAssistantConversation(conversation.id)?.status).toBe(
			"cancelled",
		);
		expect(
			store
				.listAssistantEvents(conversation.id)
				.filter((event) => event.kind === "error"),
		).toHaveLength(1);
	});

	it("工具调用达到上限后正常结束，不留在 running", async () => {
		const store = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "troubleshoot",
		});
		const call = toolCall("call-1", "explain_node", { nodeId: "n-user" });
		const client = new ScriptedClient([
			{ text: "", toolCalls: [call] },
			{ text: "", toolCalls: [{ ...call, id: "call-2" }] },
		]);
		const result = await runAssistantTurn({
			store,
			client,
			conversationId: conversation.id,
			userText: "再查一次",
			systemPrompt: "你是排障助手。",
			maxToolCalls: 1,
		});
		expect(result.status).toBe("completed");
		expect(result.stopReason).toBe("max_tool_calls");
		expect(result.toolCallCount).toBe(1);
		expect(store.getAssistantConversation(conversation.id)?.status).toBe(
			"completed",
		);
	});

	it("运行超时按正常收束，状态不留在 running", async () => {
		const store = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "troubleshoot",
		});
		const client = new ScriptedClient([
			{
				text: "",
				toolCalls: [toolCall("call-1", "explain_node", { nodeId: "n-user" })],
			},
		]);
		let clock = 0;
		const now = (): number => {
			clock += 40_000;
			return clock;
		};
		const result = await runAssistantTurn({
			store,
			client,
			conversationId: conversation.id,
			userText: "查一下",
			systemPrompt: "你是排障助手。",
			maxDurationMs: 60_000,
			now,
		});
		expect(result.error).toBeNull();
		expect(result.status).toBe("completed");
		expect(result.stopReason).toBe("timeout");
		expect(store.getAssistantConversation(conversation.id)?.status).toBe(
			"completed",
		);
	});
});
