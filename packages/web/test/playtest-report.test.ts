import { describe, expect, it } from "vitest";
import type {
	PlaytestPreferenceCounts,
	PlaytestRoundRecord,
	PlaytestRunResult,
} from "../src/playtest/records";
import {
	assertNoPrivateIdentifiers,
	collectPrivateIdentifiers,
	renderPrivateReport,
	renderStatsReport,
	scanPrivateIdentifiers,
} from "../src/playtest/report";
import { adjacentBlockJaccard, summarizePlaytest } from "../src/playtest/stats";

const SECRET_LINE = "这是一段只应出现在私有报告里的正文内容";

const PREFERENCES: PlaytestPreferenceCounts = {
	swipe: 2,
	choice: 1,
	edit: 2,
	card_decision: 0,
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
		user: `第${round}轮行动`,
		assistant: "甲乙丙丁\n戊己庚辛",
		turnMode: "fast",
		firstTokenMs: 100 * round,
		durationMs: 200 * round,
		usage: {
			promptTokens: 100,
			completionTokens: 20,
			totalTokens: 120,
			reasoningTokens: 5,
		},
		ledgerDiffCount: round,
		newClueIds: [],
		fulfilledClueIds: [],
		fulfilledClueAges: [],
		director: {
			directive: "让门后的脚步更近",
			mechanisms: [{ name: "opening", triggered: true, reason: "前 10 楼" }],
		},
		candidateActions: { count: 5, visible: true, pickedText: null },
		openingCandidates: null,
		operations: [],
		background: { pending: 0, running: 0, failed: 0 },
		screenshot: `/shots/round-${round}.png`,
		createdAt: "2026-11-08T00:00:00.000Z",
		...overrides,
	};
}

function runResult(records: readonly PlaytestRoundRecord[]): PlaytestRunResult {
	return {
		meta: {
			rounds: records.length,
			viewport: "390×844",
			writerModel: "writer-model",
			backgroundModel: "background-model",
			schedule: {
				swipeAt: [2],
				editAt: [3],
				branchAt: [],
				candidateAt: [1],
				optionAt: [],
			},
			startedAt: "2026-11-08T00:00:00.000Z",
			finishedAt: "2026-11-08T00:10:00.000Z",
		},
		records,
		preferenceCounts: PREFERENCES,
	};
}

describe("自动试玩统计", () => {
	it("按最近秩算分位，并汇总偏好与线索", () => {
		const records = [
			roundRecord(1, { newClueIds: ["c1"] }),
			roundRecord(2, { fulfilledClueIds: ["c1"], fulfilledClueAges: [1] }),
			roundRecord(3, { firstTokenMs: null }),
		];
		const aggregate = summarizePlaytest({
			requestedRounds: 4,
			records,
			preferenceCounts: PREFERENCES,
		});
		expect(aggregate.succeededRounds).toBe(3);
		expect(aggregate.failedRounds).toBe(0);
		expect(aggregate.firstToken).toEqual({
			count: 2,
			mean: 150,
			p50: 100,
			p95: 200,
		});
		expect(aggregate.clues).toEqual({
			opened: 1,
			fulfilled: 1,
			fulfillmentRate: 1,
			meanAge: 1,
			agedFulfillments: 1,
		});
		expect(aggregate.director.decisions).toBe(3);
		expect(aggregate.director.mechanisms).toEqual([
			{ name: "opening", triggered: 3, total: 3 },
		]);
		expect(aggregate.preferenceCounts.swipe).toBe(2);
		expect(aggregate.tokens.roundsWithUsage).toBe(3);
		expect(aggregate.tokens.totalPerRound).toBe(120);
	});

	it("相邻块 Jaccard 与参照文本同口径", () => {
		const records = [
			roundRecord(1, { assistant: "甲乙丙丁" }),
			roundRecord(2, { assistant: "甲乙丙丁" }),
			roundRecord(3, { assistant: "戊己庚辛" }),
		];
		expect(adjacentBlockJaccard(records)).toEqual([1, 0]);
		const aggregate = summarizePlaytest({
			requestedRounds: 3,
			records,
			preferenceCounts: PREFERENCES,
		});
		expect(aggregate.jaccard).toMatchObject({
			count: 2,
			mean: 0.5,
			median: 0,
			max: 1,
		});
	});
});

describe("自动试玩报告", () => {
	const context = {
		storyId: "story-secret-1",
		storyTitle: "秘密故事",
		characterNames: ["林雪"],
		dbPath: "data/test.db",
		channelsPath: "data/channels.yaml",
	};

	it("私有报告保留逐轮原文与截图，统计版不出现私有标识", () => {
		const records = [
			roundRecord(1, {
				assistant: `${SECRET_LINE}\n甲乙丙丁`,
				openingCandidates: { count: 3, visible: true, pickedText: null },
				operations: [
					{
						kind: "swipe",
						round: 1,
						stepId: "round-1/swipe",
						fromNodeId: "assistant-1",
						toNodeId: "assistant-1b",
						text: "重新生成的正文",
					},
				],
			}),
		];
		const result = runResult(records);
		const aggregate = summarizePlaytest({
			requestedRounds: 1,
			records,
			preferenceCounts: PREFERENCES,
		});
		const privateReport = renderPrivateReport({ result, aggregate, context });
		expect(privateReport).toContain(SECRET_LINE);
		expect(privateReport).toContain("/shots/round-1.png");
		expect(privateReport).toContain("round-1/swipe");
		expect(privateReport).toContain("显示 3 条");
		const identifiers = collectPrivateIdentifiers({ context, records });
		expect(identifiers.has("story-secret-1")).toBe(true);
		expect(identifiers.has(SECRET_LINE)).toBe(true);
		const stats = renderStatsReport({
			result,
			aggregate,
			scan: { identifiers: identifiers.size, matches: [] },
		});
		for (const field of [
			"对比胜率",
			"矛盾率",
			"相邻块 Jaccard",
			"节拍余弦",
			"首字延迟 P50",
			"新建线索",
			"兑现率",
			"错误数",
			"偏好信号 swipe",
		]) {
			expect(stats).toContain(field);
		}
		const scan = scanPrivateIdentifiers(stats, identifiers);
		expect(scan.matches).toEqual([]);
	});

	it("统计版泄漏私有标识时扫描报告并抛错", () => {
		const records = [roundRecord(1)];
		const identifiers = collectPrivateIdentifiers({ context, records });
		const stats = renderStatsReport({
			result: runResult(records),
			aggregate: summarizePlaytest({
				requestedRounds: 1,
				records,
				preferenceCounts: PREFERENCES,
			}),
			scan: { identifiers: identifiers.size, matches: [] },
		});
		const scan = scanPrivateIdentifiers(`${stats}story-secret-1`, identifiers);
		expect(scan.matches).toContain("story-secret-1");
		expect(() => assertNoPrivateIdentifiers(scan)).toThrow("私有标识");
	});
});
