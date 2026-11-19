import { describe, expect, it } from "vitest";
import {
	type LlmCallOptions,
	type LlmRequest,
	type LlmResult,
	type LlmStream,
	type LlmStreamingClient,
	MAX_PLAN_PHASES,
	PLAN_PREPARE_JOB_KIND,
	PLAN_PREP_PHASES,
	PLAN_REVIEW_JOB_KIND,
	PLAN_TURN_STEPS,
	createDefaultContextTemplate,
	createDirectorSlotProvider,
	createHistorySlotProvider,
	createPlanPrepareHandler,
	createPlanReviewHandler,
	createStateSlotProvider,
	createStaticSlotProvider,
	planPrepareNeedsRun,
	planReviewNeedsRun,
	readPlanReview,
	readPreparedPlan,
	runChatTurn,
	runPlanPhases,
} from "../src/index.js";
import type { DirectorPush, StoryStore } from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const USAGE = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

function llmResult(text: string): LlmResult {
	return {
		text,
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
		continuation: null,
	};
}

function requestText(request: LlmRequest): string {
	return request.messages
		.map((message) => message.content)
		.filter((content) => typeof content === "string")
		.join("\n");
}

const INTENT_MARKER = "一个人此刻想做什么";

/** 按 system 提示词判断这一步是哪个阶段，返回该阶段的假回复。 */
function defaultReply(request: LlmRequest): string {
	const system = requestText(request);
	if (system.includes("从目录里挑出")) return '["l0"]';
	const intent = system.match(/你只写「(.+?)」一个人此刻想做什么/u);
	if (intent !== null) return `${intent[1]}：抬头看殿门。`;
	if (system.includes("写出下一楼的计划"))
		return "1. 甲走到殿门。\n2. 雨声变大。";
	if (system.includes("你是规划写法的复查阶段")) {
		return JSON.stringify({ issues: [], rewrite: "" });
	}
	return "山门缓缓打开。";
}

function scriptedClient(
	respond: (request: LlmRequest) => string = defaultReply,
): { readonly client: LlmStreamingClient; readonly requests: LlmRequest[] } {
	const requests: LlmRequest[] = [];
	const answer = (request: LlmRequest): LlmResult => {
		requests.push(request);
		return llmResult(respond(request));
	};
	const client: LlmStreamingClient = {
		async complete(request: LlmRequest, _options?: LlmCallOptions) {
			return answer(request);
		},
		stream(request: LlmRequest, _options?: LlmCallOptions): LlmStream {
			const result = answer(request);
			return {
				async *[Symbol.asyncIterator]() {
					yield { type: "text_delta" as const, delta: result.text };
				},
				async result() {
					return result;
				},
			};
		},
	};
	return { client, requests };
}

function seedPlanStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。甲与乙站在殿里。",
	});
	store.saveSceneLog({
		nodeId: "a1",
		storyId: "s1",
		beat: "开场",
		present: ["甲", "乙"],
		sceneEnds: false,
		sceneCard: {
			present: [
				{ who: "甲", want: "找到密道" },
				{ who: "乙", want: "离开这里" },
			],
			change: "两人进了殿",
		},
		bits: [],
		conditions: [],
		states: [],
		quotes: { submitted: 0, verified: 0 },
		repairs: [],
	});
	store.insertLoreEntries([
		{
			id: "lore1",
			storyId: "s1",
			name: "密道",
			content: "殿后的墙里有一条密道。",
			source: "test:lore",
		},
	]);
	store.insertMemoryEvents([
		{
			id: "e1",
			storyId: "s1",
			sourceNodeId: "a1",
			ordinal: 0,
			participants: ["甲"],
			knowers: ["甲"],
			importance: 0.5,
			text: "甲在佛堂看见密道",
			source: "test:events",
		},
		{
			id: "e2",
			storyId: "s1",
			sourceNodeId: "a1",
			ordinal: 1,
			participants: ["乙"],
			knowers: ["乙"],
			importance: 0.5,
			text: "乙偷了钥匙",
			source: "test:events",
		},
		{
			id: "e3",
			storyId: "s1",
			sourceNodeId: "a1",
			ordinal: 2,
			participants: [],
			knowers: [],
			importance: 0.2,
			text: "殿外下着雨",
			source: "test:events",
		},
	]);
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

function jobFor(storyId: string, kind = PLAN_REVIEW_JOB_KIND) {
	return {
		id: 1,
		storyId,
		nodeId: null,
		kind,
		status: "running" as const,
		attempts: 1,
		lastError: null,
		createdAt: "2026-11-19T12:00:00.000Z",
		startedAt: "2026-11-19T12:00:00.000Z",
		finishedAt: null,
	};
}

