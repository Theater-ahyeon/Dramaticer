import type { DirectorLine } from "../director/lines.js";
import type { EntityKind } from "../entity.js";
import type { StoryStore } from "../store/story-store.js";
import type { Story, TimelineNode } from "../timeline.js";
import { type CanonStartingPage, buildCanonStartingPages } from "./compile.js";
// 从原著开局（canon/04，v5 §5.2）：选书、选开局事件、选扮演身份，
// 把截至开局章节的原著实体装进故事、生成首楼并记下初始游标。
import type {
	CanonBookRecord,
	CanonCursorRecord,
	CanonEntityKind,
	CanonEventRecord,
	CanonIdentityKind,
	CanonPlayerPage,
	CanonStoryBindingRecord,
} from "./types.js";

export interface CanonStartIdentity {
	readonly kind: CanonIdentityKind;
	readonly name: string;
	/** 自创人物的人设；扮演原著人物时忽略。 */
	readonly persona?: string;
}

export interface StartCanonStoryInput {
	/** 不传时新建一个故事 id。 */
	readonly storyId?: string;
	/** 不传时用书名。 */
	readonly title?: string;
	readonly bookId: string;
	/** 主时间线上的事件 id；不传时从第 1 件开始。 */
	readonly startEventId?: number;
	readonly identity: CanonStartIdentity;
	readonly allowFullBookSpoilers?: boolean;
}

export interface CanonStartResult {
	readonly story: Story;
	readonly book: CanonBookRecord;
	readonly event: CanonEventRecord;
	readonly binding: CanonStoryBindingRecord;
	readonly cursor: CanonCursorRecord;
	readonly openingNode: TimelineNode;
	/** 装进故事的原著实体；扮演的原著人物不在这里。 */
	readonly entityNames: readonly string[];
	readonly notebookPages: number;
}

/** 界面只需要「已出场的人物」时用这个映射。 */
export function canonEntityKindToEntityKind(kind: CanonEntityKind): EntityKind {
	switch (kind) {
		case "人物":
			return "character";
		case "地点":
			return "location";
		case "势力":
			return "faction";
		case "物品":
			return "item";
		default:
			return "lore";
	}
}

/** 主时间线：插叙不进主线；汇编排定的顺序缺失时按章节与段落顺序补。 */
export function sortCanonTimelineEvents(
	events: readonly CanonEventRecord[],
): CanonEventRecord[] {
	return events
		.filter((event) => !event.isInterlude)
		.sort((left, right) => {
			const order =
				(left.timelineOrder ?? Number.MAX_SAFE_INTEGER) -
				(right.timelineOrder ?? Number.MAX_SAFE_INTEGER);
			if (order !== 0) return order;
			return (
				left.chapterOrdinal - right.chapterOrdinal ||
				left.paragraphStart - right.paragraphStart ||
				left.seq - right.seq
			);
		});
}

function clampText(text: string, limit: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= limit) return trimmed;
	return trimmed.slice(0, limit);
}

function presentNames(
	event: CanonEventRecord,
	pages: readonly CanonStartingPage[],
): string[] {
	const known = new Map<string, string>();
	for (const page of pages) {
		known.set(page.name, page.name);
		for (const alias of page.aliases) known.set(alias, page.name);
	}
	const present: string[] = [];
	for (const participant of event.participants) {
		const name = known.get(participant);
		if (name !== undefined && !present.includes(name)) present.push(name);
	}
	return present;
}

/** 首楼是程序写出的清晰开局引导，不调用模型。 */
export function buildCanonOpeningText(input: {
	readonly book: CanonBookRecord;
	readonly event: CanonEventRecord;
	readonly pages: readonly CanonStartingPage[];
	readonly playerName: string;
}): string {
	const { book, event, pages, playerName } = input;
	const lines = [
		`【原著开局】《${book.title}》的「${event.title}」`,
		event.summary,
	];
	if (event.location !== null && event.location.trim().length > 0) {
		lines.push(`地点：${event.location}`);
	}
	if (event.timeText !== null && event.timeText.trim().length > 0) {
		lines.push(`时间：${event.timeText}`);
	}
	const present = presentNames(event, pages);
	if (present.length > 0) lines.push(`在场：${present.join("、")}`);
	lines.push(`故事从这一幕开始。你扮演${playerName}。`);
	return lines.join("\n");
}

function playerPersona(input: {
	readonly identity: CanonStartIdentity;
	readonly page: CanonStartingPage | null;
}): string {
	const name = input.identity.name.trim();
	const intro = `你扮演${name}。`;
	if (input.identity.kind === "custom") {
		const persona = input.identity.persona?.trim() ?? "";
		return persona.length === 0 ? intro : `${intro}\n${persona}`;
	}
	if (input.page === null) return intro;
	return [intro, input.page.lead, input.page.base]
		.filter((part) => part.trim().length > 0)
		.join("\n");
}

function toPlayerPage(page: CanonStartingPage): CanonPlayerPage {
	return {
		name: page.name,
		kind: page.kind,
		aliases: page.aliases,
		lead: page.lead,
		base: page.base,
		entries: page.entries,
	};
}

