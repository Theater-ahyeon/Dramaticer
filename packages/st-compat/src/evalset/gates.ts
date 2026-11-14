/** R6 预注册 v1 的门槛常量与判定；门禁版本随预注册版本变化。 */
export const R6_GATE_VERSION = "v1";

export const R6_WILSON_Z = 1.96;
export const R6_STORY_COUNT = 3;

export const R6_BRANCH_DEPTHS = [
	0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
] as const;
export const R6_MAX_BRANCH_POINTS = 10;
export const R6_C1_BRANCH_POINTS = 3;
export const R6_C1_ROUNDS = 30;
export const R6_B1_PLANNED_PAIRS = 30;
export const R6_DEEP_ROUNDS = 20;
export const R6_DEEP_BRANCH_POINTS = 8;
export const R6_WARMUP_FLOORS = 12;
export const R6_PROBE_INTERVAL_ROUNDS = 6;
export const R6_PROBE_MIN_FACT_AGE = 10;
export const R6_PROBE_MAX_PER_RUN = 5;

export const R6_B1_MIN_COMPLETED_PAIRS = 27;
export const R6_DEEP_MIN_COMPLETED_PAIRS = 24;
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

export const R6_GATE_IDS = ["G1", "G2", "G3", "G4", "G5", "G6"] as const;
export type R6GateId = (typeof R6_GATE_IDS)[number];
export type R6GateStatus = "pass" | "fail" | "insufficient";

export type R6PairSide = "candidate" | "baseline" | "tie";
export type R6PairOutcome = "win" | "loss" | "tie" | "inconsistent";

export interface R6PairCounts {
	readonly wins: number;
	readonly losses: number;
	readonly ties: number;
	readonly inconsistent: number;
}

export interface R6B1GateInput {
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
}

export interface R6PreferenceGateInput {
	readonly accepted: number;
	readonly abandoned: number;
	readonly ties: number;
	readonly inconsistent: number;
	readonly failures: number;
}

export interface R6GateInput {
	readonly b1: R6B1GateInput;
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
	/** 样本不足但按预注册不算未通过的项；目前只有 G6。 */
	readonly unproven: readonly R6GateId[];
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

/** 按预注册 v1 判定 G1 至 G6；输入缺项或自相矛盾直接抛错。 */
export function evaluateR6Gates(input: R6GateInput): R6GateReport {
	validateR6GateInput(input);
	const gates = [
		evaluateB1(input.b1),
		evaluateSimilarity("G2", "重复度", input.repetition, "repetition"),
		evaluateSimilarity("G3", "推进度", input.progression, "progression"),
		evaluateContradiction(input.contradiction),
		evaluateDeep(input.deep),
		evaluatePreference(input.preference),
	];
	const failed = gates
		.filter((gate) => gate.status === "fail")
		.map((gate) => gate.id);
	const insufficient = gates
		.filter((gate) => gate.status === "insufficient")
		.map((gate) => gate.id);
	const unproven = insufficient.filter((id) => id === "G6");
	const passed = gates.every(
		(gate) =>
			gate.status === "pass" ||
			(gate.id === "G6" && gate.status === "insufficient"),
	);
	return {
		version: R6_GATE_VERSION,
		gates,
		passed,
		failed,
		insufficient,
		unproven,
	};
}

function evaluateB1(input: R6B1GateInput): R6GateResult {
	const title = "B1 盲测胜率";
	const completed = completedPairs(input.pairs);
	const decided = decidedPairs(input.pairs);
	const excluded = excludedCount(input.pairs, input.failures);
	const judgeTotal = input.judgments.completed + input.judgments.failed;
	const coveredStories = input.stories.filter(
		(story) => story.completedPairs > 0,
	).length;
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
		coveredStories,
		judgements: judgeTotal,
		judgeFailures: input.judgments.failed,
	};
	const values = {
		winRate: decided === 0 ? null : input.pairs.wins / decided,
		wilsonLower: wilson?.lower ?? null,
		wilsonUpper: wilson?.upper ?? null,
		excludedShare:
			input.plannedPairs === 0 ? null : excluded / input.plannedPairs,
		inconsistentShare:
			completed === 0 ? null : input.pairs.inconsistent / completed,
		judgeFailureShare:
			judgeTotal === 0 ? null : input.judgments.failed / judgeTotal,
	};
	const thresholds = {
		minCompletedPairs: R6_B1_MIN_COMPLETED_PAIRS,
		requiredStories: R6_STORY_COUNT,
		maxExcludedShare: R6_MAX_EXCLUDED_SHARE,
		maxInconsistentShare: R6_MAX_INCONSISTENT_SHARE,
		maxJudgeFailureShare: R6_MAX_JUDGE_FAILURE_SHARE,
		minWinRate: R6_MIN_WIN_RATE,
	};
	if (
		completed < R6_B1_MIN_COMPLETED_PAIRS ||
		coveredStories < R6_STORY_COUNT
	) {
		return insufficientResult(
			"G1",
			title,
			counts,
			values,
			thresholds,
			`完成配对 ${completed}（至少 ${R6_B1_MIN_COMPLETED_PAIRS}）、覆盖故事 ${coveredStories}（至少 ${R6_STORY_COUNT}），样本不足`,
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
		values.inconsistentShare !== null &&
		values.inconsistentShare > R6_MAX_INCONSISTENT_SHARE
	) {
		reasons.push(
			`换序不一致 ${formatPercent(values.inconsistentShare)} 超过 ${formatPercent(R6_MAX_INCONSISTENT_SHARE)}`,
		);
	}
	if (
		values.judgeFailureShare !== null &&
		values.judgeFailureShare > R6_MAX_JUDGE_FAILURE_SHARE
	) {
		reasons.push(
			`裁判失败 ${formatPercent(values.judgeFailureShare)} 超过 ${formatPercent(R6_MAX_JUDGE_FAILURE_SHARE)}`,
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
	};
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
	const b1 = requireObject(root.b1, "b1");
	const b1Pairs = validatePairCounts(b1.pairs, "b1.pairs");
	const completed = completedPairs(b1Pairs);
	const plannedPairs = requireNonNegativeInteger(
		b1.plannedPairs,
		"b1.plannedPairs",
	);
	const failures = requireNonNegativeInteger(b1.failures, "b1.failures");
	if (completed + failures > plannedPairs) {
		throw new Error(
			`b1 完成配对 ${completed} 与失败 ${failures} 之和超过计划配对 ${plannedPairs}`,
		);
	}
	validateStoryCoverage(b1.stories, "b1.stories", completed);
	const judgments = requireObject(b1.judgments, "b1.judgments");
	const judgmentCompleted = requireNonNegativeInteger(
		judgments.completed,
		"b1.judgments.completed",
	);
	const judgmentFailed = requireNonNegativeInteger(
		judgments.failed,
		"b1.judgments.failed",
	);
	if (judgmentCompleted < completed * 2) {
		throw new Error(
			`b1.judgments.completed 至少应为 ${completed * 2}（每对两种顺序各一次），收到 ${judgmentCompleted}`,
		);
	}
	if (judgmentFailed < failures) {
		throw new Error(
			`b1.judgments.failed 不能少于失败配对 ${failures}，收到 ${judgmentFailed}`,
		);
	}
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
