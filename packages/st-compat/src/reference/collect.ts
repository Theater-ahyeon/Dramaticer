import path from "node:path";
import type { ConversationProseStats } from "./conversations.js";
import { collectConversationProse } from "./conversations.js";
import type { CosineCalibration } from "./cosine.js";
import { listReferenceFiles, readReferenceText } from "./files.js";
import type {
	ReferenceTextStats,
	RunLengthStats,
	SentenceLengthBucket,
	SimilarityPercentiles,
} from "./text-stats.js";
import {
	analyzeReferenceText,
	runLengthStats,
	similarityPercentiles,
} from "./text-stats.js";

export type ReferenceSource = "public" | "private";

export interface ReferenceWork {
	readonly name: string;
	readonly fileName: string;
	readonly source: ReferenceSource;
	readonly stats: ReferenceTextStats;
}

export interface AggregateSentenceStats {
	readonly sentenceCount: number;
	readonly mean: number;
	readonly buckets: readonly SentenceLengthBucket[];
}

export interface ReferenceAggregate {
	readonly workCount: number;
	readonly charCount: number;
	readonly blockCount: number;
	readonly pairCount: number;
	readonly meanAdjacentSimilarity: number;
	readonly maxAdjacentSimilarity: number;
	readonly similarityPercentiles: SimilarityPercentiles;
	readonly dialogueRuns: RunLengthStats;
	readonly narrationRuns: RunLengthStats;
	readonly sentence: AggregateSentenceStats;
	readonly dialogue: {
		readonly quotedChars: number;
		readonly totalChars: number;
		readonly ratio: number;
	};
	/** 各作品的类符/形符比按字符数（或二元组数）加权平均。 */
	readonly vocabulary: {
		readonly charTypeTokenRatio: number;
		readonly bigramTypeTokenRatio: number;
	};
}

export interface ReferenceBaseline {
	readonly generatedAt: string;
	readonly publicFixture: ReferenceWork;
	readonly privateWorks: readonly ReferenceWork[];
	readonly conversations: readonly ConversationProseStats[];
	readonly cosine: CosineCalibration | null;
	readonly aggregate: ReferenceAggregate;
}

export interface CollectReferenceBaselineOptions {
	readonly publicFixturePath: string;
	readonly referenceRoot: string;
	/** 快照根目录；提供时统计旧语料对话作为对照。 */
	readonly chatRoot?: string;
	readonly cosine?: CosineCalibration;
	readonly generatedAt?: string;
}

const TEXT_FILE = /\.(txt|md)$/i;

export async function collectReferenceBaseline(
	options: CollectReferenceBaselineOptions,
): Promise<ReferenceBaseline> {
	const publicFixture = await analyzeFile(options.publicFixturePath, "public");
	const privateWorks = await collectPrivateWorks(options.referenceRoot);
	const conversations =
		options.chatRoot === undefined
			? []
			: await collectConversationProse(options.chatRoot);
	return {
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		publicFixture,
		privateWorks,
		conversations,
		cosine: options.cosine ?? null,
		aggregate: aggregateWorks([publicFixture, ...privateWorks]),
	};
}

async function analyzeFile(
	filePath: string,
	source: ReferenceSource,
): Promise<ReferenceWork> {
	return {
		name: path.parse(filePath).name,
		fileName: path.basename(filePath),
		source,
		stats: analyzeReferenceText(await readReferenceText(filePath)),
	};
}

async function collectPrivateWorks(
	referenceRoot: string,
): Promise<readonly ReferenceWork[]> {
	const files = await listReferenceFiles(referenceRoot);
	const works: ReferenceWork[] = [];
	for (const file of files) {
		works.push(await analyzeFile(file, "private"));
	}
	return works;
}

