import { describe, expect, it } from "vitest";
import {
	type R6GateInput,
	R6_B1_MIN_COMPLETED_PAIRS,
	R6_B1_PLANNED_PAIRS,
	R6_B2_MAX_GENERATIONS,
	R6_B2_MAX_PER_ROUND,
	R6_B2_MAX_TOTAL,
	R6_C1_BRANCH_POINTS,
	R6_C1_ROUNDS,
	R6_DEEP_BRANCH_POINTS,
	R6_DEEP_MIN_COMPLETED_PAIRS,
	R6_DEEP_ROUNDS,
	R6_GATE_VERSION,
	R6_HUMAN_LABEL_MAX_POSITION_BIAS,
	R6_HUMAN_LABEL_MIN_AGREEMENT,
	R6_HUMAN_LABEL_MIN_COMPLETED_PAIRS,
	R6_HUMAN_LABEL_PLANNED_PAIRS,
	R6_MAX_BRANCH_POINTS,
	R6_MAX_CONTRADICTION_RATE,
	R6_MAX_EVALUATION_ROUNDS,
	R6_MAX_EXCLUDED_SHARE,
	R6_MAX_INCONSISTENT_SHARE,
	R6_MAX_JUDGE_FAILURE_SHARE,
	R6_MAX_STORY_REPETITION_DELTA,
	R6_MAX_UNDECIDABLE_SHARE,
	R6_MIN_DECIDED_PROBES,
	R6_MIN_PREFERENCE_CONSISTENCY,
	R6_MIN_PREFERENCE_PAIRS,
	R6_MIN_PROGRESS_SAMPLES,
	R6_MIN_REPETITION_PAIRS,
	R6_MIN_REPLAY_ABANDONED_WIN_RATE,
	R6_MIN_REPLAY_ACCEPTED_WIN_RATE,
	R6_MIN_STORY_PROGRESS_DELTA,
	R6_PROBE_INTERVAL_ROUNDS,
	R6_PROBE_MAX_PER_RUN,
	R6_PROBE_MIN_FACT_AGE,
	R6_REPLAY_MIN_COMPLETED_PAIRS,
	R6_REPLAY_MIN_STORY_PAIRS,
	R6_REPLAY_PLANNED_PAIRS,
	R6_SAME_CONFIG_MIN_COMPLETED_PAIRS,
	R6_WARMUP_FLOORS,
	evaluateR6Gates,
	normalizePairOutcome,
	validateR6GateInput,
	wilsonInterval,
} from "../src/evalset/gates.js";

function baseInput(): R6GateInput {
	return {
		instrument: {
			sameConfig: {
				plannedPairs: 43,
				pairs: { wins: 20, losses: 20, ties: 2, inconsistent: 1 },
				failures: 0,
				judgments: { completed: 86, failed: 0 },
			},
			humanLabels: {
				plannedPairs: 195,
				completedPairs: 195,
				acceptedChoices: 286,
				judgments: 390,
				positionA: 211,
				failures: 0,
			},
		},
		replay: {
			abandoned: {
				plannedPairs: 43,
				pairs: { wins: 30, losses: 8, ties: 2, inconsistent: 3 },
				failures: 0,
				stories: [
					{ story: "story-a", completedPairs: 17 },
					{ story: "story-b", completedPairs: 8 },
					{ story: "story-c", completedPairs: 18 },
				],
				judgments: { completed: 86, failed: 0 },
			},
			accepted: {
				plannedPairs: 43,
				pairs: { wins: 20, losses: 18, ties: 3, inconsistent: 2 },
				failures: 0,
				stories: [
					{ story: "story-a", completedPairs: 17 },
					{ story: "story-b", completedPairs: 8 },
					{ story: "story-c", completedPairs: 18 },
				],
				judgments: { completed: 86, failed: 0 },
			},
		},
		repetition: {
			stories: [
				{
					story: "story-a",
					native: { mean: 0.05, samples: 300 },
					naive: { mean: 0.06, samples: 300 },
				},
				{
					story: "story-b",
					native: { mean: 0.05, samples: 300 },
					naive: { mean: 0.06, samples: 300 },
				},
				{
					story: "story-c",
					native: { mean: 0.05, samples: 300 },
					naive: { mean: 0.06, samples: 300 },
				},
			],
		},
		progression: {
			stories: [
				{
					story: "story-a",
					native: { mean: 0.8, samples: 300 },
					naive: { mean: 0.7, samples: 300 },
				},
				{
					story: "story-b",
					native: { mean: 0.8, samples: 300 },
					naive: { mean: 0.7, samples: 300 },
				},
				{
					story: "story-c",
					native: { mean: 0.8, samples: 300 },
					naive: { mean: 0.7, samples: 300 },
				},
			],
		},
		contradiction: {
			consistent: 25,
			contradictory: 5,
			undecidable: 2,
			failed: 1,
		},
		deep: {
			plannedPairs: 24,
			pairs: { wins: 18, losses: 4, ties: 1, inconsistent: 1 },
			failures: 0,
			turns: { completed: 60, failed: 2 },
			toolCalls: 12,
		},
		preference: {
			accepted: 21,
			abandoned: 7,
			ties: 1,
			inconsistent: 1,
			failures: 0,
		},
	};
}

