import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	DIRECTOR_PLAN_JOB_KIND,
	type DirectorPlan,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	collectDirectorPlanInput,
	createBackgroundJobRegistry,
	createDefaultBackgroundJobRegistry,
	createDirectorPlanHandler,
	directorPlanNeedsRun,
	drainBackgroundJobs,
	readDirectorPlan,
	replaceDirectorPlan,
	runDirectorCli,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_NOW = Date.UTC(2026, 10, 8, 12, 0, 0);

const MODEL_PLAN: DirectorPlan = {
	arcs: [
		{
			id: "arc-1",
			title: "徽章",
			throughLine: "必须查明徽章的来历",
			difficulty: 0.4,
			redLines: ["不能伤害凛"],
			sequences: [
				{
					id: "seq-1",
					title: "图书室",
					beats: [
						{
							id: "beat-1",
							goal: "让凛开口",
							entrySigns: ["凛合上书"],
							fitPoints: ["徽章", "门外的脚步声"],
						},
					],
				},
			],
		},
	],
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

const throwingClient: LlmClient = {
	async complete(): Promise<never> {
		throw new Error("不应该调用这个客户端");
	},
};

function seedStory(
	store: StoryStore,
	options: { card: boolean },
): {
	readonly a1: string;
	readonly u1: string;
} {
	store.createStory({ id: "s1", title: "计划" });
	if (options.card) {
		store.updateStorySettings("s1", {
			cardName: "凛",
			characterPrompt: "凛是图书委员，性格冷淡。",
		});
	}
	const a1 = store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。",
	});
	const u1 = store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: a1.id,
		role: "user",
		raw: "你好。",
	});
	store.appendStateDiffs([
		{
			storyId: "s1",
			nodeId: u1.id,
			path: ["relation", "凛", "你", "type"],
			op: "set",
			value: "同盟",
			source: "model",
		},
		{
			storyId: "s1",
			nodeId: u1.id,
			path: ["clue", "c1", "text"],
			op: "set",
			value: "查明徽章来历",
			source: "model",
		},
		{
			storyId: "s1",
			nodeId: u1.id,
			path: ["clue", "c1", "status"],
			op: "set",
			value: "open",
			source: "model",
		},
		{
			storyId: "s1",
			nodeId: u1.id,
			path: ["item", "徽章", "holder"],
			op: "set",
			value: "凛",
			source: "model",
		},
		{
			storyId: "s1",
			nodeId: u1.id,
			path: ["userWill", "w1"],
			op: "set",
			value: {
				kind: "preference",
				text: "不要写死角色",
				sourceNodeId: u1.id,
				createdAt: "2026-11-08T00:00:00.000Z",
			},
			source: "settler",
		},
	]);
	store.insertSummary({
		storyId: "s1",
		level: "chapter",
		startNodeId: a1.id,
		endNodeId: u1.id,
		text: "两人在图书室见面。",
	});
	return { a1: a1.id, u1: u1.id };
}

/** 没有角色卡也没有台账素材的故事。 */
function seedBareStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "空" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。",
	});
}

const registry = createBackgroundJobRegistry({
	[DIRECTOR_PLAN_JOB_KIND]: {
		handler: createDirectorPlanHandler(),
		enqueue: "story",
		tier: "deferred",
		needsRun: directorPlanNeedsRun,
	},
});

function storyJob(): BackgroundJob {
	const at = new Date(FIXED_NOW).toISOString();
	return {
		id: 1,
		storyId: "s1",
		nodeId: null,
		kind: DIRECTOR_PLAN_JOB_KIND,
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: at,
		startedAt: at,
		finishedAt: null,
	};
}

describe("规划器输入", () => {
	it("汇总卡、台账、摘要与现有计划", () => {
		const { store } = openTempStore();
		const { u1 } = seedStory(store, { card: true });
		const plan: DirectorPlan = { arcs: [] };
		replaceDirectorPlan(store, "s1", plan);
		const input = collectDirectorPlanInput(store, "s1");
		expect(input).not.toBeNull();
		expect(input?.headNodeId).toBe(u1);
		expect(input?.cardName).toBe("凛");
		expect(input?.relations).toEqual([{ from: "凛", to: "你", type: "同盟" }]);
		expect(input?.openClues).toHaveLength(1);
		expect(input?.items).toEqual({ 徽章: { holder: "凛" } });
		expect(input?.userWills).toMatchObject({ w1: { kind: "preference" } });
		expect(input?.summary).toBe("两人在图书室见面。");
	});

	it("没有角色卡也没有台账素材时返回 null", () => {
		const { store } = openTempStore();
		seedBareStory(store);
		expect(collectDirectorPlanInput(store, "s1")).toBeNull();
	});
});

