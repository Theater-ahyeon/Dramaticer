import { normalizeEntityName } from "../entity.js";
import { isJsonObject } from "../json.js";
import type { StoryStore } from "../store/story-store.js";
import {
	type CharacterProfileField,
	type CharacterProfileNote,
	readCharacterProfiles,
} from "./character-profile.js";
import { readLedger } from "./read.js";

/** 重逢档案覆盖的实体种类。 */
export const REUNION_ENTITY_KINDS = ["character", "place", "item"] as const;
export type ReunionEntityKind = (typeof REUNION_ENTITY_KINDS)[number];

/** 注入时的种类说法；界面与提示词共用。 */
export const REUNION_KIND_LABELS: Readonly<Record<ReunionEntityKind, string>> =
	{
		character: "人物",
		place: "地点",
		item: "物品",
	};

/** 判定「最近窗口」的默认楼数，与默认历史窗口一致。 */
export const DEFAULT_REUNION_RECENT_FLOORS = 20;

/** 注入时最多列出的未了结事项条数。 */
export const DEFAULT_REUNION_UNRESOLVED_LIMIT = 3;

/** 注入时最多列出的关系条数。 */
export const DEFAULT_REUNION_RELATION_LIMIT = 3;

/** 档案摘要与描述注入时的截断长度。 */
export const REUNION_TEXT_CLIP = 80;

interface ReunionSceneRow {
	readonly endNodeId: string;
	readonly startNodeId: string;
	readonly summary: string;
	readonly present: readonly string[];
	readonly stateChanges: readonly { path: readonly string[]; change: string }[];
}

export interface ReunionScene {
	readonly endNodeId: string;
	readonly startNodeId: string;
	readonly summary: string;
}

export interface ReunionUnresolved {
	readonly text: string;
	readonly sceneEndNodeId: string;
}

/** 一个久未出场、现在被提到的实体及其档案。全部来自场次归档与台账。 */
export interface ReunionCandidate {
	readonly kind: ReunionEntityKind;
	readonly name: string;
	/** 名称与别名；触发与「最近窗口」判定都按规范化后的全文匹配。 */
	readonly aliases: readonly string[];
	readonly lastScene: ReunionScene;
	/** 人物：上次出场那一场结束时与别人的关系；其余种类为 null。 */
	readonly relation: string | null;
	/** 人物：档案里还没了结的事，最新在前保留到上限。 */
	readonly unresolved: readonly ReunionUnresolved[];
	/** 地点与物品：上一次出入时归档记下的变化。 */
	readonly change: string | null;
	/** 地点描述或物品当前持有人与位置。 */
	readonly description: string | null;
}

export interface ReunionMention {
	readonly candidate: ReunionCandidate;
	/** 命中触发文本的那个名字或别名。 */
	readonly matched: string;
}

export interface ReunionSelectionInput {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly nodeId: string;
	/** 本轮玩家消息与导演建议拼起来的文本。 */
	readonly triggerText: string;
	/** 「最近窗口」的楼数，默认与默认历史窗口一致。 */
	readonly recentFloors?: number;
}

interface AliasEntry {
	readonly kind: ReunionEntityKind;
	readonly names: readonly {
		readonly text: string;
		readonly normalized: string;
	}[];
}

const CHARACTER_ENTITY_KIND = "character";
const PLACE_ENTITY_KIND = "location";
const ITEM_ENTITY_KIND = "item";

function readAliasIndex(
	store: StoryStore,
	storyId: string,
): ReadonlyMap<string, AliasEntry> {
	const index = new Map<string, AliasEntry>();
	for (const entity of store.listEntities(storyId)) {
		const kind =
			entity.kind === PLACE_ENTITY_KIND
				? "place"
				: entity.kind === ITEM_ENTITY_KIND
					? "item"
					: entity.kind === CHARACTER_ENTITY_KIND
						? "character"
						: null;
		if (kind === null) continue;
		const names: { text: string; normalized: string }[] = [];
		const seen = new Set<string>();
		for (const value of [entity.name, ...entity.aliases]) {
			const normalized = normalizeEntityName(value);
			if (normalized.length === 0 || seen.has(normalized)) continue;
			seen.add(normalized);
			names.push({ text: value, normalized });
		}
		if (names.length === 0) continue;
		index.set(`${kind}\u0000${normalizeEntityName(entity.name)}`, {
			kind,
			names,
		});
	}
	return index;
}

