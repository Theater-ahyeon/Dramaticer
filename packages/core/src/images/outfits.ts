import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import type { JsonObject } from "../json.js";
import { readStateValue } from "../state.js";
import type { CharacterVisualProfile } from "./types.js";

/**
 * 独立服装：归属人物，按上身 / 全身 × 可见 / 隐藏分开存标签。
 * 可见指该部位在画面里露出，隐藏指被裁掉或挡住。
 */
export interface CharacterOutfit {
	readonly id: string;
	readonly storyId: string;
	readonly character: string;
	readonly name: string;
	readonly upperVisible: readonly string[];
	readonly upperHidden: readonly string[];
	readonly fullVisible: readonly string[];
	readonly fullHidden: readonly string[];
	readonly isDefault: boolean;
	readonly locked: boolean;
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** 写入服装时客户端给出的形状；id 与时间戳缺省时由存储层补。 */
export interface CharacterOutfitInput {
	readonly id?: string;
	readonly storyId?: string;
	readonly character: string;
	readonly name: string;
	readonly upperVisible?: readonly string[];
	readonly upperHidden?: readonly string[];
	readonly fullVisible?: readonly string[];
	readonly fullHidden?: readonly string[];
	readonly isDefault?: boolean;
	readonly locked?: boolean;
	readonly createdAt?: string;
	readonly updatedAt?: string;
}

export interface SaveCharacterOutfitsInput {
	readonly storyId: string;
	readonly outfits: readonly CharacterOutfitInput[];
}

export interface CharacterOutfitMetadata {
	readonly id: string;
	readonly storyId: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

const OUTFIT_FIELDS = [
	"id",
	"storyId",
	"character",
	"name",
	"upperVisible",
	"upperHidden",
	"fullVisible",
	"fullHidden",
	"isDefault",
	"locked",
	"createdAt",
	"updatedAt",
] as const;

function requireText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}

function optionalTags(value: unknown, label: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组`);
	return value.map((item, index) => requireText(item, `${label}[${index}]`));
}

function optionalFlag(value: unknown, label: string): boolean {
	if (value === undefined) return false;
	if (typeof value !== "boolean") throw new Error(`${label} 必须是布尔值`);
	return value;
}

function optionalTimestamp(value: unknown, label: string): string | null {
	if (value === undefined) return null;
	return requireText(value, label);
}

/**
 * 把客户端或数据库里的服装记录整理成完整形状；缺省的元数据用调用方
 * 给出的值补。未知字段直接拒绝，避免拼错的字段被静默忽略。
 */
export function normalizeCharacterOutfit(
	value: unknown,
	metadata: CharacterOutfitMetadata,
	label = "服装",
): CharacterOutfit {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, OUTFIT_FIELDS, label);
	const id =
		record.id === undefined
			? metadata.id
			: requireText(record.id, `${label}.id`);
	const storyId =
		record.storyId === undefined
			? metadata.storyId
			: requireText(record.storyId, `${label}.storyId`);
	const createdAt =
		optionalTimestamp(record.createdAt, `${label}.createdAt`) ??
		metadata.createdAt;
	const updatedAt =
		optionalTimestamp(record.updatedAt, `${label}.updatedAt`) ??
		metadata.updatedAt;
	return {
		id,
		storyId,
		character: requireText(record.character, `${label}.character`),
		name: requireText(record.name, `${label}.name`),
		upperVisible: optionalTags(record.upperVisible, `${label}.upperVisible`),
		upperHidden: optionalTags(record.upperHidden, `${label}.upperHidden`),
		fullVisible: optionalTags(record.fullVisible, `${label}.fullVisible`),
		fullHidden: optionalTags(record.fullHidden, `${label}.fullHidden`),
		isDefault: optionalFlag(record.isDefault, `${label}.isDefault`),
		locked: optionalFlag(record.locked, `${label}.locked`),
		createdAt,
		updatedAt,
	};
}

/** 同一人物最多一套默认服装；名称在人物内不能重复。 */
export function assertUniqueCharacterOutfits(
	outfits: readonly CharacterOutfit[],
	label = "服装",
): void {
	const names = new Map<string, number>();
	const defaults = new Set<string>();
	outfits.forEach((outfit, index) => {
		const key = `${outfit.character}\u0000${outfit.name}`;
		const first = names.get(key);
		if (first !== undefined) {
			throw new Error(
				`${label}[${index}] 与第 ${first} 套重复：${outfit.character} 的 ${outfit.name}`,
			);
		}
		names.set(key, index);
		if (!outfit.isDefault) return;
		if (defaults.has(outfit.character)) {
			throw new Error(
				`${label}[${index}] 是重复的默认服装：${outfit.character}`,
			);
		}
		defaults.add(outfit.character);
	});
}

export interface SelectCharacterOutfitOptions {
	/** 选中的服装 id 或名称。 */
	readonly selected?: string | null;
	/** 读台账当前服装用的档案；只在没有显式选择时使用。 */
	readonly profile?: CharacterVisualProfile;
	readonly state?: JsonObject;
}

/**
 * 按显式选择、台账当前服装、默认服装的顺序取一套；都没有时返回 null。
 */
export function selectCharacterOutfit(
	outfits: readonly CharacterOutfit[],
	character: string,
	options: SelectCharacterOutfitOptions = {},
): CharacterOutfit | null {
	const own = outfits.filter((outfit) => outfit.character === character);
	if (own.length === 0) return null;
	const selected = options.selected?.trim() ?? "";
	if (selected.length > 0) {
		return (
			own.find((outfit) => outfit.id === selected) ??
			own.find((outfit) => outfit.name === selected) ??
			null
		);
	}
	const profile = options.profile;
	if (profile?.outfitPath != null && options.state !== undefined) {
		const value = readStateValue(options.state, profile.outfitPath);
		if (typeof value === "string" && value.trim().length > 0) {
			const name = value.trim();
			return own.find((outfit) => outfit.name === name) ?? null;
		}
	}
	return own.find((outfit) => outfit.isDefault) ?? own[0] ?? null;
}
