import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type EmbeddingClient,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	StoryStore,
} from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { runEventsBackfill } from "../src/evalset/events-backfill.js";
import { runEventsBackfillCli } from "../src/evalset/events-cli.js";

const DIMENSIONS = 4;
const CHARACTER = "回填角色";
const ASSISTANT_FLOORS = 24;

interface FakeClient extends LlmStreamingClient {
	readonly calls: number;
	readonly windows: string[][];
}

function resultOf(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake",
		channel: null,
		usage: {
			promptTokens: 0,
			completionTokens: 0,
			reasoningTokens: null,
			totalTokens: 0,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

/** 第一次返回一个错后缀的 nodeId，第二次返回正确结果；记录每次请求。 */
function flakyClient(): {
	readonly client: LlmStreamingClient;
	readonly prompts: string[];
} {
	const prompts: string[] = [];
	const client: LlmStreamingClient = {
		async complete(request: LlmRequest): Promise<LlmResult> {
			const prompt = request.messages
				.map((message) => message.content)
				.join("\n");
			prompts.push(prompt);
			const window = /<窗口>([\s\S]*?)<\/窗口>/.exec(prompt);
			if (window === null) throw new Error("请求里没有窗口");
			const floors = [
				...(window[1] ?? "").matchAll(
					/<楼层 id="([^"]+)" role="assistant">\n([\s\S]*?)\n<\/楼层>/g,
				),
			].map((match) => ({
				nodeId: match[1] as string,
				text: match[2] as string,
			}));
			const first = floors[0];
			if (first === undefined) throw new Error("窗口里没有助手楼层");
			const firstCall = prompts.length === 1;
			return resultOf(
				JSON.stringify(
					floors.map((floor) => ({
						nodeId: firstCall ? `${floor.nodeId}错` : floor.nodeId,
						events: [
							{
								text: floor.text,
								participants: ["角色"],
								knowers: ["*"],
								importance: 0.5,
							},
						],
					})),
				),
			);
		},
		stream(): never {
			throw new Error("回填不使用流式接口");
		},
	};
	return { client, prompts };
}

/** 从窗口里取助手楼层 id，为每个楼层返回一条事件；上下文楼层不输出。 */
function fakeClient(): FakeClient {
	const windows: string[][] = [];
	const client = {
		get calls() {
			return windows.length;
		},
		get windows() {
			return windows;
		},
		async complete(request: LlmRequest): Promise<LlmResult> {
			const prompt = request.messages
				.map((message) => message.content)
				.join("\n");
			const window = /<窗口>([\s\S]*?)<\/窗口>/.exec(prompt);
			if (window === null) throw new Error("请求里没有窗口");
			const floors = [
				...(window[1] ?? "").matchAll(
					/<楼层 id="([^"]+)" role="assistant">\n([\s\S]*?)\n<\/楼层>/g,
				),
			].map((match) => ({
				nodeId: match[1] as string,
				text: match[2] as string,
			}));
			windows.push(floors.map((floor) => floor.nodeId));
			return resultOf(
				JSON.stringify(
					floors.map((floor) => ({
						nodeId: floor.nodeId,
						events: [
							{
								text: floor.text,
								participants: ["角色"],
								knowers: ["*"],
								importance: 0.5,
							},
						],
					})),
				),
			);
		},
		stream(): never {
			throw new Error("回填不使用流式接口");
		},
	};
	return client;
}

function fakeEmbedder(): EmbeddingClient {
	return {
		dimensions: DIMENSIONS,
		async embed(texts: readonly string[]): Promise<number[][]> {
			return texts.map(() => [1, 0, 0, 0]);
		},
	};
}

/** 写一个只有 chat 条目的评测快照，返回 raw 根目录。 */
async function writeRawRoot(): Promise<string> {
	const root = await mkdtemp(
		fileURLToPath(new URL("./.tmp-backfill-", import.meta.url)),
	);
	onTestFinished(() => rm(root, { recursive: true, force: true }));
	const lines = [
		JSON.stringify({ user_name: "用户", character_name: CHARACTER }),
		JSON.stringify({
			name: CHARACTER,
			is_user: false,
			is_system: true,
			mes: "故事开始。",
		}),
	];
	for (let floor = 0; floor < ASSISTANT_FLOORS; floor += 1) {
		lines.push(
			JSON.stringify({
				name: "用户",
				is_user: true,
				mes: `第 ${floor} 次提问。`,
			}),
			JSON.stringify({
				name: CHARACTER,
				is_user: false,
				mes: `第 ${floor} 段正文。`,
			}),
		);
	}
	lines.push(
		JSON.stringify({
			name: "用户",
			is_user: true,
			mes: "回填之后的提问。",
		}),
	);
	const target = "backfill-chat.jsonl";
	const text = `${lines.join("\n")}\n`;
	await writeFile(path.join(root, target), text, "utf8");
	await writeFile(
		path.join(root, "manifest.json"),
		`${JSON.stringify({
			generatedAt: "2026-01-01T00:00:00.000Z",
			files: [
				{
					role: "chat",
					character: CHARACTER,
					target,
					size: Buffer.byteLength(text),
					sha256: createHash("sha256").update(text).digest("hex"),
				},
			],
		})}\n`,
		"utf8",
	);
	return root;
}

