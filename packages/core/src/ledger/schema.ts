import {
	assertJsonValue,
	assertPlainObject,
	rejectUnknownKeys,
} from "../json.js";
import type { StateDiffOp } from "../timeline.js";

export const LEDGER_NAMESPACES = [
	"character",
	"relation",
	"item",
	"scene",
	"time",
	"clue",
	"knowledge",
	"userWill",
	"mvu",
] as const;

export type LedgerNamespace = (typeof LEDGER_NAMESPACES)[number];

export const CHARACTER_TIERS = ["lead", "minor"] as const;
export type CharacterTier = (typeof CHARACTER_TIERS)[number];

/** 好感分内在与外在，都用同一组五档文字表示。 */
export const AFFECTION_LEVELS = [
	"敌对",
	"冷淡",
	"平常",
	"亲近",
	"倾心",
] as const;
export type AffectionLevel = (typeof AFFECTION_LEVELS)[number];

export const CLUE_STATUSES = ["open", "progress", "fulfilled"] as const;
export type ClueStatus = (typeof CLUE_STATUSES)[number];

export const USER_WILL_KINDS = [
	"preference",
	"boundary",
	"correction",
] as const;
export type UserWillKind = (typeof USER_WILL_KINDS)[number];

const CHARACTER_TEXT_FIELDS = [
	"identity",
	"appearance",
	"outfit",
	"status",
	"location",
] as const;

const RELATION_TEXT_FIELDS = ["type", "stage", "turningPoint"] as const;

const AFFECTION_FIELDS = ["affectionInner", "affectionOuter"] as const;

const ITEM_TEXT_FIELDS = ["holder", "location", "origin"] as const;

const PLACE_TEXT_FIELDS = ["name", "description"] as const;

const SCENE_FIELDS = ["place", "posture", "atmosphere"] as const;

const CLUE_TEXT_FIELDS = ["text", "openedAt", "updatedAt"] as const;

const USER_WILL_FIELDS = ["kind", "text", "sourceNodeId", "createdAt"] as const;

export interface LedgerDiffInput {
	readonly path: readonly string[];
	readonly op: StateDiffOp;
	readonly value?: unknown;
}

/**
 * 校验一条台账 diff。路径第一段是命名空间，后续路径段按各命名空间的
 * 固定结构解释；删除操作只校验路径形状，值只对 set 校验。
 */
export function validateLedgerDiff(diff: LedgerDiffInput): void {
	if (diff.op !== "set" && diff.op !== "delete") {
		fail(diff.path, `op 只能是 set 或 delete，收到 ${String(diff.op)}`);
	}
	const path = diff.path;
	if (!Array.isArray(path) || path.length === 0) {
		fail(path, "路径必须是非空数组");
	}
	for (let index = 0; index < path.length; index += 1) {
		const segment = path[index];
		if (typeof segment !== "string" || segment.length === 0) {
			fail(path, `第 ${index + 1} 个路径段必须是非空字符串`);
		}
	}
	if (diff.op === "set") {
		assertJsonValue(diff.value, `台账路径 ${pathLabel(path)} 的值`);
	}
	const [namespace, ...rest] = path as [string, ...string[]];
	if (!isLedgerNamespace(namespace)) {
		fail(path, `未知台账命名空间 ${JSON.stringify(namespace)}`);
	}
	switch (namespace) {
		case "character":
			validateCharacter(path, rest, diff);
			return;
		case "relation":
			validateRelation(path, rest, diff);
			return;
		case "item":
			validateItem(path, rest, diff);
			return;
		case "scene":
			validateScene(path, rest, diff);
			return;
		case "time":
			validateTime(path, rest, diff);
			return;
		case "clue":
			validateClue(path, rest, diff);
			return;
		case "knowledge":
			validateKnowledge(path, rest, diff);
			return;
		case "userWill":
			validateUserWill(path, rest, diff);
			return;
		case "mvu":
			validateMvu(path, rest);
			return;
	}
}

export function isLedgerNamespace(value: string): value is LedgerNamespace {
	return (LEDGER_NAMESPACES as readonly string[]).includes(value);
}

/** 把 MVU 变量的原始路径映射到台账的 `mvu` 命名空间。 */
export function mvuLedgerPath(path: readonly string[]): string[] {
	if (!Array.isArray(path) || path.length === 0) {
		throw new Error("MVU 变量路径必须是非空数组");
	}
	return ["mvu", ...path];
}