function aggregateWorks(works: readonly ReferenceWork[]): ReferenceAggregate {
	const bucketCounts = works[0].stats.sentence.buckets.map(() => 0);
	let charCount = 0;
	let blockCount = 0;
	let pairCount = 0;
	let similarityTotal = 0;
	let maxAdjacentSimilarity = 0;
	let sentenceCount = 0;
	let sentenceLengthTotal = 0;
	let quotedChars = 0;
	let dialogueChars = 0;
	let weightedCharTtr = 0;
	let weightedBigramTtr = 0;
	let bigramCount = 0;
	const similarities: number[] = [];
	const dialogueRunLengths: number[] = [];
	const narrationRunLengths: number[] = [];

	for (const work of works) {
		const stats = work.stats;
		charCount += stats.charCount;
		blockCount += stats.blockCount;
		pairCount += stats.duplication.pairs.length;
		similarityTotal +=
			stats.meanAdjacentSimilarity * stats.duplication.pairs.length;
		for (const pair of stats.duplication.pairs) {
			similarities.push(pair.similarity);
			if (pair.similarity > maxAdjacentSimilarity) {
				maxAdjacentSimilarity = pair.similarity;
			}
		}
		dialogueRunLengths.push(...stats.dialogueRuns.lengths);
		narrationRunLengths.push(...stats.narrationRuns.lengths);
		sentenceCount += stats.sentence.sentenceCount;
		sentenceLengthTotal += stats.sentence.mean * stats.sentence.sentenceCount;
		for (const [index, bucket] of stats.sentence.buckets.entries()) {
			bucketCounts[index] += bucket.count;
		}
		quotedChars += stats.dialogue.quotedChars;
		dialogueChars += stats.dialogue.totalChars;
		weightedCharTtr +=
			stats.vocabulary.charTypeTokenRatio * stats.vocabulary.charCount;
		weightedBigramTtr +=
			stats.vocabulary.bigramTypeTokenRatio * stats.vocabulary.bigramCount;
		bigramCount += stats.vocabulary.bigramCount;
	}

	return {
		workCount: works.length,
		charCount,
		blockCount,
		pairCount,
		meanAdjacentSimilarity: pairCount === 0 ? 0 : similarityTotal / pairCount,
		maxAdjacentSimilarity,
		similarityPercentiles: similarityPercentiles(similarities),
		dialogueRuns: runLengthStats(dialogueRunLengths),
		narrationRuns: runLengthStats(narrationRunLengths),
		sentence: {
			sentenceCount,
			mean: sentenceCount === 0 ? 0 : sentenceLengthTotal / sentenceCount,
			buckets: works[0].stats.sentence.buckets.map((bucket, index) => ({
				...bucket,
				count: bucketCounts[index],
				ratio: sentenceCount === 0 ? 0 : bucketCounts[index] / sentenceCount,
			})),
		},
		dialogue: {
			quotedChars,
			totalChars: dialogueChars,
			ratio: dialogueChars === 0 ? 0 : quotedChars / dialogueChars,
		},
		vocabulary: {
			charTypeTokenRatio: charCount === 0 ? 0 : weightedCharTtr / charCount,
			bigramTypeTokenRatio:
				bigramCount === 0 ? 0 : weightedBigramTtr / bigramCount,
		},
	};
}

export function renderPrivateReferenceReport(
	baseline: ReferenceBaseline,
): string {
	const lines: string[] = [];
	lines.push("# 参照文本统计（私有版）", "");
	lines.push(`生成时间：${baseline.generatedAt}`);
	lines.push(
		`数据源：公有领域 fixture 1 部；eval-private/reference 目录 ${baseline.privateWorks.length} 部。`,
	);
	lines.push("");
	lines.push("## 公有领域 fixture");
	lines.push("");
	renderWorkDetails(lines, baseline.publicFixture, true);
	lines.push("## 私有参照文本");
	lines.push("");
	if (baseline.privateWorks.length === 0) {
		lines.push(
			"`eval-private/reference/` 为空或不存在；私有参照基线尚未建立（等 HUMAN-07）。",
		);
		lines.push("");
	} else {
		for (const work of baseline.privateWorks) {
			renderWorkDetails(lines, work, true);
		}
	}
	renderCosineSection(lines, baseline, true);
	renderConversationComparison(lines, baseline.conversations);
	renderAggregate(lines, baseline, true);
	return `${lines.join("\n")}\n`;
}

export function renderPublicReferenceReport(
	baseline: ReferenceBaseline,
): string {
	const works = [baseline.publicFixture, ...baseline.privateWorks];
	const lines: string[] = [];
	lines.push("# 参照文本统计（统计版）", "");
	lines.push(`生成时间：${baseline.generatedAt}`);
	lines.push(
		`数据源：${works.length} 部（公有领域 fixture 1 部，私有参照文本 ${baseline.privateWorks.length} 部）。统计版不列版权作品名称、文件名与原文。`,
	);
	lines.push("");
	lines.push("## 各作品分布");
	lines.push("");
	for (const [index, work] of works.entries()) {
		renderWorkDetails(lines, work, index === 0, `作品 ${index + 1}`);
	}
	renderCosineSection(lines, baseline, false);
	renderConversationComparison(lines, baseline.conversations);
	renderAggregate(lines, baseline, false);
	return `${lines.join("\n")}\n`;
}

