import type {
	PlaytestFailureRecord,
	PlaytestMechanismRecord,
	PlaytestPreferenceCounts,
	PlaytestRecord,
	PlaytestRoundRecord,
} from "./records";
import { isPlaytestFailureRecord, isPlaytestRoundRecord } from "./records";

/** 与参照文本相同的口径：按码点取字符 4-gram，相邻块之间算 Jaccard。 */
const NGRAM_SIZE = 4;

export interface PlaytestPercentiles {
	readonly count: number;
	readonly mean: number;
	readonly median: number;
	readonly p90: number;
	readonly p95: number;
	readonly p99: number;
	readonly max: number;
}

export interface PlaytestLatency {
	readonly count: number;
	readonly mean: number;
	readonly p50: number;
	readonly p95: number;
}

export interface PlaytestMechanismHit {
	readonly name: string;
	readonly triggered: number;
	readonly total: number;
}

export interface PlaytestTokenStats {
	readonly promptTotal: number;
	readonly completionTotal: number;
	readonly totalTotal: number;
	readonly reasoningTotal: number;
	readonly roundsWithUsage: number;
	readonly promptPerRound: number | null;
	readonly completionPerRound: number | null;
	readonly totalPerRound: number | null;
}

export interface PlaytestClueStats {
	readonly opened: number;
	readonly fulfilled: number;
	/** 兑现数除以新开数；没有新开线索时为 null。 */
	readonly fulfillmentRate: number | null;
	readonly meanAge: number | null;
	readonly agedFulfillments: number;
}

export interface PlaytestErrorStats {
	readonly count: number;
	readonly steps: readonly string[];
}

export interface PlaytestAggregate {
	readonly requestedRounds: number;
	readonly succeededRounds: number;
	readonly failedRounds: number;
	readonly firstToken: PlaytestLatency;
	readonly duration: PlaytestLatency;
	readonly tokens: PlaytestTokenStats;
	readonly jaccard: PlaytestPercentiles;
	readonly director: {
		readonly decisions: number;
		readonly directives: number;
		readonly mechanisms: readonly PlaytestMechanismHit[];
	};
	readonly clues: PlaytestClueStats;
	readonly errors: PlaytestErrorStats;
	readonly preferenceCounts: PlaytestPreferenceCounts;
}

export function summarizePlaytest(input: {
	readonly requestedRounds: number;
	readonly records: readonly PlaytestRecord[];
	readonly preferenceCounts: PlaytestPreferenceCounts;
}): PlaytestAggregate {
	const rounds = input.records.filter(isPlaytestRoundRecord);
	const failures = input.records.filter(isPlaytestFailureRecord);
	return {
		requestedRounds: input.requestedRounds,
		succeededRounds: rounds.length,
		failedRounds: failures.length,
		firstToken: latencyOf(
			rounds
				.map((round) => round.firstTokenMs)
				.filter((value): value is number => value !== null),
		),
		duration: latencyOf(rounds.map((round) => round.durationMs)),
		tokens: tokenStats(rounds),
		jaccard: percentiles(adjacentBlockJaccard(rounds)),
		director: directorStats(rounds),
		clues: clueStats(rounds),
		errors: errorStats(failures),
		preferenceCounts: input.preferenceCounts,
	};
}

function latencyOf(values: readonly number[]): PlaytestLatency {
	if (values.length === 0) {
		return { count: 0, mean: 0, p50: 0, p95: 0 };
	}
	const sorted = [...values].sort((left, right) => left - right);
	const mean =
		values.reduce((total, value) => total + value, 0) / values.length;
	return {
		count: values.length,
		mean,
		p50: nearestRank(sorted, 0.5),
		p95: nearestRank(sorted, 0.95),
	};
}

/** 与 st-compat 的 summarize 相同的最近秩口径。 */
export function percentiles(values: readonly number[]): PlaytestPercentiles {
	if (values.length === 0) {
		return { count: 0, mean: 0, median: 0, p90: 0, p95: 0, p99: 0, max: 0 };
	}
	const sorted = [...values].sort((left, right) => left - right);
	const mean =
		values.reduce((total, value) => total + value, 0) / values.length;
	return {
		count: values.length,
		mean,
		median: nearestRank(sorted, 0.5),
		p90: nearestRank(sorted, 0.9),
		p95: nearestRank(sorted, 0.95),
		p99: nearestRank(sorted, 0.99),
		max: sorted[sorted.length - 1] as number,
	};
}

function nearestRank(sorted: readonly number[], quantile: number): number {
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(sorted.length * quantile) - 1),
	);
	return sorted[index] as number;
}

