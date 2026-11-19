import { randomUUID } from "node:crypto";
import {
	type PlayerEdit,
	editState,
	readEffectiveEdits,
	stateTargetOf,
} from "../edits/index.js";
import { normalizeEntityName } from "../entity.js";
import { type JsonValue, isJsonObject } from "../json.js";
import { userWillStableId } from "../ledger/user-will.js";
import type { StoryStore } from "../store/story-store.js";
import type { StateDiff } from "../timeline.js";

/**
 * 记忆页与停靠栏读的视图。记录只追加；状态、秘密、百科页面都是从记录与
 * 台账算出来的投影，再叠上玩家在当前路径上的修改。
 */

const ENTITY_KIND_LABELS: Readonly<Record<string, string>> = {
	character: "人物",
	location: "地点",
	item: "物件",
	faction: "势力",
	lore: "设定",
	unknown: "其他",
};

/** 不当作状态项展示的台账命名空间：它们有自己的分页。 */
const NON_STATE_NAMESPACES = new Set(["userWill", "knowledge"]);

export interface MemoryRecord {
	readonly id: string;
	/** event 来自自动记录，fact 来自结算写入台账的事实，reflection 是章末反思。 */
	readonly kind: "event" | "fact" | "reflection";
	readonly nodeId: string;
	readonly floorNo: number;
	readonly text: string;
	readonly entities: readonly string[];
	readonly storyTime: string | null;
	readonly importance: number | null;
	/** 逐字出处；旧记录没有。 */
	readonly quote: string | null;
	readonly source: string;
}

export interface MemoryStateVersion {
	readonly value: JsonValue | null;
	readonly nodeId: string;
	readonly floorNo: number;
	readonly source: string;
}

export interface MemoryStateItem {
	readonly target: string;
	readonly path: readonly string[];
	readonly owner: string;
	readonly item: string;
	readonly value: JsonValue;
	readonly nodeId: string;
	readonly floorNo: number;
	readonly source: string;
	readonly locked: boolean;
	readonly history: readonly MemoryStateVersion[];
}

export interface MemorySecret {
	readonly id: string;
	readonly text: string;
	readonly knowers: readonly string[];
	readonly unaware: readonly string[];
	readonly nodeId: string | null;
	readonly floorNo: number | null;
	readonly locked: boolean;
	readonly edited: boolean;
}

export interface WikiStatement {
	readonly id: string;
	readonly text: string;
	readonly nodeId: string | null;
	readonly floorNo: number | null;
	readonly source: "auto" | "player";
	readonly locked: boolean;
	/** 旧说法：不删，只标出它到哪一楼为止有效。 */
	readonly old: boolean;
	readonly validUntilFloor: number | null;
	readonly quote: string | null;
}

export interface WikiPage {
	readonly id: string;
	readonly kind: string;
	readonly name: string;
	readonly aliases: readonly string[];
	readonly uptoFloor: number;
	readonly lead: string;
	readonly leadLocked: boolean;
	readonly sections: readonly {
		readonly title: string;
		readonly statements: readonly WikiStatement[];
	}[];
}

export interface MemoryTimelineScene {
	readonly id: string;
	readonly title: string;
	readonly floors: number;
	readonly summary: string;
	readonly present: readonly string[];
	readonly changes: readonly string[];
	readonly locked: boolean;
}

export interface MemoryPref {
	readonly id: string;
	readonly text: string;
	readonly kind: string;
	readonly origin: string;
	readonly disabled: boolean;
}

interface PathIndex {
	readonly nodeId: string;
	readonly floorOf: ReadonlyMap<string, number>;
	readonly rawOf: ReadonlyMap<string, string>;
}

function indexPath(store: StoryStore, nodeId: string): PathIndex {
	const path = store.getPathToNode(nodeId);
	return {
		nodeId,
		floorOf: new Map(path.map((node, index) => [node.id, index + 1] as const)),
		rawOf: new Map(path.map((node) => [node.id, node.raw] as const)),
	};
}

function requireAnchor(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
) {
	const anchor = nodeId ?? store.getHead(storyId)?.id ?? null;
	return anchor;
}

