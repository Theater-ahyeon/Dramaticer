import { type JsonObject, type JsonValue, isJsonObject } from "../json.js";
import { readStateValue } from "../state.js";
import type { StoryStore } from "../store/story-store.js";
import type { StateDiff, StoryTime } from "../timeline.js";
import {
	AFFECTION_LEVELS,
	type AffectionLevel,
	CHARACTER_TIERS,
	CLUE_STATUSES,
	type CharacterTier,
	type ClueStatus,
	LEDGER_SOURCES,
	type LedgerSource,
	isLedgerNamespace,
} from "./schema.js";

export interface LedgerCharacter {
	readonly id: string;
	readonly tier?: CharacterTier;
	readonly identity?: string;
	readonly appearance?: string;
	readonly outfit?: string;
	readonly status?: string;
	readonly location?: string;
}

export interface LedgerRelation {
	readonly from: string;
	readonly to: string;
	readonly type?: string;
	readonly stage?: string;
	readonly turningPoint?: string;
	readonly affectionInner?: AffectionLevel;
	readonly affectionOuter?: AffectionLevel;
	readonly inertia?: number;
}

export interface LedgerClue {
	readonly id: string;
	readonly text?: string;
	readonly status?: ClueStatus;
	readonly openedAt?: string;
	readonly updatedAt?: string;
}

export interface LedgerEntities {
	readonly characters: readonly LedgerCharacter[];
	readonly relations: readonly LedgerRelation[];
	readonly openClues: readonly LedgerClue[];
}

/** 一条仍然成立的台账事实，带来源、故事时间与写入楼层。 */
export interface LedgerFact {
	readonly path: readonly string[];
	readonly value: JsonValue;
	readonly storyTime: StoryTime | null;
	readonly source: LedgerSource;
	/** 最后写入这条事实的楼层；一致性探针按它计算事实的楼层年龄。 */
	readonly nodeId: string;
}

type LedgerStore = Pick<
	StoryStore,
	"getStateSnapshot" | "getStateDiffsAlongPath"
>;

/**
 * 读取某个楼层末端的台账快照；传入前缀时只返回该子树，路径不存在返回
 * undefined。读取复用状态快照缓存，不新增表。
 */
export function readLedger(
	store: LedgerStore,
	nodeId: string,
	prefix?: readonly string[],
): JsonValue | undefined {
	const state = store.getStateSnapshot(nodeId).state;
	if (prefix === undefined) return state;
	assertPrefix(prefix);
	return readStateValue(state, prefix) as JsonValue | undefined;
}

/**
 * 沿路径回放台账 diff，返回每条仍然成立的事实及其元数据。被删除的路径
 * 不出现；同一路径以最后一次写入为准。
 */
export function readLedgerFacts(
	store: LedgerStore,
	nodeId: string,
	prefix?: readonly string[],
): LedgerFact[] {
	if (prefix !== undefined) assertPrefix(prefix);
	const facts = new Map<string, LedgerFact>();
	for (const diff of store.getStateDiffsAlongPath(nodeId)) {
		if (!isLedgerNamespace(diff.path[0] ?? "")) continue;
		if (
			prefix !== undefined &&
			(diff.path.length < prefix.length ||
				!prefix.every((segment, index) => diff.path[index] === segment))
		) {
			continue;
		}
		const key = JSON.stringify(diff.path);
		if (diff.op === "delete") {
			facts.delete(key);
			continue;
		}
		facts.set(key, {
			path: diff.path,
			value: diff.value as JsonValue,
			storyTime: diff.storyTime,
			source: ledgerSourceOf(diff),
			nodeId: diff.nodeId,
		});
	}
	return [...facts.values()];
}

/** 列出台账里的人物、关系与尚未兑现的线索。 */
export function listLedgerEntities(
	store: LedgerStore,
	nodeId: string,
): LedgerEntities {
	const state = store.getStateSnapshot(nodeId).state;
	return {
		characters: listCharacters(state),
		relations: listRelations(state),
		openClues: listOpenClues(state),
	};
}

function listCharacters(state: JsonObject): LedgerCharacter[] {
	const namespace = namespaceObject(state, "character");
	const characters: LedgerCharacter[] = [];
	for (const id of sortedKeys(namespace)) {
		const value = namespace[id];
		const label = `character.${id}`;
		if (!isJsonObject(value)) {
			throw new Error(`台账快照 ${label} 必须是对象`);
		}
		const tier = readEnumField(value, "tier", CHARACTER_TIERS, label);
		const identity = readTextField(value, "identity", label);
		const appearance = readTextField(value, "appearance", label);
		const outfit = readTextField(value, "outfit", label);
		const status = readTextField(value, "status", label);
		const location = readTextField(value, "location", label);
		characters.push({
			id,
			...(tier === undefined ? {} : { tier }),
			...(identity === undefined ? {} : { identity }),
			...(appearance === undefined ? {} : { appearance }),
			...(outfit === undefined ? {} : { outfit }),
			...(status === undefined ? {} : { status }),
			...(location === undefined ? {} : { location }),
		});
	}
	return characters;
}

