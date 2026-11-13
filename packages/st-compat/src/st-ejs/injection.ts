import { parse as parseYaml } from "yaml";
import {
	type StEjsMessageRole,
	type StEjsVariableTree,
	isStEjsMessageRole,
} from "./variables.js";

/**
 * 模板输出里的内容注入标记。标记独占一行，标记之后的文本属于该条注入，
 * 直到下一条标记或 `@INJECT`；标记之前与未被占用的文本是模板的正常输出。
 */

export type StEjsInjectionTarget = "generate" | "render";

export interface StEjsContentInjection {
	/** `[GENERATE:*]` 与 `[RENDER:*]` 固定为 generate/render；`@INJECT target=` 可以是任意槽位名。 */
	readonly target: string;
	readonly position: "before" | "after";
	/** `[GENERATE:{idx}:...]` 里的楼层下标；没有时为 null。 */
	readonly depth: number | null;
	/** `[GENERATE:REGEX:pattern]` 与 `@INJECT regex=` 的正则文本；没有时为 null。 */
	readonly regex: string | null;
	readonly order: number;
	readonly role: StEjsMessageRole | null;
	readonly content: string;
	/** 触发这条注入的标记行，用于 Trace 与排障。 */
	readonly directive: string;
}

type PendingInjection = Omit<StEjsContentInjection, "content">;

export interface StEjsInjectionParse {
	readonly text: string;
	readonly injections: readonly StEjsContentInjection[];
}

export class StEjsInjectionError extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "StEjsInjectionError";
	}
}

const MARKER_LINE = /^\[(GENERATE|RENDER):([^\]]*)\]$/;
const DEPTH_POSITION = /^(\d+):(BEFORE|AFTER)$/;
const INJECT_LINE = /^@INJECT(?:[ \t]+(.*))?$/;

interface ParsedMarker {
	readonly target: StEjsInjectionTarget;
	readonly position: "before" | "after";
	readonly depth: number | null;
	readonly regex: string | null;
}

function parseMarker(line: string): ParsedMarker | null {
	const match = MARKER_LINE.exec(line);
	if (match === null) return null;
	const target = (match[1] as string).toLowerCase() as StEjsInjectionTarget;
	const body = match[2] ?? "";
	if (body === "BEFORE" || body === "AFTER") {
		return {
			target,
			position: body.toLowerCase() as "before" | "after",
			depth: null,
			regex: null,
		};
	}
	if (body.startsWith("REGEX:")) {
		const regex = body.slice("REGEX:".length);
		if (regex.length === 0) return null;
		return { target, position: "after", depth: null, regex };
	}
	const depth = DEPTH_POSITION.exec(body);
	if (depth === null) return null;
	return {
		target,
		position: (depth[2] as string).toLowerCase() as "before" | "after",
		depth: Number.parseInt(depth[1] as string, 10),
		regex: null,
	};
}

