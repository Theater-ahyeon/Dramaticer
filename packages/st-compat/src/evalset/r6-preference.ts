import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	type StoryStore,
	StoryStore as StoryStoreClass,
	modelFamily,
} from "@dramaticer/core";
import type { PreferencePair } from "../preferences/export.js";
import {
	type R6PreferenceGateInput,
	R6_GATE_VERSION,
	R6_MIN_PREFERENCE_PAIRS,
	type WilsonInterval,
	wilsonInterval,
} from "./gates.js";
import {
	type NormalizedWinner,
	PAIRWISE_ORDERS,
	type PairwiseJudge,
	type PairwiseOrder,
	type PairwiseTask,
	type PreferenceComparisonRecord,
	type PreferenceSample,
	buildPreferenceSample,
	normalizeWinner,
	parseComparisonRecordsJsonl,
	parsePreferencePairsJsonl,
	runPreferenceSample,
} from "./pairwise.js";

export const R6_PREFERENCE_FORMAT = "dramaticer.r6-preference";

/** 配对级结果：两种顺序都选接受侧、都选放弃侧、都判平，或换序不一致。 */
export type R6PreferencePairOutcome =
	| "accepted"
	| "abandoned"
	| "tie"
	| "inconsistent";

/** 汇总只依赖样本标识、故事与类型，不读正文。 */
export interface R6PreferenceSampleRef {
	readonly sampleId: string;
	readonly storyId: string;
	readonly kind: PairwiseTask;
}

export interface R6PreferenceCounts {
	readonly plannedPairs: number;
	readonly completedPairs: number;
	readonly accepted: number;
	readonly abandoned: number;
	readonly ties: number;
	readonly inconsistent: number;
	readonly failures: number;
}

export interface R6PreferenceStorySummary extends R6PreferenceCounts {
	readonly story: string;
}

export interface R6PreferenceKindSummary extends R6PreferenceCounts {
	readonly kind: PairwiseTask;
}

export interface R6PreferenceSummary {
	readonly plannedPairs: number;
	readonly completedPairs: number;
	readonly accepted: number;
	readonly abandoned: number;
	readonly ties: number;
	readonly inconsistent: number;
	readonly failures: number;
	readonly judgementsCompleted: number;
	readonly judgementsFailed: number;
	readonly consistency: number | null;
	readonly wilson: WilsonInterval | null;
	readonly judgeFailureShare: number | null;
	readonly insufficient: boolean;
	readonly insufficientReason: string | null;
	readonly judge: {
		readonly model: string;
		readonly family: string;
	};
	readonly stories: readonly R6PreferenceStorySummary[];
	readonly kinds: readonly R6PreferenceKindSummary[];
}

export interface R6PreferenceReport {
	readonly format: typeof R6_PREFERENCE_FORMAT;
	readonly gateVersion: string;
	readonly generatedAt: string;
	readonly pairsSources: readonly string[];
	readonly samples: readonly PreferenceSample[];
	readonly records: readonly PreferenceComparisonRecord[];
	readonly summary: R6PreferenceSummary;
}

export interface R6PreferenceOptions {
	/** 回复对引用的故事所在的数据库；只读。 */
	readonly sourceDbPath: string;
	/** `preferences export` 的输出目录或单个 `.pairs.jsonl`。 */
	readonly pairsPath: string;
	readonly dir: string;
	/** 只评判这个故事的回复对。 */
	readonly story?: string | null;
	readonly judge: PairwiseJudge;
	readonly now?: () => Date;
	readonly log?: (message: string) => void;
}

/** 读回复对；目录里只接受 `preferences export` 写出的 `.pairs.jsonl`。 */
export function loadR6PreferencePairs(
	pairsPath: string,
	story: string | null = null,
): PreferencePair[] {
	const files = collectPairFiles(pairsPath);
	const pairs = files.flatMap((file) => {
		const loaded = parsePreferencePairsJsonl(readFileSync(file, "utf8"), file);
		return story === null
			? loaded
			: loaded.filter((pair) => pair.storyId === story);
	});
	if (pairs.length === 0) {
		throw new Error(
			story === null
				? `没有可用的回复对：${pairsPath}`
				: `没有故事 ${story} 的回复对：${pairsPath}`,
		);
	}
	return pairs;
}

function collectPairFiles(pairsPath: string): string[] {
	if (!existsSync(pairsPath)) {
		throw new Error(`回复对路径不存在：${pairsPath}`);
	}
	const stats = statSync(pairsPath);
	if (stats.isFile()) return [pairsPath];
	if (!stats.isDirectory()) {
		throw new Error(`回复对路径既不是文件也不是目录：${pairsPath}`);
	}
	const files = readdirSync(pairsPath)
		.filter((name) => name.endsWith(".pairs.jsonl"))
		.sort()
		.map((name) => path.join(pairsPath, name));
	if (files.length === 0) {
		throw new Error(`目录里没有 .pairs.jsonl：${pairsPath}`);
	}
	return files;
}

