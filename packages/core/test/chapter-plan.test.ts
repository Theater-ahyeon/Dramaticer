import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	chapterPlanNeedsRun,
	createChapterPlanHandler,
	milestonePromiseLineId,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

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

const FLOORS = 5;

function seedChain(store: StoryStore, floors = FLOORS): void {
	store.createStory({ id: "s1", title: "测试" });
	let parentId: string | null = null;
	for (let index = 1; index <= floors; index += 1) {
		const id = `a${index}`;
		store.appendNode({
			id,
			storyId: "s1",
			parentId,
			role: "assistant",
			raw: `第 ${index} 楼的正文。`,
		});
		parentId = id;
	}
}

function seedChainAfterA1(store: StoryStore, parentId: string): void {
	let parent = parentId;
	for (let index = 2; index <= FLOORS; index += 1) {
		const userId = `u${index - 1}`;
		store.appendNode({
			id: userId,
			storyId: "s1",
			parentId: parent,
			role: "user",
			raw: `第 ${index - 1} 次行动。`,
		});
		const id = `a${index}`;
		store.appendNode({
			id,
			storyId: "s1",
			parentId: userId,
			role: "assistant",
			raw: `第 ${index} 楼的正文。`,
		});
		parent = id;
	}
}

function seedLines(store: StoryStore): void {
	store.saveDirectorLines({
		nodeId: "a1",
		storyId: "s1",
		diffs: [
			{
				action: "set",
				line: {
					id: "main-1",
					kind: "main",
					who: "卫宫",
					want: "阻止仪式",
					obstacle: "时间只剩一夜",
					countdown: 6,
					preparations: [],
				},
			},
			{
				action: "set",
				line: {
					id: "promise-1",
					kind: "promise",
					who: "凛",
					want: "拿回那封信",
					obstacle: "信在管家手里",
					countdown: null,
					preparations: [],
				},
			},
			{
				action: "set",
				line: {
					id: "rel-1",
					kind: "relationship",
					who: "凛",
					want: "与卫宫并肩",
					obstacle: "两人还没有互信",
					countdown: null,
					preparations: [],
				},
			},
		],
	});
}

function seedBlueprint(
	store: StoryStore,
	prerequisites: readonly string[],
): void {
	store.saveStoryBlueprint({
		nodeId: "a1",
		storyId: "s1",
		source: "player",
		diffs: [
			{
				action: "set",
				entry: {
					id: "vol1",
					kind: "volume",
					source: "player",
					locked: false,
					title: "第一卷",
					coreQuestion: "能不能进城",
					startState: "",
					endState: "",
				},
			},
			{
				action: "set",
				entry: {
					id: "ms1",
					kind: "milestone",
					source: "player",
					locked: false,
					volumeId: "vol1",
					want: "进入王城",
					prerequisites: [...prerequisites],
					after: [],
					hardness: "hard",
				},
			},
		],
	});
}

function seedMilestonePromise(store: StoryStore, prerequisite: string): string {
	const id = milestonePromiseLineId("ms1", prerequisite);
	store.saveDirectorLines({
		nodeId: "a2",
		storyId: "s1",
		diffs: [
			{
				action: "set",
				line: {
					id,
					kind: "promise",
					who: "里程碑 ms1",
					want: prerequisite,
					obstacle: "还没有铺垫好",
					countdown: null,
					preparations: [],
				},
			},
		],
	});
	return id;
}

function endScene(store: StoryStore, nodeId: string): void {
	store.saveSceneLog({
		nodeId,
		storyId: "s1",
		beat: "收束",
		present: ["凛"],
		sceneEnds: true,
		sceneCard: null,
		bits: [],
		conditions: [],
		states: [],
		quotes: { submitted: 0, verified: 0 },
		repairs: [],
	});
}

function setChapterFloors(store: StoryStore, chapterFloors: number): void {
	store.updateStorySettings("s1", {
		directorConfig: { ...DEFAULT_DIRECTOR_CONFIG, chapterFloors },
	});
}

