import { describe, expect, it } from "vitest";
import {
	assertPlaytestProgressMatches,
	completedRoundCount,
	parsePlaytestProgress,
	rebuildClueFirstSeen,
} from "../src/playtest/progress";
import type {
	PlaytestRecord,
	PlaytestRoundRecord,
	PlaytestScheduleView,
} from "../src/playtest/records";

const schedule: PlaytestScheduleView = {
	swipeAt: [3, 7],
	editAt: [4, 8],
	branchAt: [5, 9],
	candidateAt: [2, 6],
	optionAt: [6, 10],
};

function roundRecord(
	round: number,
	overrides: Partial<PlaytestRoundRecord> = {},
): PlaytestRoundRecord {
	return {
		kind: "round",
		round,
		userNodeId: `user-${round}`,
		assistantNodeId: `assistant-${round}`,
		traceNodeId: `assistant-${round}`,
		user: `玩家第 ${round} 轮`,
		assistant: `剧情第 ${round} 轮`,
		turnMode: "fast",
		firstTokenMs: 1_000,
		durationMs: 2_000,
		usage: {
			promptTokens: 10,
			completionTokens: 20,
			totalTokens: 30,
			reasoningTokens: null,
		},
		ledgerDiffCount: 1,
		newClueIds: [],
		fulfilledClueIds: [],
		fulfilledClueAges: [],
		director: null,
		candidateActions: null,
		openingCandidates: null,
		operations: [],
		background: { pending: 0, running: 0, failed: 0 },
		screenshot: `round-${round}.png`,
		createdAt: "2026-11-08T00:00:00.000Z",
		...overrides,
	};
}

function progressText(
	records: readonly PlaytestRecord[],
	overrides: Record<string, unknown> = {},
): string {
	return JSON.stringify({
		version: 1,
		storyId: "story-1",
		storyTitle: "自动试玩",
		dbPath: "E:/repo/.devloop/scratch/R5-T14/live.db",
		channelsPath: "E:/repo/.devloop/scratch/R5-T14/channels.yaml",
		rounds: 60,
		schedule,
		startedAt: "2026-11-08T00:00:00.000Z",
		records,
		...overrides,
	});
}

describe("自动试玩续跑文件", () => {
	it("解析完整记录、操作与线索", () => {
		const progress = parsePlaytestProgress(
			progressText([
				roundRecord(1, {
					newClueIds: ["clue-a"],
					operations: [
						{
							kind: "swipe",
							round: 1,
							stepId: "round-1/swipe",
							fromNodeId: "a",
							toNodeId: "b",
							text: "新正文",
						},
					],
				}),
				roundRecord(2),
			]),
		);
		expect(progress.version).toBe(1);
		expect(progress.records).toHaveLength(2);
		expect(completedRoundCount(progress.records)).toBe(2);
		const first = progress.records[0];
		expect(first?.kind).toBe("round");
		if (first?.kind !== "round") throw new Error("记录类型错误");
		expect(first.operations[0]?.kind).toBe("swipe");
		expect(first.newClueIds).toEqual(["clue-a"]);
	});

	it("拒绝不支持的版本与损坏的 JSON", () => {
		expect(() =>
			parsePlaytestProgress(progressText([roundRecord(1)], { version: 2 })),
		).toThrow(/版本 2 不受支持/);
		expect(() => parsePlaytestProgress("{")).toThrow(/不是合法 JSON/);
	});

	it("要求轮次从 1 连续递增，失败记录只能在最后", () => {
		expect(() =>
			parsePlaytestProgress(progressText([roundRecord(1), roundRecord(3)])),
		).toThrow(/期望第 2 轮，实际第 3 轮/);
		expect(() =>
			parsePlaytestProgress(
				progressText([
					{
						kind: "failure",
						round: 1,
						stepId: "round-1/send",
						error: "失败",
						screenshot: "failure.png",
						createdAt: "2026-11-08T00:00:00.000Z",
					},
					roundRecord(2),
				]),
			),
		).toThrow(/失败记录之后/);
	});

	it("续跑配置不一致时指出字段", () => {
		const progress = parsePlaytestProgress(progressText([roundRecord(1)]));
		expect(() =>
			assertPlaytestProgressMatches(progress, {
				storyTitle: "自动试玩",
				dbPath: "E:/other.db",
				channelsPath: "E:/repo/.devloop/scratch/R5-T14/channels.yaml",
				rounds: 60,
				schedule,
			}),
		).toThrow(/dbPath：文件为 E:\/repo.*当前为 E:\/other\.db/);
		expect(() =>
			assertPlaytestProgressMatches(progress, {
				storyTitle: "自动试玩",
				dbPath: "E:/repo/.devloop/scratch/R5-T14/live.db",
				channelsPath: "E:/repo/.devloop/scratch/R5-T14/channels.yaml",
				rounds: 60,
				schedule: { ...schedule, swipeAt: [3] },
			}),
		).toThrow(/schedule\.swipeAt/);
	});

	it("重建线索首次出现轮次，试玩前就在的线索记 0", () => {
		const firstSeen = rebuildClueFirstSeen(
			[
				roundRecord(1),
				roundRecord(2, { newClueIds: ["clue-a"] }),
				roundRecord(3, { newClueIds: ["clue-b"] }),
			],
			["clue-a", "clue-old"],
		);
		expect(firstSeen.get("clue-a")).toBe(2);
		expect(firstSeen.get("clue-b")).toBe(3);
		expect(firstSeen.get("clue-old")).toBe(0);
	});
});
