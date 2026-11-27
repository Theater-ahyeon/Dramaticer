import { isJsonObject } from "@dramaticer/core";
import type { StRegexScript } from "../preset.js";
import { type StMacroSubstitute, createStMacroEngine } from "./macros.js";

/** 正则脚本在酒馆里的作用位置。 */
export const ST_REGEX_PLACEMENT = {
	markdownDisplay: 0,
	userInput: 1,
	aiOutput: 2,
	slashCommand: 3,
	worldInfo: 5,
	reasoning: 6,
} as const;

export type StRegexPlacement =
	(typeof ST_REGEX_PLACEMENT)[keyof typeof ST_REGEX_PLACEMENT];

/** `substituteRegex` 的取值。 */
export const ST_SUBSTITUTE_REGEX = {
	none: 0,
	raw: 1,
	escaped: 2,
} as const;

/** 三个来源与酒馆的 `SCRIPT_TYPES` 一致：全局、角色卡、预设。 */
export interface StRegexSources {
	readonly global?: readonly unknown[];
	readonly scoped?: readonly unknown[];
	readonly preset?: readonly unknown[];
	/** 角色卡正则只有玩家允许后才执行。 */
	readonly allowScoped?: boolean;
	/** 预设正则只有玩家允许后才执行。 */
	readonly allowPreset?: boolean;
}

export interface StRegexOptions {
	readonly scripts: readonly StRegexScript[];
	readonly isMarkdown?: boolean;
	readonly isPrompt?: boolean;
	readonly isEdit?: boolean;
	readonly depth?: number;
	readonly characterName?: string;
	readonly substitute?: StMacroSubstitute;
}

function readRawString(
	raw: Record<string, unknown>,
	key: string,
	fallback = "",
): string {
	const value = raw[key];
	return typeof value === "string" ? value : fallback;
}

function readRawBoolean(
	raw: Record<string, unknown>,
	key: string,
	fallback: boolean,
): boolean {
	const value = raw[key];
	return typeof value === "boolean" ? value : fallback;
}

/** 解析一条正则脚本；缺少 `findRegex` 时无法执行，返回 null。 */
export function parseStRegexScript(raw: unknown): StRegexScript | null {
	if (!isJsonObject(raw)) return null;
	const findRegex = raw.findRegex;
	if (typeof findRegex !== "string" || findRegex.length === 0) return null;
	const trimStrings = Array.isArray(raw.trimStrings)
		? raw.trimStrings.filter((item): item is string => typeof item === "string")
		: [];
	const placement = Array.isArray(raw.placement)
		? raw.placement.filter(
				(item): item is number =>
					typeof item === "number" && Number.isFinite(item),
			)
		: [];
	return {
		id: readRawString(raw, "id"),
		scriptName: readRawString(raw, "scriptName"),
		findRegex,
		replaceString: readRawString(raw, "replaceString"),
		trimStrings,
		placement,
		disabled: readRawBoolean(raw, "disabled", false),
		markdownOnly: readRawBoolean(raw, "markdownOnly", false),
		promptOnly: readRawBoolean(raw, "promptOnly", false),
		runOnEdit: readRawBoolean(raw, "runOnEdit", false),
		substituteRegex: readRawDepth(raw.substituteRegex),
		minDepth: readRawDepth(raw.minDepth),
		maxDepth: readRawDepth(raw.maxDepth),
		raw,
	};
}

function readRawDepth(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 收集可执行的正则脚本。顺序与酒馆一致：全局、角色卡、预设；
 * 角色卡与预设脚本只有被允许时才收集。
 */
export function collectStRegexScripts(
	sources: StRegexSources,
): readonly StRegexScript[] {
	const lists: (readonly unknown[])[] = [
		...(sources.global === undefined ? [] : [sources.global]),
		...(sources.allowScoped === true && sources.scoped !== undefined
			? [sources.scoped]
			: []),
		...(sources.allowPreset === true && sources.preset !== undefined
			? [sources.preset]
			: []),
	];
	return lists.flatMap((list) =>
		list
			.map((item) => parseStRegexScript(item))
			.filter((item): item is StRegexScript => item !== null),
	);
}

/**
 * 酒馆的 `regexFromString`：`/pattern/flags` 或普通字符串。
 * 解析失败返回 null。
 */
export function stRegexFromString(input: string): RegExp | null {
	try {
		const match = input.match(/(\/?)(.+)\1([a-z]*)/i);
		if (match === null) return null;
		const flags = match[3] ?? "";
		if (flags && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(flags)) {
			return new RegExp(input);
		}
		return new RegExp(match[2] ?? "", flags);
	} catch {
		return null;
	}
}

function sanitizeRegexMacro(value: string): string {
	return value.replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, (character) => {
		switch (character) {
			case "\n":
				return "\\n";
			case "\r":
				return "\\r";
			case "\t":
				return "\\t";
			case "\v":
				return "\\v";
			case "\f":
				return "\\f";
			case "\0":
				return "\\0";
			default:
				return `\\${character}`;
		}
	});
}

