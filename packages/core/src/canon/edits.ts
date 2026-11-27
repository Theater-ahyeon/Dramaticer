import type { StoryStore } from "../store/story-store.js";
import { resolveCanonCursor } from "./cursor.js";
import {
	type CanonBookRecord,
	type CanonChapterRecord,
	type CanonEventEditRecord,
	type CanonEventField,
	type CanonEventFieldValue,
	type CanonEventRecord,
	type CanonEventVoiceEdit,
	isCanonEventField,
} from "./types.js";

// 玩家改原著（v5 §5.5）：按格版本化，只追加。底层 `canon_events` 与
// `canon_voices` 不动；当前楼层路径上每一格取最新一版，分支与删楼自然隔离。

export type CanonEventState = "past" | "current" | "future";

/** 某一格当前生效的那一版；给界面标「你改的」与版本入口。 */
export interface CanonEventEditSummary {
	readonly field: CanonEventField;
	readonly versionId: number;
	readonly nodeId: string | null;
	readonly source: CanonEventEditRecord["source"];
	readonly note: string | null;
	readonly createdAt: string;
}

export interface EffectiveCanonEvent {
	/** 标题、概要、缩写已经换成生效版本，其余字段沿用抽取结果。 */
	readonly event: CanonEventRecord;
	readonly voices: readonly CanonEventVoiceEdit[];
	readonly passage: readonly string[];
	readonly baseVoices: readonly CanonEventVoiceEdit[];
	readonly basePassage: readonly string[];
	/** 有生效版本的格，各一条；没有改过的格不出现。 */
	readonly edits: readonly CanonEventEditSummary[];
	readonly editedFields: readonly CanonEventField[];
}

export interface EffectiveCanonTimelineEntry extends EffectiveCanonEvent {
	/** 1-based 主时间线序号。 */
	readonly ordinal: number;
	readonly state: CanonEventState;
}

function pathNodeIds(
	store: StoryStore,
	nodeId: string | null,
): ReadonlySet<string> | null {
	if (nodeId === null) return null;
	return new Set(store.getPathToNode(nodeId).map((node) => node.id));
}

function visibleEdits(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
	eventId: number,
): CanonEventEditRecord[] {
	const ids = pathNodeIds(store, nodeId);
	return store
		.listCanonEventEdits(storyId, eventId)
		.filter(
			(edit) => edit.nodeId === null || ids === null || ids.has(edit.nodeId),
		);
}

function latestByField(
	edits: readonly CanonEventEditRecord[],
): Map<CanonEventField, CanonEventEditRecord> {
	const latest = new Map<CanonEventField, CanonEventEditRecord>();
	for (const edit of edits) latest.set(edit.field, edit);
	return latest;
}

export function baseCanonEventPassage(
	store: StoryStore,
	event: CanonEventRecord,
): readonly string[] {
	const book = store.getCanonBook(event.bookId);
	if (book === null || !book.hasText) return [];
	const chapter = store.getCanonChapter(event.bookId, event.chapterId);
	if (chapter === null) return [];
	const start = Math.max(1, event.paragraphStart);
	const end = Math.min(chapter.paragraphs.length, event.paragraphEnd);
	return chapter.paragraphs.slice(start - 1, end);
}

export function baseCanonEventVoices(
	store: StoryStore,
	event: CanonEventRecord,
): readonly CanonEventVoiceEdit[] {
	return store
		.listCanonVoices(event.bookId, { chapterId: event.chapterId })
		.filter((voice) => voice.chapterOrdinal === event.chapterOrdinal)
		.map((voice) => ({
			character: voice.character,
			kind: voice.kind,
			text: voice.text,
		}));
}

/** 抽取结果里这一格原本的内容；撤销到第一版之前时用它做新记录。 */
export function baseCanonEventFieldValue(
	store: StoryStore,
	event: CanonEventRecord,
	field: CanonEventField,
): CanonEventFieldValue {
	switch (field) {
		case "title":
			return event.title;
		case "summary":
			return event.summary;
		case "digest":
			return event.digest;
		case "voices":
			return baseCanonEventVoices(store, event);
		case "passage":
			return baseCanonEventPassage(store, event);
	}
}

/**
 * 某件事件在当前楼层路径上的有效内容：每一格取最新一版，没有改过的格用
 * 抽取结果。窗口、走向页与原著页都从这里读。
 */
