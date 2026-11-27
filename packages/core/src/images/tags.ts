import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import {
	TAG_LIBRARY_CATEGORIES,
	type TagLibraryCategory,
	type TagLibraryScope,
	isTagLibraryCategory,
	isTagLibraryScope,
} from "./vocabulary.js";

/** 标签库条目：与写作条目同构，按关键词触发进画面整理。 */
export interface TagLibraryEntry {
	readonly id: string;
	/** 全局条目的 storyId 为 null；故事条目必须指向一个故事。 */
	readonly storyId: string | null;
	readonly scope: TagLibraryScope;
	readonly category: TagLibraryCategory;
	readonly name: string;
	readonly content: string;
	readonly keywords: readonly string[];
	/** 常驻条目不看关键词，每次都进整理输入。 */
	readonly constant: boolean;
	readonly enabled: boolean;
	/** 同分类里从大到小；导入默认 0。 */
	readonly priority: number;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface TagLibraryEntryInput {
	readonly id?: string;
	readonly storyId?: string | null;
	readonly scope?: TagLibraryScope;
	readonly category: TagLibraryCategory;
	readonly name: string;
	readonly content: string;
	readonly keywords?: readonly string[];
	readonly constant?: boolean;
	readonly enabled?: boolean;
	readonly priority?: number;
	readonly createdAt?: string;
	readonly updatedAt?: string;
}

export interface SaveTagLibraryEntriesInput {
	readonly storyId: string;
	readonly entries: readonly TagLibraryEntryInput[];
}

export interface TagLibraryEntryMetadata {
	readonly id: string;
	readonly storyId: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

const TAG_ENTRY_FIELDS = [
	"id",
	"storyId",
	"scope",
	"category",
	"name",
	"content",
	"keywords",
	"constant",
	"enabled",
	"priority",
	"createdAt",
	"updatedAt",
] as const;

function requireText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}

function requireKeywordList(value: unknown, label: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组`);
	return value.map((item, index) => requireText(item, `${label}[${index}]`));
}

function requireFlag(
	value: unknown,
	fallback: boolean,
	label: string,
): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== "boolean") throw new Error(`${label} 必须是布尔值`);
	return value;
}

/** 把客户端或数据库里的条目整理成完整形状；元数据缺省时用调用方给的。 */
export function normalizeTagLibraryEntry(
	value: unknown,
	metadata: TagLibraryEntryMetadata,
	label = "标签库条目",
): TagLibraryEntry {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, TAG_ENTRY_FIELDS, label);
	if (!isTagLibraryCategory(record.category)) {
		throw new Error(
			`${label}.category 只能是 ${TAG_LIBRARY_CATEGORIES.join("、")}`,
		);
	}
	const storyIdRaw =
		record.storyId === undefined ? metadata.storyId : record.storyId;
	let storyId: string | null;
	if (storyIdRaw === null) {
		storyId = null;
	} else {
		storyId = requireText(storyIdRaw, `${label}.storyId`);
	}
	const scope = record.scope ?? (storyId === null ? "global" : "story");
	if (!isTagLibraryScope(scope)) {
		throw new Error(`${label}.scope 只能是 story 或 global`);
	}
	if (scope === "global" && storyId !== null) {
		throw new Error(`${label} 的全局条目不能同时属于某个故事`);
	}
	if (scope === "story" && storyId === null) {
		throw new Error(`${label} 的故事条目必须给出 storyId`);
	}
	const priority = record.priority ?? 0;
	if (
		typeof priority !== "number" ||
		!Number.isInteger(priority) ||
		Math.abs(priority) > 1_000_000
	) {
		throw new Error(`${label}.priority 必须是绝对值不超过 1000000 的整数`);
	}
	return {
		id: requireText(record.id ?? metadata.id, `${label}.id`),
		storyId,
		scope,
		category: record.category,
		name: requireText(record.name, `${label}.name`),
		content: requireText(record.content, `${label}.content`),
		keywords: requireKeywordList(record.keywords, `${label}.keywords`),
		constant: requireFlag(record.constant, false, `${label}.constant`),
		enabled: requireFlag(record.enabled, true, `${label}.enabled`),
		priority,
		createdAt:
			typeof record.createdAt === "string" && record.createdAt.trim().length > 0
				? record.createdAt.trim()
				: metadata.createdAt,
		updatedAt:
			typeof record.updatedAt === "string" && record.updatedAt.trim().length > 0
				? record.updatedAt.trim()
				: metadata.updatedAt,
	};
}

export function assertUniqueTagLibraryEntries(
	entries: readonly TagLibraryEntry[],
	label = "标签库条目",
): void {
	const ids = new Set<string>();
	entries.forEach((entry, index) => {
		if (ids.has(entry.id)) {
			throw new Error(`${label}[${index}].id 重复：${entry.id}`);
		}
		ids.add(entry.id);
	});
}

const CATEGORY_ORDER = new Map<TagLibraryCategory, number>(
	TAG_LIBRARY_CATEGORIES.map((category, index) => [category, index]),
);

export function sortTagLibraryEntries(
	entries: readonly TagLibraryEntry[],
): TagLibraryEntry[] {
	return [...entries].sort((left, right) => {
		const category =
			(CATEGORY_ORDER.get(left.category) ?? 0) -
			(CATEGORY_ORDER.get(right.category) ?? 0);
		if (category !== 0) return category;
		if (left.priority !== right.priority) return right.priority - left.priority;
		return left.name.localeCompare(right.name, "zh-Hans-CN");
	});
}

/** 条目是否被这段正文触发；常驻条目直接命中。 */
export function tagLibraryEntryMatches(
	entry: TagLibraryEntry,
	sourceText: string,
): boolean {
	if (!entry.enabled) return false;
	if (entry.constant) return true;
	const text = sourceText.normalize("NFKC").toLocaleLowerCase();
	for (const keyword of entry.keywords) {
		const needle = keyword.trim().normalize("NFKC").toLocaleLowerCase();
		if (needle.length > 0 && text.includes(needle)) return true;
	}
	return false;
}

/**
 * 按正文挑出要进画面整理的条目：启用的，且常驻或任一关键词命中。
 * 返回顺序为分类、优先级、名称。
 */
export function matchTagLibraryEntries(
	entries: readonly TagLibraryEntry[],
	sourceText: string,
): TagLibraryEntry[] {
	return sortTagLibraryEntries(
		entries.filter((entry) => tagLibraryEntryMatches(entry, sourceText)),
	);
}

/** 把命中的条目按分类分组；画面整理按这个顺序拼提示词。 */
export function groupTagLibraryEntries(entries: readonly TagLibraryEntry[]): {
	readonly category: TagLibraryCategory;
	readonly entries: TagLibraryEntry[];
}[] {
	const groups = new Map<TagLibraryCategory, TagLibraryEntry[]>();
	for (const entry of sortTagLibraryEntries(entries)) {
		const list = groups.get(entry.category);
		if (list === undefined) groups.set(entry.category, [entry]);
		else list.push(entry);
	}
	return [...groups].map(([category, list]) => ({ category, entries: list }));
}
