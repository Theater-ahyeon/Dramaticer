import type { ImageReplacementRule } from "./types.js";

/** 提示词后处理：替换规则 → 全角标点清洗 → 按逗号归一化去重。 */
export function applyImageReplacementRules(
	text: string,
	rules: readonly ImageReplacementRule[],
): string {
	let result = text;
	for (const rule of rules) {
		if (!rule.enabled) continue;
		if (rule.isRegex) {
			result = result.replace(new RegExp(rule.pattern, "g"), rule.replacement);
			continue;
		}
		result = result.split(rule.pattern).join(rule.replacement);
	}
	return result;
}

const FULL_WIDTH_REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
	[/[，；、：]/g, ", "],
	[/（/g, "("],
	[/）/g, ")"],
	[/！/g, "!"],
	[/？/g, "?"],
	[/。/g, ". "],
	[/\u3000/g, " "],
];

/** 全角标点转半角、空白折叠；换行视为标签分隔。 */
export function normalizeImagePromptPunctuation(text: string): string {
	let result = text;
	for (const [pattern, replacement] of FULL_WIDTH_REPLACEMENTS) {
		result = result.replace(pattern, replacement);
	}
	return result
		.replace(/\s*\n+\s*/g, ", ")
		.replace(/[ \t]+/g, " ")
		.replace(/\s+,/g, ",")
		.replace(/,\s*,/g, ",")
		.trim();
}

function tagKey(tag: string): string {
	return tag.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/** 按逗号拆分，归一化后去重，保持首次出现的顺序。 */
export function dedupeImageTags(text: string): string[] {
	const tags: string[] = [];
	const seen = new Set<string>();
	for (const raw of text.split(",")) {
		const tag = raw.trim().replace(/\s+/g, " ");
		if (tag.length === 0) continue;
		const key = tagKey(tag);
		if (key.length === 0 || seen.has(key)) continue;
		seen.add(key);
		tags.push(tag);
	}
	return tags;
}

/** 对一条提示词完整跑一遍后处理；返回用逗号连接的结果。 */
export function finalizeImagePrompt(
	values: readonly string[],
	rules: readonly ImageReplacementRule[],
): string {
	const joined = values
		.map((value) => value.trim())
		.filter((value) => value.length > 0)
		.join(", ");
	if (joined.length === 0) return "";
	const replaced = applyImageReplacementRules(joined, rules);
	const normalized = normalizeImagePromptPunctuation(replaced);
	return dedupeImageTags(normalized).join(", ");
}

/** 标签数组的后处理入口；与 `finalizeImagePrompt` 共用同一条管线。 */
export function finalizeImageTags(
	tags: readonly string[],
	rules: readonly ImageReplacementRule[],
): string[] {
	const text = finalizeImagePrompt(tags, rules);
	return text.length === 0 ? [] : text.split(", ");
}
