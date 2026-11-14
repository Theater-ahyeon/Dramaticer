import { analyzeReferenceText } from "../reference/text-stats.js";

/** 内容字符的 n-gram 长度；R6 与 X2 共用。 */
export const CONTENT_GRAM_SIZE = 4;
export const CONTENT_CHAR = /[^\s\p{P}\p{S}]/u;

export interface SimilaritySummary {
	readonly count: number;
	readonly mean: number;
	readonly median: number;
	readonly p90: number;
	readonly p95: number;
	readonly p99: number;
	readonly max: number;
}

/** 内容字符的字符 4-gram；标点、空白与符号不参与。 */
export function contentGrams(text: string): Set<string> {
	const chars = Array.from(text).filter((char) => CONTENT_CHAR.test(char));
	const grams = new Set<string>();
	for (let index = 0; index + CONTENT_GRAM_SIZE <= chars.length; index += 1) {
		grams.add(chars.slice(index, index + CONTENT_GRAM_SIZE).join(""));
	}
	return grams;
}

/** 两个字符 4-gram 集合的 Jaccard；任一侧为空时返回 null。 */
export function contentGramJaccard(
	left: ReadonlySet<string>,
	right: ReadonlySet<string>,
): number | null {
	if (left.size === 0 || right.size === 0) return null;
	let intersection = 0;
	for (const gram of left) {
		if (right.has(gram)) intersection += 1;
	}
	return intersection / (left.size + right.size - intersection);
}

/** 本条回复的新字符 4-gram 占比；没有内容字符时为 null。 */
export function novelRatio(
	seen: ReadonlySet<string>,
	text: string,
): number | null {
	const grams = contentGrams(text);
	if (grams.size === 0) return null;
	let novel = 0;
	for (const gram of grams) {
		if (!seen.has(gram)) novel += 1;
	}
	return novel / grams.size;
}

export function rememberGrams(seen: Set<string>, text: string): void {
	for (const gram of contentGrams(text)) seen.add(gram);
}

export interface ReplyRepetitionMeasurement {
	/** 相邻回复对里参与 Jaccard 的对数；空集对跳过。 */
	readonly pairCount: number;
	readonly values: readonly number[];
	readonly summary: SimilaritySummary;
}

/** 相邻生成助手回复的字符 4-gram Jaccard 均值；集合为空的对跳过。 */
export function measureReplyRepetition(
	replies: readonly string[],
): ReplyRepetitionMeasurement {
	const values: number[] = [];
	let previous: Set<string> | null = null;
	for (const reply of replies) {
		const grams = contentGrams(reply);
		if (previous !== null) {
			const similarity = contentGramJaccard(previous, grams);
			if (similarity !== null) values.push(similarity);
		}
		previous = grams;
	}
	return { pairCount: values.length, values, summary: summarize(values) };
}

export interface ProgressionMeasurement {
	readonly samples: number;
	readonly values: readonly number[];
	readonly mean: number | null;
}

/** 第 2 条回复起，新字符 4-gram 占比的均值；没有样本时为 null。 */
export function measureProgression(
	replies: readonly string[],
): ProgressionMeasurement {
	const seen = new Set<string>();
	const values: number[] = [];
	for (let index = 0; index < replies.length; index += 1) {
		const reply = replies[index] as string;
		if (index > 0) {
			const ratio = novelRatio(seen, reply);
			if (ratio !== null) values.push(ratio);
		}
		rememberGrams(seen, reply);
	}
	return {
		samples: values.length,
		values,
		mean:
			values.length === 0
				? null
				: values.reduce((total, value) => total + value, 0) / values.length,
	};
}

export interface RepetitionMeasurement {
	readonly blockCount: number;
	readonly values: readonly number[];
	readonly summary: SimilaritySummary;
}

/**
 * 按参照文本的相邻块口径统计生成正文的重复度。
 * X2 与记分牌沿用这个口径；R6 的相邻回复口径用 `measureReplyRepetition`。
 */
export function measureBlockRepetition(
	replies: readonly string[],
): RepetitionMeasurement {
	const blocks = replies
		.map((reply) => reply.trim())
		.filter((reply) => reply.length > 0);
	if (blocks.length < 2) {
		return { blockCount: blocks.length, values: [], summary: emptySummary() };
	}
	const analysis = analyzeReferenceText(blocks.join("\n\n"));
	const values = analysis.duplication.pairs.map((pair) => pair.similarity);
	return {
		blockCount: analysis.blockCount,
		values,
		summary: summarize(values),
	};
}

export function summarize(values: readonly number[]): SimilaritySummary {
	if (values.length === 0) return emptySummary();
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

function emptySummary(): SimilaritySummary {
	return {
		count: 0,
		mean: 0,
		median: 0,
		p90: 0,
		p95: 0,
		p99: 0,
		max: 0,
	};
}

function nearestRank(sorted: readonly number[], quantile: number): number {
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(sorted.length * quantile) - 1),
	);
	return sorted[index] as number;
}
