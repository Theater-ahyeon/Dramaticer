import { describe, expect, it } from "vitest";
import {
	type ContextSlotProviders,
	type LlmCallOptions,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	REQUEST_REWRITE_HOOK,
	type StoryStore,
	assembleContext,
	collectSlotProviders,
	createDefaultContextTemplate,
	createEventStream,
	createPluginKernel,
	createStandardChatSlots,
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

function createFakeClient(resultText: string): {
	client: LlmStreamingClient;
	requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const result: LlmResult = {
		text: resultText,
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
		continuation: { text: resultText, reasoning: "" },
	};
	return {
		requests,
		client: {
			async complete() {
				return result;
			},
			stream(request, _options?: LlmCallOptions) {
				requests.push(request);
				return createEventStream(async (emit) => {
					emit({ type: "text_delta", delta: resultText });
					return result;
				});
			},
		},
	};
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "钩子测试" });
}

/** 永远不返回的提供者；用真实的预算计时验证超时跳过，不依赖额外延时时长。 */
function slowProvider(plugin: string, content: string) {
	return {
		plugin,
		async provide() {
			await new Promise<never>(() => {});
			return {
				messages: [{ role: "system" as const, content }],
				source: `${plugin}:slow`,
			};
		},
	};
}

describe("槽位提供者的时间预算", () => {
	it("超时的提供者按缺失处理，并记录扩展点、插件、耗时与原因", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const providers: ContextSlotProviders = {
			character: {
				...createStaticSlotProvider(
					[{ role: "system", content: "角色设定" }],
					"card:角色",
				),
				plugin: "test/character",
			},
			memory: slowProvider("test/slow-memory", "慢记忆"),
		};

		const assembled = await assembleContext({
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			budgetTokens: 4_000,
			storyId: "s1",
			providers,
			hookBudgetMs: 20,
		});

		const memory = assembled.trace.entries.find(
			(entry) => entry.slot === "memory",
		);
		expect(memory?.status).toBe("missing-slot");
		expect(
			assembled.messages.some((message) => message.content.includes("慢记忆")),
		).toBe(false);

		const timeout = assembled.hooks?.find(
			(hook) => hook.plugin === "test/slow-memory",
		);
		expect(timeout).toMatchObject({
			extension: "context.slot",
			hook: "memory",
			outcome: "timeout",
		});
		expect(timeout?.reason).toContain("超过时间预算 20 毫秒");
		expect(timeout?.durationMs).toBeGreaterThanOrEqual(20);

		const normal = assembled.hooks?.find(
			(hook) => hook.plugin === "test/character",
		);
		expect(normal?.outcome).toBe("ok");
		expect(normal?.reason).toBeNull();
		expect(typeof normal?.durationMs).toBe("number");
	});

	it("没有插件名的提供者不做计时，Trace 里没有钩子字段", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const providers: ContextSlotProviders = {
			character: createStaticSlotProvider(
				[{ role: "system", content: "角色设定" }],
				"card:角色",
			),
		};

		const assembled = await assembleContext({
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			budgetTokens: 4_000,
			storyId: "s1",
			providers,
		});

		expect(assembled.hooks).toBeUndefined();
		expect(
			assembled.messages.some((message) => message.content === "角色设定"),
		).toBe(true);
	});
});

