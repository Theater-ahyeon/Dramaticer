import {
	type JsonObject,
	type TagLibraryCategory,
	isJsonObject,
} from "@dramaticer/core";

export interface ParsedTagLibraryEntry {
	readonly category: TagLibraryCategory;
	readonly name: string;
	readonly content: string;
	readonly keywords: readonly string[];
	readonly constant: boolean;
	readonly enabled: boolean;
	readonly priority: number;
}

export interface ParsedImageWritingEntry {
	readonly name: string;
	readonly content: string;
	readonly enabled: boolean;
	readonly order: number;
}

export interface ParsedImagePromptPreset {
	readonly tags: readonly ParsedTagLibraryEntry[];
	readonly writingEntries: readonly ParsedImageWritingEntry[];
}

const CATEGORY_ALIASES: Readonly<Record<string, TagLibraryCategory>> = {
	action: "action",
	动作: "action",
	pose: "pose",
	姿势: "pose",
	姿态: "pose",
	composition: "composition",
	构图: "composition",
	camera: "composition",
	expression: "expression",
	表情: "expression",
	clothing: "clothing",
	clothes: "clothing",
	outfit: "clothing",
	服饰: "clothing",
	服装: "clothing",
	scene: "scene",
	background: "scene",
	场景: "scene",
	背景: "scene",
	style: "style",
	风格: "style",
	画风: "style",
	other: "other",
	其他: "other",
};

function firstValue(record: JsonObject, keys: readonly string[]): unknown {
	for (const key of keys) {
		if (Object.hasOwn(record, key) && record[key] !== undefined) {
			return record[key];
		}
	}
	return undefined;
}

function stringTags(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	if (Array.isArray(value)) {
		return value
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
	}
	if (typeof value !== "string") return [];
	return value
		.split(/[、,，;；\n]+/)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function findPromptEntries(input: unknown, depth = 0): unknown[] | null {
	if (Array.isArray(input)) return input;
	if (!isJsonObject(input) || depth > 3) return null;
	const direct = firstValue(input, [
		"prompts",
		"entries",
		"items",
		"presets",
		"tags",
		"提示词",
		"条目",
	]);
	if (Array.isArray(direct)) return direct;
	for (const key of ["data", "preset", "promptPreset", "生图预设", "预设"]) {
		const nested = findPromptEntries(input[key], depth + 1);
		if (nested !== null) return nested;
	}
	return null;
}

function categoryOf(
	record: JsonObject,
	name: string,
	content: string,
): TagLibraryCategory {
	const explicit = firstValue(record, ["category", "type", "分类", "类别"]);
	if (typeof explicit === "string") {
		const mapped = CATEGORY_ALIASES[explicit.trim().toLocaleLowerCase()];
		if (mapped !== undefined) return mapped;
		const byName = CATEGORY_ALIASES[explicit.trim()];
		if (byName !== undefined) return byName;
	}
	for (const [alias, category] of Object.entries(CATEGORY_ALIASES)) {
		if (name.includes(alias) || content.includes(alias)) return category;
	}
	return "other";
}

function enabledOf(record: JsonObject): boolean {
	const enabled = firstValue(record, ["enabled", "enable", "启用"]);
	if (typeof enabled === "boolean") return enabled;
	const disabled = firstValue(record, ["disabled", "disable", "停用"]);
	if (typeof disabled === "boolean") return !disabled;
	const toggle = firstValue(record, ["switch", "on", "开关"]);
	if (typeof toggle === "boolean") return toggle;
	return true;
}

/**
 * 解析智绘姬生图提示词预设：有触发关键词的条目成为标签库条目，
 * 其余条目成为画面整理的写作条目。触发词为空不算关键词触发。
 */
export function parseImagePromptPreset(
	input: unknown,
): ParsedImagePromptPreset {
	const entries = findPromptEntries(input);
	if (entries === null) {
		throw new Error("生图预设文件里没有 prompts 或 entries 数组");
	}
	const tags: ParsedTagLibraryEntry[] = [];
	const writingEntries: ParsedImageWritingEntry[] = [];
	let order = 0;
	entries.forEach((raw, index) => {
		if (!isJsonObject(raw)) return;
		const contentValue = firstValue(raw, [
			"content",
			"prompt",
			"text",
			"value",
			"内容",
		]);
		if (typeof contentValue !== "string" || contentValue.trim().length === 0) {
			return;
		}
		const content = contentValue.trim();
		const rawName = firstValue(raw, ["name", "title", "名称", "标题"]);
		const name =
			typeof rawName === "string" && rawName.trim().length > 0
				? rawName.trim()
				: `条目 ${index + 1}`;
		const keywords = stringTags(
			firstValue(raw, [
				"keywords",
				"keys",
				"trigger",
				"triggers",
				"关键词",
				"触发词",
			]),
		);
		const enabled = enabledOf(raw);
		if (keywords.length > 0) {
			const priorityValue = firstValue(raw, ["priority", "优先级"]);
			const priority =
				typeof priorityValue === "number" && Number.isInteger(priorityValue)
					? priorityValue
					: 0;
			tags.push({
				category: categoryOf(raw, name, content),
				name,
				content,
				keywords,
				constant: firstValue(raw, ["constant", "always", "常驻"]) === true,
				enabled,
				priority,
			});
			return;
		}
		writingEntries.push({
			name,
			content,
			enabled,
			order: order++,
		});
	});
	return { tags, writingEntries };
}
