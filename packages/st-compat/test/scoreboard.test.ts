import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
	LlmUsage,
	PlaytestDirectorRecord,
	PlaytestProbeRecord,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import type { ForgettingRunResult } from "../src/evalset/forgetting.js";
import type {
	HistoricalReplayRecord,
	HistoricalReplaySample,
} from "../src/evalset/historical-replay.js";
import type {
	PreferenceComparisonRecord,
	PreferenceSample,
} from "../src/evalset/pairwise.js";
import type {
	PlaytestRecord,
	PlaytestRoundRecord,
	PlaytestTraceSummary,
} from "../src/evalset/playtest.js";
import type { QualityRecord } from "../src/evalset/quality.js";
import { runScoreboardCli } from "../src/evalset/scoreboard-cli.js";
import {
	buildScoreboard,
	renderScoreboard,
	summarizePlaytests,
} from "../src/evalset/scoreboard.js";

const USAGE: LlmUsage = {
	promptTokens: 100,
	completionTokens: 50,
	totalTokens: 150,
	reasoningTokens: 0,
	cachedTokens: 0,
};

const SECRET_STORY = "story-alpha-private";
const SECRET_SAMPLE = "sample-alpha-private";
const SECRET_TEXT = "秘密正文不能出现在记分牌里";

const createdDirs: string[] = [];

