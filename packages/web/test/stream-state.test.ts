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

	it("只有用户楼层时不提供重试", () => {
		const action = resolveRetryAction({
			started: true,
			assistantNodeId: null,
		});
		expect(action.kind).toBe("blocked");
	});
});
