export * from "./env.js";
export * from "./json.js";
export * from "./llm/channels.js";
export * from "./llm/configure.js";
export * from "./llm/event-stream.js";
export * from "./llm/pi-channel.js";
export * from "./llm/router.js";
export * from "./llm/truncation.js";
export * from "./llm/types.js";
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
