import {
	type CharacterOutfitInput,
	type CharacterVisualProfile,
	type JsonObject,
	type VisualDressState,
	type VisualSlotPart,
	type VisualSlotView,
	assertCharacterVisualProfile,
	isJsonObject,
} from "@dramaticer/core";

const PART_KEYS: Readonly<Record<VisualSlotPart, readonly string[]>> = {
	face: ["face", "facePrompt", "face_prompt", "脸部", "脸"],
	upper: ["upper", "upperBody", "upper_body", "upperPrompt", "上身"],
	full: ["full", "fullBody", "full_body", "fullPrompt", "全身"],
};

const VIEW_KEYS: Readonly<Record<VisualSlotView, readonly string[]>> = {
	front: ["front", "正面"],
	back: ["back", "背面"],
};

const STATE_KEYS: Readonly<Record<VisualDressState, readonly string[]>> = {
	clothed: ["clothed", "dressed", "clothes", "着装", "穿衣"],
	bare: ["bare", "nude", "naked", "裸露", "裸体"],
};

const PARTS = ["face", "upper", "full"] as const;
const VIEWS = ["front", "back"] as const;
const STATES = ["clothed", "bare"] as const;

type SlotGrid = Record<
	VisualSlotPart,
	Record<VisualSlotView, Record<VisualDressState, string[]>>
>;

function firstValue(record: JsonObject, keys: readonly string[]): unknown {
	for (const key of keys) {
		if (Object.hasOwn(record, key) && record[key] !== undefined) {
			return record[key];
		}
	}
	return undefined;
}

function firstString(
	record: JsonObject,
	keys: readonly string[],
): string | null {
	const value = firstValue(record, keys);
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length === 0 ? null : trimmed;
}

function firstBoolean(
	record: JsonObject,
	keys: readonly string[],
): boolean | null {
	const value = firstValue(record, keys);
	return typeof value === "boolean" ? value : null;
}