/** 台账与归档里的实体 id 用实体名或别名对上实体；对不上时只用 id 本身。 */
function aliasesOf(
	index: ReadonlyMap<string, AliasEntry>,
	kind: ReunionEntityKind,
	name: string,
): readonly string[] {
	const normalized = normalizeEntityName(name);
	const entry = index.get(`${kind}\u0000${normalized}`);
	if (entry !== undefined) return entry.names.map((item) => item.text);
	return [name];
}

function clipReunionText(text: string, limit = REUNION_TEXT_CLIP): string {
	const compact = text.replace(/\s+/g, " ").trim();
	if (compact.length <= limit) return compact;
	return `${compact.slice(0, limit)}…`;
}

function formatRelationSide(value: unknown): string[] {
	if (!isJsonObject(value)) return [];
	const parts: string[] = [];
	for (const field of ["type", "stage", "turningPoint"] as const) {
		const text = value[field];
		if (typeof text === "string" && text.trim().length > 0) {
			parts.push(text.trim());
		}
	}
	for (const field of ["affectionOuter", "affectionInner"] as const) {
		const text = value[field];
		if (typeof text === "string" && text.trim().length > 0) {
			parts.push(text.trim());
		}
	}
	return parts;
}

/** 某个楼层末端的台账里与这个人物有关的关系，取模板里的前几条。 */
function readRelationText(
	store: StoryStore,
	nodeId: string,
	who: string,
): string | null {
	const relations = readLedger(store, nodeId, ["relation"]);
	if (!isJsonObject(relations)) return null;
	const lines: string[] = [];
	for (const [from, targets] of Object.entries(relations)) {
		if (!isJsonObject(targets)) continue;
		for (const [to, value] of Object.entries(targets)) {
			if (from !== who && to !== who) continue;
			const parts = formatRelationSide(value);
			if (parts.length === 0) continue;
			lines.push(`${from}→${to}：${parts.join("、")}`);
			if (lines.length >= DEFAULT_REUNION_RELATION_LIMIT)
				return lines.join("；");
		}
	}
	return lines.length === 0 ? null : lines.join("；");
}

function unresolvedOf(
	notes: readonly CharacterProfileNote[],
	limit: number,
): readonly ReunionUnresolved[] {
	const field: CharacterProfileField = "unresolved";
	const entries: ReunionUnresolved[] = [];
	const seen = new Set<string>();
	for (const note of notes) {
		if (note.field !== field) continue;
		if (seen.has(note.text)) continue;
		seen.add(note.text);
		entries.push({
			text: note.text,
			sceneEndNodeId: note.sceneEndNodeId,
		});
	}
	return entries.slice(-limit);
}

/** 从后往前找最后一场动过这条台账路径的归档。 */
function findLastSceneForPath(
	archives: readonly ReunionSceneRow[],
	path: readonly string[],
): { archive: ReunionSceneRow; change: string } | null {
	for (let index = archives.length - 1; index >= 0; index -= 1) {
		const archive = archives[index];
		if (archive === undefined) continue;
		for (const entry of archive.stateChanges) {
			if (entry.path.length < path.length) continue;
			if (!path.every((segment, offset) => entry.path[offset] === segment)) {
				continue;
			}
			return { archive, change: entry.change };
		}
	}
	return null;
}

function readCharacterCandidates(
	store: StoryStore,
	nodeId: string,
	archives: readonly ReunionSceneRow[],
	index: ReadonlyMap<string, AliasEntry>,
	unresolvedLimit: number,
): readonly ReunionCandidate[] {
	const byEnd = new Map(
		archives.map((archive) => [archive.endNodeId, archive]),
	);
	const candidates: ReunionCandidate[] = [];
	for (const profile of readCharacterProfiles(store, nodeId)) {
		const lastScene = profile.lastScene;
		if (lastScene === null) continue;
		const archive = byEnd.get(lastScene.endNodeId);
		candidates.push({
			kind: "character",
			name: profile.who,
			aliases: aliasesOf(index, "character", profile.who),
			lastScene: {
				endNodeId: lastScene.endNodeId,
				startNodeId: lastScene.startNodeId,
				summary: archive?.summary ?? "",
			},
			relation: readRelationText(store, lastScene.endNodeId, profile.who),
			unresolved: unresolvedOf(profile.notes, unresolvedLimit),
			change: null,
			description: null,
		});
	}
	return candidates;
}

