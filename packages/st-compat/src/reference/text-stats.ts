import type {
	DuplicationCurve,
	DuplicationOptions,
	ReplyText,
} from "../health/duplication.js";
import { analyzeDuplication } from "../health/duplication.js";

export interface SentenceLengthBucket {
	readonly label: string;
	readonly min: number;
	readonly max: number | null;
	readonly count: number;
	readonly ratio: number;
}

export interface SentenceLengthStats {
	readonly sentenceCount: number;
	readonly mean: number;
	readonly median: number;
	readonly p90: number;
	readonly buckets: readonly SentenceLengthBucket[];
}

export interface DialogueStats {
	readonly spanCount: number;
	/** 引号内的字符数，去掉空白、标点与符号。 */
	readonly quotedChars: number;
	/** 全文的字符数，去掉空白、标点与符号。 */
	readonly totalChars: number;
	readonly ratio: number;
}

export interface VocabularyStats {
	readonly charCount: number;
	readonly uniqueChars: number;
	readonly charTypeTokenRatio: number;
	readonly bigramCount: number;
	readonly uniqueBigrams: number;
	readonly bigramTypeTokenRatio: number;
}

export interface SimilarityPercentiles {
	readonly p50: number;
	readonly p90: number;
	readonly p95: number;
	readonly p99: number;
}

/**
 * 连续文本段的长度统计。
 *
 * 对白段是连续含引号对白的文本块；叙述段是连续不含引号对白的文本块。
 * `lengths` 保留原始长度，汇总报告按全部作品合并后再算分位。
 */
export interface RunLengthStats {
	readonly runCount: number;
	readonly median: number;
	readonly p90: number;
	readonly max: number;
	readonly lengths: readonly number[];
}

export interface ReferenceTextStats {
	/** 去掉空白、标点与符号之后的字符数。 */
	readonly charCount: number;
	readonly blockCount: number;
	readonly sentence: SentenceLengthStats;
	readonly dialogue: DialogueStats;
	readonly vocabulary: VocabularyStats;
	readonly duplication: DuplicationCurve;
	/** 全部相邻块相似度的均值；没有相邻块时为 0。 */
	readonly meanAdjacentSimilarity: number;
	/** 相邻块相似度的分位；没有相邻块时全为 0。 */
	readonly similarityPercentiles: SimilarityPercentiles;
	readonly dialogueRuns: RunLengthStats;
	readonly narrationRuns: RunLengthStats;
}

export interface AnalyzeReferenceTextOptions {
	readonly duplication?: DuplicationOptions;
}

const BUCKETS: readonly {
	readonly label: string;
	readonly min: number;
	readonly max: number | null;
}[] = [
	{ label: "1–10", min: 1, max: 10 },
	{ label: "11–20", min: 11, max: 20 },
	{ label: "21–40", min: 21, max: 40 },
	{ label: "41–80", min: 41, max: 80 },
	{ label: "81+", min: 81, max: null },
];

const SENTENCE_BOUNDARY = /[。！？!?；;…．]+[”’」』"']*|\n+/u;
const DIALOGUE_SPAN = /“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu;
const NON_CONTENT = /[\s\p{P}\p{S}]/u;

/** 每行一个段落；空行忽略。 */
export function splitTextBlocks(text: string): string[] {
	return text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

export function splitSentences(text: string): string[] {
	return text
		.replace(/\r\n?/g, "\n")
		.split(SENTENCE_BOUNDARY)
		.map((part) => part.trim())
		.filter((part) => contentChars(part).length > 0);
}

function contentChars(text: string): string[] {
	return Array.from(text).filter((char) => !NON_CONTENT.test(char));
}

function sentenceLengthStats(lengths: readonly number[]): SentenceLengthStats {
	const sentenceCount = lengths.length;
	if (sentenceCount === 0) {
		return {
			sentenceCount: 0,
			mean: 0,
			median: 0,
			p90: 0,
			buckets: BUCKETS.map((bucket) => ({ ...bucket, count: 0, ratio: 0 })),
		};
	}
	const sorted = [...lengths].sort((left, right) => left - right);
	const total = lengths.reduce((sum, length) => sum + length, 0);
	const middle = Math.floor(sentenceCount / 2);
	const median =
		sentenceCount % 2 === 1
			? sorted[middle]
			: (sorted[middle - 1] + sorted[middle]) / 2;
	const p90Index = Math.min(
		sentenceCount - 1,
		Math.ceil(sentenceCount * 0.9) - 1,
	);
	const counts = BUCKETS.map(() => 0);
	for (const length of lengths) {
		const index = BUCKETS.findIndex(
			(bucket) =>
				length >= bucket.min && (bucket.max === null || length <= bucket.max),
		);
		if (index >= 0) counts[index] += 1;
	}
	return {
		sentenceCount,
		mean: total / sentenceCount,
		median,
		p90: sorted[p90Index],
		buckets: BUCKETS.map((bucket, index) => ({
			...bucket,
			count: counts[index],
			ratio: counts[index] / sentenceCount,
		})),
	};
}

/** 输入必须已经升序排列；分位取最近秩。 */
function percentileOfSorted(
	sorted: readonly number[],
	quantile: number,
): number {
	if (sorted.length === 0) return 0;
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(sorted.length * quantile) - 1),
	);
	return sorted[index];
}

