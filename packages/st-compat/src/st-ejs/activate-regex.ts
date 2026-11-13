import { stRegexFromString } from "../st-content/regex.js";
import type {
	StEjsVariableOptionsInput,
	StEjsVariableTree,
} from "./variables.js";

/**
 * `activateRegex` 注册的激活正则。脚本按酒馆正则的作用位置与深度规则执行，
 * 默认一次性生效，`sticky` 让它一直保留。
 */

export type StEjsRegexKind = "generate" | "message";

export interface StEjsRegexMatch {
	readonly match: string;
	readonly groups: readonly (string | undefined)[];
	readonly offset: number;
	readonly input: string;
}

/** 替换函数里的 `this`：变量函数与当前匹配。 */
export interface StEjsRegexContext extends StEjsRegexMatch {
	readonly variables: StEjsVariableTree;
	getvar(key: string | null, options?: StEjsVariableOptionsInput): unknown;
	setvar(
		key: string | null,
		value: unknown,
		options?: StEjsVariableOptionsInput,
	): unknown;
	incvar(
		key: string,
		value?: number,
		options?: StEjsVariableOptionsInput,
	): unknown;
	decvar(
		key: string,
		value?: number,
		options?: StEjsVariableOptionsInput,
	): unknown;
	delvar(
		key: string | null,
		index?: string | number,
		options?: StEjsVariableOptionsInput,
	): unknown;
	insvar(
		key: string,
		value: unknown,
		index?: string | number,
		options?: StEjsVariableOptionsInput,
	): unknown;
}

export type StEjsRegexReplacementFunction = (
	this: StEjsRegexContext,
	...args: unknown[]
) => string;

export interface StEjsActivateRegexOptions {
	/** 同时作用于生成与消息渲染。 */
	readonly basic?: boolean;
	readonly generate?: boolean;
	readonly message?: boolean;
	/** 只在处理 HTML 输出时生效。 */
	readonly html?: boolean;
	/** 在目标内容的预处理阶段执行；缺省在格式化之后执行。 */
	readonly before?: boolean;
	/** 楼层深度范围，0 表示最新楼层。 */
	readonly minDepth?: number;
	readonly maxDepth?: number;
	readonly order?: number;
	/** 命中后保留，继续作用于后续内容。 */
	readonly sticky?: boolean;
}

export interface StEjsActivatedRegexScript {
	readonly pattern: RegExp;
	readonly replacement: string | StEjsRegexReplacementFunction;
	readonly basic: boolean;
	readonly generate: boolean;
	readonly message: boolean;
	readonly html: boolean;
	readonly before: boolean;
	readonly minDepth: number | null;
	readonly maxDepth: number | null;
	readonly order: number;
	readonly sticky: boolean;
	active: boolean;
}

export class StEjsRegexError extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "StEjsRegexError";
	}
}

const DEFAULT_ORDER = 100;

function readBooleanOption(
	options: StEjsActivateRegexOptions,
	key: keyof StEjsActivateRegexOptions,
): boolean {
	const value = options[key];
	if (value !== undefined && typeof value !== "boolean") {
		throw new StEjsRegexError(`activateRegex 的 ${String(key)} 必须是布尔值`);
	}
	return value ?? false;
}

function readDepthBound(
	options: StEjsActivateRegexOptions,
	key: "minDepth" | "maxDepth",
): number | null {
	const value = options[key];
	if (value === undefined) return null;
	if (!Number.isInteger(value) || value < 0) {
		throw new StEjsRegexError(`activateRegex 的 ${key} 必须是非负整数`);
	}
	return value;
}

function resolvePattern(pattern: RegExp | string): RegExp {
	if (pattern instanceof RegExp) return pattern;
	if (typeof pattern !== "string" || pattern.length === 0) {
		throw new StEjsRegexError(
			"activateRegex 的 pattern 必须是非空字符串或正则",
		);
	}
	const parsed = stRegexFromString(pattern);
	if (parsed === null) {
		throw new StEjsRegexError(`activateRegex 的 pattern 无法解析：${pattern}`);
	}
	return parsed;
}

