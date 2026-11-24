import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	USER_WILL_JOB_KIND,
	assembleContext,
	assertPlainObject,
	createBackgroundJobRegistry,
	createDefaultContextTemplate,
	createHistorySlotProvider,
	createSituationSlotProvider,
	createStateSlotProvider,
	createTokenEstimator,
	createUserWillHandler,
	createUserWillSlotProvider,
	drainBackgroundJobs,
	normalizeUserWillText,
	parseUserWillResponse,
	readLedger,
	userWillStableId,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

function llmResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: {
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cachedTokens: null,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

/** 假客户端：记录请求，按脚本返回文本；脚本用完后再调用直接失败。 */
function createFakeClient(replies: readonly string[]): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const client: LlmClient = {
		async complete(request) {
			requests.push(request);
			const reply = replies[requests.length - 1];
			if (reply === undefined) {
				throw new Error("假客户端没有更多回复");
			}
			return llmResult(reply);
		},
	};
	return { client, requests };
}

/** 开场助手楼、两条玩家消息与两楼回复；head 停在 a3。 */
function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。凛站在教室门口。",
	});
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "a1",
		role: "user",
		raw: "别动不动就让角色死掉，我想看轻松一点的剧情。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "凛笑了一下：「死人是不会的。」",
	});
	store.appendNode({
		id: "u2",
		storyId: "s1",
		parentId: "a2",
		role: "user",
		raw: "以后天气别老是下雨。",
	});
	store.appendNode({
		id: "a3",
		storyId: "s1",
		parentId: "u2",
		role: "assistant",
		raw: "窗外放晴了。",
	});
}

function jobFor(nodeId: string): BackgroundJob {
	return {
		id: 1,
		storyId: "s1",
		nodeId,
		kind: USER_WILL_JOB_KIND,
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: new Date(FIXED_NOW).toISOString(),
		startedAt: new Date(FIXED_NOW).toISOString(),
		finishedAt: null,
	};
}

const U1_KINDS = JSON.stringify([
	{
		kind: "boundary",
		text: "不要让角色突然死亡",
		sourceQuote: "别动不动就让角色死掉",
	},
	{
		kind: "preference",
		text: "剧情保持轻松",
		sourceQuote: "我想看轻松一点的剧情",
	},
]);

const THREE_KINDS = JSON.stringify([
	{
		kind: "boundary",
		text: "不要让角色突然死亡",
		sourceQuote: "别动不动就让角色死掉",
	},
	{
		kind: "preference",
		text: "剧情保持轻松",
		sourceQuote: "我想看轻松一点的剧情",
	},
	{
		kind: "correction",
		text: "天气不要老是下雨",
		sourceQuote: "以后天气别老是下雨",
	},
]);