function renderWorkDetails(
	lines: string[],
	work: ReferenceWork,
	showFile: boolean,
	title = work.name,
): void {
	const stats = work.stats;
	const duplication = stats.duplication;
	lines.push(`### ${title.replaceAll("\n", " ")}`);
	lines.push("");
	lines.push(`- 来源：${work.source === "public" ? "公有领域" : "私有"}`);
	if (showFile) {
		lines.push(`- 文件：${work.fileName}`);
	}
	lines.push(`- 字符数（去掉空白、标点与符号）：${stats.charCount}`);
	lines.push(`- 文本块：${stats.blockCount}`);
	lines.push(
		`- 相邻块重复度：${duplication.pairs.length} 对，平均 ${decimal(stats.meanAdjacentSimilarity)}，峰值 ${decimal(maxSimilarity(stats))}`,
	);
	lines.push(
		`- 相邻相似度分位：P50 ${decimal(stats.similarityPercentiles.p50)}，P90 ${decimal(stats.similarityPercentiles.p90)}，P95 ${decimal(stats.similarityPercentiles.p95)}，P99 ${decimal(stats.similarityPercentiles.p99)}`,
	);
	lines.push(
		`- 连续含对白块：${stats.dialogueRuns.runCount} 段，中位数 ${number(stats.dialogueRuns.median, 2)}，P90 ${number(stats.dialogueRuns.p90, 2)}，最长 ${stats.dialogueRuns.max}`,
	);
	lines.push(
		`- 连续无对白块：${stats.narrationRuns.runCount} 段，中位数 ${number(stats.narrationRuns.median, 2)}，P90 ${number(stats.narrationRuns.p90, 2)}，最长 ${stats.narrationRuns.max}`,
	);
	lines.push(
		`- 持续上升起点：${duplication.riseStartFloor === null ? "无" : `第 ${duplication.riseStartFloor} 块`}`,
	);
	if (duplication.peakWindow) {
		lines.push(
			`- 峰值窗口：第 ${duplication.peakWindow.startFloor}–${duplication.peakWindow.endFloor} 块，均值 ${decimal(duplication.peakWindow.meanSimilarity)}`,
		);
	}
	lines.push(
		`- 句子：${stats.sentence.sentenceCount} 句，平均 ${number(stats.sentence.mean, 2)} 字，中位数 ${number(stats.sentence.median, 2)}，P90 ${number(stats.sentence.p90, 2)}`,
	);
	lines.push(
		`- 对话占比：${stats.dialogue.spanCount} 个引号段，引号内 ${stats.dialogue.quotedChars} / 全文 ${stats.dialogue.totalChars} 字符，${percent(stats.dialogue.ratio)}`,
	);
	lines.push(
		`- 词汇丰富度：字符 TTR ${decimal(stats.vocabulary.charTypeTokenRatio)}（${stats.vocabulary.uniqueChars}/${stats.vocabulary.charCount}），二元组 TTR ${decimal(stats.vocabulary.bigramTypeTokenRatio)}（${stats.vocabulary.uniqueBigrams}/${stats.vocabulary.bigramCount}）`,
	);
	lines.push("");
	lines.push("句长分布：");
	lines.push("");
	lines.push("| 句长（字） | 句数 | 占比 |");
	lines.push("|---|---|---|");
	for (const bucket of stats.sentence.buckets) {
		lines.push(
			`| ${bucket.label} | ${bucket.count} | ${percent(bucket.ratio)} |`,
		);
	}
	lines.push("");
}

