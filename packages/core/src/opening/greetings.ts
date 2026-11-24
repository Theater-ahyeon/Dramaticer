import type { JsonValue } from "../json.js";
import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";

/** 导入时保存的开场白列表；换开场时按下标取。 */
const STORY_GREETINGS_KEY = "opening.greetings";

/**
 * 故事还停在开场：一轮都没玩过，所有楼层都是根部的助手楼层（开场白或选中的候选）。
 * 这期间可以换开场白、选候选、重新生成候选；玩家一开口就结束。
 */
export function storyAtOpening(store: StoryStore, storyId: string): boolean {
	const head = store.getHead(storyId);
	if (head === null) return true;
	if (head.parentId !== null || head.role !== "assistant") return false;
	return store
		.listStoryNodes(storyId)
		.every((node) => node.parentId === null && node.role === "assistant");
}

export function saveStoryGreetings(
	store: StoryStore,
	storyId: string,
	greetings: readonly string[],
): void {
	const kept = greetings.filter((text) => text.trim().length > 0);
	store.setStoryValue(storyId, STORY_GREETINGS_KEY, kept as JsonValue);
}

export function readStoryGreetings(
	store: StoryStore,
	storyId: string,
): string[] {
	const raw = store.getStoryValue(storyId, STORY_GREETINGS_KEY);
	return Array.isArray(raw)
		? raw.filter((item): item is string => typeof item === "string")
		: [];
}

/** 当前开场用的是第几条开场白；开场是候选或已经开玩时为 null。 */
export function currentGreetingIndex(
	store: StoryStore,
	storyId: string,
): number | null {
	const head = store.getHead(storyId);
	if (head === null || head.parentId !== null) return null;
	const index = readStoryGreetings(store, storyId).indexOf(head.raw);
	return index < 0 ? null : index;
}

/**
 * 换成第 index 条开场白：同样正文的根楼层已经有了就切过去，没有就新建一个根楼层。
 * 原文不改（I4），旧开场留在树里。
 */
export function switchStoryGreeting(
	store: StoryStore,
	storyId: string,
	index: number,
): TimelineNode {
	const greetings = readStoryGreetings(store, storyId);
	const text = greetings[index];
	if (text === undefined) {
		throw new Error(`开场白不存在：第 ${index} 条，共 ${greetings.length} 条`);
	}
	if (!storyAtOpening(store, storyId)) {
		throw new Error(`故事 ${storyId} 已经开始，不能再换开场白`);
	}
	const existing = store
		.listStoryNodes(storyId)
		.find((node) => node.parentId === null && node.raw === text);
	if (existing !== undefined) {
		store.setHead(storyId, existing.id);
		return existing;
	}
	return store.appendNode({
		storyId,
		parentId: null,
		role: "assistant",
		raw: text,
	});
}