function gate(input: R6GateInput, id: string) {
	const result = evaluateR6Gates(input).gates.find((entry) => entry.id === id);
	if (result === undefined) throw new Error(`缺少门槛 ${id}`);
	return result;
}

describe("R6 预注册 v2 常量", () => {
	it("与 v2 文档逐项一致", () => {
		expect(R6_GATE_VERSION).toBe("v2");
		expect(R6_MAX_BRANCH_POINTS).toBe(10);
		expect(R6_C1_BRANCH_POINTS).toBe(3);
		expect(R6_C1_ROUNDS).toBe(30);
		expect(R6_DEEP_ROUNDS).toBe(20);
		expect(R6_DEEP_BRANCH_POINTS).toBe(8);
		expect(R6_WARMUP_FLOORS).toBe(12);
		expect(R6_PROBE_INTERVAL_ROUNDS).toBe(6);
		expect(R6_PROBE_MIN_FACT_AGE).toBe(10);
		expect(R6_PROBE_MAX_PER_RUN).toBe(5);
		expect(R6_REPLAY_PLANNED_PAIRS).toBe(43);
		expect(R6_REPLAY_MIN_COMPLETED_PAIRS).toBe(36);
		expect(R6_REPLAY_MIN_STORY_PAIRS).toBe(6);
		expect(R6_MIN_REPLAY_ABANDONED_WIN_RATE).toBe(0.6);
		expect(R6_MIN_REPLAY_ACCEPTED_WIN_RATE).toBe(0.45);
		expect(R6_SAME_CONFIG_MIN_COMPLETED_PAIRS).toBe(36);
		expect(R6_HUMAN_LABEL_PLANNED_PAIRS).toBe(195);
		expect(R6_HUMAN_LABEL_MIN_COMPLETED_PAIRS).toBe(165);
		expect(R6_HUMAN_LABEL_MIN_AGREEMENT).toBe(0.65);
		expect(R6_HUMAN_LABEL_MAX_POSITION_BIAS).toBe(0.1);
		expect(R6_B1_PLANNED_PAIRS).toBe(30);
		expect(R6_B1_MIN_COMPLETED_PAIRS).toBe(27);
		expect(R6_DEEP_MIN_COMPLETED_PAIRS).toBe(24);
		expect(R6_MIN_REPETITION_PAIRS).toBe(240);
		expect(R6_MIN_PROGRESS_SAMPLES).toBe(240);
		expect(R6_MIN_DECIDED_PROBES).toBe(30);
		expect(R6_MIN_PREFERENCE_PAIRS).toBe(30);
		expect(R6_MAX_EXCLUDED_SHARE).toBe(0.3);
		expect(R6_MAX_INCONSISTENT_SHARE).toBe(0.2);
		expect(R6_MAX_JUDGE_FAILURE_SHARE).toBe(0.1);
		expect(R6_MAX_STORY_REPETITION_DELTA).toBe(0.01);
		expect(R6_MIN_STORY_PROGRESS_DELTA).toBe(-0.02);
		expect(R6_MAX_CONTRADICTION_RATE).toBe(0.3);
		expect(R6_MAX_UNDECIDABLE_SHARE).toBe(0.5);
		expect(R6_MIN_PREFERENCE_CONSISTENCY).toBe(0.6);
		expect(R6_MAX_EVALUATION_ROUNDS).toBe(3);
		expect(R6_B2_MAX_GENERATIONS).toBe(60);
		expect(R6_B2_MAX_PER_ROUND).toBe(1);
		expect(R6_B2_MAX_TOTAL).toBe(2);
	});
});