describe("入队条件", () => {
	it("没有计划时补建，当前拍未耗尽时不补建，拍耗尽后重新补建", () => {
		const { store } = openTempStore();
		const { u1 } = seedStory(store, { card: true });
		expect(directorPlanNeedsRun(store, "s1")).toBe(true);

		replaceDirectorPlan(store, "s1", MODEL_PLAN);
		expect(directorPlanNeedsRun(store, "s1")).toBe(false);

		store.saveDirectorBeatState({
			nodeId: u1,
			storyId: "s1",
			beatId: "beat-1",
			completed: false,
		});
		expect(directorPlanNeedsRun(store, "s1")).toBe(false);

		store.saveDirectorBeatState({
			nodeId: u1,
			storyId: "s1",
			beatId: "beat-1",
			completed: true,
		});
		expect(directorPlanNeedsRun(store, "s1")).toBe(true);
	});

	it("没有素材时不补建", () => {
		const { store } = openTempStore();
		seedBareStory(store);
		expect(directorPlanNeedsRun(store, "s1")).toBe(false);
	});
});

describe("规划器后台任务", () => {
	it("会话结束时执行一次调用并写入来源为 model 的计划", async () => {
		const { store } = openTempStore();
		seedStory(store, { card: true });
		const { client, requests } = createFakeClient([JSON.stringify(MODEL_PLAN)]);
		const result = await drainBackgroundJobs({
			store,
			registry,
			client,
			storyId: "s1",
			kinds: [DIRECTOR_PLAN_JOB_KIND],
			sessionEnded: true,
			now: () => FIXED_NOW,
		});
		expect(result.enqueued).toBe(1);
		expect(result.runs.map((run) => run.status)).toEqual(["done"]);
		expect(requests).toHaveLength(1);
		const content = requests[0]?.messages
			.map((message) => message.content)
			.join("\n");
		for (const fragment of [
			"凛是图书委员",
			"凛 → 你：类型 同盟",
			"查明徽章来历",
			"徽章",
			"不要写死角色",
			"两人在图书室见面。",
		]) {
			expect(content).toContain(fragment);
		}
		expect(readDirectorPlan(store, "s1")).toEqual(MODEL_PLAN);
		expect(
			store.listDirectorPlanEntries("s1").arcs.map((arc) => arc.source),
		).toEqual(["model"]);
	});

	it("短间隙不执行可延后档", async () => {
		const { store } = openTempStore();
		seedStory(store, { card: true });
		const { client, requests } = createFakeClient([JSON.stringify(MODEL_PLAN)]);
		const result = await drainBackgroundJobs({
			store,
			registry,
			client,
			storyId: "s1",
			kinds: [DIRECTOR_PLAN_JOB_KIND],
			gapSeconds: 0,
			now: () => FIXED_NOW,
		});
		expect(result.enqueued).toBe(1);
		expect(result.runs).toEqual([]);
		expect(requests).toHaveLength(0);
		expect(readDirectorPlan(store, "s1").arcs).toEqual([]);
	});

	it("相同输入重复执行行数不变", async () => {
		const { store } = openTempStore();
		seedStory(store, { card: true });
		const { client } = createFakeClient([
			JSON.stringify(MODEL_PLAN),
			JSON.stringify(MODEL_PLAN),
		]);
		const handler = createDirectorPlanHandler();
		const run = () => handler({ store, client, job: storyJob() });
		await run();
		const first = store.listDirectorPlanEntries("s1");
		await run();
		const second = store.listDirectorPlanEntries("s1");
		expect(second.arcs).toHaveLength(first.arcs.length);
		expect(second.sequences).toHaveLength(first.sequences.length);
		expect(second.beats).toHaveLength(first.beats.length);
		expect(readDirectorPlan(store, "s1")).toEqual(MODEL_PLAN);
	});

	it("非法输出整份拒绝且不写入", async () => {
		const { store } = openTempStore();
		seedStory(store, { card: true });
		const { client } = createFakeClient([
			JSON.stringify({
				arcs: [
					{
						id: "arc-1",
						title: "徽章",
						throughLine: "查明来历",
						difficulty: 2,
						redLines: [],
						sequences: [],
					},
				],
			}),
		]);
		const result = await drainBackgroundJobs({
			store,
			registry,
			client,
			storyId: "s1",
			kinds: [DIRECTOR_PLAN_JOB_KIND],
			sessionEnded: true,
			maxAttempts: 1,
			now: () => FIXED_NOW,
		});
		expect(result.runs.map((run) => run.status)).toEqual(["failed"]);
		expect(result.runs[0]?.error).toContain("plan.arcs[0].difficulty");
		expect(store.listDirectorPlanEntries("s1")).toEqual({
			arcs: [],
			sequences: [],
			beats: [],
		});
	});

	it("玩家编辑的行保留，模型只追加新序列", async () => {
		const { store } = openTempStore();
		seedStory(store, { card: true });
		replaceDirectorPlan(store, "s1", MODEL_PLAN);
		const { client } = createFakeClient([
			JSON.stringify({
				arcs: [
					{
						...MODEL_PLAN.arcs[0],
						title: "模型改名",
						sequences: [
							{
								...MODEL_PLAN.arcs[0]?.sequences[0],
								title: "模型改名的序列",
							},
							{
								id: "seq-2",
								title: "追查",
								beats: [
									{
										id: "beat-2",
										goal: "找到徽章的来源",
										entrySigns: ["凛提到旧校舍"],
										fitPoints: ["徽章背面的刻字"],
									},
								],
							},
						],
					},
				],
			}),
		]);
		await createDirectorPlanHandler()({ store, client, job: storyJob() });
		const stored = readDirectorPlan(store, "s1");
		const arc = stored.arcs[0];
		expect(arc?.title).toBe("徽章");
		expect(arc?.sequences.map((sequence) => sequence.id)).toEqual([
			"seq-1",
			"seq-2",
		]);
		expect(arc?.sequences[0]?.title).toBe("图书室");
		expect(arc?.sequences[1]?.beats[0]?.goal).toBe("找到徽章的来源");
		const sources = store.listDirectorPlanEntries("s1");
		expect(sources.arcs[0]?.source).toBe("player");
		expect(sources.sequences.map((sequence) => sequence.source)).toEqual([
			"player",
			"model",
		]);
	});

	it("默认注册表使用规划器专用客户端", async () => {
		const { store } = openTempStore();
		seedStory(store, { card: true });
		const { client: plannerClient, requests } = createFakeClient([
			JSON.stringify(MODEL_PLAN),
		]);
		const result = await drainBackgroundJobs({
			store,
			registry: createDefaultBackgroundJobRegistry({ plannerClient }),
			client: throwingClient,
			storyId: "s1",
			kinds: [DIRECTOR_PLAN_JOB_KIND],
			sessionEnded: true,
			now: () => FIXED_NOW,
		});
		expect(result.runs.map((run) => run.status)).toEqual(["done"]);
		expect(requests).toHaveLength(1);
	});
});

