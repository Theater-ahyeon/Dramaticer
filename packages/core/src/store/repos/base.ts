import type Database from "better-sqlite3";
import type { ChunkStrategy } from "../../retrieval/chunk-text.js";
import type { StoryStore } from "../story-store.js";

/** 领域仓储共用的连接与配置；跨领域的调用一律经 store（外观）转发。 */
export abstract class StoreRepo {
	constructor(
		protected readonly db: Database.Database,
		protected readonly store: StoryStore,
		protected readonly embeddingDimensions: number,
		protected readonly chunkStrategy: ChunkStrategy,
	) {}
}