export function readEffectiveCanonEvent(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
	event: CanonEventRecord,
): EffectiveCanonEvent {
	return buildEffective(
		event,
		visibleEdits(store, storyId, nodeId, event.id),
		baseCanonEventVoices(store, event),
		baseCanonEventPassage(store, event),
	);
}

function buildEffective(
	event: CanonEventRecord,
	edits: readonly CanonEventEditRecord[],
	baseVoices: readonly CanonEventVoiceEdit[],
	basePassage: readonly string[],
): EffectiveCanonEvent {
	const latest = latestByField(edits);
	const title = latest.get("title")?.value;
	const summary = latest.get("summary")?.value;
	const digest = latest.get("digest")?.value;
	const voices = latest.get("voices")?.value;
	const passage = latest.get("passage")?.value;
	return {
		event: {
			...event,
			title: typeof title === "string" ? title : event.title,
			summary: typeof summary === "string" ? summary : event.summary,
			digest: typeof digest === "string" ? digest : event.digest,
		},
		voices: Array.isArray(voices)
			? (voices as readonly CanonEventVoiceEdit[])
			: baseVoices,
		passage: Array.isArray(passage)
			? (passage as readonly string[])
			: basePassage,
		baseVoices,
		basePassage,
		edits: [...latest.values()].map((edit) => ({
			field: edit.field,
			versionId: edit.id,
			nodeId: edit.nodeId,
			source: edit.source,
			note: edit.note,
			createdAt: edit.createdAt,
		})),
		editedFields: [...latest.keys()],
	};
}

/** 当前路径上可见的修改，按事件分组，组内按写入顺序。 */
function visibleEditBuckets(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
): Map<number, CanonEventEditRecord[]> {
	const ids = pathNodeIds(store, nodeId);
	const buckets = new Map<number, CanonEventEditRecord[]>();
	for (const edit of store.listCanonEventEdits(storyId)) {
		if (edit.nodeId !== null && ids !== null && !ids.has(edit.nodeId)) continue;
		const list = buckets.get(edit.eventId) ?? [];
		list.push(edit);
		buckets.set(edit.eventId, list);
	}
	return buckets;
}

/**
 * 一次读多件事件的有效内容：路径、修改与章原文各只查一次。整条时间线
 * （原著页、走向页）走这里，单件事件走 `readEffectiveCanonEvent`。
 */
export function readEffectiveCanonEvents(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
	events: readonly CanonEventRecord[],
): readonly EffectiveCanonEvent[] {
	const buckets = visibleEditBuckets(store, storyId, nodeId);
	const voiceCache = new Map<string, readonly CanonEventVoiceEdit[]>();
	const chapterCache = new Map<string, CanonChapterRecord | null>();
	const bookCache = new Map<string, CanonBookRecord | null>();
	return events.map((event) => {
		let baseVoices = voiceCache.get(event.chapterId);
		if (baseVoices === undefined) {
			baseVoices = baseCanonEventVoices(store, event);
			voiceCache.set(event.chapterId, baseVoices);
		}
		let book = bookCache.get(event.bookId);
		if (book === undefined) {
			book = store.getCanonBook(event.bookId);
			bookCache.set(event.bookId, book);
		}
		let chapter = chapterCache.get(event.chapterId);
		if (chapter === undefined) {
			chapter = store.getCanonChapter(event.bookId, event.chapterId);
			chapterCache.set(event.chapterId, chapter);
		}
		const basePassage =
			book === null || !book.hasText || chapter === null
				? []
				: chapter.paragraphs.slice(
						Math.max(1, event.paragraphStart) - 1,
						Math.min(chapter.paragraphs.length, event.paragraphEnd),
					);
		return buildEffective(
			event,
			buckets.get(event.id) ?? [],
			baseVoices,
			basePassage,
		);
	});
}

/** 主时间线上每件事件的有效内容与「已演 / 当前 / 未来」状态。 */
export function listEffectiveCanonTimeline(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
): readonly EffectiveCanonTimelineEntry[] {
	const resolved = resolveCanonCursor(store, storyId, nodeId);
	if (resolved === null) return [];
	const effective = readEffectiveCanonEvents(
		store,
		storyId,
		nodeId,
		resolved.timeline,
	);
	return effective.map((entry, index) => ({
		...entry,
		ordinal: index + 1,
		state:
			index < resolved.index
				? "past"
				: index === resolved.index
					? "current"
					: "future",
	}));
}

