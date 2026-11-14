import { assertPlainObject, isJsonObject, rejectUnknownKeys } from "../json.js";
import type { StoryStore } from "../store/story-store.js";

/** 人物档案的四个可更新字段；上次出场由在场记录派生，不单独写。 */
export const CHARACTER_PROFILE_FIELDS = [
	"want",
	"hide",
	"speech",
	"unresolved",
] as const;
export type CharacterProfileField = (typeof CHARACTER_PROFILE_FIELDS)[number];

/** 档案字段的中文说法；注入与界面共用一套措辞。 */
export const CHARACTER_PROFILE_FIELD_LABELS: Readonly<
	Record<CharacterProfileField, string>
> = {
	want: "想要",
	hide: "瞒着",
	speech: "说话样本",
	unresolved: "未了结",
};

/** 单个档案字段的字数上限。 */
export const CHARACTER_PROFILE_TEXT_LIMIT = 500;

/** 角色在之后某一场里被告知的方式：当面告知或听人转述。 */
export const SCENE_INFORMED_VIA = ["told", "relayed"] as const;
export type SceneInformedVia = (typeof SCENE_INFORMED_VIA)[number];

/** 一场归档里对某个人物档案的更新；没有变化的字段为 null。 */
export interface SceneProfileUpdate {
	readonly who: string;
	readonly want: string | null;
	readonly hide: string | null;
	readonly speech: string | null;
	readonly unresolved: string | null;
}

/** 这一场里某人得知以前某一场发生的事；`factId` 是那一场的结束楼层。 */
export interface SceneInformed {
	readonly who: string;
	readonly factId: string;
	readonly via: SceneInformedVia;
}

const PROFILE_UPDATE_KEYS = [
	"who",
	"want",
	"hide",
	"speech",
	"unresolved",
] as const;

const INFORMED_KEYS = ["who", "factId", "via"] as const;

export function isSceneInformedVia(value: unknown): value is SceneInformedVia {
	return (
		typeof value === "string" &&
		(SCENE_INFORMED_VIA as readonly string[]).includes(value)
	);
}

function requireNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}