function medianOfSorted(sorted: readonly number[]): number {
	if (sorted.length === 0) return 0;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

export function similarityPercentiles(
	similarities: readonly number[],
): SimilarityPercentiles {
	const sorted = [...similarities].sort((left, right) => left - right);
	return {
		p50: percentileOfSorted(sorted, 0.5),
		p90: percentileOfSorted(sorted, 0.9),
		p95: percentileOfSorted(sorted, 0.95),
		p99: percentileOfSorted(sorted, 0.99),
	};
}

export function runLengthStats(lengths: readonly number[]): RunLengthStats {
	const sorted = [...lengths].sort((left, right) => left - right);
	return {
		runCount: sorted.length,
		median: medianOfSorted(sorted),
		p90: percentileOfSorted(sorted, 0.9),
		max: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
		lengths: [...sorted],
	};
}

function splitRunLengths(blocks: readonly string[]): {
	dialogue: RunLengthStats;
	narration: RunLengthStats;
} {
	const dialogue: number[] = [];
	const narration: number[] = [];
	let currentKind: boolean | null = null;
	let currentLength = 0;
	for (const block of blocks) {
		const kind = block.match(DIALOGUE_SPAN) !== null;
		if (kind === currentKind) {
			currentLength += 1;
			continue;
		}
		if (currentKind !== null) {
			(currentKind ? dialogue : narration).push(currentLength);
		}
		currentKind = kind;
		currentLength = 1;
	}
	if (currentKind !== null) {
		(currentKind ? dialogue : narration).push(currentLength);
	}
	return {
		dialogue: runLengthStats(dialogue),
		narration: runLengthStats(narration),
	};
}

function dialogueStats(text: string, totalChars: number): DialogueStats {
	let spanCount = 0;
	let quotedChars = 0;
	for (const match of text.matchAll(DIALOGUE_SPAN)) {
		spanCount += 1;
		quotedChars += contentChars(match[0].slice(1, -1)).length;
	}
	return {
		spanCount,
		quotedChars,
		totalChars,
		ratio: totalChars === 0 ? 0 : quotedChars / totalChars,
	};
}

function vocabularyStats(chars: readonly string[]): VocabularyStats {
	const uniqueChars = new Set(chars).size;
	const bigrams = new Set<string>();
	for (let index = 0; index + 1 < chars.length; index += 1) {
		bigrams.add(`${chars[index]}${chars[index + 1]}`);
	}
	const charCount = chars.length;
	const bigramCount = Math.max(0, charCount - 1);
	return {
		charCount,
		uniqueChars,
		charTypeTokenRatio: charCount === 0 ? 0 : uniqueChars / charCount,
		bigramCount,
		uniqueBigrams: bigrams.size,
		bigramTypeTokenRatio: bigramCount === 0 ? 0 : bigrams.size / bigramCount,
	};
}

export function analyzeReferenceText(
	text: string,
	options: AnalyzeReferenceTextOptions = {},
): ReferenceTextStats {
	const chars = contentChars(text);
	const blocks = splitTextBlocks(text);
	const replies: ReplyText[] = blocks.map((block, index) => ({
		floor: index + 1,
		text: block,
	}));
	const duplication = analyzeDuplication(replies, options.duplication);
	const pairCount = duplication.pairs.length;
	const similarityTotal = duplication.pairs.reduce(
		(sum, pair) => sum + pair.similarity,
		0,
	);
	const sentences = splitSentences(text);
	const runs = splitRunLengths(blocks);
	return {
		charCount: chars.length,
		blockCount: blocks.length,
		sentence: sentenceLengthStats(
			sentences.map((sentence) => contentChars(sentence).length),
		),
		dialogue: dialogueStats(text, chars.length),
		vocabulary: vocabularyStats(chars),
		duplication,
		meanAdjacentSimilarity: pairCount === 0 ? 0 : similarityTotal / pairCount,
		similarityPercentiles: similarityPercentiles(
			duplication.pairs.map((pair) => pair.similarity),
		),
		dialogueRuns: runs.dialogue,
		narrationRuns: runs.narration,
	};
}
