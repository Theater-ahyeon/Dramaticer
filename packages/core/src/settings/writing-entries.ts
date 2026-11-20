import { type JsonValue, isJsonObject } from "../json.js";
import type { LlmMessage, LlmRole } from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";

/**
 * 写作条目：玩家或导入的写作指令，按位置与角色放进本轮上下文。
 * - `before-history`：系统设定之后、第一条历史消息之前；
 * - `after-history`：全部历史之后、紧贴生成位置；
 * - `in-history`：插在历史里，`depth` 是它后面还有几条历史消息（0 等于最末尾）。
 */
export const WRITING_ENTRY_PLACEMENTS = [
	"before-history",
	"after-history",
	"in-history",
] as const;

export type WritingEntryPlacement = (typeof WRITING_ENTRY_PLACEMENTS)[number];

export interface WritingEntry {
	readonly id: string;
	readonly name: string;
	readonly content: string;
	readonly role: LlmRole;
	readonly placement: WritingEntryPlacement;
	/** 只对 `in-history` 有意义；其余位置为 0。 */
	readonly depth: number;
	/** 同一位置（同一深度）里从小到大排列。 */
	readonly order: number;
	readonly enabled: boolean;
}

/** 只防失控：条数、单条与总字数的上限。 */
export const MAX_WRITING_ENTRIES = 64;
export const MAX_WRITING_ENTRY_CHARS = 8000;
export const MAX_WRITING_ENTRIES_TOTAL_CHARS = 32000;
export const MAX_WRITING_ENTRY_DEPTH = 1000;

const KV_ENTRIES = "writing.entries";
const ROLES: readonly LlmRole[] = ["system", "user", "assistant"];

function isPlacement(value: unknown): value is WritingEntryPlacement {
	return (
		typeof value === "string" &&
		(WRITING_ENTRY_PLACEMENTS as readonly string[]).includes(value)
	);
}

function isRole(value: unknown): value is LlmRole {
	return (
		typeof value === "string" && (ROLES as readonly string[]).includes(value)
	);
}

/** 校验一组写作条目；不合法时抛出带字段位置的错误。 */
export function assertWritingEntries(
	value: unknown,
	label = "写作条目",
): WritingEntry[] {
	if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
	if (value.length > MAX_WRITING_ENTRIES) {
		throw new Error(`${label} 最多 ${MAX_WRITING_ENTRIES} 条`);
	}
	const ids = new Set<string>();
	let total = 0;
	return value.map((raw, index): WritingEntry => {
		const at = `${label}[${index}]`;
		if (!isJsonObject(raw)) throw new Error(`${at} 必须是对象`);
		const id = typeof raw.id === "string" ? raw.id.trim() : "";
		if (id.length === 0) throw new Error(`${at}.id 必须是非空字符串`);
		if (ids.has(id)) throw new Error(`${at}.id 重复：${id}`);
		ids.add(id);
		const name = typeof raw.name === "string" ? raw.name.trim() : "";
		if (typeof raw.content !== "string" || raw.content.trim().length === 0) {
			throw new Error(`${at}.content 必须是非空字符串`);
		}
		if (raw.content.length > MAX_WRITING_ENTRY_CHARS) {
			throw new Error(`${at}.content 不能超过 ${MAX_WRITING_ENTRY_CHARS} 字`);
		}
		total += raw.content.length;
		if (total > MAX_WRITING_ENTRIES_TOTAL_CHARS) {
			throw new Error(
				`${label} 的总字数不能超过 ${MAX_WRITING_ENTRIES_TOTAL_CHARS}`,
			);
		}
		const role = raw.role ?? "system";
		if (!isRole(role)) {
			throw new Error(`${at}.role 只能是 system、user 或 assistant`);
		}
		const placement = raw.placement;
		if (!isPlacement(placement)) {
			throw new Error(
				`${at}.placement 只能是 ${WRITING_ENTRY_PLACEMENTS.join("、")}`,
			);
		}
		const depth = raw.depth ?? 0;
		if (
			typeof depth !== "number" ||
			!Number.isInteger(depth) ||
			depth < 0 ||
			depth > MAX_WRITING_ENTRY_DEPTH
		) {
			throw new Error(
				`${at}.depth 必须是 0 到 ${MAX_WRITING_ENTRY_DEPTH} 之间的整数`,
			);
		}
		const order = raw.order ?? 0;
		if (typeof order !== "number" || !Number.isFinite(order)) {
			throw new Error(`${at}.order 必须是数字`);
		}
		const enabled = raw.enabled ?? true;
		if (typeof enabled !== "boolean") {
			throw new Error(`${at}.enabled 必须是布尔值`);
		}
		return {
			id,
			name: name.length === 0 ? `条目 ${index + 1}` : name,
			content: raw.content,
			role,
			placement,
			depth: placement === "in-history" ? depth : 0,
			order,
			enabled,
		};
	});
}