describe("用户意志解析", () => {
	it("偏好、底线与纠正各解析出对应的来源楼层", () => {
		const { store } = openTempStore();
		seedStory(store);
		const parsed = parseUserWillResponse(
			THREE_KINDS,
			store.getPathToNode("a3").filter((node) => node.role === "user"),
		);
		expect(parsed).toEqual([
			{
				kind: "boundary",
				text: "不要让角色突然死亡",
				sourceQuote: "别动不动就让角色死掉",
				sourceNodeId: "u1",
			},
			{
				kind: "preference",
				text: "剧情保持轻松",
				sourceQuote: "我想看轻松一点的剧情",
				sourceNodeId: "u1",
			},
			{
				kind: "correction",
				text: "天气不要老是下雨",
				sourceQuote: "以后天气别老是下雨",
				sourceNodeId: "u2",
			},
		]);
	});

	it("角色台词与窗口外的引文整条拒绝并指出位置", () => {
		const { store } = openTempStore();
		seedStory(store);
		expect(() =>
			parseUserWillResponse(
				JSON.stringify([
					{ kind: "preference", text: "不要死人", sourceQuote: "死人是不会的" },
				]),
				store.getPathToNode("a3").filter((node) => node.role === "user"),
			),
		).toThrow(/用户意志\[0\]\.sourceQuote 不在本次窗口的玩家消息里/);
		expect(() =>
			parseUserWillResponse(THREE_KINDS, store.getPathToNode("u2").slice(-1)),
		).toThrow(/用户意志\[0\]\.sourceQuote 不在本次窗口的玩家消息里/);
	});

	it("未知类别、空正文与未知字段整条拒绝", () => {
		const { store } = openTempStore();
		seedStory(store);
		const players = store
			.getPathToNode("a3")
			.filter((node) => node.role === "user");
		expect(() =>
			parseUserWillResponse(
				JSON.stringify([
					{
						kind: "request",
						text: "不要死人",
						sourceQuote: "别动不动就让角色死掉",
					},
				]),
				players,
			),
		).toThrow(/用户意志\[0\]\.kind 只能是 preference、boundary、correction/);
		expect(() =>
			parseUserWillResponse(
				JSON.stringify([
					{
						kind: "preference",
						text: "  ",
						sourceQuote: "别动不动就让角色死掉",
					},
				]),
				players,
			),
		).toThrow(/用户意志\[0\]\.text 必须是非空字符串/);
		expect(() =>
			parseUserWillResponse(
				JSON.stringify([
					{
						kind: "preference",
						text: "不要死人",
						sourceQuote: "别动不动就让角色死掉",
						extra: true,
					},
				]),
				players,
			),
		).toThrow(/用户意志\[0\]\.extra 是未知字段/);
	});
});

