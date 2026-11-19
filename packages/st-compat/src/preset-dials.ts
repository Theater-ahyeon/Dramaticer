import type { WritingDials, WritingPresetMapping } from "@dramaticer/core";
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

/**
 * 导入预设时按条目名与内容把条目对应到写作选项；对应不上的条目按预设里的
 * 顺序拼成文风包，整体开关。标记类条目与停用的条目不参与。
 */
export function mapPresetToWritingDials(
	preset: StPreset,
	fallbackName = "预设",
): { dials: Partial<WritingDials>; mapping: WritingPresetMapping } {
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
	const prompts = preset.prompts
		.filter((prompt) => !prompt.marker && prompt.content.trim().length > 0)
		.filter((prompt) =>
			order === null
				? prompt.enabled
				: order.get(prompt.identifier)?.enabled === true,
		)
		.sort(
			(left, right) =>
				(order?.get(left.identifier)?.index ?? 0) -
				(order?.get(right.identifier)?.index ?? 0),
		);
	let dials: Partial<WritingDials> = {};
	let mapped = 0;
	const pack: string[] = [];
	for (const prompt of prompts) {
		const match = matchDial(prompt.name, prompt.content);
		if (match === null) {
			pack.push(prompt.content.trim());
			continue;
		}
		mapped += 1;
		dials = { ...dials, ...match };
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
	};
}
