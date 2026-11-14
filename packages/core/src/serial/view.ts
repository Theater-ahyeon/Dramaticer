import {
	CHARACTER_PROFILE_FIELD_LABELS,
	type CharacterProfileField,
	type CharacterProfileScene,
	readCharacterProfiles,
	readSceneKnowledge,
} from "../ledger/character-profile.js";
import { listLedgerEntities, readLedger } from "../ledger/read.js";
import { type SceneBoundary, readSceneSegments } from "../ledger/scenes.js";
import type { AffectionLevel, CharacterTier } from "../ledger/schema.js";
import type { StoryStore } from "../store/story-store.js";

/** 前情提要覆盖的已归档场次数；最近几场就够玩家想起来停在哪里。 */
export const DEFAULT_SERIAL_RECAP_SCENES = 3;

/** 距上次游玩超过这个小时数就算「隔了一段时间」，界面据此展开前情提要。 */
export const DEFAULT_SERIAL_STALE_HOURS = 12;

const HOUR_MS = 60 * 60 * 1000;

/** 目录里的一场：派生区间加上归档与台账里的处境。 */
export interface SerialScene {
	/** 沿当前路径的场次序号，从 1 开始。 */
	readonly ordinal: number;
	readonly startNodeId: string;
	/** 这一场最后一楼；还没有结束时为 null。 */
	readonly endNodeId: string | null;
	readonly floorCount: number;
	readonly boundary: SceneBoundary | null;
	/** 归档摘要；没有归档时为 null。 */
	readonly summary: string | null;
	readonly present: readonly string[];
	readonly place: string | null;
	readonly storyTime: string | null;
}

/** 一章：由章末清点楼层收尾的一组场次；没有清点时全部场次属于仍在写的一章。 */
export interface SerialChapter {
	readonly ordinal: number;
	readonly startNodeId: string;
	/** 章末清点的楼层；这一章还没结束时为 null。 */
	readonly endNodeId: string | null;
	readonly floorCount: number;
	/** 属于这一章的场次序号，按路径顺序。 */
	readonly sceneOrdinals: readonly number[];
	/** 章末清点给下一章聚焦的线；没有清点时为空。 */
	readonly focusLineIds: readonly string[];
}

/** 人物关系页上的一条有方向的关系。 */
export interface SerialRelation {
	readonly from: string;
	readonly to: string;
	readonly type: string | null;
	readonly stage: string | null;
	readonly affectionInner: AffectionLevel | null;
	readonly affectionOuter: AffectionLevel | null;
}

/** 一条带出处场次的档案内容；标签是界面与注入共用的说法。 */
export interface SerialCharacterNote {
	readonly field: CharacterProfileField;
	readonly label: string;
	readonly text: string;
	readonly sceneEndNodeId: string;
	readonly sceneStartNodeId: string;
}

/** 此人不知道的一场：场次与它的摘要。 */
export interface SerialUninformedScene {
	readonly endNodeId: string;
	readonly startNodeId: string;
	readonly summary: string;
}

/** 人物关系页上的一个人：档案、台账状态、关系与不知情标注。 */
export interface SerialCharacter {
	readonly who: string;
	/** 是否在最近一次记录的场上：取最近一条场记，没有时取最后一场归档。 */
	readonly present: boolean;
	readonly tier: CharacterTier | null;
	readonly status: string | null;
	readonly location: string | null;
	readonly lastScene: CharacterProfileScene | null;
	readonly notes: readonly SerialCharacterNote[];
	readonly relations: readonly SerialRelation[];
	readonly uninformedScenes: readonly SerialUninformedScene[];
}

/** 时间线条目的来源：一场的开始与结束，或一次故事时间跳跃。 */
export type SerialTimelineKind = "scene" | "time";

export interface SerialTimelineEntry {
	readonly kind: SerialTimelineKind;
	/** 场次取结束楼层（未结束时取最后一楼），跳跃取写入时间的楼层。 */
	readonly nodeId: string;
	/** 楼层在当前路径上的序号，从 1 开始。 */
	readonly ordinal: number;
	readonly storyTime: string | null;
	readonly place: string | null;
	readonly summary: string | null;
}

/** 前情提要里的一场：只用已归档的摘要与当时的处境。 */
export interface SerialRecapScene {
	readonly endNodeId: string;
	readonly startNodeId: string;
	readonly summary: string;
	readonly present: readonly string[];
	readonly place: string | null;
	readonly storyTime: string | null;
}

