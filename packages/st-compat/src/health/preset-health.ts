import { parsePresetFile } from "../preset.js";
import type { StPreset } from "../preset.js";
import type { TokenEstimator } from "./token-estimate.js";
import { createTokenEstimator } from "./token-estimate.js";

export interface MacroUse {
	readonly name: string;
	readonly count: number;
	readonly presetCount: number;
}

export interface PlacementCount {
	readonly placement: number;
	readonly label: string;
	readonly scriptCount: number;
}

export interface SubstituteRegexCount {
	readonly value: number;
	readonly label: string;
	readonly scriptCount: number;
}

export interface PresetHealth {
	readonly presetCount: number;
	readonly promptCount: number;
	readonly enabledPromptCount: number;
	readonly markerPromptCount: number;
	readonly promptContentBytes: number;
	readonly promptContentTokens: number;
	readonly presetsWithAssistantPrefill: number;
	readonly macros: readonly MacroUse[];
	readonly unrecognizedMacroOccurrences: number;
	readonly regexScriptCount: number;
	readonly disabledRegexScriptCount: number;
	readonly markdownOnlyCount: number;
	readonly promptOnlyCount: number;
	readonly runOnEditCount: number;
	readonly depthLimitedCount: number;
	readonly placements: readonly PlacementCount[];
	readonly substituteRegex: readonly SubstituteRegexCount[];
}

const PLACEMENT_LABELS: Record<number, string> = {
	0: "MD_DISPLAY（已弃用）",
	1: "USER_INPUT",
	2: "AI_OUTPUT",
	3: "SLASH_COMMAND",
	4: "SEND_AS（旧版）",
	5: "WORLD_INFO",
	6: "REASONING",
};

const SUBSTITUTE_LABELS: Record<number, string> = {
	0: "NONE",
	1: "RAW",
	2: "ESCAPED",
};

export interface MacroScan {
	readonly counts: ReadonlyMap<string, number>;
	/** 名字不是英文字母开头的标识符、也不是注释的 `{{...}}` 出现次数。 */
	readonly unrecognized: number;
}

/** 统计每个宏在预设 prompt 正文里出现的次数，以及无法识别的 `{{...}}` 次数。 */
export function scanMacros(text: string): MacroScan {
	const counts = new Map<string, number>();
	let unrecognized = 0;
	for (const match of text.matchAll(/\{\{([^{}]*?)\}\}/g)) {
		const name = macroName(match[1]);
		if (name === null) {
			unrecognized += 1;
			continue;
		}
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return { counts, unrecognized };
}

export function countMacros(text: string): ReadonlyMap<string, number> {
	return scanMacros(text).counts;
}

export function analyzePresets(
	presets: readonly StPreset[],
	tokenEstimator: TokenEstimator = createTokenEstimator(),
): PresetHealth {
	let promptCount = 0;
	let enabledPromptCount = 0;
	let markerPromptCount = 0;
	let promptContentBytes = 0;
	let promptContentTokens = 0;
	let presetsWithAssistantPrefill = 0;
	let unrecognizedMacroOccurrences = 0;
	const macroCounts = new Map<string, number>();
	const macroPresets = new Map<string, Set<number>>();
	let regexScriptCount = 0;
	let disabledRegexScriptCount = 0;
	let markdownOnlyCount = 0;
	let promptOnlyCount = 0;
	let runOnEditCount = 0;
	let depthLimitedCount = 0;
	const placementCounts = new Map<number, number>();
	const substituteCounts = new Map<number, number>();

	for (const [presetIndex, preset] of presets.entries()) {
		if (preset.assistantPrefill !== null && preset.assistantPrefill !== "") {
			presetsWithAssistantPrefill += 1;
		}
		for (const prompt of preset.prompts) {
			promptCount += 1;
			if (prompt.enabled) enabledPromptCount += 1;
			if (prompt.marker) markerPromptCount += 1;
			const bytes = Buffer.byteLength(prompt.content, "utf8");
			promptContentBytes += bytes;
			promptContentTokens += tokenEstimator(prompt.content);
			const scan = scanMacros(prompt.content);
			unrecognizedMacroOccurrences += scan.unrecognized;
			for (const [name, count] of scan.counts) {
				macroCounts.set(name, (macroCounts.get(name) ?? 0) + count);
				let set = macroPresets.get(name);
				if (!set) {
					set = new Set();
					macroPresets.set(name, set);
				}
				set.add(presetIndex);
			}
		}
		for (const script of preset.regexScripts) {
			regexScriptCount += 1;
			if (script.disabled) disabledRegexScriptCount += 1;
			if (script.markdownOnly) markdownOnlyCount += 1;
			if (script.promptOnly) promptOnlyCount += 1;
			if (script.runOnEdit) runOnEditCount += 1;
			if (script.minDepth !== null || script.maxDepth !== null) {
				depthLimitedCount += 1;
			}
			for (const placement of script.placement) {
				placementCounts.set(
					placement,
					(placementCounts.get(placement) ?? 0) + 1,
				);
			}
			if (script.substituteRegex !== null) {
				substituteCounts.set(
					script.substituteRegex,
					(substituteCounts.get(script.substituteRegex) ?? 0) + 1,
				);
			}
		}
	}

	const macros = [...macroCounts.entries()]
		.map(([name, count]) => ({
			name,
			count,
			presetCount: macroPresets.get(name)?.size ?? 0,
		}))
		.sort(
			(left, right) =>
				right.count - left.count || left.name.localeCompare(right.name),
		);

	const placements = [...placementCounts.entries()]
		.map(([placement, scriptCount]) => ({
			placement,
			label: PLACEMENT_LABELS[placement] ?? `UNKNOWN_${placement}`,
			scriptCount,
		}))
		.sort((left, right) => left.placement - right.placement);

	const substituteRegex = [...substituteCounts.entries()]
		.map(([value, scriptCount]) => ({
			value,
			label: SUBSTITUTE_LABELS[value] ?? `UNKNOWN_${value}`,
			scriptCount,
		}))
		.sort((left, right) => left.value - right.value);

	return {
		presetCount: presets.length,
		promptCount,
		enabledPromptCount,
		markerPromptCount,
		promptContentBytes,
		promptContentTokens,
		presetsWithAssistantPrefill,
		macros,
		unrecognizedMacroOccurrences,
		regexScriptCount,
		disabledRegexScriptCount,
		markdownOnlyCount,
		promptOnlyCount,
		runOnEditCount,
		depthLimitedCount,
		placements,
		substituteRegex,
	};
}

export async function analyzePresetFiles(
	paths: readonly string[],
	tokenEstimator: TokenEstimator = createTokenEstimator(),
): Promise<PresetHealth> {
	const presets: StPreset[] = [];
	for (const path of paths) {
		presets.push(await parsePresetFile(path));
	}
	return analyzePresets(presets, tokenEstimator);
}

function macroName(raw: string): string | null {
	const trimmed = raw.trim();
	if (trimmed.startsWith("//")) return "//";
	const [head] = trimmed.split("::");
	const token = head.trim().split(/[\s:：]+/)[0] ?? "";
	const normalized = token.toLowerCase();
	return /^[a-z_][a-z0-9_]*$/.test(normalized) ? normalized : null;
}
