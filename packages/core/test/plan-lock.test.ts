import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type DirectorActionConfig,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	createChapterPlanHandler,
	createSceneLogHandler,
	editSceneGoal,
	readDirectorActionInput,
	readEditHistory,
	readSceneGoal,
	rollbackPlayerEdit,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const ACTION_CONFIG: DirectorActionConfig = {
	stallFloors: DEFAULT_DIRECTOR_CONFIG.stallFloors,
	clueAgeWarning: DEFAULT_DIRECTOR_CONFIG.clueAgeWarning,
	tensionStateDiffsPerFloor: DEFAULT_DIRECTOR_CONFIG.tensionStateDiffsPerFloor,
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
			if (reply === undefined) throw new Error("假客户端没有更多回复");
			return llmResult(reply);
		},
	};
	return { client, requests };
}

function seedChain(store: StoryStore, floors = 5): void {
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

function saveLines(store: StoryStore): void {
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

function chapterJob() {
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

function sceneJob(nodeId: string) {
	return {
		id: 1,
		storyId: "s1",
		nodeId,
		kind: "scene_log",
		status: "running" as const,
		attempts: 1,
		lastError: null,
		createdAt: "2026-11-14T12:00:00.000Z",
		startedAt: "2026-11-14T12:00:00.000Z",
		finishedAt: null,
	};
}

const LOCKED_PLAN = JSON.stringify({
	lines: [
		{
			action: "set",
			line: {
				id: "main-1",
				kind: "main",
				who: "卫宫",
				want: "毁掉钟楼",
				obstacle: "仪式已经开始",
				countdown: 2,
				preparations: [],
			},
		},
		{
			action: "set",
			line: {
				id: "promise-1",
				kind: "promise",
				who: "凛",
				want: "把信烧掉",
				obstacle: "信在管家手里",
				countdown: null,
				preparations: [],
			},
		},
	],
	review: {
		promises: [{ lineId: "promise-1", disposition: "carry" }],
		focus: ["main-1", "rel-1"],
	},
});

describe("规划的出处、锁定与回滚", () => {
	it("锁定的剧情线与伏笔不被章级规划覆盖，AI 的写法留作建议", async () => {
		const store = openStore();
		seedChain(store);
		saveLines(store);
		store.savePlayerEdit({
			storyId: "s1",
			nodeId: "a3",
			kind: "line",
			target: "main-1",
			value: {
				id: "main-1",
				kind: "main",
				who: "卫宫",
				want: "保护凛",
				obstacle: "时间只剩一夜",
				countdown: 6,
				preparations: [],
			},
			locked: true,
		});
		store.savePlayerEdit({
			storyId: "s1",
			nodeId: "a3",
			kind: "line",
			target: "promise-1",
			value: {
				id: "promise-1",
				kind: "promise",
				who: "凛",
				want: "亲手交还那封信",
				obstacle: "信在管家手里",
				countdown: null,
				preparations: [],
			},
			locked: true,
		});
		endScene(store, "a5");
		store.updateStorySettings("s1", {
			directorConfig: { ...DEFAULT_DIRECTOR_CONFIG, chapterFloors: 3 },
		});
		const { client } = createFakeClient([LOCKED_PLAN]);

		await createChapterPlanHandler()({
			store,
			client,
			job: chapterJob(),
		});

		const lines = new Map(
			store
				.readDirectorLineStates("a5")
				.map((state) => [state.line.id, state.line] as const),
		);
		expect(lines.get("main-1")?.want).toBe("保护凛");
		expect(lines.get("promise-1")?.want).toBe("亲手交还那封信");
		const mainHistory = readEditHistory(store, "s1", "a5", "line", "main-1");
		expect(mainHistory.at(-1)?.source).toBe("rejected");
		expect(mainHistory.at(-1)?.value).toMatchObject({ want: "毁掉钟楼" });
		const promiseHistory = readEditHistory(
			store,
			"s1",
			"a5",
			"line",
			"promise-1",
		);
		expect(promiseHistory.at(-1)?.source).toBe("rejected");
		expect(promiseHistory.at(-1)?.value).toMatchObject({ want: "把信烧掉" });
	});

	it("回滚剧情线后导演按恢复的内容做选择", () => {
		const store = openStore();
		seedChain(store, 1);
		store.appendNode({
			id: "u1",
			storyId: "s1",
			parentId: "a1",
			role: "user",
			raw: "我走进钟楼。",
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
			],
		});
		const first = store.savePlayerEdit({
			storyId: "s1",
			nodeId: "u1",
			kind: "line",
			target: "main-1",
			value: {
				id: "main-1",
				kind: "main",
				who: "卫宫",
				want: "先把凛送走",
				obstacle: "时间只剩一夜",
				countdown: 6,
				preparations: [],
			},
			locked: true,
		});
		store.savePlayerEdit({
			storyId: "s1",
			nodeId: "u1",
			kind: "line",
			target: "main-1",
			value: {
				id: "main-1",
				kind: "main",
				who: "卫宫",
				want: "炸掉钟楼",
				obstacle: "时间只剩一夜",
				countdown: 6,
				preparations: [],
			},
			locked: true,
		});

		const before = readDirectorActionInput(store, "s1", "u1", ACTION_CONFIG);
		expect(before.lines[0]?.line.want).toBe("炸掉钟楼");

		rollbackPlayerEdit(store, "s1", "u1", first.id);

		const after = readDirectorActionInput(store, "s1", "u1", ACTION_CONFIG);
		expect(after.lines[0]?.line.want).toBe("先把凛送走");
	});

	it("本场目标标明出处与锁定，导演按回滚后的目标接球", () => {
		const store = openStore();
		seedChain(store, 1);
		store.appendNode({
			id: "u1",
			storyId: "s1",
			parentId: "a1",
			role: "user",
			raw: "我留在教室里。",
		});
		store.saveSceneLog({
			nodeId: "a1",
			storyId: "s1",
			beat: "开场",
			present: ["凛"],
			sceneEnds: false,
			sceneCard: {
				present: [{ who: "凛", want: "拿回那封信" }],
				change: "凛离开教室，把信交出去",
			},
			bits: [],
			conditions: [],
			states: [],
			quotes: { submitted: 0, verified: 0 },
			repairs: [],
		});
		const first = editSceneGoal(store, "s1", "u1", {
			present: [{ who: "凛", want: "拿回那封信" }],
			change: "凛把信留在桌上",
		});
		const view = readSceneGoal(store, "s1", "u1");
		expect(view).toEqual({
			nodeId: "a1",
			present: [{ who: "凛", want: "拿回那封信" }],
			change: "凛把信留在桌上",
			source: "player",
			locked: true,
		});
		expect(
			readDirectorActionInput(store, "s1", "u1", ACTION_CONFIG).floors[0]
				?.sceneCard?.change,
		).toBe("凛把信留在桌上");

		editSceneGoal(store, "s1", "u1", {
			present: [{ who: "凛", want: "拿回那封信" }],
			change: "凛烧掉那封信",
		});
		expect(
			readDirectorActionInput(store, "s1", "u1", ACTION_CONFIG).floors[0]
				?.sceneCard?.change,
		).toBe("凛烧掉那封信");

		rollbackPlayerEdit(store, "s1", "u1", first.id);

		const selection = readDirectorActionInput(store, "s1", "u1", ACTION_CONFIG);
		expect(selection.floors[0]?.sceneCard?.change).toBe("凛把信留在桌上");
	});

	it("锁定的本场目标不被场记覆盖，场记写下的目标只留作建议", async () => {
		const store = openStore();
		seedChain(store, 1);
		editSceneGoal(store, "s1", "a1", {
			present: [{ who: "凛", want: "拿回那封信" }],
			change: "凛把信留在桌上",
		});
		const { client } = createFakeClient([
			JSON.stringify({
				beat: "试探",
				states: [],
				present: ["凛"],
				sceneEnds: false,
				sceneCard: {
					present: [{ who: "凛", want: "拿回那封信" }],
					change: "凛烧掉那封信",
				},
			}),
		]);

		await createSceneLogHandler()({
			store,
			client,
			job: sceneJob("a1"),
		});

		expect(readSceneGoal(store, "s1", "a1")?.change).toBe("凛把信留在桌上");
		const history = readEditHistory(store, "s1", "a1", "scene", "a1");
		expect(history.at(-1)?.source).toBe("rejected");
		expect(history.at(-1)?.value).toMatchObject({ change: "凛烧掉那封信" });
	});

	it("大纲回滚后导演按恢复的拉力走", () => {
		const store = openStore();
		seedChain(store, 1);
		store.appendNode({
			id: "u1",
			storyId: "s1",
			parentId: "a1",
			role: "user",
			raw: "我看向窗外。",
		});
		store.saveStoryBlueprint({
			nodeId: "a1",
			storyId: "s1",
			source: "player",
			diffs: [
				{
					action: "set",
					entry: {
						id: "premise",
						kind: "premise",
						source: "player",
						locked: false,
						coreQuestion: "她会不会留下",
						tone: "压抑",
						endings: [],
						redLines: [],
						tension: "tight",
					},
				},
			],
		});
		store.saveStoryBlueprint({
			nodeId: "u1",
			storyId: "s1",
			source: "player",
			diffs: [
				{
					action: "set",
					entry: {
						id: "premise",
						kind: "premise",
						source: "player",
						locked: true,
						coreQuestion: "她会不会留下",
						tone: "压抑",
						endings: [],
						redLines: [],
						tension: "loose",
					},
				},
			],
		});
		expect(
			readDirectorActionInput(store, "s1", "u1", ACTION_CONFIG).tension,
		).toBe("loose");

		store.rollbackStoryBlueprint({
			nodeId: "u1",
			storyId: "s1",
			versionNodeId: "a1",
			versionSeq: 1,
		});

		expect(
			readDirectorActionInput(store, "s1", "u1", ACTION_CONFIG).tension,
		).toBe("tight");
	});
});

function openStore(): StoryStore {
	const { store } = openTempStore();
	return store;
}
