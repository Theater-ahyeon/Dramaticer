import { describe, expect, it } from "vitest";
import {
	type BackgroundJobRegistry,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	createDefaultBackgroundJobRegistry,
	createSceneLogHandler,
	drainBackgroundJobs,
	readSituationParts,
	readStoryBackgroundSwitches,
	resolveStoryBackgroundKinds,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

// v5 §3.2：场记就是每楼唯一的「局面更新」，顺带行动选项、事件与用户意志。

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
			promptTokens: 30,
			completionTokens: 12,
			totalTokens: 42,
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

function fakeClient(reply: (request: LlmRequest) => string): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	return {
		requests,
		client: {
			async complete(request) {
				requests.push(request);
				return llmResult(reply(request));
			},
		},
	};
}

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。凛站在教室门口。",
	});
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "a1",
		role: "user",
		raw: "我以后想看轻松一点的剧情。我走过去问她。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "凛把信交给了老师，转身对你笑了一下。",
	});
}

function job(nodeId: string) {
	return {
		id: 1,
		storyId: "s1",
		nodeId,
		kind: "scene_log",
		status: "running" as const,
		attempts: 1,
		lastError: null,
		createdAt: "2026-11-24T00:00:00.000Z",
		startedAt: "2026-11-24T00:00:00.000Z",
		finishedAt: null,
	};
}

const FULL = JSON.stringify({
	beat: "试探",
	states: [],
	present: ["凛"],
	sceneEnds: false,
	options: ["我问她信里写了什么", "我跟着她走出教室", "我先不说话"],
	events: [
		{
			text: "凛把信交给了老师",
			participants: ["凛", "老师"],
			knowers: ["凛", "老师"],
			importance: 0.6,
			quote: "凛把信交给了老师",
		},
	],
	will: [
		{
			kind: "preference",
			text: "剧情保持轻松",
			sourceQuote: "我以后想看轻松一点的剧情",
		},
	],
});

describe("局面更新（合并后的每楼后台调用）", () => {
	it("一次调用写下场记、行动选项、事件与用户意志，都挂在这一楼", async () => {
		const { store } = openTempStore();
		seed(store);
		const { client, requests } = fakeClient(() => FULL);
		await createSceneLogHandler({ parts: readSituationParts })({
			store,
			client,
			job: job("a2"),
		});

		expect(requests).toHaveLength(1);
		const system = String(requests[0]?.messages[0]?.content);
		expect(system).toContain("options");
		expect(system).toContain("events");
		expect(system).toContain("will");
		expect(store.getSceneLog("a2")?.beat).toBe("试探");
		expect(
			store.listDirectorCandidateActions("a2").map((item) => item.text),
		).toEqual(["我问她信里写了什么", "我跟着她走出教室", "我先不说话"]);
		expect(store.listExtractedEventNodeIds("s1")).toContain("a2");
		const state = store.getStateSnapshot("a2").state as {
			userWill?: Record<string, { text: string }>;
		};
		expect(
			Object.values(state.userWill ?? {}).map((item) => item.text),
		).toEqual(["剧情保持轻松"]);
	});

	it("顺带的部分格式不对只丢掉那一部分，场记照常落地", async () => {
		const { store } = openTempStore();
		seed(store);
		const { client } = fakeClient(() =>
			JSON.stringify({
				beat: "试探",
				states: [],
				present: ["凛"],
				sceneEnds: false,
				options: ["只有一条"],
				events: [{ text: "" }],
				will: [{ kind: "preference", text: "x", sourceQuote: "不在原话里" }],
			}),
		);
		await createSceneLogHandler({ parts: readSituationParts })({
			store,
			client,
			job: job("a2"),
		});
		const log = store.getSceneLog("a2");
		expect(log?.beat).toBe("试探");
		expect(log?.repairs.map((repair) => repair.path[0])).toEqual(
			expect.arrayContaining(["options", "events", "will"]),
		);
		expect(store.listDirectorCandidateActions("a2")).toEqual([]);
	});

	it("行动选项关掉时不要选项，也不写候选", async () => {
		const { store } = openTempStore();
		seed(store);
		store.updateStorySettings("s1", { featureSwitches: { choices: false } });
		const { client, requests } = fakeClient(() => FULL);
		await createSceneLogHandler({ parts: readSituationParts })({
			store,
			client,
			job: job("a2"),
		});
		expect(String(requests[0]?.messages[0]?.content)).not.toContain(
			"- options：",
		);
		expect(store.listDirectorCandidateActions("a2")).toEqual([]);
	});

	it("假模型下每楼后台调用不超过 1 次，调用次数与 token 记在任务上", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		let parent: string | null = null;
		for (let index = 1; index <= 5; index += 1) {
			store.appendNode({
				id: `u${index}`,
				storyId: "s1",
				parentId: parent,
				role: "user",
				raw: `我做第${index}件事。`,
			});
			store.appendNode({
				id: `a${index}`,
				storyId: "s1",
				parentId: `u${index}`,
				role: "assistant",
				raw: `凛回应了第${index}件事。`,
			});
			parent = `a${index}`;
		}
		let current = "";
		const calls = new Map<string, number>();
		const base = createDefaultBackgroundJobRegistry();
		const registry: BackgroundJobRegistry = new Map(
			[...base].map(([kind, type]) => [
				kind,
				{
					...type,
					handler: (context) => {
						current = kind;
						return type.handler(context);
					},
				},
			]),
		);
		const { client } = fakeClient(() => {
			calls.set(current, (calls.get(current) ?? 0) + 1);
			return JSON.stringify({
				beat: "推进",
				states: [],
				present: ["凛"],
				sceneEnds: false,
				options: ["我继续", "我停下"],
				events: [],
				will: [],
			});
		});
		const kinds = resolveStoryBackgroundKinds(
			registry,
			readStoryBackgroundSwitches(store, "s1"),
		);
		await drainBackgroundJobs({
			store,
			registry,
			client,
			storyId: "s1",
			kinds,
			sessionEnded: true,
			limit: 500,
		});
		const total = [...calls.values()].reduce((sum, value) => sum + value, 0);
		expect(total).toBeLessThanOrEqual(5);
		expect([...calls.keys()]).toEqual(["scene_log"]);
		const jobs = store
			.listBackgroundJobs({ storyId: "s1" })
			.filter((item) => item.kind === "scene_log");
		expect(jobs.reduce((sum, item) => sum + (item.llmCalls ?? 0), 0)).toBe(5);
		expect(jobs.reduce((sum, item) => sum + (item.llmTokens ?? 0), 0)).toBe(
			5 * 42,
		);
	});
});