function listRelations(state: JsonObject): LedgerRelation[] {
	const namespace = namespaceObject(state, "relation");
	const relations: LedgerRelation[] = [];
	for (const from of sortedKeys(namespace)) {
		const targets = namespace[from];
		const fromLabel = `relation.${from}`;
		if (!isJsonObject(targets)) {
			throw new Error(`台账快照 ${fromLabel} 必须是对象`);
		}
		for (const to of sortedKeys(targets)) {
			const value = targets[to];
			const label = `${fromLabel}.${to}`;
			if (!isJsonObject(value)) {
				throw new Error(`台账快照 ${label} 必须是对象`);
			}
			const type = readTextField(value, "type", label);
			const stage = readTextField(value, "stage", label);
			const turningPoint = readTextField(value, "turningPoint", label);
			const affectionInner = readEnumField(
				value,
				"affectionInner",
				AFFECTION_LEVELS,
				label,
			);
			const affectionOuter = readEnumField(
				value,
				"affectionOuter",
				AFFECTION_LEVELS,
				label,
			);
			const inertia = readInertiaField(value, label);
			relations.push({
				from,
				to,
				...(type === undefined ? {} : { type }),
				...(stage === undefined ? {} : { stage }),
				...(turningPoint === undefined ? {} : { turningPoint }),
				...(affectionInner === undefined ? {} : { affectionInner }),
				...(affectionOuter === undefined ? {} : { affectionOuter }),
				...(inertia === undefined ? {} : { inertia }),
			});
		}
	}
	return relations;
}

function listOpenClues(state: JsonObject): LedgerClue[] {
	const namespace = namespaceObject(state, "clue");
	const clues: LedgerClue[] = [];
	for (const id of sortedKeys(namespace)) {
		const value = namespace[id];
		const label = `clue.${id}`;
		if (!isJsonObject(value)) {
			throw new Error(`台账快照 ${label} 必须是对象`);
		}
		const text = readTextField(value, "text", label);
		const status = readEnumField(value, "status", CLUE_STATUSES, label);
		const openedAt = readTextField(value, "openedAt", label);
		const updatedAt = readTextField(value, "updatedAt", label);
		if (status === "fulfilled") continue;
		clues.push({
			id,
			...(text === undefined ? {} : { text }),
			...(status === undefined ? {} : { status }),
			...(openedAt === undefined ? {} : { openedAt }),
			...(updatedAt === undefined ? {} : { updatedAt }),
		});
	}
	return clues;
}

function namespaceObject(
	state: JsonObject,
	namespace: "character" | "relation" | "clue",
): JsonObject {
	const value = state[namespace];
	if (value === undefined) return {};
	if (!isJsonObject(value)) {
		throw new Error(`台账快照 ${namespace} 必须是对象`);
	}
	return value;
}

function readTextField(
	record: JsonObject,
	field: string,
	label: string,
): string | undefined {
	const value = record[field];
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`台账快照 ${label}.${field} 必须是非空字符串`);
	}
	return value;
}

function readEnumField<T extends string>(
	record: JsonObject,
	field: string,
	allowed: readonly T[],
	label: string,
): T | undefined {
	const value = record[field];
	if (value === undefined) return undefined;
	if (
		typeof value !== "string" ||
		!(allowed as readonly string[]).includes(value)
	) {
		throw new Error(`台账快照 ${label}.${field} 只能是 ${allowed.join("、")}`);
	}
	return value as T;
}

function readInertiaField(
	record: JsonObject,
	label: string,
): number | undefined {
	const value = record.inertia;
	if (value === undefined) return undefined;
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 1
	) {
		throw new Error(`台账快照 ${label}.inertia 必须是 0 到 1 之间的数字`);
	}
	return value;
}

function sortedKeys(object: JsonObject): string[] {
	return Object.keys(object).sort();
}

function ledgerSourceOf(diff: StateDiff): LedgerSource {
	const source = diff.source;
	if (!(LEDGER_SOURCES as readonly string[]).includes(source)) {
		throw new Error(
			`台账路径 ${diff.path.map((segment) => JSON.stringify(segment)).join(".")} 的来源 ${JSON.stringify(source)} 不在 ${LEDGER_SOURCES.join("、")} 之内`,
		);
	}
	return source as LedgerSource;
}

function assertPrefix(prefix: readonly string[]): void {
	if (!Array.isArray(prefix) || prefix.length === 0) {
		throw new Error("台账前缀必须是非空数组");
	}
	for (let index = 0; index < prefix.length; index += 1) {
		const segment = prefix[index];
		if (typeof segment !== "string" || segment.length === 0) {
			throw new Error(`台账前缀的第 ${index + 1} 个路径段必须是非空字符串`);
		}
	}
	const namespace = prefix[0] as string;
	if (!isLedgerNamespace(namespace)) {
		throw new Error(`未知台账命名空间 ${JSON.stringify(namespace)}`);
	}
}