function show(value: unknown): string {
	if (typeof value === "string") return value;
	const text = JSON.stringify(value);
	return text === undefined ? "" : text;
}

/** 当前路径上的全部记录：自动记录的事件、结算写下的事实、章末反思。 */
export function readMemoryRecords(
	store: StoryStore,
	storyId: string,
	nodeId: string | null = null,
	limit = 400,
): MemoryRecord[] {
	const anchor = requireAnchor(store, storyId, nodeId);
	if (anchor === null) return [];
	const index = indexPath(store, anchor);
	const quotes = store.getMemoryEventQuotes(storyId);
	const records: MemoryRecord[] = [];
	for (const event of store.getEventsForPath(anchor, { limit: 1000 })) {
		records.push({
			id: event.id,
			kind: event.source === REFLECTION_EVENT_SOURCE ? "reflection" : "event",
			nodeId: event.sourceNodeId,
			floorNo: index.floorOf.get(event.sourceNodeId) ?? 0,
			text: event.text,
			entities: event.participants,
			storyTime: event.storyTime,
			importance: event.importance,
			quote: quotes.get(event.id) ?? null,
			source: event.source,
		});
	}
	for (const diff of store.getStateDiffsAlongPath(anchor)) {
		if (NON_STATE_NAMESPACES.has(diff.path[0] ?? "")) continue;
		records.push({
			id: `fact:${diff.id}`,
			kind: "fact",
			nodeId: diff.nodeId,
			floorNo: index.floorOf.get(diff.nodeId) ?? 0,
			text:
				diff.op === "delete"
					? `${diff.path.join(" · ")}：不再成立`
					: `${diff.path.join(" · ")}：${show(diff.value)}`,
			entities: diff.path.slice(1, 2),
			storyTime: diff.storyTime?.start ?? null,
			importance: null,
			quote: null,
			source: diff.source,
		});
	}
	records.sort((left, right) => left.floorNo - right.floorNo);
	return records.slice(-limit);
}

/** 章末反思以一条记录的形式追加；来源名用于在记录里认出它。 */
export const REFLECTION_EVENT_SOURCE = "reflection";

/** 追加一条章末反思；与其他记录一样不可改、不可删。 */
export function appendReflectionRecord(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	text: string,
): void {
	const trimmed = text.trim();
	if (trimmed.length === 0) return;
	store.insertMemoryEvents([
		{
			id: randomUUID(),
			storyId,
			sourceNodeId: nodeId,
			ordinal: 1000 + store.getEventsForPath(nodeId, { limit: 1000 }).length,
			participants: [],
			knowers: [],
			importance: 0.8,
			text: trimmed,
			source: REFLECTION_EVENT_SOURCE,
		},
	]);
}

/** 状态：每个键取当前路径上的最新值，历史按先后列出。 */
export function readMemoryState(
	store: StoryStore,
	storyId: string,
	nodeId: string | null = null,
): MemoryStateItem[] {
	const anchor = requireAnchor(store, storyId, nodeId);
	if (anchor === null) return [];
	const index = indexPath(store, anchor);
	const edits = readEffectiveEdits(store, storyId, anchor, "state");
	const byKey = new Map<string, StateDiff[]>();
	for (const diff of store.getStateDiffsAlongPath(anchor)) {
		if (NON_STATE_NAMESPACES.has(diff.path[0] ?? "")) continue;
		const key = stateTargetOf(diff.path);
		const list = byKey.get(key);
		if (list === undefined) byKey.set(key, [diff]);
		else list.push(diff);
	}
	const items: MemoryStateItem[] = [];
	for (const [target, diffs] of byKey) {
		const latest = diffs[diffs.length - 1];
		if (latest === undefined || latest.op === "delete") continue;
		const path = latest.path;
		items.push({
			target,
			path,
			owner: path.slice(0, -1).join(" · ") || (path[0] ?? ""),
			item: path[path.length - 1] ?? "",
			value: latest.value as JsonValue,
			nodeId: latest.nodeId,
			floorNo: index.floorOf.get(latest.nodeId) ?? 0,
			source: latest.source,
			locked: edits.get(target)?.locked === true,
			history: diffs.map((diff) => ({
				value: diff.op === "delete" ? null : (diff.value as JsonValue),
				nodeId: diff.nodeId,
				floorNo: index.floorOf.get(diff.nodeId) ?? 0,
				source: diff.source,
			})),
		});
	}
	items.sort((left, right) =>
		left.owner === right.owner
			? left.item.localeCompare(right.item)
			: left.owner.localeCompare(right.owner),
	);
	return items;
}

function readNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

/**
 * 秘密：自动记录标出知情者的事件。在场即知道；其余出场过的人物列为不知道；
 * 台账里记了「某人得知某事」之后，那个人移到知道的一边。
 */
export function readMemorySecrets(
	store: StoryStore,
	storyId: string,
	nodeId: string | null = null,
): MemorySecret[] {
	const anchor = requireAnchor(store, storyId, nodeId);
	const edits = readEffectiveEdits(store, storyId, anchor, "secret");
	const secrets: MemorySecret[] = [];
	const seen = new Set<string>();
	if (anchor !== null) {
		const index = indexPath(store, anchor);
		const events = store.getEventsForPath(anchor, { limit: 1000 });
		const cast = new Set<string>();
		for (const event of events) {
			for (const name of event.participants) cast.add(name);
			for (const name of event.knowers) if (name !== "*") cast.add(name);
		}
		const told = new Map<string, Set<string>>();
		const knowledge = store.getStateSnapshot(anchor).state as unknown;
		const table = isJsonObject(knowledge) ? knowledge.knowledge : undefined;
		if (isJsonObject(table)) {
			for (const [knower, entries] of Object.entries(table)) {
				if (!isJsonObject(entries)) continue;
				for (const entry of Object.values(entries)) {
					if (!isJsonObject(entry) || typeof entry.factId !== "string")
						continue;
					const set = told.get(entry.factId) ?? new Set<string>();
					set.add(knower);
					told.set(entry.factId, set);
				}
			}
		}
		for (const event of events) {
			if (event.knowers.length === 0 || event.knowers.includes("*")) continue;
			const knowers = new Set([...event.knowers, ...event.participants]);
			for (const name of told.get(event.id) ?? []) knowers.add(name);
			const unaware = [...cast].filter((name) => !knowers.has(name));
			if (unaware.length === 0) continue;
			seen.add(event.id);
			const edit = edits.get(event.id);
			if (edit?.disabled === true) continue;
			const override = isJsonObject(edit?.value) ? edit.value : null;
			secrets.push({
				id: event.id,
				text: typeof override?.text === "string" ? override.text : event.text,
				knowers:
					override?.knowers !== undefined
						? readNames(override.knowers)
						: [...knowers],
				unaware:
					override?.unaware !== undefined
						? readNames(override.unaware)
						: unaware,
				nodeId: event.sourceNodeId,
				floorNo: index.floorOf.get(event.sourceNodeId) ?? null,
				locked: edit?.locked === true,
				edited: override !== null,
			});
		}
	}
	// 玩家自己加的秘密没有对应的事件，只存在于修改表里。
	for (const [target, edit] of edits) {
		if (seen.has(target) || edit.disabled || !isJsonObject(edit.value))
			continue;
		if (typeof edit.value.text !== "string") continue;
		secrets.push({
			id: target,
			text: edit.value.text,
			knowers: readNames(edit.value.knowers),
			unaware: readNames(edit.value.unaware),
			nodeId: edit.nodeId,
			floorNo: null,
			locked: edit.locked,
			edited: true,
		});
	}
	return secrets;
}

function applyStatementEdit(
	pageId: string,
	statement: WikiStatement,
	edits: ReadonlyMap<string, PlayerEdit>,
): WikiStatement | null {
	const edit = edits.get(`${pageId}|${statement.id}`);
	if (edit === undefined) return statement;
	if (edit.disabled) return null;
	const text =
		isJsonObject(edit.value) && typeof edit.value.text === "string"
			? edit.value.text
			: null;
	return {
		...statement,
		text: text ?? statement.text,
		source: text === null ? statement.source : "player",
		locked: edit.locked,
	};
}

