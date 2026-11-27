import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	createSceneLogHandler,
	readLedger,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_NOW = Date.UTC(2026, 10, 14, 12, 0, 0);

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
		kind: "scene_log",
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: new Date(FIXED_NOW).toISOString(),
		startedAt: new Date(FIXED_NOW).toISOString(),
		finishedAt: null,
	};
}

const FOUR_FIELDS = JSON.stringify({
	beat: "试探",
	states: [
		{
			path: ["scene", "current", "place"],
			op: "set",
			value: "教室",
			confidence: 0.9,
			sourceQuote: "把书合上",
		},
	],
	present: ["凛"],
	sceneEnds: false,
});

describe("场记任务", () => {
	it("一次调用产出节拍、硬状态、在场者与场次边界，状态走结算器写入", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([FOUR_FIELDS]);

		await createSceneLogHandler()({ store, client, job: jobFor("a2") });

		expect(requests).toHaveLength(1);
		expect(requests[0]?.temperature).toBe(0);
		expect(requests[0]?.messages[0]?.content).toContain("beat");
		expect(requests[0]?.messages[1]?.content).toContain("最近楼层的原文");
		expect(readLedger(store, "a2", ["scene", "current"])).toEqual({
			place: "教室",
		});
		expect(store.getLedgerSettlement("a2")).not.toBeNull();
		const log = store.getSceneLog("a2");
		expect(log).toMatchObject({
			nodeId: "a2",
			storyId: "s1",
			beat: "试探",
			present: ["凛"],
			sceneEnds: false,
			bits: [],
			conditions: [],
			quotes: { submitted: 1, verified: 1 },
			repairs: [],
		});
		expect(log?.states).toHaveLength(1);
		expect(log?.states[0]?.sourceQuote).toBe("把书合上");
	});

	it("引文对不上照样按楼层锚点写入；没有得知经过的知情写入作为泄密拒收", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const response = JSON.stringify({
			beat: "冲突升级",
			states: [
				{
					path: ["scene", "current", "place"],
					op: "set",
					value: "教室",
					confidence: 0.9,
					sourceQuote: "把书合上",
				},
				{
					path: ["item", "旧信", "holder"],
					op: "set",
					value: "凛",
					confidence: 0.7,
					sourceQuote: "她走进雨里",
				},
				{
					path: ["character", "凛", "status"],
					op: "set",
					value: "平静",
					confidence: 0.5,
				},
				{
					path: ["knowledge", "老师", "信的内容"],
					op: "set",
					value: { factId: "旧信", text: "信里写着凛的秘密" },
					confidence: 0.6,
					sourceQuote: "老师读完了信",
				},
			],
			present: ["凛"],
			sceneEnds: true,
		});
		const { client } = createFakeClient([response]);

		await createSceneLogHandler()({ store, client, job: jobFor("a2") });

		expect(readLedger(store, "a2", ["scene", "current"])).toEqual({
			place: "教室",
		});
		expect(readLedger(store, "a2", ["item", "旧信"])).toEqual({ holder: "凛" });
		expect(readLedger(store, "a2", ["character", "凛"])).toBeUndefined();
		expect(readLedger(store, "a2", ["knowledge", "老师"])).toBeUndefined();
		const log = store.getSceneLog("a2");
		expect(log?.sceneEnds).toBe(true);
		expect(log?.quotes).toEqual({ submitted: 4, verified: 1 });
		expect(log?.states).toHaveLength(2);
		expect(log?.repairs.map((repair) => repair.reason)).toEqual([
			expect.stringContaining("sourceQuote"),
			expect.stringContaining("让未知情者知道了秘密"),
		]);
		const rejections = store.listMemoryRejections("s1");
		expect(rejections.map((item) => item.reason)).toContain(
			"让未知情者知道了秘密，原文里没有得知的经过",
		);
		// 拒收理由里不再有「引文不逐字」。
		for (const item of rejections) expect(item.reason).not.toContain("原话");
	});

	it("空输出整次失败，不写入任何记录", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([""]);

		await expect(
			createSceneLogHandler()({ store, client, job: jobFor("a2") }),
		).rejects.toThrow();
		expect(store.getSceneLog("a2")).toBeNull();
		expect(store.getLedgerSettlement("a2")).toBeNull();
		expect(readLedger(store, "a2", ["scene", "current"])).toBeUndefined();
	});

	it("有剧情小品时顺带给出适用小品与文本条件判断", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.replaceDirectorBits({
			storyId: "s1",
			bits: [
				{
					id: "b1",
					condition: { kind: "text", text: "凛对玩家露出笑容" },
					instruction: "让凛笑一下，缓和气氛",
					priority: 1,
					cooldown: 0,
					after: null,
					repeatable: true,
					fallback: false,
				},
			],
		});
		const response = JSON.stringify({
			...JSON.parse(FOUR_FIELDS),
			bits: ["b1", "b9"],
			conditions: [{ id: "b1", matched: true, reason: "凛笑了" }],
		});
		const { client, requests } = createFakeClient([response]);

		await createSceneLogHandler()({ store, client, job: jobFor("a2") });

		expect(requests[0]?.messages[1]?.content).toContain("b1");
		const log = store.getSceneLog("a2");
		expect(log?.bits).toEqual(["b1"]);
		expect(log?.conditions).toEqual([
			{ id: "b1", matched: true, reason: "凛笑了" },
		]);
		expect(log?.repairs.map((repair) => repair.reason)).toEqual([
			expect.stringContaining("b9"),
		]);
		const judgments = store.findDirectorBitJudgments("a2");
		expect(judgments?.judgments).toEqual(log?.conditions);
	});

	it("同一楼层重复执行覆盖同一行，不新增记录", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([FOUR_FIELDS, FOUR_FIELDS]);

		await createSceneLogHandler()({ store, client, job: jobFor("a2") });
		await createSceneLogHandler()({ store, client, job: jobFor("a2") });

		expect(store.getSceneLog("a2")?.states).toHaveLength(1);
		expect(store.getStateDiffs("a2")).toHaveLength(1);
	});

	it("读取最近一层的场记记录时不跨分支", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([FOUR_FIELDS]);
		await createSceneLogHandler()({ store, client, job: jobFor("a2") });
		store.appendNode({
			id: "a3",
			storyId: "s1",
			parentId: "u1",
			role: "assistant",
			raw: "凛把书放进抽屉。",
		});

		expect(store.getLatestSceneLogOnPath("a2")?.nodeId).toBe("a2");
		expect(store.getLatestSceneLogOnPath("a3")).toBeNull();
	});
});