/** 某件事件在当前路径上可见的全部版本，新的在前；可按格收窄。 */
export function listCanonEventVersions(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
	eventId: number,
	field?: CanonEventField,
): readonly CanonEventEditRecord[] {
	return visibleEdits(store, storyId, nodeId, eventId)
		.filter((edit) => field === undefined || edit.field === field)
		.reverse();
}

/** 整条时间线的版本一次读出：按事件分组，组内新的在前。 */
export function listCanonEventVersionsByEvent(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
): ReadonlyMap<number, readonly CanonEventEditRecord[]> {
	const buckets = visibleEditBuckets(store, storyId, nodeId);
	const versions = new Map<number, readonly CanonEventEditRecord[]>();
	for (const [eventId, edits] of buckets) {
		versions.set(eventId, [...edits].reverse());
	}
	return versions;
}

function requireCanonEvent(
	store: StoryStore,
	storyId: string,
	eventId: number,
): CanonEventRecord {
	const binding = store.getStoryCanonBinding(storyId);
	if (binding === null) {
		throw new Error(`故事 ${storyId} 还没有绑定原著`);
	}
	const event = store
		.listCanonEvents(binding.bookId)
		.find((item) => item.id === eventId);
	if (event === undefined) {
		throw new Error(`原著事件不存在：${eventId}`);
	}
	return event;
}

export interface EditCanonEventInput {
	readonly eventId: number;
	readonly field: CanonEventField;
	readonly value: unknown;
	/** 默认写在当前 head；给 null 表示对所有分支可见。 */
	readonly nodeId?: string | null;
}

/** 玩家改一格：追加一条 `player` 版本，返回新记录。 */
export function editCanonEvent(
	store: StoryStore,
	storyId: string,
	input: EditCanonEventInput,
): CanonEventEditRecord {
	if (!isCanonEventField(input.field)) {
		throw new Error(`原著事件修改的格不合法：${String(input.field)}`);
	}
	requireCanonEvent(store, storyId, input.eventId);
	const nodeId =
		input.nodeId === undefined
			? (store.getHead(storyId)?.id ?? null)
			: input.nodeId;
	return store.appendCanonEventEdit({
		storyId,
		eventId: input.eventId,
		nodeId,
		field: input.field,
		value: input.value,
		source: "player",
		note: "玩家修改",
	});
}

export interface RollbackCanonEventInput {
	readonly eventId: number;
	/** 回到指定版本。 */
	readonly versionId?: number;
	/** 不给版本号时回到这一格的上一版（第一版之前回到抽取结果）。 */
	readonly field?: CanonEventField;
	readonly nodeId?: string | null;
}

/**
 * 撤销：追加一条内容与目标版本相同的新记录，旧记录不动。窗口与原著页
 * 读最新一版，所以撤销后立刻恢复成目标内容。
 */
export function rollbackCanonEvent(
	store: StoryStore,
	storyId: string,
	input: RollbackCanonEventInput,
): CanonEventEditRecord {
	const event = requireCanonEvent(store, storyId, input.eventId);
	const nodeId =
		input.nodeId === undefined
			? (store.getHead(storyId)?.id ?? null)
			: input.nodeId;
	let field: CanonEventField;
	let value: CanonEventFieldValue;
	let note: string;
	if (input.versionId !== undefined) {
		const target = store
			.listCanonEventEdits(storyId, input.eventId)
			.find((edit) => edit.id === input.versionId);
		if (target === undefined) {
			throw new Error(`原著事件版本不存在：${input.versionId}`);
		}
		field = target.field;
		value = target.value;
		note = `回到第 ${target.id} 版`;
	} else if (input.field !== undefined) {
		if (!isCanonEventField(input.field)) {
			throw new Error(`原著事件修改的格不合法：${String(input.field)}`);
		}
		field = input.field;
		const versions = listCanonEventVersions(
			store,
			storyId,
			nodeId,
			input.eventId,
			field,
		);
		if (versions.length === 0) {
			throw new Error("这一格还没有改过，不能撤销");
		}
		const previous = versions[1];
		value =
			previous === undefined
				? baseCanonEventFieldValue(store, event, field)
				: previous.value;
		note =
			previous === undefined ? "撤销到抽取结果" : `回到第 ${previous.id} 版`;
	} else {
		throw new Error("撤销需要版本号或要撤销的格");
	}
	return store.appendCanonEventEdit({
		storyId,
		eventId: input.eventId,
		nodeId,
		field,
		value,
		source: "rollback",
		note,
	});
}