describe("组装后的请求改写", () => {
	it("按注册顺序依次改写同一个请求，并记录每个插件", async () => {
		const kernel = await createPluginKernel({ plugins: [] });
		await kernel.load({
			name: "test/rewrite-first",
			apply(ctx) {
				ctx.on(REQUEST_REWRITE_HOOK, (messages) => [
					...(messages as readonly { role: "system"; content: string }[]),
					{ role: "system", content: "第一段" },
				]);
			},
		});
		await kernel.load({
			name: "test/rewrite-second",
			apply(ctx) {
				ctx.on(REQUEST_REWRITE_HOOK, (messages) => [
					...(messages as readonly { role: "system"; content: string }[]),
					{ role: "system", content: "第二段" },
				]);
			},
		});

		const result = await kernel.rewriteRequest([
			{ role: "user", content: "原文" },
		]);

		expect(result.messages.map((message) => message.content)).toEqual([
			"原文",
			"第一段",
			"第二段",
		]);
		expect(result.hooks.map((hook) => hook.plugin)).toEqual([
			"test/rewrite-first",
			"test/rewrite-second",
		]);
		expect(result.hooks.every((hook) => hook.outcome === "ok")).toBe(true);
		expect(
			result.hooks.every((hook) => hook.extension === "request.rewrite"),
		).toBe(true);

		await kernel.dispose();
	});

	it("超时的改写钩子被跳过，后面的钩子继续改写", async () => {
		const kernel = await createPluginKernel({ plugins: [] });
		await kernel.load({
			name: "test/rewrite-slow",
			apply(ctx) {
				ctx.on(REQUEST_REWRITE_HOOK, () => new Promise<never>(() => {}));
			},
		});
		await kernel.load({
			name: "test/rewrite-later",
			apply(ctx) {
				ctx.on(REQUEST_REWRITE_HOOK, (messages) => [
					...(messages as readonly { role: "system"; content: string }[]),
					{ role: "system", content: "后面的钩子" },
				]);
			},
		});

		const result = await kernel.rewriteRequest(
			[{ role: "user", content: "原文" }],
			20,
		);

		expect(result.messages.map((message) => message.content)).toEqual([
			"原文",
			"后面的钩子",
		]);
		expect(result.hooks[0]).toMatchObject({
			plugin: "test/rewrite-slow",
			outcome: "timeout",
		});
		expect(result.hooks[0]?.reason).toContain("超过时间预算 20 毫秒");
		expect(result.hooks[1]?.outcome).toBe("ok");

		await kernel.dispose();
	});
});

describe("回合内钩子", () => {
	it("超时槽位不进入请求，回合继续，Trace 记录两条钩子", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient("山门打开。");
		const kernel = await createPluginKernel({ plugins: [] });
		await kernel.load({
			name: "test/rewrite-turn",
			apply(ctx) {
				ctx.on(REQUEST_REWRITE_HOOK, (messages) => [
					...(messages as readonly { role: "system"; content: string }[]),
					{ role: "system", content: "改写标记" },
				]);
			},
		});
		const providers: ContextSlotProviders = {
			character: {
				...createStaticSlotProvider(
					[{ role: "system", content: "角色设定" }],
					"card:角色",
				),
				plugin: "test/character",
			},
			memory: slowProvider("test/slow-memory", "慢记忆"),
		};

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我推门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers,
			requestRewriter: kernel,
			hookBudgetMs: 20,
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			model: "fake",
		});

		expect(requests).toHaveLength(1);
		const sent = requests[0]?.messages ?? [];
		expect(sent.some((message) => message.content.includes("慢记忆"))).toBe(
			false,
		);
		expect(sent.at(-1)?.content).toBe("改写标记");
		expect(result.node.raw).toBe("山门打开。");
		const hooks = result.trace.hooks ?? [];
		expect(hooks.map((hook) => hook.plugin)).toEqual(
			expect.arrayContaining(["test/slow-memory", "test/rewrite-turn"]),
		);
		expect(
			hooks.find((hook) => hook.plugin === "test/slow-memory")?.outcome,
		).toBe("timeout");
		expect(
			hooks.find((hook) => hook.plugin === "test/rewrite-turn")?.outcome,
		).toBe("ok");

		await kernel.dispose();
	});

	it("内核收集的槽位带插件名，每个提供者都有耗时记录", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendNode({
			id: "n0",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "你好。",
		});
		const slots = await createStandardChatSlots({
			store,
			characterPrompt: "你扮演山神。",
		});
		const { client } = createFakeClient("山门打开。");

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我推门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: collectSlotProviders(slots.kernel),
			requestRewriter: slots.kernel,
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			model: "fake",
		});

		const hooks = result.trace.hooks ?? [];
		expect(hooks.map((hook) => hook.plugin)).toEqual(
			expect.arrayContaining(["slot.character", "slot.history"]),
		);
		expect(hooks.every((hook) => hook.extension === "context.slot")).toBe(true);
		expect(hooks.every((hook) => hook.outcome === "ok")).toBe(true);
		expect(hooks.every((hook) => typeof hook.durationMs === "number")).toBe(
			true,
		);

		await slots.kernel.dispose();
	});

	it("没有插件提供者与改写入口时 Trace 不新增钩子字段", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient("山门打开。");

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我推门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: {
				character: createStaticSlotProvider(
					[{ role: "system", content: "角色设定" }],
					"card:角色",
				),
			},
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			model: "fake",
		});

		expect(result.trace.hooks).toBeUndefined();
	});
});
