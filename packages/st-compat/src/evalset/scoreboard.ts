import type { ChatProfile } from "@dramaticer/core";
import { measureBlockRepetition } from "./director-eval.js";
import {
	FORGETTING_CORPORA,
	FORGETTING_DEPTH_LAYERS,
	type ForgettingRunResult,
	type ForgettingSummary,
	forgettingCorpusLabel,
	summarizeForgettingRuns,
} from "./forgetting.js";
import type {
	HistoricalReplayRecord,
	HistoricalReplaySample,
	HistoricalReplaySummary,
} from "./historical-replay.js";
import { summarizeHistoricalReplay } from "./historical-replay.js";
import type { PreferenceComparisonRecord } from "./pairwise.js";
import {
	type PreferenceComparisonSummary,
	summarizePreferenceComparisons,
} from "./pairwise.js";
import type { PlaytestRecord } from "./playtest.js";
import type { QualityRecord } from "./quality.js";
import { type QualitySummary, summarizeQuality } from "./quality.js";

export const SCOREBOARD_PHASE_DEFAULT = "R2";
export const SCOREBOARD_DEFAULT_CONCLUSION = "由 R2-T99 验收给出。";
export const SCOREBOARD_DEFAULT_NEXT =
	"执行 R2-T99 验收，并在 `docs/dev/reports/R2.md` 汇总样本数与限制。";

const UNRECORDED_MODEL = "未记录";
const QUALITY_SIDE_LABELS = {
	pairwise: { accepted: "接受侧", abandoned: "放弃侧" },
	b1: { accepted: "续写", abandoned: "历史回复" },
} as const;

export type QualitySource = keyof typeof QUALITY_SIDE_LABELS;

export interface ScoreboardInputs {
	readonly phase?: string;
	/** 不传时从输入里的时间戳推导；推导不出时失败。 */
	readonly date?: string | null;
	readonly conclusion?: string | null;
	readonly next?: string | null;
	readonly playtests?: readonly PlaytestRecord[];
	readonly pairwiseRecords?: readonly PreferenceComparisonRecord[];
	readonly pairwiseQuality?: readonly QualityRecord[];
	readonly forgettingRuns?: readonly ForgettingRunResult[];
	readonly b1Samples?: readonly HistoricalReplaySample[];
	readonly b1Records?: readonly HistoricalReplayRecord[];
	readonly b1Quality?: readonly QualityRecord[];
}

export interface PlaytestGroupStats {
	readonly profile: ChatProfile;
	readonly model: string;
	readonly stories: number;
	readonly rounds: number;
	readonly failedRounds: number;
	/** 相邻助手回复的字符 4-gram Jaccard 均值；不足两条回复时为 null。 */
	readonly repetition: number | null;
	readonly firstTokenP50: number | null;
	readonly firstTokenP95: number | null;
	readonly truncationRate: number | null;
	readonly gapUnfinishedRate: number | null;
	readonly promptTokensPerRound: number | null;
	readonly completionTokensPerRound: number | null;
	readonly totalTokensPerRound: number | null;
}

export interface ScoreboardQualitySection {
	readonly source: QualitySource;
	readonly summary: QualitySummary;
}

export interface Scoreboard {
	readonly phase: string;
	readonly date: string;
	readonly writerModels: readonly string[];
	readonly judgeModels: readonly string[];
	readonly playtest: readonly PlaytestGroupStats[];
	readonly preference: PreferenceComparisonSummary | null;
	readonly forgetting: ForgettingSummary | null;
	readonly quality: readonly ScoreboardQualitySection[];
	readonly b1: HistoricalReplaySummary | null;
	readonly counts: {
		readonly playtestRounds: number;
		readonly playtestFailures: number;
		readonly forgettingRuns: number;
		readonly pairwiseRecords: number;
		readonly b1Samples: number;
	};
	readonly b1SameModelSamples: number;
	readonly conclusion: string;
	readonly next: string;
}

/**
 * 记分牌只做聚合。日期取输入里最晚的时间戳，因此同一批输入在任何一天
 * 生成都得到逐字节相同的结果。
 */