describe("用户意志任务", () => {
	it("三类意志各写一条台账事实，来源指向引文所在的玩家楼层", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([THREE_KINDS]);
		await createUserWillHandler()({ store, client, job: jobFor("a3") });

		expect(requests).toHaveLength(1);
		expect(requests[0]?.temperature).toBe(0);
		const content = requests[0]?.messages[1]?.content ?? "";
		expect(content).toContain('<玩家消息 id="u1">');
		expect(content).toContain('<玩家消息 id="u2">');
		expect(content).toContain("别动不动就让角色死掉");

		const facts = store
			.getStateDiffs("a3")
			.filter((diff) => diff.path[0] === "userWill");
		expect(facts).toHaveLength(3);
		const values = facts.map((diff) =>
			assertPlainObject(diff.value, "用户意志的值"),
		);
		expect(values.map((value) => value.kind)).toEqual([
			"boundary",
			"preference",
			"correction",
		]);
		expect(values[0]).toMatchObject({
			text: "不要让角色突然死亡",
			sourceNodeId: "u1",
		});
		expect(values[1]).toMatchObject({
			text: "剧情保持轻松",
			sourceNodeId: "u1",
		});
		expect(values[2]).toMatchObject({
			text: "天气不要老是下雨",
			sourceNodeId: "u2",
		});
		expect(facts.map((diff) => diff.path[1])).toEqual(
			["不要让角色突然死亡", "剧情保持轻松", "天气不要老是下雨"].map(
				userWillStableId,
			),
		);
		expect(values.map((value) => typeof value.createdAt)).toEqual([
			"string",
			"string",
			"string",
		]);
		for (const diff of facts) expect(diff.source).toBe("settler");
	});

	it("同一正文在一条回复里重复出现、或重复执行时都只保留一条", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const repeated = JSON.stringify([
			{
				kind: "boundary",
				text: "不要让角色突然死亡",
				sourceQuote: "别动不动就让角色死掉",
			},
			{
				kind: "boundary",
				text: "不要让角色突然死亡。",
				sourceQuote: "别动不动就让角色死掉",
			},
		]);
		const { client, requests } = createFakeClient([repeated, THREE_KINDS]);
		const handler = createUserWillHandler();
		await handler({ store, client, job: jobFor("a3") });

		expect(
			store.getStateDiffs("a3").filter((diff) => diff.path[0] === "userWill"),
		).toHaveLength(1);

		await handler({ store, client, job: jobFor("a3") });
		expect(requests).toHaveLength(2);
		const content = requests[1]?.messages[1]?.content ?? "";
		expect(content).toContain("已有的用户意志（不要重复记录）：");
		expect(content).toContain("- 不要让角色突然死亡");
		expect(
			store.getStateDiffs("a3").filter((diff) => diff.path[0] === "userWill"),
		).toHaveLength(3);
	});

	it("模型没有识别出条目、或窗口里没有玩家消息时不写台账", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient(["[]"]);
		await createUserWillHandler()({ store, client, job: jobFor("a3") });
		expect(requests).toHaveLength(1);
		expect(
			store.getStateDiffs("a3").filter((diff) => diff.path[0] === "userWill"),
		).toHaveLength(0);

		await createUserWillHandler()({
			store,
			client: { complete: async () => llmResult("[]") },
			job: jobFor("a1"),
		});
		expect(
			store.getStateDiffs("a1").filter((diff) => diff.path[0] === "userWill"),
		).toHaveLength(0);
	});

	it("非法输出整条拒绝且不写台账", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([
			JSON.stringify([
				{
					kind: "preference",
					text: "不要死人",
					sourceQuote: "别动不动就让角色死掉",
				},
				{ kind: "preference", text: "不要死人", sourceQuote: "凛笑了一下" },
			]),
		]);
		await expect(
			createUserWillHandler()({ store, client, job: jobFor("a3") }),
		).rejects.toThrow(/用户意志\[1\]\.sourceQuote 不在本次窗口的玩家消息里/);
		expect(
			store.getStateDiffs("a3").filter((diff) => diff.path[0] === "userWill"),
		).toHaveLength(0);
	});

	it("分支切换后只看到当前分支写入的条目", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendNode({
			id: "b2",
			storyId: "s1",
			parentId: "u1",
			role: "assistant",
			raw: "另一条分支的回复。",
		});
		const { client } = createFakeClient([U1_KINDS]);
		await createUserWillHandler()({ store, client, job: jobFor("b2") });
		expect(
			store.getStateDiffs("b2").filter((diff) => diff.path[0] === "userWill"),
		).toHaveLength(2);
		expect(readLedger(store, "a3", ["userWill"])).toBeUndefined();

		const provider = createUserWillSlotProvider(store);
		expect(
			await provider.provide({
				slot: "user_will",
				storyId: "s1",
				nodeId: "a3",
				switches: {},
				state: undefined,
			}),
		).toBeNull();
		const onBranch = await provider.provide({
			slot: "user_will",
			storyId: "s1",
			nodeId: "b2",
			switches: {},
			state: undefined,
		});
		expect(onBranch?.source).toBe("userWill:2 条");
	});

	it("settled 入队条件给每个助手楼层建任务，空窗口不调用模型", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([U1_KINDS, "[]"]);
		const result = await drainBackgroundJobs({
			store,
			registry: createBackgroundJobRegistry({
				[USER_WILL_JOB_KIND]: {
					handler: createUserWillHandler(),
					enqueue: "settled",
				},
			}),
			client,
			storyId: "s1",
			kinds: [USER_WILL_JOB_KIND],
			now: () => FIXED_NOW,
		});
		expect(result.enqueued).toBe(3);
		expect(result.runs.map((run) => [run.nodeId, run.status])).toEqual([
			["a1", "done"],
			["a2", "done"],
			["a3", "done"],
		]);
		expect(requests).toHaveLength(2);
		expect(readLedger(store, "a3", ["userWill"])).toMatchObject({
			[userWillStableId("不要让角色突然死亡")]: {
				kind: "boundary",
				sourceNodeId: "u1",
			},
			[userWillStableId("剧情保持轻松")]: {
				kind: "preference",
				sourceNodeId: "u1",
			},
		});
	});
});