describe("规划写法", () => {
	it("准备阶段按固定顺序走一遍，数量不超过上限", async () => {
		const { store } = openTempStore();
		seedPlanStory(store);
		const { client } = scriptedClient();

		const preparation = await runPlanPhases({
			store,
			client,
			storyId: "s1",
			anchorNodeId: "a1",
			playerMessage: "我看向殿门。",
			push: null,
		});

		expect(preparation.trace.schedule).toEqual([...PLAN_TURN_STEPS]);
		expect(preparation.trace.schedule).toHaveLength(MAX_PLAN_PHASES);
		expect(preparation.trace.phases.map((phase) => phase.name)).toEqual([
			"挑记忆",
			"角色意图",
			"定计划",
		]);
		expect(preparation.trace.phases.length).toBeLessThanOrEqual(
			MAX_PLAN_PHASES,
		);
		expect(preparation.text).toContain("这一楼的计划");
	});

	it("正文楼层落定后 Trace 记下固定阶段顺序与实走阶段", async () => {
		const { store } = openTempStore();
		seedPlanStory(store);
		store.setStoryValue("s1", "writingMode", "plan");
		const { client, requests } = scriptedClient();

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我看向殿门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 40_000,
			structuredOutput: "text-tags",
			model: "fake",
		});

		const trace = store.getTurnTrace(result.node.id);
		expect(trace?.plan?.schedule).toEqual([...PLAN_TURN_STEPS]);
		expect(trace?.plan?.prepared).toBe(false);
		expect(trace?.plan?.phases.length).toBeLessThanOrEqual(MAX_PLAN_PHASES);
		expect(trace?.plan?.phases.map((phase) => phase.name)).toEqual([
			"挑记忆",
			"角色意图",
			"定计划",
		]);
		// 准备阶段的调用在正文之前；正文是最后一次调用。
		expect(requests.length).toBe(5);
	});

	it("某个准备阶段失败时，正文照常写出，Trace 只记走过的阶段", async () => {
		const { store } = openTempStore();
		seedPlanStory(store);
		store.setStoryValue("s1", "writingMode", "plan");
		const { client } = scriptedClient((request) => {
			if (requestText(request).includes("写出下一楼的计划")) {
				throw new Error("模型渠道不可用");
			}
			return defaultReply(request);
		});

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我看向殿门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 40_000,
			structuredOutput: "text-tags",
			model: "fake",
		});

		expect(result.node.role).toBe("assistant");
		const trace = store.getTurnTrace(result.node.id);
		expect(trace?.plan?.phases.map((phase) => phase.name)).toEqual([
			"挑记忆",
			"角色意图",
		]);
		expect(trace?.plan?.schedule).toEqual([...PLAN_TURN_STEPS]);
	});

	it("每个角色的意图只用他自己知道的事生成", async () => {
		const { store } = openTempStore();
		seedPlanStory(store);
		const { client, requests } = scriptedClient();

		const preparation = await runPlanPhases({
			store,
			client,
			storyId: "s1",
			anchorNodeId: "a1",
			playerMessage: "我看向殿门。",
			push: null,
		});

		const intentRequests = requests.filter((request) =>
			requestText(request).includes(INTENT_MARKER),
		);
		expect(intentRequests).toHaveLength(2);
		const forJia = intentRequests.find((request) =>
			requestText(request).includes("你只写「甲」"),
		);
		const forYi = intentRequests.find((request) =>
			requestText(request).includes("你只写「乙」"),
		);
		expect(forJia).toBeDefined();
		expect(forYi).toBeDefined();
		expect(requestText(forJia as LlmRequest)).toContain("甲在佛堂看见密道");
		expect(requestText(forJia as LlmRequest)).not.toContain("乙偷了钥匙");
		expect(requestText(forYi as LlmRequest)).toContain("乙偷了钥匙");
		expect(requestText(forYi as LlmRequest)).not.toContain("甲在佛堂看见密道");
		expect(requestText(forJia as LlmRequest)).toContain("殿外下着雨");
		expect(preparation.text).toContain("甲：抬头看殿门。");
		expect(preparation.text).toContain("乙：抬头看殿门。");
	});

	it("复查在生成之后单独跑，结果存成不移动 head 的兄弟版本", async () => {
		const { store } = openTempStore();
		seedPlanStory(store);
		store.setStoryValue("s1", "writingMode", "plan");
		const turn = scriptedClient();

		const result = await runChatTurn({
			store,
			client: turn.client,
			storyId: "s1",
			userText: "我看向殿门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 40_000,
			structuredOutput: "text-tags",
			model: "fake",
		});
		expect(planReviewNeedsRun(store, "s1")).toBe(true);
		// 回合内没有复查调用：正文一落定就返回给玩家。
		expect(turn.requests).toHaveLength(5);

		const review = scriptedClient(() =>
			JSON.stringify({
				issues: ["乙说出了自己不知道的密道"],
				rewrite: "山门缓缓打开。甲没有说话。",
			}),
		);
		await createPlanReviewHandler({ client: review.client })({
			store,
			client: review.client,
			job: jobFor("s1"),
		});

		const record = readPlanReview(store, "s1", result.node.id);
		expect(record?.issues).toEqual(["乙说出了自己不知道的密道"]);
		expect(record?.phase.name).toBe("复查");
		expect(record?.variantNodeId).not.toBeNull();
		const variantId = record?.variantNodeId as string;
		const variant = store.getNode(variantId);
		expect(variant?.raw).toBe("山门缓缓打开。甲没有说话。");
		expect(variant?.parentId).toBe(result.node.parentId);
		expect(variant?.role).toBe("assistant");
		// 正文仍然是玩家看到的 head；复查版本要玩家自己切过去。
		expect(store.getHead("s1")?.id).toBe(result.node.id);
		expect(planReviewNeedsRun(store, "s1")).toBe(false);

		store.setHead("s1", variantId);
		expect(store.getPathToHead("s1").at(-1)?.id).toBe(variantId);
	});

	it("没有发现问题时只记结论，不新建版本", async () => {
		const { store } = openTempStore();
		seedPlanStory(store);
		store.setStoryValue("s1", "writingMode", "plan");
		const turn = scriptedClient();
		const result = await runChatTurn({
			store,
			client: turn.client,
			storyId: "s1",
			userText: "我看向殿门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 40_000,
			structuredOutput: "text-tags",
			model: "fake",
		});

		const review = scriptedClient(() =>
			JSON.stringify({ issues: [], rewrite: "" }),
		);
		await createPlanReviewHandler()({
			store,
			client: review.client,
			job: jobFor("s1"),
		});

		const record = readPlanReview(store, "s1", result.node.id);
		expect(record?.issues).toEqual([]);
		expect(record?.variantNodeId).toBeNull();
		expect(store.listStoryNodes("s1")).toHaveLength(3);
	});

	it("关掉复查时后台任务不入队；快速写法的楼层也不复查", async () => {
		const { store } = openTempStore();
		seedPlanStory(store);
		store.setStoryValue("s1", "writingMode", "plan");
		store.updateStorySettings("s1", { featureSwitches: { review: false } });
		const turn = scriptedClient();
		const result = await runChatTurn({
			store,
			client: turn.client,
			storyId: "s1",
			userText: "我看向殿门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 40_000,
			structuredOutput: "text-tags",
			model: "fake",
		});
		expect(planReviewNeedsRun(store, "s1")).toBe(false);

		const other = openTempStore();
		seedPlanStory(other.store);
		const second = scriptedClient();
		const fast = await runChatTurn({
			store: other.store,
			client: second.client,
			storyId: "s1",
			userText: "我看向殿门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(other.store),
			budgetTokens: 40_000,
			structuredOutput: "text-tags",
			model: "fake",
		});
		expect(store.getTurnTrace(result.node.id)?.plan).toBeDefined();
		expect(other.store.getTurnTrace(fast.node.id)?.plan).toBeUndefined();
		expect(planReviewNeedsRun(other.store, "s1")).toBe(false);
	});

	it("间隙里备好推进三档与每个行动选项，命中时回合内只剩正文", async () => {
		const { store } = openTempStore();
		seedPlanStory(store);
		store.setStoryValue("s1", "writingMode", "plan");
		store.updateStorySettings("s1", { featureSwitches: { prepare: true } });
		const optionTexts = [
			"推门进去",
			"问甲密道在哪",
			"沿墙摸一圈",
			"叫乙别出声",
			"天亮时离开",
		];
		store.replaceDirectorCandidateActions({
			storyId: "s1",
			nodeId: "a1",
			actions: [
				...optionTexts
					.slice(0, 4)
					.map((text) => ({ kind: "action" as const, text })),
				{ kind: "scene_change" as const, text: optionTexts[4] as string },
			],
		});
		const prepare = scriptedClient();
		await createPlanPrepareHandler({ client: prepare.client })({
			store,
			client: prepare.client,
			job: jobFor("s1", PLAN_PREPARE_JOB_KIND),
		});

		const pushes: readonly DirectorPush[] = ["advance", "quick", "jump"];
		for (const push of pushes) {
			expect(
				readPreparedPlan(store, "s1", "a1", "(让故事自己走)", push)?.text,
			).toContain("本轮准备");
		}
		for (const text of optionTexts) {
			expect(readPreparedPlan(store, "s1", "a1", text, null)?.text).toContain(
				"本轮准备",
			);
		}
		expect(planPrepareNeedsRun(store, "s1")).toBe(false);

		const turn = scriptedClient();
		const result = await runChatTurn({
			store,
			client: turn.client,
			storyId: "s1",
			userText: optionTexts[0] as string,
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 40_000,
			structuredOutput: "text-tags",
			model: "fake",
		});

		expect(turn.requests).toHaveLength(1);
		expect(requestText(turn.requests[0] as LlmRequest)).toContain(
			"【本轮准备】",
		);
		expect(store.getTurnTrace(result.node.id)?.plan?.prepared).toBe(true);

		for (const push of pushes) {
			store.setHead("s1", "a1");
			const pushTurn = scriptedClient();
			const pushed = await runChatTurn({
				store,
				client: pushTurn.client,
				storyId: "s1",
				userText: "(让故事自己走)",
				directorPush: push,
				template: createDefaultContextTemplate({
					structuredOutput: "text-tags",
				}),
				providers: {
					...providers(store),
					director: createDirectorSlotProvider(store),
				},
				budgetTokens: 40_000,
				structuredOutput: "text-tags",
				model: "fake",
			});
			expect(pushTurn.requests).toHaveLength(1);
			expect(store.getTurnTrace(pushed.node.id)?.plan?.prepared).toBe(true);
		}
	});

	it("自由输入时在回合内准备，阶段进度推给界面", async () => {
		const { store } = openTempStore();
		seedPlanStory(store);
		store.setStoryValue("s1", "writingMode", "plan");
		store.updateStorySettings("s1", { featureSwitches: { prepare: true } });
		const turn = scriptedClient();
		const progress: { phase: string; detail: string }[] = [];
		const result = await runChatTurn({
			store,
			client: turn.client,
			storyId: "s1",
			userText: "我看向殿门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 40_000,
			structuredOutput: "text-tags",
			model: "fake",
			onToolProgress: (event) => {
				progress.push({ phase: event.phase, detail: event.detail });
			},
		});

		expect(progress.map((item) => item.phase)).toEqual(
			expect.arrayContaining([...PLAN_PREP_PHASES]),
		);
		expect(progress.every((item) => item.detail.length > 0)).toBe(true);
		expect(turn.requests).toHaveLength(5);
		expect(store.getTurnTrace(result.node.id)?.plan?.prepared).toBe(false);
	});

	it("提前备好默认只在全开档开启，关掉后不再吃旧结果", async () => {
		const { store } = openTempStore();
		seedPlanStory(store);
		store.setStoryValue("s1", "writingMode", "plan");
		expect(planPrepareNeedsRun(store, "s1")).toBe(false);

		store.updateStorySettings("s1", { featureTier: "immersive" });
		expect(planPrepareNeedsRun(store, "s1")).toBe(true);
		const prepare = scriptedClient();
		await createPlanPrepareHandler({ client: prepare.client })({
			store,
			client: prepare.client,
			job: jobFor("s1", PLAN_PREPARE_JOB_KIND),
		});
		expect(
			readPreparedPlan(store, "s1", "a1", "(让故事自己走)", "advance"),
		).not.toBeNull();

		store.updateStorySettings("s1", { featureSwitches: { prepare: false } });
		expect(planPrepareNeedsRun(store, "s1")).toBe(false);

		const turn = scriptedClient();
		const progress: string[] = [];
		const result = await runChatTurn({
			store,
			client: turn.client,
			storyId: "s1",
			userText: "我看向殿门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 40_000,
			structuredOutput: "text-tags",
			model: "fake",
			onToolProgress: (event) => {
				progress.push(event.phase);
			},
		});
		expect(turn.requests).toHaveLength(5);
		expect(progress).toEqual(expect.arrayContaining([...PLAN_PREP_PHASES]));
		expect(store.getTurnTrace(result.node.id)?.plan?.prepared).toBe(false);
	});
});