export interface SerialRecap {
	/** 距上次游玩已超过阈值；界面据此决定是否展开前情提要。 */
	readonly stale: boolean;
	readonly staleHours: number;
	/** 当前路径最后一楼的时间；没有楼层时为 null。 */
	readonly lastPlayedAt: string | null;
	readonly scenes: readonly SerialRecapScene[];
}

/** 连载视图：前情提要、章节目录、人物关系页与时间线读同一份派生数据。 */
export interface SerialView {
	readonly storyId: string;
	/** 视图对应的楼层；故事没有楼层时为 null。 */
	readonly nodeId: string | null;
	/** 路径上的场次，序号与章节目录的 `sceneOrdinals` 对应。 */
	readonly scenes: readonly SerialScene[];
	readonly chapters: readonly SerialChapter[];
	readonly cast: readonly SerialCharacter[];
	readonly timeline: readonly SerialTimelineEntry[];
	readonly recap: SerialRecap;
}

export interface SerialViewOptions {
	/** 视图楼层；不设置时用当前 head。 */
	readonly nodeId?: string;
	/** 计算「隔了一段时间」的当前时间；测试传入固定值。 */
	readonly now?: Date;
	/** 前情提要覆盖的场次数；默认 3。 */
	readonly recapScenes?: number;
	/** 「隔了一段时间」的阈值小时数；默认 12。 */
	readonly staleHours?: number;
}

function readStringAt(
	store: StoryStore,
	nodeId: string,
	path: readonly string[],
): string | null {
	const value = readLedger(store, nodeId, path);
	if (value === undefined) return null;
	if (typeof value !== "string") {
		throw new Error(`台账路径 ${path.join(".")} 不是字符串：${String(value)}`);
	}
	return value;
}

