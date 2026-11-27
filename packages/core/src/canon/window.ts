import type {
	ContextItemSource,
	ContextTraceItem,
} from "../context/assembler.js";
import { DEAD_STATUS_PATTERN } from "../memory/situation.js";
import { readMemoryState } from "../memory/view.js";
import type { StoryStore } from "../store/story-store.js";
import { type TokenEstimator, createTokenEstimator } from "../tokens.js";
import { sliceCanonEntityPage } from "./compile.js";
import { resolveCanonCursor } from "./cursor.js";
import { readEffectiveCanonEvent } from "./edits.js";
import type {
	CanonBookRecord,
	CanonCompiledEntityRecord,
	CanonEventRecord,
	CanonEventVoiceEdit,
	CanonStoryBindingRecord,
	CanonWindowMode,
} from "./types.js";

// 原著窗口（canon/05，v5 §5.5）：每轮给「当前」一件，推进时加「接下来」
// 1–3 件；话术与原文按设置叠加。死人剔除话术并在事件旁标注，明确缺席的
// 参与者标注「无法按原著发生」。原著只是参考，偏离规则每次固定说明。

/** 原文叠加时单件事件最多带的字数。 */
export const CANON_EVENT_TEXT_MAX_CHARS = 2_000;

export interface CanonWindowEventBlock {
	readonly event: CanonEventRecord;
	readonly dead: readonly string[];
	readonly absent: readonly string[];
	readonly voices: readonly CanonEventVoiceEdit[];
	readonly paragraphs: readonly string[];
	readonly text: string;
}

export interface CanonWindow {
	readonly book: CanonBookRecord;
	readonly binding: CanonStoryBindingRecord;
	readonly current: CanonWindowEventBlock;
	readonly upcoming: readonly CanonWindowEventBlock[];
	readonly text: string;
	readonly items: readonly ContextTraceItem[];
	readonly source: string;
}

interface EntityLookup {
	readonly byName: Map<string, CanonCompiledEntityRecord>;
	readonly dead: ReadonlySet<string>;
	readonly present: ReadonlySet<string>;
	readonly locations: ReadonlyMap<string, string>;
}

function normalizeName(value: string): string {
	return value.trim().replace(/\s+/g, "").toLocaleLowerCase();
}

function canonicalName(lookup: EntityLookup, name: string): string | null {
	const direct = lookup.byName.get(normalizeName(name));
	return direct === undefined ? null : direct.name;
}

function buildEntityLookup(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	binding: CanonStoryBindingRecord,
): EntityLookup {
	const byName = new Map<string, CanonCompiledEntityRecord>();
	for (const entity of store.listCanonCompiledEntities(binding.bookId)) {
		byName.set(normalizeName(entity.name), entity);
		for (const alias of entity.aliases) {
			byName.set(normalizeName(alias), entity);
		}
	}
	const dead = new Set<string>();
	const locations = new Map<string, string>();
	for (const item of readMemoryState(store, storyId, nodeId)) {
		if (item.path[0] !== "character" || item.path[1] === undefined) continue;
		const entry = byName.get(normalizeName(item.path[1]));
		const name = entry?.name ?? item.path[1];
		if (item.item === "status" && typeof item.value === "string") {
			if (DEAD_STATUS_PATTERN.test(item.value)) dead.add(name);
		}
		if (item.item === "location" && typeof item.value === "string") {
			locations.set(name, item.value);
		}
	}
	const present = new Set(store.getLatestSceneLogOnPath(nodeId)?.present ?? []);
	return { byName, dead, present, locations };
}

function participantsOf(
	event: CanonEventRecord,
	lookup: EntityLookup,
): { readonly names: readonly string[]; readonly dead: readonly string[] } {
	const names: string[] = [];
	const dead: string[] = [];
	for (const participant of event.participants) {
		const name = canonicalName(lookup, participant) ?? participant;
		if (!names.includes(name)) names.push(name);
		if (lookup.dead.has(name) && !dead.includes(name)) dead.push(name);
	}
	return { names, dead };
}

function absentOf(
	event: CanonEventRecord,
	lookup: EntityLookup,
	isCurrent: boolean,
): string[] {
	if (!isCurrent) return [];
	const eventPlace =
		event.location === null ? null : normalizeName(event.location);
	if (eventPlace === null) return [];
	const absent: string[] = [];
	for (const participant of event.participants) {
		const name = canonicalName(lookup, participant) ?? participant;
		if (lookup.dead.has(name) || lookup.present.has(name)) continue;
		const place = lookup.locations.get(name);
		if (place === undefined || normalizeName(place) === eventPlace) continue;
		if (!absent.includes(name)) absent.push(name);
	}
	return absent;
}

function voiceLines(
	voices: readonly CanonEventVoiceEdit[],
	dead: readonly string[],
	lookup: EntityLookup,
): string[] {
	const deadSet = new Set(dead);
	const lines: string[] = [];
	for (const voice of voices) {
		const name = canonicalName(lookup, voice.character) ?? voice.character;
		if (deadSet.has(name)) continue;
		const label = voice.kind === "speech" ? "说" : "想";
		lines.push(`- ${name}（${label}）：「${voice.text}」`);
	}
	return lines;
}

/** 原文与玩家改过的段落同样按单件上限截断。 */
function truncateParagraphs(paragraphs: readonly string[]): string[] {
	const joined = paragraphs.join("\n");
	if (joined.length === 0) return [];
	if (joined.length <= CANON_EVENT_TEXT_MAX_CHARS) return [joined];
	return [`${joined.slice(0, CANON_EVENT_TEXT_MAX_CHARS)}…`];
}

