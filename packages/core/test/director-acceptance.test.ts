import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	DEFAULT_DIRECTOR_CONFIG,
	DIRECTOR_SUFFIX_NOTE,
	type DirectorPlan,
	type LlmCallOptions,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type StoryStore,
	createDefaultContextTemplate,
	createDirectorSlotProvider,
	createEventStream,
	createHistorySlotProvider,
	createSettleHandler,
	evaluateDirector,
	generateCandidateActions,
	mergePlannedArcs,
	replaceDirectorPlan,
	resolveCurrentBeat,
	runChatTurn,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_NOW = Date.UTC(2026, 10, 8, 12, 0, 0);

const PLAN: DirectorPlan = {
	arcs: [
		{
			id: "arc-1",
			title: "开学",
			throughLine: "凛必须说出真相",
			difficulty: 0.4,
			redLines: [],
			sequences: [
				{
					id: "seq-1",
					title: "相遇",
					beats: [
						{
							id: "beat-1",
							goal: "确认来意",
							entrySigns: ["凛堵在门口"],
							fitPoints: ["凛盯着你"],
						},
						{
							id: "beat-2",
							goal: "让凛松口",
							entrySigns: ["凛移开视线"],
							fitPoints: ["你提到旧事"],
						},
					],
				},
				{
					id: "seq-2",
					title: "对峙",
					beats: [
						{
							id: "beat-3",
							goal: "逼出证词",
							entrySigns: ["凛握紧袖口"],
							fitPoints: ["桌上的录音笔"],
						},
					],
				},
			],
		},
	],
};

const USAGE = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
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
		usage: USAGE,
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

/** 正文模型：记录请求，按固定正文回复。 */
function createWriterClient(): {
	readonly client: LlmStreamingClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const client: LlmStreamingClient = {
		async complete(request) {
			requests.push(request);
			return llmResult("凛看着我。");
		},
		stream(request: LlmRequest, _options?: LlmCallOptions) {
			requests.push(request);
			return createEventStream(async (emit) => {
				emit({ type: "text_delta", delta: "凛看着我。" });
				return llmResult("凛看着我。");
			});
		},
	};
	return { client, requests };
}

