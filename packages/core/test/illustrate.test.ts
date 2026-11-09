import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type BackgroundJobHandler,
	type CharacterVisualProfile,
	ILLUSTRATE_JOB_KIND,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmToolCall,
	type NodeImageRecord,
	type StoryStore,
	createBackgroundJobRegistry,
	createDefaultContextTemplate,
	createEventStream,
	createHistorySlotProvider,
	createIllustrateHandler,
	createStaticSlotProvider,
	drainBackgroundJobs,
	illustrateNeedsRun,
	readImageDimensions,
	runChatTurn,
	validateImagePromptRequest,
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
	readonly client: LlmStreamingClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const client: LlmStreamingClient = {
		async complete() {
			throw new Error("本测试不使用 complete");
		},
		stream(request) {
			const index = requests.length;
			const round = rounds[index];
			if (round === undefined) {
				throw new Error(`没有为第 ${index + 1} 次请求准备回复`);
			}
			requests.push(request);
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

function workflowRaw(): unknown {
	return {
		"3": {
			class_type: "KSampler",
			inputs: {
				seed: 1,
				positive: ["6", 0],
				negative: ["7", 0],
				latent_image: ["5", 0],
			},
		},
		"5": {
			class_type: "EmptyLatentImage",
			inputs: { width: 512, height: 768 },
		},
		"6": { class_type: "CLIPTextEncode", inputs: { text: "一只猫" } },
		"7": { class_type: "CLIPTextEncode", inputs: { text: "低质量" } },
	};
}

const SLOTS = {
	positive: { nodeId: "6", input: "text" },
	negative: { nodeId: "7", input: "text" },
	seed: { nodeId: "3", input: "seed" },
	width: { nodeId: "5", input: "width" },
	height: { nodeId: "5", input: "height" },
};

function seedStory(store: StoryStore): string {
	store.createStory({ id: "s1", title: "出图" });
	const workflow = store.saveImageWorkflow({
		name: "basic",
		provider: "comfy",
		payload: workflowRaw() as never,
		slots: SLOTS,
	});
	store.appendNode({
		id: "n0",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "雨夜的车站。",
	});
	return workflow.id;
}

function providers(store: StoryStore) {
	return {
		character: createStaticSlotProvider(
			[{ role: "system", content: "你扮演站务员。" }],
			"card:站务员",
		),
		history: createHistorySlotProvider(store, { limit: 10 }),
	};
}

const template = () =>
	createDefaultContextTemplate({ structuredOutput: "text-tags" });

function illustrateCall(
	args: Record<string, unknown> = { scene: "雨夜的站台" },
	id = "call-1",
): LlmToolCall {
	return { id, name: "illustrate", arguments: args };
}

describe("illustrate 工具与回合登记", () => {
	it("只有 auto、workflow 存在且 provider 配置时才提供给模型", async () => {
		const { store } = openTempStore();
		const workflowId = seedStory(store);
		const settings = {
			mode: "auto" as const,
			workflowId,
			maxPerFloor: 1,
			minFloorsBetween: 0,
		};
		const { client, requests } = createScriptedClient([
			{ text: "第一轮。" },
			{ text: "第二轮。" },
			{ text: "第三轮。" },
			{ text: "第四轮。" },
			{ text: "第五轮。" },
		]);

		const run = async (illustrate: unknown) =>
			runChatTurn({
				store,
				client,
				storyId: "s1",
				userText: "继续。",
				template: template(),
				providers: providers(store),
				budgetTokens: 4_000,
				structuredOutput: "text-tags",
				illustrate: illustrate as never,
			});

		await run(settings);
		expect(requests[0]?.tools?.map((tool) => tool.name)).toContain(
			"illustrate",
		);
		await run({ ...settings, mode: "manual" });
		expect(requests[1]?.tools?.map((tool) => tool.name) ?? []).not.toContain(
			"illustrate",
		);
		await run({ ...settings, mode: "off" });
		expect(requests[2]?.tools?.map((tool) => tool.name) ?? []).not.toContain(
			"illustrate",
		);
		await run({ ...settings, providerConfigured: false });
		expect(requests[3]?.tools?.map((tool) => tool.name) ?? []).not.toContain(
			"illustrate",
		);
		await run({ ...settings, workflowId: "missing" });
		expect(requests[4]?.tools?.map((tool) => tool.name) ?? []).not.toContain(
			"illustrate",
		);
	});

	it("合法调用在楼层写入后产生 pending 行，原文不变", async () => {
		const { store } = openTempStore();
		const workflowId = seedStory(store);
		store.updateStorySettings("s1", {
			imageConfig: {
				mode: "auto",
				workflowId,
				maxPerFloor: 1,
				minFloorsBetween: 0,
			},
		});
		const { client } = createScriptedClient([
			{
				text: "站台的灯忽然亮了。",
				toolCalls: [
					illustrateCall({
						scene: "雨夜的站台",
						characters: ["站务员"],
						shot: "wide",
						mood: "压抑",
					}),
				],
			},
		]);
		const turn = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我走向站台。",
			template: template(),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			illustrate: {
				mode: "auto",
				workflowId,
				maxPerFloor: 1,
				minFloorsBetween: 0,
				providerConfigured: true,
				seed: () => 42,
			},
		});
		const images = store.listNodeImages(turn.node.id);
		expect(images).toHaveLength(1);
		expect(images[0]).toMatchObject({
			status: "pending",
			workflowId,
			seed: 42,
			request: {
				scene: "雨夜的站台",
				characters: ["站务员"],
				shot: "wide",
				mood: "压抑",
			},
		});
		expect(turn.node.raw).toBe("站台的灯忽然亮了。");
		expect(turn.trace.images).toEqual({ accepted: 1, rejected: [] });
		expect(turn.trace.tools.calls).toContainEqual({
			name: "illustrate",
			ok: true,
			error: null,
		});
	});

	it("参数非法、超过每楼上限与间隔不足都被拒绝并写入 Trace", async () => {
		const { store } = openTempStore();
		const workflowId = seedStory(store);
		store.updateStorySettings("s1", {
			imageConfig: {
				mode: "auto",
				workflowId,
				maxPerFloor: 1,
				minFloorsBetween: 3,
			},
		});
		store.insertNodeImage({
			storyId: "s1",
			nodeId: "n0",
			request: { scene: "更早的一张图" },
			workflowId,
			seed: 1,
		});
		const { client } = createScriptedClient([
			{
				text: "第一段正文。",
				toolCalls: [
					illustrateCall({ scene: "" }),
					illustrateCall({ scene: "正常场景", extra: true }, "call-2"),
					illustrateCall(
						{
							scene: "正常场景",
							characters: ["a", "b", "c", "d", "e"],
						},
						"call-3",
					),
					illustrateCall({ scene: "正常场景" }, "call-4"),
				],
			},
		]);
		const turn = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我继续走。",
			template: template(),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			illustrate: {
				mode: "auto",
				workflowId,
				maxPerFloor: 1,
				minFloorsBetween: 3,
				providerConfigured: true,
			},
		});
		expect(store.listNodeImages(turn.node.id)).toHaveLength(0);
		expect(turn.trace.images?.accepted).toBe(0);
		expect(turn.trace.images?.rejected).toHaveLength(4);
		expect(turn.trace.images?.rejected[0]).toContain("scene");
		expect(turn.trace.images?.rejected[1]).toContain("不接受字段");
		expect(turn.trace.images?.rejected[2]).toContain("最多 4 个");
		expect(turn.trace.images?.rejected[3]).toContain("至少需要 3 个");
		expect(turn.node.raw).toBe("第一段正文。");
	});

	it("文本协议下 mode 为 off 或 manual 的调用被拒绝，楼层照常保存", async () => {
		const { store } = openTempStore();
		const workflowId = seedStory(store);
		const { client } = createScriptedClient([
			{
				text: `正文一。<tool name="illustrate">{"scene":"雨夜"}</tool>`,
			},
			{
				text: `正文二。<tool name="illustrate">{"scene":"雨夜"}</tool>`,
			},
		]);
		const run = async (mode: "off" | "manual") =>
			runChatTurn({
				store,
				client,
				storyId: "s1",
				userText: "继续。",
				template: template(),
				providers: providers(store),
				budgetTokens: 4_000,
				structuredOutput: "text-tags",
				toolTransport: "text",
				illustrate: {
					mode,
					workflowId,
					maxPerFloor: 1,
					minFloorsBetween: 0,
					providerConfigured: true,
				},
			});
		const off = await run("off");
		expect(off.node.raw).toBe("正文一。");
		expect(off.trace.images?.rejected[0]).toContain("off");
		const manual = await run("manual");
		expect(manual.trace.images?.rejected[0]).toContain("manual");
		expect(store.listNodeImages(manual.node.id)).toHaveLength(0);
	});

	it("文本协议混合读取轮里对 illustrate 返回已登记", async () => {
		const { store } = openTempStore();
		const workflowId = seedStory(store);
		const { client, requests } = createScriptedClient([
			{
				text: [
					`我先查记忆。<tool name="memory_search">{"query":"车站"}</tool>`,
					`<tool name="illustrate">{"scene":"雨夜的站台"}</tool>`,
				].join("\n"),
			},
			{ text: "雨还在下。" },
		]);
		const turn = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我继续走。",
			template: template(),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			toolTransport: "text",
			illustrate: {
				mode: "auto",
				workflowId,
				maxPerFloor: 1,
				minFloorsBetween: 0,
				providerConfigured: true,
			},
		});
		expect(requests).toHaveLength(2);
		const toolMessages = (requests[1]?.messages ?? []).filter(
			(message) => message.role === "tool",
		);
		expect(
			toolMessages.some(
				(message) =>
					message.toolName === "illustrate" &&
					message.content === "已登记，后台会处理。",
			),
		).toBe(true);
		expect(store.listNodeImages(turn.node.id)).toHaveLength(1);
	});

	it("同楼两张调用在 maxPerFloor 为 1 时只接受第一张", async () => {
		const { store } = openTempStore();
		const workflowId = seedStory(store);
		const { client } = createScriptedClient([
			{
				text: "两张图的一楼。",
				toolCalls: [
					illustrateCall({ scene: "第一张" }, "call-1"),
					illustrateCall({ scene: "第二张" }, "call-2"),
				],
			},
		]);
		const turn = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "继续。",
			template: template(),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			illustrate: {
				mode: "auto",
				workflowId,
				maxPerFloor: 1,
				minFloorsBetween: 0,
				providerConfigured: true,
			},
		});
		const images = store.listNodeImages(turn.node.id);
		expect(images).toHaveLength(1);
		expect(images[0]?.request.scene).toBe("第一张");
		expect(turn.trace.images?.accepted).toBe(1);
		expect(turn.trace.images?.rejected[0]).toContain("每楼最多 1 张");
	});
});

