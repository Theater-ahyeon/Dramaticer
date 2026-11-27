import type { StoryStore } from "../store/story-store.js";
import { sortCanonTimelineEvents } from "./start.js";
import type {
	CanonCursorRecord,
	CanonEventRecord,
	CanonStoryBindingRecord,
	CanonWindowMode,
} from "./types.js";

// 原著游标（canon/05，v5 §5.5）：沿楼层树找最近一条游标，删楼或切换分支
// 自然回退到父分支；没有楼层的游标时用开局事件。游标是主时间线的事件序号，
// 不要求模型维护任何时刻格式。

export interface ResolvedCanonCursor {
	readonly binding: CanonStoryBindingRecord;
	readonly timeline: readonly CanonEventRecord[];
	/** 楼层上的真实游标；从开局事件回退时为 null。 */
	readonly cursor: CanonCursorRecord | null;
	readonly event: CanonEventRecord;
	readonly index: number;
	/** 1-based 事件序号。 */
	readonly eventOrdinal: number;
	readonly chapterOrdinal: number;
}

/** 主时间线；插叙不进游标。 */
export function readCanonTimeline(
	store: StoryStore,
	bookId: string,
): readonly CanonEventRecord[] {
	return sortCanonTimelineEvents(store.listCanonEvents(bookId));
}

/** 沿当前节点到根的路径取最近一条游标；找不到时回退到开局事件。 */
export function resolveCanonCursor(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
): ResolvedCanonCursor | null {
	const binding = store.getStoryCanonBinding(storyId);
	if (binding === null) return null;
	const timeline = readCanonTimeline(store, binding.bookId);
	const head = nodeId ?? store.getHead(storyId)?.id ?? null;
	const path = head === null ? [] : store.getPathToNode(head);
	let cursor: CanonCursorRecord | null = null;
	for (let index = path.length - 1; index >= 0; index -= 1) {
		const node = path[index];
		if (node === undefined) continue;
		const found = store.getCanonCursor(storyId, node.id);
		if (found !== null) {
			cursor = found;
			break;
		}
	}
	const fallbackIndex = timeline.findIndex(
		(event) => event.id === binding.startEventId,
	);
	if (cursor === null) {
		const event = timeline[fallbackIndex];
		if (event === undefined) return null;
		return {
			binding,
			timeline,
			cursor: null,
			event,
			index: fallbackIndex,
			eventOrdinal: fallbackIndex + 1,
			chapterOrdinal: event.chapterOrdinal,
		};
	}
	let index = cursor.eventOrdinal - 1;
	if (timeline[index]?.id !== cursor.eventId) {
		index = timeline.findIndex((event) => event.id === cursor.eventId);
	}
	if (index < 0) index = Math.min(cursor.eventOrdinal - 1, timeline.length - 1);
	const event = timeline[index];
	if (event === undefined) return null;
	return {
		binding,
		timeline,
		cursor,
		event,
		index,
		eventOrdinal: index + 1,
		chapterOrdinal: event.chapterOrdinal,
	};
}

/** 当前事件加上后续 `count` 件；窗口永远只从主时间线的当前位置往后取。 */
export function readCanonWindowEvents(
	resolved: ResolvedCanonCursor,
	count: number,
): readonly CanonEventRecord[] {
	if (!Number.isInteger(count) || count < 0) {
		throw new Error("原著窗口的件数必须是非负整数");
	}
	return resolved.timeline.slice(resolved.index, resolved.index + count);
}

function eventAt(timeline: readonly CanonEventRecord[], eventId: number) {
	const index = timeline.findIndex((event) => event.id === eventId);
	const event = timeline[index];
	if (index < 0 || event === undefined) {
		throw new Error(`原著事件不在主时间线上：${eventId}`);
	}
	return { index, event };
}

/** 在某楼层写入指向指定事件的游标；`fromHere` 表示这一件还没演过。 */
export function writeCanonCursorAtEvent(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	eventId: number,
	fromHere = false,
): CanonCursorRecord {
	const binding = store.getStoryCanonBinding(storyId);
	if (binding === null) {
		throw new Error(`故事 ${storyId} 还没有绑定原著`);
	}
	const { index, event } = eventAt(
		readCanonTimeline(store, binding.bookId),
		eventId,
	);
	return store.saveCanonCursor({
		storyId,
		nodeId,
		eventId: event.id,
		eventOrdinal: index + 1,
		chapterOrdinal: event.chapterOrdinal,
		fromHere,
	});
}

/** 「从这里开始」：把当前 head 的游标拖到任意主时间线事件，随分支隔离。 */
export function startCanonFromHere(
	store: StoryStore,
	storyId: string,
	eventId: number,
	nodeId?: string,
): CanonCursorRecord {
	const binding = store.getStoryCanonBinding(storyId);
	if (binding === null) {
		throw new Error(`故事 ${storyId} 还没有绑定原著`);
	}
	const target = nodeId ?? store.getHead(storyId)?.id;
	if (target === undefined || target === null) {
		throw new Error("故事还没有楼层，不能从这里开始");
	}
	const cursor = writeCanonCursorAtEvent(store, storyId, target, eventId, true);
	store.updateStoryCanonSettings(storyId, { pendingAdvance: 0 });
	return cursor;
}

/**
 * 局面更新判断这一楼演完了当前事件后推进到下一件；已经到末尾时停在最后一件。
 * 返回新游标；没有下一件时返回 null。
 */
export function advanceCanonCursor(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	count = 1,
): CanonCursorRecord | null {
	if (!Number.isInteger(count) || count < 1) {
		throw new Error("推进的原著件数必须是正整数");
	}
	const resolved = resolveCanonCursor(store, storyId, nodeId);
	if (resolved === null) return null;
	const next = resolved.timeline[resolved.index + count];
	if (next === undefined) return null;
	return writeCanonCursorAtEvent(store, storyId, nodeId, next.id, false);
}

/** 原地写回当前事件：玩家偏离或没演完时游标不动。 */
export function holdCanonCursor(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	resolved: ResolvedCanonCursor,
	fromHere: boolean,
): CanonCursorRecord {
	return store.saveCanonCursor({
		storyId,
		nodeId,
		eventId: resolved.event.id,
		eventOrdinal: resolved.eventOrdinal,
		chapterOrdinal: resolved.event.chapterOrdinal,
		fromHere,
	});
}

export function setCanonPendingAdvance(
	store: StoryStore,
	storyId: string,
	count: number,
): CanonStoryBindingRecord {
	return store.updateStoryCanonSettings(storyId, { pendingAdvance: count });
}

export function setCanonWindowMode(
	store: StoryStore,
	storyId: string,
	mode: CanonWindowMode,
): CanonStoryBindingRecord {
	return store.updateStoryCanonSettings(storyId, { windowMode: mode });
}

export function setCanonAllowFullBookSpoilers(
	store: StoryStore,
	storyId: string,
	allow: boolean,
): CanonStoryBindingRecord {
	return store.updateStoryCanonSettings(storyId, {
		allowFullBookSpoilers: allow,
	});
}