function job() {
	return {
		id: 1,
		storyId: "s1",
		nodeId: null,
		kind: "chapter_plan",
		status: "running" as const,
		attempts: 1,
		lastError: null,
		createdAt: "2026-11-14T12:00:00.000Z",
		startedAt: "2026-11-14T12:00:00.000Z",
		finishedAt: null,
	};
}

const PLAN = JSON.stringify({
	lines: [
		{
			action: "set",
			line: {
				id: "main-1",
				kind: "main",
				who: "卫宫",
				want: "阻止仪式",
				obstacle: "仪式已经开始",
				countdown: 2,
				preparations: ["钟楼先响了一声"],
			},
		},
	],
	review: {
		promises: [{ lineId: "promise-1", disposition: "retire" }],
		focus: ["main-1", "rel-1"],
	},
});

describe("章末规划", () => {
	it("积累够楼层且这一场结束后才入队", () => {
		const { store } = openTempStore();
		seedChain(store);
		seedLines(store);
		setChapterFloors(store, 3);

		expect(chapterPlanNeedsRun(store, "s1")).toBe(false);
		endScene(store, "a5");
		expect(chapterPlanNeedsRun(store, "s1")).toBe(true);

		setChapterFloors(store, 10);
		expect(chapterPlanNeedsRun(store, "s1")).toBe(false);
	});

	it("导演关闭时不入队", () => {
		const { store } = openTempStore();
		seedChain(store);
		seedLines(store);
		endScene(store, "a5");
		setChapterFloors(store, 3);
		store.updateStorySettings("s1", {
			directorConfig: {
				...DEFAULT_DIRECTOR_CONFIG,
				chapterFloors: 3,
				mode: "off",
			},
		});

		expect(chapterPlanNeedsRun(store, "s1")).toBe(false);
	});

	it("一次调用写入线修改与章末清点，作废的伏笔从线上删除", async () => {
		const { store } = openTempStore();
		seedChain(store);
		seedLines(store);
		endScene(store, "a5");
		setChapterFloors(store, 3);
		const { client, requests } = createFakeClient([PLAN]);

		await createChapterPlanHandler()({ store, client, job: job() });

		expect(requests).toHaveLength(1);
		expect(requests[0]?.messages[0]?.content).toContain("review.focus");
		const review = store.getDirectorChapterReview("a5");
		expect(review?.payload).toEqual({
			promises: [{ lineId: "promise-1", disposition: "retire" }],
			focus: ["main-1", "rel-1"],
		});
		const states = store.readDirectorLineStates("a5");
		expect(states.map((state) => state.line.id)).toEqual(["main-1", "rel-1"]);
		expect(states[0]?.line.countdown).toBe(2);
	});

	it("规划产出的必须打断字段保存到线里", async () => {
		const { store } = openTempStore();
		seedChain(store);
		seedLines(store);
		endScene(store, "a5");
		setChapterFloors(store, 3);
		const urgent = JSON.stringify({
			lines: [
				{
					action: "set",
					line: {
						id: "main-1",
						kind: "main",
						who: "卫宫",
						want: "阻止仪式",
						obstacle: "仪式已经开始",
						countdown: 2,
						preparations: ["钟楼先响了一声"],
						mustInterrupt: true,
					},
				},
			],
			review: {
				promises: [{ lineId: "promise-1", disposition: "retire" }],
				focus: ["main-1", "rel-1"],
			},
		});
		const { client } = createFakeClient([urgent]);

		await createChapterPlanHandler()({ store, client, job: job() });

		const states = store.readDirectorLineStates("a5");
		const urgentLine = states.find((state) => state.line.id === "main-1");
		expect(urgentLine?.line.mustInterrupt).toBe(true);
		const plainLine = states.find((state) => state.line.id === "rel-1");
		expect(plainLine?.line.mustInterrupt).toBeUndefined();
	});

	it("重复执行不追加记录也不再调用模型", async () => {
		const { store } = openTempStore();
		seedChain(store);
		seedLines(store);
		endScene(store, "a5");
		setChapterFloors(store, 3);
		const { client } = createFakeClient([PLAN]);

		await createChapterPlanHandler()({ store, client, job: job() });
		await createChapterPlanHandler()({ store, client, job: job() });

		expect(store.getDirectorChapterReview("a5")?.payload.focus).toEqual([
			"main-1",
			"rel-1",
		]);
	});

	it("清点没有覆盖全部伏笔时整批拒绝，一行都不写", async () => {
		const { store } = openTempStore();
		seedChain(store);
		seedLines(store);
		endScene(store, "a5");
		setChapterFloors(store, 3);
		const bad = JSON.stringify({
			lines: [],
			review: { promises: [], focus: ["main-1", "rel-1"] },
		});
		const { client } = createFakeClient([bad]);

		await expect(
			createChapterPlanHandler()({ store, client, job: job() }),
		).rejects.toThrow("没有给出伏笔的处理");
		expect(store.getDirectorChapterReview("a5")).toBeNull();
		expect(store.getDirectorLines("a5")).toBeNull();
	});

	it("写入失败时反思不单独留下", async () => {
		const { store } = openTempStore();
		seedChain(store);
		seedLines(store);
		endScene(store, "a5");
		setChapterFloors(store, 3);
		// 这一楼已经有一批线修改：后面的写入会失败，反思必须跟着回滚。
		store.saveDirectorLines({
			nodeId: "a5",
			storyId: "s1",
			diffs: [
				{
					action: "set",
					line: {
						id: "extra-1",
						kind: "main",
						who: "管家",
						want: "关门",
						obstacle: "钥匙不在手上",
						countdown: null,
						preparations: [],
					},
				},
			],
		});
		const withReflection = JSON.stringify({
			...(JSON.parse(PLAN) as Record<string, unknown>),
			reflection: "凛开始信任卫宫。",
		});
		const { client } = createFakeClient([withReflection]);

		await expect(
			createChapterPlanHandler()({ store, client, job: job() }),
		).rejects.toThrow();
		expect(store.getDirectorChapterReview("a5")).toBeNull();
		expect(
			store
				.getEventsForPath("a5", { limit: 1000 })
				.filter((event) => event.source === "reflection"),
		).toEqual([]);
	});

	it("声明带到下一章的伏笔不能被这批修改删除", async () => {
		const { store } = openTempStore();
		seedChain(store);
		seedLines(store);
		endScene(store, "a5");
		setChapterFloors(store, 3);
		const contradictory = JSON.stringify({
			lines: [{ action: "delete", id: "promise-1" }],
			review: {
				promises: [{ lineId: "promise-1", disposition: "carry" }],
				focus: ["main-1", "rel-1"],
			},
		});
		const { client } = createFakeClient([contradictory]);

		await expect(
			createChapterPlanHandler()({ store, client, job: job() }),
		).rejects.toThrow("删除了声明带到下一章的伏笔");
		expect(store.getDirectorChapterReview("a5")).toBeNull();
	});

	it("规划使用注入的 planner 客户端", async () => {
		const { store } = openTempStore();
		seedChain(store);
		seedLines(store);
		endScene(store, "a5");
		setChapterFloors(store, 3);
		const planner = createFakeClient([PLAN]);
		const background = createFakeClient([]);

		await createChapterPlanHandler({ client: planner.client })({
			store,
			client: background.client,
			job: job(),
		});

		expect(planner.requests).toHaveLength(1);
		expect(background.requests).toHaveLength(0);
	});

	it("把最近里程碑的前提条件补成伏笔线并写进提示词", async () => {
		const { store } = openTempStore();
		seedChain(store);
		seedLines(store);
		seedBlueprint(store, ["拿到通行证", "认识守卫"]);
		endScene(store, "a5");
		setChapterFloors(store, 3);
		const { client, requests } = createFakeClient([PLAN]);

		await createChapterPlanHandler()({ store, client, job: job() });

		const prompt = requests[0]?.messages[1]?.content ?? "";
		expect(prompt).toContain("最近的未达成里程碑：ms1");
		expect(prompt).toContain("方向：进入王城");
		expect(prompt).toContain("前提条件：拿到通行证；认识守卫");

		const states = store.readDirectorLineStates("a5");
		const seeded = states.filter((state) =>
			state.line.id.startsWith("milestone."),
		);
		expect(seeded.map((state) => state.line.kind)).toEqual([
			"promise",
			"promise",
		]);
		expect(seeded.map((state) => state.line.want).sort()).toEqual([
			"拿到通行证",
			"认识守卫",
		]);
	});

	it("兑现最近里程碑的铺垫时可以 retire，程序删线后里程碑不再挡在前面", async () => {
		const { store } = openTempStore();
		seedChain(store);
		seedLines(store);
		seedBlueprint(store, ["拿到通行证"]);
		const lineId = seedMilestonePromise(store, "拿到通行证");
		endScene(store, "a5");
		setChapterFloors(store, 3);
		const retiring = JSON.stringify({
			lines: [],
			review: {
				promises: [
					{ lineId: "promise-1", disposition: "retire" },
					{ lineId, disposition: "retire" },
				],
				focus: ["main-1", "rel-1"],
			},
		});
		const { client } = createFakeClient([retiring]);

		await createChapterPlanHandler()({ store, client, job: job() });

		expect(store.getDirectorChapterReview("a5")?.payload.promises).toEqual([
			{ lineId: "promise-1", disposition: "retire" },
			{ lineId, disposition: "retire" },
		]);
		expect(
			store.readDirectorLineStates("a5").map((state) => state.line.id),
		).toEqual(["main-1", "rel-1"]);
	});

	it("模型不能删除或改写最近里程碑的铺垫方向", async () => {
		const { store } = openTempStore();
		seedChain(store);
		seedLines(store);
		seedBlueprint(store, ["拿到通行证"]);
		const lineId = seedMilestonePromise(store, "拿到通行证");
		endScene(store, "a5");
		setChapterFloors(store, 3);
		const deleting = JSON.stringify({
			lines: [{ action: "delete", id: lineId }],
			review: {
				promises: [
					{ lineId: "promise-1", disposition: "retire" },
					{ lineId, disposition: "carry" },
				],
				focus: ["main-1", "rel-1"],
			},
		});
		const { client } = createFakeClient([deleting]);

		await expect(
			createChapterPlanHandler()({ store, client, job: job() }),
		).rejects.toThrow("删除了声明带到下一章的伏笔");
		expect(store.getDirectorChapterReview("a5")).toBeNull();

		const rewriting = JSON.stringify({
			lines: [
				{
					action: "set",
					line: {
						id: lineId,
						kind: "promise",
						who: "里程碑 ms1",
						want: "换一个方向",
						obstacle: "还没有铺垫好",
						countdown: null,
						preparations: [],
					},
				},
			],
			review: {
				promises: [
					{ lineId: "promise-1", disposition: "retire" },
					{ lineId, disposition: "carry" },
				],
				focus: ["main-1", "rel-1"],
			},
		});
		const second = createFakeClient([rewriting]);

		await expect(
			createChapterPlanHandler()({ store, client: second.client, job: job() }),
		).rejects.toThrow("改写了里程碑「ms1」的方向");
		expect(store.getDirectorChapterReview("a5")).toBeNull();
	});

	it("章末清点只读取这一章玩家自己写的变化，推进与上一章不算", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "第 1 楼的正文。",
		});
		seedLines(store);
		store.appendNode({
			id: "u1",
			storyId: "s1",
			parentId: "a1",
			role: "user",
			raw: "上一章我把剑扔进了河里",
		});
		store.appendNode({
			id: "a2",
			storyId: "s1",
			parentId: "u1",
			role: "assistant",
			raw: "第 2 楼的正文。",
		});
		store.saveDirectorChapterPlan({
			nodeId: "a2",
			storyId: "s1",
			diffs: [],
			review: {
				promises: [{ lineId: "promise-1", disposition: "carry" }],
				focus: ["main-1", "rel-1"],
			},
		});
		store.appendNode({
			id: "u2",
			storyId: "s1",
			parentId: "a2",
			role: "user",
			raw: "继续",
		});
		store.appendNode({
			id: "a3",
			storyId: "s1",
			parentId: "u2",
			role: "assistant",
			raw: "第 3 楼的正文。",
		});
		store.appendNode({
			id: "u3",
			storyId: "s1",
			parentId: "a3",
			role: "user",
			raw: "我把信烧了",
		});
		store.appendNode({
			id: "a4",
			storyId: "s1",
			parentId: "u3",
			role: "assistant",
			raw: "第 4 楼的正文。",
		});
		store.appendNode({
			id: "a5",
			storyId: "s1",
			parentId: "a4",
			role: "assistant",
			raw: "第 5 楼的正文。",
		});
		endScene(store, "a5");
		setChapterFloors(store, 3);
		const { client, requests } = createFakeClient([PLAN]);

		await createChapterPlanHandler()({ store, client, job: job() });

		const prompt = requests[0]?.messages[1]?.content ?? "";
		expect(prompt).toContain("这一章玩家造成的变化");
		expect(prompt).toContain("我把信烧了");
		expect(prompt).not.toContain("上一章我把剑扔进了河里");
		expect(prompt).not.toContain("继续");
	});

	it("玩家的变化可以让线了结、转向或作废，清点按模型输出重排剧情线", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "第 1 楼的正文。",
		});
		store.saveDirectorLines({
			nodeId: "a1",
			storyId: "s1",
			diffs: [
				{
					action: "set",
					line: {
						id: "main-1",
						kind: "main",
						who: "卫宫",
						want: "阻止仪式",
						obstacle: "时间只剩一夜",
						countdown: 6,
						preparations: [],
					},
				},
				{
					action: "set",
					line: {
						id: "promise-1",
						kind: "promise",
						who: "凛",
						want: "拿回那封信",
						obstacle: "信在管家手里",
						countdown: null,
						preparations: [],
					},
				},
				{
					action: "set",
					line: {
						id: "rel-1",
						kind: "relationship",
						who: "凛",
						want: "与卫宫并肩",
						obstacle: "两人还没有互信",
						countdown: null,
						preparations: [],
					},
				},
				{
					action: "set",
					line: {
						id: "opp-1",
						kind: "opposition",
						who: "管家",
						want: "守住那封信",
						obstacle: "凛已经起疑",
						countdown: null,
						preparations: [],
					},
				},
			],
		});
		seedChainAfterA1(store, "a1");
		endScene(store, "a5");
		setChapterFloors(store, 3);
		const reshaping = JSON.stringify({
			lines: [
				{ action: "delete", id: "main-1" },
				{
					action: "set",
					line: {
						id: "rel-1",
						kind: "relationship",
						who: "凛",
						want: "留在城里陪卫宫",
						obstacle: "管家的眼线还在",
						countdown: null,
						preparations: [],
					},
				},
			],
			review: {
				promises: [{ lineId: "promise-1", disposition: "retire" }],
				focus: ["rel-1", "opp-1"],
			},
		});
		const { client } = createFakeClient([reshaping]);

		await createChapterPlanHandler()({ store, client, job: job() });

		const states = store.readDirectorLineStates("a5");
		const byId = new Map(
			states.map((state) => [state.line.id, state] as const),
		);
		expect([...byId.keys()].sort()).toEqual(["opp-1", "rel-1"]);
		expect(byId.get("rel-1")?.line.want).toBe("留在城里陪卫宫");
		expect(store.getDirectorChapterReview("a5")?.payload.focus).toEqual([
			"rel-1",
			"opp-1",
		]);
	});

	it("补写的铺垫仍受未兑现伏笔上限约束，超限时整批不写", async () => {
		const { store } = openTempStore();
		seedChain(store);
		seedLines(store);
		seedBlueprint(store, ["拿到通行证", "认识守卫"]);
		endScene(store, "a5");
		setChapterFloors(store, 3);
		store.updateStorySettings("s1", {
			directorConfig: {
				...DEFAULT_DIRECTOR_CONFIG,
				chapterFloors: 3,
				maxOpenPromises: 0,
			},
		});
		const { client } = createFakeClient([PLAN]);

		await expect(
			createChapterPlanHandler()({ store, client, job: job() }),
		).rejects.toThrow("超过上限");
		expect(store.getDirectorChapterReview("a5")).toBeNull();
		expect(store.getDirectorLines("a5")).toBeNull();
	});
});