export function createStEjsActivatedRegex(
	pattern: RegExp | string,
	replacement: string | StEjsRegexReplacementFunction,
	options: StEjsActivateRegexOptions = {},
): StEjsActivatedRegexScript {
	if (typeof replacement !== "string" && typeof replacement !== "function") {
		throw new StEjsRegexError(
			"activateRegex 的 replacement 必须是字符串或函数",
		);
	}
	const minDepth = readDepthBound(options, "minDepth");
	const maxDepth = readDepthBound(options, "maxDepth");
	if (minDepth !== null && maxDepth !== null && minDepth > maxDepth) {
		throw new StEjsRegexError("activateRegex 的 minDepth 不能大于 maxDepth");
	}
	const order = options.order ?? DEFAULT_ORDER;
	if (!Number.isFinite(order)) {
		throw new StEjsRegexError("activateRegex 的 order 必须是数字");
	}
	return {
		pattern: resolvePattern(pattern),
		replacement,
		basic: readBooleanOption(options, "basic"),
		generate: readBooleanOption(options, "generate"),
		message: readBooleanOption(options, "message"),
		html: readBooleanOption(options, "html"),
		before: readBooleanOption(options, "before"),
		minDepth,
		maxDepth,
		order,
		sticky: readBooleanOption(options, "sticky"),
		active: true,
	};
}

export interface StEjsRegexApplyOptions {
	readonly kind: StEjsRegexKind;
	readonly stage?: "before" | "after";
	/** 楼层深度，0 表示最新楼层；不带深度的调用会跳过限定深度的脚本。 */
	readonly depth?: number;
	readonly html?: boolean;
}

function appliesTo(
	script: StEjsActivatedRegexScript,
	options: StEjsRegexApplyOptions,
): boolean {
	if (!script.active) return false;
	if (script.basic) {
		// basic 同时作用于两种内容，仍然受阶段、深度与 HTML 限制
	} else if (script.generate || script.message) {
		if (options.kind === "generate" && !script.generate) return false;
		if (options.kind === "message" && !script.message) return false;
	}
	if (script.before !== (options.stage === "before")) return false;
	if (script.html && options.html !== true) return false;
	if (script.minDepth !== null || script.maxDepth !== null) {
		if (options.depth === undefined) return false;
		if (script.minDepth !== null && options.depth < script.minDepth)
			return false;
		if (script.maxDepth !== null && options.depth > script.maxDepth)
			return false;
	}
	return true;
}

function applyOne(
	script: StEjsActivatedRegexScript,
	text: string,
	createContext: (match: StEjsRegexMatch) => StEjsRegexContext,
): { readonly text: string; readonly matched: boolean } {
	const pattern = script.pattern;
	pattern.lastIndex = 0;
	const matched = pattern.test(text);
	pattern.lastIndex = 0;
	if (!matched) return { text, matched: false };
	let next: string;
	if (typeof script.replacement === "string") {
		next = text.replace(pattern, script.replacement);
	} else {
		const replacement = script.replacement;
		next = text.replace(pattern, (...args: unknown[]) => {
			const last = args[args.length - 1];
			const hasGroupsObject = typeof last === "object" && last !== null;
			const stringIndex = hasGroupsObject ? args.length - 2 : args.length - 1;
			const input =
				typeof args[stringIndex] === "string"
					? (args[stringIndex] as string)
					: "";
			const offsetIndex = stringIndex - 1;
			const offset =
				typeof args[offsetIndex] === "number"
					? (args[offsetIndex] as number)
					: 0;
			const match = String(args[0] ?? "");
			const groups = args.slice(1, offsetIndex) as (string | undefined)[];
			const context = createContext({ match, groups, offset, input });
			return replacement.call(context, ...args);
		});
	}
	pattern.lastIndex = 0;
	if (!script.sticky) script.active = false;
	return { text: next, matched: true };
}

/** 按 order、再按注册顺序执行所有生效的脚本。 */
export function applyStEjsActivatedRegexes(
	scripts: readonly StEjsActivatedRegexScript[],
	text: string,
	options: StEjsRegexApplyOptions,
	createContext: (match: StEjsRegexMatch) => StEjsRegexContext,
): string {
	if (text.length === 0) return text;
	const ordered = scripts
		.map((script, index) => ({ script, index }))
		.filter((item) => appliesTo(item.script, options))
		.sort(
			(left, right) =>
				left.script.order - right.script.order || left.index - right.index,
		)
		.map((item) => item.script);
	let current = text;
	for (const script of ordered) {
		const result = applyOne(script, current, createContext);
		current = result.text;
	}
	return current;
}
