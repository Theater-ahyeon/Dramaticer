import { describe, expect, it } from "vitest";
import {
	CANDIDATE_ACTIONS_JOB_KIND,
	type DirectorPlan,
	type LlmCallOptions,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type StoryStore,
	buildCandidateActionsUserContent,
	collectCandidateActionsInput,
	createBackgroundJobRegistry,
	createCandidateActionsHandler,
	createDefaultBackgroundJobRegistry,
	createDefaultContextTemplate,
	createEventStream,
	createHistorySlotProvider,
	createStateSlotProvider,
	drainBackgroundJobs,
	generateCandidateActions,
	parseCandidateActionsResponse,
	replaceDirectorPlan,
	runActionsCli,
	runChatTurn,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_NOW = Date.UTC(2026, 10, 8, 12, 0, 0);

const USAGE = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

const PLAN: DirectorPlan = {
	arcs: [
		{
			id: "arc-1",
			title: "徽章",
			throughLine: "必须查明徽章的来历",
			difficulty: 0.4,
			redLines: [],
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

const VALID_REPLY = JSON.stringify({
	actions: [
		"我按住徽章，问凛它从哪里来。",
		"我走到窗边，听门外的脚步声。",
		"我把书合上，等凛先开口。",
		"我低声说，我知道你在藏什么。",
	],
	sceneChange: "我转身离开图书室，走进走廊。",
});

function llmResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: USAGE,
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

/** 一个玩家楼层后接一个助手楼层；台账素材写在助手楼层上。 */
function seedStory(store: StoryStore): {
	readonly u1: string;
	readonly a2: string;
} {
	store.createStory({ id: "s1", title: "候选行动" });
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: null,
		role: "user",
		raw: "我推开图书室的门。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "凛抬头看了我一眼，手里捏着一枚徽章。",
	});
	store.appendStateDiffs([
		{
			storyId: "s1",
			nodeId: "a2",
			path: ["relation", "凛", "你", "type"],
			op: "set",
			value: "同盟",
			source: "model",
		},
		{
			storyId: "s1",
			nodeId: "a2",
			path: ["clue", "c1", "text"],
			op: "set",
			value: "查明徽章来历",
			source: "model",
		},
		{
			storyId: "s1",
			nodeId: "a2",
			path: ["clue", "c1", "status"],
			op: "set",
			value: "open",
			source: "model",
		},
	]);
	replaceDirectorPlan(store, "s1", PLAN);
	store.saveDirectorBeatState({
		nodeId: "a2",
		storyId: "s1",
		beatId: "beat-1",
		completed: false,
	});
	return { u1: "u1", a2: "a2" };
}

const registry = createBackgroundJobRegistry({
	[CANDIDATE_ACTIONS_JOB_KIND]: {
		handler: createCandidateActionsHandler(),
		enqueue: "settled",
		tier: "gap",
	},
});

describe("候选行动解析", () => {
	it("接受 4 条行动加 1 条场景变化并去掉首尾空白", () => {
		const parsed = parseCandidateActionsResponse(
			JSON.stringify({
				actions: [" 行动一 ", "行动二", "行动三", "行动四"],
				sceneChange: "  场景变化  ",
			}),
		);
		expect(parsed.actions).toEqual(["行动一", "行动二", "行动三", "行动四"]);
		expect(parsed.sceneChange).toBe("场景变化");
	});

	it("未知字段、条数不符、空字符串与重复正文整批拒绝", () => {
		const valid = {
			actions: ["行动一", "行动二", "行动三", "行动四"],
			sceneChange: "场景变化",
		};
		expect(() =>
			parseCandidateActionsResponse(
				JSON.stringify({ ...valid, extra: "多出来" }),
			),
		).toThrow("未知字段");
		expect(() =>
			parseCandidateActionsResponse(
				JSON.stringify({ ...valid, actions: ["行动一", "行动二", "行动三"] }),
			),
		).toThrow("必须正好 4 条");
		expect(() =>
			parseCandidateActionsResponse(
				JSON.stringify({
					...valid,
					actions: ["行动一", " ", "行动三", "行动四"],
				}),
			),
		).toThrow("不能是空字符串");
		expect(() =>
			parseCandidateActionsResponse(
				JSON.stringify({
					...valid,
					actions: ["行动一", "行动二", "行动一", "行动四"],
				}),
			),
		).toThrow("重复");
		expect(() =>
			parseCandidateActionsResponse(
				JSON.stringify({ ...valid, sceneChange: "行动三" }),
			),
		).toThrow("重复");
		expect(() =>
			parseCandidateActionsResponse(
				JSON.stringify({
					...valid,
					actions: ["行动一", 2, "行动三", "行动四"],
				}),
			),
		).toThrow("必须是字符串");
	});
});

describe("候选行动输入", () => {
	it("只取最近 3 楼原文，并带上当前拍、强度、线索与关系", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "窗口" });
		const ids: string[] = ["a1"];
		store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "旧楼层一。",
		});
		for (let index = 2; index <= 5; index += 1) {
			const parent = ids[ids.length - 1] as string;
			const id = `n${index}`;
			store.appendNode({
				id,
				storyId: "s1",
				parentId: parent,
				role: index % 2 === 0 ? "user" : "assistant",
				raw: `楼层${index}。`,
			});
			ids.push(id);
		}
		replaceDirectorPlan(store, "s1", PLAN);
		const input = collectCandidateActionsInput(store, "s1", "n5");
		if (input === null) throw new Error("应该收集到候选行动的输入");
		expect(input.floors.map((floor) => floor.id)).toEqual(["n3", "n4", "n5"]);
		expect(input.intensity).toBe("natural");
		expect(input.beat?.beat.id).toBe("beat-1");
		const content = buildCandidateActionsUserContent(input);
		expect(content).toContain("楼层3。");
		expect(content).toContain("楼层5。");
		expect(content).not.toContain("楼层2。");
		expect(content).toContain("让凛开口");
	});

	it("没有可读原文时返回 null", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "空楼层" });
		store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "   ",
		});
		expect(collectCandidateActionsInput(store, "s1", "a1")).toBeNull();
		const { client, requests } = createFakeClient([]);
		const result = await generateCandidateActions({
			store,
			client,
			storyId: "s1",
			nodeId: "a1",
		});
		expect(result).toBeNull();
		expect(requests).toHaveLength(0);
	});
});

