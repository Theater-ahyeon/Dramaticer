import type { TurnCompletedPayload } from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import { describeTurnSummary, summarizeTurn } from "../src/chat/turn-summary";

function payloadWith(
	diffs: readonly { path: readonly string[]; value: unknown }[],
) {
	return {
		stateDiffs: diffs.map((diff, index) => ({
			id: index + 1,
			storyId: "s",
			nodeId: "a1",
			ordinal: index,
			op: "set",
			reason: null,
			source: "model",
			storyTime: null,
			confidence: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			...diff,
		})),
		firstTokenMs: 1450,
	} as unknown as TurnCompletedPayload;
}

describe("回合统计", () => {
	it("统计 diff 数并按线索 id 去重新建与兑现", () => {
		const summary = summarizeTurn(
			payloadWith([
				{ path: ["clue", "c1", "status"], value: "open" },
				{ path: ["clue", "c1", "text"], value: "一把钥匙" },
				{ path: ["clue", "c2", "status"], value: "open" },
				{ path: ["clue", "c2", "status"], value: "open" },
				{ path: ["clue", "c0", "status"], value: "fulfilled" },
				{ path: ["character", "凛", "location"], value: "教室" },
			]),
		);
		expect(summary).toEqual({
			diffCount: 6,
			openedClues: 2,
			fulfilledClues: 1,
			firstTokenMs: 1450,
		});
		expect(describeTurnSummary(summary)).toBe(
			"状态更新 6 条 · 新线索 2 条 · 兑现线索 1 条 · 首字 1.5 秒",
		);
	});

	it("没有线索写入与首字时间时只报 diff 数", () => {
		const payload = payloadWith([]);
		const summary = summarizeTurn({ ...payload, firstTokenMs: null });
		expect(describeTurnSummary(summary)).toBe(
			"状态更新 0 条 · 新线索 0 条 · 兑现线索 0 条",
		);
	});
});