function renderEventBlock(input: {
	readonly event: CanonEventRecord;
	readonly dead: readonly string[];
	readonly absent: readonly string[];
	readonly voices: readonly CanonEventVoiceEdit[];
	readonly paragraphs: readonly string[];
	readonly mode: CanonWindowMode;
	readonly includeVoices: boolean;
	readonly lookup: EntityLookup;
}): CanonWindowEventBlock {
	const { event, dead, absent, voices, paragraphs, mode, lookup } = input;
	const lines = [
		`「${event.title}」（第 ${event.chapterOrdinal} 章）`,
		`概要：${event.summary}`,
		event.digest.trim().length > 0 ? `缩写：${event.digest}` : null,
		event.location === null || event.location.trim().length === 0
			? null
			: `地点：${event.location}`,
		event.timeText === null || event.timeText.trim().length === 0
			? null
			: `时间：${event.timeText}`,
		dead.length > 0
			? `${dead.join("、")} 已死，本局不再出场，无法按原著发生`
			: null,
		absent.length > 0 ? `${absent.join("、")} 不在场，无法按原著发生` : null,
	].filter((line): line is string => line !== null);
	if (input.includeVoices && mode !== "summary_only") {
		const rendered = voiceLines(voices, dead, lookup);
		if (rendered.length > 0) lines.push("话术：", ...rendered);
	}
	if (mode === "full_text" && paragraphs.length > 0) {
		lines.push("原文：", ...paragraphs);
	}
	return {
		event,
		dead,
		absent,
		voices,
		paragraphs,
		text: lines.join("\n"),
	};
}

const DEVIATION_RULE =
	"原著只是参考：与本局已经发生的事实冲突时，以本局为准；玩家偏离时顺着玩家写，不把剧情拽回原著；关系和称呼以本局为准。";

/**
 * 组装某一楼层的原著窗口。上游先按本轮是否推进决定 `upcoming`：
 * 常规回合为 0，推进为 1–3，玩家指定推进 N 件时为 N。
 */
export function buildCanonWindow(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	options: {
		readonly upcoming: number;
		readonly estimator?: TokenEstimator;
	},
): CanonWindow | null {
	const resolved = resolveCanonCursor(store, storyId, nodeId);
	if (resolved === null) return null;
	const book = store.getCanonBook(resolved.binding.bookId);
	if (book === null) return null;
	const lookup = buildEntityLookup(store, storyId, nodeId, resolved.binding);
	const events = resolved.timeline.slice(
		resolved.index,
		resolved.index + 1 + Math.max(0, options.upcoming),
	);
	const blocks = events.map((event, index) => {
		const effective = readEffectiveCanonEvent(store, storyId, nodeId, event);
		const participants = participantsOf(event, lookup);
		const absent = absentOf(event, lookup, index === 0);
		return renderEventBlock({
			event: effective.event,
			dead: participants.dead,
			absent,
			voices: effective.voices,
			paragraphs:
				resolved.binding.windowMode === "full_text"
					? truncateParagraphs(effective.passage)
					: [],
			mode: resolved.binding.windowMode,
			includeVoices: true,
			lookup,
		});
	});
	const current = blocks[0];
	if (current === undefined) return null;
	const upcoming = blocks.slice(1);
	const estimator = options.estimator ?? createTokenEstimator();
	const parts = [
		`【原著窗口】《${book.title}》`,
		"当前：",
		current.text,
		upcoming.length === 0
			? null
			: `接下来：\n${upcoming.map((block) => `- ${block.text}`).join("\n")}`,
		DEVIATION_RULE,
	].filter((part): part is string => part !== null);
	const items: ContextTraceItem[] = blocks.map((block) => ({
		label: `原著 · ${block.event.title}`,
		tokens: estimator(block.text),
		source: {
			kind: "canon",
			bookId: book.id,
			eventId: block.event.id,
			chapterOrdinal: block.event.chapterOrdinal,
		},
	}));
	return {
		book,
		binding: resolved.binding,
		current,
		upcoming,
		text: parts.join("\n"),
		items,
		source: `canon_window:当前「${current.event.title}」${upcoming.length === 0 ? "" : `，接下来 ${upcoming.length} 件`}`,
	};
}

/** 扮演原著人物时的玩家角色资料：底色随游标章节动态解锁。 */
export function renderCanonPlayerPersona(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
): { readonly text: string; readonly source: ContextItemSource } | null {
	const binding = store.getStoryCanonBinding(storyId);
	if (binding === null || binding.identityKind !== "canon") return null;
	const resolved = resolveCanonCursor(store, storyId, nodeId);
	const chapter = resolved?.chapterOrdinal ?? binding.startChapterOrdinal;
	const entity = store
		.listCanonCompiledEntities(binding.bookId)
		.find((item) => item.name === binding.playerEntityName);
	const page =
		entity === undefined ? null : sliceCanonEntityPage(entity, chapter);
	const lead = page?.lead ?? binding.playerPage?.lead ?? "";
	const base = page?.base ?? binding.playerPage?.base ?? "";
	const text = [`你扮演${binding.playerEntityName}。`, lead, base]
		.filter((part) => part.trim().length > 0)
		.join("\n");
	return {
		text,
		source: {
			kind: "canon",
			bookId: binding.bookId,
			eventId: resolved?.event.id ?? binding.startEventId,
			chapterOrdinal: chapter,
		},
	};
}