function readPlaceCandidates(
	store: StoryStore,
	nodeId: string,
	archives: readonly ReunionSceneRow[],
	index: ReadonlyMap<string, AliasEntry>,
): readonly ReunionCandidate[] {
	const places = readLedger(store, nodeId, ["scene", "places"]);
	if (!isJsonObject(places)) return [];
	const current = readLedger(store, nodeId, ["scene", "current"]);
	const currentPlace =
		isJsonObject(current) && typeof current.place === "string"
			? current.place
			: null;
	const candidates: ReunionCandidate[] = [];
	for (const [id, value] of Object.entries(places)) {
		const scene = findLastSceneForPath(archives, ["scene", "places", id]);
		if (scene === null) continue;
		const description = isJsonObject(value) ? value.description : undefined;
		candidates.push({
			kind: "place",
			name: id,
			aliases: aliasesOf(index, "place", id),
			lastScene: {
				endNodeId: scene.archive.endNodeId,
				startNodeId: scene.archive.startNodeId,
				summary: scene.archive.summary,
			},
			relation: null,
			unresolved: [],
			change: scene.change,
			description:
				currentPlace === id
					? "当前就在这个地点"
					: typeof description === "string" && description.trim().length > 0
						? clipReunionText(description)
						: null,
		});
	}
	return candidates;
}

function readItemCandidates(
	store: StoryStore,
	nodeId: string,
	archives: readonly ReunionSceneRow[],
	index: ReadonlyMap<string, AliasEntry>,
): readonly ReunionCandidate[] {
	const items = readLedger(store, nodeId, ["item"]);
	if (!isJsonObject(items)) return [];
	const candidates: ReunionCandidate[] = [];
	for (const [id, value] of Object.entries(items)) {
		const scene = findLastSceneForPath(archives, ["item", id]);
		if (scene === null) continue;
		const details: string[] = [];
		if (isJsonObject(value)) {
			const holder = value.holder;
			if (typeof holder === "string" && holder.trim().length > 0) {
				details.push(`持有人 ${holder.trim()}`);
			}
			const location = value.location;
			if (typeof location === "string" && location.trim().length > 0) {
				details.push(`位置 ${location.trim()}`);
			}
		}
		candidates.push({
			kind: "item",
			name: id,
			aliases: aliasesOf(index, "item", id),
			lastScene: {
				endNodeId: scene.archive.endNodeId,
				startNodeId: scene.archive.startNodeId,
				summary: scene.archive.summary,
			},
			relation: null,
			unresolved: [],
			change: scene.change,
			description: details.length === 0 ? null : details.join("；"),
		});
	}
	return candidates;
}

/**
 * 读取当前路径上所有久未出场候选的档案：人物来自场次归档的档案，
 * 地点与物品来自台账以及归档里动过它们的那一场。不调用模型。
 */
export function readReunionCandidates(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	options: { readonly unresolvedLimit?: number } = {},
): readonly ReunionCandidate[] {
	const archives = store.listSceneArchivesAlongPath(nodeId);
	if (archives.length === 0) return [];
	const index = readAliasIndex(store, storyId);
	const unresolvedLimit =
		options.unresolvedLimit ?? DEFAULT_REUNION_UNRESOLVED_LIMIT;
	if (!Number.isInteger(unresolvedLimit) || unresolvedLimit < 1) {
		throw new Error("重逢注入的未了结条数上限必须是正整数");
	}
	return [
		...readCharacterCandidates(store, nodeId, archives, index, unresolvedLimit),
		...readPlaceCandidates(store, nodeId, archives, index),
		...readItemCandidates(store, nodeId, archives, index),
	];
}

