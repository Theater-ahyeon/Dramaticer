import { getCoreVersion } from "@dramaticer/core";

export * from "./character-card.js";
export * from "./chat-jsonl.js";
export * from "./json.js";

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
