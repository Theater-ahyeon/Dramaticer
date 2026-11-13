import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import type {
	LlmCallOptions,
	LlmClient,
	LlmRequest,
	LlmResult,
} from "../src/index.js";
import {
	StoryStore,
	buildAssistantRequestMessages,
	compactAssistantConversation,
	estimateAssistantContext,
} from "../src/index.js";

function openTempStore(): StoryStore {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-assistant-context-")),
		"story.db",
	);
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(path), { recursive: true, force: true, maxRetries: 5 });
	});
	return store;
}

class FakeCompactionClient implements LlmClient {
	readonly requests: LlmRequest[] = [];
	readonly #reply: string | Error;

	constructor(reply: string | Error = "摘要：较早的对话。") {
		this.#reply = reply;
	}

	async complete(request: LlmRequest, _options?: LlmCallOptions) {
		this.requests.push(request);
		if (this.#reply instanceof Error) throw this.#reply;
		const result: LlmResult = {
			text: this.#reply,
			reasoning: "",
			toolCalls: [],
			finishReason: "stop",
			stopReason: "stop",
			model: "fake-model",
			channel: "fake",
			usage: {
				promptTokens: 10,
				completionTokens: 5,
				totalTokens: 15,
				reasoningTokens: 0,
				cachedTokens: 0,
			},
			raw: null,
			cached: false,
			attempts: 1,
			rounds: 1,
			truncation: null,
			continuation: null,
		};
		return result;
	}
}

function seedConversation(store: StoryStore, count = 12) {
	const conversation = store.createAssistantConversation({
		skill: "troubleshoot",
		contextBudget: 1_000,
	});
	for (let index = 1; index <= count; index += 1) {
		store.appendAssistantMessage({
			conversationId: conversation.id,
			role: index % 2 === 1 ? "user" : "assistant",
			text: `第 ${index} 条消息`,
			createdAt: `2026-11-13T00:00:${String(index).padStart(2, "0")}.000Z`,
		});
	}
	return conversation;
}

describe("助手上下文用量", () => {
	it("按系统提示、摘要、消息与工具结果分别估算", () => {
		const store = openTempStore();
		const conversation = seedConversation(store, 3);
		store.appendAssistantMessage({
			conversationId: conversation.id,
			role: "tool",
			text: "",
			toolName: "explain_node",
			toolResult: { ok: true, content: "没有记录" },
		});
		const usage = estimateAssistantContext({
			systemPrompt: "你是助手。",
			messages: store.getAssistantMessages(conversation.id),
			compaction: null,
			contextBudget: 1_000,
			estimator: (text) => text.length,
		});
		expect(usage.parts.map((part) => part.id)).toEqual([
			"system",
			"summary",
			"messages",
			"tools",
		]);
		expect(usage.parts.find((part) => part.id === "system")?.tokens).toBe(5);
		expect(usage.parts.find((part) => part.id === "summary")?.tokens).toBe(0);
		const toolPart = usage.parts.find((part) => part.id === "tools");
		expect(toolPart?.tokens).toBeGreaterThan(0);
		expect(usage.used).toBe(
			usage.parts.reduce((sum, part) => sum + part.tokens, 0),
		);
		expect(usage.percent).toBe(usage.used / 1_000);
	});

	it("压缩后省略的消息不计入，摘要计入", () => {
		const store = openTempStore();
		const conversation = seedConversation(store, 4);
		const compaction = store.createAssistantCompaction({
			conversationId: conversation.id,
			summary: "摘要正文",
			omittedMessageIds: [1, 2],
			beforeTokens: 100,
			afterTokens: 40,
		});
		const usage = estimateAssistantContext({
			systemPrompt: "提示",
			messages: store.getAssistantMessages(conversation.id),
			compaction,
			contextBudget: 100,
			estimator: (text) => text.length,
		});
		const summary = usage.parts.find((part) => part.id === "summary");
		expect(summary?.tokens).toBeGreaterThan(0);
		const messages = usage.parts.find((part) => part.id === "messages");
		expect(messages?.tokens).toBe("第 3 条消息".length + "第 4 条消息".length);
	});

	it("请求消息用一条 system 摘要替代被省略的消息", () => {
		const store = openTempStore();
		const conversation = seedConversation(store, 3);
		const compaction = store.createAssistantCompaction({
			conversationId: conversation.id,
			summary: "摘要正文",
			omittedMessageIds: [1],
			beforeTokens: 100,
			afterTokens: 40,
		});
		const messages = buildAssistantRequestMessages({
			systemPrompt: "系统提示",
			messages: store.getAssistantMessages(conversation.id),
			compaction,
		});
		expect(messages).toEqual([
			{ role: "system", content: "系统提示" },
			{ role: "system", content: "更早对话的摘要：\n摘要正文" },
			{ role: "assistant", content: "第 2 条消息" },
			{ role: "user", content: "第 3 条消息" },
		]);
	});
});

describe("助手上下文压缩", () => {
	it("省略较早消息、保留最近十条，并记录前后 token", async () => {
		const store = openTempStore();
		const conversation = seedConversation(store, 12);
		const client = new FakeCompactionClient("摘要");
		const outcome = await compactAssistantConversation({
			store,
			client,
			conversationId: conversation.id,
			systemPrompt: "系统提示",
			model: "fake-model",
			estimator: (text) => text.length,
		});
		expect(outcome).not.toBeNull();
		expect(outcome?.compaction.seq).toBe(1);
		expect(outcome?.compaction.omittedMessageIds).toEqual([1, 2]);
		expect(outcome?.compaction.summary).toBe("摘要");
		expect(outcome?.after.used).toBeLessThan(outcome?.before.used ?? 0);
		expect(outcome?.before.used).toBe(outcome?.compaction.beforeTokens ?? -1);
		expect(store.getAssistantMessages(conversation.id)).toHaveLength(12);
		expect(client.requests).toHaveLength(1);
		const request = client.requests[0];
		const content = request?.messages[1]?.content;
		expect(content).toContain("[用户 #1] 第 1 条消息");
		expect(content).toContain("[助手 #2] 第 2 条消息");
		expect(content).not.toContain("第 3 条消息");
	});

	it("手动压缩的要求进入摘要请求", async () => {
		const store = openTempStore();
		const conversation = seedConversation(store, 12);
		const client = new FakeCompactionClient("摘要：保留结论。");
		await compactAssistantConversation({
			store,
			client,
			conversationId: conversation.id,
			systemPrompt: "系统提示",
			instructions: "保留排障结论",
		});
		expect(client.requests[0]?.messages[1]?.content).toContain(
			"附加要求：保留排障结论",
		);
	});

	it("第二次压缩带上已有摘要，并把省略序号合并", async () => {
		const store = openTempStore();
		const conversation = seedConversation(store, 12);
		await compactAssistantConversation({
			store,
			client: new FakeCompactionClient("第一次摘要"),
			conversationId: conversation.id,
			systemPrompt: "系统提示",
		});
		for (let index = 13; index <= 14; index += 1) {
			store.appendAssistantMessage({
				conversationId: conversation.id,
				role: index % 2 === 1 ? "user" : "assistant",
				text: `第 ${index} 条消息`,
			});
		}
		const client = new FakeCompactionClient("第二次摘要");
		const outcome = await compactAssistantConversation({
			store,
			client,
			conversationId: conversation.id,
			systemPrompt: "系统提示",
		});
		expect(outcome?.compaction.seq).toBe(2);
		expect(outcome?.compaction.omittedMessageIds).toEqual([1, 2, 3, 4]);
		expect(client.requests[0]?.messages[1]?.content).toContain(
			"已有摘要：\n第一次摘要",
		);
	});

	it("消息不超过保留条数时不调用模型", async () => {
		const store = openTempStore();
		const conversation = seedConversation(store, 10);
		const client = new FakeCompactionClient();
		const outcome = await compactAssistantConversation({
			store,
			client,
			conversationId: conversation.id,
			systemPrompt: "系统提示",
		});
		expect(outcome).toBeNull();
		expect(client.requests).toHaveLength(0);
		expect(store.getAssistantCompaction(conversation.id)).toBeNull();
	});

	it("有等待确认的动作时不省略产生它的那段对话", async () => {
		const store = openTempStore();
		const story = store.createStory({ id: "story-1", title: "测试故事" });
		const root = store.appendNode({
			storyId: story.id,
			parentId: null,
			role: "system",
			raw: "系统",
		});
		store.appendNode({
			storyId: story.id,
			parentId: root.id,
			role: "user",
			raw: "开场",
		});
		const conversation = store.createAssistantConversation({
			storyId: story.id,
			skill: "ledger_revision",
		});
		for (let index = 1; index <= 12; index += 1) {
			store.appendAssistantMessage({
				conversationId: conversation.id,
				role: index % 2 === 1 ? "user" : "assistant",
				text: `第 ${index} 条消息`,
				createdAt: `2026-11-13T00:00:${String(index).padStart(2, "0")}.000Z`,
			});
		}
		store.createAssistantAction({
			conversationId: conversation.id,
			kind: "settings",
			summary: "打开快回合",
			payload: { turnMode: "fast" },
			createdAt: "2026-11-13T00:00:02.500Z",
		});
		const outcome = await compactAssistantConversation({
			store,
			client: new FakeCompactionClient(),
			conversationId: conversation.id,
			systemPrompt: "系统提示",
		});
		expect(outcome?.compaction.omittedMessageIds).toEqual([1, 2]);
	});

	it("摘要请求失败时保留原消息，不写压缩记录", async () => {
		const store = openTempStore();
		const conversation = seedConversation(store, 12);
		const client = new FakeCompactionClient(new Error("渠道失败"));
		await expect(
			compactAssistantConversation({
				store,
				client,
				conversationId: conversation.id,
				systemPrompt: "系统提示",
			}),
		).rejects.toThrow(/渠道失败/);
		expect(store.getAssistantCompaction(conversation.id)).toBeNull();
		expect(store.getAssistantMessages(conversation.id)).toHaveLength(12);
	});
});
