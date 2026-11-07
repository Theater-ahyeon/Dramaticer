import { describe, expect, it } from "vitest";
import {
	type BackgroundDrainResult,
	type BackgroundJob,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	SETTLE_JOB_KIND,
	type StoryStore,
	createBackgroundJobRegistry,
	createSettleHandler,
	drainBackgroundJobs,
	enqueueMissingJobs,
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
		raw: "开场。",
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
		raw: "凛看了你一眼。",
	});
}

async function drain(
	store: StoryStore,
	client: LlmClient,
): Promise<BackgroundDrainResult> {
	return drainBackgroundJobs({
		store,
		registry: createBackgroundJobRegistry({
			[SETTLE_JOB_KIND]: {
				handler: createSettleHandler(),
				enqueue: "settled",
			},
		}),
		client,
		storyId: "s1",
		kinds: [SETTLE_JOB_KIND],
		now: () => FIXED_NOW,
	});
}

function jobFor(nodeId: string): BackgroundJob {
	return {
		id: 1,
		storyId: "s1",
		nodeId,
		kind: SETTLE_JOB_KIND,
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: new Date(FIXED_NOW).toISOString(),
		startedAt: new Date(FIXED_NOW).toISOString(),
		finishedAt: null,
	};
}

describe("结算任务", () => {
	it("一次请求覆盖窗口里的多个楼层，只补缺失路径", async () => {
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
		const { client, requests } = createFakeClient([
			JSON.stringify([
				{
					nodeId: "a1",
					diffs: [
						{
							path: ["clue", "c1", "status"],
							op: "set",
							value: "open",
							confidence: 0.8,
							reason: "开场留下了未解的悬念",
						},
					],
				},
				{
					nodeId: "a2",
					diffs: [
						{
							path: ["character", "凛", "location"],
							op: "set",
							value: "屋顶",
							confidence: 0.9,
						},
						{
							path: ["character", "凛", "status"],
							op: "set",
							value: "警觉",
							confidence: 0.7,
						},
					],
				},
			]),
		]);

		const result = await drain(store, client);

		expect(requests).toHaveLength(1);
		expect(result.runs.map((run) => run.status)).toEqual(["done", "done"]);
		expect(store.getStateDiffs("a1").map((diff) => diff.path)).toEqual([
			["clue", "c1", "status"],
		]);
		expect(store.getStateDiffs("a2").map((diff) => diff.path)).toEqual([
			["character", "凛", "location"],
			["character", "凛", "status"],
		]);
		expect(store.getStateSnapshot("a2").state).toEqual({
			character: { 凛: { location: "教室", status: "警觉" } },
			clue: { c1: { status: "open" } },
		});

		const a1 = store.getLedgerSettlement("a1");
		expect(a1).toMatchObject({ source: "settler", addedCount: 1 });
		expect(a1?.repairs).toEqual([
			{
				path: ["clue", "c1", "status"],
				action: "fill",
				reason: "开场留下了未解的悬念",
			},
		]);
		const a2Settlement = store.getLedgerSettlement("a2");
		expect(a2Settlement).toMatchObject({ source: "settler", addedCount: 1 });
		expect(a2Settlement?.repairs).toEqual([
			{
				path: ["character", "凛", "status"],
				action: "fill",
				reason: "结算器补齐了本楼层没有写入的事实",
			},
		]);
	});

	it("楼层里任一条目非法时整条拒绝并记录原因，其余楼层照常写入", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([
			JSON.stringify([
				{
					nodeId: "a1",
					diffs: [
						{
							path: ["clue", "c1", "status"],
							op: "set",
							value: "open",
							confidence: 0.8,
						},
					],
				},
				{
					nodeId: "a2",
					diffs: [
						{
							path: ["clue", "c2", "text"],
							op: "set",
							value: "一封信",
							confidence: 0.8,
						},
						{
							path: ["character", "凛", "发型"],
							op: "set",
							value: "长发",
							confidence: 0.8,
						},
					],
				},
			]),
		]);

		await drain(store, client);

		expect(store.getStateDiffs("a1").map((diff) => diff.path)).toEqual([
			["clue", "c1", "status"],
		]);
		expect(store.getStateDiffs("a2")).toEqual([]);
		const settlement = store.getLedgerSettlement("a2");
		expect(settlement).toMatchObject({ source: "settler", addedCount: 0 });
		expect(settlement?.repairs).toHaveLength(1);
		expect(settlement?.repairs[0]).toMatchObject({
			path: ["character", "凛", "发型"],
			action: "delete",
		});
		expect(settlement?.repairs[0]?.reason).toContain("未知 character 字段");
	});

	it("本楼层已有的不合格台账写入被删除并记入修复", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "a2",
			path: ["character", "凛", "发型"],
			op: "set",
			value: "长发",
			source: "model",
		});
		expect(store.getStateSnapshot("a2").state).toEqual({
			character: { 凛: { 发型: "长发" } },
		});
		const { client } = createFakeClient([JSON.stringify([])]);

		await drain(store, client);

		expect(store.getStateDiffs("a2")).toEqual([]);
		expect(store.getStateSnapshot("a2").state).toEqual({});
		const settlement = store.getLedgerSettlement("a2");
		expect(settlement).toMatchObject({ source: "settler", addedCount: 0 });
		expect(settlement?.repairs).toHaveLength(1);
		expect(settlement?.repairs[0]).toMatchObject({
			path: ["character", "凛", "发型"],
			action: "delete",
		});
		expect(settlement?.repairs[0]?.reason).toContain(
			"本楼层已有的台账写入不合格",
		);
	});

	it("删除状态 diff 时只接受属于该楼层的 id", () => {
		const { store } = openTempStore();
		seedStory(store);
		const first = store.appendStateDiff({
			storyId: "s1",
			nodeId: "a2",
			path: ["clue", "c1", "status"],
			op: "set",
			value: "open",
			source: "model",
		});
		const second = store.appendStateDiff({
			storyId: "s1",
			nodeId: "a1",
			path: ["clue", "c2", "status"],
			op: "set",
			value: "open",
			source: "model",
		});

		expect(store.deleteStateDiffs("a2", [first.id])).toBe(1);
		expect(store.getStateDiffs("a2")).toEqual([]);
		expect(() => store.deleteStateDiffs("a2", [second.id])).toThrow(
			"没有 id 为",
		);
		expect(store.getStateDiffs("a1")).toHaveLength(1);
		expect(() => store.deleteStateDiffs("a2", [0])).toThrow("正整数");
	});

	it("线索状态不在允许取值里时改写并记录修复原因", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([
			JSON.stringify([
				{
					nodeId: "a2",
					diffs: [
						{
							path: ["clue", "c1", "status"],
							op: "set",
							value: "已兑现",
							confidence: 0.9,
						},
					],
				},
			]),
		]);

		await drain(store, client);

		const diffs = store.getStateDiffs("a2");
		expect(diffs).toHaveLength(1);
		expect(diffs[0]?.value).toBe("fulfilled");
		const repairs = store.getLedgerSettlement("a2")?.repairs;
		expect(repairs?.[0]).toMatchObject({
			path: ["clue", "c1", "status"],
			action: "rewrite_status",
		});
		expect(repairs?.[1]).toMatchObject({
			path: ["clue", "c1", "status"],
			action: "fill",
		});
	});

	it("重复执行不再请求模型，也不产生重复行", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([
			JSON.stringify([
				{
					nodeId: "a2",
					diffs: [
						{
							path: ["character", "凛", "status"],
							op: "set",
							value: "警觉",
							confidence: 0.7,
						},
					],
				},
			]),
		]);
		const handler = createSettleHandler();

		await handler({ store, client, job: jobFor("a2") });
		await handler({ store, client, job: jobFor("a2") });

		expect(requests).toHaveLength(1);
		expect(store.getStateDiffs("a2")).toHaveLength(1);
		expect(store.listLedgerSettlements("s1")).toHaveLength(2);
	});

	it("分支切换后只结算当前路径上的楼层", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "a2",
			path: ["item", "旧剑", "holder"],
			op: "set",
			value: "凛",
			source: "model",
		});
		const branch = store.swipeNode("a2", "凛移开了视线。");
		const { client } = createFakeClient([
			JSON.stringify([
				{
					nodeId: branch.id,
					diffs: [
						{
							path: ["character", "凛", "status"],
							op: "set",
							value: "回避",
							confidence: 0.7,
						},
					],
				},
			]),
		]);

		await drain(store, client);

		expect(store.getLedgerSettlement(branch.id)).not.toBeNull();
		expect(store.getLedgerSettlement("a2")).toBeNull();
		expect(store.getStateSnapshot(branch.id).state).toEqual({
			character: { 凛: { status: "回避" } },
		});
	});

	it("窗口里的 nodeId 未知或重复时整次请求失败并等待重试", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const handler = createSettleHandler();

		await expect(
			handler({
				store,
				client: createFakeClient([
					JSON.stringify([{ nodeId: "missing", diffs: [] }]),
				]).client,
				job: jobFor("a2"),
			}),
		).rejects.toThrow("不在结算窗口里");
		expect(store.listLedgerSettlements("s1")).toEqual([]);
		expect(store.getStateDiffs("a1")).toEqual([]);
		expect(store.getStateDiffs("a2")).toEqual([]);

		await expect(
			handler({
				store,
				client: createFakeClient([
					JSON.stringify([
						{ nodeId: "a1", diffs: [] },
						{ nodeId: "a1", diffs: [] },
					]),
				]).client,
				job: jobFor("a2"),
			}),
		).rejects.toThrow("nodeId 重复");
		expect(store.listLedgerSettlements("s1")).toEqual([]);
	});

	it("没有后台客户端时任务保持 pending，不写结算记录", () => {
		const { store } = openTempStore();
		seedStory(store);

		const created = enqueueMissingJobs({
			store,
			storyId: "s1",
			kinds: [SETTLE_JOB_KIND],
			conditions: { [SETTLE_JOB_KIND]: "settled" },
			now: () => FIXED_NOW,
		});

		expect(created.map((job) => job.nodeId)).toEqual(["a1", "a2"]);
		expect(created.every((job) => job.status === "pending")).toBe(true);
		expect(store.listLedgerSettlements("s1")).toEqual([]);
	});

	it("没有未结算楼层时不调用模型", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const { client, requests } = createFakeClient([]);

		await createSettleHandler()({ store, client, job: jobFor("missing") });

		expect(requests).toEqual([]);
	});
});
