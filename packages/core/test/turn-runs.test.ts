import Database from "better-sqlite3";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	type LlmCallOptions,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmToolCall,
	type StoryStore,
	createDefaultContextTemplate,
	createEventStream,
	createHistorySlotProvider,
	createStaticSlotProvider,
	runChatTurn,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const USAGE = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

interface Round {
	readonly text: string;
	readonly toolCalls?: readonly LlmToolCall[];
}

function resultOf(round: Round): LlmResult {
	const calls = round.toolCalls ?? [];
	return {
		text: round.text,
		reasoning: "",
		toolCalls: calls,
		finishReason: calls.length > 0 ? "tool_calls" : "stop",
		stopReason: calls.length > 0 ? "toolUse" : "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: USAGE,
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation:
			round.text.length > 0 ? { text: round.text, reasoning: "" } : null,
	};
}

function createScriptedClient(rounds: readonly Round[]): LlmStreamingClient {
	let index = 0;
	return {
		async complete() {
			throw new Error("本测试不使用 complete");
		},
		stream(_request: LlmRequest, _options?: LlmCallOptions) {
			const round = rounds[index];
			index += 1;
			if (round === undefined) {
				throw new Error(`没有为第 ${index} 次请求准备回复`);
			}
			return createEventStream(async (emit) => {
				for (const char of round.text) {
					emit({ type: "text_delta", delta: char });
				}
				return resultOf(round);
			});
		},
	};
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "运行日志" });
	store.appendNode({
		id: "n-root",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "井底的青铜匕首还在。",
	});
	store.appendNode({
		id: "n-user",
		storyId: "s1",
		parentId: "n-root",
		role: "user",
		raw: "我下井。",
	});
}

function providers(store: StoryStore) {
	return {
		character: createStaticSlotProvider(
			[{ role: "system", content: "你扮演山神。" }],
			"card:山神",
		),
		history: createHistorySlotProvider(store, { limit: 10 }),
	};
}

function turnInput(
	store: StoryStore,
	client: LlmStreamingClient,
	turnMode: "fast" | "deep",
) {
	return {
		store,
		client,
		storyId: "s1",
		userText: "我点起火把。",
		template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
		providers: providers(store),
		budgetTokens: 4_000,
		structuredOutput: "text-tags" as const,
		turnMode,
	};
}

describe("运行日志存储", () => {
	it("事件按序号严格递增，结束后可按楼层读回", () => {
		const { store } = openTempStore();
		seedStory(store);
		const run = store.startTurnRun({
			storyId: "s1",
			userNodeId: "n-user",
			mode: "deep",
		});
		expect(run.status).toBe("running");
		expect(run.nodeId).toBeNull();
		const first = store.appendTurnRunEvent({
			runId: run.runId,
			kind: "model.request",
			payload: { round: 1 },
		});
		const second = store.appendTurnRunEvent({
			runId: run.runId,
			kind: "model.response",
			payload: { round: 1, textLength: 5 },
		});
		expect([first.seq, second.seq]).toEqual([1, 2]);
		expect(store.listTurnRunEvents(run.runId)).toEqual([first, second]);
		expect(store.countTurnRunEvents(run.runId)).toBe(2);
		expect(store.getTurnRunForNode("n-user")).toBeNull();

		store.appendNode({
			id: "n-reply",
			storyId: "s1",
			parentId: "n-user",
			role: "assistant",
			raw: "火光晃了一下。",
		});
		const finished = store.finishTurnRun({
			runId: run.runId,
			status: "completed",
			nodeId: "n-reply",
		});
		expect(finished.status).toBe("completed");
		expect(finished.nodeId).toBe("n-reply");
		expect(store.getTurnRunForNode("n-reply")?.runId).toBe(run.runId);
		expect(store.listTurnRunEvents(run.runId)).toHaveLength(2);
	});

	it("更新或删除事件被拒绝，原行不变", () => {
		const { store, path } = openTempStore();
		seedStory(store);
		const run = store.startTurnRun({
			storyId: "s1",
			userNodeId: "n-user",
			mode: "deep",
		});
		const event = store.appendTurnRunEvent({
			runId: run.runId,
			kind: "tool.call",
			payload: { name: "history_read", permission: "read" },
		});
		const raw = new Database(path);
		onTestFinished(() => raw.close());
		expect(() =>
			raw
				.prepare(
					"UPDATE turn_run_events SET payload = ? WHERE run_id = ? AND seq = ?",
				)
				.run("{}", run.runId, event.seq),
		).toThrow("只追加");
		expect(() =>
			raw
				.prepare("DELETE FROM turn_run_events WHERE run_id = ? AND seq = ?")
				.run(run.runId, event.seq),
		).toThrow("只追加");
		expect(store.listTurnRunEvents(run.runId)).toEqual([event]);
	});

	it("启动时把遗留的 running 标为 interrupted 并保留事件", () => {
		const { store } = openTempStore();
		seedStory(store);
		const run = store.startTurnRun({
			storyId: "s1",
			userNodeId: "n-user",
			mode: "deep",
		});
		const event = store.appendTurnRunEvent({
			runId: run.runId,
			kind: "model.request",
			payload: { round: 1 },
		});
		expect(store.markInterruptedTurnRuns("2026-11-12T00:00:00.000Z")).toBe(1);
		const interrupted = store.getTurnRun(run.runId);
		expect(interrupted?.status).toBe("interrupted");
		expect(interrupted?.finishedAt).toBe("2026-11-12T00:00:00.000Z");
		expect(store.listTurnRunEvents(run.runId)).toEqual([event]);
		expect(() =>
			store.appendTurnRunEvent({
				runId: run.runId,
				kind: "model.response",
				payload: { round: 1 },
			}),
		).toThrow("不能再追加事件");
		expect(store.markInterruptedTurnRuns()).toBe(0);
	});

	it("非用户楼层与跨故事楼层都拒绝建运行", () => {
		const { store } = openTempStore();
		seedStory(store);
		store.createStory({ id: "s2", title: "另一个故事" });
		store.appendNode({
			id: "n-other",
			storyId: "s2",
			parentId: null,
			role: "user",
			raw: "在别处。",
		});
		expect(() =>
			store.startTurnRun({
				storyId: "s1",
				userNodeId: "n-root",
				mode: "deep",
			}),
		).toThrow("用户楼层");
		expect(() =>
			store.startTurnRun({
				storyId: "s1",
				userNodeId: "n-other",
				mode: "deep",
			}),
		).toThrow("另一个故事");
		expect(() =>
			store.appendTurnRunEvent({
				runId: "missing",
				kind: "error",
				payload: { message: "没有这个运行" },
			}),
		).toThrow("运行不存在");
	});
});

