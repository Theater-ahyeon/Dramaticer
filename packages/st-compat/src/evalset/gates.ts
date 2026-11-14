/** R6 预注册 v2 的门槛常量与判定；门禁版本随预注册版本变化。 */
export const R6_GATE_VERSION = "v2";

export const R6_WILSON_Z = 1.96;
export const R6_STORY_COUNT = 3;

export const R6_BRANCH_DEPTHS = [
	0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
] as const;
export const R6_MAX_BRANCH_POINTS = 10;
export const R6_C1_BRANCH_POINTS = 3;
export const R6_C1_ROUNDS = 30;
/** 三个源数据库里同一玩家楼层下有多条助手兄弟楼层的点。 */
export const R6_REPLAY_PLANNED_PAIRS = 43;
export const R6_REPLAY_MIN_COMPLETED_PAIRS = 36;
export const R6_REPLAY_MIN_STORY_PAIRS = 6;
/** B1 只作参考样本，不设门槛。 */
export const R6_B1_PLANNED_PAIRS = 30;
export const R6_B1_MIN_COMPLETED_PAIRS = 27;
export const R6_DEEP_ROUNDS = 20;
export const R6_DEEP_BRANCH_POINTS = 8;
export const R6_WARMUP_FLOORS = 12;
export const R6_PROBE_INTERVAL_ROUNDS = 6;
export const R6_PROBE_MIN_FACT_AGE = 10;
export const R6_PROBE_MAX_PER_RUN = 5;

export const R6_DEEP_MIN_COMPLETED_PAIRS = 24;
export const R6_SAME_CONFIG_MIN_COMPLETED_PAIRS = 36;
export const R6_HUMAN_LABEL_PLANNED_PAIRS = 195;
export const R6_HUMAN_LABEL_MIN_COMPLETED_PAIRS = 165;
export const R6_HUMAN_LABEL_MIN_AGREEMENT = 0.65;
export const R6_HUMAN_LABEL_MAX_POSITION_BIAS = 0.1;
export const R6_MIN_REPLAY_ABANDONED_WIN_RATE = 0.6;
export const R6_MIN_REPLAY_ACCEPTED_WIN_RATE = 0.45;
export const R6_MIN_REPETITION_PAIRS = 240;
export const R6_MIN_PROGRESS_SAMPLES = 240;
export const R6_MIN_DECIDED_PROBES = 30;
export const R6_MIN_PREFERENCE_PAIRS = 30;

export const R6_MAX_EXCLUDED_SHARE = 0.3;
export const R6_MAX_INCONSISTENT_SHARE = 0.2;
export const R6_MAX_JUDGE_FAILURE_SHARE = 0.1;
export const R6_MAX_STORY_REPETITION_DELTA = 0.01;
export const R6_MIN_STORY_PROGRESS_DELTA = -0.02;
export const R6_MAX_CONTRADICTION_RATE = 0.3;
export const R6_MAX_UNDECIDABLE_SHARE = 0.5;
export const R6_MIN_PREFERENCE_CONSISTENCY = 0.6;
export const R6_MIN_WIN_RATE = 0.5;

export const R6_MAX_EVALUATION_ROUNDS = 3;
export const R6_B2_MAX_GENERATIONS = 60;
export const R6_B2_MAX_PER_ROUND = 1;
export const R6_B2_MAX_TOTAL = 2;

export const R6_GATE_IDS = ["G0", "G1", "G2", "G3", "G4", "G5", "G6"] as const;
export type R6GateId = (typeof R6_GATE_IDS)[number];
export type R6GateStatus =
	| "pass"
	| "fail"
	| "insufficient"
	| "not-measurable"
	| "invalid";

export type R6PairSide = "candidate" | "baseline" | "tie";
export type R6PairOutcome = "win" | "loss" | "tie" | "inconsistent";

export interface R6PairCounts {
	readonly wins: number;
	readonly losses: number;
	readonly ties: number;
	readonly inconsistent: number;
}

/** 一组配对样本：计划数、配对计数、失败数、逐故事完成数与判定次数。 */
export interface R6PairingSample {
	readonly plannedPairs: number;
	readonly pairs: R6PairCounts;
	readonly failures: number;
	readonly stories: readonly {
		readonly story: string;
		readonly completedPairs: number;
	}[];
	readonly judgments: {
		readonly completed: number;
		readonly failed: number;
	};
}

/** G0：同一配置的 A/A 检验与真人标注配对。 */
export interface R6InstrumentGateInput {
	readonly sameConfig: {
		readonly plannedPairs: number;
		readonly pairs: R6PairCounts;
		readonly failures: number;
		readonly judgments: {
			readonly completed: number;
			readonly failed: number;
		};
	};
	readonly humanLabels: {
		readonly plannedPairs: number;
		readonly completedPairs: number;
		/** 两种顺序合并后选中被玩家接受侧的次数。 */
		readonly acceptedChoices: number;
		/** 成功判断次数，两种顺序合计。 */
		readonly judgments: number;
		/** 选中位置甲的次数。 */
		readonly positionA: number;
		readonly failures: number;
	};
}

/** G1：续写对放弃侧与对接受侧两组配对。 */
export interface R6ReplayGateInput {
	readonly abandoned: R6PairingSample;
	readonly accepted: R6PairingSample;
}

export interface R6StoryMetric {
	readonly story: string;
	readonly native: { readonly mean: number | null; readonly samples: number };
	readonly naive: { readonly mean: number | null; readonly samples: number };
}

export interface R6SimilarityGateInput {
	readonly stories: readonly R6StoryMetric[];
}

export interface R6ContradictionGateInput {
	readonly consistent: number;
	readonly contradictory: number;
	readonly undecidable: number;
	readonly failed: number;
}

export interface R6DeepGateInput {
	readonly plannedPairs: number;
	readonly pairs: R6PairCounts;
	readonly failures: number;
	readonly turns: {
		readonly completed: number;
		readonly failed: number;
	};
	/** 完成轮次的工具调用次数合计；为 0 时 G5 不可测。 */
	readonly toolCalls: number;
}

export interface R6PreferenceGateInput {
	readonly accepted: number;
	readonly abandoned: number;
	readonly ties: number;
	readonly inconsistent: number;
	readonly failures: number;
}