/** 这一场还没结束时，场记给出的在场者；场次已结束或没有场记时为空。 */
function readPresentNames(
	store: StoryStore,
	nodeId: string,
): ReadonlySet<string> {
	const log = store.getLatestSceneLogOnPath(nodeId);
	if (log === null || log.sceneEnds) return new Set();
	return new Set(log.present);
}

function matchAlias(
	candidate: ReunionCandidate,
	triggerText: string,
): { matched: string; position: number } | null {
	let best: { matched: string; position: number } | null = null;
	for (const alias of candidate.aliases) {
		const normalized = normalizeEntityName(alias);
		if (normalized.length === 0) continue;
		const position = triggerText.indexOf(normalized);
		if (position < 0) continue;
		if (
			best === null ||
			normalized.length > normalizeEntityName(best.matched).length
		) {
			best = { matched: alias, position };
		}
	}
	return best;
}

const KIND_ORDER: Readonly<Record<ReunionEntityKind, number>> = {
	character: 0,
	place: 1,
	item: 2,
};

/**
 * 触发判断是纯程序：候选必须在最近窗口里完全不出现，且在当前触发文本里
 * 被名字或别名提到。返回按触发位置排序的命中项。
 */
export function selectReunionMentions(
	input: ReunionSelectionInput,
): readonly ReunionMention[] {
	const { store, storyId, nodeId } = input;
	if (typeof input.triggerText !== "string") {
		throw new Error("重逢注入的触发文本必须是字符串");
	}
	const recentFloors = input.recentFloors ?? DEFAULT_REUNION_RECENT_FLOORS;
	if (!Number.isInteger(recentFloors) || recentFloors < 1) {
		throw new Error("重逢注入的最近窗口楼数必须是正整数");
	}
	const triggerText = normalizeEntityName(input.triggerText);
	if (triggerText.length === 0) return [];
	const path = store.getPathToNode(nodeId);
	const recent = path
		.slice(0, -1)
		.slice(-recentFloors)
		.map((node) => node.raw)
		.join("\n");
	const recentText = normalizeEntityName(recent);
	const presentNow = readPresentNames(store, nodeId);
	const candidates = readReunionCandidates(store, storyId, nodeId);
	const seen = new Set<string>();
	const mentions: { mention: ReunionMention; position: number }[] = [];
	for (const candidate of candidates) {
		if (candidate.kind === "character" && presentNow.has(candidate.name)) {
			continue;
		}
		const appeared = candidate.aliases.some((alias) => {
			const normalized = normalizeEntityName(alias);
			return normalized.length > 0 && recentText.includes(normalized);
		});
		if (appeared) continue;
		const match = matchAlias(candidate, triggerText);
		if (match === null) continue;
		const key = `${candidate.kind}\u0000${normalizeEntityName(candidate.name)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		mentions.push({
			mention: { candidate, matched: match.matched },
			position: match.position,
		});
	}
	mentions.sort(
		(left, right) =>
			left.position - right.position ||
			KIND_ORDER[left.mention.candidate.kind] -
				KIND_ORDER[right.mention.candidate.kind],
	);
	return mentions.map((item) => item.mention);
}

/** 一条命中项写进提示词的一段文本。 */
export function formatReunionMention(mention: ReunionMention): string {
	const candidate = mention.candidate;
	const header = `${candidate.name}（${REUNION_KIND_LABELS[candidate.kind]}）`;
	const lines = [header];
	const summary =
		candidate.lastScene.summary.trim().length === 0
			? ""
			: `：${clipReunionText(candidate.lastScene.summary)}`;
	lines.push(
		`- 上次出场：场次 ${candidate.lastScene.endNodeId}（起于 ${candidate.lastScene.startNodeId}）${summary}`,
	);
	if (candidate.relation !== null) {
		lines.push(`- 当时的关系：${candidate.relation}`);
	}
	if (candidate.unresolved.length > 0) {
		lines.push(
			`- 未了结：${candidate.unresolved
				.map((item) => `${item.text}（场次 ${item.sceneEndNodeId}）`)
				.join("；")}`,
		);
	}
	if (candidate.change !== null) {
		lines.push(`- 最近变化：${clipReunionText(candidate.change)}`);
	}
	if (candidate.description !== null) {
		lines.push(`- 现在：${candidate.description}`);
	}
	return lines.join("\n");
}