describe("候选行动后台任务", () => {
	it("写入 4 条行动与 1 条场景变化，顺序固定为行动在前", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([VALID_REPLY]);
		const result = await drainBackgroundJobs({
			store,
			registry,
			client,
			storyId: "s1",
			kinds: [CANDIDATE_ACTIONS_JOB_KIND],
			now: () => FIXED_NOW,
		});
		expect(result.enqueued).toBe(1);
		expect(result.runs.map((run) => run.status)).toEqual(["done"]);
		expect(requests).toHaveLength(1);
		const content = requests[0]?.messages
			.map((message) => message.content)
			.join("\n");
		for (const fragment of [
			"当前强度：natural",
			"让凛开口",
			"凛合上书",
			"查明徽章来历",
			"凛 → 你：类型 同盟",
			"凛抬头看了我一眼",
		]) {
			expect(content).toContain(fragment);
		}
		const actions = store.listDirectorCandidateActions("a2");
		expect(actions.map((action) => action.kind)).toEqual([
			"action",
			"action",
			"action",
			"action",
			"scene_change",
		]);
		expect(actions.map((action) => action.ordinal)).toEqual([0, 1, 2, 3, 4]);
		expect(actions[4]?.text).toBe("我转身离开图书室，走进走廊。");
	});

	it("重复执行替换旧候选，行数不变", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.replaceDirectorCandidateActions({
			storyId: "s1",
			nodeId: "a2",
			actions: [
				{ kind: "action", text: "旧行动一" },
				{ kind: "action", text: "旧行动二" },
				{ kind: "action", text: "旧行动三" },
				{ kind: "action", text: "旧行动四" },
				{ kind: "scene_change", text: "旧场景变化" },
			],
		});
		const { client } = createFakeClient([VALID_REPLY]);
		await generateCandidateActions({
			store,
			client,
			storyId: "s1",
			nodeId: "a2",
		});
		const actions = store.listDirectorCandidateActions("a2");
		expect(actions).toHaveLength(5);
		expect(actions.map((action) => action.text)).not.toContain("旧行动一");
	});

	it("非法输出整批拒绝，不写入任何行，任务退回重试", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([
			JSON.stringify({ actions: ["只有一条"], sceneChange: "场景变化" }),
		]);
		const result = await drainBackgroundJobs({
			store,
			registry,
			client,
			storyId: "s1",
			kinds: [CANDIDATE_ACTIONS_JOB_KIND],
			now: () => FIXED_NOW,
		});
		expect(result.runs.map((run) => run.status)).toEqual(["pending"]);
		expect(store.listDirectorCandidateActions("a2")).toEqual([]);
		const jobs = store.listBackgroundJobs({
			storyId: "s1",
			kinds: [CANDIDATE_ACTIONS_JOB_KIND],
		});
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.status).toBe("pending");
		expect(jobs[0]?.attempts).toBe(1);
	});

	it("短间隙就执行（gap 档），并使用规划器客户端", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client: plannerClient, requests } = createFakeClient([VALID_REPLY]);
		const defaultRegistry = createDefaultBackgroundJobRegistry({
			plannerClient,
		});
		const result = await drainBackgroundJobs({
			store,
			registry: defaultRegistry,
			client: throwingClient,
			storyId: "s1",
			kinds: [CANDIDATE_ACTIONS_JOB_KIND],
			gapSeconds: 0,
			now: () => FIXED_NOW,
		});
		expect(result.runs.map((run) => run.status)).toEqual(["done"]);
		expect(requests).toHaveLength(1);
		expect(store.listDirectorCandidateActions("a2")).toHaveLength(5);
	});

	it("候选按楼层读取，另一分支的楼层没有候选", () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendNode({
			id: "b2",
			storyId: "s1",
			parentId: "u1",
			role: "assistant",
			raw: "另一个分支的回复。",
		});
		store.replaceDirectorCandidateActions({
			storyId: "s1",
			nodeId: "a2",
			actions: [
				{ kind: "action", text: "甲" },
				{ kind: "action", text: "乙" },
				{ kind: "action", text: "丙" },
				{ kind: "action", text: "丁" },
				{ kind: "scene_change", text: "戊" },
			],
		});
		expect(store.listDirectorCandidateActions("b2")).toEqual([]);
		expect(store.listDirectorCandidateActions("a2")).toHaveLength(5);
	});
});