function tokenizeAttributes(input: string, directive: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: string | null = null;
	for (const character of input) {
		if (quote !== null) {
			if (character === quote) {
				quote = null;
			} else {
				current += character;
			}
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character === " " || character === "\t") {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += character;
	}
	if (quote !== null) {
		throw new StEjsInjectionError(`${directive} 的属性引号未闭合`);
	}
	if (current.length > 0) tokens.push(current);
	return tokens;
}

function parseInject(line: string): PendingInjection | null {
	const match = INJECT_LINE.exec(line);
	if (match === null) return null;
	const attributes = new Map<string, string>();
	for (const token of tokenizeAttributes(match[1] ?? "", line)) {
		const separator = token.indexOf("=");
		if (separator <= 0) {
			throw new StEjsInjectionError(`${line} 的属性 ${token} 缺少等号`);
		}
		const key = token.slice(0, separator);
		if (!["pos", "target", "regex", "order", "role"].includes(key)) {
			throw new StEjsInjectionError(`${line} 里的属性 ${key} 不认识`);
		}
		if (attributes.has(key)) {
			throw new StEjsInjectionError(`${line} 里的属性 ${key} 重复`);
		}
		attributes.set(key, token.slice(separator + 1));
	}
	if (attributes.size === 0) {
		throw new StEjsInjectionError("@INJECT 至少需要 pos、target、regex 之一");
	}
	const pos = attributes.get("pos");
	if (pos !== undefined && pos !== "before" && pos !== "after") {
		throw new StEjsInjectionError(
			`@INJECT 的 pos 只能是 before 或 after：${pos}`,
		);
	}
	const targetValue = attributes.get("target");
	if (targetValue !== undefined && targetValue.trim().length === 0) {
		throw new StEjsInjectionError("@INJECT 的 target 不能为空");
	}
	const regex = attributes.get("regex");
	if (regex !== undefined && regex.length === 0) {
		throw new StEjsInjectionError("@INJECT 的 regex 不能为空");
	}
	const orderValue = attributes.get("order");
	let order = 100;
	if (orderValue !== undefined) {
		order = Number(orderValue);
		if (!Number.isFinite(order)) {
			throw new StEjsInjectionError(
				`@INJECT 的 order 必须是数字：${orderValue}`,
			);
		}
	}
	const roleValue = attributes.get("role");
	let role: StEjsMessageRole | null = null;
	if (roleValue !== undefined) {
		if (!isStEjsMessageRole(roleValue)) {
			throw new StEjsInjectionError(
				`@INJECT 的 role 只能是 system、user、assistant：${roleValue}`,
			);
		}
		role = roleValue;
	}
	return {
		target: targetValue ?? "generate",
		position: (pos ?? "after") as "before" | "after",
		depth: null,
		regex: regex ?? null,
		order,
		role,
		directive: line,
	};
}

/** 把渲染结果拆成正常输出与注入条目。 */
export function parseStEjsInjections(text: string): StEjsInjectionParse {
	if (typeof text !== "string") {
		throw new StEjsInjectionError("注入标记的输入必须是字符串");
	}
	if (!text.includes("[") && !text.includes("@INJECT")) {
		return { text, injections: [] };
	}
	const lines = text.split("\n");
	const output: string[] = [];
	const injections: StEjsContentInjection[] = [];
	let pending: PendingInjection | null = null;
	let pendingLines: string[] = [];
	const flush = () => {
		if (pending === null) return;
		injections.push({ ...pending, content: pendingLines.join("\n") });
		pending = null;
		pendingLines = [];
	};
	for (const raw of lines) {
		const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
		const trimmed = line.trim();
		const marker = parseMarker(trimmed);
		const start: PendingInjection | null =
			marker === null
				? parseInject(trimmed)
				: { ...marker, order: 100, role: null, directive: trimmed };
		if (start !== null) {
			flush();
			pending = start;
			continue;
		}
		if (pending === null) output.push(line);
		else pendingLines.push(line);
	}
	flush();
	return { text: output.join("\n"), injections };
}

export interface StEjsInitialVariablesParse {
	readonly variables: StEjsVariableTree;
	readonly format: "json" | "yaml";
}

function isPlainObject(value: unknown): value is StEjsVariableTree {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `[InitialVariables]` 的内容：先按 JSON 解析，失败再按 YAML 解析；
 * 两种格式都必须得到对象。
 */
export function parseStEjsInitialVariables(
	text: string,
): StEjsInitialVariablesParse {
	if (typeof text !== "string") {
		throw new StEjsInjectionError("初始变量必须是字符串");
	}
	let body = text.trim();
	if (body.startsWith("[InitialVariables]")) {
		body = body.slice("[InitialVariables]".length).trim();
	}
	if (body.length === 0) return { variables: {}, format: "json" };
	try {
		const parsed: unknown = JSON.parse(body);
		if (!isPlainObject(parsed)) {
			throw new StEjsInjectionError("初始变量的 JSON 必须是对象");
		}
		return { variables: parsed, format: "json" };
	} catch (error) {
		if (error instanceof StEjsInjectionError) throw error;
	}
	try {
		const parsed: unknown = parseYaml(body);
		if (parsed === null || parsed === undefined) {
			return { variables: {}, format: "yaml" };
		}
		if (!isPlainObject(parsed)) {
			throw new StEjsInjectionError("初始变量的 YAML 必须是对象");
		}
		return { variables: parsed, format: "yaml" };
	} catch (error) {
		throw new StEjsInjectionError(
			`初始变量既不是 JSON 也不是 YAML：${error instanceof Error ? error.message : String(error)}`,
			error,
		);
	}
}
