import {
	type BackgroundJobHandler,
	requireJobNodeId,
} from "../background/types.js";
import type { EmbeddingClient } from "../llm/embeddings.js";

export interface EmbeddingsHandlerOptions {
	readonly embedder: EmbeddingClient;
}

export const EMBEDDINGS_JOB_KIND = "embeddings";

/**
 * 为任务楼层里还没有向量的块调用 embedding。已经有向量时直接返回，
 * 同一块不会重复调用渠道；整批向量的维度由 StoryStore 再校验一次。
 */
export function createEmbeddingsHandler(
	options: EmbeddingsHandlerOptions,
): BackgroundJobHandler {
	if (options.embedder === undefined) {
		throw new Error("embedding 处理器需要一个 EmbeddingClient");
	}
	const embedder = options.embedder;
	return async ({ store, job }) => {
		const nodeId = requireJobNodeId(job);
		const chunks = store.listChunksMissingVectors(nodeId);
		if (chunks.length === 0) return;
		const vectors = await embedder.embed(chunks.map((chunk) => chunk.text));
		if (vectors.length !== chunks.length) {
			throw new Error(
				`embedding 返回 ${vectors.length} 条向量，期望 ${chunks.length} 条`,
			);
		}
		store.insertChunkVectors(
			chunks.map((chunk, index) => ({
				chunkId: chunk.chunkId,
				embedding: vectors[index] as number[],
			})),
		);
	};
}