function validateCharacter(
	path: readonly string[],
	rest: readonly string[],
	diff: LedgerDiffInput,
): void {
	if (rest.length === 1) {
		requireEntityDeletion(path, diff, "character.<id>");
		return;
	}
	if (rest.length !== 2) {
		fail(path, "character 的路径必须是 character.<id>.<字段>");
	}
	const field = rest[1] as string;
	if (field === "tier") {
		requireEnum(path, diff, field, CHARACTER_TIERS);
		return;
	}
	if (includes(CHARACTER_TEXT_FIELDS, field)) {
		requireText(path, diff, field);
		return;
	}
	fail(path, `未知 character 字段 ${JSON.stringify(field)}`);
}

function validateRelation(
	path: readonly string[],
	rest: readonly string[],
	diff: LedgerDiffInput,
): void {
	if (rest.length === 2) {
		requireEntityDeletion(path, diff, "relation.<from>.<to>");
		return;
	}
	if (rest.length !== 3) {
		fail(path, "relation 的路径必须是 relation.<from>.<to>.<字段>");
	}
	const field = rest[2] as string;
	if (includes(RELATION_TEXT_FIELDS, field)) {
		requireText(path, diff, field);
		return;
	}
	if (includes(AFFECTION_FIELDS, field)) {
		requireEnum(path, diff, field, AFFECTION_LEVELS);
		return;
	}
	if (field === "inertia") {
		if (diff.op === "delete") return;
		if (
			typeof diff.value !== "number" ||
			!Number.isFinite(diff.value) ||
			diff.value < 0 ||
			diff.value > 1
		) {
			fail(path, "inertia 必须是 0 到 1 之间的数字");
		}
		return;
	}
	fail(path, `未知 relation 字段 ${JSON.stringify(field)}`);
}

function validateItem(
	path: readonly string[],
	rest: readonly string[],
	diff: LedgerDiffInput,
): void {
	if (rest.length === 1) {
		requireEntityDeletion(path, diff, "item.<id>");
		return;
	}
	if (rest.length === 2) {
		const field = rest[1] as string;
		if (field === "log") {
			requireEntityDeletion(path, diff, "item.<id>.log");
			return;
		}
		if (!includes(ITEM_TEXT_FIELDS, field)) {
			fail(path, `未知 item 字段 ${JSON.stringify(field)}`);
		}
		requireText(path, diff, field);
		return;
	}
	if (rest.length === 3 && rest[1] === "log") {
		if (diff.op === "delete") return;
		const label = `台账路径 ${pathLabel(path)} 的值`;
		const entry = assertPlainObject(diff.value, label);
		rejectUnknownKeys(entry, ["text", "nodeId", "at"], label);
		requireObjectText(entry, "text", label);
		requireObjectText(entry, "nodeId", label);
		requireObjectText(entry, "at", label);
		return;
	}
	fail(path, "item 的路径必须是 item.<id>.<字段> 或 item.<id>.log.<条目 id>");
}

function validateScene(
	path: readonly string[],
	rest: readonly string[],
	diff: LedgerDiffInput,
): void {
	if (rest[0] === "places") {
		if (rest.length === 2) {
			requireEntityDeletion(path, diff, "scene.places.<地点 id>");
			return;
		}
		if (rest.length !== 3) {
			fail(path, "scene.places 的路径必须是 scene.places.<地点 id>.<字段>");
		}
		const field = rest[2] as string;
		if (field === "parent") {
			if (diff.op === "delete") return;
			if (
				diff.value !== null &&
				(typeof diff.value !== "string" || diff.value.trim().length === 0)
			) {
				fail(path, "parent 必须是非空字符串或 null");
			}
			return;
		}
		if (includes(PLACE_TEXT_FIELDS, field)) {
			requireText(path, diff, field);
			return;
		}
		fail(path, `未知 scene.places 字段 ${JSON.stringify(field)}`);
	}
	if (rest[0] === "current") {
		if (rest.length === 1) {
			requireEntityDeletion(path, diff, "scene.current");
			return;
		}
		if (rest.length !== 2) {
			fail(path, "scene.current 的路径必须是 scene.current.<字段>");
		}
		const field = rest[1] as string;
		if (field === "participants") {
			if (diff.op === "delete") return;
			const participants = diff.value;
			if (!Array.isArray(participants)) {
				fail(path, "participants 必须是字符串数组");
			}
			for (let index = 0; index < participants.length; index += 1) {
				const participant = participants[index];
				if (
					typeof participant !== "string" ||
					participant.trim().length === 0
				) {
					fail(path, `participants[${index}] 必须是非空字符串`);
				}
			}
			return;
		}
		if (includes(SCENE_FIELDS, field)) {
			requireText(path, diff, field);
			return;
		}
		fail(path, `未知 scene.current 字段 ${JSON.stringify(field)}`);
	}
	fail(path, "scene 的路径必须以 places 或 current 开头");
}