afterEach(() => {
	for (const dir of createdDirs.splice(0)) {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
});

function makeDir(prefix: string): string {
	const dir = mkdtempSync(path.join(import.meta.dirname, prefix));
	createdDirs.push(dir);
	return dir;
}

function doneRecord(options: {
	round: number;
	profile: "native" | "naive";
	model: string;
	startedAt: string;
	firstTokenMs: number | null;
	truncated: boolean;
	unfinishedRatio: number;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	assistant: string;
}): PlaytestRoundRecord {
	const trace: PlaytestTraceSummary = {
		templateId: "template",
		turnMode: "fast",
		profile: options.profile,
		budgetTokens: 12_000,
		totalTokens: options.totalTokens,
		segments: [],
		model: options.model,
		channel: "fake",
		stopReason: "stop",
		finishReason: "stop",
		truncations: options.truncated ? ["length"] : [],
		usage: {
			promptTokens: options.promptTokens,
			completionTokens: options.completionTokens,
			totalTokens: options.totalTokens,
			reasoningTokens: 0,
			cachedTokens: 0,
		},
		attempts: 1,
		rounds: 1,
		cached: false,
		tools: {
			transport: "native",
			rounds: 0,
			maxRounds: 3,
			capped: false,
			calls: [],
			rejected: [],
		},
		structured: {
			mode: "text-tags",
			acceptedStateUpdates: 0,
			acceptedNotes: 0,
			issues: [],
		},
		timing: {
			firstTokenMs: options.firstTokenMs,
			durationMs: 2_000,
		},
	};
	return {
		status: "done",
		round: options.round,
		storyId: SECRET_STORY,
		profile: options.profile,
		seed: 1,
		startedAt: options.startedAt,
		gapWork: {
			pending: 0,
			running: 0,
			done: 0,
			failed: 0,
			discarded: 0,
			unfinishedRatio: options.unfinishedRatio,
		},
		operations: [],
		probe: null as PlaytestProbeRecord | null,
		verdict: null,
		userNodeId: `user-${options.round}`,
		nodeId: `node-${options.round}`,
		traceNodeId: `node-${options.round}`,
		user: "我继续走。",
		assistant: options.assistant,
		userHint: "",
		firstTokenMs: options.firstTokenMs,
		durationMs: 2_000,
		usage: {
			promptTokens: options.promptTokens,
			completionTokens: options.completionTokens,
			totalTokens: options.totalTokens,
			reasoningTokens: 0,
			cachedTokens: 0,
		},
		ledgerDiffCount: 0,
		newClues: 0,
		fulfilledClues: 0,
		director: null as PlaytestDirectorRecord | null,
		trace,
		truncated: options.truncated,
		drain: null,
	};
}

function failedRecord(profile: "native" | "naive"): PlaytestRecord {
	return {
		status: "failed",
		round: 3,
		storyId: SECRET_STORY,
		profile,
		seed: 1,
		startedAt: "2026-11-08T01:03:00.000Z",
		gapWork: {
			pending: 0,
			running: 0,
			done: 0,
			failed: 0,
			discarded: 0,
			unfinishedRatio: 0,
		},
		operations: [],
		probe: null,
		verdict: null,
		user: "我继续走。",
		userHint: "",
		error: "生成失败",
		drain: null,
	};
}

function comparison(options: {
	sampleId: string;
	order: "accepted-first" | "abandoned-first";
	winner: "A" | "B" | "tie";
	earlierSwipe: boolean;
}): PreferenceComparisonRecord {
	return {
		sampleId: options.sampleId,
		storyId: SECRET_STORY,
		kind: "reroll",
		earlierSwipe: options.earlierSwipe,
		order: options.order,
		attempts: 1,
		usage: USAGE,
		model: "judge-alias",
		createdAt: "2026-11-08T03:00:00.000Z",
		status: "done",
		winner: options.winner,
		reason: "理由不能出现在记分牌里",
		error: null,
	};
}

function quality(options: {
	side: "accepted" | "abandoned";
	originality: number;
}): QualityRecord {
	return {
		sampleId: SECRET_SAMPLE,
		storyId: SECRET_STORY,
		kind: "reroll",
		side: options.side,
		attempts: 1,
		usage: USAGE,
		model: "judge-alias",
		createdAt: "2026-11-08T03:10:00.000Z",
		status: "done",
		scores: {
			originality: options.originality,
			character: 3,
			pacing: 4,
			dialogue: 5,
		},
		reason: "理由不能出现在记分牌里",
		error: null,
	};
}

function forgettingRun(): ForgettingRunResult {
	return {
		story: SECRET_STORY,
		corpus: "benchmark",
		headNodeId: "head",
		profile: "native",
		model: "rp",
		userModel: "background",
		judgeModel: "judge-alias",
		seed: 1,
		startDepth: 150,
		endDepth: 170,
		rounds: 20,
		completedRounds: 20,
		failedRounds: 0,
		generatedAt: "2026-11-08T04:00:00.000Z",
		playtestPath: null,
		inRunProbes: {
			done: 0,
			consistent: 0,
			contradicted: 0,
			unknown: 0,
			failed: 0,
			skipped: 0,
		},
		questions: [],
	};
}

function b1Sample(): HistoricalReplaySample {
	return {
		sampleId: SECRET_SAMPLE,
		storyId: SECRET_STORY,
		profile: "native",
		branchNodeId: "branch",
		branchFloor: 201,
		historicalNodeId: "historical",
		generatedNodeId: "generated",
		writerModel: "rp",
		writerModelId: "gemini-3.8-flash-medium",
		judgeModel: "judge-alias",
		historicalModel: "other-model",
		sameModel: false,
		sameFamily: false,
		prefixFloors: 201,
		rounds: 1,
		interval: 100,
		maxBranchPointsPerStory: 2,
		originalHeadNodeId: "head",
		memory: true,
		director: false,
		temperature: 0.8,
		maxTokens: 4096,
		reasoning: "low",
		budgetTokens: 12_000,
		createdAt: "2026-11-08T05:00:00.000Z",
	};
}

function b1Record(
	order: "generated-first" | "historical-first",
): HistoricalReplayRecord {
	return {
		sampleId: SECRET_SAMPLE,
		storyId: SECRET_STORY,
		profile: "native",
		order,
		attempts: 1,
		usage: USAGE,
		model: "judge-alias",
		createdAt: "2026-11-08T05:10:00.000Z",
		status: "done",
		winner: "A",
		reason: "理由不能出现在记分牌里",
		error: null,
	};
}

function buildFixture() {
	return buildScoreboard({
		phase: "R2",
		playtests: [
			doneRecord({
				round: 1,
				profile: "native",
				model: "fake-writer",
				startedAt: "2026-11-08T02:00:00.000Z",
				firstTokenMs: 100,
				truncated: false,
				unfinishedRatio: 0.5,
				promptTokens: 100,
				completionTokens: 50,
				totalTokens: 150,
				assistant: "山门缓缓打开，石阶上留着新鲜的水痕。",
			}),
			doneRecord({
				round: 2,
				profile: "native",
				model: "fake-writer",
				startedAt: "2026-11-08T02:01:00.000Z",
				firstTokenMs: 300,
				truncated: true,
				unfinishedRatio: 0.1,
				promptTokens: 300,
				completionTokens: 150,
				totalTokens: 450,
				assistant: "山门开了一道缝，风从里面吹出来。",
			}),
			failedRecord("naive"),
		],
		pairwiseRecords: [
			comparison({
				sampleId: "sample-later",
				order: "accepted-first",
				winner: "A",
				earlierSwipe: false,
			}),
			comparison({
				sampleId: "sample-later",
				order: "abandoned-first",
				winner: "B",
				earlierSwipe: false,
			}),
			comparison({
				sampleId: "sample-earlier",
				order: "accepted-first",
				winner: "B",
				earlierSwipe: true,
			}),
			comparison({
				sampleId: "sample-earlier",
				order: "abandoned-first",
				winner: "A",
				earlierSwipe: true,
			}),
		],
		pairwiseQuality: [
			quality({ side: "accepted", originality: 4 }),
			quality({ side: "abandoned", originality: 2 }),
		],
		forgettingRuns: [forgettingRun()],
		b1Samples: [b1Sample()],
		b1Records: [b1Record("generated-first"), b1Record("historical-first")],
		b1Quality: [
			{
				...quality({ side: "accepted", originality: 5 }),
				kind: "historical",
			},
			{
				...quality({ side: "abandoned", originality: 1 }),
				kind: "historical",
			},
		],
	});
}

describe("scoreboard", () => {
	it("按档位与模型汇总试玩指标", () => {
		const rows = summarizePlaytests(
			[
				doneRecord({
					round: 2,
					profile: "native",
					model: "fake-writer",
					startedAt: "2026-11-08T02:01:00.000Z",
					firstTokenMs: 300,
					truncated: true,
					unfinishedRatio: 0.1,
					promptTokens: 300,
					completionTokens: 150,
					totalTokens: 450,
					assistant: "山门开了一道缝。",
				}),
				doneRecord({
					round: 1,
					profile: "native",
					model: "fake-writer",
					startedAt: "2026-11-08T02:00:00.000Z",
					firstTokenMs: 100,
					truncated: false,
					unfinishedRatio: 0.5,
					promptTokens: 100,
					completionTokens: 50,
					totalTokens: 150,
					assistant: "山门缓缓打开。",
				}),
				failedRecord("native"),
			],
			new Map([["native", ["rp"]]]),
		);
		const native = rows.find((row) => row.profile === "native");
		if (native === undefined) throw new Error("缺少 native 行");
		expect(native.model).toBe("rp（fake-writer）");
		expect(native.stories).toBe(1);
		expect(native.rounds).toBe(2);
		expect(native.failedRounds).toBe(1);
		expect(native.firstTokenP50).toBe(100);
		expect(native.firstTokenP95).toBe(300);
		expect(native.truncationRate).toBe(0.5);
		expect(native.gapUnfinishedRate).toBeCloseTo(0.3);
		expect(native.promptTokensPerRound).toBe(200);
		expect(native.completionTokensPerRound).toBe(100);
		expect(native.totalTokensPerRound).toBe(300);
		expect(native.repetition).not.toBeNull();
	});

	it("汇总偏好一致率时把切回较早 swipe 单列", () => {
		const scoreboard = buildFixture();
		const preference = scoreboard.preference;
		if (preference === null) throw new Error("缺少偏好汇总");
		const overall = preference.groups.find((group) =>
			group.group.startsWith("总体"),
		);
		const earlier = preference.groups.find(
			(group) => group.group === "重 roll：切回较早 swipe",
		);
		expect(overall).toMatchObject({ samples: 1, completed: 1 });
		expect(overall?.preferenceConsistency).toBe(1);
		expect(earlier).toMatchObject({ samples: 1, completed: 1 });
		expect(earlier?.acceptedShare).toBe(0);
	});

	it("汇总遗忘分层与叙事质量四项均值", () => {
		const scoreboard = buildFixture();
		const layers = scoreboard.forgetting?.layers ?? [];
		expect(layers).toHaveLength(1);
		expect(layers[0]).toMatchObject({
			corpus: "benchmark",
			depthLayer: "100-199",
			profile: "native",
			runCount: 1,
			rounds: 20,
		});
		const pairwise = scoreboard.quality.find(
			(section) => section.source === "pairwise",
		);
		const accepted = pairwise?.summary.bySide.find(
			(group) => group.side === "accepted",
		);
		const originality = accepted?.dimensions.find(
			(dimension) => dimension.dimension === "originality",
		);
		expect(originality?.mean).toBe(4);
	});

	it("生成的记分牌可重复且不含私有标识与正文", () => {
		const first = renderScoreboard(buildFixture());
		const second = renderScoreboard(buildFixture());
		expect(second).toBe(first);
		expect(first).toContain("## 试玩指标");
		expect(first).toContain("## 偏好一致率");
		expect(first).toContain("## 一致性与记忆");
		expect(first).toContain("## 叙事质量");
		expect(first).toContain("## B1 历史回放");
		expect(first).toContain("同模型子集为空");
		expect(first).not.toContain(SECRET_STORY);
		expect(first).not.toContain(SECRET_SAMPLE);
		expect(first).not.toContain(SECRET_TEXT);
		expect(first).not.toContain("理由不能出现在记分牌里");
	});

	it("输入顺序不影响结果", () => {
		const forward = buildFixture();
		const reversed = buildScoreboard({
			phase: "R2",
			playtests: [
				doneRecord({
					round: 1,
					profile: "native",
					model: "fake-writer",
					startedAt: "2026-11-08T02:00:00.000Z",
					firstTokenMs: 100,
					truncated: false,
					unfinishedRatio: 0.5,
					promptTokens: 100,
					completionTokens: 50,
					totalTokens: 150,
					assistant: "山门缓缓打开，石阶上留着新鲜的水痕。",
				}),
				doneRecord({
					round: 2,
					profile: "native",
					model: "fake-writer",
					startedAt: "2026-11-08T02:01:00.000Z",
					firstTokenMs: 300,
					truncated: true,
					unfinishedRatio: 0.1,
					promptTokens: 300,
					completionTokens: 150,
					totalTokens: 450,
					assistant: "山门开了一道缝，风从里面吹出来。",
				}),
				failedRecord("naive"),
			].reverse() as PlaytestRecord[],
			pairwiseRecords: [
				comparison({
					sampleId: "sample-earlier",
					order: "abandoned-first",
					winner: "A",
					earlierSwipe: true,
				}),
				comparison({
					sampleId: "sample-later",
					order: "abandoned-first",
					winner: "B",
					earlierSwipe: false,
				}),
				comparison({
					sampleId: "sample-earlier",
					order: "accepted-first",
					winner: "B",
					earlierSwipe: true,
				}),
				comparison({
					sampleId: "sample-later",
					order: "accepted-first",
					winner: "A",
					earlierSwipe: false,
				}),
			],
			pairwiseQuality: [
				quality({ side: "abandoned", originality: 2 }),
				quality({ side: "accepted", originality: 4 }),
			],
			forgettingRuns: [forgettingRun()],
			b1Samples: [b1Sample()],
			b1Records: [b1Record("historical-first"), b1Record("generated-first")],
			b1Quality: [
				{
					...quality({ side: "abandoned", originality: 1 }),
					kind: "historical",
				},
				{
					...quality({ side: "accepted", originality: 5 }),
					kind: "historical",
				},
			],
		});
		expect(renderScoreboard(reversed)).toBe(renderScoreboard(forward));
	});

	it("命令行从 JSONL 生成逐字节相同的记分牌", async () => {
		const dir = makeDir(".tmp-scoreboard-");
		const playtestPath = path.join(dir, "playtest.jsonl");
		const forgettingPath = path.join(dir, "forgetting.json");
		const b1Dir = path.join(dir, "b1");
		const b1SamplesPath = path.join(b1Dir, "samples.jsonl");
		const b1RecordsPath = path.join(b1Dir, "records.jsonl");
		const b1QualityPath = path.join(b1Dir, "quality.jsonl");
		const outPath = path.join(dir, "SCOREBOARD.md");
		const sample = b1Sample();
		const records = [b1Record("generated-first"), b1Record("historical-first")];
		const qualityRecords = [
			{ ...quality({ side: "accepted", originality: 5 }), kind: "historical" },
			{ ...quality({ side: "abandoned", originality: 1 }), kind: "historical" },
		];
		await writeFile(
			playtestPath,
			`${JSON.stringify(
				doneRecord({
					round: 1,
					profile: "native",
					model: "fake-writer",
					startedAt: "2026-11-08T02:00:00.000Z",
					firstTokenMs: 100,
					truncated: false,
					unfinishedRatio: 0.5,
					promptTokens: 100,
					completionTokens: 50,
					totalTokens: 150,
					assistant: "山门缓缓打开。",
				}),
			)}\n${JSON.stringify(failedRecord("naive"))}\n`,
			"utf8",
		);
		await writeFile(forgettingPath, JSON.stringify(forgettingRun()), "utf8");
		await mkdir(b1Dir, { recursive: true });
		await writeFile(b1SamplesPath, `${JSON.stringify(sample)}\n`, "utf8");
		await writeFile(
			b1RecordsPath,
			`${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
			"utf8",
		);
		await writeFile(
			b1QualityPath,
			`${qualityRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
			"utf8",
		);
		const args = [
			"--playtest",
			playtestPath,
			"--forgetting",
			forgettingPath,
			"--b1-samples",
			b1SamplesPath,
			"--b1-records",
			b1RecordsPath,
			"--b1-quality",
			b1QualityPath,
			"--out",
			outPath,
		];
		const result = await runScoreboardCli(args, { log: () => {} });
		expect(result.playtestRounds).toBe(1);
		expect(result.forgettingRuns).toBe(1);
		expect(result.b1Samples).toBe(1);
		const first = readFileSync(outPath, "utf8");
		await runScoreboardCli(args, { log: () => {} });
		const second = readFileSync(outPath, "utf8");
		expect(second).toBe(first);
		expect(first).not.toContain(SECRET_STORY);
		expect(first).toContain("| naive | 未记录 |");
	}, 30_000);
});