/** 用导出对构造盲测样本；同一标识的重复回复对只保留第一条。 */
export function planR6PreferenceSamples(
	store: StoryStore,
	pairs: readonly PreferencePair[],
): PreferenceSample[] {
	const storyIds = [...new Set(pairs.map((pair) => pair.storyId))];
	for (const storyId of storyIds) {
		if (store.getStory(storyId) === null) {
			throw new Error(`数据库里没有故事 ${storyId}`);
		}
	}
	const samples = new Map<string, PreferenceSample>();
	for (const pair of pairs) {
		const sample = buildPreferenceSample(store, pair);
		if (!samples.has(sample.sampleId)) samples.set(sample.sampleId, sample);
	}
	return [...samples.values()];
}

/** 两种顺序的归一结论换算成配对级结果；任一顺序缺失或失败返回 null。 */
export function preferencePairOutcome(
	first: NormalizedWinner | null,
	second: NormalizedWinner | null,
): R6PreferencePairOutcome | null {
	if (first === null || second === null) return null;
	if (first === "accepted" && second === "accepted") return "accepted";
	if (first === "abandoned" && second === "abandoned") return "abandoned";
	if (first === "tie" && second === "tie") return "tie";
	return "inconsistent";
}

/**
 * 汇总配对级结果。同一样本同一顺序有多行时取最后一行；
 * 缺少任一顺序的记录或该顺序判定失败时计入失败，不进入一致率分母。
 */
export function summarizeR6Preference(input: {
	readonly samples: readonly R6PreferenceSampleRef[];
	readonly records: readonly PreferenceComparisonRecord[];
	readonly judgeModel: string;
}): R6PreferenceSummary {
	const planned = new Map<string, R6PreferenceSampleRef>();
	for (const sample of input.samples) {
		if (planned.has(sample.sampleId)) {
			throw new Error(`样本 id 重复：${sample.sampleId}`);
		}
		planned.set(sample.sampleId, sample);
	}
	for (const record of input.records) {
		const sample = planned.get(record.sampleId);
		if (sample === undefined) {
			throw new Error(
				`记录 ${record.sampleId} 不属于当前样本；删除 records.jsonl 后重跑`,
			);
		}
		if (record.storyId !== sample.storyId) {
			throw new Error(
				`记录 ${record.sampleId} 的故事 ${record.storyId} 与样本 ${sample.storyId} 不一致`,
			);
		}
		if (record.kind !== sample.kind) {
			throw new Error(
				`记录 ${record.sampleId} 的类型 ${record.kind} 与样本 ${sample.kind} 不一致`,
			);
		}
	}
	const latest = latestRecords(input.records);
	const totals = countSamples(input.samples, latest);
	const stories = [
		...new Set(input.samples.map((sample) => sample.storyId)),
	].map((story) => ({
		story,
		...countSamples(
			input.samples.filter((sample) => sample.storyId === story),
			latest,
		),
	}));
	const kinds = (["reroll", "choice", "historical"] as const)
		.filter((kind) => input.samples.some((sample) => sample.kind === kind))
		.map((kind) => ({
			kind,
			...countSamples(
				input.samples.filter((sample) => sample.kind === kind),
				latest,
			),
		}));
	const records = [...latest.values()].flatMap((orders) => [
		...orders.values(),
	]);
	const judgementsCompleted = records.filter(
		(record) => record.status === "done",
	).length;
	const judgementsFailed = records.filter(
		(record) => record.status === "failed",
	).length;
	const judgements = judgementsCompleted + judgementsFailed;
	const wilson = wilsonInterval(totals.accepted, totals.completedPairs);
	const insufficient = totals.completedPairs < R6_MIN_PREFERENCE_PAIRS;
	return {
		plannedPairs: totals.plannedPairs,
		completedPairs: totals.completedPairs,
		accepted: totals.accepted,
		abandoned: totals.abandoned,
		ties: totals.ties,
		inconsistent: totals.inconsistent,
		failures: totals.failures,
		judgementsCompleted,
		judgementsFailed,
		consistency:
			totals.completedPairs === 0
				? null
				: totals.accepted / totals.completedPairs,
		wilson,
		judgeFailureShare: judgements === 0 ? null : judgementsFailed / judgements,
		insufficient,
		insufficientReason: insufficient
			? `完成配对 ${totals.completedPairs} 少于 ${R6_MIN_PREFERENCE_PAIRS}，未证实`
			: null,
		judge: {
			model: input.judgeModel,
			family: modelFamily(input.judgeModel),
		},
		stories,
		kinds,
	};
}