/**
 * 百科页面：每个实体一页，由记录汇编。每句话带着它出自哪一楼；被新值取代的
 * 旧说法留在「演变」里并标出有效范围。玩家改过或锁定的句子在重新汇编后不变。
 */
export function compileWikiPages(
	store: StoryStore,
	storyId: string,
	nodeId: string | null = null,
): WikiPage[] {
	const anchor = requireAnchor(store, storyId, nodeId);
	if (anchor === null) return [];
	const index = indexPath(store, anchor);
	const edits = readEffectiveEdits(store, storyId, anchor, "wiki");
	const quotes = store.getMemoryEventQuotes(storyId);
	const events = store.getEventsForPath(anchor, { limit: 1000 });
	const state = readMemoryState(store, storyId, anchor);
	const pages: WikiPage[] = [];
	for (const entity of store.listEntities(storyId)) {
		const names = new Set(
			[entity.name, ...entity.aliases].map((name) => normalizeEntityName(name)),
		);
		const mentions = (text: string): boolean => {
			const normalized = normalizeEntityName(text);
			for (const name of names) {
				if (name.length > 0 && normalized.includes(name)) return true;
			}
			return false;
		};
		const now: WikiStatement[] = [];
		const past: WikiStatement[] = [];
		for (const item of state) {
			if (
				!item.path
					.slice(0, -1)
					.some((segment) => names.has(normalizeEntityName(segment)))
			) {
				continue;
			}
			now.push({
				id: `state:${item.target}`,
				text: `${item.item}：${show(item.value)}`,
				nodeId: item.nodeId,
				floorNo: item.floorNo,
				source: item.source === "player" ? "player" : "auto",
				locked: item.locked,
				old: false,
				validUntilFloor: null,
				quote: null,
			});
			item.history.slice(0, -1).forEach((version, position) => {
				if (version.value === null) return;
				const next = item.history[position + 1];
				past.push({
					id: `state:${item.target}@${position}`,
					text: `${item.item}：${show(version.value)}`,
					nodeId: version.nodeId,
					floorNo: version.floorNo,
					source: version.source === "player" ? "player" : "auto",
					locked: false,
					old: true,
					validUntilFloor: next?.floorNo ?? null,
					quote: null,
				});
			});
		}
		const course: WikiStatement[] = [];
		const reflections: WikiStatement[] = [];
		for (const event of events) {
			const involved =
				event.participants.some((name) =>
					names.has(normalizeEntityName(name)),
				) || mentions(event.text);
			if (!involved) continue;
			const statement: WikiStatement = {
				id: `event:${event.id}`,
				text: event.text,
				nodeId: event.sourceNodeId,
				floorNo: index.floorOf.get(event.sourceNodeId) ?? null,
				source: "auto",
				locked: false,
				old: false,
				validUntilFloor: null,
				quote: quotes.get(event.id) ?? null,
			};
			if (event.source === REFLECTION_EVENT_SOURCE) reflections.push(statement);
			else course.push(statement);
		}
		const sections = [
			{ title: "现在", statements: now },
			{ title: "经过", statements: course },
			{ title: "演变", statements: past },
			{ title: "反思", statements: reflections },
		]
			.map((section) => ({
				title: section.title,
				statements: section.statements
					.map((statement) => applyStatementEdit(entity.id, statement, edits))
					.filter(
						(statement): statement is WikiStatement => statement !== null,
					),
			}))
			.filter((section) => section.statements.length > 0);
		if (sections.length === 0 && entity.description.trim().length === 0)
			continue;
		const leadEdit = edits.get(`${entity.id}|lead`);
		const lead =
			isJsonObject(leadEdit?.value) && typeof leadEdit.value.text === "string"
				? leadEdit.value.text
				: entity.description;
		let upto = 0;
		for (const section of sections) {
			for (const statement of section.statements) {
				upto = Math.max(upto, statement.floorNo ?? 0);
			}
		}
		pages.push({
			id: entity.id,
			kind: ENTITY_KIND_LABELS[entity.kind] ?? "其他",
			name: entity.name,
			aliases: entity.aliases,
			uptoFloor: upto,
			lead,
			leadLocked: leadEdit?.locked === true,
			sections,
		});
	}
	return pages;
}