function tagList(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	if (Array.isArray(value)) {
		const result: string[] = [];
		for (const item of value) {
			if (typeof item !== "string") continue;
			const trimmed = item.trim();
			if (trimmed.length > 0) result.push(trimmed);
		}
		return result;
	}
	if (typeof value !== "string") return [];
	return value
		.split(/[、,，;；\n]+/)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function mergeTags(target: string[], extra: readonly string[]): void {
	for (const tag of extra) {
		if (!target.includes(tag)) target.push(tag);
	}
}

function emptyGrid(): SlotGrid {
	return {
		face: {
			front: { clothed: [], bare: [] },
			back: { clothed: [], bare: [] },
		},
		upper: {
			front: { clothed: [], bare: [] },
			back: { clothed: [], bare: [] },
		},
		full: {
			front: { clothed: [], bare: [] },
			back: { clothed: [], bare: [] },
		},
	};
}

/** 一个部位的平铺写法套到两个视角与两种着装状态。 */
function applyState(
	raw: unknown,
	part: VisualSlotPart,
	view: VisualSlotView,
	grid: SlotGrid,
): void {
	if (Array.isArray(raw) || typeof raw === "string") {
		const tags = tagList(raw);
		for (const state of STATES) mergeTags(grid[part][view][state], tags);
		return;
	}
	if (!isJsonObject(raw)) {
		throw new Error(`角色分格 ${part} 必须是对象、字符串或字符串数组`);
	}
	for (const state of STATES) {
		const value = firstValue(raw, STATE_KEYS[state]);
		if (value !== undefined) {
			mergeTags(grid[part][view][state], tagList(value));
		}
	}
}

/** 把常见导出形状里的分格提示词转成 12 格；认不出的形状直接报错。 */
function parsePart(value: unknown, part: VisualSlotPart, grid: SlotGrid): void {
	if (Array.isArray(value) || typeof value === "string") {
		const tags = tagList(value);
		for (const view of VIEWS) {
			for (const state of STATES) {
				mergeTags(grid[part][view][state], tags);
			}
		}
		return;
	}
	if (!isJsonObject(value)) {
		throw new Error(`角色分格 ${part} 必须是对象、字符串或字符串数组`);
	}
	const hasView = [...VIEW_KEYS.front, ...VIEW_KEYS.back].some((key) =>
		Object.hasOwn(value, key),
	);
	if (!hasView) {
		for (const view of VIEWS) applyState(value, part, view, grid);
		return;
	}
	for (const view of VIEWS) {
		const raw = firstValue(value, VIEW_KEYS[view]);
		if (raw !== undefined) applyState(raw, part, view, grid);
	}
}

function findCharacters(input: unknown, depth = 0): unknown[] | null {
	if (Array.isArray(input)) return input;
	if (!isJsonObject(input) || depth > 3) return null;
	const direct = firstValue(input, [
		"characters",
		"roles",
		"characterList",
		"characterlist",
		"character_library",
		"角色",
		"角色库",
	]);
	if (Array.isArray(direct)) return direct;
	for (const key of [
		"data",
		"library",
		"characterLibrary",
		"characters",
		"角色库",
	]) {
		const nested = findCharacters(input[key], depth + 1);
		if (nested !== null) return nested;
	}
	return null;
}

function outfitTags(
	record: JsonObject,
	region: "upper" | "full",
): { visible: string[]; hidden: string[] } {
	const visible = tagList(
		firstValue(record, [
			`${region}Visible`,
			`${region}_visible`,
			`${region}Tags`,
		]),
	);
	const hidden = tagList(
		firstValue(record, [
			`${region}Hidden`,
			`${region}_hidden`,
			`${region}HiddenTags`,
		]),
	);
	const nested = firstValue(record, [
		region,
		region === "upper" ? "上身" : "全身",
	]);
	if (isJsonObject(nested)) {
		visible.push(...tagList(firstValue(nested, ["visible", "show", "可见"])));
		hidden.push(...tagList(firstValue(nested, ["hidden", "hide", "隐藏"])));
	}
	return { visible, hidden };
}

function parseOutfit(value: unknown, character: string): CharacterOutfitInput {
	if (!isJsonObject(value)) {
		throw new Error(`角色 ${character} 的服装必须是对象`);
	}
	const name =
		firstString(value, ["name", "title", "outfitName", "名称", "服装名"]) ??
		"未命名服装";
	const upper = outfitTags(value, "upper");
	const full = outfitTags(value, "full");
	return {
		character,
		name,
		upperVisible: upper.visible,
		upperHidden: upper.hidden,
		fullVisible: full.visible,
		fullHidden: full.hidden,
		isDefault: firstBoolean(value, ["isDefault", "default", "默认"]) ?? false,
		locked: firstBoolean(value, ["locked", "lock", "锁定"]) ?? false,
	};
}

function parseCharacter(
	value: unknown,
	outfits: CharacterOutfitInput[],
): CharacterVisualProfile {
	if (!isJsonObject(value)) throw new Error("角色条目必须是对象");
	const character = firstString(value, [
		"name",
		"character",
		"title",
		"名称",
		"角色名",
	]);
	if (character === null) throw new Error("角色条目缺少 name");
	const grid = emptyGrid();
	const rawSlots = firstValue(value, [
		"slots",
		"parts",
		"prompts",
		"分格",
		"分格外貌",
	]);
	if (isJsonObject(rawSlots)) {
		for (const part of PARTS) {
			const raw = firstValue(rawSlots, PART_KEYS[part]);
			if (raw !== undefined) parsePart(raw, part, grid);
		}
	}
	for (const part of PARTS) {
		const raw = firstValue(value, PART_KEYS[part]);
		if (raw !== undefined) parsePart(raw, part, grid);
	}
	const base = tagList(
		firstValue(value, [
			"base",
			"basePrompt",
			"appearance",
			"prompt",
			"外貌",
			"基础",
			"基础外貌",
		]),
	);
	if (base.length === 0) {
		for (const part of PARTS) {
			for (const view of VIEWS) {
				for (const state of STATES) {
					mergeTags(base, grid[part][view][state]);
				}
			}
		}
	}
	const ownOutfits = firstValue(value, [
		"outfits",
		"costumes",
		"clothes",
		"服装",
		"服装库",
	]);
	if (Array.isArray(ownOutfits)) {
		for (const item of ownOutfits) {
			outfits.push(parseOutfit(item, character));
		}
	}
	const own = outfits.filter((outfit) => outfit.character === character);
	const explicitDefault = firstString(value, [
		"defaultOutfit",
		"default_outfit",
		"outfit",
		"默认服装",
	]);
	const defaultOutfit =
		explicitDefault ??
		own.find((outfit) => outfit.isDefault)?.name ??
		own[0]?.name ??
		"日常服装";
	return assertCharacterVisualProfile({
		character,
		base: base.length > 0 ? base : [character],
		defaultOutfit,
		negative: tagList(
			firstValue(value, [
				"negative",
				"negativePrompt",
				"negative_prompt",
				"uc",
				"负面",
				"负面提示",
			]),
		),
		locked: firstBoolean(value, ["locked", "lock", "锁定"]) ?? false,
		slots: grid,
	});
}

export interface ParsedImageCharacterLibrary {
	readonly profiles: readonly CharacterVisualProfile[];
	readonly outfits: readonly CharacterOutfitInput[];
}

function dedupeOutfits(
	outfits: CharacterOutfitInput[],
): CharacterOutfitInput[] {
	const byCharacter = new Map<string, CharacterOutfitInput[]>();
	for (const outfit of outfits) {
		const list = byCharacter.get(outfit.character);
		if (list === undefined) byCharacter.set(outfit.character, [outfit]);
		else list.push(outfit);
	}
	const result: CharacterOutfitInput[] = [];
	for (const own of byCharacter.values()) {
		let defaultIndex = own.findIndex((outfit) => outfit.isDefault === true);
		if (defaultIndex === -1) defaultIndex = 0;
		own.forEach((outfit, index) => {
			result.push({ ...outfit, isDefault: index === defaultIndex });
		});
	}
	return result;
}

/**
 * 解析智绘姬角色库 / 服装库导出。角色在 `characters` 或 `roles` 里，
 * 分格是 12 格或按部位平铺；服装可以挂在角色下，也可以放在根部的
 * `outfits` 里用 character 指向人物。只读常见公开字段，不复制其数据。
 */
export function parseImageCharacterLibrary(
	input: unknown,
): ParsedImageCharacterLibrary {
	const entries = findCharacters(input);
	if (entries === null) {
		throw new Error("角色库文件里没有 characters 或 roles 数组");
	}
	const outfits: CharacterOutfitInput[] = [];
	const profiles = entries.map((entry) => parseCharacter(entry, outfits));
	if (isJsonObject(input)) {
		const rootOutfits = firstValue(input, ["outfits", "costumes", "服装"]);
		if (Array.isArray(rootOutfits)) {
			for (const item of rootOutfits) {
				if (!isJsonObject(item)) continue;
				const owner = firstString(item, [
					"character",
					"role",
					"owner",
					"角色",
					"人物",
				]);
				if (owner === null) continue;
				const parsed = parseOutfit(item, owner);
				const index = outfits.findIndex(
					(outfit) =>
						outfit.character === parsed.character &&
						outfit.name === parsed.name,
				);
				if (index === -1) outfits.push(parsed);
				else outfits[index] = parsed;
			}
		}
	}
	const seen = new Set<string>();
	const unique = profiles.filter((profile) => {
		const key = profile.character.toLocaleLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	const resolved = dedupeOutfits(outfits);
	const byCharacter = new Map<string, CharacterOutfitInput[]>();
	for (const outfit of resolved) {
		const list = byCharacter.get(outfit.character);
		if (list === undefined) byCharacter.set(outfit.character, [outfit]);
		else list.push(outfit);
	}
	return {
		profiles: unique.map((profile) => {
			if (profile.defaultOutfit !== "日常服装") return profile;
			const own = byCharacter.get(profile.character) ?? [];
			const fallback = own.find((outfit) => outfit.isDefault) ?? own[0];
			return fallback === undefined
				? profile
				: { ...profile, defaultOutfit: fallback.name };
		}),
		outfits: resolved,
	};
}
