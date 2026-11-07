export * from "./json.js";
export * from "./llm/client.js";
export * from "./retrieval/chunk-index.js";
export * from "./retrieval/chunk-text.js";
export { LATEST_SCHEMA_VERSION } from "./store/migrations.js";
export type {
	AppendNodeInput,
	CreateStoryInput,
	SearchNodeTextOptions,
} from "./store/story-store.js";
export { StoryStore } from "./store/story-store.js";
export * from "./timeline.js";

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