describe("Wilson 区间", () => {
	it("计数为 0 时返回 null", () => {
		expect(wilsonInterval(0, 0)).toBeNull();
	});

	it("0 与全胜的边界", () => {
		const none = wilsonInterval(0, 10);
		expect(none?.lower).toBe(0);
		expect(none?.upper).toBeCloseTo(0.2775, 4);
		const all = wilsonInterval(10, 10);
		expect(all?.lower).toBeCloseTo(0.7225, 4);
		expect(all?.upper).toBe(1);
	});

	it("27/27 的下界高于 0.5", () => {
		const interval = wilsonInterval(27, 27);
		expect(interval?.lower).toBeCloseTo(0.8754, 4);
	});

	it("成功数大于总数时抛错", () => {
		expect(() => wilsonInterval(11, 10)).toThrow(/不能大于/);
	});
});

describe("配对归一", () => {
	it("覆盖四种配对结果", () => {
		expect(normalizePairOutcome("candidate", "candidate")).toBe("win");
		expect(normalizePairOutcome("baseline", "baseline")).toBe("loss");
		expect(normalizePairOutcome("tie", "tie")).toBe("tie");
		expect(normalizePairOutcome("candidate", "baseline")).toBe("inconsistent");
		expect(normalizePairOutcome("candidate", "tie")).toBe("inconsistent");
		expect(normalizePairOutcome("tie", "baseline")).toBe("inconsistent");
	});
});