function filterString(
	rawString: string,
	trimStrings: readonly string[],
	characterName: string | undefined,
	substitute: StMacroSubstitute,
): string {
	let finalString = rawString;
	for (const trimString of trimStrings) {
		const substituted = substitute(trimString, { charOverride: characterName });
		finalString = finalString.replaceAll(substituted, "");
	}
	return finalString;
}

/** 脚本实际使用的正则；宏替换与 `substituteRegex` 都已处理。 */
export function stRegexForScript(
	script: StRegexScript,
	substitute?: StMacroSubstitute,
): RegExp | null {
	const engine = substitute ?? createStMacroEngine().substitute;
	return stRegexFromString(findRegexString(script, engine));
}

function findRegexString(
	script: StRegexScript,
	substitute: StMacroSubstitute,
): string {
	switch (script.substituteRegex) {
		case ST_SUBSTITUTE_REGEX.raw:
			return substitute(script.findRegex);
		case ST_SUBSTITUTE_REGEX.escaped:
			return substitute(script.findRegex, { postProcess: sanitizeRegexMacro });
		default:
			return script.findRegex;
	}
}

/** 单条脚本的执行，与酒馆的 `runRegexScript` 一致。 */
export function runStRegexScript(
	script: StRegexScript,
	rawString: string,
	options: {
		readonly characterName?: string;
		readonly substitute?: StMacroSubstitute;
	} = {},
): string {
	if (script.disabled || rawString.length === 0) return rawString;
	const substitute = options.substitute ?? createStMacroEngine().substitute;
	const findRegex = stRegexForScript(script, substitute);
	if (findRegex === null) return rawString;
	return rawString.replace(findRegex, (match: string, ...args: unknown[]) => {
		const groups = args[args.length - 1];
		const captures = [match, ...args];
		const withMatch = script.replaceString.replace(/{{match}}/gi, "$0");
		const replaced = withMatch.replaceAll(
			/\$(\d+)|\$<([^>]+)>/g,
			(
				_token: string,
				number: string | undefined,
				groupName: string | undefined,
			) => {
				let captured: string | undefined;
				if (number !== undefined) {
					const value = captures[Number(number)];
					captured = typeof value === "string" ? value : undefined;
				} else if (
					groupName !== undefined &&
					typeof groups === "object" &&
					groups !== null
				) {
					const value = (groups as Record<string, unknown>)[groupName];
					captured = typeof value === "string" ? value : undefined;
				}
				if (!captured) return "";
				return filterString(
					captured,
					script.trimStrings,
					options.characterName,
					substitute,
				);
			},
		);
		return substitute(replaced);
	});
}

/**
 * 按作用位置、只影响显示、只影响 prompt、编辑开关与深度范围执行正则脚本。
 * 这些条件与酒馆的 `getRegexedString` 相同。
 */
export function applyStRegexScripts(
	rawString: string,
	placement: StRegexPlacement,
	options: StRegexOptions,
): string {
	if (rawString.length === 0) return rawString;
	let finalString = rawString;
	for (const script of options.scripts) {
		const appliesByTarget =
			(script.markdownOnly && options.isMarkdown === true) ||
			(script.promptOnly && options.isPrompt === true) ||
			(!script.markdownOnly &&
				!script.promptOnly &&
				options.isMarkdown !== true &&
				options.isPrompt !== true);
		if (!appliesByTarget) continue;
		if (options.isEdit === true && !script.runOnEdit) continue;
		if (typeof options.depth === "number") {
			if (
				script.minDepth !== null &&
				script.minDepth >= -1 &&
				options.depth < script.minDepth
			) {
				continue;
			}
			if (
				script.maxDepth !== null &&
				script.maxDepth >= 0 &&
				options.depth > script.maxDepth
			) {
				continue;
			}
		}
		if (!script.placement.includes(placement)) continue;
		finalString = runStRegexScript(script, finalString, {
			characterName: options.characterName,
			substitute: options.substitute,
		});
	}
	return finalString;
}
