import { describe, expect, it } from "vitest";
import {
	type OpeningEvalCandidateMeta,
	type OpeningEvalInput,
	type OpeningEvalManifest,
	type OpeningEvalRunMeta,
	parseCandidateChoice,
	renderOpeningEvalReport,
	summarizeOpeningEval,
} from "../src/evalset/opening-eval.js";
import type { PlaytestRecord } from "../src/evalset/playtest.js";

function runMeta(
	cardIndex: number,
	config: "opening" | "baseline",
	error: string | null = null,
): OpeningEvalRunMeta {
	return {
		runId: `card-${cardIndex}-${config}`,
		cardIndex,
		cardLabel: `私有卡 ${cardIndex}`,
		config,
		storyId: `私有故事 ${cardIndex}-${config}`,
		openingFloors: config === "opening" ? 10 : 0,
		openingPack: config === "opening",
		path: `card-${cardIndex}-${config}.jsonl`,
		error,
	};
}

function record(
	round: number,
	options: {
		readonly reroll?: boolean;
		readonly followed?: boolean;
		readonly verdict?: "done" | "failed";
		readonly firstTokenMs?: number | null;
		readonly truncated?: boolean;
	} = {},
): PlaytestRecord {
	const verdict =
		options.verdict === "failed"
			? {
					status: "failed" as const,
					reroll: null,
					followed: null,
					reason: null,
					attempts: 3,
					usage: null,
					error: "裁判失败",
				}
			: {
					status: "done" as const,
					reroll: options.reroll ?? false,
					followed: options.followed ?? true,
					reason: `私有理由 ${round}`,
					attempts: 1,
					usage: null,
				};
	return {
		status: "done",
		round,
		storyId: "私有故事",
		profile: "native",
		seed: 1,
		startedAt: "2026-11-08T00:00:00.000Z",
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
		verdict,
		userNodeId: `u-${round}`,
		nodeId: `a-${round}`,
		traceNodeId: `a-${round}`,
		user: `私有输入 ${round}`,
		assistant: `私有正文 ${round}`,
		userHint: "私有提示",
		firstTokenMs:
			options.firstTokenMs === undefined ? 1_000 + round : options.firstTokenMs,
		durationMs: 2_000,
		usage: {
			promptTokens: 10,
			completionTokens: 20,
			totalTokens: 30,
			reasoningTokens: 0,
			cachedTokens: 0,
		},
		ledgerDiffCount: 0,
		newClues: 0,
		fulfilledClues: 0,
		director: null,
		trace: {} as never,
		truncated: options.truncated ?? false,
		drain: null,
	} as unknown as PlaytestRecord;
}

function manifest(
	runs: readonly OpeningEvalRunMeta[],
	candidates: readonly OpeningEvalCandidateMeta[],
): OpeningEvalManifest {
	return {
		generatedAt: "2026-11-08T00:00:00.000Z",
		seed: 1,
		rounds: 10,
		assistantModel: "main-fallback",
		userModel: "background",
		judgeModel: "codex",
		runs,
		candidates,
	};
}

function candidate(
	cardIndex: number,
	choice: number | null,
	status: "done" | "failed" = "done",
): OpeningEvalCandidateMeta {
	return {
		cardIndex,
		cardLabel: `私有卡 ${cardIndex}`,
		storyId: `私有候选故事 ${cardIndex}`,
		status,
		candidateCount: 3,
		candidates: ["私有候选甲", "私有候选乙", "私有候选丙"],
		choice,
		reason: "私有理由",
		error: status === "failed" ? "私有错误" : null,
	};
}

function input(): OpeningEvalInput {
	const opening = runMeta(1, "opening");
	const baseline = runMeta(1, "baseline");
	return {
		manifest: manifest(
			[opening, baseline],
			[candidate(1, 2), candidate(2, null), candidate(3, null, "failed")],
		),
		runs: [
			{
				meta: opening,
				records: [
					record(1, { reroll: true, followed: false }),
					record(2, { reroll: false, followed: true }),
					record(3, { verdict: "failed", truncated: true }),
					record(11, { reroll: true, followed: true }),
				],
			},
			{
				meta: baseline,
				records: [
					record(1, { reroll: false, followed: true }),
					record(2, { reroll: true, followed: true }),
				],
			},
		],
	};
}

