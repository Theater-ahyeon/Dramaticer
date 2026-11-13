import type { AssistantEventView } from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import {
	applyAssistantSseEvent,
	applyPersistedAssistantEvents,
	createAssistantRunState,
	parseAssistantSseStream,
	selectLatestRunEvents,
} from "../src/assistant/stream";

function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
}

function sseFrame(name: string, data: unknown): string {
	return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function persistedEvent(
	seq: number,
	kind: AssistantEventView["kind"],
	payload: AssistantEventView["payload"],
): AssistantEventView {
	return {
		conversationId: "c-1",
		seq,
		kind,
		payload,
		createdAt: "2026-11-13T02:00:00.000Z",
	};
}

describe("助手事件流", () => {
	it("按事件名解析并按顺序应用正文、工具与结束状态", async () => {
		const frames = [
			sseFrame("assistant.started", { conversationId: "c-1", skill: "guide" }),
			sseFrame("assistant.text.delta", { delta: "先看 " }),
			sseFrame("assistant.text.delta", { delta: "Trace。" }),
			sseFrame("assistant.tool.call", {
				name: "trace_read",
				arguments: { nodeId: "n-1" },
			}),
			sseFrame("assistant.tool.result", {
				name: "trace_read",
				ok: true,
				result: { entries: 2 },
			}),
			sseFrame("assistant.completed", {
				status: "completed",
				stopReason: "completed",
			}),
		];
		let state = createAssistantRunState();
		for await (const event of parseAssistantSseStream(streamOf(frames))) {
			state = applyAssistantSseEvent(state, event);
		}
		expect(state.text).toBe("先看 Trace。");
		expect(state.tools).toEqual([
			{
				name: "trace_read",
				arguments: { nodeId: "n-1" },
				ok: true,
				result: { entries: 2 },
				deniedPermission: null,
				reason: null,
			},
		]);
		expect(state.status).toBe("completed");
		expect(state.stopReason).toBe("completed");
	});

	it("未知事件与空 data 被跳过，非法 JSON 直接失败", async () => {
		const frames = [
			sseFrame("assistant.unknown", { delta: "忽略" }),
			": ping\n\n",
			sseFrame("assistant.text.delta", { delta: "保留" }),
		];
		const events = [];
		for await (const event of parseAssistantSseStream(streamOf(frames))) {
			events.push(event);
		}
		expect(events).toHaveLength(1);
		await expect(
			(async () => {
				for await (const _event of parseAssistantSseStream(
					streamOf(["event: assistant.text.delta\ndata: {oops\n\n"]),
				)) {
					// 解析失败前不会有事件。
				}
			})(),
		).rejects.toThrow("不是合法 JSON");
	});

	it("权限拒绝与工具结果都进入活动列表", () => {
		let state = createAssistantRunState();
		state = applyAssistantSseEvent(state, {
			event: "assistant.permission.denied",
			data: {
				name: "propose_ledger_change",
				permission: "read_only",
				reason: "只读级别不能提案",
			},
		});
		state = applyAssistantSseEvent(state, {
			event: "assistant.tool.result",
			data: { name: "ledger_read", ok: false, result: { error: "空窗口" } },
		});
		expect(state.tools.map((tool) => tool.name)).toEqual([
			"propose_ledger_change",
			"ledger_read",
		]);
		expect(state.tools[0]?.deniedPermission).toBe("read_only");
		expect(state.tools[1]?.ok).toBe(false);
	});

	it("持久事件按序号去重，重连只重放最后一次运行", () => {
		const events = [
			persistedEvent(1, "started", { conversationId: "c-1", skill: "guide" }),
			persistedEvent(2, "text.delta", { delta: "旧" }),
			persistedEvent(3, "completed", {
				status: "completed",
				stopReason: "completed",
			}),
			persistedEvent(4, "started", { conversationId: "c-1", skill: "guide" }),
			persistedEvent(5, "text.delta", { delta: "新" }),
		];
		const latest = selectLatestRunEvents(events);
		expect(latest.map((event) => event.seq)).toEqual([4, 5]);
		const once = applyPersistedAssistantEvents(
			createAssistantRunState(3),
			latest,
		);
		expect(once.text).toBe("新");
		expect(once.lastSeq).toBe(5);
		const twice = applyPersistedAssistantEvents(once, events);
		expect(twice.text).toBe("新");
		expect(twice.lastSeq).toBe(5);
	});
});