function renderCosineSection(
	lines: string[],
	baseline: ReferenceBaseline,
	showNames: boolean,
): void {
	lines.push("## 参照 embedding 余弦");
	lines.push("");
	const cosine = baseline.cosine;
	if (cosine === null) {
		lines.push("未运行 embedding 余弦校准。");
		lines.push("");
		return;
	}
	lines.push(`模型：${cosine.modelLabel}`);
	lines.push(
		`取样：每个作品 ${cosine.pairsPerWork} 对相邻块，共 ${cosine.pairCount} 对、${cosine.blockCount} 段文本，其中重复文本 ${cosine.duplicatePairCount} 对。`,
	);
	lines.push(
		`相邻块余弦：平均 ${decimal(cosine.meanCosine)}，P50 ${decimal(cosine.percentiles.p50)}，P90 ${decimal(cosine.percentiles.p90)}，P95 ${decimal(cosine.percentiles.p95)}，P99 ${decimal(cosine.percentiles.p99)}`,
	);
	lines.push("");
	lines.push("| 作品 | 相邻对 | 余弦均值 | P95 余弦 |");
	lines.push("|---|---|---|---|");
	for (const [index, work] of cosine.works.entries()) {
		const label = showNames ? work.name : `作品 ${index + 2}`;
		lines.push(
			`| ${label.replaceAll("|", "\\|")} | ${work.pairCount} | ${decimal(work.meanCosine)} | ${decimal(work.p95Cosine)} |`,
		);
	}
	lines.push("");
}

function renderConversationComparison(
	lines: string[],
	conversations: readonly ConversationProseStats[],
): void {
	lines.push("## 评测对话对照");
	lines.push("");
	if (conversations.length === 0) {
		lines.push("没有提供快照目录，未统计评测对话。");
		lines.push("");
		return;
	}
	lines.push(
		"对话按固定顺序编号。重复度按相邻助手回复计算，句长、对话占比与词汇丰富度按全部助手回复计算。对话是互动文本，这组数字只用于说明与参照小说的差距，Director 阈值不从对话语料推导。",
	);
	lines.push("");
	lines.push(
		"| 对话 | 助手回复 | 相邻对 | 重复度均值 | P95 | 句长均值 | 对话占比 | 字符 TTR | 二元组 TTR |",
	);
	lines.push("|---|---|---|---|---|---|---|---|---|");
	let replyCount = 0;
	let pairCount = 0;
	let similarityTotal = 0;
	let sentenceCount = 0;
	let sentenceLengthTotal = 0;
	let quotedChars = 0;
	let totalChars = 0;
	let weightedCharTtr = 0;
	let charCount = 0;
	let weightedBigramTtr = 0;
	let bigramCount = 0;
	const similarities: number[] = [];
	for (const conversation of conversations) {
		const pairTotal = conversation.duplication.pairs.length;
		replyCount += conversation.replyCount;
		pairCount += pairTotal;
		similarityTotal += conversation.meanAdjacentSimilarity * pairTotal;
		for (const pair of conversation.duplication.pairs) {
			similarities.push(pair.similarity);
		}
		sentenceCount += conversation.sentence.sentenceCount;
		sentenceLengthTotal +=
			conversation.sentence.mean * conversation.sentence.sentenceCount;
		quotedChars += conversation.dialogue.quotedChars;
		totalChars += conversation.dialogue.totalChars;
		weightedCharTtr +=
			conversation.vocabulary.charTypeTokenRatio *
			conversation.vocabulary.charCount;
		charCount += conversation.vocabulary.charCount;
		weightedBigramTtr +=
			conversation.vocabulary.bigramTypeTokenRatio *
			conversation.vocabulary.bigramCount;
		bigramCount += conversation.vocabulary.bigramCount;
		lines.push(
			`| ${conversation.label} | ${conversation.replyCount} | ${pairTotal} | ${decimal(conversation.meanAdjacentSimilarity)} | ${decimal(conversation.similarityPercentiles.p95)} | ${number(conversation.sentence.mean, 2)} | ${percent(conversation.dialogue.ratio)} | ${decimal(conversation.vocabulary.charTypeTokenRatio)} | ${decimal(conversation.vocabulary.bigramTypeTokenRatio)} |`,
		);
	}
	const aggregatePercentiles = similarityPercentiles(similarities);
	lines.push(
		`| 合计 | ${replyCount} | ${pairCount} | ${decimal(pairCount === 0 ? 0 : similarityTotal / pairCount)} | ${decimal(aggregatePercentiles.p95)} | ${number(sentenceCount === 0 ? 0 : sentenceLengthTotal / sentenceCount, 2)} | ${percent(totalChars === 0 ? 0 : quotedChars / totalChars)} | ${decimal(charCount === 0 ? 0 : weightedCharTtr / charCount)} | ${decimal(bigramCount === 0 ? 0 : weightedBigramTtr / bigramCount)} |`,
	);
	lines.push("");
}