export interface R6GateInput {
	readonly instrument: R6InstrumentGateInput;
	readonly replay: R6ReplayGateInput;
	readonly repetition: R6SimilarityGateInput;
	readonly progression: R6SimilarityGateInput;
	readonly contradiction: R6ContradictionGateInput;
	readonly deep: R6DeepGateInput;
	readonly preference: R6PreferenceGateInput;
}

export interface R6GateResult {
	readonly id: R6GateId;
	readonly title: string;
	readonly status: R6GateStatus;
	readonly reason: string;
	readonly counts: Readonly<Record<string, number>>;
	readonly values: Readonly<Record<string, number | null>>;
	readonly thresholds: Readonly<Record<string, number>>;
}

export interface R6GateReport {
	readonly version: string;
	readonly gates: readonly R6GateResult[];
	readonly passed: boolean;
	readonly failed: readonly R6GateId[];
	readonly insufficient: readonly R6GateId[];
	/** 样本不足或前置不成立、按预注册不算未通过的项：G5 不可测与 G6 未证实。 */
	readonly unproven: readonly R6GateId[];
	/** G0 未通过或样本不足时记为仪器无效、不计为未通过的项：G1 与 G5。 */
	readonly invalid: readonly R6GateId[];
	readonly notMeasurable: readonly R6GateId[];
}

export interface WilsonInterval {
	readonly lower: number;
	readonly upper: number;
	readonly rate: number;
}

/**
 * 配对归一：两种展示顺序各自选中候选侧、基准侧或平局。
 * 两次都选候选侧记为胜，都选基准侧记为负，都平记为平，其余记为换序不一致。
 */
export function normalizePairOutcome(
	first: R6PairSide,
	second: R6PairSide,
): R6PairOutcome {
	assertPairSide(first, "first");
	assertPairSide(second, "second");
	if (first === "tie" || second === "tie") {
		return first === second ? "tie" : "inconsistent";
	}
	if (first !== second) return "inconsistent";
	return first === "candidate" ? "win" : "loss";
}

function assertPairSide(
	value: unknown,
	where: string,
): asserts value is R6PairSide {
	if (value !== "candidate" && value !== "baseline" && value !== "tie") {
		throw new Error(
			`配对顺序 ${where} 必须是 candidate、baseline 或 tie，收到 ${String(value)}`,
		);
	}
}

/** Wilson 95% 区间；计数为 0 时返回 null，表示样本不足。 */
export function wilsonInterval(
	successes: number,
	total: number,
	z: number = R6_WILSON_Z,
): WilsonInterval | null {
	requireNonNegativeInteger(successes, "wilson.successes");
	requireNonNegativeInteger(total, "wilson.total");
	if (successes > total) {
		throw new Error(`wilson.successes 不能大于 total：${successes} > ${total}`);
	}
	if (!Number.isFinite(z) || z <= 0) {
		throw new Error(`wilson.z 必须是正数，收到 ${String(z)}`);
	}
	if (total === 0) return null;
	const p = successes / total;
	const denominator = 1 + (z * z) / total;
	const center = p + (z * z) / (2 * total);
	const spread =
		z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
	return {
		lower: clampUnit((center - spread) / denominator),
		upper: clampUnit((center + spread) / denominator),
		rate: p,
	};
}

