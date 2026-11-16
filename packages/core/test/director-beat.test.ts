import { describe, expect, it } from "vitest";
import {
	BEAT_PRIORITY,
	CLUE_AGE_PRIORITY,
	DEFAULT_DIRECTOR_CONFIG,
	DIRECTOR_SUFFIX_NOTE,
	type DirectorPlan,
	type LlmRequest,
	REPETITION_SCENE_PRIORITY,
	REPETITION_TEXT_PRIORITY,
	type StoryStore,
	createDefaultContextTemplate,
	createDirectorSlotProvider,
	createEventStream,
	createHistorySlotProvider,
	evaluateDirector,
	mergePlannedArcs,
	runChatTurn,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const DIMENSIONS = 1024;

const PLAN: DirectorPlan = {
	arcs: [
		{
			id: "arc-1",
			title: "开学",
			throughLine: "凛必须说出真相",
			difficulty: 0.4,
			redLines: ["不能伤害凛"],
			sequences: [
				{
					id: "seq-1",
					title: "相遇",
					beats: [
						{
							id: "beat-1",
							goal: "确认来意",
							entrySigns: ["凛堵在门口", "门锁响了一声"],
							fitPoints: ["凛盯着你", "门外有脚步声"],
						},
						{
							id: "beat-2",
							goal: "让凛松口",
							entrySigns: ["凛移开视线"],
							fitPoints: ["你提到旧事"],
						},
					],
				},
			],
		},
	],
};

function seed(store: StoryStore, withPlan = true): void {
	store.createStory({ id: "s1", title: "拍测试" });
	if (withPlan) mergePlannedArcs(store, "s1", PLAN, "model");
}

/**
 * 在 s1 上追加一串助手楼层，最后追加一个用户楼层让全部助手楼层已确认。
 * 返回助手楼层 id 与末端用户楼层 id。
 */
function appendChain(
	store: StoryStore,
	count: number,
): { beats: string[]; tail: string } {
	let parentId: string | null = null;
	const beats: string[] = [];
	for (let index = 0; index < count; index += 1) {
		const id = `a${index}`;
		store.appendNode({
			id,
			storyId: "s1",
			parentId,
			role: "assistant",
			raw: `回复 ${index}`,
		});
		beats.push(id);
		parentId = id;
	}
	store.appendNode({
		id: "u-tail",
		storyId: "s1",
		parentId,
		role: "user",
		raw: "最后一句",
	});
	return { beats, tail: "u-tail" };
}

function config(overrides: Partial<typeof DEFAULT_DIRECTOR_CONFIG> = {}) {
	return { ...DEFAULT_DIRECTOR_CONFIG, ...overrides };
}

function angleVector(angle: number): number[] {
	const vector = new Array<number>(DIMENSIONS).fill(0);
	vector[0] = Math.cos(angle);
	vector[1] = Math.sin(angle);
	return vector;
}

/** 让相邻楼层的余弦等于给定序列，用来构造持续上升的重复度。 */
function applySimilarities(
	store: StoryStore,
	beats: readonly string[],
	similarities: readonly number[],
): void {
	let angle = 0;
	const vectors = [angleVector(angle)];
	for (const similarity of similarities) {
		angle += Math.acos(similarity);
		vectors.push(angleVector(angle));
	}
	for (let index = 0; index < beats.length; index += 1) {
		const beatId = beats[index] as string;
		const vector = vectors[index] as number[];
		const chunks = store.listChunksMissingVectors(beatId);
		expect(chunks).toHaveLength(1);
		store.insertChunkVectors(
			chunks.map((chunk) => ({ chunkId: chunk.chunkId, embedding: vector })),
		);
	}
}

function createFakeClient(reply: string) {
	const result = {
		text: reply,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop" as const,
		stopReason: "stop" as const,
		model: "fake-model",
		channel: "fake-channel",
		usage: {
			promptTokens: 1,
			completionTokens: 1,
			totalTokens: 2,
			reasoningTokens: 0,
			cachedTokens: 0,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: { text: reply, reasoning: "" },
	};
	return {
		async complete() {
			return result;
		},
		stream() {
			return createEventStream(async (emit) => {
				emit({ type: "text_delta", delta: reply });
				return result;
			});
		},
	};
}

describe("短线层拍建议", () => {
	it("计划存在时指令给出当前拍的目标、起始迹象与契合点", () => {
		const { store } = openTempStore();
		seed(store);
		const { tail } = appendChain(store, 1);

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: tail,
			config: DEFAULT_DIRECTOR_CONFIG,
		});

		expect(suggestion?.mechanism).toBe("beat");
		expect(suggestion?.priority).toBe(BEAT_PRIORITY);
		const directive = suggestion?.directive ?? "";
		expect(directive).toContain("确认来意");
		expect(directive).toContain("凛堵在门口");
		expect(directive).toContain("门锁响了一声");
		expect(directive).toContain("凛盯着你");
		expect(directive).toContain("门外有脚步声");
		expect(directive).not.toContain("本楼必须出现可见变化");

		const decision = store.getDirectorDecision(tail);
		expect(decision?.signals.beat).toEqual({
			arcId: "arc-1",
			sequenceId: "seq-1",
			beatId: "beat-1",
			intensity: "natural",
			difficulty: 0.4,
			usedFitPoints: ["凛盯着你", "门外有脚步声"],
			floorDepth: 1,
		});
	}, 20_000);

	it("三档强度分别只给目标与迹象、加契合点、加可见变化要求", () => {
		const { store } = openTempStore();
		seed(store);
		const { tail } = appendChain(store, 1);

		const setup = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: tail,
			config: config({ intensity: "setup" }),
		});
		expect(setup?.directive).toContain("确认来意");
		expect(setup?.directive).toContain("凛堵在门口");
		expect(setup?.directive).not.toContain("契合点");
		expect(setup?.directive).not.toContain("可见变化");
		expect(store.getDirectorDecision(tail)?.signals.beat).toMatchObject({
			intensity: "setup",
			usedFitPoints: [],
		});

		const natural = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: tail,
			config: config({ intensity: "natural" }),
		});
		expect(natural?.directive).toContain("契合点");
		expect(natural?.directive).not.toContain("可见变化");

		const detonate = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: tail,
			config: config({ intensity: "detonate" }),
		});
		const directive = detonate?.directive ?? "";
		expect(directive).toContain("本楼必须出现可见变化");
		expect(directive).toContain("可选方向");
		expect(directive).toContain("直接推进目标：让「确认来意」在本楼有结果");
		expect(directive).toContain("让起始迹象当场出现：凛堵在门口");
		expect(directive).toContain("用契合点引爆冲突：凛盯着你");
		expect(store.getDirectorDecision(tail)?.signals.beat).toMatchObject({
			intensity: "detonate",
			usedFitPoints: ["凛盯着你", "门外有脚步声"],
		});
	}, 20_000);

	it("没有计划时不产生拍建议，决策里记下原因", () => {
		const { store } = openTempStore();
		seed(store, false);
		const { tail } = appendChain(store, 1);

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: tail,
			config: DEFAULT_DIRECTOR_CONFIG,
		});

		expect(suggestion).toBeNull();
		const beat = store
			.getDirectorDecision(tail)
			?.mechanisms.find((item) => item.name === "beat");
		expect(beat).toEqual({
			name: "beat",
			triggered: false,
			reason: "当前计划没有可推进的拍",
		});
	}, 20_000);

	it("拍状态全部完成、计划耗尽后不再给建议", () => {
		const { store } = openTempStore();
		seed(store);
		const { beats, tail } = appendChain(store, 1);
		store.saveDirectorBeatState({
			nodeId: beats[0] as string,
			storyId: "s1",
			beatId: "beat-2",
			completed: true,
		});

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: tail,
			config: DEFAULT_DIRECTOR_CONFIG,
		});

		expect(suggestion).toBeNull();
		expect(store.getDirectorDecision(tail)?.signals.beat).toMatchObject({
			beatId: null,
		});
	}, 20_000);

	it("另一分支的拍状态不参与当前路径", () => {
		const { store } = openTempStore();
		seed(store);
		store.appendNode({
			id: "root",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场",
		});
		for (const [branch, beatId] of [
			["x", "beat-1"],
			["y", null],
		] as const) {
			store.appendNode({
				id: `${branch}-a`,
				storyId: "s1",
				parentId: "root",
				role: "assistant",
				raw: `${branch} 的回复`,
			});
			if (beatId !== null) {
				store.saveDirectorBeatState({
					nodeId: `${branch}-a`,
					storyId: "s1",
					beatId,
					completed: true,
				});
			}
			store.appendNode({
				id: `${branch}-u`,
				storyId: "s1",
				parentId: `${branch}-a`,
				role: "user",
				raw: `${branch} 的输入`,
			});
		}

		const advanced = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: "x-u",
			config: DEFAULT_DIRECTOR_CONFIG,
		});
		expect(advanced?.directive).toContain("让凛松口");

		const fresh = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: "y-u",
			config: DEFAULT_DIRECTOR_CONFIG,
		});
		expect(fresh?.directive).toContain("确认来意");
		expect(fresh?.directive).not.toContain("让凛松口");
	}, 20_000);

	it("线索过多时拍建议优先，线索过老与场景重复压过拍", () => {
		const { store } = openTempStore();
		seed(store);
		const { tail } = appendChain(store, 1);
		for (let index = 0; index < 5; index += 1) {
			store.insertPlotNotes([
				{
					id: `clue-${index}`,
					storyId: "s1",
					sourceNodeId: tail,
					text: `线索 ${index}`,
				},
			]);
		}
		expect(
			evaluateDirector({
				store,
				storyId: "s1",
				nodeId: tail,
				config: DEFAULT_DIRECTOR_CONFIG,
			})?.mechanism,
		).toBe("beat");

		const old = openTempStore();
		seed(old.store);
		const oldChain = appendChain(old.store, 13);
		old.store.insertPlotNotes([
			{ id: "old", storyId: "s1", sourceNodeId: "a0", text: "旧线索" },
		]);
		const aged = evaluateDirector({
			store: old.store,
			storyId: "s1",
			nodeId: oldChain.tail,
			config: DEFAULT_DIRECTOR_CONFIG,
		});
		expect(aged?.mechanism).toBe("clue");
		expect(aged?.priority).toBe(CLUE_AGE_PRIORITY);

		const scene = openTempStore();
		seed(scene.store);
		const sceneChain = appendChain(scene.store, 5);
		scene.store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: sceneChain.beats[0] as string,
				path: ["场景"],
				op: "set",
				value: "山洞",
				source: "test",
			},
		]);
		const repeated = evaluateDirector({
			store: scene.store,
			storyId: "s1",
			nodeId: sceneChain.tail,
			config: config({ scenePath: ["场景"], sceneRepeatThreshold: 3 }),
		});
		expect(repeated?.mechanism).toBe("repetition");
		expect(repeated?.priority).toBe(REPETITION_SCENE_PRIORITY);
	}, 30_000);

	it("重复正文与节奏提示都压不过拍，拍压过节奏", () => {
		const { store } = openTempStore();
		seed(store);
		const rising = appendChain(store, 12);
		applySimilarities(
			store,
			rising.beats,
			[0.1, 0.1, 0.11, 0.12, 0.2, 0.2, 0.55, 0.55, 0.6, 0.6, 0.7],
		);
		const repeated = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: rising.tail,
			config: config({
				similarityWindow: 2,
				similarityStep: 1,
				similarityRiseWindows: 5,
				similarityThreshold: 0.5,
			}),
		});
		expect(repeated?.mechanism).toBe("repetition");
		expect(repeated?.priority).toBe(REPETITION_TEXT_PRIORITY);

		const paced = openTempStore();
		seed(paced.store);
		const chain = appendChain(paced.store, 5);
		paced.store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: chain.beats[0] as string,
				path: ["tension"],
				op: "set",
				value: 0.9,
				source: "test",
			},
		]);
		const pacedConfig = config({ tensionPath: ["tension"] });
		evaluateDirector({
			store: paced.store,
			storyId: "s1",
			nodeId: chain.beats[2] as string,
			config: pacedConfig,
		});
		const beat = evaluateDirector({
			store: paced.store,
			storyId: "s1",
			nodeId: chain.tail,
			config: pacedConfig,
		});
		expect(beat?.mechanism).toBe("beat");
		const pacing = paced.store
			.getDirectorDecision(chain.tail)
			?.mechanisms.find((item) => item.name === "pacing");
		expect(pacing?.triggered).toBe(true);
	}, 30_000);

	it("单轮强度覆盖故事设置，非法值抛错", async () => {
		const { store } = openTempStore();
		seed(store);
		appendChain(store, 1);
		const providers = {
			director: createDirectorSlotProvider(store, {
				when: "always",
				config: config({ intensity: "detonate" }),
			}),
		};
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		});

		const overridden = await runChatTurn({
			store,
			client: createFakeClient("继续。"),
			storyId: "s1",
			userText: "我看着他。",
			template,
			providers,
			budgetTokens: 4_096,
			structuredOutput: "text-tags",
			directorIntensity: "setup",
		});
		const decision = store.getDirectorDecision(overridden.userNode.id);
		expect(decision?.signals.beat).toMatchObject({
			intensity: "setup",
			usedFitPoints: [],
		});
		expect(decision?.directive).not.toContain("可见变化");

		const fallback = await runChatTurn({
			store,
			client: createFakeClient("继续。"),
			storyId: "s1",
			userText: "我再问。",
			template,
			providers,
			budgetTokens: 4_096,
			structuredOutput: "text-tags",
		});
		expect(
			store.getDirectorDecision(fallback.userNode.id)?.signals.beat,
		).toMatchObject({ intensity: "detonate" });

		const before = store.listStoryNodes("s1").length;
		await expect(
			runChatTurn({
				store,
				client: createFakeClient("继续。"),
				storyId: "s1",
				userText: "第三次。",
				template,
				providers,
				budgetTokens: 4_096,
				structuredOutput: "text-tags",
				directorIntensity: "hype" as never,
			}),
		).rejects.toThrow("单轮导演强度");
		expect(store.listStoryNodes("s1")).toHaveLength(before);
	}, 30_000);

	it("导演建议拼进玩家消息末尾，不产生独立消息也不改楼层原文", async () => {
		const { store } = openTempStore();
		seed(store);
		appendChain(store, 1);
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		});
		const fake = createFakeClient("继续。");
		const requests: LlmRequest[] = [];
		const client = {
			async complete(request: LlmRequest) {
				requests.push(request);
				return fake.complete();
			},
			stream(request: LlmRequest) {
				requests.push(request);
				return fake.stream();
			},
		};

		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我看着他。",
			template,
			providers: {
				history: createHistorySlotProvider(store),
				director: createDirectorSlotProvider(store, { when: "always" }),
			},
			budgetTokens: 4_096,
			structuredOutput: "text-tags",
		});

		const messages = requests[0]?.messages ?? [];
		expect(
			messages.some(
				(message) =>
					message.role === "system" && message.content.startsWith("【导演】"),
			),
		).toBe(false);
		const users = messages.filter((message) => message.role === "user");
		const lastUser = users.at(-1)?.content ?? "";
		const directive = store.getDirectorDecision(result.userNode.id)?.directive;
		expect(directive).not.toBeNull();
		expect(lastUser.startsWith("我看着他。")).toBe(true);
		expect(lastUser).toContain(directive as string);
		expect(lastUser.endsWith(DIRECTOR_SUFFIX_NOTE)).toBe(true);
		expect(result.userNode.raw).toBe("我看着他。");
		expect(store.getNode(result.userNode.id)?.raw).toBe("我看着他。");
		const entry = result.trace.context.entries.find(
			(item) => item.segmentId === "director",
		);
		expect(entry).toMatchObject({
			status: "included",
			appendedTo: "last-user",
		});
		expect(entry?.tokens).toBeGreaterThan(0);
	}, 30_000);
});
