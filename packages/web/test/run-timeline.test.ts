import type {
	JsonObject,
	TurnRunEvent,
	TurnRunEventKind,
	TurnRunStatus,
} from "@dramaticer/core";
import type { NodeRunView } from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import { buildRunTimeline, sortRunEvents } from "../src/chat/run-timeline";

function event(
	seq: number,
	kind: TurnRunEventKind,
	payload: JsonObject,
): TurnRunEvent {
	return {
		runId: "run-1",
		seq,
		kind,
		payload,
		createdAt: `2026-01-01T00:00:0${seq}.000Z`,
	};
}

function view(
	status: TurnRunStatus,
	events: readonly TurnRunEvent[],
): NodeRunView {
	return {
		nodeId: "a1",
		run: {
			runId: "run-1",
			storyId: "s1",
			userNodeId: "u1",
			nodeId: status === "completed" ? "a1" : null,
			mode: "deep",
			status,
			startedAt: "2026-01-01T00:00:00.000Z",
			finishedAt: status === "running" ? null : "2026-01-01T00:00:10.000Z",
		},
		events,
	};
}

describe("运行时间线", () => {
	it("按 seq 升序排列，模型请求、工具与草稿都给出可读细节", () => {
		const events = [
			event(3, "tool.result", {
				round: 1,
				name: "state_get",
				permission: "read",
				ok: true,
				resultLength: 42,
			}),
			event(1, "model.request", {
				round: 1,
				model: "main-fallback",
				messages: 6,
				tools: 10,
				transport: "text",
			}),
			event(2, "tool.call", {
				round: 1,
				name: "state_get",
				permission: "read",
			}),
			event(4, "draft.replace", { version: 2, textLength: 180 }),
			event(5, "draft.commit", {
				version: 2,
				textLength: 180,
				method: "auto",
			}),
		];
		const timeline = buildRunTimeline(view("completed", events));
		expect(timeline.rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);
		expect(timeline.rows[0]?.detail).toContain("第 1 次");
		expect(timeline.rows[0]?.detail).toContain("main-fallback");
		expect(timeline.rows[0]?.detail).toContain("文本协议");
		expect(timeline.rows[1]?.detail).toContain("读取");
		expect(timeline.rows[2]?.detail).toContain("成功");
		expect(timeline.rows[3]?.detail).toBe("第 2 版 · 180 字");
		expect(timeline.rows[4]?.detail).toContain("自动提交");
		expect(timeline.statusLabel).toBe("已完成");
		expect(timeline.stoppedAt).toBeNull();
	});

	it("追加要求、上限与错误都进入时间线", () => {
		const timeline = buildRunTimeline(
			view("failed", [
				event(1, "steering", { textLength: 12 }),
				event(2, "limit", {
					reason: "timeout",
					maxDurationMs: 600000,
					durationMs: 600120,
				}),
				event(3, "error", {
					message: "运行时长用完",
					reason: "timeout",
				}),
			]),
		);
		expect(timeline.rows[0]?.label).toBe("追加要求");
		expect(timeline.rows[0]?.detail).toBe("追加 12 字");
		expect(timeline.rows[1]?.detail).toContain("运行时长上限");
		expect(timeline.rows[1]?.detail).toContain("600000 毫秒");
		expect(timeline.rows[2]?.detail).toContain("运行时长用完");
		expect(timeline.stoppedAt).toBe("第 3 步：错误（运行时长用完 · timeout）");
	});

	it("中断运行显示停在哪一步，没有事件时给出说明", () => {
		const interrupted = buildRunTimeline(
			view("interrupted", [
				event(1, "model.request", { round: 1 }),
				event(2, "model.response", {
					round: 1,
					textLength: 0,
					usage: { totalTokens: 99 },
				}),
			]),
		);
		expect(interrupted.stoppedAt).toContain("第 2 步：模型响应");
		expect(interrupted.statusLabel).toBe("已中断");
		const empty = buildRunTimeline(view("interrupted", []));
		expect(empty.stoppedAt).toBe("没有任何运行事件");
	});

	it("排序不修改传入数组", () => {
		const first = event(2, "tool.call", { name: "x" });
		const second = event(1, "tool.call", { name: "y" });
		const events = [first, second];
		const sorted = sortRunEvents(events);
		expect(sorted.map((item) => item.seq)).toEqual([1, 2]);
		expect(events.map((item) => item.seq)).toEqual([2, 1]);
	});
});