function clampUnit(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function completedPairs(pairs: R6PairCounts): number {
	return pairs.wins + pairs.losses + pairs.ties + pairs.inconsistent;
}

function decidedPairs(pairs: R6PairCounts): number {
	return pairs.wins + pairs.losses;
}

function excludedCount(pairs: R6PairCounts, failures: number): number {
	return pairs.ties + pairs.inconsistent + failures;
}

function passResult(
	id: R6GateId,
	title: string,
	counts: Record<string, number>,
	values: Record<string, number | null>,
	thresholds: Record<string, number>,
): R6GateResult {
	return {
		id,
		title,
		status: "pass",
		reason: "满足全部条件",
		counts,
		values,
		thresholds,
	};
}

function failResult(
	id: R6GateId,
	title: string,
	counts: Record<string, number>,
	values: Record<string, number | null>,
	thresholds: Record<string, number>,
	reasons: readonly string[],
): R6GateResult {
	return {
		id,
		title,
		status: "fail",
		reason: reasons.join("；"),
		counts,
		values,
		thresholds,
	};
}

function insufficientResult(
	id: R6GateId,
	title: string,
	counts: Record<string, number>,
	values: Record<string, number | null>,
	thresholds: Record<string, number>,
	reason: string,
): R6GateResult {
	return {
		id,
		title,
		status: "insufficient",
		reason,
		counts,
		values,
		thresholds,
	};
}

function notMeasurableResult(
	id: R6GateId,
	title: string,
	counts: Record<string, number>,
	values: Record<string, number | null>,
	thresholds: Record<string, number>,
	reason: string,
): R6GateResult {
	return {
		id,
		title,
		status: "not-measurable",
		reason,
		counts,
		values,
		thresholds,
	};
}

/** 按预注册 v2 判定 G0 至 G6；G0 不通过时 G1 与 G5 记为仪器无效。 */
export function evaluateR6Gates(input: R6GateInput): R6GateReport {
	validateR6GateInput(input);
	const instrument = evaluateInstrument(input.instrument);
	const instrumentValid = instrument.status === "pass";
	const gates = [
		instrument,
		withInstrument(instrumentValid, evaluateReplay(input.replay)),
		evaluateSimilarity("G2", "重复度", input.repetition, "repetition"),
		evaluateSimilarity("G3", "推进度", input.progression, "progression"),
		evaluateContradiction(input.contradiction),
		withInstrument(instrumentValid, evaluateDeep(input.deep)),
		evaluatePreference(input.preference),
	];
	const byStatus = (status: R6GateStatus): R6GateId[] =>
		gates.filter((gate) => gate.status === status).map((gate) => gate.id);
	const failed = byStatus("fail");
	const insufficient = byStatus("insufficient");
	const invalid = byStatus("invalid");
	const notMeasurable = byStatus("not-measurable");
	const unproven = [
		...notMeasurable,
		...insufficient.filter((id) => id === "G6"),
	];
	const passed = gates.every(
		(gate) =>
			gate.status === "pass" ||
			(gate.id === "G5" && gate.status === "not-measurable") ||
			(gate.id === "G6" && gate.status === "insufficient"),
	);
	return {
		version: R6_GATE_VERSION,
		gates,
		passed,
		failed,
		insufficient,
		unproven,
		invalid,
		notMeasurable,
	};
}

/** G0 未通过时把 G1 与 G5 标成仪器无效，保留各自的计数与数值。 */
function withInstrument(valid: boolean, gate: R6GateResult): R6GateResult {
	if (valid) return gate;
	return {
		...gate,
		status: "invalid",
		reason: `G0 未通过，仪器无效；${gate.reason}`,
	};
}

function evaluateInstrument(input: R6InstrumentGateInput): R6GateResult {
	const title = "仪器有效性";
	const sameCompleted = completedPairs(input.sameConfig.pairs);
	const sameDecided = decidedPairs(input.sameConfig.pairs);
	const sameExcluded = excludedCount(
		input.sameConfig.pairs,
		input.sameConfig.failures,
	);
	const sameJudgeTotal =
		input.sameConfig.judgments.completed + input.sameConfig.judgments.failed;
	const sameWilson = wilsonInterval(input.sameConfig.pairs.wins, sameDecided);
	const human = input.humanLabels;
	const humanJudgeTotal = human.judgments + human.failures;
	const humanWilson = wilsonInterval(human.acceptedChoices, human.judgments);
	const counts = {
		sameConfigPlannedPairs: input.sameConfig.plannedPairs,
		sameConfigCompleted: sameCompleted,
		sameConfigDecided: sameDecided,
		sameConfigWins: input.sameConfig.pairs.wins,
		sameConfigLosses: input.sameConfig.pairs.losses,
		sameConfigTies: input.sameConfig.pairs.ties,
		sameConfigInconsistent: input.sameConfig.pairs.inconsistent,
		sameConfigFailures: input.sameConfig.failures,
		sameConfigExcluded: sameExcluded,
		sameConfigJudgements: sameJudgeTotal,
		sameConfigJudgeFailures: input.sameConfig.judgments.failed,
		humanLabelPlannedPairs: human.plannedPairs,
		humanLabelCompleted: human.completedPairs,
		humanLabelAcceptedChoices: human.acceptedChoices,
		humanLabelPositionA: human.positionA,
		humanLabelFailures: human.failures,
		humanLabelJudgements: humanJudgeTotal,
	};
	const values = {
		sameConfigWinRate:
			sameDecided === 0 ? null : input.sameConfig.pairs.wins / sameDecided,
		sameConfigWilsonLower: sameWilson?.lower ?? null,
		sameConfigWilsonUpper: sameWilson?.upper ?? null,
		sameConfigInconsistentShare:
			sameCompleted === 0
				? null
				: input.sameConfig.pairs.inconsistent / sameCompleted,
		sameConfigExcludedShare:
			input.sameConfig.plannedPairs === 0
				? null
				: sameExcluded / input.sameConfig.plannedPairs,
		sameConfigJudgeFailureShare:
			sameJudgeTotal === 0
				? null
				: input.sameConfig.judgments.failed / sameJudgeTotal,
		humanLabelAgreement:
			human.judgments === 0 ? null : human.acceptedChoices / human.judgments,
		humanLabelWilsonLower: humanWilson?.lower ?? null,
		humanLabelWilsonUpper: humanWilson?.upper ?? null,
		humanLabelPositionBias:
			human.judgments === 0
				? null
				: Math.abs(human.positionA / human.judgments - 0.5),
		humanLabelJudgeFailureShare:
			humanJudgeTotal === 0 ? null : human.failures / humanJudgeTotal,
	};
	const thresholds = {
		minSameConfigPairs: R6_SAME_CONFIG_MIN_COMPLETED_PAIRS,
		minHumanLabelPairs: R6_HUMAN_LABEL_MIN_COMPLETED_PAIRS,
		minHumanLabelAgreement: R6_HUMAN_LABEL_MIN_AGREEMENT,
		maxHumanLabelPositionBias: R6_HUMAN_LABEL_MAX_POSITION_BIAS,
		centerRate: R6_MIN_WIN_RATE,
		maxExcludedShare: R6_MAX_EXCLUDED_SHARE,
		maxInconsistentShare: R6_MAX_INCONSISTENT_SHARE,
		maxJudgeFailureShare: R6_MAX_JUDGE_FAILURE_SHARE,
	};
	const gaps: string[] = [];
	if (sameCompleted < R6_SAME_CONFIG_MIN_COMPLETED_PAIRS) {
		gaps.push(
			`A/A 完成配对 ${sameCompleted}（至少 ${R6_SAME_CONFIG_MIN_COMPLETED_PAIRS}）`,
		);
	}
	if (human.completedPairs < R6_HUMAN_LABEL_MIN_COMPLETED_PAIRS) {
		gaps.push(
			`真人标注完成配对 ${human.completedPairs}（至少 ${R6_HUMAN_LABEL_MIN_COMPLETED_PAIRS}）`,
		);
	}
	if (gaps.length > 0) {
		return insufficientResult(
			"G0",
			title,
			counts,
			values,
			thresholds,
			`${gaps.join("；")}，样本不足`,
		);
	}
	const reasons: string[] = [];
	if (
		values.sameConfigExcludedShare !== null &&
		values.sameConfigExcludedShare > R6_MAX_EXCLUDED_SHARE
	) {
		reasons.push(
			`A/A 平、换序不一致与失败合计 ${formatPercent(values.sameConfigExcludedShare)} 超过 ${formatPercent(R6_MAX_EXCLUDED_SHARE)}`,
		);
	}
	if (
		values.sameConfigInconsistentShare !== null &&
		values.sameConfigInconsistentShare > R6_MAX_INCONSISTENT_SHARE
	) {
		reasons.push(
			`A/A 换序不一致 ${formatPercent(values.sameConfigInconsistentShare)} 超过 ${formatPercent(R6_MAX_INCONSISTENT_SHARE)}`,
		);
	}
	if (
		values.sameConfigJudgeFailureShare === null ||
		values.sameConfigJudgeFailureShare > R6_MAX_JUDGE_FAILURE_SHARE
	) {
		reasons.push(
			`A/A 裁判失败 ${formatPercent(values.sameConfigJudgeFailureShare)} 超过 ${formatPercent(R6_MAX_JUDGE_FAILURE_SHARE)}`,
		);
	}
	if (
		values.sameConfigWilsonLower === null ||
		values.sameConfigWilsonUpper === null ||
		values.sameConfigWilsonLower > R6_MIN_WIN_RATE ||
		values.sameConfigWilsonUpper < R6_MIN_WIN_RATE
	) {
		reasons.push(
			`A/A 胜率 ${formatPercent(values.sameConfigWinRate)} 的区间 ${formatPercent(values.sameConfigWilsonLower)}–${formatPercent(values.sameConfigWilsonUpper)} 不包含 50%`,
		);
	}
	if (
		values.humanLabelAgreement === null ||
		values.humanLabelAgreement < R6_HUMAN_LABEL_MIN_AGREEMENT
	) {
		reasons.push(
			`真人标注一致率 ${formatPercent(values.humanLabelAgreement)} 低于 ${formatPercent(R6_HUMAN_LABEL_MIN_AGREEMENT)}`,
		);
	}
	if (
		values.humanLabelWilsonLower === null ||
		values.humanLabelWilsonLower <= R6_MIN_WIN_RATE
	) {
		reasons.push(
			`真人标注一致率 Wilson 下界 ${formatPercent(values.humanLabelWilsonLower)} 不高于 ${formatPercent(R6_MIN_WIN_RATE)}`,
		);
	}
	if (
		values.humanLabelPositionBias === null ||
		values.humanLabelPositionBias > R6_HUMAN_LABEL_MAX_POSITION_BIAS
	) {
		reasons.push(
			`真人标注位置偏差 ${formatPercent(values.humanLabelPositionBias)} 超过 ${formatPercent(R6_HUMAN_LABEL_MAX_POSITION_BIAS)}`,
		);
	}
	if (
		values.humanLabelJudgeFailureShare === null ||
		values.humanLabelJudgeFailureShare > R6_MAX_JUDGE_FAILURE_SHARE
	) {
		reasons.push(
			`真人标注裁判失败 ${formatPercent(values.humanLabelJudgeFailureShare)} 超过 ${formatPercent(R6_MAX_JUDGE_FAILURE_SHARE)}`,
		);
	}
	if (reasons.length > 0) {
		return failResult("G0", title, counts, values, thresholds, reasons);
	}
	return passResult("G0", title, counts, values, thresholds);
}

function evaluateReplay(input: R6ReplayGateInput): R6GateResult {
	const title = "重 roll 点回放胜率";
	const groups = [
		{
			key: "abandoned",
			label: "对放弃侧",
			sample: input.abandoned,
			minWinRate: R6_MIN_REPLAY_ABANDONED_WIN_RATE,
		},
		{
			key: "accepted",
			label: "对接受侧",
			sample: input.accepted,
			minWinRate: R6_MIN_REPLAY_ACCEPTED_WIN_RATE,
		},
	] as const;
	const counts: Record<string, number> = {};
	const values: Record<string, number | null> = {};
	const gaps: string[] = [];
	const reasons: string[] = [];
	let judgeTotal = 0;
	let judgeFailed = 0;
	let completedTotal = 0;
	let inconsistentTotal = 0;
	for (const { key, label, sample, minWinRate } of groups) {
		const completed = completedPairs(sample.pairs);
		const decided = decidedPairs(sample.pairs);
		const excluded = excludedCount(sample.pairs, sample.failures);
		const wilson = wilsonInterval(sample.pairs.wins, decided);
		const covered = sample.stories.filter(
			(story) => story.completedPairs > 0,
		).length;
		const judgeOfGroup = sample.judgments.completed + sample.judgments.failed;
		const winRate = decided === 0 ? null : sample.pairs.wins / decided;
		const excludedShare =
			sample.plannedPairs === 0 ? null : excluded / sample.plannedPairs;
		const inconsistentShare =
			completed === 0 ? null : sample.pairs.inconsistent / completed;
		judgeTotal += judgeOfGroup;
		judgeFailed += sample.judgments.failed;
		completedTotal += completed;
		inconsistentTotal += sample.pairs.inconsistent;
		counts[`${key}PlannedPairs`] = sample.plannedPairs;
		counts[`${key}Completed`] = completed;
		counts[`${key}Decided`] = decided;
		counts[`${key}Wins`] = sample.pairs.wins;
		counts[`${key}Losses`] = sample.pairs.losses;
		counts[`${key}Ties`] = sample.pairs.ties;
		counts[`${key}Inconsistent`] = sample.pairs.inconsistent;
		counts[`${key}Failures`] = sample.failures;
		counts[`${key}Excluded`] = excluded;
		counts[`${key}CoveredStories`] = covered;
		counts[`${key}Judgements`] = judgeOfGroup;
		counts[`${key}JudgeFailures`] = sample.judgments.failed;
		values[`${key}WinRate`] = winRate;
		values[`${key}WilsonLower`] = wilson?.lower ?? null;
		values[`${key}WilsonUpper`] = wilson?.upper ?? null;
		values[`${key}ExcludedShare`] = excludedShare;
		values[`${key}InconsistentShare`] = inconsistentShare;
		if (completed < R6_REPLAY_MIN_COMPLETED_PAIRS) {
			gaps.push(
				`${label}完成配对 ${completed}（至少 ${R6_REPLAY_MIN_COMPLETED_PAIRS}）`,
			);
		}
		if (covered < R6_STORY_COUNT) {
			gaps.push(`${label}覆盖故事 ${covered}（至少 ${R6_STORY_COUNT}）`);
		}
		for (const story of sample.stories) {
			if (story.completedPairs < R6_REPLAY_MIN_STORY_PAIRS) {
				gaps.push(
					`${label}故事 ${story.story} 完成 ${story.completedPairs}（至少 ${R6_REPLAY_MIN_STORY_PAIRS}）`,
				);
			}
		}
		if (completed < R6_REPLAY_MIN_COMPLETED_PAIRS) continue;
		if (excludedShare !== null && excludedShare > R6_MAX_EXCLUDED_SHARE) {
			reasons.push(
				`${label}平、换序不一致与失败合计 ${formatPercent(excludedShare)} 超过 ${formatPercent(R6_MAX_EXCLUDED_SHARE)}`,
			);
		}
		if (winRate === null || winRate < minWinRate) {
			reasons.push(
				`${label}胜率 ${formatPercent(winRate)} 低于 ${formatPercent(minWinRate)}`,
			);
		}
		if (key === "abandoned") {
			if (
				(values.abandonedWilsonLower ?? null) === null ||
				(values.abandonedWilsonLower ?? 0) <= R6_MIN_WIN_RATE
			) {
				reasons.push(
					`对放弃侧 Wilson 下界 ${formatPercent(values.abandonedWilsonLower ?? null)} 不高于 ${formatPercent(R6_MIN_WIN_RATE)}`,
				);
			}
			if (
				inconsistentShare !== null &&
				inconsistentShare > R6_MAX_INCONSISTENT_SHARE
			) {
				reasons.push(
					`对放弃侧换序不一致 ${formatPercent(inconsistentShare)} 超过 ${formatPercent(R6_MAX_INCONSISTENT_SHARE)}`,
				);
			}
		}
	}
	counts.judgements = judgeTotal;
	counts.judgeFailures = judgeFailed;
	values.combinedInconsistentShare =
		completedTotal === 0 ? null : inconsistentTotal / completedTotal;
	values.judgeFailureShare = judgeTotal === 0 ? null : judgeFailed / judgeTotal;
	if (
		values.judgeFailureShare === null ||
		values.judgeFailureShare > R6_MAX_JUDGE_FAILURE_SHARE
	) {
		reasons.push(
			`裁判失败 ${formatPercent(values.judgeFailureShare)} 超过 ${formatPercent(R6_MAX_JUDGE_FAILURE_SHARE)}`,
		);
	}
	const thresholds = {
		minCompletedPairs: R6_REPLAY_MIN_COMPLETED_PAIRS,
		minStoryPairs: R6_REPLAY_MIN_STORY_PAIRS,
		requiredStories: R6_STORY_COUNT,
		minAbandonedWinRate: R6_MIN_REPLAY_ABANDONED_WIN_RATE,
		minAcceptedWinRate: R6_MIN_REPLAY_ACCEPTED_WIN_RATE,
		minWilsonLower: R6_MIN_WIN_RATE,
		maxExcludedShare: R6_MAX_EXCLUDED_SHARE,
		maxInconsistentShare: R6_MAX_INCONSISTENT_SHARE,
		maxJudgeFailureShare: R6_MAX_JUDGE_FAILURE_SHARE,
	};
	if (gaps.length > 0) {
		return insufficientResult(
			"G1",
			title,
			counts,
			values,
			thresholds,
			`${gaps.join("；")}，样本不足`,
		);
	}
	if (reasons.length > 0) {
		return failResult("G1", title, counts, values, thresholds, reasons);
	}
	return passResult("G1", title, counts, values, thresholds);
}

function evaluateSimilarity(
	id: "G2" | "G3",
	title: string,
	input: R6SimilarityGateInput,
	label: "repetition" | "progression",
): R6GateResult {
	const minSamples =
		label === "repetition" ? R6_MIN_REPETITION_PAIRS : R6_MIN_PROGRESS_SAMPLES;
	const isRepetition = label === "repetition";
	const nativeSamples = input.stories.reduce(
		(total, story) => total + story.native.samples,
		0,
	);
	const naiveSamples = input.stories.reduce(
		(total, story) => total + story.naive.samples,
		0,
	);
	const missingMean = input.stories.some(
		(story) => story.native.mean === null || story.naive.mean === null,
	);
	const fullyMeasured = input.stories.every(
		(story) => story.native.mean !== null && story.naive.mean !== null,
	);
	const nativeMean = fullyMeasured
		? input.stories.reduce(
				(total: number, story) => total + (story.native.mean as number),
				0,
			) / input.stories.length
		: null;
	const naiveMean = fullyMeasured
		? input.stories.reduce(
				(total: number, story) => total + (story.naive.mean as number),
				0,
			) / input.stories.length
		: null;
	const deltas = fullyMeasured
		? input.stories.map((story) => ({
				story: story.story,
				delta: (story.native.mean as number) - (story.naive.mean as number),
			}))
		: [];
	const overallDelta =
		nativeMean === null || naiveMean === null ? null : nativeMean - naiveMean;
	const minDelta =
		deltas.length === 0
			? null
			: deltas.reduce(
					(min, entry) => Math.min(min, entry.delta),
					Number.POSITIVE_INFINITY,
				);
	const maxDelta =
		deltas.length === 0
			? null
			: deltas.reduce(
					(max, entry) => Math.max(max, entry.delta),
					Number.NEGATIVE_INFINITY,
				);
	const counts = {
		stories: input.stories.length,
		nativeSamples,
		naiveSamples,
	};
	const values = {
		nativeMean,
		naiveMean,
		overallDelta,
		minStoryDelta: minDelta,
		maxStoryDelta: maxDelta,
	};
	const thresholds: Record<string, number> = isRepetition
		? {
				minSamplesPerArm: minSamples,
				maxStoryDelta: R6_MAX_STORY_REPETITION_DELTA,
			}
		: {
				minSamplesPerArm: minSamples,
				minStoryDelta: R6_MIN_STORY_PROGRESS_DELTA,
			};
	if (nativeSamples < minSamples || naiveSamples < minSamples || missingMean) {
		return insufficientResult(
			id,
			title,
			counts,
			values,
			thresholds,
			`原生档样本 ${nativeSamples}、朴素档样本 ${naiveSamples}（各至少 ${minSamples}），或存在未测量故事，样本不足`,
		);
	}
	const reasons: string[] = [];
	if (isRepetition) {
		if (overallDelta !== null && overallDelta > 0) {
			reasons.push(`合计差值 ${formatDelta(overallDelta)} 大于 0`);
		}
		const worst = deltas.reduce(
			(worstEntry, entry) =>
				worstEntry === null || entry.delta > worstEntry.delta
					? entry
					: worstEntry,
			null as { readonly story: string; readonly delta: number } | null,
		);
		if (worst !== null && worst.delta > R6_MAX_STORY_REPETITION_DELTA) {
			reasons.push(
				`故事 ${worst.story} 差值 ${formatDelta(worst.delta)} 超过 ${formatDelta(R6_MAX_STORY_REPETITION_DELTA)}`,
			);
		}
	} else {
		if (overallDelta !== null && overallDelta < 0) {
			reasons.push(`合计差值 ${formatDelta(overallDelta)} 小于 0`);
		}
		const worst = deltas.reduce(
			(worstEntry, entry) =>
				worstEntry === null || entry.delta < worstEntry.delta
					? entry
					: worstEntry,
			null as { readonly story: string; readonly delta: number } | null,
		);
		if (worst !== null && worst.delta < R6_MIN_STORY_PROGRESS_DELTA) {
			reasons.push(
				`故事 ${worst.story} 差值 ${formatDelta(worst.delta)} 低于 ${formatDelta(R6_MIN_STORY_PROGRESS_DELTA)}`,
			);
		}
	}
	if (reasons.length > 0) {
		return failResult(id, title, counts, values, thresholds, reasons);
	}
	return passResult(id, title, counts, values, thresholds);
}

function evaluateContradiction(input: R6ContradictionGateInput): R6GateResult {
	const title = "矛盾率";
	const decided = input.consistent + input.contradictory;
	const completed = decided + input.undecidable;
	const total = completed + input.failed;
	const counts = {
		consistent: input.consistent,
		contradictory: input.contradictory,
		undecidable: input.undecidable,
		failed: input.failed,
		decided,
		completed,
		total,
	};
	const values = {
		contradictionRate: decided === 0 ? null : input.contradictory / decided,
		undecidableShare: completed === 0 ? null : input.undecidable / completed,
		judgeFailureShare: total === 0 ? null : input.failed / total,
	};
	const thresholds = {
		minDecidedProbes: R6_MIN_DECIDED_PROBES,
		maxContradictionRate: R6_MAX_CONTRADICTION_RATE,
		maxUndecidableShare: R6_MAX_UNDECIDABLE_SHARE,
		maxJudgeFailureShare: R6_MAX_JUDGE_FAILURE_SHARE,
	};
	if (decided < R6_MIN_DECIDED_PROBES) {
		return insufficientResult(
			"G4",
			title,
			counts,
			values,
			thresholds,
			`可判定探针 ${decided} 少于 ${R6_MIN_DECIDED_PROBES}，样本不足`,
		);
	}
	const reasons: string[] = [];
	if (
		values.contradictionRate === null ||
		values.contradictionRate > R6_MAX_CONTRADICTION_RATE
	) {
		reasons.push(
			`矛盾率 ${formatPercent(values.contradictionRate)} 超过 ${formatPercent(R6_MAX_CONTRADICTION_RATE)}`,
		);
	}
	if (
		values.undecidableShare === null ||
		values.undecidableShare > R6_MAX_UNDECIDABLE_SHARE
	) {
		reasons.push(
			`无法判断 ${formatPercent(values.undecidableShare)} 超过 ${formatPercent(R6_MAX_UNDECIDABLE_SHARE)}`,
		);
	}
	if (
		values.judgeFailureShare === null ||
		values.judgeFailureShare > R6_MAX_JUDGE_FAILURE_SHARE
	) {
		reasons.push(
			`裁判失败 ${formatPercent(values.judgeFailureShare)} 超过 ${formatPercent(R6_MAX_JUDGE_FAILURE_SHARE)}`,
		);
	}
	if (reasons.length > 0) {
		return failResult("G4", title, counts, values, thresholds, reasons);
	}
	return passResult("G4", title, counts, values, thresholds);
}

function evaluateDeep(input: R6DeepGateInput): R6GateResult {
	const title = "深回合增益";
	const completed = completedPairs(input.pairs);
	const decided = decidedPairs(input.pairs);
	const excluded = excludedCount(input.pairs, input.failures);
	const turnTotal = input.turns.completed + input.turns.failed;
	const wilson = wilsonInterval(input.pairs.wins, decided);
	const counts = {
		plannedPairs: input.plannedPairs,
		completed,
		decided,
		wins: input.pairs.wins,
		losses: input.pairs.losses,
		ties: input.pairs.ties,
		inconsistent: input.pairs.inconsistent,
		failures: input.failures,
		excluded,
		completedTurns: input.turns.completed,
		failedTurns: input.turns.failed,
		toolCalls: input.toolCalls,
	};
	const values = {
		winRate: decided === 0 ? null : input.pairs.wins / decided,
		wilsonLower: wilson?.lower ?? null,
		wilsonUpper: wilson?.upper ?? null,
		excludedShare:
			input.plannedPairs === 0 ? null : excluded / input.plannedPairs,
		turnFailureRate: turnTotal === 0 ? null : input.turns.failed / turnTotal,
	};
	const thresholds = {
		minCompletedPairs: R6_DEEP_MIN_COMPLETED_PAIRS,
		maxExcludedShare: R6_MAX_EXCLUDED_SHARE,
		maxTurnFailureRate: R6_MAX_JUDGE_FAILURE_SHARE,
		minWinRate: R6_MIN_WIN_RATE,
		minToolCalls: 1,
	};
	if (input.toolCalls === 0) {
		return notMeasurableResult(
			"G5",
			title,
			counts,
			values,
			thresholds,
			"深回合工具调用为 0，执行器增益无法测量",
		);
	}
	if (completed < R6_DEEP_MIN_COMPLETED_PAIRS) {
		return insufficientResult(
			"G5",
			title,
			counts,
			values,
			thresholds,
			`完成配对 ${completed} 少于 ${R6_DEEP_MIN_COMPLETED_PAIRS}，样本不足`,
		);
	}
	const reasons: string[] = [];
	if (
		values.excludedShare !== null &&
		values.excludedShare > R6_MAX_EXCLUDED_SHARE
	) {
		reasons.push(
			`平、换序不一致与失败合计 ${formatPercent(values.excludedShare)} 超过 ${formatPercent(R6_MAX_EXCLUDED_SHARE)}`,
		);
	}
	if (
		values.turnFailureRate === null ||
		values.turnFailureRate > R6_MAX_JUDGE_FAILURE_SHARE
	) {
		reasons.push(
			`深回合失败率 ${formatPercent(values.turnFailureRate)} 超过 ${formatPercent(R6_MAX_JUDGE_FAILURE_SHARE)}`,
		);
	}
	if (values.winRate === null || values.winRate <= R6_MIN_WIN_RATE) {
		reasons.push(
			`胜率 ${formatPercent(values.winRate)} 不高于 ${formatPercent(R6_MIN_WIN_RATE)}`,
		);
	}
	if (values.wilsonLower === null || values.wilsonLower <= R6_MIN_WIN_RATE) {
		reasons.push(
			`Wilson 下界 ${formatPercent(values.wilsonLower)} 不高于 ${formatPercent(R6_MIN_WIN_RATE)}`,
		);
	}
	if (reasons.length > 0) {
		return failResult("G5", title, counts, values, thresholds, reasons);
	}
	return passResult("G5", title, counts, values, thresholds);
}

function evaluatePreference(input: R6PreferenceGateInput): R6GateResult {
	const title = "偏好一致率（条件门槛）";
	const completed =
		input.accepted + input.abandoned + input.ties + input.inconsistent;
	const wilson = wilsonInterval(input.accepted, completed);
	const counts = {
		completed,
		accepted: input.accepted,
		abandoned: input.abandoned,
		ties: input.ties,
		inconsistent: input.inconsistent,
		failures: input.failures,
	};
	const values = {
		consistency: completed === 0 ? null : input.accepted / completed,
		wilsonLower: wilson?.lower ?? null,
		wilsonUpper: wilson?.upper ?? null,
	};
	const thresholds = {
		minCompletedPairs: R6_MIN_PREFERENCE_PAIRS,
		minConsistency: R6_MIN_PREFERENCE_CONSISTENCY,
		minWilsonLower: R6_MIN_WIN_RATE,
	};
	if (completed < R6_MIN_PREFERENCE_PAIRS) {
		return insufficientResult(
			"G6",
			title,
			counts,
			values,
			thresholds,
			`完成配对 ${completed} 少于 ${R6_MIN_PREFERENCE_PAIRS}，未证实`,
		);
	}
	const reasons: string[] = [];
	if (
		values.consistency === null ||
		values.consistency < R6_MIN_PREFERENCE_CONSISTENCY
	) {
		reasons.push(
			`一致率 ${formatPercent(values.consistency)} 低于 ${formatPercent(R6_MIN_PREFERENCE_CONSISTENCY)}`,
		);
	}
	if (values.wilsonLower === null || values.wilsonLower <= R6_MIN_WIN_RATE) {
		reasons.push(
			`Wilson 下界 ${formatPercent(values.wilsonLower)} 不高于 ${formatPercent(R6_MIN_WIN_RATE)}`,
		);
	}
	if (reasons.length > 0) {
		return failResult("G6", title, counts, values, thresholds, reasons);
	}
	return passResult("G6", title, counts, values, thresholds);
}

function formatPercent(value: number | null): string {
	return value === null ? "缺失" : `${(value * 100).toFixed(1)}%`;
}

function formatDelta(value: number): string {
	return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

/** 校验判定输入；缺项、负数、越界与自相矛盾都抛出带字段路径的错误。 */
export function validateR6GateInput(input: R6GateInput): void {
	const root = requireObject(input, "input");
	const instrument = requireObject(root.instrument, "instrument");
	const sameConfig = requireObject(
		instrument.sameConfig,
		"instrument.sameConfig",
	);
	const samePairs = validatePairCounts(
		sameConfig.pairs,
		"instrument.sameConfig.pairs",
	);
	const sameCompleted = completedPairs(samePairs);
	const samePlanned = requireNonNegativeInteger(
		sameConfig.plannedPairs,
		"instrument.sameConfig.plannedPairs",
	);
	const sameFailures = requireNonNegativeInteger(
		sameConfig.failures,
		"instrument.sameConfig.failures",
	);
	if (sameCompleted + sameFailures > samePlanned) {
		throw new Error(
			`instrument.sameConfig 完成配对 ${sameCompleted} 与失败 ${sameFailures} 之和超过计划配对 ${samePlanned}`,
		);
	}
	const sameJudgments = requireObject(
		sameConfig.judgments,
		"instrument.sameConfig.judgments",
	);
	const sameJudgmentCompleted = requireNonNegativeInteger(
		sameJudgments.completed,
		"instrument.sameConfig.judgments.completed",
	);
	const sameJudgmentFailed = requireNonNegativeInteger(
		sameJudgments.failed,
		"instrument.sameConfig.judgments.failed",
	);
	if (sameJudgmentCompleted < sameCompleted * 2) {
		throw new Error(
			`instrument.sameConfig.judgments.completed 至少应为 ${sameCompleted * 2}（每对两种顺序各一次），收到 ${sameJudgmentCompleted}`,
		);
	}
	if (sameJudgmentFailed < sameFailures) {
		throw new Error(
			`instrument.sameConfig.judgments.failed 不能少于失败配对 ${sameFailures}，收到 ${sameJudgmentFailed}`,
		);
	}
	const human = requireObject(instrument.humanLabels, "instrument.humanLabels");
	const humanPlanned = requireNonNegativeInteger(
		human.plannedPairs,
		"instrument.humanLabels.plannedPairs",
	);
	const humanCompleted = requireNonNegativeInteger(
		human.completedPairs,
		"instrument.humanLabels.completedPairs",
	);
	const humanJudgments = requireNonNegativeInteger(
		human.judgments,
		"instrument.humanLabels.judgments",
	);
	const humanAccepted = requireNonNegativeInteger(
		human.acceptedChoices,
		"instrument.humanLabels.acceptedChoices",
	);
	const humanPositionA = requireNonNegativeInteger(
		human.positionA,
		"instrument.humanLabels.positionA",
	);
	const humanFailures = requireNonNegativeInteger(
		human.failures,
		"instrument.humanLabels.failures",
	);
	if (humanCompleted > humanPlanned) {
		throw new Error(
			`instrument.humanLabels 完成配对 ${humanCompleted} 超过计划配对 ${humanPlanned}`,
		);
	}
	if (humanJudgments < humanCompleted * 2) {
		throw new Error(
			`instrument.humanLabels.judgments 至少应为 ${humanCompleted * 2}（每对两种顺序各一次），收到 ${humanJudgments}`,
		);
	}
	if (humanAccepted > humanJudgments) {
		throw new Error(
			`instrument.humanLabels.acceptedChoices ${humanAccepted} 不能超过成功判断 ${humanJudgments}`,
		);
	}
	if (humanPositionA > humanJudgments) {
		throw new Error(
			`instrument.humanLabels.positionA ${humanPositionA} 不能超过成功判断 ${humanJudgments}`,
		);
	}
	if (humanCompleted + humanFailures > humanPlanned * 2) {
		throw new Error(
			`instrument.humanLabels 完成配对 ${humanCompleted} 与失败 ${humanFailures} 之和超过两倍计划配对 ${humanPlanned}`,
		);
	}
	const replay = requireObject(root.replay, "replay");
	validatePairingSample(replay.abandoned, "replay.abandoned");
	validatePairingSample(replay.accepted, "replay.accepted");
	validateSimilarityInput(root.repetition, "repetition");
	validateSimilarityInput(root.progression, "progression");
	const contradiction = requireObject(root.contradiction, "contradiction");
	requireNonNegativeInteger(
		contradiction.consistent,
		"contradiction.consistent",
	);
	requireNonNegativeInteger(
		contradiction.contradictory,
		"contradiction.contradictory",
	);
	requireNonNegativeInteger(
		contradiction.undecidable,
		"contradiction.undecidable",
	);
	requireNonNegativeInteger(contradiction.failed, "contradiction.failed");
	const deep = requireObject(root.deep, "deep");
	validatePairCounts(deep.pairs, "deep.pairs");
	requireNonNegativeInteger(deep.plannedPairs, "deep.plannedPairs");
	requireNonNegativeInteger(deep.failures, "deep.failures");
	requireNonNegativeInteger(deep.toolCalls, "deep.toolCalls");
	const turns = requireObject(deep.turns, "deep.turns");
	const completedTurns = requireNonNegativeInteger(
		turns.completed,
		"deep.turns.completed",
	);
	const failedTurns = requireNonNegativeInteger(
		turns.failed,
		"deep.turns.failed",
	);
	if (completedTurns + failedTurns === 0) {
		throw new Error("deep.turns 的完成与失败轮次不能同时为 0");
	}
	const preference = requireObject(root.preference, "preference");
	requireNonNegativeInteger(preference.accepted, "preference.accepted");
	requireNonNegativeInteger(preference.abandoned, "preference.abandoned");
	requireNonNegativeInteger(preference.ties, "preference.ties");
	requireNonNegativeInteger(preference.inconsistent, "preference.inconsistent");
	requireNonNegativeInteger(preference.failures, "preference.failures");
}

/** 校验一组配对样本，返回完成的配对数。 */
function validatePairingSample(value: unknown, where: string): number {
	const sample = requireObject(value, where);
	const pairs = validatePairCounts(sample.pairs, `${where}.pairs`);
	const completed = completedPairs(pairs);
	const planned = requireNonNegativeInteger(
		sample.plannedPairs,
		`${where}.plannedPairs`,
	);
	const failures = requireNonNegativeInteger(
		sample.failures,
		`${where}.failures`,
	);
	if (completed + failures > planned) {
		throw new Error(
			`${where} 完成配对 ${completed} 与失败 ${failures} 之和超过计划配对 ${planned}`,
		);
	}
	validateStoryCoverage(sample.stories, `${where}.stories`, completed);
	const judgments = requireObject(sample.judgments, `${where}.judgments`);
	const judgmentCompleted = requireNonNegativeInteger(
		judgments.completed,
		`${where}.judgments.completed`,
	);
	const judgmentFailed = requireNonNegativeInteger(
		judgments.failed,
		`${where}.judgments.failed`,
	);
	if (judgmentCompleted < completed * 2) {
		throw new Error(
			`${where}.judgments.completed 至少应为 ${completed * 2}（每对两种顺序各一次），收到 ${judgmentCompleted}`,
		);
	}
	if (judgmentFailed < failures) {
		throw new Error(
			`${where}.judgments.failed 不能少于失败配对 ${failures}，收到 ${judgmentFailed}`,
		);
	}
	return completed;
}

function validatePairCounts(value: unknown, where: string): R6PairCounts {
	const pairs = requireObject(value, where);
	return {
		wins: requireNonNegativeInteger(pairs.wins, `${where}.wins`),
		losses: requireNonNegativeInteger(pairs.losses, `${where}.losses`),
		ties: requireNonNegativeInteger(pairs.ties, `${where}.ties`),
		inconsistent: requireNonNegativeInteger(
			pairs.inconsistent,
			`${where}.inconsistent`,
		),
	};
}

function validateStoryCoverage(
	value: unknown,
	where: string,
	completed: number,
): void {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${where} 必须是非空数组`);
	}
	const names = new Set<string>();
	let total = 0;
	value.forEach((entry, index) => {
		const story = requireObject(entry, `${where}[${index}]`);
		const name = story.story;
		if (typeof name !== "string" || name.trim().length === 0) {
			throw new Error(`${where}[${index}].story 必须是非空字符串`);
		}
		if (names.has(name)) {
			throw new Error(`${where} 里故事 ${name} 重复`);
		}
		names.add(name);
		total += requireNonNegativeInteger(
			story.completedPairs,
			`${where}[${index}].completedPairs`,
		);
	});
	if (total !== completed) {
		throw new Error(
			`${where} 的完成配对合计 ${total} 与 b1 配对合计 ${completed} 不一致`,
		);
	}
}

function validateSimilarityInput(value: unknown, where: string): void {
	const input = requireObject(value, where);
	if (!Array.isArray(input.stories) || input.stories.length === 0) {
		throw new Error(`${where}.stories 必须是非空数组`);
	}
	const names = new Set<string>();
	input.stories.forEach((entry, index) => {
		const story = requireObject(entry, `${where}.stories[${index}]`);
		const name = story.story;
		if (typeof name !== "string" || name.trim().length === 0) {
			throw new Error(`${where}.stories[${index}].story 必须是非空字符串`);
		}
		if (names.has(name)) {
			throw new Error(`${where}.stories 里故事 ${name} 重复`);
		}
		names.add(name);
		for (const arm of ["native", "naive"] as const) {
			const metric = requireObject(
				story[arm],
				`${where}.stories[${index}].${arm}`,
			);
			requireNullableRate(
				metric.mean,
				`${where}.stories[${index}].${arm}.mean`,
			);
			requireNonNegativeInteger(
				metric.samples,
				`${where}.stories[${index}].${arm}.samples`,
			);
		}
	});
}

function requireObject(value: unknown, where: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${where} 必须是 JSON 对象`);
	}
	return value as Record<string, unknown>;
}

function requireNonNegativeInteger(value: unknown, where: string): number {
	if (!Number.isInteger(value) || (value as number) < 0) {
		throw new Error(`${where} 必须是非负整数，收到 ${String(value)}`);
	}
	return value as number;
}

function requireNullableRate(value: unknown, where: string): void {
	if (value === null || value === undefined) return;
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 1
	) {
		throw new Error(
			`${where} 必须是 0 到 1 之间的数或 null，收到 ${String(value)}`,
		);
	}
}
