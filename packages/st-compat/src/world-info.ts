import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
	type JsonObject,
	type JsonValue,
	isJsonObject,
} from "@dramaticer/core";
import {
	optionalBoolean,
	optionalJsonArray,
	optionalNumber,
	optionalNumberOrBoolean,
	optionalObject,
	optionalString,
	readBoolean,
	readString,
	readStringList,
} from "./field-readers.js";

/**
 * ST 世界书条目。字段名与酒馆的 JSON 对齐（`key`、`keysecondary`、`disable`），
 * 这里的视图用复数或可读名称。未识别的字段留在 `raw` 里。
 */
export interface StWorldInfoEntry {
	/** 在 `entries` 对象里的键，通常是数字字符串 */
	readonly sourceKey: string;
	readonly uid: number | null;
	readonly keys: readonly string[];
	readonly secondaryKeys: readonly string[];
	readonly comment: string;
	readonly content: string;
	readonly constant: boolean;
	readonly selective: boolean;
	readonly selectiveLogic: number | null;
	/** JSON 里的 `order`，决定注入顺序 */
	readonly insertionOrder: number | null;
	/** 0 角色定义之前、1 角色定义之后、2 作者注释顶部、3 作者注释底部、4 按深度注入 */
	readonly position: number | null;
	readonly depth: number | null;
	readonly probability: number | null;
	readonly useProbability: boolean | null;
	/** JSON 里的 `disable` */
	readonly disabled: boolean;
	readonly excludeRecursion: boolean | null;
	readonly preventRecursion: boolean | null;
	/** 酒馆里这个字段可能是布尔值也可能是数字 */
	readonly delayUntilRecursion: number | boolean | null;
	readonly group: string | null;
	readonly groupOverride: boolean | null;
	readonly groupWeight: number | null;
	readonly scanDepth: number | null;
	readonly caseSensitive: boolean | null;
	readonly matchWholeWords: boolean | null;
	readonly useGroupScoring: boolean | null;
	readonly automationId: string | null;
	readonly role: number | null;
	readonly sticky: number | null;
	readonly cooldown: number | null;
	readonly delay: number | null;
	readonly displayIndex: number | null;
	readonly vectorized: boolean | null;
	readonly ignoreBudget: boolean | null;
	readonly outletName: string | null;
	readonly triggers: readonly JsonValue[] | null;
	/** 扫描范围是否包含人设、角色卡字段与场景；酒馆把它们放在 extensions 里。 */
	readonly matchPersonaDescription: boolean;
	readonly matchCharacterDescription: boolean;
	readonly matchCharacterPersonality: boolean;
	readonly matchCharacterDepthPrompt: boolean;
	readonly matchScenario: boolean;
	readonly matchCreatorNotes: boolean;
	readonly extensions: JsonObject | null;
	/** 条目原始对象，导出时直接写回 */
	readonly raw: JsonObject;
}

export interface StWorldInfo {
	/** 从文件名得到的名字；直接解析文本时为 null */
	readonly name: string | null;
	readonly entries: readonly StWorldInfoEntry[];
	/** 部分世界书带一份角色卡内嵌世界书格式的原始数据 */
	readonly originalData: JsonObject | null;
	/** 世界书原始对象，导出时直接写回 */
	readonly raw: JsonObject;
}

export function parseWorldInfoJson(jsonText: string): StWorldInfo {
	return parseWorldInfoText(jsonText, null);
}

export async function parseWorldInfoFile(path: string): Promise<StWorldInfo> {
	try {
		const text = await readFile(path, "utf8");
		return parseWorldInfoText(text, basename(path).replace(/\.json$/i, ""));
	} catch (error) {
		throw new Error(`解析世界书失败：${path}`, { cause: error });
	}
}

/**
 * 角色卡内嵌的 `character_book` 用数组存条目，字段名也与世界书文件不同
 * （`keys`、`secondary_keys`、`enabled`）。转换成同一视图后可以直接走
 * 世界书的实体导入与 lore 导入。
 */
