import type { LedgerChangeCardDiff } from "@dramaticer/core";
import type { StorySerialView } from "@dramaticer/protocol";

/** 连载页内部的五个标签；四块派生数据与可编辑记忆共用一个响应。 */
export const SERIAL_TABS = [
	{ id: "recap", label: "前情提要" },
	{ id: "chapters", label: "章节目录" },
	{ id: "cast", label: "人物关系" },
	{ id: "timeline", label: "时间线" },
	{ id: "memory", label: "可编辑记忆" },
] as const;

export type SerialTabId = (typeof SERIAL_TABS)[number]["id"];

/** 章标题只写序号；还没收尾的一章标出来。 */
export function formatChapterTitle(
	chapter: StorySerialView["chapters"][number],
): string {
	const suffix = chapter.endNodeId === null ? "（进行中）" : "";
	return `第 ${chapter.ordinal} 章${suffix}`;
}

/** 人物在记忆页上可改的文本字段。 */
export const MEMORY_FIELDS = [
	{ field: "status", label: "状态" },
	{ field: "location", label: "位置" },
] as const;

export type MemoryField = (typeof MEMORY_FIELDS)[number]["field"];

export interface MemoryDraft {
	readonly status: string;
	readonly location: string;
}

function normalized(value: string | null): string {
	return value === null ? "" : value;
}

/**
 * 把表单里的状态与位置转成台账修改：内容没变的不写；清空已有值写成删除，
 * 其余写成 `set`。没有改动时返回空数组，页面据此拒绝提交。
 */
export function buildCharacterDiffs(
	character: StorySerialView["cast"][number],
	draft: MemoryDraft,
): LedgerChangeCardDiff[] {
	const diffs: LedgerChangeCardDiff[] = [];
	for (const { field } of MEMORY_FIELDS) {
		const before = normalized(character[field]);
		const after = draft[field].trim();
		if (after === before) continue;
		const path = ["character", character.who, field];
		if (after === "") {
			diffs.push({ path, op: "delete" });
			continue;
		}
		diffs.push({ path, op: "set", value: after });
	}
	return diffs;
}

/** 记忆修改的说明默认写明人物与改动的字段；玩家可以改写成自己的话。 */
export function defaultMemoryDescription(
	character: StorySerialView["cast"][number],
	diffs: readonly LedgerChangeCardDiff[],
): string {
	const fields = diffs
		.map((diff) => diff.path[diff.path.length - 1])
		.flatMap((field) => {
			const entry = MEMORY_FIELDS.find((item) => item.field === field);
			return entry === undefined ? [] : [entry.label];
		});
	return `修改「${character.who}」的${fields.join("、")}`;
}

/** 视图加载前的空占位；不可变，可以直接当初始值。 */
export const EMPTY_SERIAL_VIEW: StorySerialView = {
	storyId: "",
	nodeId: null,
	scenes: [],
	chapters: [],
	cast: [],
	timeline: [],
	recap: {
		stale: false,
		staleHours: 12,
		lastPlayedAt: null,
		scenes: [],
	},
};