describe("runEventsBackfill", () => {
	it(
		"按路径窗口批量抽取，每 8 个楼层一次请求",
		{ timeout: 30_000 },
		async () => {
			const root = await writeRawRoot();
			const client = fakeClient();
			const progress: number[] = [];
			const result = await runEventsBackfill({
				rawRoot: root,
				dbPath: path.join(root, "eval.db"),
				client,
				embedder: fakeEmbedder(),
				onProgress: (entry) => progress.push(entry.requests),
			});

			expect(result.stories).toHaveLength(1);
			const story = result.stories[0];
			expect(story?.story).toBe(CHARACTER);
			expect(story?.imported).toBe(true);
			expect(story?.windowCount).toBe(3);
			expect(story?.extractedFloors).toBe(ASSISTANT_FLOORS);
			expect(story?.eventCount).toBe(ASSISTANT_FLOORS);
			expect(story?.vectorCount).toBe(story?.chunkCount);
			expect(result.requests).toBe(3);
			expect(progress).toEqual([1, 2, 3]);
			expect(client.windows.map((window) => window.length)).toEqual([8, 8, 8]);

			const store = StoryStore.open(path.join(root, "eval.db"), {
				embeddingDimensions: DIMENSIONS,
			});
			onTestFinished(() => store.close());
			expect(store.listExtractedEventNodeIds(CHARACTER)).toHaveLength(
				ASSISTANT_FLOORS,
			);
			const head = store.getHead(CHARACTER)?.id ?? "";
			const events = store.getEventsForPath(head, { limit: 100 });
			expect(events).toHaveLength(ASSISTANT_FLOORS);
			expect(new Set(events.map((event) => event.sourceNodeId)).size).toBe(
				ASSISTANT_FLOORS,
			);
			for (const event of events) {
				const source = store.getNode(event.sourceNodeId);
				expect(source?.role).toBe("assistant");
				expect(source?.raw).toBe(event.text);
			}
		},
	);

	it(
		"续跑跳过已抽取的窗口，重复运行不新增事件",
		{ timeout: 30_000 },
		async () => {
			const root = await writeRawRoot();
			const dbPath = path.join(root, "eval.db");
			const first = fakeClient();
			const firstRun = await runEventsBackfill({
				rawRoot: root,
				dbPath,
				client: first,
				embedder: fakeEmbedder(),
				maxWindows: 1,
			});
			expect(firstRun.windowCount).toBe(1);
			expect(firstRun.stoppedEarly).toBe(true);
			expect(first.calls).toBe(1);

			const second = fakeClient();
			const secondRun = await runEventsBackfill({
				rawRoot: root,
				dbPath,
				client: second,
				embedder: fakeEmbedder(),
			});
			expect(secondRun.stories[0]?.imported).toBe(false);
			expect(secondRun.windowCount).toBe(2);
			expect(secondRun.stoppedEarly).toBe(false);
			expect(second.calls).toBe(2);
			expect(secondRun.extractedFloors).toBe(ASSISTANT_FLOORS - 8);
			const resumed = second.windows.flat();
			expect(new Set(resumed).size).toBe(ASSISTANT_FLOORS - 8);
			expect(resumed.some((id) => first.windows[0]?.includes(id))).toBe(false);

			const store = StoryStore.open(dbPath, {
				embeddingDimensions: DIMENSIONS,
			});
			onTestFinished(() => store.close());
			const head = store.getHead(CHARACTER)?.id ?? "";
			const eventsBefore = store
				.getEventsForPath(head, { limit: 100 })
				.map((event) => event.text);

			const third = fakeClient();
			const thirdRun = await runEventsBackfill({
				rawRoot: root,
				dbPath,
				client: third,
				embedder: fakeEmbedder(),
			});
			expect(thirdRun.windowCount).toBe(0);
			expect(thirdRun.eventCount).toBe(ASSISTANT_FLOORS);
			expect(third.calls).toBe(0);

			const after = StoryStore.open(dbPath, {
				embeddingDimensions: DIMENSIONS,
			});
			onTestFinished(() => after.close());
			expect(
				after.getEventsForPath(head, { limit: 100 }).map((event) => event.text),
			).toEqual(eventsBefore);
			expect(after.listExtractedEventNodeIds(CHARACTER)).toHaveLength(
				ASSISTANT_FLOORS,
			);
		},
	);

	it(
		"窗口校验失败后重试会带上错误与允许的 nodeId，不会重复同一请求",
		{ timeout: 30_000 },
		async () => {
			const root = await writeRawRoot();
			const { client, prompts } = flakyClient();
			const result = await runEventsBackfill({
				rawRoot: root,
				dbPath: path.join(root, "eval.db"),
				client,
				embedder: fakeEmbedder(),
				maxWindows: 1,
			});

			expect(result.windowCount).toBe(1);
			expect(result.extractedFloors).toBe(8);
			expect(prompts).toHaveLength(2);
			const retryPrompt = prompts[1];
			if (retryPrompt === undefined) throw new Error("没有发出重试请求");
			expect(retryPrompt).toContain("上一次输出没有通过校验");
			expect(retryPrompt).toContain("不在本次窗口内");
			const allowed = [
				...retryPrompt.matchAll(new RegExp(`^- (${CHARACTER}:.+)$`, "gm")),
			].map((match) => match[1] as string);
			expect(allowed).toHaveLength(8);
			for (const id of allowed) {
				expect(retryPrompt).toContain(`id="${id}"`);
			}
		},
	);

	it("未知故事直接失败", { timeout: 30_000 }, async () => {
		const root = await writeRawRoot();
		await expect(
			runEventsBackfill({
				rawRoot: root,
				dbPath: path.join(root, "eval.db"),
				client: fakeClient(),
				embedder: fakeEmbedder(),
				story: "不存在的故事",
			}),
		).rejects.toThrow("manifest 里没有故事 不存在的故事");
	});
});