/** 故事保存的写作条目；没有或数据损坏时返回空数组。 */
export function readWritingEntries(
	store: StoryStore,
	storyId: string,
): WritingEntry[] {
	const value = store.getStoryValue(storyId, KV_ENTRIES);
	if (value === null) return [];
	try {
		return assertWritingEntries(value);
	} catch {
		return [];
	}
}

/** 整体替换故事的写作条目；空数组表示清空。 */
export function writeWritingEntries(
	store: StoryStore,
	storyId: string,
	entries: unknown,
): WritingEntry[] {
	const clean = assertWritingEntries(entries);
	store.setStoryValue(
		storyId,
		KV_ENTRIES,
		clean.length === 0 ? null : (clean as unknown as JsonValue),
	);
	return clean;
}

export interface WritingEntryTrace {
	readonly source: string;
	readonly text: string;
}

const PLACEMENT_LABELS: Readonly<Record<WritingEntryPlacement, string>> = {
	"before-history": "历史之前",
	"after-history": "历史之后",
	"in-history": "历史中",
};

function traceSource(entry: WritingEntry): string {
	const where =
		entry.placement === "in-history"
			? `${PLACEMENT_LABELS[entry.placement]}·深度 ${entry.depth}`
			: PLACEMENT_LABELS[entry.placement];
	return `writing:条目 ${entry.name}（${where}）`;
}

/**
 * 把启用的写作条目插进本轮消息。历史指非 system 消息；开头连续的 system
 * 消息视为设定区。原有消息的相对顺序不变，只在它们之间插入。
 */
export function applyWritingEntries(
	messages: readonly LlmMessage[],
	entries: readonly WritingEntry[],
): { messages: LlmMessage[]; trace: WritingEntryTrace[] } {
	const active = entries
		.map((entry, index) => ({ entry, index }))
		.filter(({ entry }) => entry.enabled && entry.content.trim().length > 0)
		.sort(
			(left, right) =>
				left.entry.order - right.entry.order || left.index - right.index,
		)
		.map(({ entry }) => entry);
	if (active.length === 0) {
		return { messages: [...messages], trace: [] };
	}
	let historyStart = messages.findIndex((message) => message.role !== "system");
	if (historyStart === -1) historyStart = messages.length;
	// 每个插入点（原消息的下标，插在该下标之前）收集要插入的条目。
	const inserts = new Map<number, WritingEntry[]>();
	const add = (at: number, entry: WritingEntry): void => {
		const list = inserts.get(at);
		if (list === undefined) inserts.set(at, [entry]);
		else list.push(entry);
	};
	const historyIndexes: number[] = [];
	for (let i = historyStart; i < messages.length; i++) {
		if (messages[i]?.role !== "system") historyIndexes.push(i);
	}
	// 深度大的排在前面，同深度按 order；先插的在前。
	const deepFirst = [...active].sort((left, right) => {
		const rank = (entry: WritingEntry): number =>
			entry.placement === "before-history"
				? Number.POSITIVE_INFINITY
				: entry.placement === "after-history"
					? -1
					: entry.depth;
		return rank(right) - rank(left);
	});
	for (const entry of deepFirst) {
		if (entry.placement === "before-history") {
			add(historyStart, entry);
		} else if (entry.placement === "after-history") {
			add(messages.length, entry);
		} else if (entry.depth === 0) {
			add(messages.length, entry);
		} else {
			const target = historyIndexes.length - entry.depth;
			add(
				target <= 0
					? historyStart
					: (historyIndexes[target] ?? messages.length),
				entry,
			);
		}
	}
	const result: LlmMessage[] = [];
	const trace: WritingEntryTrace[] = [];
	const flush = (at: number): void => {
		for (const entry of inserts.get(at) ?? []) {
			result.push({ role: entry.role, content: entry.content });
			trace.push({ source: traceSource(entry), text: entry.content });
		}
	};
	for (let i = 0; i < messages.length; i++) {
		flush(i);
		const message = messages[i];
		if (message !== undefined) result.push(message);
	}
	flush(messages.length);
	return { messages: result, trace };
}