function canonDirectionLines(
	events: readonly CanonEventRecord[],
	startIndex: number,
): DirectorLine[] {
	return events.slice(startIndex, startIndex + 3).map((event) => ({
		id: `canon-${event.id}`,
		kind: "main",
		who: "玩家",
		want: clampText(event.title, 500),
		obstacle: clampText(event.summary, 500),
		countdown: null,
		preparations: [],
	}));
}

/**
 * 从原著开局：事务由调用方负责。失败时抛错，调用方回滚后不会留下半截故事。
 */
export function startCanonStory(
	store: StoryStore,
	input: StartCanonStoryInput,
): CanonStartResult {
	if (
		input.storyId !== undefined &&
		store.getStoryCanonBinding(input.storyId) !== null
	) {
		throw new Error(`故事 ${input.storyId} 已经绑定过原著`);
	}
	const book = store.getCanonBook(input.bookId);
	if (book === null) {
		throw new Error(`原著 ${input.bookId} 不存在`);
	}
	const compilation = store.getCanonCompilation(book.id);
	if (compilation === null || compilation.status !== "done") {
		throw new Error("这本原著还没有完成全书汇编，不能从原著开局");
	}
	const events = sortCanonTimelineEvents(store.listCanonEvents(book.id));
	if (events.length === 0) {
		throw new Error("这本原著还没有主时间线事件");
	}
	const startIndex =
		input.startEventId === undefined
			? 0
			: events.findIndex((event) => event.id === input.startEventId);
	if (startIndex < 0) {
		throw new Error("开局事件不在主时间线上");
	}
	const event = events[startIndex];
	if (event === undefined) {
		throw new Error("开局事件不存在");
	}
	const pages = [
		...buildCanonStartingPages(store, book.id, event.chapterOrdinal),
	];
	if (pages.length === 0) {
		throw new Error("开局章节之前还没有出场的原著实体");
	}
	const identity = input.identity;
	const playerName = identity.name.trim();
	if (playerName.length === 0) {
		throw new Error("扮演人物的名字不能为空");
	}
	let playerPage: CanonStartingPage | null = null;
	if (identity.kind === "canon") {
		playerPage = pages.find((page) => page.name === playerName) ?? null;
		if (playerPage === null) {
			throw new Error(
				`原著人物「${playerName}」在开局章节之前还没有出场，不能扮演`,
			);
		}
	}
	const title = input.title?.trim() || book.title;
	let story: Story;
	if (input.storyId === undefined) {
		story = store.createStory({ title });
	} else {
		const existing = store.getStory(input.storyId);
		if (existing === null) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (store.getHead(input.storyId) !== null) {
			throw new Error(`故事 ${input.storyId} 已经有楼层，不能再从原著开局`);
		}
		story =
			input.title === undefined
				? existing
				: store.updateStoryTitle(input.storyId, title);
	}
	const openingText = buildCanonOpeningText({
		book,
		event,
		pages,
		playerName,
	});
	const openingNode = store.appendNode({
		storyId: story.id,
		parentId: null,
		role: "assistant",
		raw: openingText,
	});
	const entityNames: string[] = [];
	for (const page of pages) {
		if (identity.kind === "canon" && page.name === playerName) continue;
		const entity = store.upsertEntity({
			storyId: story.id,
			kind: canonEntityKindToEntityKind(page.kind),
			name: page.name,
			description: page.lead,
			aliases: [...page.aliases],
			source: "canon",
		});
		store.appendNotebookVersion({
			storyId: story.id,
			entityId: entity.id,
			nodeId: openingNode.id,
			base: page.base,
			now: page.now,
			past: [],
			locked: [],
			source: "init",
			note: `原著《${book.title}》开局前的底色`,
		});
		entityNames.push(entity.name);
	}
	store.updateStorySettings(story.id, {
		persona: playerPersona({ identity, page: playerPage }),
	});
	const binding = store.saveStoryCanonBinding({
		storyId: story.id,
		bookId: book.id,
		startEventId: event.id,
		startChapterOrdinal: event.chapterOrdinal,
		identityKind: identity.kind,
		playerEntityName: playerName,
		playerPage: playerPage === null ? null : toPlayerPage(playerPage),
		allowFullBookSpoilers: input.allowFullBookSpoilers === true,
	});
	const cursor = store.saveCanonCursor({
		storyId: story.id,
		nodeId: openingNode.id,
		eventId: event.id,
		eventOrdinal: startIndex + 1,
		chapterOrdinal: event.chapterOrdinal,
	});
	const lines = canonDirectionLines(events, startIndex);
	if (lines.length > 0) {
		store.saveDirectorLines({
			storyId: story.id,
			nodeId: openingNode.id,
			diffs: lines.map((line) => ({ action: "set" as const, line })),
		});
	}
	return {
		story,
		book,
		event,
		binding,
		cursor,
		openingNode,
		entityNames,
		notebookPages: entityNames.length,
	};
}
