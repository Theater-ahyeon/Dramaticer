import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	LlmCallOptions,
	LlmChannelsConfig,
	LlmRequest,
	LlmResult,
	LlmStream,
	LlmStreamEvent,
	LlmStreamingClient,
	LlmToolCall,
} from "@dramaticer/core";
import type {
	ApiErrorResponse,
	AssistantActionDecisionView,
	AssistantActionListView,
	AssistantCancelView,
	AssistantConversationDetailView,
	AssistantConversationEventsView,
	AssistantConversationListView,
	AssistantConversationStatusView,
	AssistantConversationView,
	AssistantSseEventMap,
	AssistantSseEventName,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-assistant-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

async function startTestServer(): Promise<RunningServer> {
	const dir = tempDir();
	const webRoot = join(dir, "web");
	mkdirSync(webRoot, { recursive: true });
	writeFileSync(
		join(webRoot, "index.html"),
		"<!doctype html><title>应用</title>",
	);
	const running = await startServer({
		dbPath: join(dir, "story.db"),
		webRoot,
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => {},
	});
	onTestFinished(() => running.close());
	return running;
}

function request(
	origin: string,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${origin}${path}`, {
		...init,
		headers: { "Content-Type": "application/json", ...init.headers },
	});
}

function post(origin: string, path: string, body: unknown): Promise<Response> {
	return request(origin, path, { method: "POST", body: JSON.stringify(body) });
}

function fakeConfig(modelId = "fake-model"): LlmChannelsConfig {
	return {
		channels: new Map([
			[
				"fake",
				{
					id: "fake",
					api: "openai-completions",
					baseUrl: "http://127.0.0.1:9",
					apiKey: "",
					requestsPerMinute: 0,
					maxRetries: 0,
					retryBaseDelayMs: 0,
					timeoutMs: 1_000,
				},
			],
		]),
		models: new Map([
			[
				"main",
				{
					alias: "main",
					id: modelId,
					contextWindow: 8_192,
					maxTokens: 1_024,
					reasoning: true,
					enabled: true,
					channels: ["fake"],
					tools: null,
					probe: null,
				},
			],
		]),
		roles: new Map(),
		embeddings: new Map(),
	};
}

interface FakeReply {
	readonly text: string;
	readonly toolCalls?: readonly LlmToolCall[];
	/** 发完正文后挂起，直到请求被中止。 */
	readonly hangAfterText?: boolean;
}

class ScriptedClient implements LlmStreamingClient {
	readonly requests: LlmRequest[] = [];
	readonly #replies: FakeReply[];

	constructor(replies: readonly FakeReply[]) {
		this.#replies = [...replies];
	}

	async complete(): Promise<LlmResult> {
		throw new Error("助手运行不应该调用 complete");
	}

	stream(request: LlmRequest, _options?: LlmCallOptions): LlmStream {
		this.requests.push(request);
		const reply = this.#replies.shift();
		if (reply === undefined) {
			throw new Error("测试没有准备这一轮回复");
		}
		const events: LlmStreamEvent[] = [];
		for (const char of reply.text) {
			events.push({ type: "text_delta", delta: char });
		}
		const result: LlmResult = {
			text: reply.text,
			reasoning: "",
			toolCalls: reply.toolCalls ?? [],
			finishReason: (reply.toolCalls ?? []).length > 0 ? "tool_calls" : "stop",
			stopReason: (reply.toolCalls ?? []).length > 0 ? "toolUse" : "stop",
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
		let index = 0;
		return {
			[Symbol.asyncIterator]() {
				return this;
			},
			async next(): Promise<IteratorResult<LlmStreamEvent>> {
				const signal = request.signal;
				if (signal?.aborted) throw signal.reason;
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

interface Frame {
	readonly event?: string;
	readonly data?: unknown;
}

function parseFrames(raw: string): Frame[] {
	return raw
		.split("\n\n")
		.filter((block) => block.trim().length > 0)
		.map((block) => {
			let event = "message";
			const dataLines: string[] = [];
			for (const line of block.split("\n")) {
				if (line.startsWith("event: ")) event = line.slice("event: ".length);
				if (line.startsWith("data: ")) {
					dataLines.push(line.slice("data: ".length));
				}
			}
			return {
				event,
				data:
					dataLines.length > 0
						? (JSON.parse(dataLines.join("\n")) as unknown)
						: undefined,
			};
		});
}

function frameData<N extends AssistantSseEventName>(
	frames: readonly Frame[],
	event: N,
): AssistantSseEventMap[N] {
	const frame = frames.find((item) => item.event === event);
	if (frame === undefined) throw new Error(`没有收到事件 ${event}`);
	return frame.data as AssistantSseEventMap[N];
}

async function startTestServerWithChannels(
	client: LlmStreamingClient,
	dbPath?: string,
): Promise<RunningServer> {
	const dir = tempDir();
	const webRoot = join(dir, "web");
	mkdirSync(webRoot, { recursive: true });
	writeFileSync(
		join(webRoot, "index.html"),
		"<!doctype html><title>应用</title>",
	);
	const running = await startServer({
		dbPath: dbPath ?? join(dir, "story.db"),
		webRoot,
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => {},
		heartbeatMs: 20,
		channels: {
			path: writeChannelsConfig(dir),
			env: { FAKE_KEY: "sk-test" },
			load: async () => fakeConfig(),
			createClient: () => client,
		},
	});
	onTestFinished(() => running.close());
	return running;
}

function writeChannelsConfig(dir: string): string {
	const file = join(dir, "channels.yaml");
	writeFileSync(
		file,
		[
			"channels:",
			"  fake:",
			"    api: openai-completions",
			"    baseUrl: http://127.0.0.1:9",
			"    apiKey: ${FAKE_KEY}",
			"models:",
			"  main:",
			"    id: fake-model",
			"    channels: [fake]",
			"roles:",
			"  writer: main",
			"",
		].join("\n"),
	);
	return file;
}

function patch(origin: string, path: string, body: unknown): Promise<Response> {
	return request(origin, path, { method: "PATCH", body: JSON.stringify(body) });
}

async function errorBody(response: Response): Promise<ApiErrorResponse> {
	return (await response.json()) as ApiErrorResponse;
}

async function createConversation(
	origin: string,
	body: unknown,
): Promise<AssistantConversationView> {
	const response = await post(origin, "/api/assistant/conversations", body);
	expect(response.status).toBe(201);
	return (await response.json()) as AssistantConversationView;
}

describe("助手会话接口", () => {
	it("创建、搜索、改名、改权限、删除与错误字段", async () => {
		const running = await startTestServer();
		const { store } = running;
		store.createStory({ id: "story-1", title: "测试故事" });
		const root = store.appendNode({
			storyId: "story-1",
			parentId: null,
			role: "system",
			raw: "你是故事引擎。",
		});
		const user = store.appendNode({
			storyId: "story-1",
			parentId: root.id,
			role: "user",
			raw: "我推开古老的山门。",
		});
		const headBefore = store.getHead("story-1")?.id ?? null;
		const nodeCountBefore = store.getPathToHead("story-1").length;

		const empty = await request(running.origin, "/api/assistant/conversations");
		expect(empty.status).toBe(200);
		expect(
			((await empty.json()) as AssistantConversationListView).conversations,
		).toEqual([]);

		const titled = await createConversation(running.origin, {
			storyId: "story-1",
			skill: "troubleshoot",
			title: "山门为什么重复",
		});
		expect(titled.storyId).toBe("story-1");
		expect(titled.permission).toBe("confirm");
		expect(titled.status).toBe("idle");
		expect(titled.contextBudget).toBe(48_000);

		const bodyMatch = await createConversation(running.origin, {
			storyId: "story-1",
			skill: "guide",
			title: "剧情参谋",
			thinking: "high",
		});
		store.appendAssistantMessage({
			conversationId: bodyMatch.id,
			role: "assistant",
			text: "上一轮反复写了山门之外的风。",
		});

		const search = await request(
			running.origin,
			"/api/assistant/conversations?query=%E5%B1%B1%E9%97%A8&storyId=story-1",
		);
		expect(search.status).toBe(200);
		const searchBody = (await search.json()) as AssistantConversationListView;
		expect(searchBody.conversations.map((item) => item.id)).toEqual(
			expect.arrayContaining([titled.id, bodyMatch.id]),
		);
		expect(searchBody.matches).toHaveLength(searchBody.conversations.length);
		const titleIndex = searchBody.conversations.findIndex(
			(item) => item.id === titled.id,
		);
		expect(searchBody.matches?.[titleIndex]?.matchedIn).toBe("title");
		expect(searchBody.matches?.[titleIndex]?.snippet).toContain("[山门]");
		const messageIndex = searchBody.conversations.findIndex(
			(item) => item.id === bodyMatch.id,
		);
		expect(searchBody.matches?.[messageIndex]?.matchedIn).toBe("message");
		expect(searchBody.matches?.[messageIndex]?.messageOrdinal).toBe(1);

		const detail = await request(
			running.origin,
			`/api/assistant/conversations/${bodyMatch.id}`,
		);
		expect(detail.status).toBe(200);
		const detailBody = (await detail.json()) as AssistantConversationDetailView;
		expect(detailBody.conversation.id).toBe(bodyMatch.id);
		expect(detailBody.messages).toHaveLength(1);
		expect(detailBody.messages[0]?.text).toContain("山门");

		const renamed = await patch(
			running.origin,
			`/api/assistant/conversations/${titled.id}`,
			{
				title: "为什么忘了剑冢",
				permission: "read_only",
				modelAlias: "main-fallback",
				thinking: "low",
				contextBudget: 64_000,
				compactionThreshold: 0.9,
			},
		);
		expect(renamed.status).toBe(200);
		const renamedBody = (await renamed.json()) as AssistantConversationView;
		expect(renamedBody.title).toBe("为什么忘了剑冢");
		expect(renamedBody.permission).toBe("read_only");
		expect(renamedBody.modelAlias).toBe("main-fallback");
		expect(renamedBody.thinking).toBe("low");
		expect(renamedBody.contextBudget).toBe(64_000);
		expect(renamedBody.compactionThreshold).toBe(0.9);

		const status = await request(
			running.origin,
			`/api/assistant/conversations/${titled.id}/status`,
		);
		const statusBody = (await status.json()) as AssistantConversationStatusView;
		expect(statusBody.status).toBe("idle");
		expect(statusBody.lastEventSeq).toBe(0);
		store.appendAssistantEvent({
			conversationId: titled.id,
			kind: "started",
			payload: { skill: "troubleshoot" },
		});
		store.appendAssistantEvent({
			conversationId: titled.id,
			kind: "completed",
			payload: { status: "completed" },
		});
		const events = await request(
			running.origin,
			`/api/assistant/conversations/${titled.id}/events?after=1`,
		);
		const eventsBody = (await events.json()) as AssistantConversationEventsView;
		expect(eventsBody.after).toBe(1);
		expect(eventsBody.lastSeq).toBe(2);
		expect(eventsBody.events.map((event) => event.kind)).toEqual(["completed"]);

		const removed = await request(
			running.origin,
			`/api/assistant/conversations/${bodyMatch.id}`,
			{ method: "DELETE" },
		);
		expect(removed.status).toBe(204);
		const missing = await request(
			running.origin,
			`/api/assistant/conversations/${bodyMatch.id}`,
		);
		expect(missing.status).toBe(404);
		expect(() => store.getAssistantMessages(bodyMatch.id)).toThrow(/不存在/);

		for (const response of [
			await request(running.origin, "/api/assistant/conversations/missing"),
			await patch(running.origin, "/api/assistant/conversations/missing", {
				title: "不存在",
			}),
			await request(running.origin, "/api/assistant/conversations/missing", {
				method: "DELETE",
			}),
		]) {
			expect(response.status).toBe(404);
		}

		const unknownSkill = await post(
			running.origin,
			"/api/assistant/conversations",
			{ skill: "unknown" },
		);
		expect(unknownSkill.status).toBe(400);
		expect((await errorBody(unknownSkill)).error.details).toEqual({
			path: "skill",
		});
		const badThreshold = await post(
			running.origin,
			"/api/assistant/conversations",
			{ skill: "troubleshoot", compactionThreshold: 0.2 },
		);
		expect(badThreshold.status).toBe(400);
		expect((await errorBody(badThreshold)).error.details).toEqual({
			path: "compactionThreshold",
		});
		const unknownField = await patch(
			running.origin,
			`/api/assistant/conversations/${titled.id}`,
			{ nope: true },
		);
		expect(unknownField.status).toBe(400);
		expect((await errorBody(unknownField)).error.details).toEqual({
			path: "nope",
		});
		const missingStory = await post(
			running.origin,
			"/api/assistant/conversations",
			{ skill: "guide", storyId: "nope" },
		);
		expect(missingStory.status).toBe(404);

		expect(store.getHead("story-1")?.id ?? null).toBe(headBefore);
		expect(store.getPathToHead("story-1").length).toBe(nodeCountBefore);
		expect(store.getNode(user.id)?.raw).toBe("我推开古老的山门。");
		expect(store.getStateDiffs(user.id)).toEqual([]);
	});
});

class FrameReader {
	readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
	readonly #decoder = new TextDecoder();
	readonly #queue: Frame[] = [];
	#buffer = "";
	#done = false;

	constructor(response: Response) {
		if (response.body === null) throw new Error("响应没有正文流");
		this.#reader = response.body.getReader();
	}

	async next(): Promise<Frame | null> {
		for (;;) {
			const frame = this.#queue.shift();
			if (frame !== undefined) return frame;
			if (this.#done) return null;
			const { done, value } = await this.#reader.read();
			if (done) {
				this.#done = true;
				continue;
			}
			this.#buffer += this.#decoder.decode(value, { stream: true });
			let split = this.#buffer.indexOf("\n\n");
			while (split !== -1) {
				this.#queue.push(...parseFrames(this.#buffer.slice(0, split)));
				this.#buffer = this.#buffer.slice(split + 2);
				split = this.#buffer.indexOf("\n\n");
			}
		}
	}

	async readUntil(predicate: (frame: Frame) => boolean): Promise<Frame[]> {
		const frames: Frame[] = [];
		for (;;) {
			const frame = await this.next();
			if (frame === null) return frames;
			frames.push(frame);
			if (predicate(frame)) return frames;
		}
	}

	async readAll(): Promise<Frame[]> {
		return await this.readUntil(() => false);
	}
}

function seedStory(running: RunningServer): {
	readonly userNodeId: string;
} {
	running.store.createStory({ id: "story-1", title: "测试故事" });
	const root = running.store.appendNode({
		id: "n-root",
		storyId: "story-1",
		parentId: null,
		role: "system",
		raw: "你是故事引擎。",
	});
	const user = running.store.appendNode({
		id: "n-user",
		storyId: "story-1",
		parentId: root.id,
		role: "user",
		raw: "我推开古老的山门。",
	});
	return { userNodeId: user.id };
}

describe("助手消息接口", () => {
	it("SSE 推送工具事件并写入消息与事件，不写楼层", async () => {
		const call: LlmToolCall = {
			id: "call-1",
			name: "explain_node",
			arguments: { nodeId: "n-user" },
		};
		const client = new ScriptedClient([
			{ text: "", toolCalls: [call] },
			{ text: "楼层 n-user 没有 Trace，因此上下文与检索都是没有记录。" },
		]);
		const running = await startTestServerWithChannels(client);
		seedStory(running);
		const conversation = await createConversation(running.origin, {
			storyId: "story-1",
			skill: "troubleshoot",
		});
		const headBefore = running.store.getHead("story-1")?.id ?? null;
		const nodeCountBefore = running.store.getPathToHead("story-1").length;

		const response = await post(
			running.origin,
			`/api/assistant/conversations/${conversation.id}/messages`,
			{ text: "为什么这一楼忘了山门？" },
		);
		expect(response.status).toBe(200);
		const frames = parseFrames(await response.text());
		const names = frames.map((frame) => frame.event);
		expect(names).toContain("assistant.started");
		expect(names).toContain("assistant.tool.call");
		expect(names).toContain("assistant.tool.result");
		expect(names).toContain("assistant.usage");
		expect(names).toContain("assistant.completed");
		const toolCall = frameData(frames, "assistant.tool.call");
		expect(toolCall.name).toBe("explain_node");
		expect(toolCall.arguments).toEqual({ nodeId: "n-user" });
		const toolResult = frameData(frames, "assistant.tool.result");
		expect(toolResult.ok).toBe(true);
		expect(JSON.stringify(toolResult.result)).toContain("没有记录");
		expect(frameData(frames, "assistant.completed").status).toBe("completed");

		const detail = await request(
			running.origin,
			`/api/assistant/conversations/${conversation.id}`,
		);
		const detailBody = (await detail.json()) as AssistantConversationDetailView;
		expect(detailBody.messages.map((message) => message.role)).toEqual([
			"user",
			"tool",
			"assistant",
		]);
		const events = await request(
			running.origin,
			`/api/assistant/conversations/${conversation.id}/events`,
		);
		const eventsBody = (await events.json()) as AssistantConversationEventsView;
		expect(eventsBody.lastSeq).toBeGreaterThan(0);
		expect(eventsBody.events.map((event) => event.kind)).toContain("completed");
		expect(running.store.getHead("story-1")?.id ?? null).toBe(headBefore);
		expect(running.store.getPathToHead("story-1").length).toBe(nodeCountBefore);
		expect(running.store.listTurnRuns("story-1")).toEqual([]);
	});

	it("运行中并发启动返回 409，取消后状态为 cancelled", async () => {
		const client = new ScriptedClient([{ text: "部分", hangAfterText: true }]);
		const running = await startTestServerWithChannels(client);
		seedStory(running);
		const conversation = await createConversation(running.origin, {
			storyId: "story-1",
			skill: "guide",
		});
		const response = await post(
			running.origin,
			`/api/assistant/conversations/${conversation.id}/messages`,
			{ text: "怎么用？" },
		);
		expect(response.status).toBe(200);
		const reader = new FrameReader(response);
		const frames = await reader.readUntil(
			(frame) => frame.event === "assistant.text.delta",
		);
		const conflict = await post(
			running.origin,
			`/api/assistant/conversations/${conversation.id}/messages`,
			{ text: "再来一句" },
		);
		expect(conflict.status).toBe(409);
		const cancel = await post(
			running.origin,
			`/api/assistant/conversations/${conversation.id}/cancel`,
			{},
		);
		expect(cancel.status).toBe(200);
		const cancelBody = (await cancel.json()) as AssistantCancelView;
		expect(cancelBody.status).toBe("cancelled");
		frames.push(...(await reader.readAll()));
		expect(frames.map((frame) => frame.event)).toContain("assistant.error");
		expect(
			running.store.getAssistantConversation(conversation.id)?.status,
		).toBe("cancelled");
	});

	it("启动时把遗留的 running 会话改为 interrupted", async () => {
		const dir = tempDir();
		const dbPath = join(dir, "story.db");
		const first = await startServer({
			dbPath,
			webRoot: dir,
			host: "127.0.0.1",
			port: 0,
			password: null,
			log: () => {},
		});
		first.store.createStory({ id: "story-1", title: "测试故事" });
		const conversation = first.store.createAssistantConversation({
			storyId: "story-1",
			skill: "guide",
		});
		first.store.startAssistantConversationRun(conversation.id, {
			conversationId: conversation.id,
			skill: "guide",
		});
		await first.close();
		const second = await startServer({
			dbPath,
			webRoot: dir,
			host: "127.0.0.1",
			port: 0,
			password: null,
			log: () => {},
		});
		onTestFinished(() => second.close());
		expect(second.store.getAssistantConversation(conversation.id)?.status).toBe(
			"interrupted",
		);
	});
});

describe("助手待确认动作接口", () => {
	it("列出、批准与拒绝故事动作，非法载荷保留待定", async () => {
		const running = await startTestServer();
		seedStory(running);
		const conversation = await createConversation(running.origin, {
			storyId: "story-1",
			skill: "guide",
		});
		const settings = running.store.createAssistantAction({
			conversationId: conversation.id,
			kind: "settings",
			summary: "提高预算",
			payload: { budgetTokens: 18_000 },
		});
		const broken = running.store.createAssistantAction({
			conversationId: conversation.id,
			kind: "settings",
			summary: "换模板",
			payload: { templateId: "missing-template" },
		});
		const list = await request(
			running.origin,
			"/api/assistant/actions?status=pending&storyId=story-1",
		);
		expect(list.status).toBe(200);
		const listBody = (await list.json()) as AssistantActionListView;
		expect(listBody.actions.map((action) => action.id)).toEqual([
			settings.id,
			broken.id,
		]);
		expect(listBody.actions[0]?.kind).toBe("settings");

		const bad = await post(
			running.origin,
			`/api/assistant/actions/${broken.id}/approve`,
			{},
		);
		expect(bad.status).toBe(400);
		expect((await errorBody(bad)).error.message).toContain("模板不存在");
		expect(running.store.getAssistantAction(broken.id)?.status).toBe("pending");

		const approved = await post(
			running.origin,
			`/api/assistant/actions/${settings.id}/approve`,
			{},
		);
		expect(approved.status).toBe(200);
		const approvedBody = (await approved.json()) as AssistantActionDecisionView;
		expect(approvedBody.action.status).toBe("approved");
		expect(running.store.getStorySettings("story-1").budgetTokens).toBe(18_000);

		const rejected = await post(
			running.origin,
			`/api/assistant/actions/${broken.id}/reject`,
			{ reason: "模板还没准备好" },
		);
		expect(rejected.status).toBe(200);
		const rejectedBody = (await rejected.json()) as AssistantActionDecisionView;
		expect(rejectedBody.action.status).toBe("rejected");
		expect(rejectedBody.action.rejectionReason).toBe("模板还没准备好");
		expect(running.store.getStorySettings("story-1").templateId).toBeNull();

		const again = await post(
			running.origin,
			`/api/assistant/actions/${settings.id}/reject`,
			{ reason: "重复" },
		);
		expect(again.status).toBe(409);
		const missing = await post(
			running.origin,
			"/api/assistant/actions/missing/approve",
			{},
		);
		expect(missing.status).toBe(404);
	});

	it("非法渠道载荷批准失败并保留待定", async () => {
		const running = await startTestServerWithChannels(new ScriptedClient([]));
		const conversation = await createConversation(running.origin, {
			skill: "setup_wizard",
		});
		const action = running.store.createAssistantAction({
			conversationId: conversation.id,
			kind: "channels",
			summary: "改模型",
			payload: {
				channels: {},
				models: { main: {} },
				embeddings: {},
				roles: {},
			},
		});
		const response = await post(
			running.origin,
			`/api/assistant/actions/${action.id}/approve`,
			{},
		);
		expect(response.status).toBe(400);
		expect((await errorBody(response)).error.message).toMatch(/models\.main\./);
		expect(running.store.getAssistantAction(action.id)?.status).toBe("pending");
	});

	it("有待确认动作的会话删除返回 409，处理后删除", async () => {
		const running = await startTestServer();
		seedStory(running);
		const conversation = await createConversation(running.origin, {
			storyId: "story-1",
			skill: "guide",
		});
		const action = running.store.createAssistantAction({
			conversationId: conversation.id,
			kind: "card",
			summary: "改人物提示",
			payload: { characterPrompt: "新的提示" },
		});
		const blocked = await request(
			running.origin,
			`/api/assistant/conversations/${conversation.id}`,
			{ method: "DELETE" },
		);
		expect(blocked.status).toBe(409);
		await post(running.origin, `/api/assistant/actions/${action.id}/reject`, {
			reason: "先不用",
		});
		const deleted = await request(
			running.origin,
			`/api/assistant/conversations/${conversation.id}`,
			{ method: "DELETE" },
		);
		expect(deleted.status).toBe(204);
		expect(running.store.getAssistantConversation(conversation.id)).toBeNull();
	});
});
