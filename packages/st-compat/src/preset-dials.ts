import {
	type LlmRole,
	MAX_WRITING_ENTRIES,
	MAX_WRITING_ENTRIES_TOTAL_CHARS,
	MAX_WRITING_ENTRY_CHARS,
	MAX_WRITING_ENTRY_DEPTH,
	type WritingDials,
	type WritingEntry,
	type WritingPresetMapping,
} from "@dramaticer/core";
import { type StPreset, selectStPromptOrderGroup } from "./preset.js";

/** 文风包最多带进上下文的字数；只防失控。 */
const MAX_PACK_CHARS = 8000;

/** 一条预设条目能对应上的写作选项；对应不上时返回 null，条目进文风包。 */
function matchDial(
	name: string,
	content: string,
): Partial<WritingDials> | null {
	const title = name.toLowerCase();
	const text = `${name}\n${content}`;
	if (
		/不要?(替|代)(用户|玩家|user|\{\{user\}\}).{0,12}(说话|发言|行动|决定)|禁止抢话|防抢话|不抢话/i.test(
			text,
		)
	) {
		return { actForMe: false };
	}
	if (/第一人称/.test(text)) return { person: "first" };
	if (/第三人称/.test(text)) return { person: "third" };
	if (/第二人称/.test(text)) return { person: "second" };
	if (/字数|篇幅|长度|word ?count/i.test(title)) {
		const numbers = [
			...content.matchAll(/(\d{2,5})\s*(字|words?|tokens?)/gi),
		].map((match) => Number(match[1]));
		const target = numbers.length === 0 ? null : Math.max(...numbers);
		if (target === null) return /长/.test(title) ? { length: "long" } : null;
		return {
			length: target >= 800 ? "long" : target <= 300 ? "short" : "medium",
		};
	}
	if (/慢节奏|慢热|放慢节奏/.test(text)) return { pace: "slow" };
	if (/快节奏|加快节奏|推进剧情/.test(title)) return { pace: "fast" };
	if (/全年龄|sfw|收敛|清水/i.test(title)) return { rating: "restrained" };
	if (/nsfw|r18|成人|限制级/i.test(title)) return { rating: "card" };
	if (/思维链|cot\b|chain of thought|思考/i.test(title))
		return { thinking: "high" };
	if (/文风|风格|笔触|style/i.test(title)) {
		if (/冷峻|克制|白描|简洁|冷叙述/.test(content)) return { style: "cold" };
		if (/细腻|华丽|感官|细致/.test(content)) return { style: "rich" };
		if (/口语|轻松|日常|俏皮/.test(content)) return { style: "spoken" };
	}
	return null;
}

export interface PresetNames {
	/** 角色名；替换条目里的 {{char}}。 */
	readonly char?: string;
	/** 玩家角色名；替换条目里的 {{user}}。 */
	readonly user?: string;
}

const DEPTH_INJECTION_POSITION = 1;
const DEFAULT_INJECTION_DEPTH = 4;
const DEFAULT_INJECTION_ORDER = 100;
const ROLE_MAP: Readonly<Record<string, LlmRole>> = {
	system: "system",
	user: "user",
	assistant: "assistant",
	model: "assistant",
};

/** 替换名字宏，去掉注释与 trim 宏；返回替换后的正文与仍未识别的宏数。 */
function expandPresetText(
	content: string,
	names: PresetNames,
): { text: string; unresolved: number } {
	let unresolved = 0;
	const text = content
		.replace(/\{\{\s*\/\/[\s\S]*?\}\}/g, "")
		.replace(/\{\{\s*trim\s*\}\}/gi, "")
		.replace(
			/\{\{\s*(char|user)\s*\}\}|<(BOT|USER)>/gi,
			(whole, macro, tag) => {
				const key = String(macro ?? tag).toLowerCase();
				const name = key === "char" || key === "bot" ? names.char : names.user;
				if (name === undefined || name.trim().length === 0) {
					return key === "char" || key === "bot" ? "角色" : "玩家";
				}
				return name;
			},
		)
		.replace(/\{\{[^{}]*\}\}/g, (whole) => {
			unresolved += 1;
			return whole;
		})
		.trim();
	return { text, unresolved };
}

