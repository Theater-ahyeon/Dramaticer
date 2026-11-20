import { describe, expect, it } from "vitest";
import {
	LENIENCY_MARGIN,
	MIN_PLAYTEST_SAMPLES,
	renderR2JudgeSection,
	summarizeTurnComparison,
} from "./r2-judge-lib.mjs";

function verdict(reroll, followed = true) {
	return {
		status: "done",
		reroll,
		followed,
		reason: "测试",
		attempts: 1,
		usage: null,
	};
}

function failedVerdict() {
	return {
		status: "failed",
		reroll: null,
		followed: null,
		reason: null,
		attempts: 3,
		usage: null,
		error: "测试失败",
	};
}

function repeated(count, value) {
	return Array.from({ length: count }, () => value);
}

const calibrationSummary = {
	pairs: 2,
	judgements: {
		judgements: 4,
		accepted: 3,
		agreement: 0.75,
		agreementInterval: { low: 0.3, high: 0.95 },
		positionA: 2,
		positionAShare: 0.5,
		positionAInterval: { low: 0.15, high: 0.85 },
		positionDeviation: 0,
	},
	perOrder: [
		{
			order: "rejected-first",
			judgements: 2,
			accepted: 2,
			agreement: 1,
			agreementInterval: { low: 0.2, high: 1 },
			positionA: 0,
			positionAShare: 0,
		},
		{
			order: "accepted-first",
			judgements: 2,
			accepted: 1,
			agreement: 0.5,
			agreementInterval: { low: 0.05, high: 0.95 },
			positionA: 2,
			positionAShare: 1,
		},
	],
	consistency: {
		pairs: 2,
		consistent: 1,
		rate: 0.5,
		interval: { low: 0.05, high: 0.95 },
	},
	groups: [
		{
			label: "全部样本",
			judgedPairs: 2,
			judgements: 4,
			accepted: 3,
			agreement: 0.75,
			agreementInterval: { low: 0.3, high: 0.95 },
			positionA: 2,
			positionAShare: 0.5,
			positionDeviation: 0,
			consistency: {
				pairs: 2,
				consistent: 1,
				rate: 0.5,
				interval: { low: 0.05, high: 0.95 },
			},
		},
	],
	thresholds: {
		agreement: 0.65,
		positionBias: 0.1,
		agreementPassed: true,
		positionPassed: true,
		passed: true,
	},
};

const meta = {
	generatedAt: "2026-11-08T00:00:00.000Z",
	judgeModel: "auto/glm-5.3",
	availablePairs: 285,
	failedJudgements: 0,
	cost: {
		requests: 4,
		cacheHits: 0,
		retries: 0,
		usage: { promptTokens: 10, completionTokens: 2, reasoningTokens: 0 },
	},
	duplicatePrompts: { requests: 4, unique: 4, duplicates: 0 },
	playtestProfile: "naive",
	playtestWriterModel: "rp",
	playtestUserModel: "background",
};

describe("summarizeTurnComparison", () => {
	it("统计重 roll 一致率、跟随指令一致率与宽松差", () => {
		const judge = [
			verdict(true),
			verdict(false),
			verdict(false, false),
			verdict(false),
		];
		const reference = [
			verdict(true),
			verdict(true),
			verdict(false, true),
			verdict(false),
		];
		const summary = summarizeTurnComparison(judge, reference);
		expect(summary.pairs).toBe(4);
		expect(summary.rerollAgreement.count).toBe(3);
		expect(summary.rerollAgreement.rate).toBe(0.75);
		expect(summary.followedAgreement.count).toBe(3);
		expect(summary.missedReroll).toBe(1);
		expect(summary.extraReroll).toBe(0);
		expect(summary.judgeReroll.rate).toBe(0.25);
		expect(summary.referenceReroll.rate).toBe(0.5);
		expect(summary.rerollDifference).toBe(-0.25);
		expect(summary.sufficientlySampled).toBe(false);
		expect(summary.lenient).toBe(false);
	});

	it(`样本达到 ${MIN_PLAYTEST_SAMPLES} 条且裁判重 roll 率低 ${LENIENCY_MARGIN * 100} 个百分点以上时判为宽松`, () => {
		const total = MIN_PLAYTEST_SAMPLES;
		const judge = [
			...repeated(total - 4, verdict(false)),
			...repeated(4, verdict(true)),
		];
		const reference = [
			...repeated(total - 10, verdict(false)),
			...repeated(10, verdict(true)),
		];
		const summary = summarizeTurnComparison(judge, reference);
		expect(summary.sufficientlySampled).toBe(true);
		expect(summary.rerollDifference).toBeCloseTo(-0.12);
		expect(summary.lenient).toBe(true);
	});

	it("参考与裁判一致时不算宽松", () => {
		const total = MIN_PLAYTEST_SAMPLES;
		const judge = [
			...repeated(total - 5, verdict(false)),
			...repeated(5, verdict(true)),
		];
		const summary = summarizeTurnComparison(judge, judge.slice());
		expect(summary.lenient).toBe(false);
		expect(summary.rerollAgreement.rate).toBe(1);
	});

	it("失败判定不进入配对统计", () => {
		const summary = summarizeTurnComparison(
			[verdict(true), failedVerdict()],
			[verdict(true), verdict(false)],
		);
		expect(summary.records).toBe(2);
		expect(summary.pairs).toBe(1);
		expect(summary.judgeFailures).toBe(1);
		expect(summary.referenceFailures).toBe(0);
	});

	it("数量不一致时直接失败", () => {
		expect(() =>
			summarizeTurnComparison([verdict(true)], []),
		).toThrow("数量不一致");
	});
});

describe("renderR2JudgeSection", () => {
	const playtest = summarizeTurnComparison(
		repeated(60, verdict(false)),
		[
			...repeated(55, verdict(false)),
			...repeated(5, verdict(true)),
		],
	);

	it("渲染两部分数字与总体判定", () => {
		const text = renderR2JudgeSection({
			calibration: calibrationSummary,
			playtest,
			meta,
		});
		expect(text).toContain("<!-- R2-T03.b:begin -->");
		expect(text).toContain("<!-- R2-T03.b:end -->");
		expect(text).toContain("75.0%");
		expect(text).toContain("auto/glm-5.3");
		expect(text).toContain("重 roll 率差");
		expect(text).toContain("24.9%");
		expect(text).toContain("判定尺度偏宽松");
		expect(text).toContain("不用于重 roll 判定");
	});

	it("配对门槛未达到时给出替代口径", () => {
		const failed = {
			...calibrationSummary,
			thresholds: {
				...calibrationSummary.thresholds,
				agreementPassed: false,
				passed: false,
			},
		};
		const text = renderR2JudgeSection({
			calibration: failed,
			playtest,
			meta,
		});
		expect(text).toContain("配对校准未达门槛");
		expect(text).toContain("确定性指标加配对统计");
	});

	it("样本不足时只报告数字，不判宽松", () => {
		const small = summarizeTurnComparison(
			repeated(10, verdict(false)),
			repeated(10, verdict(true)),
		);
		const text = renderR2JudgeSection({
			calibration: calibrationSummary,
			playtest: small,
			meta,
		});
		expect(text).toContain(`少于 ${MIN_PLAYTEST_SAMPLES} 条`);
		expect(text).not.toContain("判定尺度偏宽松");
	});
});