/** 后台模型：记录请求，按脚本返回文本；脚本用完后再调用直接失败。 */
function createScriptedClient(replies: readonly string[]): {
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

function settleJob(nodeId: string): BackgroundJob {
	return {
		id: 1,
		storyId: "s1",
		nodeId,
		kind: "settle",
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: new Date(FIXED_NOW).toISOString(),
		startedAt: new Date(FIXED_NOW).toISOString(),
		finishedAt: null,
	};
}

function promptText(request: LlmRequest | undefined): string {
	return (request?.messages ?? []).map((message) => message.content).join("\n");
}

function lastUserMessage(request: LlmRequest | undefined): string {
	const users = (request?.messages ?? []).filter(
		(message) => message.role === "user",
	);
	return users.at(-1)?.content ?? "";
}

function candidateReply(texts: readonly string[], sceneChange: string): string {
	return JSON.stringify({ actions: texts, sceneChange });
}

const CANDIDATE_REPLIES = [
	candidateReply(
		["我把门反锁。", "我问凛昨晚在哪。", "我拉开椅子坐下。", "我看向窗外。"],
		"我走到走廊尽头。",
	),
	candidateReply(
		[
			"我提起那件旧事。",
			"我把录音笔放到桌上。",
			"我低声叫她的名字。",
			"我后退半步。",
		],
		"我关掉灯。",
	),
	candidateReply(
		[
			"我按下录音键。",
			"我翻开桌上的笔记本。",
			"我问她袖口里的东西。",
			"我起身挡住门口。",
		],
		"我推开天台的门。",
	),
	candidateReply(
		[
			"我收拾桌上的纸。",
			"我问她要不要喝水。",
			"我坐回原位。",
			"我说我们谈谈别的。",
		],
		"我离开教学楼。",
	),
	candidateReply(
		[
			"我看向门口。",
			"我问她还有没有要说的话。",
			"我合上笔记本。",
			"我把外套披上。",
		],
		"我走进雨里。",
	),
];

const template = createDefaultContextTemplate({
	structuredOutput: "text-tags",
});

function directorProviders(store: StoryStore) {
	return {
		history: createHistorySlotProvider(store),
		// R4 验收的是方案与序列引擎；新故事的库默认是线与动作（ADR-0161）。
		director: createDirectorSlotProvider(store, {
			organization: "mechanisms",
			config: store.getStorySettings("s1").directorConfig,
			when: "always",
		}),
	};
}

describe("R4 验收：五轮导演链路", () => {
	it("计划、拍选择、注入、落拍与候选行动串成一条链路", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "五轮链路" });
		mergePlannedArcs(store, "s1", PLAN, "model");
		store.updateStorySettings("s1", {
			directorConfig: { ...DEFAULT_DIRECTOR_CONFIG, openingFloors: 0 },
		});
		const writer = createWriterClient();
		const candidates = createScriptedClient(CANDIDATE_REPLIES);

		const expected = [
			{
				beatId: "beat-1",
				goal: "确认来意",
				sign: "凛堵在门口",
				fit: "凛盯着你",
			},
			{
				beatId: "beat-2",
				goal: "让凛松口",
				sign: "凛移开视线",
				fit: "你提到旧事",
			},
			{
				beatId: "beat-3",
				goal: "逼出证词",
				sign: "凛握紧袖口",
				fit: "桌上的录音笔",
			},
		];
		const assistantIds: string[] = [];
		let previousCandidates: string[] = [];
		const allCandidateTexts: string[] = [];

		for (let round = 1; round <= 5; round += 1) {
			const candidateBefore = candidates.requests.length;
			const result = await runChatTurn({
				store,
				client: writer.client,
				storyId: "s1",
				userText: `第 ${round} 轮输入。`,
				template,
				providers: directorProviders(store),
				budgetTokens: 4_096,
				structuredOutput: "text-tags",
				model: "fake",
			});
			assistantIds.push(result.node.id);

			// 上一轮写下的候选正文不进入本轮组装的上下文。
			for (const text of previousCandidates) {
				expect(promptText(writer.requests[round - 1])).not.toContain(text);
			}

			// 导演评估不产生任何模型调用，只有正文那一次。
			expect(writer.requests).toHaveLength(round);
			expect(candidates.requests).toHaveLength(candidateBefore);

			const decision = store.getDirectorDecision(result.userNode.id);
			const request = writer.requests[round - 1];
			const directive = decision?.directive ?? "";
			const beat = expected[round - 1];

			if (beat !== undefined) {
				expect(directive).toContain(beat.goal);
				expect(directive).toContain(beat.sign);
				expect(directive).toContain(beat.fit);
				expect(decision?.signals.beat).toMatchObject({
					beatId: beat.beatId,
					intensity: "natural",
					usedFitPoints: [beat.fit],
				});
				const lastUser = lastUserMessage(request);
				expect(lastUser.startsWith(`第 ${round} 轮输入。`)).toBe(true);
				expect(lastUser).toContain(`【导演】${directive}`);
				expect(lastUser.endsWith(DIRECTOR_SUFFIX_NOTE)).toBe(true);
			} else {
				expect(directive).not.toContain("确认来意");
				expect(directive).not.toContain("让凛松口");
				expect(directive).not.toContain("逼出证词");
				expect(decision?.signals.beat).toMatchObject({ beatId: null });
			}

			// 落拍：每次只结算本轮的新楼层，整窗一次请求。
			const reply =
				beat === undefined
					? JSON.stringify([{ nodeId: result.node.id, diffs: [] }])
					: JSON.stringify([
							{ nodeId: result.node.id, diffs: [], beatCompleted: true },
						]);
			const settle = createScriptedClient([reply]);
			await createSettleHandler()({
				store,
				client: settle.client,
				job: settleJob(result.node.id),
			});
			expect(settle.requests).toHaveLength(1);
			const settlePrompt = promptText(settle.requests[0]);
			if (beat !== undefined) {
				expect(settlePrompt).toContain(
					`当前拍：${beat.beatId}（目标：${beat.goal}）`,
				);
				expect(settlePrompt).toContain("beatCompleted");
				expect(store.getDirectorBeatState(result.node.id)).toMatchObject({
					beatId: beat.beatId,
					completed: true,
				});
			} else {
				expect(settlePrompt).not.toContain("当前拍");
				expect(settlePrompt).not.toContain("beatCompleted");
				expect(store.getDirectorBeatState(result.node.id)).toBeNull();
			}

			// 候选行动：间隙里一次调用，写入 4 条行动加 1 条场景变化。
			await generateCandidateActions({
				store,
				client: candidates.client,
				storyId: "s1",
				nodeId: result.node.id,
			});
			const actions = store.listDirectorCandidateActions(result.node.id);
			expect(actions.map((action) => action.kind)).toEqual([
				"action",
				"action",
				"action",
				"action",
				"scene_change",
			]);
			previousCandidates = actions.map((action) => action.text);
			for (const text of previousCandidates) {
				allCandidateTexts.push(text);
			}
		}

		expect(writer.requests).toHaveLength(5);
		expect(candidates.requests).toHaveLength(5);
		const lastId = assistantIds[4] as string;
		expect(store.listDirectorCandidateActions(lastId)).toHaveLength(5);
		// 任何一轮写下的候选正文都没有进入任何一轮的上下文。
		for (const request of writer.requests) {
			const prompt = promptText(request);
			for (const text of allCandidateTexts) {
				expect(prompt).not.toContain(text);
			}
		}
		expect(resolveCurrentBeat(store, "s1", lastId)).toBeNull();
	}, 60_000);
});