describe("开局评测报告", () => {
	it("按配置聚合重 roll、指令遵循、前 5 轮与首字延迟", () => {
		const summary = summarizeOpeningEval(input());
		expect(summary.opening.judged).toBe(3);
		expect(summary.opening.rerolled).toBe(2);
		expect(summary.opening.followed).toBe(2);
		expect(summary.opening.verdictFailed).toBe(1);
		expect(summary.opening.rerollRate).toBeCloseTo(2 / 3);
		expect(summary.opening.followedRate).toBeCloseTo(2 / 3);
		expect(summary.opening.early.judged).toBe(2);
		expect(summary.opening.early.rerolled).toBe(1);
		expect(summary.opening.early.rerollRate).toBeCloseTo(0.5);
		expect(summary.opening.firstTokenP50).toBe(1_002);
		expect(summary.opening.firstTokenP90).toBe(1_011);
		expect(summary.opening.truncations).toBe(1);
		expect(summary.baseline.judged).toBe(2);
		expect(summary.baseline.rerolled).toBe(1);
		expect(summary.baseline.rerollRate).toBeCloseTo(0.5);
	});

	it("配置差异说明进入报告头，缺省时不出现", () => {
		const summary = summarizeOpeningEval(input());
		const withoutNote = renderOpeningEvalReport(summary, {
			privateDetails: false,
		});
		expect(withoutNote).not.toContain("配置差异");
		const withNote = renderOpeningEvalReport(
			{
				...summary,
				manifest: { ...summary.manifest, note: "写作模型换成 rp" },
			},
			{ privateDetails: false },
		);
		expect(withNote).toContain("- 配置差异：写作模型换成 rp");
	});

	it("并列渲染历史运行的聚合数字", () => {
		const summary = summarizeOpeningEval(input());
		const prior = {
			runs: 3,
			runErrors: 0,
			roundsCompleted: 30,
			roundsFailed: 0,
			judged: 30,
			rerolled: 3,
			rerollRate: 0.1,
			followed: 29,
			followedRate: 29 / 30,
			earlyJudged: 15,
			earlyRerollRate: 2 / 15,
			verdictFailed: 0,
			firstTokenP50: 3_359,
			firstTokenP90: 7_513,
			truncations: 0,
		};
		const report = renderOpeningEvalReport(
			{
				...summary,
				manifest: {
					...summary.manifest,
					previousRuns: [
						{
							label: "首次运行",
							assistantModel: "main-fallback",
							userModel: "background",
							judgeModel: "rp",
							opening: {
								...prior,
								config: "opening",
								rerolled: 1,
								rerollRate: 1 / 30,
							},
							baseline: { ...prior, config: "baseline" },
							candidates: {
								cards: 3,
								generated: 3,
								failed: 0,
								adopted: 3,
								none: 0,
								adoptionRate: 1,
								choices: [1, 2, 2],
							},
						},
					],
				},
			},
			{ privateDetails: false },
		);
		expect(report).toContain("### 首次运行");
		expect(report).toContain("main-fallback");
		expect(report).toContain(
			"| 开局开启 | 3 | 0 | 30 | 0 | 30 | 1 | 3.3% | 29 | 96.7% |",
		);
		expect(report).toContain(
			"| 开局关闭 | 3 | 0 | 30 | 0 | 30 | 3 | 10.0% | 29 | 96.7% |",
		);
	});

	it("候选采用率排除生成失败的卡", () => {
		const summary = summarizeOpeningEval(input());
		expect(summary.candidates.cards).toBe(3);
		expect(summary.candidates.generated).toBe(2);
		expect(summary.candidates.failed).toBe(1);
		expect(summary.candidates.adopted).toBe(1);
		expect(summary.candidates.none).toBe(1);
		expect(summary.candidates.adoptionRate).toBeCloseTo(0.5);
		expect(summary.candidates.choices).toEqual([2]);
	});

	it("统计版不含卡名、故事 id、理由与候选正文，重复生成逐字节相同", () => {
		const summary = summarizeOpeningEval(input());
		const first = renderOpeningEvalReport(summary, { privateDetails: false });
		const second = renderOpeningEvalReport(summary, { privateDetails: false });
		expect(second).toBe(first);
		for (const privateText of [
			"私有卡",
			"私有故事",
			"私有理由",
			"私有候选",
			"私有输入",
			"私有正文",
			"私有错误",
		]) {
			expect(first).not.toContain(privateText);
		}
		expect(first).toContain("main-fallback");
		expect(first).toContain("66.7%");
	});

	it("私有版附逐轮理由、卡名与候选正文", () => {
		const summary = summarizeOpeningEval(input());
		const report = renderOpeningEvalReport(summary, { privateDetails: true });
		expect(report).toContain("私有卡 1");
		expect(report).toContain("私有理由 1");
		expect(report).toContain("私有候选甲");
		expect(report).toContain("裁判失败");
	});

	it("严格解析候选选择", () => {
		expect(parseCandidateChoice('{"choice":2,"reason":"好"}', 3)).toEqual({
			choice: 2,
			reason: "好",
		});
		expect(
			parseCandidateChoice('{"choice":"none","reason":"自己写"}', 3),
		).toEqual({ choice: null, reason: "自己写" });
		expect(parseCandidateChoice('{"choice":4,"reason":"好"}', 3)).toBeNull();
		expect(parseCandidateChoice('{"choice":0,"reason":"好"}', 3)).toBeNull();
		expect(parseCandidateChoice('{"choice":2,"reason":""}', 3)).toBeNull();
		expect(
			parseCandidateChoice('{"choice":2,"reason":"好","extra":1}', 3),
		).toBeNull();
		expect(parseCandidateChoice("[]", 3)).toBeNull();
	});
});
