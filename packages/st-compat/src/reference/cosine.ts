import path from "node:path";
import type { EmbeddingClient } from "@dramaticer/core";
import { isJsonObject } from "@dramaticer/core";
import { listReferenceFiles, readReferenceText } from "./files.js";
import type { SimilarityPercentiles } from "./text-stats.js";
import { similarityPercentiles, splitTextBlocks } from "./text-stats.js";

export interface CosineWorkStats {
	readonly name: string;
	readonly pairCount: number;
	readonly meanCosine: number;
	readonly p95Cosine: number;
}

/**
 * 参照文本相邻块的 embedding 余弦分布。
 *
 * 每个作品按固定步长取样，同一段文本只嵌入一次；分位数用于给 Director
 * 的重复检测提供阈值来源。
 */
export interface CosineCalibration {
	readonly modelLabel: string;
	readonly pairsPerWork: number;
	readonly blockCount: number;
	readonly pairCount: number;
	readonly duplicatePairCount: number;
	readonly meanCosine: number;
	readonly percentiles: SimilarityPercentiles;
	readonly works: readonly CosineWorkStats[];
}

export interface CalibrateCosineOptions {
	readonly referenceRoot: string;
	readonly embedder: EmbeddingClient;
	readonly modelLabel: string;
	/** 每个作品取样的相邻块对数，默认 100。 */
	readonly pairsPerWork?: number;
}

const DEFAULT_PAIRS_PER_WORK = 100;

export async function calibrateReferenceCosine(
	options: CalibrateCosineOptions,
): Promise<CosineCalibration> {
	const pairsPerWork = options.pairsPerWork ?? DEFAULT_PAIRS_PER_WORK;
	if (!Number.isInteger(pairsPerWork) || pairsPerWork <= 0) {
		throw new Error(`pairsPerWork 必须是正整数：${pairsPerWork}`);
	}
	const files = await listReferenceFiles(options.referenceRoot);
	const sampled: {
		readonly name: string;
		readonly pairs: readonly (readonly [string, string])[];
	}[] = [];
	for (const file of files) {
		const blocks = splitTextBlocks(await readReferenceText(file));
		if (blocks.length < 2) continue;
		const pairs: (readonly [string, string])[] = [];
		const step = (blocks.length - 1) / pairsPerWork;
		const starts = new Set<number>();
		for (let index = 0; index < pairsPerWork; index += 1) {
			const start = Math.min(blocks.length - 2, Math.floor(index * step));
			if (starts.has(start)) continue;
			starts.add(start);
			pairs.push([blocks[start], blocks[start + 1]]);
		}
		sampled.push({ name: path.parse(file).name, pairs });
	}

	const texts: string[] = [];
	const textIndex = new Map<string, number>();
	for (const work of sampled) {
		for (const [left, right] of work.pairs) {
			for (const text of [left, right]) {
				if (textIndex.has(text)) continue;
				textIndex.set(text, texts.length);
				texts.push(text);
			}
		}
	}
	if (texts.length === 0) {
		return {
			modelLabel: options.modelLabel,
			pairsPerWork,
			blockCount: 0,
			pairCount: 0,
			duplicatePairCount: 0,
			meanCosine: 0,
			percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 },
			works: [],
		};
	}
	const vectors = await options.embedder.embed(texts);
	if (vectors.length !== texts.length) {
		throw new Error(
			`embedding 返回 ${vectors.length} 条向量，期望 ${texts.length} 条`,
		);
	}
	const vectorOf = (text: string): number[] => {
		const index = textIndex.get(text);
		if (index === undefined) {
			throw new Error("取样文本缺少向量");
		}
		return vectors[index];
	};

	const works: CosineWorkStats[] = [];
	const similarities: number[] = [];
	let duplicatePairCount = 0;
	for (const work of sampled) {
		const workSimilarities = work.pairs.map(([left, right]) => {
			if (left === right) duplicatePairCount += 1;
			return cosine(vectorOf(left), vectorOf(right));
		});
		similarities.push(...workSimilarities);
		const workPercentiles = similarityPercentiles(workSimilarities);
		works.push({
			name: work.name,
			pairCount: work.pairs.length,
			meanCosine: mean(workSimilarities),
			p95Cosine: workPercentiles.p95,
		});
	}
	return {
		modelLabel: options.modelLabel,
		pairsPerWork,
		blockCount: texts.length,
		pairCount: similarities.length,
		duplicatePairCount,
		meanCosine: mean(similarities),
		percentiles: similarityPercentiles(similarities),
		works,
	};
}

function cosine(left: readonly number[], right: readonly number[]): number {
	if (left.length !== right.length) {
		throw new Error(`向量维度不一致：${left.length} 与 ${right.length}`);
	}
	let dot = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	for (let index = 0; index < left.length; index += 1) {
		const leftValue = left[index];
		const rightValue = right[index];
		dot += leftValue * rightValue;
		leftNorm += leftValue * leftValue;
		rightNorm += rightValue * rightValue;
	}
	if (leftNorm === 0 || rightNorm === 0) {
		throw new Error("embedding 向量长度为 0");
	}
	return dot / Math.sqrt(leftNorm * rightNorm);
}

function mean(values: readonly number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function parseCosineCalibration(value: unknown): CosineCalibration {
	if (!isJsonObject(value)) {
		throw new Error("余弦校准必须是对象");
	}
	const percentiles = value.percentiles;
	if (!isJsonObject(percentiles)) {
		throw new Error("余弦校准缺少 percentiles");
	}
	const works = value.works;
	if (!Array.isArray(works)) {
		throw new Error("余弦校准缺少 works");
	}
	const numberField = (
		source: Record<string, unknown>,
		field: string,
	): number => {
		const fieldValue = source[field];
		if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
			throw new Error(`余弦校准的 ${field} 必须是数字`);
		}
		return fieldValue;
	};
	const countField = (
		source: Record<string, unknown>,
		field: string,
	): number => {
		const fieldValue = numberField(source, field);
		if (!Number.isInteger(fieldValue) || fieldValue < 0) {
			throw new Error(`余弦校准的 ${field} 必须是非负整数`);
		}
		return fieldValue;
	};
	const modelLabel = value.modelLabel;
	if (typeof modelLabel !== "string" || modelLabel.length === 0) {
		throw new Error("余弦校准的 modelLabel 必须是非空字符串");
	}
	return {
		modelLabel,
		pairsPerWork: countField(value, "pairsPerWork"),
		blockCount: countField(value, "blockCount"),
		pairCount: countField(value, "pairCount"),
		duplicatePairCount: countField(value, "duplicatePairCount"),
		meanCosine: numberField(value, "meanCosine"),
		percentiles: {
			p50: numberField(percentiles, "p50"),
			p90: numberField(percentiles, "p90"),
			p95: numberField(percentiles, "p95"),
			p99: numberField(percentiles, "p99"),
		},
		works: works.map((work, index) => {
			if (!isJsonObject(work)) {
				throw new Error(`余弦校准的 works[${index}] 必须是对象`);
			}
			const name = work.name;
			if (typeof name !== "string" || name.length === 0) {
				throw new Error(`余弦校准的 works[${index}].name 必须是非空字符串`);
			}
			return {
				name,
				pairCount: countField(work, "pairCount"),
				meanCosine: numberField(work, "meanCosine"),
				p95Cosine: numberField(work, "p95Cosine"),
			};
		}),
	};
}
