import { describe, expect, it } from "vitest";
import {
	type LlmCallOptions,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmToolCall,
	type StoryStore,
	type TurnDraftSnapshot,
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

function createScriptedClient(
	rounds: readonly Round[],
	onRound?: (index: number) => void,
): { client: LlmStreamingClient; requests: LlmRequest[] } {
	const requests: LlmRequest[] = [];
	const client: LlmStreamingClient = {
		async complete() {
			throw new Error("本测试不使用 complete");
		},
		stream(request, _options?: LlmCallOptions) {
			const index = requests.length;
			const round = rounds[index];
			if (round === undefined) {
				throw new Error(`没有为第 ${index + 1} 次请求准备回复`);
			}
			requests.push(request);
			onRound?.(index);
			return createEventStream(async (emit) => {
				for (const char of round.text) {
					emit({ type: "text_delta", delta: char });
				}
				return resultOf(round);
			});
		},
	};
	return { client, requests };
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "草稿与提交" });
	store.appendNode({
		id: "n-root",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "井底的青铜匕首还在。",
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
	extra: {
		readonly onDraftReplace?: (draft: TurnDraftSnapshot) => void;
		readonly signal?: AbortSignal;
	} = {},
) {
	return {
		store,
		client,
		storyId: "s1",
		userText: "我点亮火把。",
		template: createDefaultContextTemplate({
			structuredOutput: "function-call",
		}),
		providers: providers(store),
		budgetTokens: 4_000,
		structuredOutput: "function-call" as const,
		turnMode: "deep" as const,
		...extra,
	};
}

function draftWrite(id: string, text: string): LlmToolCall {
	return { id, name: "draft_write", arguments: { text } };
}

function commitCall(id: string): LlmToolCall {
	return { id, name: "commit_draft", arguments: {} };
}

describe("深回合草稿与提交", () => {
	it("草稿替换只进回调与运行日志，提交前不写楼层", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const snapshots: TurnDraftSnapshot[] = [];
		const headRoles: (string | null)[] = [];
		const { client, requests } = createScriptedClient(
			[
				{ text: "", toolCalls: [draftWrite("w1", "第一版，火光。")] },
				{ text: "", toolCalls: [draftWrite("w2", "第二版，火光和影子。")] },
				{ text: "", toolCalls: [commitCall("c1")] },
			],
			(index) => {
				headRoles.push(store.getHead("s1")?.role ?? null);
				if (index === 2) {
					expect(
						store
							.listStoryNodes("s1")
							.filter((node) => node.role === "assistant"),
					).toHaveLength(1);
				}
			},
		);

		const result = await runChatTurn(
			turnInput(store, client, {
				onDraftReplace: (draft) => snapshots.push(draft),
			}),
		);

		expect(requests).toHaveLength(3);
		expect(headRoles).toEqual(["user", "user", "user"]);
		expect(snapshots).toEqual([
			{ text: "第一版，火光。", version: 1 },
			{ text: "第二版，火光和影子。", version: 2 },
		]);
		expect(result.node.raw).toBe("第二版，火光和影子。");
		expect(result.trace.deep).toMatchObject({
			commit: "tool",
			drift: null,
			stopReason: "completed",
		});
		expect(result.trace.run?.status).toBe("completed");

		const runId = result.trace.run?.runId as string;
		const events = store.listTurnRunEvents(runId);
		expect(
			events
				.filter((event) => event.kind === "draft.replace")
				.map((event) => event.payload),
		).toEqual([
			{ version: 1, textLength: 7 },
			{ version: 2, textLength: 10 },
		]);
		expect(
			events.find((event) => event.kind === "draft.commit")?.payload,
		).toEqual({ version: 2, textLength: 10, method: "tool" });
		expect(JSON.stringify(events)).not.toContain("火光和影子");
	});

	it("正常结束没有提交时自动提交最后一次输出并记录漂移", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const snapshots: TurnDraftSnapshot[] = [];
		const { client, requests } = createScriptedClient([
			{ text: "", toolCalls: [draftWrite("w1", "旧稿。")] },
			{ text: "最终正文只有一段。" },
		]);

		const result = await runChatTurn(
			turnInput(store, client, {
				onDraftReplace: (draft) => snapshots.push(draft),
			}),
		);

		expect(requests).toHaveLength(2);
		expect(result.node.raw).toBe("最终正文只有一段。");
		expect(snapshots.at(-1)).toEqual({
			text: "最终正文只有一段。",
			version: 2,
		});
		expect(result.trace.deep).toMatchObject({
			commit: "auto",
			drift: "missing_commit",
			stopReason: "completed",
		});
		const events = store.listTurnRunEvents(result.trace.run?.runId as string);
		expect(events.slice(-2).map((event) => event.kind)).toEqual([
			"draft.replace",
			"draft.commit",
		]);
		expect(events.at(-1)?.payload).toEqual({
			version: 2,
			textLength: 9,
			method: "auto",
		});
	});

	it("提交之后继续写入、提交或调用其它工具都被拒绝", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{
				text: "",
				toolCalls: [
					draftWrite("w1", "保留这一版。"),
					commitCall("c1"),
					draftWrite("w2", "改掉。"),
					commitCall("c2"),
					{ id: "s1", name: "state_get", arguments: {} },
				],
			},
		]);

		const result = await runChatTurn(turnInput(store, client));

		expect(requests).toHaveLength(1);
		expect(result.node.raw).toBe("保留这一版。");
		expect(
			result.trace.tools.calls.map((call) => ({
				name: call.name,
				ok: call.ok,
			})),
		).toEqual([
			{ name: "draft_write", ok: true },
			{ name: "commit_draft", ok: true },
			{ name: "draft_write", ok: false },
			{ name: "commit_draft", ok: false },
			{ name: "state_get", ok: false },
		]);
		expect(result.trace.tools.calls[2]?.error).toContain("已经提交");
		expect(result.trace.tools.calls[3]?.error).toContain("已经提交");
		expect(result.trace.tools.calls[4]?.error).toContain("运行已经结束");
	});

	it("中止且没有提交时不写助手楼层，运行标为 aborted", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const controller = new AbortController();
		controller.abort(new Error("玩家取消"));
		const { client } = createScriptedClient([{ text: "不该被调用。" }]);

		await expect(
			runChatTurn(turnInput(store, client, { signal: controller.signal })),
		).rejects.toThrow("玩家取消");

		expect(store.getHead("s1")?.role).toBe("user");
		const runs = store.listTurnRuns("s1");
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({ status: "aborted", nodeId: null });
		const events = store.listTurnRunEvents(runs[0]?.runId as string);
		expect(events.map((event) => event.kind)).toEqual(["error"]);
	});

	it("空草稿写入返回工具错误，不产生草稿版本", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createScriptedClient([
			{ text: "", toolCalls: [draftWrite("w1", "   ")] },
			{ text: "正文。" },
		]);

		const result = await runChatTurn(turnInput(store, client));

		expect(result.trace.tools.calls[0]).toMatchObject({
			name: "draft_write",
			ok: false,
			error: "草稿正文不能为空",
			permission: "control",
		});
		expect(result.node.raw).toBe("正文。");
		expect(result.trace.deep).toMatchObject({
			commit: "auto",
			drift: "missing_commit",
		});
	});
});