export function buildScoreboard(inputs: ScoreboardInputs): Scoreboard {
	const playtests = inputs.playtests ?? [];
	const pairwiseRecords = inputs.pairwiseRecords ?? [];
	const pairwiseQuality = inputs.pairwiseQuality ?? [];
	const forgettingRuns = inputs.forgettingRuns ?? [];
	const b1Samples = inputs.b1Samples ?? [];
	const b1Records = inputs.b1Records ?? [];
	const b1Quality = inputs.b1Quality ?? [];
	const date = inputs.date ?? inferScoreboardDate(inputs);
	const quality: ScoreboardQualitySection[] = [];
	if (pairwiseQuality.length > 0) {
		quality.push({
			source: "pairwise",
			summary: summarizeQuality(pairwiseQuality),
		});
	}
	if (b1Quality.length > 0) {
		quality.push({ source: "b1", summary: summarizeQuality(b1Quality) });
	}
	const doneRounds = playtests.filter(
		(record): record is Extract<PlaytestRecord, { status: "done" }> =>
			record.status === "done",
	);
	const aliases = aliasesByProfile(forgettingRuns);
	return {
		phase: inputs.phase ?? SCOREBOARD_PHASE_DEFAULT,
		date,
		writerModels: collectWriterModels(
			playtests,
			aliases,
			forgettingRuns,
			b1Samples,
		),
		judgeModels: collectJudgeModels(
			forgettingRuns,
			b1Samples,
			pairwiseQuality,
			b1Quality,
		),
		playtest: summarizePlaytests(playtests, aliases),
		preference:
			pairwiseRecords.length === 0
				? null
				: summarizePreferenceComparisons(pairwiseRecords),
		forgetting:
			forgettingRuns.length === 0
				? null
				: summarizeForgettingRuns(forgettingRuns),
		quality,
		b1:
			b1Samples.length === 0
				? null
				: summarizeHistoricalReplay(b1Records, b1Samples),
		counts: {
			playtestRounds: doneRounds.length,
			playtestFailures: playtests.length - doneRounds.length,
			forgettingRuns: forgettingRuns.length,
			pairwiseRecords: pairwiseRecords.length,
			b1Samples: b1Samples.length,
		},
		b1SameModelSamples: b1Samples.filter((sample) => sample.sameModel).length,
		conclusion: inputs.conclusion ?? SCOREBOARD_DEFAULT_CONCLUSION,
		next: inputs.next ?? SCOREBOARD_DEFAULT_NEXT,
	};
}

export function summarizePlaytests(
	records: readonly PlaytestRecord[],
	aliasesByProfile: ReadonlyMap<ChatProfile, readonly string[]> = new Map(),
): PlaytestGroupStats[] {
	const groups = new Map<ChatProfile, PlaytestRecord[]>();
	for (const record of records) {
		const group = groups.get(record.profile);
		if (group === undefined) groups.set(record.profile, [record]);
		else group.push(record);
	}
	return [...groups.values()]
		.map((group) => summarizePlaytestGroup(group, aliasesByProfile))
		.sort((left, right) =>
			left.profile < right.profile ? -1 : left.profile > right.profile ? 1 : 0,
		);
}

function summarizePlaytestGroup(
	records: readonly PlaytestRecord[],
	aliasesByProfile: ReadonlyMap<ChatProfile, readonly string[]>,
): PlaytestGroupStats {
	const first = records[0] as PlaytestRecord;
	const traceModels = [
		...new Set(
			records
				.filter(
					(record): record is Extract<PlaytestRecord, { status: "done" }> =>
						record.status === "done",
				)
				.map((record) => record.trace.model),
		),
	].sort();
	const traceModel =
		traceModels.length === 0 ? UNRECORDED_MODEL : traceModels.join("、");
	const aliases = aliasesByProfile.get(first.profile) ?? [];
	const model =
		traceModels.length === 0
			? UNRECORDED_MODEL
			: aliases.length === 0
				? traceModel
				: `${aliases.join("/")}（${traceModel}）`;
	const done = records
		.filter(
			(record): record is Extract<PlaytestRecord, { status: "done" }> =>
				record.status === "done",
		)
		.sort((left, right) => {
			if (left.storyId !== right.storyId) {
				return left.storyId < right.storyId ? -1 : 1;
			}
			return left.round - right.round;
		});
	const failed = records.filter((record) => record.status === "failed");
	const firstTokens = done
		.map((record) => record.firstTokenMs)
		.filter((value): value is number => value !== null);
	const repetition = measureBlockRepetition(
		done.map((record) => record.assistant),
	);
	return {
		profile: first.profile,
		model,
		stories: new Set(records.map((record) => record.storyId)).size,
		rounds: done.length,
		failedRounds: failed.length,
		repetition: repetition.summary.count === 0 ? null : repetition.summary.mean,
		firstTokenP50: percentile(firstTokens, 0.5),
		firstTokenP95: percentile(firstTokens, 0.95),
		truncationRate:
			done.length === 0
				? null
				: done.filter((record) => record.truncated).length / done.length,
		gapUnfinishedRate: meanOf(
			done.map((record) => record.gapWork.unfinishedRatio),
		),
		promptTokensPerRound: meanOf(
			done
				.map((record) => record.usage.promptTokens)
				.filter((value): value is number => value !== null),
		),
		completionTokensPerRound: meanOf(
			done
				.map((record) => record.usage.completionTokens)
				.filter((value): value is number => value !== null),
		),
		totalTokensPerRound: meanOf(
			done
				.map((record) => record.usage.totalTokens)
				.filter((value): value is number => value !== null),
		),
	};
}

