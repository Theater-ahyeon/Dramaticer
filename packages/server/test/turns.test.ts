import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type LlmCallOptions,
	type LlmChannelsConfig,
	type LlmRequest,
	type LlmResult,
	type LlmStream,
	type LlmStreamEvent,
	type LlmStreamingClient,
	type LlmToolCall,
	StoryStore,
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
					channels: ["fake"],
					probe: null,
				},
			],
		]),
		embeddings: new Map(),
	};
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
	let config = fakeConfig();
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
		expect(names.filter((name) => name === "blocks.replace")).toHaveLength(2);
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