function renderAggregate(
	lines: string[],
	baseline: ReferenceBaseline,
	showNames: boolean,
): void {
	const aggregate = baseline.aggregate;
	const works = [baseline.publicFixture, ...baseline.privateWorks];
	lines.push("## 汇总");
	lines.push("");
	lines.push(
		`作品 ${aggregate.workCount} 部，字符 ${aggregate.charCount}，文本块 ${aggregate.blockCount}，相邻块 ${aggregate.pairCount} 对。`,
	);
	lines.push("");
	lines.push(
		`- 相邻块重复度：平均 ${decimal(aggregate.meanAdjacentSimilarity)}，峰值 ${decimal(aggregate.maxAdjacentSimilarity)}`,
	);
	lines.push(
		`- 相邻相似度分位：P50 ${decimal(aggregate.similarityPercentiles.p50)}，P90 ${decimal(aggregate.similarityPercentiles.p90)}，P95 ${decimal(aggregate.similarityPercentiles.p95)}，P99 ${decimal(aggregate.similarityPercentiles.p99)}`,
	);
	lines.push(
		`- 连续含对白块：${aggregate.dialogueRuns.runCount} 段，中位数 ${number(aggregate.dialogueRuns.median, 2)}，P90 ${number(aggregate.dialogueRuns.p90, 2)}，最长 ${aggregate.dialogueRuns.max}`,
	);
	lines.push(
		`- 连续无对白块：${aggregate.narrationRuns.runCount} 段，中位数 ${number(aggregate.narrationRuns.median, 2)}，P90 ${number(aggregate.narrationRuns.p90, 2)}，最长 ${aggregate.narrationRuns.max}`,
	);
	lines.push(
		`- 句子：${aggregate.sentence.sentenceCount} 句，平均 ${number(aggregate.sentence.mean, 2)} 字`,
	);
	lines.push(
		`- 对话占比：引号内 ${aggregate.dialogue.quotedChars} / 全文 ${aggregate.dialogue.totalChars} 字符，${percent(aggregate.dialogue.ratio)}`,
	);
	lines.push(
		`- 词汇丰富度（按作品加权平均）：字符 TTR ${decimal(aggregate.vocabulary.charTypeTokenRatio)}，二元组 TTR ${decimal(aggregate.vocabulary.bigramTypeTokenRatio)}`,
	);
	lines.push("");
	lines.push(
		"| 作品 | 来源 | 字符数 | 文本块 | 相邻重复度均值 | 句长均值 | 对话占比 | 字符 TTR | 二元组 TTR |",
	);
	lines.push("|---|---|---|---|---|---|---|---|---|");
	for (const [index, work] of works.entries()) {
		const stats = work.stats;
		const label = showNames ? work.name : `作品 ${index + 1}`;
		lines.push(
			`| ${label.replaceAll("|", "\\|")} | ${work.source === "public" ? "公有领域" : "私有"} | ${stats.charCount} | ${stats.blockCount} | ${decimal(stats.meanAdjacentSimilarity)} | ${number(stats.sentence.mean, 2)} | ${percent(stats.dialogue.ratio)} | ${decimal(stats.vocabulary.charTypeTokenRatio)} | ${decimal(stats.vocabulary.bigramTypeTokenRatio)} |`,
		);
	}
	lines.push("");
	lines.push("汇总句长分布：");
	lines.push("");
	lines.push("| 句长（字） | 句数 | 占比 |");
	lines.push("|---|---|---|");
	for (const bucket of aggregate.sentence.buckets) {
		lines.push(
			`| ${bucket.label} | ${bucket.count} | ${percent(bucket.ratio)} |`,
		);
	}
	lines.push("");
}

function maxSimilarity(stats: ReferenceTextStats): number {
	let peak = 0;
	for (const pair of stats.duplication.pairs) {
		if (pair.similarity > peak) peak = pair.similarity;
	}
	return peak;
}

function percent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function decimal(value: number): string {
	return value.toFixed(4);
}

function number(value: number, digits: number): string {
	return value.toFixed(digits);
}
