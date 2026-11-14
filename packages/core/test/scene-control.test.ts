import { describe, expect, it } from "vitest";
import {
	type LlmStreamingClient,
	SCENE_PACE_VALUES,
	type StoryStore,
	assertSceneControlPayload,
	assertScenePace,
	createEventStream,
	endSceneAt,
	isSceneControlKind,
	jumpSceneTime,
	locateCorrectionSpan,
	readLedger,
	readSceneSegments,
	rewriteFloorSegment,
	setScenePace,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const USAGE = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

function scriptedClient(texts: readonly string[]): {
	readonly client: LlmStreamingClient;
	readonly requests: {
		readonly messages: readonly {
			readonly role: string;
			readonly content: string;
		}[];
	}[];
} {
	const requests: {
		messages: readonly { role: string; content: string }[];
	}[] = [];
	const client: LlmStreamingClient = {
		async complete(request) {
			const index = requests.length;
			const text = texts[index];
			if (text === undefined) {
				throw new Error(`没有为第 ${index + 1} 次请求准备回复`);
			}
			requests.push({ messages: request.messages });
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
		},
		stream() {
			return createEventStream(async () => {
				throw new Error("本测试不使用 stream");
			});
		},
	};
	return { client, requests };
}

/** 助手楼与玩家楼交替的一条链；返回助手楼层 id。 */
function seedStory(store: StoryStore): readonly string[] {
	store.createStory({ id: "s1", title: "场面控制" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "第一场。",
	});
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "a1",
		role: "user",
		raw: "我继续。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "第二场。",
	});
	store.appendNode({
		id: "u2",
		storyId: "s1",
		parentId: "a2",
		role: "user",
		raw: "我再看。",
	});
	store.appendNode({
		id: "a3",
		storyId: "s1",
		parentId: "u2",
		role: "assistant",
		raw: "第三场。",
	});
	return ["a1", "a2", "a3"];
}

describe("场面控制的取值", () => {
	it("种类与节奏档位只有固定取值", () => {
		expect(isSceneControlKind("end-scene")).toBe(true);
		expect(isSceneControlKind("jump-time")).toBe(true);
		expect(isSceneControlKind("pace")).toBe(true);
		expect(isSceneControlKind("rewind")).toBe(false);
		expect(assertScenePace("fast")).toBe("fast");
		expect(() => assertScenePace("turbo")).toThrow(/节奏档位/);
	});

	it("载荷按种类校验，未知字段与空值都指出位置", () => {
		expect(assertSceneControlPayload("end-scene", { note: "   " })).toEqual({
			note: null,
		});
		expect(
			assertSceneControlPayload("jump-time", { time: " 三天后 " }),
		).toEqual({ time: "三天后" });
		expect(assertSceneControlPayload("pace", { pace: "slow" })).toEqual({
			pace: "slow",
		});
		expect(() => assertSceneControlPayload("jump-time", { time: "" })).toThrow(
			/载荷\.time/,
		);
		expect(() =>
			assertSceneControlPayload("pace", { pace: "slow", extra: 1 }),
		).toThrow(/载荷\.extra/);
	});
});

describe("结束这一场", () => {
	it("把场次边界落在本楼，原文与场记都不改", () => {
		const { store } = openTempStore();
		const floors = seedStory(store);
		expect(readSceneSegments(store, "a3")).toEqual([
			{
				startNodeId: "a1",
				endNodeId: null,
				floorIds: [...floors],
				boundary: null,
			},
		]);

		const control = endSceneAt({
			store,
			storyId: "s1",
			nodeId: "a2",
			note: "这一场收在这里",
		});
		expect(control).toMatchObject({
			nodeId: "a2",
			kind: "end-scene",
			payload: { note: "这一场收在这里" },
		});

		const scenes = readSceneSegments(store, "a3");
		expect(scenes).toEqual([
			{
				startNodeId: "a1",
				endNodeId: "a2",
				floorIds: ["a1", "a2"],
				boundary: "player-ends",
			},
			{
				startNodeId: "a3",
				endNodeId: null,
				floorIds: ["a3"],
				boundary: null,
			},
		]);
		expect(store.getNode("a2")?.raw).toBe("第二场。");
		expect(store.getSceneLog("a2")).toBeNull();
	});

	it("场记判定与玩家结束同时出现时按场记判定", () => {
		const { store } = openTempStore();
		seedStory(store);
		store.saveSceneLog({
			nodeId: "a2",
			storyId: "s1",
			beat: "收束",
			present: ["林雪"],
			sceneEnds: true,
			sceneCard: null,
			bits: [],
			conditions: [],
			states: [],
			quotes: { submitted: 0, verified: 0 },
			repairs: [],
		});
		endSceneAt({ store, storyId: "s1", nodeId: "a2" });
		expect(readSceneSegments(store, "a2")[0]?.boundary).toBe("scene-ends");
	});

	it("只能落在当前路径的助手楼层上", () => {
		const { store } = openTempStore();
		seedStory(store);
		expect(() => endSceneAt({ store, storyId: "s1", nodeId: "u1" })).toThrow(
			/助手楼层/,
		);
		store.setHead("s1", "u1");
		expect(() => endSceneAt({ store, storyId: "s1", nodeId: "a3" })).toThrow(
			/不在当前路径上/,
		);
	});

	it("同一楼层重复结束只覆盖同一条记录", () => {
		const { store } = openTempStore();
		seedStory(store);
		endSceneAt({ store, storyId: "s1", nodeId: "a2", note: "第一次" });
		endSceneAt({ store, storyId: "s1", nodeId: "a2", note: "第二次" });
		expect(store.getSceneControl("a2", "end-scene")?.payload).toEqual({
			note: "第二次",
		});
	});
});