/** 时间线：当前路径上每一场的摘要；玩家改过的摘要以修改为准。 */
export function readMemoryTimeline(
	store: StoryStore,
	storyId: string,
	nodeId: string | null = null,
): MemoryTimelineScene[] {
	const anchor = requireAnchor(store, storyId, nodeId);
	if (anchor === null) return [];
	const edits = readEffectiveEdits(store, storyId, anchor, "summary");
	return store.listSceneArchivesAlongPath(anchor).map((archive, position) => {
		const edit = edits.get(archive.endNodeId);
		const override =
			isJsonObject(edit?.value) && typeof edit.value.text === "string"
				? edit.value.text
				: null;
		return {
			id: archive.endNodeId,
			title: `第 ${position + 1} 场`,
			floors: archive.floorCount,
			summary: override ?? archive.summary,
			present: archive.present,
			changes: archive.stateChanges.map(
				(change) => `${change.path.join(" · ")}：${change.change}`,
			),
			locked: edit?.locked === true,
		};
	});
}

const USER_WILL_KIND_LABELS: Readonly<Record<string, string>> = {
	preference: "你的偏好",
	boundary: "你的底线",
	correction: "你纠正过",
};

/** 偏好：台账里的用户意志；停用的条目从台账移除，但留在修改表里可以恢复。 */
export function readMemoryPrefs(
	store: StoryStore,
	storyId: string,
	nodeId: string | null = null,
): MemoryPref[] {
	const anchor = requireAnchor(store, storyId, nodeId);
	if (anchor === null) return [];
	const index = indexPath(store, anchor);
	const prefs: MemoryPref[] = [];
	const active = new Set<string>();
	const state = store.getStateSnapshot(anchor).state as unknown;
	const wills = isJsonObject(state) ? state.userWill : undefined;
	if (isJsonObject(wills)) {
		for (const [id, entry] of Object.entries(wills)) {
			if (!isJsonObject(entry) || typeof entry.text !== "string") continue;
			active.add(id);
			const floor =
				typeof entry.sourceNodeId === "string"
					? index.floorOf.get(entry.sourceNodeId)
					: undefined;
			const kind = typeof entry.kind === "string" ? entry.kind : "correction";
			prefs.push({
				id,
				text: entry.text,
				kind,
				origin: `${USER_WILL_KIND_LABELS[kind] ?? "偏好"}${floor === undefined ? "" : ` · 第 ${floor} 楼`}`,
				disabled: false,
			});
		}
	}
	for (const [target, edit] of readEffectiveEdits(
		store,
		storyId,
		anchor,
		"pref",
	)) {
		if (active.has(target) || !edit.disabled || !isJsonObject(edit.value))
			continue;
		if (typeof edit.value.text !== "string") continue;
		prefs.push({
			id: target,
			text: edit.value.text,
			kind:
				typeof edit.value.kind === "string" ? edit.value.kind : "correction",
			origin: "已停用",
			disabled: true,
		});
	}
	return prefs;
}