function pngBytes(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes;
}

function fakeLlmClient(): LlmClient {
	return {
		async complete() {
			throw new Error("出图任务不调用文本模型");
		},
	};
}

function imageStory(store: StoryStore): {
	readonly workflowId: string;
	readonly nodes: readonly string[];
} {
	const workflowId = seedStory(store);
	const nodes = ["n0"];
	for (let index = 1; index <= 3; index += 1) {
		const id = `n${index}`;
		store.appendNode({
			id,
			storyId: "s1",
			parentId: nodes[index - 1] as string,
			role: "assistant",
			raw: `第 ${index} 楼。`,
		});
		nodes.push(id);
	}
	store.updateStorySettings("s1", {
		imageConfig: {
			mode: "auto",
			workflowId,
			maxPerFloor: 4,
			minFloorsBetween: 0,
		},
	});
	return { workflowId, nodes };
}

function addPending(
	store: StoryStore,
	nodeId: string,
	workflowId: string,
	scene: string,
): NodeImageRecord {
	return store.insertNodeImage({
		storyId: "s1",
		nodeId,
		request: { scene },
		workflowId,
		seed: 7,
	});
}

describe("出图后台队列", () => {
	it("假 provider 下两行依次完成并写入文件与宽高，已完成行不重复调用", async () => {
		const { store, path } = openTempStore();
		const { workflowId, nodes } = imageStory(store);
		const mediaDir = join(path, "..", "images");
		const first = addPending(store, nodes[0] as string, workflowId, "第一张");
		const second = addPending(store, nodes[2] as string, workflowId, "第二张");
		let calls = 0;
		const registry = createBackgroundJobRegistry({
			[ILLUSTRATE_JOB_KIND]: {
				handler: createIllustrateHandler({
					config: {
						providers: new Map([
							[
								"comfy",
								{
									id: "comfy",
									api: "comfyui",
									baseUrl: "http://127.0.0.1:8188",
									apiKey: "",
									timeoutMs: 1_000,
									pollIntervalMs: 1,
								},
							],
						]),
					},
					mediaDir,
					createClient: () => ({
						async generate() {
							calls += 1;
							return {
								promptId: "p",
								fileName: "a.png",
								mediaType: "image/png",
								bytes: pngBytes(512, 768),
							};
						},
					}),
				}),
				enqueue: "story",
				tier: "gap",
				needsRun: illustrateNeedsRun,
			},
		});
		const drain = () =>
			drainBackgroundJobs({
				store,
				registry,
				client: fakeLlmClient(),
				storyId: "s1",
				sessionEnded: true,
			});
		await drain();
		expect(calls).toBe(2);
		for (const image of [first, second]) {
			const done = store.getNodeImage(image.id);
			expect(done).toMatchObject({
				status: "done",
				width: 512,
				height: 768,
				mediaType: "image/png",
				attempts: 0,
			});
			expect(done?.fileName).toBe(`s1/${image.id}.png`);
			expect(existsSync(join(mediaDir, "s1", `${image.id}.png`))).toBe(true);
		}
		await drain();
		expect(calls).toBe(2);
	});

	it("每次最多两张，剩余行留到下一轮", async () => {
		const { store, path } = openTempStore();
		const { workflowId, nodes } = imageStory(store);
		const pending = [
			addPending(store, nodes[0] as string, workflowId, "一"),
			addPending(store, nodes[1] as string, workflowId, "二"),
			addPending(store, nodes[2] as string, workflowId, "三"),
		];
		const registry = createBackgroundJobRegistry({
			[ILLUSTRATE_JOB_KIND]: {
				handler: createIllustrateHandler({
					config: {
						providers: new Map([
							[
								"comfy",
								{
									id: "comfy",
									api: "comfyui",
									baseUrl: "http://127.0.0.1:8188",
									apiKey: "",
									timeoutMs: 1_000,
									pollIntervalMs: 1,
								},
							],
						]),
					},
					mediaDir: join(path, "..", "images"),
					createClient: () => ({
						async generate() {
							return {
								promptId: "p",
								fileName: "a.png",
								mediaType: "image/png",
								bytes: pngBytes(8, 8),
							};
						},
					}),
				}),
				enqueue: "story",
				tier: "gap",
				needsRun: illustrateNeedsRun,
			},
		});
		const drain = () =>
			drainBackgroundJobs({
				store,
				registry,
				client: fakeLlmClient(),
				storyId: "s1",
				sessionEnded: true,
			});
		await drain();
		const first = pending.map((image) => store.getNodeImage(image.id)?.status);
		expect(first.filter((status) => status === "done")).toHaveLength(2);
		expect(first.filter((status) => status === "pending")).toHaveLength(1);
		await drain();
		expect(
			pending.map((image) => store.getNodeImage(image.id)?.status),
		).toEqual(["done", "done", "done"]);
	});

	it("单行连续失败三次后标为 failed，其它行继续", async () => {
		const { store, path } = openTempStore();
		const { workflowId, nodes } = imageStory(store);
		const failing = addPending(store, nodes[0] as string, workflowId, "失败图");
		const good = addPending(store, nodes[2] as string, workflowId, "成功图");
		let calls = 0;
		const registry = createBackgroundJobRegistry({
			[ILLUSTRATE_JOB_KIND]: {
				handler: createIllustrateHandler({
					config: {
						providers: new Map([
							[
								"comfy",
								{
									id: "comfy",
									api: "comfyui",
									baseUrl: "http://127.0.0.1:8188",
									apiKey: "",
									timeoutMs: 1_000,
									pollIntervalMs: 1,
								},
							],
						]),
					},
					mediaDir: join(path, "..", "images"),
					createClient: () => ({
						async generate() {
							calls += 1;
							if (calls === 1 || calls >= 3) {
								throw new Error(`第 ${calls} 次失败`);
							}
							return {
								promptId: "p",
								fileName: "a.png",
								mediaType: "image/png",
								bytes: pngBytes(4, 4),
							};
						},
					}),
				}),
				enqueue: "story",
				tier: "gap",
				needsRun: illustrateNeedsRun,
			},
		});
		const drain = () =>
			drainBackgroundJobs({
				store,
				registry,
				client: fakeLlmClient(),
				storyId: "s1",
				sessionEnded: true,
			});
		await drain();
		expect(store.getNodeImage(good.id)?.status).toBe("done");
		expect(store.getNodeImage(failing.id)).toMatchObject({
			status: "pending",
			attempts: 1,
		});
		await drain();
		await drain();
		const failed = store.getNodeImage(failing.id);
		expect(failed).toMatchObject({ status: "failed", attempts: 3 });
		expect(failed?.error).toContain("第 4 次失败");
		expect(store.getNodeImage(good.id)?.status).toBe("done");
		expect(calls).toBe(4);
	});

	it("没有 provider 时任务失败且行保持 pending", async () => {
		const { store, path } = openTempStore();
		const { workflowId, nodes } = imageStory(store);
		const image = addPending(store, nodes[0] as string, workflowId, "缺配置");
		const handler = createIllustrateHandler({
			config: { providers: new Map() },
			mediaDir: join(path, "..", "images"),
			createClient: () => {
				throw new Error("不应该创建客户端");
			},
		});
		await expect(
			handler({
				store,
				client: fakeLlmClient(),
				job: {
					id: 1,
					storyId: "s1",
					nodeId: null,
					kind: ILLUSTRATE_JOB_KIND,
					status: "running",
					attempts: 1,
					lastError: null,
					createdAt: new Date(0).toISOString(),
					startedAt: null,
					finishedAt: null,
				},
			}),
		).rejects.toThrow("provider");
		expect(store.getNodeImage(image.id)).toMatchObject({
			status: "pending",
			attempts: 0,
		});
	});

	it("旧分支的 pending 行不被处理，切回后继续", async () => {
		const { store, path } = openTempStore();
		const { workflowId, nodes } = imageStory(store);
		const onOldBranch = addPending(
			store,
			nodes[2] as string,
			workflowId,
			"旧分支",
		);
		store.setHead("s1", nodes[0] as string);
		let calls = 0;
		const handler = createIllustrateHandler({
			config: {
				providers: new Map([
					[
						"comfy",
						{
							id: "comfy",
							api: "comfyui",
							baseUrl: "http://127.0.0.1:8188",
							apiKey: "",
							timeoutMs: 1_000,
							pollIntervalMs: 1,
						},
					],
				]),
			},
			mediaDir: join(path, "..", "images"),
			createClient: () => ({
				async generate() {
					calls += 1;
					return {
						promptId: "p",
						fileName: "a.png",
						mediaType: "image/png",
						bytes: pngBytes(2, 2),
					};
				},
			}),
		});
		const job = {
			id: 1,
			storyId: "s1",
			nodeId: null,
			kind: ILLUSTRATE_JOB_KIND,
			status: "running" as const,
			attempts: 1,
			lastError: null,
			createdAt: new Date(0).toISOString(),
			startedAt: null,
			finishedAt: null,
		};
		await handler({ store, client: fakeLlmClient(), job });
		expect(calls).toBe(0);
		expect(store.getNodeImage(onOldBranch.id)?.status).toBe("pending");
		expect(illustrateNeedsRun(store, "s1")).toBe(false);
		store.setHead("s1", nodes[3] as string);
		expect(illustrateNeedsRun(store, "s1")).toBe(true);
		await handler({ store, client: fakeLlmClient(), job });
		expect(calls).toBe(1);
		expect(store.getNodeImage(onOldBranch.id)?.status).toBe("done");
	});

	it("启动时把 running 行退回 pending", () => {
		const { store } = openTempStore();
		const { workflowId, nodes } = imageStory(store);
		const image = addPending(store, nodes[0] as string, workflowId, "中断");
		store.startNodeImage(image.id, {
			prompt: "p",
			negativePrompt: "n",
		});
		expect(store.getNodeImage(image.id)?.status).toBe("running");
		expect(store.requeueRunningNodeImages()).toBe(1);
		expect(store.getNodeImage(image.id)?.status).toBe("pending");
	});
});

