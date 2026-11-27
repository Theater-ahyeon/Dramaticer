export * from "./assistant/index.js";
export * from "./background/index.js";
export * from "./blocks/index.js";
export * from "./blueprint/index.js";
export * from "./canon/index.js";
export * from "./chat/index.js";
export * from "./cli/index.js";
export * from "./context/index.js";
export * from "./direction/index.js";
export * from "./director/index.js";
export * from "./edits/index.js";
export * from "./entity.js";
export * from "./env.js";
export * from "./explain/index.js";
export * from "./images/index.js";
export * from "./json.js";
export * from "./ledger/index.js";
export * from "./llm/channels.js";
export * from "./llm/configure.js";
export * from "./llm/embeddings.js";
export * from "./llm/event-stream.js";
export * from "./llm/fallback.js";
export * from "./llm/pi-channel.js";
export * from "./llm/probe.js";
export * from "./llm/rerank.js";
export * from "./llm/router.js";
export * from "./llm/truncation.js";
export * from "./llm/types.js";
export * from "./memory/index.js";
export * from "./opening/index.js";
export * from "./plugins/index.js";
export * from "./preferences/events.js";
export * from "./preferences/reroll.js";
export * from "./preferences/reroll-stats.js";
export * from "./preferences/stats-cli.js";
export * from "./retrieval/chunk-index.js";
export * from "./retrieval/chunk-text.js";
export * from "./retrieval/hybrid.js";
export * from "./run-log.js";
export * from "./sandbox/index.js";
export * from "./serial/index.js";
export * from "./settings/index.js";
export * from "./state.js";
export { LATEST_SCHEMA_VERSION } from "./store/migrations.js";
export * from "./store/settings.js";
export * from "./store/story-media.js";
export type {
	AppendNodeInput,
	CanonChapterSplitResult,
	CanonChapterUpdate,
	ChunkSearchMatch,
	ChunkVectorForNode,
	CreateCanonBookInput,
	CreateStoryInput,
	ListEntitiesOptions,
	RecordEventExtractionsInput,
	ResolveEntitiesOptions,
	SearchChunksOptions,
	SearchNodeTextOptions,
} from "./store/story-store.js";
export { StoryStore } from "./store/story-store.js";
export * from "./structured/index.js";
export * from "./timeline.js";
export * from "./tokens.js";
export * from "./tools/index.js";
export * from "./trace.js";
export * from "./world-model/index.js";

export interface EngineVersion {
	readonly major: number;
	readonly minor: number;
	readonly patch: number;
}

export function getCoreVersion(): EngineVersion {
	return {
		major: 0,
		minor: 1,
		patch: 0,
	};
}
