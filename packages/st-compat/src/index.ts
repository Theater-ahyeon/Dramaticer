import { getCoreVersion } from "@dramaticer/core";

export {
	type JsonObject,
	type JsonValue,
	isJsonObject,
} from "@dramaticer/core";
export * from "./character-card.js";
export * from "./chat/character.js";
export * from "./chat/session.js";
export * from "./chat-import.js";
export * from "./chat-jsonl.js";
export * from "./dramaticer-extension.js";
export * from "./entity-import.js";
export * from "./lore-import.js";
export * from "./evalset/acu.js";
export * from "./evalset/event-questions.js";
export * from "./evalset/memory-cache.js";
export * from "./evalset/memory-eval.js";
export * from "./evalset/memory-report.js";
export * from "./evalset/question-files.js";
export * from "./evalset/retrieval.js";
export * from "./evalset/state-questions.js";
export * from "./node-id.js";
export * from "./preferences/export.js";
export * from "./preset.js";
export * from "./reference/collect.js";
export * from "./reference/text-stats.js";
export * from "./regex-classifier.js";
export * from "./state-diff.js";
export * from "./world-info.js";

export interface CompatInfo {
	readonly format: "sillytavern";
	readonly coreVersion: string;
}

export function getCompatInfo(): CompatInfo {
	const { major, minor, patch } = getCoreVersion();
	return {
		format: "sillytavern",
		coreVersion: `${major}.${minor}.${patch}`,
	};
}
