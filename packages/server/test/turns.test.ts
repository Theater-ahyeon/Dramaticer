import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type BackgroundJobRegistry,
	DEFAULT_DIRECTOR_CONFIG,
	type LlmCallOptions,
	type LlmChannelsConfig,
	type LlmRequest,
	type LlmResult,
	type LlmStream,
	type LlmStreamEvent,
	type LlmStreamingClient,
	type LlmToolCall,
	StoryStore,
	createBackgroundJobRegistry,
	mergePlannedArcs,
} from "@dramaticer/core";
import type { SseEventMap, SseEventName } from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

const USAGE = {
	promptTokens: 11,
	completionTokens: 7,
	totalTokens: 18,
	reasoningTokens: 0,
	cachedTokens: 0,
};

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-server-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
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

function configWithBackground(): LlmChannelsConfig {
	const config = fakeConfig();
	const models = new Map(config.models);
	models.set("background", {
		alias: "background",
		id: "background-model",
		contextWindow: 8_192,
		maxTokens: 1_024,
		reasoning: true,
		enabled: true,
		channels: ["fake"],
		tools: null,
		probe: null,
	});
	return { ...config, models };
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
	readonly #onStream: (() => void) | undefined;

	constructor(replies: readonly FakeReply[], onStream?: () => void) {
		this.#replies = [...replies];
		this.#onStream = onStream;
	}

	async complete(): Promise<LlmResult> {
		throw new Error("回合不应该调用 complete");
	}

	stream(request: LlmRequest, _options?: LlmCallOptions): LlmStream {
		this.requests.push(request);
		this.#onStream?.();
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

interface Frame {
	readonly event?: string;
	readonly data?: unknown;
	readonly comment?: string;
}

function parseFrame(raw: string): Frame {
	if (raw.startsWith(":")) return { comment: raw.slice(1).trim() };
	let event = "message";
	const dataLines: string[] = [];
	for (const line of raw.split("\n")) {
		if (line.startsWith("event: ")) event = line.slice("event: ".length);
		if (line.startsWith("data: ")) dataLines.push(line.slice("data: ".length));
	}
	return {
		event,
		data: dataLines.length > 0 ? JSON.parse(dataLines.join("\n")) : undefined,
	};
}

class FrameStream {
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
				this.#queue.push(parseFrame(this.#buffer.slice(0, split)));
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

interface TurnServer {
	readonly running: RunningServer;
	readonly dbPath: string;
	readonly client: ScriptedClient;
	readonly logs: string[];
	readonly clientBuilds: () => number;
	readonly setConfig: (config: LlmChannelsConfig) => void;
}

async function startTurnServer(
	replies: readonly FakeReply[],
	onStream?: () => void,
	backgroundRegistry?: BackgroundJobRegistry,
	initialConfig?: LlmChannelsConfig,
): Promise<TurnServer> {
	const dir = tempDir();
	const webRoot = join(dir, "web");
	mkdirSync(webRoot, { recursive: true });
	writeFileSync(
		join(webRoot, "index.html"),
		"<!doctype html><title>应用</title>",
	);
	const dbPath = join(dir, "story.db");
	const client = new ScriptedClient(replies, onStream);
	const logs: string[] = [];
	let config = initialConfig ?? fakeConfig();
	let builds = 0;
	const running = await startServer({
		dbPath,
		webRoot,
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: (line) => {
			logs.push(line);
		},
		heartbeatMs: 20,
		channels: {
			load: async () => config,
			createClient: () => {
				builds += 1;
				return client;
			},
			...(backgroundRegistry === undefined
				? {}
				: { createBackgroundRegistry: () => backgroundRegistry }),
		},
	});
	onTestFinished(() => running.close());
	running.store.createStory({ id: "s1", title: "测试故事" });
	return {
		running,
		dbPath,
		client,
		logs,
		clientBuilds: () => builds,
		setConfig: (next) => {
			config = next;
		},
	};
}

function postTurn(
	origin: string,
	text: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${origin}/api/stories/s1/turns`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text }),
		...init,
	});
}

function eventNames(frames: readonly Frame[]): string[] {
	return frames
		.map((frame) => frame.event)
		.filter((event): event is string => event !== undefined);
}

function frameData<N extends SseEventName>(
	frames: readonly Frame[],
	event: N,
): SseEventMap[N] {
	const frame = frames.find((item) => item.event === event);
	if (frame === undefined) throw new Error(`没有收到事件 ${event}`);
	return frame.data as SseEventMap[N];
}

function frameDatas<N extends SseEventName>(
	frames: readonly Frame[],
	event: N,
): SseEventMap[N][] {
	return frames
		.filter((item) => item.event === event)
		.map((item) => item.data as SseEventMap[N]);
}

describe("POST /api/stories/:id/turns", () => {
	it("按顺序发出事件，写入楼层与结构化输出", async () => {
		const reply =
			'山门缓缓打开。<state_update>{"path":["场景","地点"],"op":"set","value":"山门"}</state_update><plot_note>{"text":"门后有人跟踪"}</plot_note>';
		const { running, logs } = await startTurnServer([
			{ text: reply, thinking: "先想一下" },
		]);
		const response = await postTurn(running.origin, "我推开山门。");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const frames = await new FrameStream(response).readAll();
		const names = eventNames(frames);

		expect(names[0]).toBe("turn.started");
		expect(names).toContain("thinking.delta");
		expect(names.filter((name) => name === "text.delta")).toHaveLength(
			[...reply].length,
		);
		const blockReplaceIndexes = names.flatMap((name, index) =>
			name === "blocks.replace" ? [index] : [],
		);
		expect(blockReplaceIndexes.length).toBeGreaterThan(0);
		expect(blockReplaceIndexes.at(-1)).toBe(names.length - 2);
		expect(names.at(-1)).toBe("turn.completed");
		expect(names.indexOf("text.delta")).toBeGreaterThan(0);
		expect(names.indexOf("text.delta")).toBeGreaterThan(
			names.indexOf("thinking.delta"),
		);

		const deltas = frameDatas(frames, "text.delta").map((frame) => frame.delta);
		expect(deltas.join("")).toBe(reply);

		const completed = frameData(frames, "turn.completed");
		expect(completed.userNode.role).toBe("user");
		expect(completed.userNode.raw).toBe("我推开山门。");
		expect(completed.node.role).toBe("assistant");
		expect(completed.node.raw).toBe(reply);
		const finalBlocks = frameDatas(frames, "blocks.replace").at(-1)?.blocks;
		expect(finalBlocks).toEqual(completed.blocks);
		const stateUpdate = completed.blocks.find(
			(item) => item.kind === "block" && item.name === "state_update",
		);
		expect(stateUpdate?.kind === "block" ? stateUpdate.display : null).toEqual({
			kind: "hidden",
		});
		expect(completed.stateDiffs).toHaveLength(1);
		expect(completed.stateDiffs[0]?.path).toEqual(["场景", "地点"]);
		expect(completed.plotNotes.map((note) => note.text)).toEqual([
			"门后有人跟踪",
		]);
		expect(completed.usage.totalTokens).toBe(USAGE.totalTokens);
		expect(completed.trace.llm.stopReason).toBe("stop");
		expect(completed.trace.llm.channel).toBe("fake");
		expect(typeof completed.firstTokenMs).toBe("number");
		expect(logs.join("\n")).not.toContain("山门");
		expect(logs.join("\n")).not.toContain("我推");
	});

	it("同一故事并发第二个回合返回 409", async () => {
		const gate = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		const { running, client } = await startTurnServer(
			[{ text: "第一段", wait: gate.promise }],
			() => started.resolve(),
		);
		const first = postTurn(running.origin, "第一句。");
		await started.promise;
		const stream = new FrameStream(await first);
		await stream.readUntil((frame) => frame.event === "turn.started");

		const second = await postTurn(running.origin, "第二句。");
		expect(second.status).toBe(409);
		const body = (await second.json()) as { error: { code: string } };
		expect(body.error.code).toBe("conflict");

		gate.resolve();
		const frames = await stream.readAll();
		expect(eventNames(frames).at(-1)).toBe("turn.completed");
		expect(client.requests).toHaveLength(1);
	});

	it("回合进行中按间隔发送心跳注释", async () => {
		const gate = Promise.withResolvers<void>();
		const { running } = await startTurnServer([
			{ text: "慢慢来", wait: gate.promise },
		]);
		const stream = new FrameStream(await postTurn(running.origin, "开始。"));
		const frames = await stream.readUntil((frame) => frame.comment === "ping");
		expect(frames.some((frame) => frame.comment === "ping")).toBe(true);
		gate.resolve();
		await stream.readAll();
	});

	it("客户端断开时中止上游并保留部分正文", async () => {
		const started = Promise.withResolvers<void>();
		const { running } = await startTurnServer(
			[{ text: "半句", hangAfterText: true }],
			() => started.resolve(),
		);
		const controller = new AbortController();
		const response = await postTurn(running.origin, "开始。", {
			signal: controller.signal,
		});
		const stream = new FrameStream(response);
		const frames = await stream.readUntil(
			(frame) => frame.event === "text.delta",
		);
		expect(eventNames(frames)).toContain("turn.started");
		controller.abort();

		await vi.waitFor(() => {
			const head = running.store.getHead("s1");
			expect(head?.role).toBe("assistant");
		});
		const head = running.store.getHead("s1");
		expect(head?.raw).toBe("半句");
		expect(running.store.getTurnTrace(head?.id ?? "")?.llm.stopReason).toBe(
			"aborted",
		);
	});

	it("服务端关闭时中止回合并保存已生成的正文", async () => {
		const started = Promise.withResolvers<void>();
		const { running, dbPath } = await startTurnServer(
			[{ text: "开头", hangAfterText: true }],
			() => started.resolve(),
		);
		const responsePromise = postTurn(running.origin, "开始。");
		await started.promise;
		const response = await responsePromise;
		const stream = new FrameStream(response);
		await stream.readUntil((frame) => frame.event === "text.delta");
		await running.close();

		const reopened = StoryStore.open(dbPath);
		try {
			const head = reopened.getHead("s1");
			expect(head?.role).toBe("assistant");
			expect(head?.raw).toBe("开头");
			expect(reopened.getTurnTrace(head?.id ?? "")?.llm.stopReason).toBe(
				"aborted",
			);
		} finally {
			reopened.close();
		}
	});

	it("函数调用模式只发一次主调用，读取工具最多两轮", async () => {
		const { running, client } = await startTurnServer([
			{
				text: "我先查记忆。",
				toolCalls: [
					{ id: "call-1", name: "memory_search", arguments: { query: "山门" } },
				],
			},
			{ text: "山门在山顶。" },
		]);
		running.store.updateStorySettings("s1", {
			structuredOutput: "function-call",
		});

		const response = await postTurn(running.origin, "山门在哪里？");
		const frames = await new FrameStream(response).readAll();
		expect(frameDatas(frames, "tool.call")).toEqual([
			{ name: "memory_search", ok: true },
		]);
		expect(client.requests).toHaveLength(2);
		const completed = frameData(frames, "turn.completed");
		expect(completed.trace.tools.rounds).toBe(1);
		expect(completed.node.raw).toBe("山门在山顶。");
	});

	it("回合完成事件先返回，后台任务随后执行", async () => {
		const gate = Promise.withResolvers<void>();
		const ran: string[] = [];
		const registry = createBackgroundJobRegistry({
			settle: {
				enqueue: "settled",
				handler: async ({ job }) => {
					ran.push(`settle:${job.nodeId ?? ""}`);
					await gate.promise;
				},
			},
			events: {
				enqueue: "settled",
				handler: async ({ job }) => {
					ran.push(`events:${job.nodeId ?? ""}`);
					await gate.promise;
				},
			},
			summary: {
				enqueue: "settled",
				handler: async ({ job }) => {
					ran.push(`summary:${job.nodeId ?? ""}`);
					await gate.promise;
				},
			},
		});
		const { running } = await startTurnServer(
			[{ text: "正文" }],
			undefined,
			registry,
			configWithBackground(),
		);
		const response = await postTurn(running.origin, "开始。");
		const frames = await new FrameStream(response).readAll();
		expect(eventNames(frames).at(-1)).toBe("turn.completed");
		await vi.waitFor(() => expect(ran.length).toBeGreaterThan(0));
		expect(ran[0]).toMatch(/^settle:/);
		gate.resolve();
		await vi.waitFor(() =>
			expect(running.store.countBackgroundJobs({ storyId: "s1" }).done).toBe(3),
		);
	});

	it("重新生成新建兄弟助手楼层，旧楼层与旧 Trace 保留", async () => {
		const { running } = await startTurnServer([
			{ text: "第一次回复" },
			{ text: "第二次回复" },
		]);
		const firstFrames = await new FrameStream(
			await postTurn(running.origin, "开始。"),
		).readAll();
		const first = frameData(firstFrames, "turn.completed");

		const response = await fetch(
			`${running.origin}/api/nodes/${first.node.id}/regenerate`,
			{ method: "POST" },
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const frames = await new FrameStream(response).readAll();
		expect(eventNames(frames)[0]).toBe("turn.started");
		expect(eventNames(frames).at(-1)).toBe("turn.completed");
		const regenerated = frameData(frames, "turn.completed");

		expect(regenerated.userNode.id).toBe(first.userNode.id);
		expect(regenerated.node.id).not.toBe(first.node.id);
		expect(regenerated.node.parentId).toBe(first.userNode.id);
		expect(regenerated.node.raw).toBe("第二次回复");
		expect(running.store.getNode(first.node.id)?.raw).toBe("第一次回复");
		expect(running.store.getTurnTrace(first.node.id)?.nodeId).toBe(
			first.node.id,
		);
		expect(running.store.getHead("s1")?.id).toBe(regenerated.node.id);

		const traceResponse = await fetch(
			`${running.origin}/api/nodes/${regenerated.node.id}/trace`,
		);
		expect(traceResponse.status).toBe(200);
		expect(await traceResponse.json()).toEqual(regenerated.trace);

		const notAssistant = await fetch(
			`${running.origin}/api/nodes/${first.userNode.id}/regenerate`,
			{ method: "POST" },
		);
		expect(notAssistant.status).toBe(400);
	});

	it("用户楼层可以重试这一轮，不追加新的用户楼层", async () => {
		const { running } = await startTurnServer([
			{ text: "第一次回复" },
			{ text: "重试回复" },
		]);
		const firstFrames = await new FrameStream(
			await postTurn(running.origin, "开始。"),
		).readAll();
		const first = frameData(firstFrames, "turn.completed");

		const response = await fetch(
			`${running.origin}/api/nodes/${first.userNode.id}/retry`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mode: "fast" }),
			},
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const frames = await new FrameStream(response).readAll();
		const retried = frameData(frames, "turn.completed");

		expect(retried.userNode.id).toBe(first.userNode.id);
		expect(retried.userNode.raw).toBe(first.userNode.raw);
		expect(retried.node.id).not.toBe(first.node.id);
		expect(retried.node.parentId).toBe(first.userNode.id);
		expect(retried.node.raw).toBe("重试回复");
		expect(running.store.getHead("s1")?.id).toBe(retried.node.id);

		const notUser = await fetch(
			`${running.origin}/api/nodes/${first.node.id}/retry`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		expect(notUser.status).toBe(400);
	});

	it("回合请求的 intensity 覆盖故事设置，非法值返回 400 且不建楼层", async () => {
		const { running } = await startTurnServer([{ text: "收到。" }]);
		running.store.updateStorySettings("s1", {
			directorConfig: {
				...DEFAULT_DIRECTOR_CONFIG,
				intensity: "detonate",
			},
		});
		mergePlannedArcs(
			running.store,
			"s1",
			{
				arcs: [
					{
						id: "arc-1",
						title: "开学",
						throughLine: "凛必须说出真相",
						difficulty: 0.4,
						redLines: [],
						sequences: [
							{
								id: "seq-1",
								title: "相遇",
								beats: [
									{
										id: "beat-1",
										goal: "确认来意",
										entrySigns: ["凛堵在门口"],
										fitPoints: ["凛盯着你"],
									},
								],
							},
						],
					},
				],
			},
			"model",
		);
		running.store.appendNode({
			id: "a0",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场。",
		});

		const response = await fetch(`${running.origin}/api/stories/s1/turns`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "我看着他。", intensity: "setup" }),
		});
		expect(response.status).toBe(200);
		const frames = await new FrameStream(response).readAll();
		const completed = frameData(frames, "turn.completed");
		const decision = running.store.getDirectorDecision(completed.userNode.id);
		expect(decision?.signals.beat).toMatchObject({ intensity: "setup" });
		expect(decision?.directive).not.toContain("可见变化");

		const before = running.store.listStoryNodes("s1").length;
		const invalid = await fetch(`${running.origin}/api/stories/s1/turns`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "再来。", intensity: "hype" }),
		});
		expect(invalid.status).toBe(400);
		const body = (await invalid.json()) as {
			error: { code: string; details?: { path?: string } };
		};
		expect(body.error.code).toBe("bad_request");
		expect(body.error.details?.path).toBe("intensity");
		expect(running.store.listStoryNodes("s1")).toHaveLength(before);
	});

	it("深回合执行工具前发送 turn.progress，同一阶段只发一次", async () => {
		const { running, client } = await startTurnServer([
			{
				text: "",
				toolCalls: [
					{ id: "call-1", name: "state_get", arguments: {} },
					{ id: "call-2", name: "state_get", arguments: {} },
				],
			},
			{ text: "查完了。" },
		]);
		running.store.updateStorySettings("s1", { turnMode: "deep" });
		const response = await fetch(`${running.origin}/api/stories/s1/turns`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "我查一遍。" }),
		});
		expect(response.status).toBe(200);
		const frames = await new FrameStream(response).readAll();
		const progress = frames
			.filter((frame) => frame.event === "turn.progress")
			.map((frame) => frame.data);
		expect(progress).toEqual([{ phase: "读取状态……", detail: "state_get" }]);
		const trace = frameData(frames, "turn.completed").trace;
		expect(trace.tools.calls[0]).toMatchObject({
			name: "state_get",
			permission: "read",
		});
		expect(client.requests).toHaveLength(2);
	});

	it("深回合草稿通过 SSE 投影，提交后发送 turn.committed", async () => {
		const draftText = "山门缓缓打开，他退后一步。";
		const { running, client } = await startTurnServer([
			{
				text: "",
				toolCalls: [
					{
						id: "draft-1",
						name: "draft_write",
						arguments: { text: draftText },
					},
				],
			},
			{
				text: "",
				toolCalls: [{ id: "commit-1", name: "commit_draft", arguments: {} }],
			},
		]);
		const response = await fetch(`${running.origin}/api/stories/s1/turns`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "我推门。", mode: "deep" }),
		});
		expect(response.status).toBe(200);
		const frames = await new FrameStream(response).readAll();
		const names = eventNames(frames);
		const completed = frameData(frames, "turn.completed");
		const committed = frameData(frames, "turn.committed");

		expect(frameData(frames, "draft.replace")).toEqual({
			text: draftText,
			version: 1,
		});
		expect(committed).toMatchObject({
			storyId: "s1",
			nodeId: completed.node.id,
			commit: "tool",
		});
		expect(committed.blocks).toEqual(completed.blocks);
		expect(names.indexOf("draft.replace")).toBeLessThan(
			names.indexOf("turn.committed"),
		);
		expect(names.indexOf("turn.committed")).toBeLessThan(
			names.indexOf("turn.completed"),
		);
		expect(completed.node.raw).toBe(draftText);
		expect(completed.trace.deep).toMatchObject({
			commit: "tool",
			drift: null,
		});
		expect(client.requests).toHaveLength(2);

		const run = running.store.getTurnRunForNode(completed.node.id);
		expect(run?.status).toBe("completed");
		const events = running.store.listTurnRunEvents(run?.runId as string);
		expect(JSON.stringify(events)).not.toContain("山门缓缓打开");
	});

	it("运行中追加要求进入下一次请求，事件与状态码按运行状态返回", async () => {
		const gate = Promise.withResolvers<void>();
		const { running, client } = await startTurnServer([
			{
				text: "",
				toolCalls: [{ id: "call-1", name: "state_get", arguments: {} }],
				wait: gate.promise,
			},
			{ text: "山神收回了手。" },
		]);
		running.store.createStory({ id: "s2", title: "另一个故事" });
		const response = await fetch(`${running.origin}/api/stories/s1/turns`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "我点亮火把。", mode: "deep" }),
		});
		expect(response.status).toBe(200);
		const stream = new FrameStream(response);
		const startedFrames = await stream.readUntil(
			(frame) => frame.event === "turn.started",
		);
		const runId = frameData(startedFrames, "turn.started").runId;
		expect(typeof runId).toBe("string");
		await vi.waitFor(() => expect(client.requests).toHaveLength(1));

		const steer = (storyId: string, id: string, text: unknown) =>
			fetch(`${running.origin}/api/stories/${storyId}/turns/${id}/steering`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text }),
			});

		const first = await steer("s1", runId as string, "不要杀他");
		expect(first.status).toBe(202);
		expect(await first.json()).toEqual({ runId });
		const firstEcho = await stream.readUntil(
			(frame) => frame.event === "turn.steering",
		);
		expect(frameData(firstEcho, "turn.steering")).toEqual({
			runId,
			text: "不要杀他",
		});

		const second = await steer("s1", runId as string, "让他先说完");
		expect(second.status).toBe(202);
		const secondEcho = await stream.readUntil(
			(frame) => frame.event === "turn.steering",
		);
		expect(frameData(secondEcho, "turn.steering")).toEqual({
			runId,
			text: "让他先说完",
		});

		const empty = await steer("s1", runId as string, "   ");
		expect(empty.status).toBe(400);
		const emptyBody = (await empty.json()) as {
			error: { details?: { path?: string } };
		};
		expect(emptyBody.error.details?.path).toBe("text");
		const tooLong = await steer("s1", runId as string, "字".repeat(2_001));
		expect(tooLong.status).toBe(400);
		const unknown = await steer("s1", "missing-run", "继续");
		expect(unknown.status).toBe(404);
		const otherStory = await steer("s2", runId as string, "继续");
		expect(otherStory.status).toBe(404);

		gate.resolve();
		const frames = await stream.readAll();
		const completed = frameData(frames, "turn.completed");
		expect(completed.node.raw).toBe("山神收回了手。");
		expect(running.store.listStoryNodes("s1")).toHaveLength(2);

		const guidance = client.requests[1]?.messages
			.filter((message) => message.role === "user")
			.map((message) => message.content)
			.slice(-2);
		expect(guidance).toEqual([
			"【玩家在运行中追加的指引】\n不要杀他",
			"【玩家在运行中追加的指引】\n让他先说完",
		]);
		const steering = running.store
			.listTurnRunEvents(runId as string)
			.filter((event) => event.kind === "steering");
		expect(steering).toHaveLength(2);
		expect(JSON.stringify(steering)).not.toContain("不要杀他");

		const finished = await steer("s1", runId as string, "结束以后");
		expect(finished.status).toBe(409);
		const finishedBody = (await finished.json()) as {
			error: { code: string };
		};
		expect(finishedBody.error.code).toBe("conflict");
	});

	it("回合请求的 mode 覆盖故事设置，深回合正常生成并记录上限", async () => {
		const { running, client } = await startTurnServer([
			{ text: "深回合的回复。" },
			{ text: "快回合的回复。" },
			{ text: "再看一次的回复。" },
		]);
		running.store.updateStorySettings("s1", { turnMode: "deep" });
		const turn = (payload: Record<string, unknown>) =>
			fetch(`${running.origin}/api/stories/s1/turns`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

		const before = running.store.listStoryNodes("s1").length;
		const fromSettings = await turn({ text: "我看着他。" });
		expect(fromSettings.status).toBe(200);
		const settingsFrames = await new FrameStream(fromSettings).readAll();
		const settingsTrace = frameData(settingsFrames, "turn.completed").trace;
		expect(settingsTrace.turnMode).toBe("deep");
		expect(settingsTrace.deep).toMatchObject({
			maxToolCalls: 40,
			maxDurationMs: 600_000,
			toolCallCount: 0,
			stopReason: "completed",
		});
		expect(running.store.listStoryNodes("s1")).toHaveLength(before + 2);

		const fast = await turn({ text: "我看着他。", mode: "fast" });
		expect(fast.status).toBe(200);
		const frames = await new FrameStream(fast).readAll();
		expect(frameData(frames, "turn.completed").trace.turnMode).toBe("fast");
		expect(running.store.listStoryNodes("s1")).toHaveLength(before + 4);

		const afterFast = running.store.listStoryNodes("s1").length;
		const deep = await turn({ text: "再看一次。", mode: "deep" });
		expect(deep.status).toBe(200);
		const deepFrames = await new FrameStream(deep).readAll();
		const deepTrace = frameData(deepFrames, "turn.completed").trace;
		expect(deepTrace.turnMode).toBe("deep");
		expect(deepTrace.deep?.stopReason).toBe("completed");
		expect(running.store.listStoryNodes("s1")).toHaveLength(afterFast + 2);
		expect(client.requests).toHaveLength(3);

		const invalid = await turn({ text: "再来。", mode: "slow" });
		expect(invalid.status).toBe(400);
		const invalidError = (await invalid.json()) as {
			error: { code: string; details?: { path?: string } };
		};
		expect(invalidError.error.code).toBe("bad_request");
		expect(invalidError.error.details?.path).toBe("mode");
		expect(running.store.listStoryNodes("s1")).toHaveLength(afterFast + 2);

		const unknownField = await turn({ text: "再来。", mode: "fast", extra: 1 });
		expect(unknownField.status).toBe(400);
		expect(running.store.listStoryNodes("s1")).toHaveLength(afterFast + 2);
		expect(client.requests).toHaveLength(3);
	});

	it("设置或渠道配置变化后重建运行时", async () => {
		const { running, clientBuilds, setConfig } = await startTurnServer([
			{ text: "一" },
			{ text: "二" },
			{ text: "三" },
			{ text: "四" },
		]);
		await new FrameStream(await postTurn(running.origin, "第一句。")).readAll();
		expect(clientBuilds()).toBe(1);

		await new FrameStream(await postTurn(running.origin, "第二句。")).readAll();
		expect(clientBuilds()).toBe(1);

		setConfig(fakeConfig("changed-model"));
		await new FrameStream(await postTurn(running.origin, "第三句。")).readAll();
		expect(clientBuilds()).toBe(2);

		running.store.updateStorySettings("s1", { budgetTokens: 5_000 });
		await new FrameStream(await postTurn(running.origin, "第四句。")).readAll();
		expect(clientBuilds()).toBe(3);
	});
});