/** 逐样本逐顺序的判定记录；续跑与报告都从这里取。 */
export function mergeR6PreferenceRecords(
	existing: readonly PreferenceComparisonRecord[],
	fresh: readonly PreferenceComparisonRecord[],
): PreferenceComparisonRecord[] {
	const merged = new Map<string, PreferenceComparisonRecord>();
	for (const record of [...existing, ...fresh]) {
		merged.set(recordKey(record), record);
	}
	return [...merged.values()].sort(compareRecords);
}

/** G6 的判定输入；样本少于 30 对时由门槛记未证实。 */
export function r6PreferenceGateInput(
	summary: R6PreferenceSummary,
): R6PreferenceGateInput {
	return {
		accepted: summary.accepted,
		abandoned: summary.abandoned,
		ties: summary.ties,
		inconsistent: summary.inconsistent,
		failures: summary.failures,
	};
}

export async function runR6Preference(
	options: R6PreferenceOptions,
): Promise<R6PreferenceReport> {
	const log = options.log ?? (() => undefined);
	const now = options.now ?? (() => new Date());
	if (!existsSync(options.sourceDbPath)) {
		throw new Error(`数据库不存在：${options.sourceDbPath}`);
	}
	const pairs = loadR6PreferencePairs(options.pairsPath, options.story ?? null);
	const store = StoryStoreClass.open(options.sourceDbPath);
	let samples: PreferenceSample[];
	try {
		samples = planR6PreferenceSamples(store, pairs);
	} finally {
		store.close();
	}
	if (samples.length === 0) {
		throw new Error("没有可用的偏好样本");
	}
	const recordsFile = path.join(options.dir, "records.jsonl");
	const existing = await loadRecords(recordsFile);
	for (const record of existing) {
		if (record.model !== options.judge.model) {
			throw new Error(
				`${recordsFile} 里的判定使用裁判模型 ${record.model}，与本次 ${options.judge.model} 不一致；删除该文件后重跑`,
			);
		}
	}
	summarizeR6Preference({
		samples,
		records: existing,
		judgeModel: options.judge.model,
	});
	let records = existing;
	for (const sample of samples) {
		const known = new Set(records.map((record) => recordKey(record)));
		const missing = PAIRWISE_ORDERS.filter(
			(order) => !known.has(`${sample.sampleId}\u0000${order}`),
		);
		if (missing.length === 0) {
			log(`样本 ${sample.sampleId}：复用已有判定`);
			continue;
		}
		const fresh = await runPreferenceSample(sample, options.judge, {
			now: () => now().toISOString(),
		});
		records = mergeR6PreferenceRecords(records, fresh);
		await saveRecords(recordsFile, records);
		log(
			`样本 ${sample.sampleId}：${fresh
				.map((record) =>
					record.status === "done"
						? `${record.order} ${record.winner}`
						: `${record.order} 失败`,
				)
				.join("，")}`,
		);
	}
	const summary = summarizeR6Preference({
		samples,
		records,
		judgeModel: options.judge.model,
	});
	log(
		`R6 偏好一致率：计划 ${summary.plannedPairs} 对，完成 ${summary.completedPairs}，一致 ${summary.accepted}、不一致 ${summary.abandoned}、平 ${summary.ties}、换序不一致 ${summary.inconsistent}、失败 ${summary.failures}${summary.insufficient ? "（样本不足，未证实）" : ""}`,
	);
	return {
		format: R6_PREFERENCE_FORMAT,
		gateVersion: R6_GATE_VERSION,
		generatedAt: now().toISOString(),
		pairsSources: collectPairFiles(options.pairsPath),
		samples,
		records,
		summary,
	};
}

function countSamples(
	samples: readonly R6PreferenceSampleRef[],
	latest: ReadonlyMap<
		string,
		ReadonlyMap<PairwiseOrder, PreferenceComparisonRecord>
	>,
): R6PreferenceCounts {
	let accepted = 0;
	let abandoned = 0;
	let ties = 0;
	let inconsistent = 0;
	let failures = 0;
	for (const sample of samples) {
		const orders = latest.get(sample.sampleId);
		const first = normalizedWinnerOf(orders?.get("accepted-first"));
		const second = normalizedWinnerOf(orders?.get("abandoned-first"));
		const outcome = preferencePairOutcome(first, second);
		if (outcome === "accepted") accepted += 1;
		else if (outcome === "abandoned") abandoned += 1;
		else if (outcome === "tie") ties += 1;
		else if (outcome === "inconsistent") inconsistent += 1;
		else failures += 1;
	}
	return {
		plannedPairs: samples.length,
		completedPairs: accepted + abandoned + ties + inconsistent,
		accepted,
		abandoned,
		ties,
		inconsistent,
		failures,
	};
}