export function worldInfoFromCharacterBook(
	book: JsonObject,
	name: string | null = null,
): StWorldInfo {
	const entriesNode = book.entries;
	if (!Array.isArray(entriesNode)) {
		throw new Error('角色卡内嵌世界书的字段 "entries" 不是数组');
	}
	const rawEntries: JsonObject = {};
	entriesNode.forEach((value, index) => {
		if (!isJsonObject(value)) {
			throw new Error(`角色卡内嵌世界书条目 ${index} 不是 JSON 对象`);
		}
		const context = `角色卡内嵌世界书条目 ${index}`;
		const keys = [
			...readStringList(value, "keys", context),
			...readStringList(value, "key", context),
		];
		const secondaryKeys = [
			...readStringList(value, "secondary_keys", context),
			...readStringList(value, "keysecondary", context),
		];
		const enabled = optionalBoolean(value, "enabled", context) ?? true;
		const rawId = value.id;
		const sourceKey =
			typeof rawId === "number" || typeof rawId === "string"
				? String(rawId)
				: String(index);
		const comment = readString(value, "comment", context);
		const entryName = readString(value, "name", context);
		const extensions = optionalObject(value, "extensions", context);
		const extensionContext = `${context} 的 extensions`;
		const extension = <T>(
			field: string,
			read: (source: JsonObject, name: string, label: string) => T | null,
		): T | null =>
			extensions === null ? null : read(extensions, field, extensionContext);
		const rawPosition = optionalString(value, "position", context);
		const triggers = extension("triggers", optionalJsonArray);
		rawEntries[sourceKey] = {
			...value,
			uid:
				typeof rawId === "number"
					? rawId
					: typeof rawId === "string" && /^\d+$/.test(rawId)
						? Number(rawId)
						: index,
			key: keys,
			keysecondary: secondaryKeys,
			comment: comment.length > 0 ? comment : entryName,
			content: readString(value, "content", context),
			constant: readBoolean(value, "constant", context, false),
			disable: !enabled,
			order:
				optionalNumber(value, "insertion_order", context) ??
				optionalNumber(value, "order", context),
			selective: optionalBoolean(value, "selective", context) ?? false,
			selectiveLogic: extension("selectiveLogic", optionalNumber),
			excludeRecursion: extension("exclude_recursion", optionalBoolean),
			preventRecursion: extension("prevent_recursion", optionalBoolean),
			delayUntilRecursion: extension(
				"delay_until_recursion",
				optionalNumberOrBoolean,
			),
			probability: extension("probability", optionalNumber),
			useProbability: extension("useProbability", optionalBoolean),
			depth: extension("depth", optionalNumber),
			position:
				extension("position", optionalNumber) ??
				(rawPosition === "before_char" ? 0 : 1),
			outletName: extension("outlet_name", optionalString),
			group: extension("group", optionalString),
			groupOverride: extension("group_override", optionalBoolean),
			groupWeight: extension("group_weight", optionalNumber),
			scanDepth: extension("scan_depth", optionalNumber),
			caseSensitive: extension("case_sensitive", optionalBoolean),
			matchWholeWords: extension("match_whole_words", optionalBoolean),
			useGroupScoring: extension("use_group_scoring", optionalBoolean),
			automationId: extension("automation_id", optionalString),
			role: extension("role", optionalNumber),
			vectorized: extension("vectorized", optionalBoolean),
			sticky: extension("sticky", optionalNumber),
			cooldown: extension("cooldown", optionalNumber),
			delay: extension("delay", optionalNumber),
			ignoreBudget: extension("ignore_budget", optionalBoolean),
			triggers: triggers === null ? null : [...triggers],
			matchPersonaDescription: extension(
				"match_persona_description",
				optionalBoolean,
			),
			matchCharacterDescription: extension(
				"match_character_description",
				optionalBoolean,
			),
			matchCharacterPersonality: extension(
				"match_character_personality",
				optionalBoolean,
			),
			matchCharacterDepthPrompt: extension(
				"match_character_depth_prompt",
				optionalBoolean,
			),
			matchScenario: extension("match_scenario", optionalBoolean),
			matchCreatorNotes: extension("match_creator_notes", optionalBoolean),
			extensions,
		};
	});
	const entries = Object.entries(rawEntries).map(([sourceKey, entry]) => {
		if (!isJsonObject(entry)) {
			throw new Error(`角色卡内嵌世界书条目 "${sourceKey}" 不是 JSON 对象`);
		}
		return normalizeWorldInfoEntry(sourceKey, entry);
	});
	return {
		name,
		entries,
		originalData: book,
		raw: { entries: rawEntries },
	};
}