describe("R4 验收：玩家控制与注入模式", () => {
	it("关闭导演时没有决策记录，也没有指令注入", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "关闭导演" });
		mergePlannedArcs(store, "s1", PLAN, "model");
		const writer = createWriterClient();
		const config = {
			...DEFAULT_DIRECTOR_CONFIG,
			mode: "off" as const,
			openingFloors: 0,
		};

		const result = await runChatTurn({
			store,
			client: writer.client,
			storyId: "s1",
			userText: "我看着她。",
			template,
			providers: {
				history: createHistorySlotProvider(store),
				director: createDirectorSlotProvider(store, {
					organization: "mechanisms",
					config,
					when: "always",
				}),
			},
			budgetTokens: 4_096,
			structuredOutput: "text-tags",
		});

		expect(store.getDirectorDecision(result.userNode.id)).toBeNull();
		expect(promptText(writer.requests[0])).not.toContain("【导演】");
		expect(
			result.trace.context.entries.some(
				(entry) => entry.appendedTo === "last-user",
			),
		).toBe(false);
	}, 30_000);

	it("盲盒模式照常注入，只是面向玩家的接口隐藏指令", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "盲盒" });
		mergePlannedArcs(store, "s1", PLAN, "model");
		const writer = createWriterClient();
		const config = {
			...DEFAULT_DIRECTOR_CONFIG,
			mode: "blind" as const,
			openingFloors: 0,
		};
		store.updateStorySettings("s1", { directorConfig: config });

		const result = await runChatTurn({
			store,
			client: writer.client,
			storyId: "s1",
			userText: "我看着她。",
			template,
			providers: {
				history: createHistorySlotProvider(store),
				director: createDirectorSlotProvider(store, {
					organization: "mechanisms",
					config,
					when: "always",
				}),
			},
			budgetTokens: 4_096,
			structuredOutput: "text-tags",
		});

		const decision = store.getDirectorDecision(result.userNode.id);
		expect(decision?.directive).toContain("确认来意");
		expect(lastUserMessage(writer.requests[0])).toContain(
			`【导演】${decision?.directive}`,
		);
	}, 30_000);

	it("玩家整份替换后来源为 player，合并只追加不覆盖", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "玩家编辑" });
		replaceDirectorPlan(store, "s1", PLAN);
		const entries = store.listDirectorPlanEntries("s1");
		expect(entries.arcs.every((row) => row.source === "player")).toBe(true);
		expect(entries.sequences.every((row) => row.source === "player")).toBe(
			true,
		);
		expect(entries.beats.every((row) => row.source === "player")).toBe(true);

		const arc = PLAN.arcs[0];
		const sequence = arc?.sequences[0];
		if (arc === undefined || sequence === undefined) {
			throw new Error("测试计划缺少弧线或序列");
		}
		mergePlannedArcs(
			store,
			"s1",
			{
				arcs: [
					{
						...arc,
						throughLine: "模型改写的贯穿线",
						sequences: [
							{
								...sequence,
								id: "seq-3",
								title: "模型追加",
								beats: [
									{
										id: "beat-4",
										goal: "追加的拍",
										entrySigns: ["门外安静下来"],
										fitPoints: ["你停下脚步"],
									},
								],
							},
						],
					},
				],
			},
			"model",
		);

		const plan = store.listDirectorPlanEntries("s1");
		expect(plan.arcs[0]?.source).toBe("player");
		expect(plan.sequences.map((row) => row.id).sort()).toEqual([
			"seq-1",
			"seq-2",
			"seq-3",
		]);
		expect(store.listDirectorPlanEntries("s1").arcs[0]?.throughLine).toBe(
			"凛必须说出真相",
		);
	});
});

describe("R4 验收：短线层零调用与具体建议", () => {
	it("评估本身不调用模型，建议逐字引用计划里的人与事", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "只读评估" });
		mergePlannedArcs(store, "s1", PLAN, "model");
		store.appendNode({
			id: "u1",
			storyId: "s1",
			parentId: null,
			role: "user",
			raw: "我推门进去。",
		});

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: "u1",
			config: { ...DEFAULT_DIRECTOR_CONFIG, openingFloors: 0 },
		});

		expect(suggestion?.mechanism).toBe("beat");
		expect(suggestion?.directive).toContain("确认来意");
		expect(suggestion?.directive).toContain("凛堵在门口");
		expect(suggestion?.directive).toContain("凛盯着你");
		expect(store.getDirectorDecision("u1")?.signals.beat).toMatchObject({
			arcId: "arc-1",
			sequenceId: "seq-1",
			beatId: "beat-1",
		});
	});
});