function validateTime(
	path: readonly string[],
	rest: readonly string[],
	diff: LedgerDiffInput,
): void {
	if (rest.length !== 1 || rest[0] !== "current") {
		fail(path, "time 的路径必须是 time.current");
	}
	requireText(path, diff, "current");
}

function validateClue(
	path: readonly string[],
	rest: readonly string[],
	diff: LedgerDiffInput,
): void {
	if (rest.length === 1) {
		requireEntityDeletion(path, diff, "clue.<id>");
		return;
	}
	if (rest.length !== 2) {
		fail(path, "clue 的路径必须是 clue.<id>.<字段>");
	}
	const field = rest[1] as string;
	if (field === "status") {
		requireEnum(path, diff, field, CLUE_STATUSES);
		return;
	}
	if (includes(CLUE_TEXT_FIELDS, field)) {
		requireText(path, diff, field);
		return;
	}
	fail(path, `未知 clue 字段 ${JSON.stringify(field)}`);
}

function validateKnowledge(
	path: readonly string[],
	rest: readonly string[],
	diff: LedgerDiffInput,
): void {
	if (rest.length === 1) {
		requireEntityDeletion(path, diff, "knowledge.<知情者>");
		return;
	}
	if (rest.length !== 2) {
		fail(path, "knowledge 的路径必须是 knowledge.<知情者>.<事实>");
	}
	requireText(path, diff, "knowledge 值");
}

function validateUserWill(
	path: readonly string[],
	rest: readonly string[],
	diff: LedgerDiffInput,
): void {
	if (rest.length !== 1) {
		fail(path, "userWill 的路径必须是 userWill.<id>");
	}
	if (diff.op === "delete") return;
	const label = `台账路径 ${pathLabel(path)} 的值`;
	const value = assertPlainObject(diff.value, label);
	rejectUnknownKeys(value, USER_WILL_FIELDS, label);
	requireEnumValue(value, "kind", USER_WILL_KINDS, path);
	requireObjectText(value, "text", label);
	requireObjectText(value, "sourceNodeId", label);
	requireObjectText(value, "createdAt", label);
}

function validateMvu(path: readonly string[], rest: readonly string[]): void {
	if (rest.length === 0) {
		fail(path, "mvu 路径必须至少包含一个变量路径段");
	}
}

function requireEntityDeletion(
	path: readonly string[],
	diff: LedgerDiffInput,
	shape: string,
): void {
	if (diff.op === "set") {
		fail(path, `${shape} 只能删除，字段必须逐项写入`);
	}
}

function requireText(
	path: readonly string[],
	diff: LedgerDiffInput,
	field: string,
): void {
	if (diff.op === "delete") return;
	if (typeof diff.value !== "string" || diff.value.trim().length === 0) {
		fail(path, `${field} 必须是非空字符串`);
	}
}

function requireEnum<T extends string>(
	path: readonly string[],
	diff: LedgerDiffInput,
	field: string,
	allowed: readonly T[],
): void {
	if (diff.op === "delete") return;
	if (
		typeof diff.value !== "string" ||
		!(allowed as readonly string[]).includes(diff.value)
	) {
		fail(path, `${field} 只能是 ${allowed.join("、")}`);
	}
}

function requireEnumValue(
	value: Record<string, unknown>,
	field: string,
	allowed: readonly string[],
	path: readonly string[],
): void {
	const candidate = value[field];
	if (typeof candidate !== "string" || !allowed.includes(candidate)) {
		fail(path, `${field} 只能是 ${allowed.join("、")}`);
	}
}

function requireObjectText(
	value: Record<string, unknown>,
	field: string,
	label: string,
): void {
	const candidate = value[field];
	if (typeof candidate !== "string" || candidate.trim().length === 0) {
		throw new Error(`${label}.${field} 必须是非空字符串`);
	}
}

function includes<T extends string>(
	values: readonly T[],
	value: string,
): value is T {
	return (values as readonly string[]).includes(value);
}

function fail(path: readonly string[] | undefined, message: string): never {
	throw new Error(`台账路径 ${pathLabel(path)} 无效：${message}`);
}

function pathLabel(path: readonly string[] | undefined): string {
	if (!Array.isArray(path)) return String(path);
	return path.map((segment) => JSON.stringify(segment)).join(".");
}