describe("跳到某个时间", () => {
	it("写入来源为玩家的时间锚点，并记一条场面控制", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { control, diff } = await jumpSceneTime({
			store,
			storyId: "s1",
			nodeId: "a2",
			time: "三天后的清晨",
		});
		expect(diff).toMatchObject({
			path: ["time", "current"],
			op: "set",
			value: "三天后的清晨",
			source: "player",
			nodeId: "a2",
		});
		expect(control.payload).toEqual({ time: "三天后的清晨" });
		expect(readLedger(store, "a2", ["time"])).toEqual({
			current: "三天后的清晨",
		});
	});

	it("空时间与非法楼层在写入任何东西之前拒绝", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const before = store.getStateDiffs("a2").length;
		await expect(
			jumpSceneTime({ store, storyId: "s1", nodeId: "a2", time: "   " }),
		).rejects.toThrow(/跳到的时间/);
		expect(store.getStateDiffs("a2")).toHaveLength(before);
		await expect(
			jumpSceneTime({ store, storyId: "s1", nodeId: "u2", time: "第二天" }),
		).rejects.toThrow(/助手楼层/);
		expect(store.getSceneControl("a2", "jump-time")).toBeNull();
	});
});

describe("调整节奏", () => {
	it("三档写进导演配置的 pace，并记一条场面控制", async () => {
		const { store } = openTempStore();
		seedStory(store);
		for (const pace of ["slow", "fast", "normal"] as const) {
			const { control, settings } = await setScenePace({
				store,
				storyId: "s1",
				nodeId: "a3",
				pace,
			});
			expect(control.payload).toEqual({ pace });
			expect(settings.directorConfig.pace).toBe(SCENE_PACE_VALUES[pace]);
		}
		expect(store.getStorySettings("s1").directorConfig.pace).toBe(1);
	});

	it("非法档位不改变设置", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const before = store.getStorySettings("s1").directorConfig.pace;
		await expect(
			setScenePace({
				store,
				storyId: "s1",
				nodeId: "a3",
				pace: "turbo" as never,
			}),
		).rejects.toThrow(/节奏档位/);
		expect(store.getStorySettings("s1").directorConfig.pace).toBe(before);
	});
});

describe("就地纠正", () => {
	it("定位片段要求逐字出现且只出现一次", () => {
		const raw = "门开了。灯灭了。门又关上了。";
		expect(locateCorrectionSpan(raw, "灯灭了")).toEqual({
			start: 4,
			end: 7,
			text: "灯灭了",
		});
		expect(() => locateCorrectionSpan(raw, "门")).toThrow(/不止一次/);
		expect(() => locateCorrectionSpan(raw, "窗开了")).toThrow(/不在这个楼层/);
		expect(() => locateCorrectionSpan(raw, " ")).toThrow(/非空字符串/);
	});

	it("只改选中段，其余正文逐字保留，旧楼层保留为新楼层的兄弟", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "就地纠正" });
		const raw = "阿蘅没有点灯，只把窗板推开一条缝。\n\n她把钥匙放在油桶盖上。";
		store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw,
		});
		const { client, requests } = scriptedClient(["她把钥匙推到你面前。"]);
		const result = await rewriteFloorSegment({
			store,
			client,
			storyId: "s1",
			nodeId: "a1",
			quote: "她把钥匙放在油桶盖上。",
			instruction: "这里让她直接把钥匙推过来",
		});

		expect(requests).toHaveLength(1);
		expect(requests[0]?.messages.at(-1)?.content).toContain(
			"这里让她直接把钥匙推过来",
		);
		expect(result.beforeNodeId).toBe("a1");
		expect(result.node.parentId).toBeNull();
		expect(result.node.id).not.toBe("a1");
		expect(result.node.raw).toBe(
			"阿蘅没有点灯，只把窗板推开一条缝。\n\n她把钥匙推到你面前。",
		);
		expect(store.getNode("a1")?.raw).toBe(raw);
		expect(store.getHead("s1")?.id).toBe(result.node.id);
		expect(result.willId).toMatch(/^will-/);

		const will = readLedger(store, result.node.id, ["userWill"]);
		expect(will).toEqual({
			[result.willId as string]: expect.objectContaining({
				kind: "correction",
				text: "这里让她直接把钥匙推过来",
				sourceNodeId: "a1",
			}),
		});
		const diffs = store.getStateDiffs(result.node.id);
		expect(diffs).toHaveLength(1);
		expect(diffs[0]?.source).toBe("player");
		expect(store.listPreferenceEvents("s1", { kind: "edit" })).toHaveLength(1);
	});

	it("片段重复、意见为空与模型输出无变化都在写入之前拒绝", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "就地纠正" });
		store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "风停了。雨也停了。",
		});
		const { client, requests } = scriptedClient(["风停了。"]);
		await expect(
			rewriteFloorSegment({
				store,
				client,
				storyId: "s1",
				nodeId: "a1",
				quote: "停了",
				instruction: "改成夜里",
			}),
		).rejects.toThrow(/不止一次/);
		await expect(
			rewriteFloorSegment({
				store,
				client,
				storyId: "s1",
				nodeId: "a1",
				quote: "风停了。",
				instruction: "   ",
			}),
		).rejects.toThrow(/纠正意见/);
		await expect(
			rewriteFloorSegment({
				store,
				client,
				storyId: "s1",
				nodeId: "a1",
				quote: "风停了。",
				instruction: "改得安静些",
			}),
		).rejects.toThrow(/相同/);
		expect(requests).toHaveLength(1);
		expect(store.listStoryNodes("s1")).toHaveLength(1);
		expect(store.getStateDiffs("a1")).toHaveLength(0);
	});
});
