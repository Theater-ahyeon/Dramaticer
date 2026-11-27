import { scanSandboxDomains } from "@dramaticer/core";
import type { StCharacterCard } from "../character-card.js";
import type { StRegexScript } from "../preset.js";
import {
	ST_REGEX_PLACEMENT,
	parseStRegexScript,
	runStRegexScript,
	stRegexForScript,
} from "../st-content/regex.js";

/** 显示层可用的正则位置：markdown 显示与 AI 输出。 */
const DISPLAY_PLACEMENTS: readonly number[] = [
	ST_REGEX_PLACEMENT.markdownDisplay,
	ST_REGEX_PLACEMENT.aiOutput,
];

/** 从卡里挑出来、只用于显示的美化正则。 */
export interface StDisplayRegex {
	readonly id: string;
	readonly name: string;
	readonly findRegex: string;
	readonly replaceString: string;
	readonly trimStrings: readonly string[];
	readonly substituteRegex: number | null;
}

function isDisplayScript(script: StRegexScript): boolean {
	if (script.disabled || script.promptOnly) return false;
	return (
		script.markdownOnly ||
		script.placement.some((placement) => DISPLAY_PLACEMENTS.includes(placement))
	);
}

function toDisplayRegex(script: StRegexScript, index: number): StDisplayRegex {
	return {
		id: script.id.length > 0 ? script.id : `regex-${index + 1}`,
		name:
			script.scriptName.length > 0 ? script.scriptName : `正则 ${index + 1}`,
		findRegex: script.findRegex,
		replaceString: script.replaceString,
		trimStrings: [...script.trimStrings],
		substituteRegex: script.substituteRegex,
	};
}

/**
 * 卡的 `extensions.regex_scripts` 与预设的显示层正则。卡里的脚本照酒馆的
 * 顺序在前，预设的在后；禁用的、只改 prompt 的与作用位置不在显示层的都跳过。
 */
export function collectStDisplayRegexes(
	card: StCharacterCard,
	presetScripts: readonly StRegexScript[] = [],
): StDisplayRegex[] {
	const raw = card.extensions.regex_scripts;
	if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
		throw new Error("角色卡 extensions.regex_scripts 必须是数组");
	}
	const fromCard = (raw ?? [])
		.map((item) => parseStRegexScript(item))
		.filter((item): item is StRegexScript => item !== null);
	return toStDisplayRegexes([...fromCard, ...presetScripts]);
}

/** 已经解析过的正则脚本里挑出显示层的一部分。 */
export function toStDisplayRegexes(
	scripts: readonly StRegexScript[],
): StDisplayRegex[] {
	return scripts.filter(isDisplayScript).map(toDisplayRegex);
}

/** 把保存下来的条目还原成酒馆执行器认识的结构。 */
export function toDisplayRegexScript(entry: StDisplayRegex): StRegexScript {
	return {
		id: entry.id,
		scriptName: entry.name,
		findRegex: entry.findRegex,
		replaceString: entry.replaceString,
		trimStrings: [...entry.trimStrings],
		placement: [ST_REGEX_PLACEMENT.aiOutput],
		disabled: false,
		markdownOnly: false,
		promptOnly: false,
		runOnEdit: false,
		substituteRegex: entry.substituteRegex,
		minDepth: null,
		maxDepth: null,
		raw: {},
	};
}

/** 认领楼层用的正则；脚本里的正则写不出来时返回 null。 */
export function displayRegexPattern(entry: StDisplayRegex): RegExp | null {
	return stRegexForScript(toDisplayRegexScript(entry));
}

/**
 * 按顺序执行显示层正则。`applied` 表示至少有一条命中，渲染器据此决定
 * 把结果当作 HTML 还是纯文本。
 */
export function applyStDisplayRegexes(
	raw: string,
	entries: readonly StDisplayRegex[],
	characterName: string,
): { readonly text: string; readonly applied: boolean } {
	let text = raw;
	let applied = false;
	for (const entry of entries) {
		const script = toDisplayRegexScript(entry);
		const regex = stRegexForScript(script);
		if (regex === null) continue;
		regex.lastIndex = 0;
		if (!regex.test(text)) continue;
		text = runStRegexScript(script, text, { characterName });
		applied = true;
	}
	return { text, applied };
}

/** 正则与替换里的外部域名；用于导入卡时的联网检测。 */
export function scanDisplayRegexDomains(
	entries: readonly StDisplayRegex[],
): string[] {
	const found = new Set<string>();
	for (const entry of entries) {
		for (const text of [
			entry.findRegex,
			entry.replaceString,
			...entry.trimStrings,
		]) {
			for (const domain of scanSandboxDomains(text)) found.add(domain);
		}
	}
	return [...found].sort();
}
