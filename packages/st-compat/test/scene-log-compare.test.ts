import {
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	StoryStore,
} from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { compareSceneLog, formatSceneLogCompare } from "../src/index.js";

function openStore(): StoryStore {
	const store = StoryStore.open(":memory:");
	onTestFinished(() => store.close());
	return store;
}

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

/** 按顺序返回脚本的假客户端；脚本用完后再调用直接失败。 */
function scriptedClient(replies: readonly string[]): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	return {
		requests,
		client: {
			async complete(request) {
				requests.push(request);
				const reply = replies[requests.length - 1];
				if (reply === undefined) {
					throw new Error("假客户端没有更多回复");
				}
				return llmResult(reply);
			},
		},
	};
}

function seedStory(store: StoryStore): void {
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
		raw: "别动不动就让角色死掉。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "凛笑了一下，把书合上。",
	});
	store.appendNode({
		id: "u2",
		storyId: "s1",
		parentId: "a2",
		role: "user",
		raw: "我们去找老师。",
	});
	store.appendNode({
		id: "a4",
		storyId: "s1",
		parentId: "u2",
		role: "assistant",
		raw: "凛把书放进抽屉，转身离开。",
	});
}

function settleReply(
	nodeId: string,
	path: readonly string[],
	value: unknown,
): string {
	return JSON.stringify([
		{
			nodeId,
			diffs: [{ path, op: "set", value, confidence: 0.9 }],
			conflicts: [],
		},
	]);
}

const SCENE_TEXT = "凛在等你的回答。";

function sceneLogReply(
	path: readonly string[],
	value: unknown,
	quote: string,
	beat = "试探",
): string {
	return JSON.stringify({
		beat,
		states: [{ path, op: "set", value, confidence: 0.9, sourceQuote: quote }],
		present: ["凛"],
		sceneEnds: false,
	});
}

describe("场记对照工具", () => {
	it("两边写入同样的路径与值时一致率为 100%", async () => {
		const independent = openStore();
		const merged = openStore();
		seedStory(independent);
		seedStory(merged);
		const independentClient = scriptedClient([
			settleReply("a2", ["scene", "current", "place"], "教室"),
			SCENE_TEXT,
			"[]",
			settleReply("a4", ["time", "current"], "傍晚"),
			SCENE_TEXT,
			"[]",
		]);
		const mergedClient = scriptedClient([
			sceneLogReply(["scene", "current", "place"], "教室", "把书合上"),
			sceneLogReply(["time", "current"], "傍晚", "转身离开", "转场"),
		]);

		const result = await compareSceneLog({
			storyId: "s1",
			nodeIds: ["a2", "a4"],
			independent,
			merged,
			independentClient: independentClient.client,
			mergedClient: mergedClient.client,
		});

		expect(result.floors).toBe(2);
		expect(result.independent.requests).toBe(6);
		expect(result.merged.requests).toBe(2);
		expect(result.independent.diffs).toBe(2);
		expect(result.merged.diffs).toBe(2);
		expect(result.agreement.pathAgreement).toBe(1);
		expect(result.agreement.factAgreement).toBe(1);
		expect(result.quotes).toEqual({
			submitted: 2,
			verified: 2,
			rejected: 0,
			hitRate: 1,
		});
		expect(result.independent.failures).toEqual([]);
		expect(result.merged.failures).toEqual([]);
		expect(formatSceneLogCompare(result)).toContain("样本 2 个助手楼层");
	});

	it("引文对不上只拒绝该条，并计入引文命中率与路径差异", async () => {
		const independent = openStore();
		const merged = openStore();
		seedStory(independent);
		seedStory(merged);
		const independentClient = scriptedClient([
			JSON.stringify([
				{
					nodeId: "a2",
					diffs: [
						{
							path: ["scene", "current", "place"],
							op: "set",
							value: "教室",
							confidence: 0.9,
						},
						{
							path: ["time", "current"],
							op: "set",
							value: "傍晚",
							confidence: 0.8,
						},
					],
					conflicts: [],
				},
			]),
			SCENE_TEXT,
			"[]",
		]);
		const mergedClient = scriptedClient([
			JSON.stringify({
				beat: "试探",
				states: [
					{
						path: ["scene", "current", "place"],
						op: "set",
						value: "教室",
						confidence: 0.9,
						sourceQuote: "把书合上",
					},
					{
						path: ["time", "current"],
						op: "set",
						value: "傍晚",
						confidence: 0.8,
						sourceQuote: "她走出教学楼",
					},
				],
				present: ["凛"],
				sceneEnds: false,
			}),
		]);

		const result = await compareSceneLog({
			storyId: "s1",
			nodeIds: ["a2"],
			independent,
			merged,
			independentClient: independentClient.client,
			mergedClient: mergedClient.client,
		});

		expect(result.merged.diffs).toBe(1);
		expect(result.quotes).toEqual({
			submitted: 2,
			verified: 1,
			rejected: 1,
			hitRate: 0.5,
		});
		expect(result.agreement.pathIntersection).toBe(1);
		expect(result.agreement.pathUnion).toBe(2);
		expect(result.agreement.pathAgreement).toBe(0.5);
		expect(result.merged.repairs).toBeGreaterThanOrEqual(1);
		expect(result.merged.failures).toEqual([]);
	});

	it("空输出记为一次失败，不参与一致率分母", async () => {
		const independent = openStore();
		const merged = openStore();
		seedStory(independent);
		seedStory(merged);
		const independentClient = scriptedClient([
			settleReply("a2", ["scene", "current", "place"], "教室"),
			SCENE_TEXT,
			"[]",
		]);
		const mergedClient = scriptedClient([""]);

		const result = await compareSceneLog({
			storyId: "s1",
			nodeIds: ["a2"],
			independent,
			merged,
			independentClient: independentClient.client,
			mergedClient: mergedClient.client,
		});

		expect(result.merged.processedFloors).toBe(0);
		expect(result.merged.failures.map((failure) => failure.step)).toEqual([
			"scene_log",
		]);
		expect(result.independent.processedFloors).toBe(1);
		expect(result.agreement.floorsBothSettled).toBe(0);
		expect(result.agreement.pathAgreement).toBeNull();
		expect(result.quotes.hitRate).toBeNull();
	});
});
