import type { BlueprintEntry, BlueprintEntryKind } from "./story-blueprint.js";

/** 剧透设置：显示全部条目，或只显示玩家自己写的条目与 AI 补的条数。 */
export const BLUEPRINT_SPOILER_MODES = ["show", "hide"] as const;

export type BlueprintSpoilerMode = (typeof BLUEPRINT_SPOILER_MODES)[number];

export const BLUEPRINT_SPOILER_MODE_LABELS: Record<
	BlueprintSpoilerMode,
	string
> = {
	show: "显示",
	hide: "隐藏",
};

export const DEFAULT_BLUEPRINT_SPOILER_MODE: BlueprintSpoilerMode = "show";

export function isBlueprintSpoilerMode(
	value: unknown,
): value is BlueprintSpoilerMode {
	return (
		typeof value === "string" &&
		(BLUEPRINT_SPOILER_MODES as readonly string[]).includes(value)
	);
}

export function assertBlueprintSpoilerMode(
	value: unknown,
	label = "剧透设置",
): BlueprintSpoilerMode {
	if (!isBlueprintSpoilerMode(value)) {
		throw new Error(
			`${label}只能是 ${BLUEPRINT_SPOILER_MODES.join("、")}，收到 ${JSON.stringify(value)}`,
		);
	}
	return value;
}

/** 被隐藏的条目按层计数；界面只显示这几个数字。 */
export interface BlueprintHiddenCounts {
	readonly premise: number;
	readonly volume: number;
	readonly milestone: number;
	readonly total: number;
}

/** 给玩家看的蓝图：可见条目与被隐藏的条数；没有隐藏任何内容时 `hidden` 为 null。 */
export interface BlueprintView {
	readonly entries: readonly BlueprintEntry[];
	readonly hidden: BlueprintHiddenCounts | null;
}

function countByKind(
	entries: readonly BlueprintEntry[],
): BlueprintHiddenCounts {
	const counts: Record<BlueprintEntryKind, number> = {
		premise: 0,
		volume: 0,
		milestone: 0,
	};
	for (const entry of entries) {
		counts[entry.kind] += 1;
	}
	return {
		premise: counts.premise,
		volume: counts.volume,
		milestone: counts.milestone,
		total: entries.length,
	};
}

/**
 * 按剧透设置派生给玩家看的蓝图：`hide` 时不返回 AI 补的条目，只给按层的条数；
 * 玩家写的条目原样保留，不改写字段。返回值只用于显示，不写回存储。
 */
export function readBlueprintView(
	entries: readonly BlueprintEntry[],
	mode: BlueprintSpoilerMode = DEFAULT_BLUEPRINT_SPOILER_MODE,
): BlueprintView {
	assertBlueprintSpoilerMode(mode);
	const hiddenEntries =
		mode === "hide" ? entries.filter((entry) => entry.source === "ai") : [];
	const visible =
		hiddenEntries.length === 0
			? [...entries]
			: entries.filter((entry) => entry.source !== "ai");
	return {
		entries: visible,
		hidden: hiddenEntries.length === 0 ? null : countByKind(hiddenEntries),
	};
}
