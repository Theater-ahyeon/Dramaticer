import { describe, expect, it } from "vitest";
import type { StoryStore, TurnTrace } from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function traceFor(
	nodeId: string,
	storyId: string,
	parentNodeId: string | null,
): TurnTrace {
	return {
		storyId,
		nodeId,
		parentNodeId,
		templateId: "dramaticer-default",
		createdAt: "2026-11-07T00:00:00.000Z",
		context: {
			budgetTokens: 1_000,
			totalTokens: 12,
			entries: [
				{
					segmentId: "protocol",
					kind: "static",
					slot: null,
					source: "template:dramaticer-default/protocol",
					priority: 95,
					tokens: 12,
					status: "included",
				},
			],
		},
		llm: {
			model: "fake-model",
			channel: "fake-channel",
			stopReason: "stop",
			finishReason: "stop",
			truncation: null,
			usage: {
				promptTokens: 1,
				completionTokens: 2,
				totalTokens: 3,
				reasoningTokens: 0,
				cachedTokens: 0,
			},
			attempts: 1,
			rounds: 1,
			cached: false,
		},
		structured: {
			mode: "text-tags",
			acceptedStateUpdates: 0,
			acceptedNotes: 0,
			issues: [],
		},
		timing: { firstTokenMs: 100, durationMs: 500 },
	};
}

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
	store.appendNode({
		id: "n-greeting",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "你好。",
	});
	store.appendNode({
		id: "n-user",
		storyId: "s1",
		parentId: "n-greeting",
		role: "user",
		raw: "我来了。",
	});
}

describe("Trace 存储", () => {
	it("保存后按楼层读出同样的内容", () => {
		const { store } = openTempStore();
		seed(store);
		const trace = traceFor("n-user", "s1", "n-greeting");
		store.saveTurnTrace(trace);
		expect(store.getTurnTrace("n-user")).toEqual(trace);
		expect(store.getTurnTrace("n-greeting")).toBeNull();
	});

	it("同一个楼层写两次 Trace 抛错", () => {
		const { store } = openTempStore();
		seed(store);
		store.saveTurnTrace(traceFor("n-user", "s1", "n-greeting"));
		expect(() =>
			store.saveTurnTrace(traceFor("n-user", "s1", "n-greeting")),
		).toThrow("已经写过");
	});

	it("楼层不存在、故事不一致、父节点不一致都抛错", () => {
		const { store } = openTempStore();
		seed(store);
		expect(() =>
			store.saveTurnTrace(traceFor("n-missing", "s1", null)),
		).toThrow("楼层节点不存在");
		expect(() =>
			store.saveTurnTrace(traceFor("n-user", "s2", "n-greeting")),
		).toThrow("storyId");
		expect(() => store.saveTurnTrace(traceFor("n-user", "s1", null))).toThrow(
			"parentNodeId",
		);
		expect(() => store.getTurnTrace("n-missing")).toThrow("楼层节点不存在");
	});
});
