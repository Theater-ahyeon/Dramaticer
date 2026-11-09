import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	BackgroundJobDeferredError,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	SCENE_JOB_KIND,
	type StoryStore,
	createBackgroundJobRegistry,
	createSceneHandler,
	createSceneSlotProvider,
	drainBackgroundJobs,
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

/** 开场助手楼、玩家楼、助手楼；head 停在 a2。 */
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
		raw: "我走进教室。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "凛看了你一眼，把书合上。",
	});
}

function settle(store: StoryStore, nodeId: string): void {
	store.recordLedgerSettlement({
		nodeId,
		storyId: "s1",
		source: "settler",
		addedCount: 0,
		repairs: [],
	});
}

function jobFor(nodeId: string): BackgroundJob {
	return {
		id: 1,
		storyId: "s1",
		nodeId,
		kind: SCENE_JOB_KIND,
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: new Date(FIXED_NOW).toISOString(),
		startedAt: new Date(FIXED_NOW).toISOString(),
		finishedAt: null,
	};
}

describe("现场分析任务", () => {
	it("结算完成后写入分析，未结算的楼层退回 pending 且不消耗执行次数", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "a2",
			path: ["character", "凛", "location"],
			op: "set",
			value: "教室",
			source: "model",
		});
		settle(store, "a2");
		const { client, requests } = createFakeClient([
			"凛想把话说完，你还没开口，教室里的空气绷得很紧。",
		]);
		const result = await drainBackgroundJobs({
			store,
			registry: createBackgroundJobRegistry({
				[SCENE_JOB_KIND]: {
					handler: createSceneHandler(),
					enqueue: "settled",
				},
			}),
			client,
			storyId: "s1",
			kinds: [SCENE_JOB_KIND],
			now: () => FIXED_NOW,
		});

		const analysis = store.getSceneAnalysis("a2");
		expect(analysis?.text).toBe(
			"凛想把话说完，你还没开口，教室里的空气绷得很紧。",
		);
		expect(analysis?.storyId).toBe("s1");
		expect(analysis?.tokenCount).toBeGreaterThan(0);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.maxTokens).toBeUndefined();
		expect(requests[0]?.temperature).toBe(0);
		const content = requests[0]?.messages[1]?.content;
		expect(content).toContain('<楼层 id="a2"');
		expect(content).toContain("凛看了你一眼，把书合上。");
		expect(content).toContain("教室");

		const pending = store.listBackgroundJobs({
			storyId: "s1",
			status: "pending",
			kinds: [SCENE_JOB_KIND],
		});
		expect(pending.map((job) => job.nodeId)).toEqual(["a1"]);
		expect(pending[0]?.attempts).toBe(0);
		expect(result.runs.map((run) => run.status)).toEqual(["pending", "done"]);
	});

	it("空正文按任务重试，三次后 failed 并保留原因", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场。凛站在教室门口。",
		});
		settle(store, "a1");
		const { client, requests } = createFakeClient(["", "", ""]);
		const registry = createBackgroundJobRegistry({
			[SCENE_JOB_KIND]: {
				handler: createSceneHandler(),
				enqueue: "settled",
			},
		});
		const runOnce = () =>
			drainBackgroundJobs({
				store,
				registry,
				client,
				storyId: "s1",
				kinds: [SCENE_JOB_KIND],
				limit: 1,
				now: () => FIXED_NOW,
			});

		const first = await runOnce();
		expect(first.runs[0]).toMatchObject({
			status: "pending",
			attempts: 1,
			error: "现场分析返回了空内容",
		});
		await runOnce();
		const third = await runOnce();
		expect(third.runs[0]).toMatchObject({
			status: "failed",
			attempts: 3,
			error: "现场分析返回了空内容",
		});
		expect(requests).toHaveLength(3);
		for (const request of requests) {
			expect(request.maxTokens).toBeUndefined();
		}
		expect(store.getSceneAnalysis("a1")).toBeNull();
	});

	it("同一楼层重跑覆盖同一行", async () => {
		const { store, path } = openTempStore();
		seedStory(store);
		settle(store, "a2");
		const { client } = createFakeClient(["第一次分析。", "第二次分析。"]);
		const handler = createSceneHandler();
		await handler({ store, client, job: jobFor("a2") });
		await handler({ store, client, job: jobFor("a2") });

		expect(store.getSceneAnalysis("a2")?.text).toBe("第二次分析。");
		const raw = new Database(path, { readonly: true });
		try {
			const row = raw
				.prepare("SELECT COUNT(*) AS count FROM scene_analyses")
				.get() as { readonly count: number };
			expect(row.count).toBe(1);
		} finally {
			raw.close();
		}
	});

	it("结算未完成时处理器抛出等待标志且不调用模型", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([]);
		await expect(
			createSceneHandler()({ store, client, job: jobFor("a2") }),
		).rejects.toBeInstanceOf(BackgroundJobDeferredError);
		expect(requests).toHaveLength(0);
		expect(store.getSceneAnalysis("a2")).toBeNull();
	});

	it("空窗口不调用模型", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "blank",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "   ",
		});
		settle(store, "blank");
		const { client, requests } = createFakeClient([]);
		const outcome = await createSceneHandler()({
			store,
			client,
			job: jobFor("blank"),
		});
		expect(outcome).toBeUndefined();
		expect(requests).toHaveLength(0);
		expect(store.getSceneAnalysis("blank")).toBeNull();
	});

	it("槽位取当前路径上最近一条分析，分支切换后不跨分支", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendNode({
			id: "u2",
			storyId: "s1",
			parentId: "a2",
			role: "user",
			raw: "我把书推回去。",
		});
		store.appendNode({
			id: "a3",
			storyId: "s1",
			parentId: "u2",
			role: "assistant",
			raw: "凛越过桌面看着你。",
		});
		store.appendNode({
			id: "b2",
			storyId: "s1",
			parentId: "a1",
			role: "assistant",
			raw: "另一个分支的回复。",
		});
		store.saveSceneAnalysis({
			nodeId: "a2",
			storyId: "s1",
			text: "主分支分析。",
			tokenCount: 6,
		});
		store.saveSceneAnalysis({
			nodeId: "b2",
			storyId: "s1",
			text: "分支分析。",
			tokenCount: 5,
		});

		expect(store.getLatestSceneAnalysisOnPath("a3")?.nodeId).toBe("a2");
		expect(store.getLatestSceneAnalysisOnPath("b2")?.text).toBe("分支分析。");
		const provider = createSceneSlotProvider(store);
		const content = await provider.provide({
			slot: "scene",
			storyId: "s1",
			nodeId: "u2",
			switches: {},
			state: null,
		});
		expect(content?.messages).toEqual([
			{ role: "system", content: "现场分析：\n主分支分析。" },
		]);
		expect(content?.source).toContain("a2");

		expect(
			await provider.provide({
				slot: "scene",
				storyId: "s1",
				nodeId: "a1",
				switches: {},
				state: null,
			}),
		).toBeNull();
		expect(
			await provider.provide({
				slot: "scene",
				storyId: "s1",
				nodeId: null,
				switches: {},
				state: null,
			}),
		).toBeNull();
	});
});
