import { describe, expect, it } from "vitest";
import {
	type ContextSlotProviders,
	type LlmCallOptions,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	REQUEST_REWRITE_HOOK,
	type StoryStore,
	type TurnHookBudget,
	assembleContext,
	collectSlotProviders,
	createDefaultContextTemplate,
	createEventStream,
	createPluginKernel,
	createStandardChatSlots,
	createStaticSlotProvider,
	runChatTurn,
	runTurnHook,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const USAGE = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

// 时间预算断言用：Node 的 setTimeout 会提前约 1 毫秒触发（实测 20ms 定时器
// 最快 19.17ms），下界留 2 毫秒容差；上界留 500 毫秒，挡住「预算没生效、
// 拖到默认值或秒级卡顿」的回归。
const HOOK_BUDGET_MS = 20;
const EARLY_TOLERANCE_MS = 2;

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
			hookBudgetMs: HOOK_BUDGET_MS,
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
		expect(timeout?.reason).toContain(`超过时间预算 ${HOOK_BUDGET_MS} 毫秒`);
		// 耗时必须真的等够了预算：记成 0 或没把预算传给定时器都会跌破下界。
		expect(timeout?.durationMs).toBeGreaterThanOrEqual(
			HOOK_BUDGET_MS - EARLY_TOLERANCE_MS,
		);
		expect(timeout?.durationMs).toBeLessThan(HOOK_BUDGET_MS + 500);

		const normal = assembled.hooks?.find(
			(hook) => hook.plugin === "test/character",
		);
		expect(normal?.outcome).toBe("ok");
		expect(normal?.reason).toBeNull();
		// 没花时间的钩子记的是量出来的耗时，不是预算值。
		expect(Number.isFinite(normal?.durationMs)).toBe(true);
		expect(normal?.durationMs).toBeLessThan(HOOK_BUDGET_MS);
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

	it("提供者拿到时间预算，模板执行记录写进 Trace", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const providers: ContextSlotProviders = {
			character: {
				plugin: "test/ejs",
				provide(request) {
					expect(request.budget?.budgetMs).toBe(5_000);
					request.budget?.recordTemplate({
						source: "世界书 卡:开场",
						durationMs: 7,
						outcome: "ok",
						reason: null,
						functions: ["getvar", "getwi"],
					});
					return {
						messages: [{ role: "system" as const, content: "渲染结果" }],
						source: "st-ejs:character",
					};
				},
			},
		};

		const assembled = await assembleContext({
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			budgetTokens: 4_000,
			storyId: "s1",
			providers,
		});

		expect(assembled.hooks).toHaveLength(1);
		expect(assembled.hooks?.[0]).toMatchObject({
			extension: "context.slot",
			plugin: "test/ejs",
			hook: "character",
			outcome: "ok",
		});
		expect(assembled.hooks?.[0].templates).toEqual([
			{
				source: "世界书 卡:开场",
				durationMs: 7,
				outcome: "ok",
				reason: null,
				functions: ["getvar", "getwi"],
			},
		]);
		expect(
			assembled.messages.some((message) => message.content === "渲染结果"),
		).toBe(true);
	});

	it("钩子超时后保留已记录的模板，之后的记录不再写入", async () => {
		const { store } = openTempStore();
		seedStory(store);
		let captured: TurnHookBudget | null = null;
		const providers: ContextSlotProviders = {
			character: {
				plugin: "test/ejs-slow",
				async provide(request) {
					captured = request.budget ?? null;
					request.budget?.recordTemplate({
						source: "世界书 卡:循环",
						durationMs: 20,
						outcome: "timeout",
						reason: "超过时间预算 20 毫秒",
						functions: ["getvar"],
					});
					await new Promise<never>(() => {});
					throw new Error("不可达");
				},
			},
		};

		const assembled = await assembleContext({
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			budgetTokens: 4_000,
			storyId: "s1",
			providers,
			hookBudgetMs: 20,
		});

		const hook = assembled.hooks?.[0];
		expect(hook?.outcome).toBe("timeout");
		expect(hook?.templates).toHaveLength(1);
		expect(hook?.templates?.[0].source).toBe("世界书 卡:循环");

		if (captured === null) throw new Error("提供者没有拿到时间预算");
		expect(captured.remainingMs()).toBe(0);
		captured.recordTemplate({
			source: "迟到的模板",
			durationMs: 1,
			outcome: "ok",
			reason: null,
			functions: [],
		});
		expect(hook?.templates).toHaveLength(1);
	});
});

describe("钩子时间预算", () => {
	it("结束后剩余时间为 0，预算值原样可见", async () => {
		let remainingDuringRun = -1;
		const run = await runTurnHook({
			extension: "context.slot",
			hook: "character",
			plugin: "test/ejs",
			budgetMs: 500,
			run(budget) {
				remainingDuringRun = budget.remainingMs();
				expect(budget.budgetMs).toBe(500);
				return "内容";
			},
		});
		expect(run.value).toBe("内容");
		// 预算 500 减去收尾预留 50，钩子跑起来时剩余应靠近 450。
		expect(remainingDuringRun).toBeGreaterThanOrEqual(440);
		expect(remainingDuringRun).toBeLessThanOrEqual(450);
	});

	it("没有记录模板时 Trace 不带 templates 字段", async () => {
		const run = await runTurnHook({
			extension: "request.rewrite",
			hook: REQUEST_REWRITE_HOOK,
			plugin: "test/rewrite",
			run: () => [],
		});
		expect(run.trace).not.toHaveProperty("templates");
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
			HOOK_BUDGET_MS,
		);

		expect(result.messages.map((message) => message.content)).toEqual([
			"原文",
			"后面的钩子",
		]);
		expect(result.hooks[0]).toMatchObject({
			plugin: "test/rewrite-slow",
			outcome: "timeout",
		});
		expect(result.hooks[0]?.reason).toContain(
			`超过时间预算 ${HOOK_BUDGET_MS} 毫秒`,
		);
		expect(result.hooks[0]?.durationMs).toBeGreaterThanOrEqual(
			HOOK_BUDGET_MS - EARLY_TOLERANCE_MS,
		);
		expect(result.hooks[0]?.durationMs).toBeLessThan(HOOK_BUDGET_MS + 500);
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
		expect(sent.some((message) => message.content === "改写标记")).toBe(true);
		expect(sent.at(-1)?.content).toContain("【写作要求】");
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