describe("dramaticer director plan --generate", () => {
	it("用注入的客户端同步执行一次并写入来源为 model 的计划", async () => {
		const { store, path } = openTempStore();
		seedStory(store, { card: true });
		const { client, requests } = createFakeClient([JSON.stringify(MODEL_PLAN)]);
		const lines: string[] = [];
		const result = await runDirectorCli(
			["director", "plan", "--story", "s1", "--db", path, "--generate"],
			{ client, log: (message) => lines.push(message) },
		);
		expect(result.action).toBe("generate");
		expect(result.plan).toEqual(MODEL_PLAN);
		expect(requests).toHaveLength(1);
		expect(lines.join("\n")).toContain("已生成导演计划：s1");
		expect(readDirectorPlan(store, "s1")).toEqual(MODEL_PLAN);
		expect(store.listDirectorPlanEntries("s1").arcs[0]?.source).toBe("model");
	});

	it("--generate 与 --set 不能同时使用", async () => {
		const { path } = openTempStore();
		await expect(
			runDirectorCli(
				[
					"director",
					"plan",
					"--story",
					"s1",
					"--db",
					path,
					"--generate",
					"--set",
					"plan.json",
				],
				{ log: () => {} },
			),
		).rejects.toThrow("--generate 与 --set 不能同时使用");
	});
});
