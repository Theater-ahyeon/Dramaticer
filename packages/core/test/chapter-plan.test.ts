import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	chapterPlanNeedsRun,
	createChapterPlanHandler,
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
});
