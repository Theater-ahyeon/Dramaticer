/**
 * 原著抽取的预估：章、字、块、token 与费用。导入后先给玩家看，
 * 玩家确认才开始调用模型（工单 canon/02；v5 §5.3）。
 */
import { createTokenEstimator } from "../tokens.js";
import { countCanonChars } from "./split.js";
import type { CanonChunkPlan } from "./types.js";

/** 一块原文最多 2 万字；超过的章按段落边界切块。 */
export const CANON_CHUNK_MAX_CHARS = 20_000;

/** 每块预计的输出上限（事件、话术与实体增量一起）。 */
export const CANON_ESTIMATE_OUTPUT_TOKENS_PER_CHUNK = 1_200;

/** 每块调用固定附带的提示词模板与格式要求。 */
export const CANON_ESTIMATE_PROMPT_OVERHEAD_TOKENS = 400;

/** 没有配置模型单价时使用的参考费率，单位是元/百万 token。 */
export const CANON_REFERENCE_PRICING: CanonPricing = {
	currency: "CNY",
	inputPerMillion: 2,
	outputPerMillion: 8,
	reference: true,
};

export interface CanonPricing {
	readonly currency: "CNY" | "USD";
	readonly inputPerMillion: number;
	/** 输出单价；按参考费率估算时按每块输出上限计算。 */
	readonly outputPerMillion: number;
	readonly reference: boolean;
}

export interface CanonRosterEntry {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly kind: string;
}

export interface CanonEstimateChapter {
	readonly paragraphs: readonly string[];
}

export interface CanonEstimateInput {
	readonly bookId: string;
	readonly chapters: readonly CanonEstimateChapter[];
	readonly model: string | null;
	readonly roster?: readonly CanonRosterEntry[];
	readonly pricing?: CanonPricing;
}

export interface CanonExtractionEstimate {
	readonly bookId: string;
	readonly model: string | null;
	readonly chapterCount: number;
	readonly charCount: number;
	readonly chunkCount: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly totalTokens: number;
	readonly pricing: CanonPricing;
	readonly estimatedCost: number;
	readonly note: string;
}

/**
 * 按段落边界装块。单段本身就超过上限时它独占一块，
 * 段落号不能凭空切开，这一块的预算按实际字数算。
 */
export function planCanonChunks(
	paragraphs: readonly string[],
	maxChars: number = CANON_CHUNK_MAX_CHARS,
): readonly CanonChunkPlan[] {
	if (!(maxChars > 0)) throw new Error("每块字数上限必须是正数");
	const chunks: CanonChunkPlan[] = [];
	let start = 0;
	let chars = 0;
	const flush = (endExclusive: number) => {
		if (endExclusive <= start) return;
		const slice = paragraphs.slice(start, endExclusive);
		chunks.push({
			index: chunks.length,
			startParagraph: start + 1,
			endParagraph: endExclusive,
			charCount: countCanonChars(slice),
		});
		start = endExclusive;
		chars = 0;
	};
	paragraphs.forEach((paragraph, index) => {
		const paragraphChars = countCanonChars([paragraph]);
		if (index > start && chars + paragraphChars > maxChars) {
			flush(index);
		}
		chars += paragraphChars;
		if (index === start && paragraphChars > maxChars) {
			flush(index + 1);
		}
	});
	flush(paragraphs.length);
	return chunks;
}

/** 预估调用时附带的实体名册占用；没有名册时只算模板开销。 */
export function estimateCanonRosterTokens(
	roster: readonly CanonRosterEntry[],
): number {
	if (roster.length === 0) return 0;
	const estimator = createTokenEstimator();
	const text = roster
		.map((entry) => {
			const aliases =
				entry.aliases.length === 0
					? ""
					: `（别名：${entry.aliases.join("、")}）`;
			return `- ${entry.name}${aliases}；${entry.kind}`;
		})
		.join("\n");
	return estimator(text) + 2;
}

export function estimateCanonExtraction(
	input: CanonEstimateInput,
): CanonExtractionEstimate {
	const estimator = createTokenEstimator();
	const pricing = input.pricing ?? CANON_REFERENCE_PRICING;
	const rosterTokens = estimateCanonRosterTokens(input.roster ?? []);
	let charCount = 0;
	let chunkCount = 0;
	let textTokens = 0;
	for (const chapter of input.chapters) {
		charCount += countCanonChars(chapter.paragraphs);
		const chunks = planCanonChunks(chapter.paragraphs);
		chunkCount += chunks.length;
		for (const chunk of chunks) {
			const text = chapter.paragraphs
				.slice(chunk.startParagraph - 1, chunk.endParagraph)
				.join("\n");
			textTokens += estimator(text);
		}
	}
	const inputTokens =
		textTokens +
		chunkCount * (CANON_ESTIMATE_PROMPT_OVERHEAD_TOKENS + rosterTokens);
	const outputTokens = chunkCount * CANON_ESTIMATE_OUTPUT_TOKENS_PER_CHUNK;
	const estimatedCost =
		(inputTokens / 1_000_000) * pricing.inputPerMillion +
		(outputTokens / 1_000_000) * pricing.outputPerMillion;
	const parts = [
		"按每块不超过 2 万字切块，每块一次调用；输入含原文、提示词与当前实体名册。",
	];
	if (input.model === null) {
		parts.push("还没有配置后台模型，费用只能按参考费率估算。");
	} else {
		parts.push(`后台模型：${input.model}。`);
	}
	if (pricing.reference) {
		const symbol = pricing.currency === "USD" ? "$" : "¥";
		parts.push(
			`没有配置模型单价，费用按参考费率估算：输入 ${symbol}${pricing.inputPerMillion}/百万 token、输出 ${symbol}${pricing.outputPerMillion}/百万 token；实际以渠道账单为准。`,
		);
	}
	return {
		bookId: input.bookId,
		model: input.model,
		chapterCount: input.chapters.length,
		charCount,
		chunkCount,
		inputTokens,
		outputTokens,
		totalTokens: inputTokens + outputTokens,
		pricing,
		estimatedCost: Math.round(estimatedCost * 10_000) / 10_000,
		note: parts.join(""),
	};
}