/**
 * 把一份预设映射到原生写作设置：能对应到写作选项的条目改选项；
 * 对应不上的条目成为写作条目，保留它在预设里的位置与角色——
 * 按深度注入的放进历史中的对应深度，其余按在历史标记之前或之后放置。
 * 同时保留旧的文风包正文，供没有写作条目的旧故事显示。标记类条目与停用的条目不参与。
 */
export function mapPresetToWritingDials(
	preset: StPreset,
	fallbackName = "预设",
	names: PresetNames = {},
): {
	dials: Partial<WritingDials>;
	mapping: WritingPresetMapping;
	entries: WritingEntry[];
	report: {
		readonly inHistory: number;
		readonly unresolvedMacros: number;
		readonly dropped: number;
	};
} {
	const group = selectStPromptOrderGroup(preset);
	const order =
		group === undefined
			? null
			: new Map(
					group.order.map(
						(entry, index) =>
							[entry.identifier, { enabled: entry.enabled, index }] as const,
					),
				);
	const positionOf = (identifier: string, fallback: number): number =>
		order?.get(identifier)?.index ?? fallback;
	const historyIndex =
		order === null ? null : (order.get("chatHistory")?.index ?? null);
	const prompts = preset.prompts
		.map((prompt, index) => ({ prompt, index }))
		.filter(({ prompt }) => !prompt.marker && prompt.content.trim().length > 0)
		.filter(({ prompt }) =>
			order === null
				? prompt.enabled
				: order.get(prompt.identifier)?.enabled === true,
		)
		.sort(
			(left, right) =>
				positionOf(left.prompt.identifier, left.index) -
				positionOf(right.prompt.identifier, right.index),
		);
	let dials: Partial<WritingDials> = {};
	let mapped = 0;
	const pack: string[] = [];
	const entries: WritingEntry[] = [];
	let total = 0;
	let inHistory = 0;
	let unresolvedMacros = 0;
	let dropped = 0;
	for (const { prompt, index } of prompts) {
		const match = matchDial(prompt.name, prompt.content);
		if (match !== null) {
			mapped += 1;
			dials = { ...dials, ...match };
			continue;
		}
		pack.push(prompt.content.trim());
		const expanded = expandPresetText(prompt.content, names);
		if (expanded.text.length === 0) continue;
		const text = expanded.text.slice(0, MAX_WRITING_ENTRY_CHARS);
		if (
			entries.length >= MAX_WRITING_ENTRIES ||
			total + text.length > MAX_WRITING_ENTRIES_TOTAL_CHARS
		) {
			dropped += 1;
			continue;
		}
		total += text.length;
		unresolvedMacros += expanded.unresolved;
		const position = positionOf(prompt.identifier, index);
		const role =
			prompt.role === null ? "system" : (ROLE_MAP[prompt.role] ?? "system");
		const deep = prompt.injectionPosition === DEPTH_INJECTION_POSITION;
		if (deep) inHistory += 1;
		entries.push({
			id: `preset-${entries.length + 1}-${prompt.identifier}`.slice(0, 120),
			name:
				prompt.name.trim().length > 0 ? prompt.name.trim() : prompt.identifier,
			content: text,
			role,
			placement: deep
				? "in-history"
				: historyIndex !== null && position > historyIndex
					? "after-history"
					: "before-history",
			depth: deep
				? Math.min(
						Math.max(
							0,
							Math.trunc(prompt.injectionDepth ?? DEFAULT_INJECTION_DEPTH),
						),
						MAX_WRITING_ENTRY_DEPTH,
					)
				: 0,
			order: deep
				? (prompt.injectionOrder ?? DEFAULT_INJECTION_ORDER)
				: position,
			enabled: true,
			scope: "turn",
		});
	}
	const packText = pack.join("\n\n");
	return {
		dials,
		mapping: {
			name: preset.name ?? fallbackName,
			total: prompts.length,
			mapped,
			packCount: pack.length,
			packText:
				packText.length > MAX_PACK_CHARS
					? packText.slice(0, MAX_PACK_CHARS)
					: packText,
		},
		entries,
		report: { inHistory, unresolvedMacros, dropped },
	};
}