describe("门槛判定", () => {
	it("完整输入下 G0 至 G6 全部通过", () => {
		const report = evaluateR6Gates(baseInput());
		expect(report.passed).toBe(true);
		expect(report.failed).toEqual([]);
		expect(report.insufficient).toEqual([]);
		expect(report.invalid).toEqual([]);
		expect(report.notMeasurable).toEqual([]);
		expect(report.gates.map((entry) => entry.id)).toEqual([
			"G0",
			"G1",
			"G2",
			"G3",
			"G4",
			"G5",
			"G6",
		]);
		for (const gateResult of report.gates) {
			expect(gateResult.status).toBe("pass");
		}
	});

	it("同一批计数重复判定结果相同", () => {
		const input = baseInput();
		expect(evaluateR6Gates(input)).toEqual(evaluateR6Gates(input));
	});

	it("G0 A/A 完成配对不足时样本不足", () => {
		const input = baseInput();
		input.instrument.sameConfig.pairs = {
			wins: 15,
			losses: 15,
			ties: 2,
			inconsistent: 1,
		};
		input.instrument.sameConfig.judgments = { completed: 66, failed: 0 };
		expect(gate(input, "G0").status).toBe("insufficient");
	});

	it("G0 A/A 胜率区间不含 50% 时未通过", () => {
		const input = baseInput();
		input.instrument.sameConfig.pairs = {
			wins: 32,
			losses: 4,
			ties: 3,
			inconsistent: 1,
		};
		input.instrument.sameConfig.judgments = { completed: 80, failed: 0 };
		const result = gate(input, "G0");
		expect(result.status).toBe("fail");
		expect(result.reason).toMatch(/不包含 50%/);
	});

	it("G0 真人标注一致率低于 65% 时未通过", () => {
		const input = baseInput();
		input.instrument.humanLabels.acceptedChoices = 240;
		const result = gate(input, "G0");
		expect(result.status).toBe("fail");
		expect(result.reason).toMatch(/真人标注一致率/);
	});

	it("G0 真人标注位置偏差超过 10 个百分点时未通过", () => {
		const input = baseInput();
		input.instrument.humanLabels.positionA = 240;
		const result = gate(input, "G0");
		expect(result.status).toBe("fail");
		expect(result.reason).toMatch(/位置偏差/);
	});

	it("G0 未通过时 G1 与 G5 记为仪器无效", () => {
		const input = baseInput();
		input.instrument.sameConfig.pairs = {
			wins: 32,
			losses: 4,
			ties: 3,
			inconsistent: 1,
		};
		input.instrument.sameConfig.judgments = { completed: 80, failed: 0 };
		const report = evaluateR6Gates(input);
		expect(report.passed).toBe(false);
		expect(report.failed).toEqual(["G0"]);
		expect(report.invalid).toEqual(["G1", "G5"]);
		expect(gate(input, "G1").status).toBe("invalid");
		expect(gate(input, "G1").reason).toMatch(/仪器无效/);
		expect(gate(input, "G5").status).toBe("invalid");
		expect(gate(input, "G2").status).toBe("pass");
	});

	it("G1 对放弃侧完成配对不足时样本不足", () => {
		const input = baseInput();
		input.replay.abandoned.pairs = {
			wins: 20,
			losses: 5,
			ties: 2,
			inconsistent: 1,
		};
		input.replay.abandoned.stories = [
			{ story: "story-a", completedPairs: 17 },
			{ story: "story-b", completedPairs: 8 },
			{ story: "story-c", completedPairs: 3 },
		];
		input.replay.abandoned.judgments = { completed: 56, failed: 0 };
		expect(gate(input, "G1").status).toBe("insufficient");
	});

	it("G1 任一故事完成配对少于 6 对时样本不足", () => {
		const input = baseInput();
		input.replay.abandoned.pairs = {
			wins: 30,
			losses: 8,
			ties: 2,
			inconsistent: 3,
		};
		input.replay.abandoned.stories = [
			{ story: "story-a", completedPairs: 32 },
			{ story: "story-b", completedPairs: 5 },
			{ story: "story-c", completedPairs: 6 },
		];
		const result = gate(input, "G1");
		expect(result.status).toBe("insufficient");
		expect(result.reason).toMatch(/story-b 完成 5/);
	});

	it("G1 对放弃侧胜率低于 60% 时未通过", () => {
		const input = baseInput();
		input.replay.abandoned.pairs = {
			wins: 22,
			losses: 16,
			ties: 2,
			inconsistent: 3,
		};
		const result = gate(input, "G1");
		expect(result.status).toBe("fail");
		expect(result.reason).toMatch(/对放弃侧胜率/);
	});

	it("G1 对接受侧胜率低于 45% 时未通过", () => {
		const input = baseInput();
		input.replay.accepted.pairs = {
			wins: 15,
			losses: 22,
			ties: 3,
			inconsistent: 3,
		};
		const result = gate(input, "G1");
		expect(result.status).toBe("fail");
		expect(result.reason).toMatch(/对接受侧胜率/);
	});

	it("G2 原生档样本不足时样本不足", () => {
		const input = baseInput();
		for (const story of input.repetition.stories) {
			story.native.samples = 79;
		}
		expect(gate(input, "G2").status).toBe("insufficient");
	});

	it("G2 任一故事差值超过 +0.010 时未通过", () => {
		const input = baseInput();
		input.repetition.stories[1].native.mean = 0.071;
		expect(gate(input, "G2").status).toBe("fail");
		expect(gate(input, "G2").reason).toMatch(/story-b/);
	});

	it("G3 任一故事差值低于 -0.020 时未通过", () => {
		const input = baseInput();
		input.progression.stories[2].native.mean = 0.679;
		expect(gate(input, "G3").status).toBe("fail");
		expect(gate(input, "G3").reason).toMatch(/story-c/);
	});

	it("G4 可判定探针少于 30 条时样本不足", () => {
		const input = baseInput();
		input.contradiction = {
			consistent: 24,
			contradictory: 5,
			undecidable: 2,
			failed: 1,
		};
		expect(gate(input, "G4").status).toBe("insufficient");
	});

	it("G4 矛盾率超过 30% 时未通过", () => {
		const input = baseInput();
		input.contradiction = {
			consistent: 20,
			contradictory: 10,
			undecidable: 2,
			failed: 1,
		};
		expect(gate(input, "G4").status).toBe("fail");
		expect(gate(input, "G4").reason).toMatch(/矛盾率/);
	});

	it("G4 无法判断超过已完成的 50% 时未通过", () => {
		const input = baseInput();
		input.contradiction = {
			consistent: 20,
			contradictory: 10,
			undecidable: 35,
			failed: 1,
		};
		expect(gate(input, "G4").status).toBe("fail");
		expect(gate(input, "G4").reason).toMatch(/无法判断/);
	});

	it("G5 工具调用为 0 时记为不可测且不影响整体通过", () => {
		const input = baseInput();
		input.deep.toolCalls = 0;
		const report = evaluateR6Gates(input);
		expect(gate(input, "G5").status).toBe("not-measurable");
		expect(gate(input, "G5").reason).toMatch(/工具调用为 0/);
		expect(report.notMeasurable).toEqual(["G5"]);
		expect(report.unproven).toEqual(["G5"]);
		expect(report.passed).toBe(true);
	});

	it("G5 完成配对不足时样本不足", () => {
		const input = baseInput();
		input.deep.pairs = { wins: 17, losses: 4, ties: 1, inconsistent: 1 };
		expect(gate(input, "G5").status).toBe("insufficient");
	});

	it("G5 深回合失败率超过 10% 时未通过", () => {
		const input = baseInput();
		input.deep.turns = { completed: 50, failed: 10 };
		expect(gate(input, "G5").status).toBe("fail");
		expect(gate(input, "G5").reason).toMatch(/深回合失败率/);
	});

	it("G6 少于 30 对时记为未证实且不影响整体通过", () => {
		const input = baseInput();
		input.preference = {
			accepted: 15,
			abandoned: 5,
			ties: 1,
			inconsistent: 1,
			failures: 0,
		};
		const report = evaluateR6Gates(input);
		expect(gate(input, "G6").status).toBe("insufficient");
		expect(gate(input, "G6").reason).toMatch(/未证实/);
		expect(report.unproven).toEqual(["G6"]);
		expect(report.passed).toBe(true);
	});

	it("G6 一致率低于 60% 时未通过", () => {
		const input = baseInput();
		input.preference = {
			accepted: 15,
			abandoned: 13,
			ties: 1,
			inconsistent: 1,
			failures: 0,
		};
		const report = evaluateR6Gates(input);
		expect(gate(input, "G6").status).toBe("fail");
		expect(report.passed).toBe(false);
	});

	it("缺项时抛错并指出字段", () => {
		const input = baseInput() as unknown as {
			contradiction: Record<string, unknown>;
		};
		input.contradiction.failed = undefined;
		expect(() => validateR6GateInput(input as unknown as R6GateInput)).toThrow(
			/contradiction.failed/,
		);

		const missingPairs = baseInput() as unknown as {
			instrument: { sameConfig: Record<string, unknown> };
		};
		missingPairs.instrument.sameConfig.pairs = undefined;
		expect(() =>
			evaluateR6Gates(missingPairs as unknown as R6GateInput),
		).toThrow(/instrument\.sameConfig\.pairs/);

		const missingToolCalls = baseInput() as unknown as {
			deep: Record<string, unknown>;
		};
		missingToolCalls.deep.toolCalls = undefined;
		expect(() =>
			validateR6GateInput(missingToolCalls as unknown as R6GateInput),
		).toThrow(/deep\.toolCalls/);
	});

	it("故事完成数合计与配对合计不一致时抛错", () => {
		const input = baseInput();
		input.replay.abandoned.stories[0].completedPairs = 9;
		input.replay.abandoned.stories[1].completedPairs = 9;
		input.replay.abandoned.stories[2].completedPairs = 9;
		expect(() => validateR6GateInput(input)).toThrow(/不一致/);
	});

	it("每对两种顺序都要有判定记录", () => {
		const input = baseInput();
		input.instrument.sameConfig.judgments.completed = 85;
		expect(() => validateR6GateInput(input)).toThrow(/至少应为 86/);
	});

	it("真人标注的选择次数不能超过成功判断次数", () => {
		const input = baseInput();
		input.instrument.humanLabels.acceptedChoices = 391;
		expect(() => validateR6GateInput(input)).toThrow(
			/humanLabels\.acceptedChoices/,
		);
	});
});