describe("图片头部尺寸", () => {
	it("读取 PNG、GIF、WebP 与 JPEG", () => {
		expect(readImageDimensions(pngBytes(640, 480), "image/png")).toEqual({
			width: 640,
			height: 480,
		});
		const gif = new Uint8Array(10);
		gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
		gif[6] = 0x40;
		gif[7] = 0x01;
		gif[8] = 0xf0;
		gif[9] = 0x00;
		expect(readImageDimensions(gif, "image/gif")).toEqual({
			width: 320,
			height: 240,
		});
		const webp = new Uint8Array(30);
		webp.set([0x52, 0x49, 0x46, 0x46], 0);
		webp.set([0x57, 0x45, 0x42, 0x50], 8);
		webp.set([0x56, 0x50, 0x38, 0x58], 12);
		webp[24] = 0x7f;
		webp[27] = 0x2f;
		expect(readImageDimensions(webp, "image/webp")).toEqual({
			width: 128,
			height: 48,
		});
		const jpeg = new Uint8Array(21);
		jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
		jpeg[7] = 0x02;
		jpeg[8] = 0x58;
		jpeg[9] = 0x03;
		jpeg[10] = 0x20;
		expect(readImageDimensions(jpeg, "image/jpeg")).toEqual({
			width: 800,
			height: 600,
		});
	});
});

describe("生图请求校验", () => {
	it("拒绝未知字段、超长场景与空人物名", () => {
		expect(() => validateImagePromptRequest({ scene: "a", extra: 1 })).toThrow(
			"不接受字段",
		);
		expect(() =>
			validateImagePromptRequest({ scene: "a".repeat(501) }),
		).toThrow("最多 500");
		expect(() =>
			validateImagePromptRequest({ scene: "a", characters: [""] }),
		).toThrow("非空字符串");
	});
});