/** 加一条、改一条、停用或恢复一条偏好。偏好始终带入上下文，所以直接写台账。 */
export function writeMemoryPref(
	store: StoryStore,
	storyId: string,
	input: { id?: string; text?: string; disabled?: boolean },
): void {
	const anchor = store.getHead(storyId)?.id ?? null;
	if (anchor === null) throw new Error("故事还没有楼层，无法记录偏好");
	const state = store.getStateSnapshot(anchor).state as unknown;
	const wills =
		isJsonObject(state) && isJsonObject(state.userWill) ? state.userWill : {};
	const previous = readEffectiveEdits(store, storyId, anchor, "pref");
	const id = input.id ?? userWillStableId(input.text ?? "");
	const stored = isJsonObject(wills[id])
		? wills[id]
		: (previous.get(id)?.value ?? null);
	const base = isJsonObject(stored) ? stored : null;
	const text = input.text ?? (typeof base?.text === "string" ? base.text : "");
	if (text.trim().length === 0) throw new Error("偏好不能为空");
	const value = {
		kind: typeof base?.kind === "string" ? base.kind : "correction",
		text: text.trim(),
		sourceNodeId:
			typeof base?.sourceNodeId === "string" ? base.sourceNodeId : anchor,
		createdAt:
			typeof base?.createdAt === "string"
				? base.createdAt
				: new Date().toISOString(),
	};
	const disabled = input.disabled === true;
	editState(store, storyId, anchor, ["userWill", id], disabled ? null : value);
	store.savePlayerEdit({
		storyId,
		nodeId: anchor,
		kind: "pref",
		target: id,
		value,
		locked: true,
		disabled,
	});
}

/** 上下文里的一类：它占了多少 token，里面每一条来自哪里、去哪里改。 */
export interface ContextBreakdownCategory {
	readonly id: string;
	readonly label: string;
	readonly tokens: number;
	readonly items: readonly {
		readonly label: string;
		readonly tokens: number;
		readonly status: string;
		/** 去哪一页修改，以及那一页里的哪个分页或对象。 */
		readonly page: "memory" | "lore" | "play" | "outline" | "prefs";
		readonly tab: string | null;
	}[];
}

const CONTEXT_CATEGORIES: readonly {
	id: string;
	label: string;
	slots: readonly string[];
	page: "memory" | "lore" | "play" | "outline" | "prefs";
	tab: string | null;
}[] = [
	{
		id: "pref",
		label: "偏好",
		slots: ["user_will"],
		page: "memory",
		tab: "rule",
	},
	{
		id: "timeline",
		label: "时间线",
		slots: ["summary"],
		page: "memory",
		tab: "line",
	},
	{ id: "raw", label: "原文", slots: ["history"], page: "play", tab: null },
	{
		id: "state",
		label: "状态与秘密",
		slots: ["state", "scene", "scene_card"],
		page: "memory",
		tab: "state",
	},
	{
		id: "wiki",
		label: "百科",
		slots: ["memory", "profile", "reunion"],
		page: "memory",
		tab: "wiki",
	},
	{
		id: "lore",
		label: "设定",
		slots: ["lore", "character", "persona"],
		page: "lore",
		tab: null,
	},
	{
		id: "director",
		label: "导演与大纲",
		slots: ["director", "blueprint"],
		page: "outline",
		tab: null,
	},
];

/** 某一楼生成时模型实际看到的内容，按类别给出大小与每一条的来源。 */
export function readContextBreakdown(
	store: StoryStore,
	nodeId: string,
): {
	nodeId: string;
	totalTokens: number;
	budgetTokens: number;
	categories: ContextBreakdownCategory[];
} | null {
	const trace = store.getTurnTrace(nodeId);
	if (trace === null) return null;
	const categories = new Map<
		string,
		ContextBreakdownCategory & {
			items: ContextBreakdownCategory["items"][number][];
		}
	>();
	const other = {
		id: "other",
		label: "写作要求与其他",
		page: "prefs" as const,
		tab: "write",
	};
	for (const entry of trace.context.entries) {
		if (entry.status !== "included") continue;
		const category =
			CONTEXT_CATEGORIES.find(
				(item) => entry.slot !== null && item.slots.includes(entry.slot),
			) ?? other;
		let bucket = categories.get(category.id);
		if (bucket === undefined) {
			bucket = { id: category.id, label: category.label, tokens: 0, items: [] };
			categories.set(category.id, bucket);
		}
		(bucket as { tokens: number }).tokens += entry.tokens;
		bucket.items.push({
			label:
				entry.slot === null ? entry.source : `${entry.slot} · ${entry.source}`,
			tokens: entry.tokens,
			status: entry.status,
			page: category.page,
			tab: category.tab,
		});
	}
	return {
		nodeId,
		totalTokens: trace.context.totalTokens,
		budgetTokens: trace.context.budgetTokens,
		categories: [...categories.values()],
	};
}