function tokenStats(
	rounds: readonly PlaytestRoundRecord[],
): PlaytestTokenStats {
	let promptTotal = 0;
	let completionTotal = 0;
	let totalTotal = 0;
	let reasoningTotal = 0;
	let roundsWithUsage = 0;
	for (const round of rounds) {
		const { promptTokens, completionTokens, totalTokens, reasoningTokens } =
			round.usage;
		if (
			promptTokens === null &&
			completionTokens === null &&
			totalTokens === null &&
			reasoningTokens === null
		) {
			continue;
		}
		roundsWithUsage += 1;
		promptTotal += promptTokens ?? 0;
		completionTotal += completionTokens ?? 0;
		totalTotal += totalTokens ?? 0;
		reasoningTotal += reasoningTokens ?? 0;
	}
	return {
		promptTotal,
		completionTotal,
		totalTotal,
		reasoningTotal,
		roundsWithUsage,
		promptPerRound:
			roundsWithUsage === 0 ? null : promptTotal / roundsWithUsage,
		completionPerRound:
			roundsWithUsage === 0 ? null : completionTotal / roundsWithUsage,
		totalPerRound: roundsWithUsage === 0 ? null : totalTotal / roundsWithUsage,
	};
}

/** 按行切块（去掉空行），相邻块用字符 4-gram Jaccard；与参照文本统计同口径。 */
export function adjacentBlockJaccard(
	rounds: readonly PlaytestRoundRecord[],
): number[] {
	const blocks = rounds.flatMap((round) =>
		round.assistant
			.replace(/\r\n?/g, "\n")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0),
	);
	const values: number[] = [];
	for (let index = 1; index < blocks.length; index += 1) {
		values.push(
			jaccardSimilarity(
				charNgrams(blocks[index - 1] as string),
				charNgrams(blocks[index] as string),
			),
		);
	}
	return values;
}

function charNgrams(text: string): Set<string> {
	const chars = Array.from(text);
	const grams = new Set<string>();
	if (chars.length < NGRAM_SIZE) return grams;
	for (let index = 0; index + NGRAM_SIZE <= chars.length; index += 1) {
		grams.add(chars.slice(index, index + NGRAM_SIZE).join(""));
	}
	return grams;
}

function jaccardSimilarity(
	left: ReadonlySet<string>,
	right: ReadonlySet<string>,
): number {
	if (left.size === 0 && right.size === 0) return 0;
	let intersection = 0;
	const [small, large] =
		left.size <= right.size ? [left, right] : [right, left];
	for (const gram of small) {
		if (large.has(gram)) intersection += 1;
	}
	const union = left.size + right.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

function directorStats(rounds: readonly PlaytestRoundRecord[]): {
	decisions: number;
	directives: number;
	mechanisms: PlaytestMechanismHit[];
} {
	const hits = new Map<string, { triggered: number; total: number }>();
	let decisions = 0;
	let directives = 0;
	for (const round of rounds) {
		const director = round.director;
		if (director === null) continue;
		decisions += 1;
		if (director.directive !== null) directives += 1;
		accumulateMechanisms(hits, director.mechanisms);
	}
	return {
		decisions,
		directives,
		mechanisms: [...hits.entries()]
			.map(([name, value]) => ({
				name,
				triggered: value.triggered,
				total: value.total,
			}))
			.sort((left, right) => left.name.localeCompare(right.name)),
	};
}

function accumulateMechanisms(
	hits: Map<string, { triggered: number; total: number }>,
	mechanisms: readonly PlaytestMechanismRecord[],
): void {
	for (const mechanism of mechanisms) {
		const current = hits.get(mechanism.name) ?? { triggered: 0, total: 0 };
		current.total += 1;
		if (mechanism.triggered) current.triggered += 1;
		hits.set(mechanism.name, current);
	}
}

function clueStats(rounds: readonly PlaytestRoundRecord[]): PlaytestClueStats {
	let opened = 0;
	let fulfilled = 0;
	let ageTotal = 0;
	let agedFulfillments = 0;
	for (const round of rounds) {
		opened += round.newClueIds.length;
		fulfilled += round.fulfilledClueIds.length;
		ageTotal += round.fulfilledClueAges.reduce((total, age) => total + age, 0);
		agedFulfillments += round.fulfilledClueAges.length;
	}
	return {
		opened,
		fulfilled,
		fulfillmentRate: opened === 0 ? null : fulfilled / opened,
		meanAge: agedFulfillments === 0 ? null : ageTotal / agedFulfillments,
		agedFulfillments,
	};
}

function errorStats(
	failures: readonly PlaytestFailureRecord[],
): PlaytestErrorStats {
	return {
		count: failures.length,
		steps: [...new Set(failures.map((failure) => failure.stepId))],
	};
}
