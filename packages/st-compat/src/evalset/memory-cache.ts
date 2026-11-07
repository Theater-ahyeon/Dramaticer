import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EmbeddingClient } from "@dramaticer/core";

export interface CachedEmbeddingProgress {
	/** 本次调用已经完成的文本数 */
	readonly done: number;
	readonly total: number;
	readonly cached: number;
}

export interface CachedEmbeddingClientOptions {
	readonly inner: EmbeddingClient;
	readonly cacheDir: string;
	/** 缓存键的一部分，通常是模型名；不同模型不能共用缓存 */
	readonly label: string;
	/** 每处理这么多文本就落一次缓存，崩溃或中止后可以接着跑 */
	readonly chunkSize?: number;
	readonly onProgress?: (progress: CachedEmbeddingProgress) => void;
}

interface CacheEntry {
	readonly version: 1;
	readonly dimensions: number;
	readonly vector: readonly number[];
}

const DEFAULT_CHUNK_SIZE = 256;

/**
 * 按文本内容缓存 embedding 结果。缓存目录里一条文本一个文件，
 * 重复运行时只对缺失的文本调用渠道。
 */
export function createCachedEmbeddingClient(
	options: CachedEmbeddingClientOptions,
): EmbeddingClient {
	const { inner, cacheDir, label } = options;
	const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
	if (chunkSize < 1) {
		throw new Error("embedding 缓存分块必须是不小于 1 的整数");
	}
	if (label.trim().length === 0) {
		throw new Error("embedding 缓存标签不能为空");
	}
	return {
		dimensions: inner.dimensions,
		async embed(texts, callOptions) {
			if (!Array.isArray(texts)) {
				throw new Error("embedding 输入必须是字符串数组");
			}
			if (texts.length === 0) return [];
			const results = new Array<number[] | undefined>(texts.length);
			let done = 0;
			let cachedCount = 0;
			for (let start = 0; start < texts.length; start += chunkSize) {
				const slice = texts.slice(start, start + chunkSize);
				const paths = slice.map((text) => cachePath(cacheDir, label, text));
				const missing: { index: number; text: string }[] = [];
				for (let offset = 0; offset < slice.length; offset += 1) {
					const text = slice[offset] as string;
					const cached = await readCacheEntry(
						paths[offset] as string,
						inner.dimensions,
					);
					if (cached === null) {
						missing.push({ index: start + offset, text });
					} else {
						results[start + offset] = cached;
						cachedCount += 1;
					}
				}
				if (missing.length > 0) {
					const vectors = await inner.embed(
						missing.map((entry) => entry.text),
						callOptions,
					);
					if (vectors.length !== missing.length) {
						throw new Error(
							`embedding 客户端返回 ${vectors.length} 条向量，期望 ${missing.length} 条`,
						);
					}
					for (let offset = 0; offset < missing.length; offset += 1) {
						const entry = missing[offset] as { index: number; text: string };
						const vector = vectors[offset] as number[];
						assertVector(vector, inner.dimensions);
						results[entry.index] = vector;
						await writeCacheEntry(
							cachePath(cacheDir, label, entry.text),
							inner.dimensions,
							vector,
						);
					}
				}
				done += slice.length;
				options.onProgress?.({
					done,
					total: texts.length,
					cached: cachedCount,
				});
			}
			return results.map((vector, index) => {
				if (vector === undefined) {
					throw new Error(`第 ${index} 条文本没有生成 embedding`);
				}
				return vector;
			});
		},
	};
}

function cachePath(cacheDir: string, label: string, text: string): string {
	const key = createHash("sha256")
		.update(label)
		.update("\u0000")
		.update(text)
		.digest("hex");
	return path.join(cacheDir, `${key}.json`);
}

async function readCacheEntry(
	filePath: string,
	dimensions: number,
): Promise<number[] | null> {
	let text: string;
	try {
		text = await readFile(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (
		value === null ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		(value as Partial<CacheEntry>).version !== 1 ||
		(value as Partial<CacheEntry>).dimensions !== dimensions ||
		!Array.isArray((value as Partial<CacheEntry>).vector)
	) {
		return null;
	}
	const vector = (value as CacheEntry).vector;
	assertVector(vector, dimensions);
	return [...vector];
}

async function writeCacheEntry(
	filePath: string,
	dimensions: number,
	vector: readonly number[],
): Promise<void> {
	const entry: CacheEntry = { version: 1, dimensions, vector };
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

function assertVector(vector: unknown, dimensions: number): void {
	if (!Array.isArray(vector) || vector.length !== dimensions) {
		throw new Error(`embedding 向量维度必须是 ${dimensions}`);
	}
	for (const value of vector) {
		if (typeof value !== "number" || !Number.isFinite(value)) {
			throw new Error("embedding 向量必须由有限数字组成");
		}
	}
}