function collectWriterModels(
	playtests: readonly PlaytestRecord[],
	aliasesByProfile: ReadonlyMap<ChatProfile, readonly string[]>,
	forgettingRuns: readonly ForgettingRunResult[],
	b1Samples: readonly HistoricalReplaySample[],
): string[] {
	const models = new Set<string>();
	for (const record of playtests) {
		if (record.status !== "done") continue;
		const aliases = aliasesByProfile.get(record.profile);
		if (aliases === undefined || aliases.length === 0) {
			models.add(record.trace.model);
		} else {
			for (const alias of aliases) models.add(alias);
		}
	}
	for (const run of forgettingRuns) models.add(run.model);
	for (const sample of b1Samples) models.add(sample.writerModel);
	return [...models].sort();
}

function collectJudgeModels(
	forgettingRuns: readonly ForgettingRunResult[],
	b1Samples: readonly HistoricalReplaySample[],
	pairwiseQuality: readonly QualityRecord[],
	b1Quality: readonly QualityRecord[],
): string[] {
	const models = new Set<string>();
	for (const run of forgettingRuns) models.add(run.judgeModel);
	for (const sample of b1Samples) models.add(sample.judgeModel);
	for (const record of [...pairwiseQuality, ...b1Quality]) {
		models.add(record.model);
	}
	return [...models].sort();
}

function inferScoreboardDate(inputs: ScoreboardInputs): string {
	const timestamps: string[] = [];
	for (const record of inputs.playtests ?? [])
		timestamps.push(record.startedAt);
	for (const run of inputs.forgettingRuns ?? [])
		timestamps.push(run.generatedAt);
	for (const sample of inputs.b1Samples ?? [])
		timestamps.push(sample.createdAt);
	for (const record of inputs.pairwiseRecords ?? []) {
		timestamps.push(record.createdAt);
	}
	for (const record of inputs.b1Records ?? [])
		timestamps.push(record.createdAt);
	for (const record of [
		...(inputs.pairwiseQuality ?? []),
		...(inputs.b1Quality ?? []),
	]) {
		timestamps.push(record.createdAt);
	}
	if (timestamps.length === 0) {
		throw new Error("输入里没有时间戳，无法推导记分牌日期；请显式传入 date");
	}
	let latest: number | null = null;
	for (const value of timestamps) {
		const parsed = Date.parse(value);
		if (Number.isNaN(parsed)) {
			throw new Error(`输入里的时间戳不是合法时间：${value}`);
		}
		latest = latest === null ? parsed : Math.max(latest, parsed);
	}
	return new Date(latest as number).toISOString().slice(0, 10);
}

function aliasesByProfile(
	forgettingRuns: readonly ForgettingRunResult[],
): Map<ChatProfile, readonly string[]> {
	const map = new Map<ChatProfile, Set<string>>();
	for (const run of forgettingRuns) {
		const models = map.get(run.profile);
		if (models === undefined) map.set(run.profile, new Set([run.model]));
		else models.add(run.model);
	}
	return new Map(
		[...map.entries()].map(([profile, models]) => [
			profile,
			[...models].sort(),
		]),
	);
}

function meanOf(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(
	values: readonly number[],
	quantile: number,
): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(sorted.length * quantile) - 1),
	);
	return sorted[index] as number;
}

const DEPTH_ORDER = ["<100", ...FORGETTING_DEPTH_LAYERS];