function readProfileText(value: unknown, label: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串或 null`);
	}
	const text = value.trim();
	if (text.length === 0) {
		throw new Error(`${label} 不能是空字符串；没有内容时写 null`);
	}
	if (text.length > CHARACTER_PROFILE_TEXT_LIMIT) {
		throw new Error(
			`${label} 不能超过 ${CHARACTER_PROFILE_TEXT_LIMIT} 字，收到 ${text.length} 字`,
		);
	}
	return text;
}

/** 校验归档里的一条人物档案更新。 */
export function assertSceneProfileUpdate(
	value: unknown,
	label: string,
): SceneProfileUpdate {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, PROFILE_UPDATE_KEYS, label);
	const update: SceneProfileUpdate = {
		who: requireNonEmptyString(record.who, `${label}.who`),
		want: readProfileText(record.want, `${label}.want`),
		hide: readProfileText(record.hide, `${label}.hide`),
		speech: readProfileText(record.speech, `${label}.speech`),
		unresolved: readProfileText(record.unresolved, `${label}.unresolved`),
	};
	if (
		update.want === null &&
		update.hide === null &&
		update.speech === null &&
		update.unresolved === null
	) {
		throw new Error(`${label} 至少要有一个字段有内容`);
	}
	return update;
}

/** 校验一组档案更新；同一个人在同一场里只能出现一次。 */
export function assertSceneProfileUpdates(
	value: unknown,
	label: string,
): readonly SceneProfileUpdate[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	const seen = new Set<string>();
	const updates: SceneProfileUpdate[] = [];
	for (const [index, item] of value.entries()) {
		const update = assertSceneProfileUpdate(item, `${label}[${index}]`);
		if (seen.has(update.who)) {
			throw new Error(`${label} 里的人物重复：${update.who}`);
		}
		seen.add(update.who);
		updates.push(update);
	}
	return updates;
}

/** 校验归档里的一条知情记录。 */
export function assertSceneInformed(
	value: unknown,
	label: string,
): SceneInformed {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, INFORMED_KEYS, label);
	if (!isSceneInformedVia(record.via)) {
		throw new Error(
			`${label}.via 只能是 ${SCENE_INFORMED_VIA.join(" 或 ")}，收到 ${JSON.stringify(record.via)}`,
		);
	}
	return {
		who: requireNonEmptyString(record.who, `${label}.who`),
		factId: requireNonEmptyString(record.factId, `${label}.factId`),
		via: record.via,
	};
}

/** 校验一组知情记录；同一个人对同一场的记录只能有一条。 */
export function assertSceneInformedList(
	value: unknown,
	label: string,
): readonly SceneInformed[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	const seen = new Set<string>();
	const entries: SceneInformed[] = [];
	for (const [index, item] of value.entries()) {
		const entry = assertSceneInformed(item, `${label}[${index}]`);
		const key = `${entry.who}\u0000${entry.factId}`;
		if (seen.has(key)) {
			throw new Error(`${label} 里的记录重复：${entry.who} 对 ${entry.factId}`);
		}
		seen.add(key);
		entries.push(entry);
	}
	return entries;
}

/** 档案更新与知情记录只能指向这一场的在场者。 */
export function assertSceneArchiveLinks(
	present: readonly string[],
	profiles: readonly SceneProfileUpdate[],
	informed: readonly SceneInformed[],
	label: string,
): void {
	const names = new Set(present);
	for (const update of profiles) {
		if (!names.has(update.who)) {
			throw new Error(
				`${label}.profiles 里的人物不在这场：${update.who}；在场者为 ${present.join("、")}`,
			);
		}
	}
	for (const entry of informed) {
		if (!names.has(entry.who)) {
			throw new Error(
				`${label}.informed 里的人物不在这场：${entry.who}；在场者为 ${present.join("、")}`,
			);
		}
	}
}

/** 读取时只依赖场次归档的这些字段，避免读写两侧互相引用。 */
export interface ProfileSceneArchive {
	readonly endNodeId: string;
	readonly startNodeId: string;
	readonly summary: string;
	readonly present: readonly string[];
	readonly cluesOpened: readonly string[];
	readonly profiles: readonly SceneProfileUpdate[];
	readonly informed: readonly SceneInformed[];
}

export interface CharacterProfileScene {
	readonly endNodeId: string;
	readonly startNodeId: string;
}

/** 一条带出处场次的档案内容。 */
export interface CharacterProfileNote {
	readonly field: CharacterProfileField;
	readonly text: string;
	readonly sceneEndNodeId: string;
	readonly sceneStartNodeId: string;
}

/** 一个人物沿当前路径累加出的档案。 */
export interface CharacterProfile {
	readonly who: string;
	readonly notes: readonly CharacterProfileNote[];
	readonly lastScene: CharacterProfileScene | null;
}

interface ProfileAccumulator {
	readonly notes: CharacterProfileNote[];
	lastScene: CharacterProfileScene | null;
}

/**
 * 按路径顺序累加场次归档里的人物档案；分支切换后只保留当前分支上的场次。
 * 上次出场取最后一场该人物在场的归档。
 */
export function readCharacterProfiles(
	store: StoryStore,
	nodeId: string,
): readonly CharacterProfile[] {
	const archives = store.listSceneArchivesAlongPath(nodeId);
	const byWho = new Map<string, ProfileAccumulator>();
	const ensure = (who: string): ProfileAccumulator => {
		const existing = byWho.get(who);
		if (existing !== undefined) return existing;
		const created: ProfileAccumulator = { notes: [], lastScene: null };
		byWho.set(who, created);
		return created;
	};
	for (const archive of archives) {
		const scene = {
			endNodeId: archive.endNodeId,
			startNodeId: archive.startNodeId,
		};
		for (const who of archive.present) ensure(who).lastScene = scene;
		for (const update of archive.profiles) {
			const entry = ensure(update.who);
			for (const field of CHARACTER_PROFILE_FIELDS) {
				const text = update[field];
				if (text === null) continue;
				entry.notes.push({
					field,
					text,
					sceneEndNodeId: archive.endNodeId,
					sceneStartNodeId: archive.startNodeId,
				});
			}
		}
	}
	return [...byWho.entries()].map(([who, entry]) => ({
		who,
		notes: [...entry.notes],
		lastScene: entry.lastScene,
	}));
}

/** 一场里谁知道什么：`uninformed` 是既不在场、之后也没有被告知的人物。 */
export interface SceneKnowledgeFact {
	readonly endNodeId: string;
	readonly startNodeId: string;
	readonly summary: string;
	readonly present: readonly string[];
	readonly uninformed: readonly string[];
}

export interface SceneKnowledge {
	readonly cast: readonly string[];
	readonly facts: readonly SceneKnowledgeFact[];
}

function knowledgeKey(who: string, factId: string): string {
	return `${who}\u0000${factId}`;
}

/**
 * 知情由在场推导：在那一场里，或者之后某一场里被告知，才算知情。
 * 旧的 `knowledge` 事实也参与推导：`factId` 指向该场或其开出的线索，
 * 且写入位置不早于这一场，就算知道。
 */
export function readSceneKnowledge(
	store: StoryStore,
	nodeId: string,
): SceneKnowledge {
	const archives = store.listSceneArchivesAlongPath(nodeId);
	if (archives.length === 0) return { cast: [], facts: [] };
	const position = new Map(
		store.getPathToNode(nodeId).map((node, index) => [node.id, index]),
	);
	const cast: string[] = [];
	const seenCast = new Set<string>();
	for (const archive of archives) {
		for (const who of archive.present) {
			if (seenCast.has(who)) continue;
			seenCast.add(who);
			cast.push(who);
		}
	}
	const informed = new Set<string>();
	for (const archive of archives) {
		const archivePosition = position.get(archive.endNodeId);
		if (archivePosition === undefined) continue;
		for (const entry of archive.informed) {
			const factPosition = position.get(entry.factId);
			if (factPosition === undefined || factPosition > archivePosition) {
				continue;
			}
			informed.add(knowledgeKey(entry.who, entry.factId));
		}
	}
	const knownAt = readKnowledgePositions(store, nodeId, position);
	const facts: SceneKnowledgeFact[] = archives.map((archive) => {
		const archivePosition = position.get(archive.endNodeId) ?? -1;
		const present = new Set(archive.present);
		const uninformed = cast.filter((who) => {
			if (present.has(who)) return false;
			if (informed.has(knowledgeKey(who, archive.endNodeId))) return false;
			const sceneKnown = knownAt.get(knowledgeKey(who, archive.endNodeId));
			if (sceneKnown !== undefined && sceneKnown >= archivePosition)
				return false;
			for (const clueId of archive.cluesOpened) {
				const clueKnown = knownAt.get(knowledgeKey(who, clueId));
				if (clueKnown !== undefined && clueKnown >= archivePosition)
					return false;
			}
			return true;
		});
		return {
			endNodeId: archive.endNodeId,
			startNodeId: archive.startNodeId,
			summary: archive.summary,
			present: [...archive.present],
			uninformed,
		};
	});
	return { cast, facts };
}

/**
 * 旧的 `knowledge` 事实按楼层顺序叠加：条目 id 到 `factId` 的对应关系记在
 * 这里，删除时一并撤掉，位置用于判断得知发生在这一场之后。
 */
function readKnowledgePositions(
	store: StoryStore,
	nodeId: string,
	position: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
	const entryFacts = new Map<string, string>();
	const knownAt = new Map<string, number>();
	for (const diff of store.getStateDiffsAlongPath(nodeId)) {
		if (diff.path.length < 3 || diff.path[0] !== "knowledge") continue;
		const who = diff.path[1];
		const entryId = diff.path[2];
		if (typeof who !== "string" || typeof entryId !== "string") continue;
		const nodePosition = position.get(diff.nodeId);
		if (nodePosition === undefined) continue;
		const entryKey = `${who}\u0000${entryId}`;
		if (diff.op === "delete") {
			const factId = entryFacts.get(entryKey);
			entryFacts.delete(entryKey);
			if (factId !== undefined) knownAt.delete(knowledgeKey(who, factId));
			continue;
		}
		if (!isJsonObject(diff.value)) continue;
		const factId = diff.value.factId;
		if (typeof factId !== "string" || factId.length === 0) continue;
		entryFacts.set(entryKey, factId);
		knownAt.set(knowledgeKey(who, factId), nodePosition);
	}
	return knownAt;
}
