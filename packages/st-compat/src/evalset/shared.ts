import type { StoryCorpus } from "../health/manifest.js";

export interface SkippedStory {
	readonly story: string;
	readonly corpus: StoryCorpus;
	readonly reason: string;
}

export function requireNonEmpty(value: string, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value;
}

export function emptyCounts<K extends string>(
	keys: readonly K[],
): Record<K, number> {
	const counts = Object.create(null) as Record<K, number>;
	for (const key of keys) counts[key] = 0;
	return counts;
}

export function addCounts<K extends string>(
	target: Record<K, number>,
	source: Readonly<Partial<Record<K, number>>>,
): void {
	for (const key of Object.keys(target) as K[]) {
		target[key] = (target[key] ?? 0) + (source[key] ?? 0);
	}
}
