import {
	type JsonObject,
	type JsonValue,
	assertJsonValue,
	isJsonObject,
} from "@dramaticer/core";
import { parse as parseYaml } from "yaml";

/** 世界书条目的名字或注释里带 `[initvar]` 时，MVU 把它当作初始变量。 */
export function isMvuInitVarName(name: string): boolean {
	return /\[initvar\]/i.test(name);
}

export interface MvuInitVarSource {
	readonly name: string;
	readonly content: string;
}

export interface MvuInitVarCollection {
	readonly raw: JsonObject;
	readonly usedSources: readonly string[];
	readonly issues: readonly string[];
}

/** 按输入顺序读取所有 `[initvar]` 条目并合并；解析失败只跳过该条目。 */
export function collectMvuInitVarRaw(
	sources: readonly MvuInitVarSource[],
): MvuInitVarCollection {
	let raw: JsonObject = {};
	const usedSources: string[] = [];
	const issues: string[] = [];
	for (const source of sources) {
		if (!isMvuInitVarName(source.name)) continue;
		try {
			raw = mergeMvuInitVarRaw(
				raw,
				parseMvuInitVarText(source.content, source.name),
			);
			usedSources.push(source.name);
		} catch (error) {
			issues.push(errorMessage(error));
		}
	}
	return { raw, usedSources, issues };
}

/**
 * 解析一条初始变量正文。支持 YAML、JSON、`<initvar>` 块和整段代码块；
 * 根必须是对象。
 */
export function parseMvuInitVarText(text: string, label: string): JsonObject {
	const content = stripInitVarWrappers(text);
	if (content.trim().length === 0) {
		throw new Error(`${label} 的初始变量为空`);
	}
	let parsed: unknown;
	try {
		parsed = parseYaml(content);
	} catch (error) {
		throw new Error(`${label} 的初始变量解析失败：${errorMessage(error)}`);
	}
	assertJsonValue(parsed, `${label} 的初始变量`);
	if (!isJsonObject(parsed)) {
		throw new Error(`${label} 的初始变量根必须是对象`);
	}
	return parsed;
}

/** 深度合并：对象递归合并，数组与基本值整体替换后一份。 */
export function mergeMvuInitVarRaw(
	base: JsonObject,
	next: JsonObject,
): JsonObject {
	const merged: JsonObject = cloneJson(base) as JsonObject;
	for (const [key, value] of Object.entries(next)) {
		const previous = merged[key];
		merged[key] =
			isJsonObject(previous) && isJsonObject(value)
				? mergeMvuInitVarRaw(previous, value)
				: cloneJson(value);
	}
	return merged;
}

function stripInitVarWrappers(text: string): string {
	const block = /<initvar>([\s\S]*?)<\/initvar>/i.exec(text);
	if (block?.[1] !== undefined) return block[1].trim();
	const trimmed = text.trim();
	const fenced = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/.exec(trimmed);
	if (fenced?.[1] !== undefined) return fenced[1].trim();
	return trimmed;
}

function cloneJson(value: JsonValue): JsonValue {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(cloneJson);
	const cloned: JsonObject = {};
	for (const [key, child] of Object.entries(value)) {
		cloned[key] = cloneJson(child);
	}
	return cloned;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
