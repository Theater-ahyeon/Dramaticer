import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	BackgroundJobDeferredError,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	createGapPassHandler,
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

/** 开场助手楼、一条玩家消息与一楼回复；head 停在 a2。 */
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
		raw: "凛笑了一下，把书合上。",
	});
}

function jobFor(nodeId: string): BackgroundJob {
	return {
		id: 1,
		storyId: "s1",
		nodeId,
		kind: "gap_pass",
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: new Date(FIXED_NOW).toISOString(),
		startedAt: new Date(FIXED_NOW).toISOString(),
		finishedAt: null,
	};
}

const FULL_RESPONSE = JSON.stringify({
	settlement: [
		{
			nodeId: "a2",
			diffs: [
				{
					path: ["scene", "current", "place"],
					op: "set",
					value: "教室",
					confidence: 0.9,
				},
			],
			conflicts: [],
		},
	],
	scene: "凛想留住你，又怕自己先开口。",
	userWill: [
		{
			kind: "preference",
			text: "剧情保持轻松",
			sourceQuote: "我想看轻松一点的剧情",
		},
	],
	revision: [
		{
			text: "把所在地改成屋顶",
			sourceQuote: "我想看轻松一点的剧情",
			diffs: [
				{ path: ["character", "凛", "location"], op: "set", value: "屋顶" },
			],
		},
	],
	events: [
		{
			nodeId: "a1",
			events: [
				{
					text: "凛站在教室门口",
					participants: ["凛"],
					knowers: ["凛"],
					importance: 0.5,
				},
			],
		},
	],
});

describe("间隙合并调用任务", () => {
	it("一次调用产出四段：结算、现场分析、用户意志与修订草案各自入库", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([FULL_RESPONSE]);
		const handler = createGapPassHandler();
		await handler({ store, client, job: jobFor("a2") });

		expect(requests).toHaveLength(1);
		const request = requests[0];
		expect(request?.temperature).toBe(0);
		expect(request?.messages[0]?.content).toContain("settlement");
		expect(request?.messages[1]?.content).toContain("最近的玩家消息");

		expect(store.getLedgerSettlement("a2")).not.toBeNull();
		expect(readLedger(store, "a2", ["scene", "current"])).toEqual({
			place: "教室",
		});
		expect(store.getSceneAnalysis("a2")?.text).toBe(
			"凛想留住你，又怕自己先开口。",
		);
		expect(readLedger(store, "a2", ["userWill"])).toEqual({
			[userWillStableId("剧情保持轻松")]: {
				kind: "preference",
				text: "剧情保持轻松",
				sourceNodeId: "u1",
				createdAt: expect.any(String),
			},
		});
		const cards = store.listLedgerChangeCards("s1");
		expect(cards).toHaveLength(1);
		expect(cards[0]?.status).toBe("pending");
		expect(cards[0]?.source).toBe("player");
		expect(store.listExtractedEventNodeIds("s1")).toContain("a1");
		expect(store.getEventsForPath("a2").map((event) => event.text)).toContain(
			"凛站在教室门口",
		);
		expect(store.getGapPassRun("a2")).toMatchObject({
			nodeId: "a2",
			storyId: "s1",
			rejectedSegments: [],
		});
	});

	it("单段非法只拒绝该段，其余段落照常入库并记录原因", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const response = JSON.stringify({
			settlement: [
				{
					nodeId: "a2",
					diffs: [
						{
							path: ["time", "current"],
							op: "set",
							value: "傍晚",
							confidence: 1,
						},
					],
					conflicts: [],
				},
			],
			scene: "凛合上书，等你开口。",
			userWill: [
				{
					kind: "request",
					text: "不要死人",
					sourceQuote: "别动不动就让角色死掉",
				},
			],
			revision: [
				{
					text: "把所在地改成屋顶",
					sourceQuote: "我想看轻松一点的剧情",
					diffs: [],
				},
			],
		});
		const { client, requests } = createFakeClient([response]);
		await createGapPassHandler()({ store, client, job: jobFor("a2") });

		expect(requests).toHaveLength(1);
		expect(readLedger(store, "a2", ["time", "current"])).toBe("傍晚");
		expect(store.getSceneAnalysis("a2")?.text).toBe("凛合上书，等你开口。");
		expect(readLedger(store, "a2", ["userWill"])).toBeUndefined();
		expect(store.listLedgerChangeCards("s1")).toHaveLength(0);
		const run = store.getGapPassRun("a2");
		expect(run?.rejectedSegments.map((entry) => entry.segment)).toEqual([
			"userWill",
			"revision",
		]);
		expect(run?.rejectedSegments[0]?.reason).toContain("kind");
		expect(run?.rejectedSegments[1]?.reason).toContain("diffs");
	});

	it("任务楼层的结算既没有记录也不在本次窗口时退回 pending，不调用模型", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([FULL_RESPONSE]);
		await expect(
			createGapPassHandler({ windowSize: 1 })({
				store,
				client,
				job: jobFor("a2"),
			}),
		).rejects.toBeInstanceOf(BackgroundJobDeferredError);
		expect(requests).toHaveLength(0);
	});

	it("任务楼层已经有结算记录时直接执行，没有待结算窗口也不退回", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.recordLedgerSettlement({
			nodeId: "a2",
			storyId: "s1",
			source: "settler",
			addedCount: 0,
			repairs: [],
		});
		const { client, requests } = createFakeClient([
			JSON.stringify({ scene: "凛在等你回答。" }),
		]);
		await createGapPassHandler()({ store, client, job: jobFor("a2") });
		expect(requests).toHaveLength(1);
		expect(store.getSceneAnalysis("a2")?.text).toBe("凛在等你回答。");
		expect(store.getGapPassRun("a2")?.rejectedSegments).toEqual([]);
	});

	it("执行记录按楼层覆盖，故事不一致时拒绝", () => {
		const { store } = openTempStore();
		seedStory(store);
		store.createStory({ id: "s2", title: "第二个" });
		store.appendNode({
			id: "b1",
			storyId: "s2",
			parentId: null,
			role: "assistant",
			raw: "另一段开场。",
		});
		const first = store.saveGapPassRun({
			nodeId: "a2",
			storyId: "s1",
			rejectedSegments: [{ segment: "scene", reason: "楼层还没有结算记录" }],
			createdAt: new Date(FIXED_NOW).toISOString(),
		});
		expect(first.rejectedSegments).toHaveLength(1);
		const second = store.saveGapPassRun({
			nodeId: "a2",
			storyId: "s1",
			rejectedSegments: [],
			createdAt: new Date(FIXED_NOW + 1_000).toISOString(),
		});
		expect(second.rejectedSegments).toEqual([]);
		expect(store.getGapPassRun("a2")?.createdAt).toBe(second.createdAt);
		expect(() =>
			store.saveGapPassRun({
				nodeId: "a2",
				storyId: "s2",
				rejectedSegments: [],
			}),
		).toThrow("与楼层所属故事不一致");
		expect(store.getGapPassRun("b1")).toBeNull();
		expect(() =>
			store.saveGapPassRun({
				nodeId: "a2",
				storyId: "s1",
				rejectedSegments: [{ segment: "unknown" as never, reason: "x" }],
			}),
		).toThrow("segment");
	});
});
