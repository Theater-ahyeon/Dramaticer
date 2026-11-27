import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type SceneCard,
	type StoryStore,
	createSceneCardSlotProvider,
	createSceneLogHandler,
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

const CARD: SceneCard = {
	present: [{ who: "凛", want: "拿回那封信" }],
	change: "凛离开教室，把信交出去",
};

const RESPONSE_WITH_CARD = JSON.stringify({
	beat: "试探",
	states: [],
	present: ["凛"],
	sceneEnds: false,
	sceneCard: CARD,
});

const RESPONSE_WITHOUT_CARD = JSON.stringify({
	beat: "试探",
	states: [],
	present: ["凛"],
	sceneEnds: false,
});

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。凛站在教室门口。",
	});
}

function seedSecondFloor(store: StoryStore): void {
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "a1",
		role: "user",
		raw: "我抬头看她。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "凛笑了一下，把书合上。",
	});
}

function jobFor(storyId: string, nodeId: string) {
	return {
		id: 1,
		storyId,
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

function request(storyId: string, nodeId: string) {
	return {
		slot: "scene_card" as const,
		storyId,
		nodeId,
		switches: {},
		state: undefined,
	};
}

describe("场面卡", () => {
	it("开新场的场记要求并保存场面卡", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([RESPONSE_WITH_CARD]);

		await createSceneLogHandler()({
			store,
			client,
			job: jobFor("s1", "a1"),
		});

		expect(requests[0]?.messages[0]?.content).toContain("sceneCard");
		expect(store.getSceneLog("a1")?.sceneCard).toEqual(CARD);
	});

	it("开新场缺少场面卡整次拒绝", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([RESPONSE_WITHOUT_CARD]);

		await expect(
			createSceneLogHandler()({ store, client, job: jobFor("s1", "a1") }),
		).rejects.toThrow("sceneCard");
		expect(store.getSceneLog("a1")).toBeNull();
	});

	it("非开场的楼层给出场面卡时丢弃并记入 repairs", async () => {
		const { store } = openTempStore();
		seedStory(store);
		seedSecondFloor(store);
		store.saveSceneLog({
			nodeId: "a1",
			storyId: "s1",
			beat: "开场",
			present: ["凛"],
			sceneEnds: false,
			sceneCard: CARD,
			bits: [],
			conditions: [],
			states: [],
			quotes: { submitted: 0, verified: 0 },
			repairs: [],
		});
		const { client } = createFakeClient([RESPONSE_WITH_CARD]);

		await createSceneLogHandler()({ store, client, job: jobFor("s1", "a2") });

		const log = store.getSceneLog("a2");
		expect(log?.sceneCard).toBeNull();
		expect(log?.repairs).toEqual([
			{
				path: ["sceneCard"],
				action: "delete",
				reason: "这一楼没有开场，sceneCard 已丢弃",
			},
		]);
	});

	it("槽位注入当前场的场面卡，导演关闭时不注入", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.saveSceneLog({
			nodeId: "a1",
			storyId: "s1",
			beat: "开场",
			present: ["凛"],
			sceneEnds: false,
			sceneCard: CARD,
			bits: [],
			conditions: [],
			states: [],
			quotes: { submitted: 0, verified: 0 },
			repairs: [],
		});
		const provider = createSceneCardSlotProvider(store);

		const content = provider.provide(request("s1", "a1"));
		expect(content?.source).toBe("scene_card:楼层 a1，1 人");
		expect(content?.messages[0]?.content).toBe(
			"场面卡：\n凛想要拿回那封信\n这一场结束时应该改变：凛离开教室，把信交出去",
		);

		store.updateStorySettings("s1", {
			directorConfig: { ...DEFAULT_DIRECTOR_CONFIG, mode: "off" },
		});
		expect(provider.provide(request("s1", "a1"))).toBeNull();
	});
});
