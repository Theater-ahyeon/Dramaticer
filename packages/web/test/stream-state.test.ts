import type { SseEvent } from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import {
	applyTurnEvent,
	createTurnDraft,
	markTurnFailed,
	resolveRetryAction,
} from "../src/chat/stream-state";

function event<T extends SseEvent["event"]>(
	name: T,
	data: Extract<SseEvent, { event: T }>["data"],
): SseEvent {
	return { event: name, data } as SseEvent;
}

describe("流式回合归并", () => {
	it("逐字正文与思考各自累加", () => {
		let draft = createTurnDraft();
		draft = applyTurnEvent(
			draft,
			event("turn.started", {
				storyId: "s",
				userNodeId: "u1",
				runId: null,
			}),
		);
		draft = applyTurnEvent(draft, event("text.delta", { delta: "黑" }));
		draft = applyTurnEvent(draft, event("text.delta", { delta: "夜" }));
		draft = applyTurnEvent(draft, event("thinking.delta", { delta: "先\n" }));
		draft = applyTurnEvent(draft, event("thinking.delta", { delta: "观察" }));
		expect(draft.started).toBe(true);
		expect(draft.userNodeId).toBe("u1");
		expect(draft.text).toBe("黑夜");
		expect(draft.thinking).toBe("先\n观察");
	});

	it("深回合记下运行 id，阶段文字不覆盖正文", () => {
		let draft = createTurnDraft();
		draft = applyTurnEvent(
			draft,
			event("turn.started", {
				storyId: "s",
				userNodeId: "u1",
				runId: "run-1",
			}),
		);
		draft = applyTurnEvent(
			draft,
			event("turn.progress", { phase: "回忆中……", detail: "memory_search" }),
		);
		expect(draft.runId).toBe("run-1");
		expect(draft.progress?.phase).toBe("回忆中……");
		draft = applyTurnEvent(draft, event("text.delta", { delta: "正文" }));
		expect(draft.text).toBe("正文");
		expect(draft.progress).toBeNull();
	});

	it("块快照替换、工具调用按顺序累积", () => {
		let draft = createTurnDraft();
		draft = applyTurnEvent(
			draft,
			event("blocks.replace", {
				blocks: [{ kind: "text", text: "一段正文" }],
			}),
		);
		draft = applyTurnEvent(
			draft,
			event("tool.call", { name: "search", ok: true }),
		);
		draft = applyTurnEvent(
			draft,
			event("tool.call", { name: "read", ok: false }),
		);
		expect(draft.blocks).toEqual([{ kind: "text", text: "一段正文" }]);
		expect(draft.tools).toEqual([
			{ name: "search", ok: true },
			{ name: "read", ok: false },
		]);
	});

	it("草稿快照只向前合并，迟到的旧版本不覆盖", () => {
		let draft = createTurnDraft();
		draft = applyTurnEvent(
			draft,
			event("draft.replace", { text: "第一版", version: 1 }),
		);
		draft = applyTurnEvent(
			draft,
			event("draft.replace", { text: "第二版", version: 2 }),
		);
		draft = applyTurnEvent(
			draft,
			event("draft.replace", { text: "迟到的第一版", version: 1 }),
		);
		expect(draft.liveDraft).toEqual({ text: "第二版", version: 2 });
	});

	it("追加要求按顺序回显，不修改正文", () => {
		let draft = createTurnDraft();
		draft = applyTurnEvent(draft, event("text.delta", { delta: "正文" }));
		draft = applyTurnEvent(
			draft,
			event("turn.steering", { runId: "run-1", text: "让脚步停下" }),
		);
		draft = applyTurnEvent(
			draft,
			event("turn.steering", { runId: "run-1", text: "转向窗外" }),
		);
		expect(draft.guidance).toEqual(["让脚步停下", "转向窗外"]);
		expect(draft.text).toBe("正文");
	});

	it("提交事件用正式块替换正文并收起光标", () => {
		let draft = createTurnDraft();
		draft = applyTurnEvent(
			draft,
			event("draft.replace", { text: "提交的草稿", version: 3 }),
		);
		draft = applyTurnEvent(draft, {
			event: "turn.committed",
			data: {
				storyId: "s",
				runId: "run-1",
				nodeId: "a1",
				blocks: [{ kind: "text", text: "提交的草稿" }],
				commit: "tool",
			},
		});
		expect(draft.committed?.nodeId).toBe("a1");
		expect(draft.blocks).toEqual([{ kind: "text", text: "提交的草稿" }]);
		expect(draft.progress).toBeNull();
	});

	it("完成事件保留已经收到的正文，错误事件只记消息", () => {
		const node = {
			id: "a1",
			storyId: "s",
			parentId: "u1",
			role: "assistant" as const,
			raw: "完整正文",
			createdAt: "2026-01-01T00:00:00.000Z",
		};
		let draft = createTurnDraft();
		draft = applyTurnEvent(draft, event("text.delta", { delta: "部分" }));
		draft = applyTurnEvent(draft, {
			event: "turn.completed",
			data: {
				storyId: "s",
				userNode: { ...node, id: "u1", role: "user", raw: "行动" },
				node,
				blocks: [],
				stateDiffs: [],
				plotNotes: [],
				usage: {
					promptTokens: 0,
					completionTokens: 0,
					totalTokens: 0,
					reasoningTokens: null,
					cachedTokens: null,
				},
				trace: {} as never,
				firstTokenMs: 123,
			},
		} as SseEvent);
		expect(draft.text).toBe("部分");
		expect(draft.completed?.node.raw).toBe("完整正文");
		draft = markTurnFailed(draft, "网络中断");
		expect(draft.text).toBe("部分");
		expect(draft.errorMessage).toBe("网络中断");
	});

	it("没有收到正文时用完成事件的楼层原文补上", () => {
		const draft = applyTurnEvent(createTurnDraft(), {
			event: "turn.completed",
			data: {
				storyId: "s",
				userNode: {
					id: "u1",
					storyId: "s",
					parentId: null,
					role: "user",
					raw: "行动",
					createdAt: "2026-01-01T00:00:00.000Z",
				},
				node: {
					id: "a1",
					storyId: "s",
					parentId: "u1",
					role: "assistant",
					raw: "完成时才拿到的正文",
					createdAt: "2026-01-01T00:00:01.000Z",
				},
				blocks: [],
				stateDiffs: [],
				plotNotes: [],
				usage: {
					promptTokens: 0,
					completionTokens: 0,
					totalTokens: 0,
					reasoningTokens: null,
					cachedTokens: null,
				},
				trace: {} as never,
				firstTokenMs: null,
			},
		} as SseEvent);
		expect(draft.text).toBe("完成时才拿到的正文");
	});
});

describe("失败后的重试判定", () => {
	it("没写用户楼层时重发", () => {
		expect(
			resolveRetryAction({ started: false, assistantNodeId: null }),
		).toEqual({ kind: "resend" });
	});

	it("已经写了用户楼层且有助手楼层时重新生成", () => {
		expect(
			resolveRetryAction({ started: true, assistantNodeId: "a1" }),
		).toEqual({ kind: "regenerate", nodeId: "a1" });
	});

	it("只有用户楼层时以该楼层重试这一轮", () => {
		const action = resolveRetryAction({
			started: true,
			assistantNodeId: null,
			userNodeId: "u1",
		});
		expect(action).toEqual({ kind: "retry", nodeId: "u1" });
	});

	it("既没有用户楼层也没有助手楼层时不提供重试", () => {
		const action = resolveRetryAction({
			started: true,
			assistantNodeId: null,
			userNodeId: null,
		});
		expect(action.kind).toBe("blocked");
	});
});