function parseWorldInfoText(
	jsonText: string,
	name: string | null,
): StWorldInfo {
	const body = jsonText.charCodeAt(0) === 0xfeff ? jsonText.slice(1) : jsonText;
	let value: unknown;
	try {
		value = JSON.parse(body);
	} catch (error) {
		throw new Error("世界书不是合法 JSON", { cause: error });
	}
	if (!isJsonObject(value)) throw new Error("世界书必须是 JSON 对象");
	const entriesNode = value.entries;
	if (!isJsonObject(entriesNode)) {
		throw new Error('世界书字段 "entries" 不是 JSON 对象');
	}
	const entries = Object.entries(entriesNode).map(([sourceKey, entry]) => {
		if (!isJsonObject(entry)) {
			throw new Error(`世界书条目 "${sourceKey}" 不是 JSON 对象`);
		}
		return normalizeWorldInfoEntry(sourceKey, entry);
	});
	return {
		name,
		entries,
		originalData: optionalObject(value, "originalData", "世界书"),
		raw: value,
	};
}

function normalizeWorldInfoEntry(
	sourceKey: string,
	raw: JsonObject,
): StWorldInfoEntry {
	const context = `世界书条目 "${sourceKey}"`;
	const extensions = optionalObject(raw, "extensions", context);
	function extensionFlag(name: string): boolean {
		return extensions === null
			? false
			: readBoolean(extensions, name, `${context} 的 extensions`, false);
	}
	return {
		sourceKey,
		uid: optionalNumber(raw, "uid", context),
		keys: readStringList(raw, "key", context),
		secondaryKeys: readStringList(raw, "keysecondary", context),
		comment: readString(raw, "comment", context),
		content: readString(raw, "content", context),
		constant: readBoolean(raw, "constant", context, false),
		selective: readBoolean(raw, "selective", context, false),
		selectiveLogic: optionalNumber(raw, "selectiveLogic", context),
		insertionOrder: optionalNumber(raw, "order", context),
		position: optionalNumber(raw, "position", context),
		depth: optionalNumber(raw, "depth", context),
		probability: optionalNumber(raw, "probability", context),
		useProbability: optionalBoolean(raw, "useProbability", context),
		disabled: readBoolean(raw, "disable", context, false),
		excludeRecursion: optionalBoolean(raw, "excludeRecursion", context),
		preventRecursion: optionalBoolean(raw, "preventRecursion", context),
		delayUntilRecursion: optionalNumberOrBoolean(
			raw,
			"delayUntilRecursion",
			context,
		),
		group: optionalString(raw, "group", context),
		groupOverride: optionalBoolean(raw, "groupOverride", context),
		groupWeight: optionalNumber(raw, "groupWeight", context),
		scanDepth: optionalNumber(raw, "scanDepth", context),
		caseSensitive: optionalBoolean(raw, "caseSensitive", context),
		matchWholeWords: optionalBoolean(raw, "matchWholeWords", context),
		useGroupScoring: optionalBoolean(raw, "useGroupScoring", context),
		automationId: optionalString(raw, "automationId", context),
		role: optionalNumber(raw, "role", context),
		sticky: optionalNumber(raw, "sticky", context),
		cooldown: optionalNumber(raw, "cooldown", context),
		delay: optionalNumber(raw, "delay", context),
		displayIndex: optionalNumber(raw, "displayIndex", context),
		vectorized: optionalBoolean(raw, "vectorized", context),
		ignoreBudget: optionalBoolean(raw, "ignoreBudget", context),
		outletName: optionalString(raw, "outletName", context),
		triggers: optionalJsonArray(raw, "triggers", context),
		matchPersonaDescription: extensionFlag("match_persona_description"),
		matchCharacterDescription: extensionFlag("match_character_description"),
		matchCharacterPersonality: extensionFlag("match_character_personality"),
		matchCharacterDepthPrompt: extensionFlag("match_character_depth_prompt"),
		matchScenario: extensionFlag("match_scenario"),
		matchCreatorNotes: extensionFlag("match_creator_notes"),
		extensions,
		raw,
	};
}