describe("runEventsBackfillCli", () => {
	it(
		"把两个缓存目录交给客户端，并根据 --resume 决定是否重建数据库",
		{ timeout: 30_000 },
		async () => {
			const root = await writeRawRoot();
			const dbPath = path.join(root, "eval.db");
			const eventCacheDirs: string[] = [];
			const embeddingCacheDirs: string[] = [];
			const clients: FakeClient[] = [];
			const run = async (options: {
				readonly resume: boolean;
				readonly maxWindows?: number;
			}) => {
				const client = fakeClient();
				clients.push(client);
				return runEventsBackfillCli({
					rawRoot: root,
					dbPath,
					eventsCacheDir: path.join(root, "events"),
					embeddingsCacheDir: path.join(root, "embeddings"),
					channelsPath: path.join(root, "channels.yaml"),
					envPath: path.join(root, ".env"),
					story: null,
					maxWindows: options.maxWindows ?? null,
					resume: options.resume,
					log: () => undefined,
					createEventClient: async (cacheDir) => {
						eventCacheDirs.push(cacheDir);
						return client;
					},
					createEmbedder: async (cacheDir) => {
						embeddingCacheDirs.push(cacheDir);
						return fakeEmbedder();
					},
				});
			};

			const first = await run({ resume: false, maxWindows: 1 });
			expect(first.windowCount).toBe(1);
			expect(first.stories[0]?.imported).toBe(true);

			const second = await run({ resume: true });
			expect(second.stories[0]?.imported).toBe(false);
			expect(second.windowCount).toBe(2);
			expect(clients[1]?.calls).toBe(2);

			const third = await run({ resume: false, maxWindows: 1 });
			expect(third.stories[0]?.imported).toBe(true);
			expect(clients[2]?.calls).toBe(1);

			const expectedEvents = path.join(root, "events");
			const expectedEmbeddings = path.join(root, "embeddings");
			expect(eventCacheDirs).toEqual([
				expectedEvents,
				expectedEvents,
				expectedEvents,
			]);
			expect(embeddingCacheDirs).toEqual([
				expectedEmbeddings,
				expectedEmbeddings,
				expectedEmbeddings,
			]);
		},
	);
});