describe("用户意志槽位", () => {
	it("渲染成带类别标签的系统消息，没有条目或没有楼层时为 null", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const provider = createUserWillSlotProvider(store);
		const empty = await provider.provide({
			slot: "user_will",
			storyId: "s1",
			nodeId: "a3",
			switches: {},
			state: undefined,
		});
		expect(empty).toBeNull();

		store.appendStateDiff({
			storyId: "s1",
			nodeId: "a2",
			path: ["userWill", "will-a"],
			op: "set",
			value: {
				kind: "preference",
				text: "剧情保持轻松",
				sourceNodeId: "u1",
				createdAt: "2026-11-07T00:00:00.000Z",
			},
			source: "settler",
		});
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "a3",
			path: ["userWill", "will-b"],
			op: "set",
			value: {
				kind: "boundary",
				text: "不要让角色突然死亡",
				sourceNodeId: "u1",
				createdAt: "2026-11-07T00:00:01.000Z",
			},
			source: "settler",
		});
		const content = await provider.provide({
			slot: "user_will",
			storyId: "s1",
			nodeId: "a3",
			switches: {},
			state: undefined,
		});
		expect(content?.messages).toEqual([
			{
				role: "system",
				content:
					"用户意志：\n- 【偏好】剧情保持轻松\n- 【底线】不要让角色突然死亡",
			},
		]);
		expect(content?.source).toBe("userWill:2 条");

		expect(
			await provider.provide({
				slot: "user_will",
				storyId: "s1",
				nodeId: null,
				switches: {},
				state: undefined,
			}),
		).toBeNull();
	});

	it("默认模板给用户意志最高的预算优先级，预算不足时它先保留", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendNode({
			id: "a4",
			storyId: "s1",
			parentId: "a3",
			role: "assistant",
			raw: "凛把窗户推开，阳光落进来。".repeat(20),
		});
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "a4",
			path: ["userWill", "will-a"],
			op: "set",
			value: {
				kind: "preference",
				text: "剧情保持轻松",
				sourceNodeId: "u1",
				createdAt: "2026-11-07T00:00:00.000Z",
			},
			source: "settler",
		});
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "a4",
			path: ["character", "凛", "location"],
			op: "set",
			value: "教室",
			source: "model",
		});
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		});
		const priorities = template.segments.map((segment) => [
			segment.id,
			segment.priority ?? 0,
		]);
		const userWillPriority = priorities.find(([id]) => id === "user_will")?.[1];
		for (const [id, priority] of priorities) {
			if (id === "user_will") continue;
			expect(userWillPriority).toBeGreaterThan(priority as number);
		}

		const providers = {
			user_will: createUserWillSlotProvider(store),
			situation: createSituationSlotProvider(store),
			history: createHistorySlotProvider(store),
		};
		const estimator = createTokenEstimator();
		const userWillTokens = estimator("用户意志：\n- 【偏好】剧情保持轻松");
		const context = await assembleContext({
			template,
			budgetTokens: userWillTokens,
			storyId: "s1",
			nodeId: "a4",
			providers,
			tokenEstimator: estimator,
		});
		const status = new Map(
			context.trace.entries.map((entry) => [entry.segmentId, entry.status]),
		);
		expect(status.get("user_will")).toBe("included");
		expect(status.get("situation")).toBe("budget-dropped");
		expect(status.get("history")).toBe("budget-dropped");
	});
});

describe("用户意志正文规范化", () => {
	it("全角、空白与两端标点不同但正文相同的文本得到同一个稳定 id", () => {
		expect(normalizeUserWillText("  剧情保持轻松！ ")).toBe("剧情保持轻松");
		expect(normalizeUserWillText("剧情保持轻松。")).toBe(
			normalizeUserWillText("剧情保持轻松"),
		);
		expect(userWillStableId("剧情保持轻松。")).toBe(
			userWillStableId("剧情保持轻松"),
		);
		expect(userWillStableId("剧情保持轻松")).not.toBe(
			userWillStableId("剧情不要太轻松"),
		);
		expect(userWillStableId("剧情保持轻松")).toMatch(/^will-[0-9a-f]{16}$/);
		expect(() => userWillStableId("  。 ")).toThrow(
			"用户意志正文在规范化后为空",
		);
	});
});
