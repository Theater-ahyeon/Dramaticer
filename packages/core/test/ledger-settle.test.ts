import { describe, expect, it } from "vitest";
import {
	type BackgroundDrainResult,
	type BackgroundJob,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	SETTLE_JOB_KIND,
	type StoryStore,
	buildSettlementMessages,
	createBackgroundJobRegistry,
	createSettleHandler,
	drainBackgroundJobs,
	enqueueMissingJobs,
	prepareSettlementForNodes,
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

describe("结算的实体解析、knowledge 去重与冲突拒绝", () => {
	it("不认识的名称只出现一次时只记候选，不建档", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([
			JSON.stringify([
				{
					nodeId: "a2",
					diffs: [
						{
							path: ["character", "新同学", "status"],
							op: "set",
							value: "旁观",
							confidence: 0.6,
						},
					],
				},
			]),
		]);

		await drain(store, client);

		expect(store.listEntities("s1")).toEqual([]);
		expect(store.listEntityCandidates("s1")).toMatchObject([
			{ kind: "character", hits: 1, firstNodeId: "a2" },
		]);
		expect(store.getStateDiffs("a2").map((diff) => diff.path)).toEqual([
			["character", "新同学", "status"],
		]);
	});

	it("同一窗口里出现两次的名称立即建档", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([
			JSON.stringify([
				{
					nodeId: "a1",
					diffs: [
						{
							path: ["character", "新同学", "location"],
							op: "set",
							value: "走廊",
							confidence: 0.7,
						},
					],
				},
				{
					nodeId: "a2",
					diffs: [
						{
							path: ["character", "新同学", "status"],
							op: "set",
							value: "警觉",
							confidence: 0.7,
						},
					],
				},
			]),
		]);

		await drain(store, client);

		expect(store.listEntities("s1")).toMatchObject([
			{ kind: "character", name: "新同学", source: "settler" },
		]);
		expect(store.listEntityCandidates("s1")).toEqual([]);
		expect(store.getStateSnapshot("a2").state).toEqual({
			character: { 新同学: { location: "走廊", status: "警觉" } },
		});
	});

	it("正文模型直接写入的名称立即建档", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "a2",
			path: ["character", "转校生", "status"],
			op: "set",
			value: "沉默",
			source: "model",
		});
		const { client } = createFakeClient([JSON.stringify([])]);

		await drain(store, client);

		expect(store.listEntities("s1")).toMatchObject([
			{ kind: "character", name: "转校生", source: "model" },
		]);
		expect(store.listEntityCandidates("s1")).toEqual([]);
	});

	it("人物、地点与物品的名称按别名表换成规范写法", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.upsertEntity({
			storyId: "s1",
			kind: "character",
			name: "凛",
			aliases: ["远坂凛"],
			source: "card",
		});
		store.upsertEntity({
			storyId: "s1",
			kind: "location",
			name: "学院",
			aliases: ["时钟塔"],
			source: "card",
		});
		store.upsertEntity({
			storyId: "s1",
			kind: "item",
			name: "徽章",
			aliases: ["刻纹徽章"],
			source: "card",
		});
		const { client } = createFakeClient([
			JSON.stringify([
				{
					nodeId: "a2",
					diffs: [
						{
							path: ["character", "远坂凛", "status"],
							op: "set",
							value: "警惕",
							confidence: 0.8,
						},
						{
							path: ["scene", "places", "时钟塔", "name"],
							op: "set",
							value: "时钟塔",
							confidence: 0.8,
						},
						{
							path: ["item", "刻纹徽章", "holder"],
							op: "set",
							value: "凛",
							confidence: 0.8,
						},
					],
				},
			]),
		]);

		await drain(store, client);

		expect(store.getStateSnapshot("a2").state).toMatchObject({
			character: { 凛: { status: "警惕" } },
			scene: { places: { 学院: { name: "时钟塔" } } },
			item: { 徽章: { holder: "凛" } },
		});
		expect(store.listEntityCandidates("s1")).toEqual([]);
	});

	it("knowledge 按知情者与 factId 去重，不同知情者各记一条", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "a2",
			path: ["knowledge", "凛", "k1"],
			op: "set",
			value: { factId: "clue-1", text: "知道信的来历" },
			source: "model",
		});
		const { client } = createFakeClient([
			JSON.stringify([
				{
					nodeId: "a2",
					diffs: [
						{
							path: ["knowledge", "凛", "k2"],
							op: "set",
							value: { factId: "clue-1", text: "重复的同一条知识" },
							confidence: 0.8,
						},
						{
							path: ["knowledge", "卫宫", "k3"],
							op: "set",
							value: { factId: "clue-1", text: "卫宫也知道" },
							confidence: 0.8,
						},
						{
							path: ["knowledge", "凛", "k4"],
							op: "set",
							value: { factId: "clue-2", text: "知道第二件事" },
							confidence: 0.8,
						},
					],
				},
			]),
		]);

		await drain(store, client);

		expect(store.getStateDiffs("a2").map((diff) => diff.path)).toEqual([
			["knowledge", "凛", "k1"],
			["knowledge", "卫宫", "k3"],
			["knowledge", "凛", "k4"],
		]);
	});

	it("与最近原文冲突的事实不写入，记入修复记录", async () => {
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
		const { client } = createFakeClient([
			JSON.stringify([
				{
					nodeId: "a2",
					diffs: [
						{
							path: ["character", "凛", "location"],
							op: "set",
							value: "屋顶",
							confidence: 0.5,
						},
					],
					conflicts: [
						{
							path: ["character", "凛", "location"],
							reason: "最近一楼明确写她还在教室",
						},
					],
				},
			]),
		]);

		await drain(store, client);

		expect(store.getStateSnapshot("a2").state).toEqual({
			character: { 凛: { location: "教室" } },
		});
		const settlement = store.getLedgerSettlement("a2");
		expect(settlement).toMatchObject({ source: "settler", addedCount: 0 });
		expect(settlement?.repairs).toMatchObject([
			{
				path: ["character", "凛", "location"],
				action: "conflict",
			},
		]);
		expect(settlement?.repairs[0]?.reason).toContain(
			"最近一楼明确写她还在教室",
		);
	});

	it("冲突检查窗口取 head 路径上最近的楼层，楼层数可配置", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const raws = [
			"第一楼",
			"第二楼",
			"第三楼",
			"第四楼",
			"第五楼",
			"第六楼",
			"第七楼",
			"第八楼",
			"第九楼",
		];
		let parentId: string | null = null;
		for (const [index, raw] of raws.entries()) {
			const id = `n${index + 1}`;
			store.appendNode({
				id,
				storyId: "s1",
				parentId,
				role: index % 2 === 0 ? "assistant" : "user",
				raw,
			});
			parentId = id;
		}
		const { client, requests } = createFakeClient([JSON.stringify([])]);

		await createSettleHandler({ conflictWindowFloors: 2 })({
			store,
			client,
			job: jobFor("n1"),
		});

		const content = requests[0]?.messages[1]?.content ?? "";
		expect(content).not.toContain("<最近楼层 id=");
		expect(content).toContain('<最近楼层 角色="assistant">');
		expect(content).toContain('<最近楼层 角色="user">');
		expect(content).toContain("第八楼");
		expect(content).toContain("第九楼");
	});

	it("可写入的楼层 id 只出现在结算窗口里", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		let parentId: string | null = null;
		for (let index = 1; index <= 9; index += 1) {
			const id = `n${index}`;
			store.appendNode({
				id,
				storyId: "s1",
				parentId,
				role: index % 2 === 0 ? "user" : "assistant",
				raw: `第${index}楼`,
			});
			parentId = id;
		}
		const window = prepareSettlementForNodes(store, "s1", ["n7"], {
			conflictWindowFloors: 3,
		});
		if (window === null) throw new Error("结算窗口不应为空");
		const content = buildSettlementMessages(window)[1]?.content ?? "";
		expect(content).toContain('<楼层 id="n7">');
		expect(content).not.toContain("<最近楼层 id=");
		expect(content.match(/<楼层 id=/g)).toHaveLength(1);
	});
});