describe("深回合运行事件", () => {
	it("每步同步写事件，Trace 与存储读到同一个运行", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const client = createScriptedClient([
			{
				text: "",
				toolCalls: [
					{ id: "t1", name: "history_read", arguments: { count: 1 } },
				],
			},
			{ text: "火光把井壁照出细纹。" },
		]);
		const result = await runChatTurn(turnInput(store, client, "deep"));

		expect(result.trace.run).not.toBeNull();
		expect(result.trace.run?.status).toBe("completed");
		const runId = result.trace.run?.runId as string;
		expect(store.getTurnRunForNode(result.node.id)?.runId).toBe(runId);
		const events = store.listTurnRunEvents(runId);
		expect(events.map((event) => event.kind)).toEqual([
			"model.request",
			"model.response",
			"tool.call",
			"tool.result",
			"model.request",
			"model.response",
		]);
		expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(result.trace.run?.eventCount).toBe(events.length);
		expect(events[2]?.payload).toEqual({
			round: 1,
			name: "history_read",
			permission: "read",
		});
		expect(events[3]?.payload.ok).toBe(true);
		const serialized = JSON.stringify(events);
		expect(serialized).not.toContain("井底的青铜匕首");
		expect(serialized).not.toContain("我点起火把");
		expect(serialized).not.toContain("火光把井壁照出细纹");
	});

	it("快回合不写运行表，Trace 的 run 为 null", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const client = createScriptedClient([{ text: "风从井口灌进来。" }]);
		const result = await runChatTurn(turnInput(store, client, "fast"));
		expect(result.trace.run).toBeNull();
		expect(store.getTurnRunForNode(result.node.id)).toBeNull();
	});

	it("生成失败时运行标为 failed 并留下 error 事件", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const client: LlmStreamingClient = {
			async complete() {
				throw new Error("本测试不使用 complete");
			},
			stream() {
				return createEventStream(async () => {
					throw new Error("渠道断开");
				});
			},
		};
		await expect(runChatTurn(turnInput(store, client, "deep"))).rejects.toThrow(
			"渠道断开",
		);
		const runs = store.listTurnRuns("s1");
		expect(runs).toHaveLength(1);
		expect(runs[0]?.status).toBe("failed");
		expect(runs[0]?.nodeId).toBeNull();
		const events = store.listTurnRunEvents(runs[0]?.runId as string);
		expect(events.map((event) => event.kind)).toEqual([
			"model.request",
			"error",
		]);
		expect(events[1]?.payload.message).toBe("渠道断开");
	});
});