function normalizedWinnerOf(
	record: PreferenceComparisonRecord | undefined,
): NormalizedWinner | null {
	if (record === undefined || record.status !== "done") return null;
	return normalizeWinner(record.order, record.winner);
}

function latestRecords(
	records: readonly PreferenceComparisonRecord[],
): Map<string, Map<PairwiseOrder, PreferenceComparisonRecord>> {
	const bySample = new Map<
		string,
		Map<PairwiseOrder, PreferenceComparisonRecord>
	>();
	for (const record of records) {
		let orders = bySample.get(record.sampleId);
		if (orders === undefined) {
			orders = new Map();
			bySample.set(record.sampleId, orders);
		}
		orders.set(record.order, record);
	}
	return bySample;
}

function recordKey(record: PreferenceComparisonRecord): string {
	return `${record.sampleId}\u0000${record.order}`;
}

function compareRecords(
	left: PreferenceComparisonRecord,
	right: PreferenceComparisonRecord,
): number {
	if (left.sampleId !== right.sampleId) {
		return left.sampleId < right.sampleId ? -1 : 1;
	}
	return (
		PAIRWISE_ORDERS.indexOf(left.order) - PAIRWISE_ORDERS.indexOf(right.order)
	);
}

async function loadRecords(
	file: string,
): Promise<PreferenceComparisonRecord[]> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	return parseComparisonRecordsJsonl(raw, file);
}

async function saveRecords(
	file: string,
	records: readonly PreferenceComparisonRecord[],
): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp`;
	await writeFile(
		temporary,
		records.map((record) => `${JSON.stringify(record)}\n`).join(""),
		"utf8",
	);
	await rename(temporary, file);
}

/** 报告只写聚合数字、故事 slug 与模型别名，不含样本正文与标识。 */
export function formatR6PreferenceReport(report: R6PreferenceReport): string {
	const summary = report.summary;
	const lines: string[] = [];
	lines.push("# R6 偏好一致率（G6）");
	lines.push("");
	lines.push(`- 门槛版本：${report.gateVersion}`);
	lines.push(`- 生成时间：${report.generatedAt}`);
	lines.push(`- 裁判：${summary.judge.model}（${summary.judge.family}）`);
	lines.push(
		`- 配对：计划 ${summary.plannedPairs}，完成 ${summary.completedPairs}，一致 ${summary.accepted}、不一致 ${summary.abandoned}、平 ${summary.ties}、换序不一致 ${summary.inconsistent}、失败 ${summary.failures}`,
	);
	lines.push(
		`- 一致率：${formatPercent(summary.consistency)}（Wilson 95% ${formatInterval(summary.wilson)}）；判定失败 ${summary.judgementsFailed}/${summary.judgementsCompleted + summary.judgementsFailed}（${formatPercent(summary.judgeFailureShare)}）`,
	);
	lines.push(
		`- 判定：${summary.insufficient ? `未证实——${summary.insufficientReason}` : `完成配对达到 ${R6_MIN_PREFERENCE_PAIRS}，交门槛判定`}`,
	);
	lines.push(
		"- 口径：真实玩家偏好对按接受侧在前、接受侧在后各判一次；两种顺序都选中玩家接受侧记为一致，都选放弃侧记为不一致，都判平记为平，其余记为换序不一致；一致率分母只含完成配对，缺少顺序或判定失败计入失败。完成配对少于 30 对时 G6 记为未证实，不计为未通过。",
	);
	lines.push("");
	lines.push("|故事|计划|完成|一致|不一致|平|换序不一致|失败|");
	lines.push("|---|---|---|---|---|---|---|---|");
	for (const story of summary.stories) {
		lines.push(
			`|${story.story}|${story.plannedPairs}|${story.completedPairs}|${story.accepted}|${story.abandoned}|${story.ties}|${story.inconsistent}|${story.failures}|`,
		);
	}
	lines.push("");
	lines.push("|类型|计划|完成|一致|不一致|平|换序不一致|失败|");
	lines.push("|---|---|---|---|---|---|---|---|");
	for (const kind of summary.kinds) {
		lines.push(
			`|${kind.kind}|${kind.plannedPairs}|${kind.completedPairs}|${kind.accepted}|${kind.abandoned}|${kind.ties}|${kind.inconsistent}|${kind.failures}|`,
		);
	}
	lines.push("");
	return lines.join("\n");
}

function formatPercent(value: number | null): string {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatInterval(value: WilsonInterval | null): string {
	return value === null
		? "—"
		: `${(value.lower * 100).toFixed(1)}%–${(value.upper * 100).toFixed(1)}%`;
}
