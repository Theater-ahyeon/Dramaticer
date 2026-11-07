import { getCoreVersion } from "@dramaticer/core";

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