function requirePositiveInteger(value: number, label: string): number {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${label}必须是正整数`);
	}
	return value;
}

/**
 * 读出连载视图。所有内容都从当前路径上的场次归档、场记、章末清点与台账
 * 派生，不调用模型、不写数据库；分支切换后只保留当前分支的数据。
 */
export function readSerialView(
	store: StoryStore,
	storyId: string,
	options: SerialViewOptions = {},
): SerialView {
	if (store.getStory(storyId) === null) {
		throw new Error(`故事不存在：${storyId}`);
	}
	const recapScenes = requirePositiveInteger(
		options.recapScenes ?? DEFAULT_SERIAL_RECAP_SCENES,
		"前情提要覆盖的场次数",
	);
	const staleHours = requirePositiveInteger(
		options.staleHours ?? DEFAULT_SERIAL_STALE_HOURS,
		"「隔了一段时间」的阈值小时数",
	);
	const head = store.getHead(storyId);
	const nodeId = options.nodeId ?? head?.id ?? null;
	if (nodeId === null) {
		return {
			storyId,
			nodeId: null,
			scenes: [],
			chapters: [],
			cast: [],
			timeline: [],
			recap: {
				stale: false,
				staleHours,
				lastPlayedAt: null,
				scenes: [],
			},
		};
	}
	const node = store.getNode(nodeId);
	if (node === null) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	if (node.storyId !== storyId) {
		throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	const path = store.getPathToNode(nodeId);
	const position = new Map(path.map((item, index) => [item.id, index]));
	const archives = store.listSceneArchivesAlongPath(nodeId);
	const archiveByEnd = new Map(
		archives.map((archive) => [archive.endNodeId, archive]),
	);
	const scenes = readSceneSegments(store, nodeId).map(
		(segment, index): SerialScene => {
			const archive =
				segment.endNodeId === null
					? undefined
					: archiveByEnd.get(segment.endNodeId);
			const anchor = segment.endNodeId ?? nodeId;
			const present =
				archive?.present ?? latestPresent(store, segment.floorIds) ?? [];
			return {
				ordinal: index + 1,
				startNodeId: segment.startNodeId,
				endNodeId: segment.endNodeId,
				floorCount: segment.floorIds.length,
				boundary: segment.boundary,
				summary: archive?.summary ?? null,
				present,
				place: readStringAt(store, anchor, ["scene", "current", "place"]),
				storyTime: readStringAt(store, anchor, ["time", "current"]),
			};
		},
	);
	const reviews = store.listDirectorChapterReviewsAlongPath(nodeId);
	const pathIds = path.map((item) => item.id);
	const chapters = buildChapters(scenes, reviews, position, pathIds, nodeId);
	const cast = buildCast(store, nodeId);
	const timeline = buildTimeline(store, nodeId, scenes, position);
	const lastPlayedAt = path[path.length - 1]?.createdAt ?? null;
	const archived = scenes.filter(
		(scene): scene is SerialScene & { endNodeId: string; summary: string } =>
			scene.endNodeId !== null && scene.summary !== null,
	);
	const recapSceneViews = archived.slice(-recapScenes).map(
		(scene): SerialRecapScene => ({
			endNodeId: scene.endNodeId,
			startNodeId: scene.startNodeId,
			summary: scene.summary,
			present: scene.present,
			place: scene.place,
			storyTime: scene.storyTime,
		}),
	);
	const now = options.now ?? new Date();
	const elapsed =
		lastPlayedAt === null ? 0 : now.getTime() - Date.parse(lastPlayedAt);
	return {
		storyId,
		nodeId,
		scenes,
		chapters,
		cast,
		timeline,
		recap: {
			stale: lastPlayedAt !== null && elapsed >= staleHours * HOUR_MS,
			staleHours,
			lastPlayedAt,
			scenes: recapSceneViews,
		},
	};
}

/** 这一场最近一条场记的在场名单；整场没有场记时返回 null。 */
function latestPresent(
	store: StoryStore,
	floorIds: readonly string[],
): readonly string[] | null {
	for (let index = floorIds.length - 1; index >= 0; index -= 1) {
		const floorId = floorIds[index];
		if (floorId === undefined) continue;
		const log = store.getSceneLog(floorId);
		if (log !== null) return log.present;
	}
	return null;
}

/** 每个章末清点的楼层收尾一章；剩下的场次属于还在写的一章。 */
function buildChapters(
	scenes: readonly SerialScene[],
	reviews: readonly {
		readonly nodeId: string;
		readonly payload: { readonly focus: readonly string[] };
	}[],
	position: ReadonlyMap<string, number>,
	pathIds: readonly string[],
	nodeId: string,
): SerialChapter[] {
	if (scenes.length === 0) return [];
	const reviewAt = new Map<number, { focus: readonly string[] }>();
	for (const review of reviews) {
		const index = position.get(review.nodeId);
		if (index === undefined) continue;
		reviewAt.set(index, { focus: review.payload.focus });
	}
	const reviewIndexes = [...reviewAt.keys()].sort(
		(left, right) => left - right,
	);
	let nextReview = 0;
	const chapters: SerialChapter[] = [];
	let current: {
		startNodeId: string;
		floorCount: number;
		sceneOrdinals: number[];
	} | null = null;
	const currentTail = nodeId;
	for (const scene of scenes) {
		const sceneEnd = scene.endNodeId ?? currentTail;
		const endIndex = position.get(sceneEnd) ?? 0;
		if (current === null) {
			current = {
				startNodeId: scene.startNodeId,
				floorCount: 0,
				sceneOrdinals: [],
			};
		}
		current.floorCount += scene.floorCount;
		current.sceneOrdinals.push(scene.ordinal);
		// 章末清点落在哪一场的范围内，这一章就收在那一场。
		const boundaryIndex = reviewIndexes[nextReview];
		if (boundaryIndex === undefined || endIndex < boundaryIndex) continue;
		nextReview += 1;
		const boundaryNodeId = pathIds[boundaryIndex];
		if (boundaryNodeId === undefined) continue;
		const review = reviewAt.get(boundaryIndex);
		chapters.push({
			ordinal: chapters.length + 1,
			startNodeId: current.startNodeId,
			endNodeId: boundaryNodeId,
			floorCount: current.floorCount,
			sceneOrdinals: current.sceneOrdinals,
			focusLineIds: review?.focus ?? [],
		});
		current = null;
	}
	if (current !== null) {
		chapters.push({
			ordinal: chapters.length + 1,
			startNodeId: current.startNodeId,
			endNodeId: null,
			floorCount: current.floorCount,
			sceneOrdinals: current.sceneOrdinals,
			focusLineIds: [],
		});
	}
	return chapters;
}

/**
 * 人物关系页的名单：档案里出现过的人、台账里建过档的人、关系两端的人都算。
 * 在场取最近一条场记，没有场记时取最后一场归档，与档案槽位同一口径。
 */
function buildCast(store: StoryStore, nodeId: string): SerialCharacter[] {
	const entities = listLedgerEntities(store, nodeId);
	const profiles = new Map(
		readCharacterProfiles(store, nodeId).map((profile) => [
			profile.who,
			profile,
		]),
	);
	const characters = new Map(
		entities.characters.map((character) => [character.id, character]),
	);
	const latestArchive = store.listSceneArchivesAlongPath(nodeId).at(-1) ?? null;
	const log = store.getLatestSceneLogOnPath(nodeId);
	const present = new Set(log?.present ?? latestArchive?.present ?? []);
	const knowledge = readSceneKnowledge(store, nodeId);
	const relationsByWho = new Map<string, SerialRelation[]>();
	const relations: SerialRelation[] = entities.relations.map((relation) => ({
		from: relation.from,
		to: relation.to,
		type: relation.type ?? null,
		stage: relation.stage ?? null,
		affectionInner: relation.affectionInner ?? null,
		affectionOuter: relation.affectionOuter ?? null,
	}));
	for (const relation of relations) {
		pushRelation(relationsByWho, relation.from, relation);
		pushRelation(relationsByWho, relation.to, relation);
	}
	const names = new Set<string>([
		...profiles.keys(),
		...characters.keys(),
		...relationsByWho.keys(),
	]);
	const uninformedByWho = new Map<string, SerialUninformedScene[]>();
	for (const fact of knowledge.facts) {
		for (const who of fact.uninformed) {
			const list = uninformedByWho.get(who) ?? [];
			list.push({
				endNodeId: fact.endNodeId,
				startNodeId: fact.startNodeId,
				summary: fact.summary,
			});
			uninformedByWho.set(who, list);
		}
	}
	const cast = [...names].map((who): SerialCharacter => {
		const profile = profiles.get(who);
		const character = characters.get(who);
		return {
			who,
			present: present.has(who),
			tier: character?.tier ?? null,
			status: character?.status ?? null,
			location: character?.location ?? null,
			lastScene: profile?.lastScene ?? null,
			notes:
				profile?.notes.map((note) => ({
					field: note.field,
					label: CHARACTER_PROFILE_FIELD_LABELS[note.field],
					text: note.text,
					sceneEndNodeId: note.sceneEndNodeId,
					sceneStartNodeId: note.sceneStartNodeId,
				})) ?? [],
			relations: relationsByWho.get(who) ?? [],
			uninformedScenes: uninformedByWho.get(who) ?? [],
		};
	});
	cast.sort((left, right) => {
		if (left.present !== right.present) return left.present ? -1 : 1;
		return left.who < right.who ? -1 : left.who > right.who ? 1 : 0;
	});
	return cast;
}

function pushRelation(
	byWho: Map<string, SerialRelation[]>,
	who: string,
	relation: SerialRelation,
): void {
	const list = byWho.get(who);
	if (list === undefined) byWho.set(who, [relation]);
	else list.push(relation);
}

/**
 * 时间线按路径顺序排：每一场一条（故事时间与地点取这一场结束时的台账），
 * 每次 `time.current` 写入再补一条跳跃。
 */
function buildTimeline(
	store: StoryStore,
	nodeId: string,
	scenes: readonly SerialScene[],
	position: ReadonlyMap<string, number>,
): SerialTimelineEntry[] {
	const entries: SerialTimelineEntry[] = [];
	for (const scene of scenes) {
		const anchor = scene.endNodeId ?? nodeId;
		const index = position.get(anchor);
		if (index === undefined) continue;
		entries.push({
			kind: "scene",
			nodeId: anchor,
			ordinal: index + 1,
			storyTime: scene.storyTime,
			place: scene.place,
			summary: scene.summary,
		});
	}
	const jumps = new Map<string, string | null>();
	for (const diff of store.getStateDiffsAlongPath(nodeId)) {
		if (diff.path.length !== 2) continue;
		if (diff.path[0] !== "time" || diff.path[1] !== "current") continue;
		if (diff.op !== "set") {
			jumps.delete(diff.nodeId);
			continue;
		}
		if (diff.source !== "player") continue;
		jumps.set(diff.nodeId, typeof diff.value === "string" ? diff.value : null);
	}
	// 场次结束时的那一条时间事实已经由场次条目表达，只补场次之间的跳跃。
	const anchors = new Set(entries.map((entry) => entry.nodeId));
	for (const [jumpNodeId, time] of jumps) {
		if (anchors.has(jumpNodeId)) continue;
		const index = position.get(jumpNodeId);
		if (index === undefined) continue;
		entries.push({
			kind: "time",
			nodeId: jumpNodeId,
			ordinal: index + 1,
			storyTime: time,
			place: null,
			summary: null,
		});
	}
	entries.sort((left, right) => left.ordinal - right.ordinal);
	return entries;
}