describe("候选行动不进上下文", () => {
	it("下一轮组装的消息里没有候选正文，写入方只调用一次", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.replaceDirectorCandidateActions({
			storyId: "s1",
			nodeId: "a2",
			actions: [
				{ kind: "action", text: "把断剑插进石缝" },
				{ kind: "action", text: "问凛要不要一起走" },
				{ kind: "action", text: "退到门边查看走廊" },
				{ kind: "action", text: "把徽章放回桌上" },
				{ kind: "scene_change", text: "连夜离开图书室" },
			],
		});
		const requests: LlmRequest[] = [];
		const client: LlmStreamingClient = {
			async complete() {
				return llmResult("新风。");
			},
			stream(request: LlmRequest, _options?: LlmCallOptions) {
				requests.push(request);
				return createEventStream(async (emit) => {
					emit({ type: "text_delta", delta: "新风。" });
					return llmResult("新风。");
				});
			},
		};
		await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我点点头。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: {
				history: createHistorySlotProvider(store, { limit: 10 }),
				state: createStateSlotProvider(store),
			},
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			model: "fake",
		});
		expect(requests).toHaveLength(1);
		const prompt = requests[0]?.messages
			.map((message) => message.content)
			.join("\n");
		expect(prompt).not.toContain("把断剑插进石缝");
		expect(prompt).not.toContain("连夜离开图书室");
	});
});

describe("actions 命令行", () => {
	it("按楼层列出候选，--json 输出原始记录", () => {
		const { store, path } = openTempStore();
		seedStory(store);
		store.replaceDirectorCandidateActions({
			storyId: "s1",
			nodeId: "a2",
			actions: [
				{ kind: "action", text: "甲" },
				{ kind: "action", text: "乙" },
				{ kind: "action", text: "丙" },
				{ kind: "action", text: "丁" },
				{ kind: "scene_change", text: "戊" },
			],
		});
		const lines: string[] = [];
		const result = runActionsCli(["actions", "--node", "a2", "--db", path], {
			log: (message) => lines.push(message),
		});
		expect(result.storyId).toBe("s1");
		expect(result.actions).toHaveLength(5);
		expect(lines.join("\n")).toContain("5. [场景变化] 戊");

		const jsonLines: string[] = [];
		runActionsCli(["actions", "--node", "a2", "--db", path, "--json"], {
			log: (message) => jsonLines.push(message),
		});
		const parsed = JSON.parse(jsonLines.join("\n")) as unknown[];
		expect(parsed).toHaveLength(5);
	});
});