export function renderScoreboard(scoreboard: Scoreboard): string {
	const lines = [
		"# Dramaticer 记分牌（统计版）",
		"",
		`- 数据截止：${scoreboard.date}`,
		`- 阶段：${scoreboard.phase}`,
		`- 写作模型：${listOrDash(scoreboard.writerModels)}`,
		`- 裁判模型：${listOrDash(scoreboard.judgeModels)}`,
		`- 输入样本：试玩 ${scoreboard.counts.playtestRounds} 轮（失败 ${scoreboard.counts.playtestFailures}）、遗忘运行 ${scoreboard.counts.forgettingRuns} 次、偏好判定 ${scoreboard.counts.pairwiseRecords} 条、B1 回放 ${scoreboard.counts.b1Samples} 个`,
		"- 口径：只含聚合数字，不含故事 id、样本 id、正文与理由；同一批输入重复生成逐字节相同。",
		"",
		"## 试玩指标",
		"",
	];
	if (scoreboard.playtest.length === 0) {
		lines.push("没有试玩记录。");
	} else {
		lines.push(
			"重复度是相邻助手回复的字符 4-gram Jaccard 均值；成本按 token 用量统计，不含价格。",
			"",
			"| 档位 | 写作模型 | 故事数 | 完成轮次 | 失败轮次 | 重复度 | 首字 P50 (ms) | 首字 P95 (ms) | 截断率 | 间隙未完成率 | 输入 token/轮 | 输出 token/轮 | 合计 token/轮 |",
			"|---|---|---|---|---|---|---|---|---|---|---|---|---|",
		);
		for (const group of scoreboard.playtest) {
			lines.push(
				`| ${group.profile} | ${group.model} | ${group.stories} | ${group.rounds} | ${group.failedRounds} | ${formatDecimal(group.repetition, 3)} | ${formatInteger(group.firstTokenP50)} | ${formatInteger(group.firstTokenP95)} | ${formatRate(group.truncationRate)} | ${formatRate(group.gapUnfinishedRate)} | ${formatDecimal(group.promptTokensPerRound, 1)} | ${formatDecimal(group.completionTokensPerRound, 1)} | ${formatDecimal(group.totalTokensPerRound, 1)} |`,
			);
		}
	}
	lines.push("", "## 偏好一致率", "");
	if (scoreboard.preference === null) {
		lines.push("没有偏好判定记录。");
	} else {
		lines.push(
			"胜率与平局率按单次顺序判定统计；位置偏差是两种顺序结论不一致的样本占双向完成样本的比例；偏好一致率是双向结论都选中玩家实际选择的样本占双向完成样本的比例。总体一致率不含切回较早 swipe 的子集。",
			"",
			"| 组 | 样本 | 双向完成 | 顺序判定 | 接受胜率 | 平局率 | 位置偏差 | 偏好一致率 | 失败 |",
			"|---|---|---|---|---|---|---|---|---|",
		);
		for (const group of scoreboard.preference.groups) {
			lines.push(
				`| ${group.group} | ${group.samples} | ${group.completed} | ${group.judgements} | ${formatRate(group.acceptedShare)} | ${formatRate(group.tieShare)} | ${formatRate(group.positionBias)} | ${formatRate(group.preferenceConsistency)} | ${group.failures} |`,
			);
		}
	}
	lines.push("", "## 一致性与记忆", "");
	if (scoreboard.forgetting === null) {
		lines.push("没有遗忘运行记录。");
	} else {
		lines.push(
			"矛盾率的分母是一致加矛盾；编造回忆率的分母是编造题里裁判可判定的数量；无法判断与跳过不计入矛盾率。",
			"",
			"| 语料 | 深度层 | 档位 | 运行 | 轮次 | 题数 | 一致 | 矛盾 | 无法判断 | 跳过 | 失败 | 矛盾率 | 编造题 | 编造 | 编造回忆率 | 间隙探针矛盾率 |",
			"|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
		);
		const corpusRank = new Map(
			FORGETTING_CORPORA.map((corpus, index) => [corpus, index] as const),
		);
		const depthRank = new Map(
			DEPTH_ORDER.map((layer, index) => [layer, index] as const),
		);
		const layers = [...scoreboard.forgetting.layers].sort(
			(left, right) =>
				(corpusRank.get(left.corpus) ?? FORGETTING_CORPORA.length) -
					(corpusRank.get(right.corpus) ?? FORGETTING_CORPORA.length) ||
				(depthRank.get(left.depthLayer) ?? DEPTH_ORDER.length) -
					(depthRank.get(right.depthLayer) ?? DEPTH_ORDER.length) ||
				(left.profile < right.profile
					? -1
					: left.profile > right.profile
						? 1
						: 0),
		);
		for (const layer of layers) {
			lines.push(
				`| ${forgettingCorpusLabel(layer.corpus)} | ${layer.depthLayer} | ${layer.profile} | ${layer.runCount} | ${layer.rounds} | ${layer.questions} | ${layer.consistent} | ${layer.contradicted} | ${layer.unknown} | ${layer.skipped} | ${layer.failed} | ${formatRate(layer.contradictionRate)} | ${layer.fabricatedQuestions} | ${layer.fabricated} | ${formatRate(layer.fabricatedRate)} | ${formatRate(layer.inRunProbeContradictionRate)} |`,
			);
		}
	}
	lines.push("", "## 叙事质量", "");
	if (scoreboard.quality.length === 0) {
		lines.push("没有评分记录。");
	} else {
		lines.push(
			"四项分数各为 1 到 5 分；失败记录只计数，不进入均值。",
			"",
			"| 来源 | 侧 | 样本 | 有效评分 | 原创性 | 人物 | 节奏 | 对话 | 失败 |",
			"|---|---|---|---|---|---|---|---|---|",
		);
		for (const section of scoreboard.quality) {
			const labels = QUALITY_SIDE_LABELS[section.source];
			for (const group of section.summary.bySide) {
				const means = new Map(
					group.dimensions.map((dimension) => [dimension.dimension, dimension]),
				);
				lines.push(
					`| ${section.source === "pairwise" ? "偏好盲测" : "B1 回放"} | ${labels[group.side]} | ${group.samples} | ${group.scored} | ${formatDecimal(means.get("originality")?.mean ?? null, 2)} | ${formatDecimal(means.get("character")?.mean ?? null, 2)} | ${formatDecimal(means.get("pacing")?.mean ?? null, 2)} | ${formatDecimal(means.get("dialogue")?.mean ?? null, 2)} | ${group.failures} |`,
				);
			}
		}
	}
	lines.push("", "## B1 历史回放", "");
	if (scoreboard.b1 === null) {
		lines.push("没有 B1 样本。");
	} else {
		lines.push(
			"续写与历史回复按两种顺序各判一次；胜率与平局率按单次顺序判定统计。",
			"",
			"| 档位 | 样本 | 双向完成 | 顺序判定 | 续写胜率 | 历史胜率 | 平局率 | 位置偏差 | 失败 |",
			"|---|---|---|---|---|---|---|---|---|",
		);
		for (const group of scoreboard.b1.overall) {
			lines.push(renderB1Row(group));
		}
		lines.push("");
		if (scoreboard.b1.hasSameModelSamples) {
			lines.push("### 同模型子集", "");
			lines.push(
				"| 档位 | 样本 | 双向完成 | 顺序判定 | 续写胜率 | 历史胜率 | 平局率 | 位置偏差 | 失败 |",
				"|---|---|---|---|---|---|---|---|---|",
			);
			for (const group of scoreboard.b1.sameModel) {
				lines.push(renderB1Row(group));
			}
			lines.push("");
		} else {
			lines.push(
				`同模型子集为空（${scoreboard.b1SameModelSamples} 个样本的历史回复与本次写作模型同名），B1 只作参考，不作门槛。`,
				"",
			);
		}
	}
	lines.push(
		"## 门槛与下一步",
		"",
		"- 门槛规则：新方案必须赢过对应基线才算达标；没有赢过基线时，自动生成改进任务并重评，最多三轮；三轮仍未达标就把限制写进 `docs/dev/HUMAN.md`。",
		"- B1 的门槛只在同模型子集有样本时生效；同模型子集为空时 B1 只作参考。",
		`- 当前结论：${scoreboard.conclusion}`,
		`- 下一步：${scoreboard.next}`,
		"",
	);
	return lines.join("\n");
}

function renderB1Row(
	group: HistoricalReplaySummary["overall"][number],
): string {
	const historicalShare =
		group.judgements === 0 ? null : group.historicalWins / group.judgements;
	return `| ${group.profile} | ${group.samples} | ${group.completed} | ${group.judgements} | ${formatRate(group.generatedShare)} | ${formatRate(historicalShare)} | ${formatRate(group.tieShare)} | ${formatRate(group.positionBias)} | ${group.failures} |`;
}

function listOrDash(values: readonly string[]): string {
	return values.length === 0 ? "—" : values.join("、");
}

function formatRate(value: number | null): string {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatDecimal(value: number | null, digits: number): string {
	return value === null ? "—" : value.toFixed(digits);
}

function formatInteger(value: number | null): string {
	return value === null ? "—" : String(Math.round(value));
}
