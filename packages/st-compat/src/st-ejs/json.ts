import { type JsonValue, isJsonObject } from "@dramaticer/core";
import lodash from "lodash";
import { parse as parseYaml } from "yaml";

/**
 * ST-Prompt-Template 的 JSON 与变量补丁函数。
 * `parseJSON` 先按严格 JSON 解析，再按 YAML 接受 JSON5 风格的写法；
 * `jsonPatch` 按 RFC 6902 执行，输入对象不被修改。
 */

const UNSAFE_KEYS = ["__proto__", "constructor", "prototype"];

export class StEjsJsonError extends Error {
	readonly index: number | null;
	readonly operation: string | null;

	constructor(
		message: string,
		index: number | null = null,
		operation: string | null = null,
	) {
		super(
			index === null
				? message
				: `JSON 补丁第 ${index + 1} 条${operation === null ? "" : `（${operation}）`}失败：${message}`,
		);
		this.name = "StEjsJsonError";
		this.index = index;
		this.operation = operation;
	}
}

/** 先按严格 JSON 解析；以 `{` 或 `[` 开头时再用 YAML 接受宽松写法。 */
export function parseStEjsJson(text: string): JsonValue {
	if (typeof text !== "string") {
		throw new StEjsJsonError("parseJSON 需要字符串");
	}
	const body = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim();
	if (body.length === 0) {
		throw new StEjsJsonError("parseJSON 的输入为空");
	}
	try {
		return JSON.parse(body) as JsonValue;
	} catch (strictError) {
		if (!body.startsWith("{") && !body.startsWith("[")) {
			throw new StEjsJsonError(
				`不是合法 JSON：${strictError instanceof Error ? strictError.message : String(strictError)}`,
			);
		}
		try {
			return parseYaml(body) as JsonValue;
		} catch (yamlError) {
			throw new StEjsJsonError(
				`既不是 JSON 也不是 YAML：${yamlError instanceof Error ? yamlError.message : String(yamlError)}`,
			);
		}
	}
}

function cloneJson<T>(value: T): T {
	return structuredClone(value);
}

function parsePointer(pointer: string, index: number, op: string): string[] {
	if (pointer === "") return [];
	if (!pointer.startsWith("/")) {
		throw new StEjsJsonError("路径必须以 / 开头", index, op);
	}
	return pointer
		.slice(1)
		.split("/")
		.map((segment) => {
			if (/~(?![01])/.test(segment)) {
				throw new StEjsJsonError("路径里的 ~ 必须写成 ~0 或 ~1", index, op);
			}
			const decoded = segment.replace(/~1/g, "/").replace(/~0/g, "~");
			if (UNSAFE_KEYS.includes(decoded)) {
				throw new StEjsJsonError(`路径不能使用 ${decoded}`, index, op);
			}
			return decoded;
		});
}

function readPointer(
	root: JsonValue,
	segments: readonly string[],
	index: number,
	op: string,
): JsonValue {
	let current = root;
	for (const segment of segments) {
		if (Array.isArray(current)) {
			const position = arrayIndex(segment, current.length, false, index, op);
			current = current[position] as JsonValue;
			continue;
		}
		if (isJsonObject(current)) {
			if (!Object.hasOwn(current, segment)) {
				throw new StEjsJsonError(`路径段 ${segment} 不存在`, index, op);
			}
			current = current[segment] as JsonValue;
			continue;
		}
		throw new StEjsJsonError(
			`路径段 ${segment} 的上级不是对象或数组`,
			index,
			op,
		);
	}
	return current;
}

function arrayIndex(
	segment: string,
	length: number,
	allowEnd: boolean,
	index: number,
	op: string,
): number {
	if (segment === "-" && allowEnd) return length;
	if (!/^\d+$/.test(segment)) {
		throw new StEjsJsonError(`数组下标 ${segment} 必须是数字`, index, op);
	}
	const position = Number(segment);
	if (
		!Number.isSafeInteger(position) ||
		(allowEnd ? position > length : position >= length)
	) {
		throw new StEjsJsonError(`数组下标 ${segment} 越界`, index, op);
	}
	return position;
}

function addValue(
	root: JsonValue,
	segments: readonly string[],
	value: JsonValue,
	index: number,
	op: string,
): JsonValue {
	if (segments.length === 0) return cloneJson(value);
	const parent = readPointer(root, segments.slice(0, -1), index, op);
	const key = segments.at(-1) as string;
	if (Array.isArray(parent)) {
		parent.splice(
			arrayIndex(key, parent.length, true, index, op),
			0,
			cloneJson(value),
		);
		return root;
	}
	if (isJsonObject(parent)) {
		parent[key] = cloneJson(value);
		return root;
	}
	throw new StEjsJsonError("写入目标不是对象或数组", index, op);
}

function removeValue(
	root: JsonValue,
	segments: readonly string[],
	index: number,
	op: string,
): JsonValue {
	if (segments.length === 0) {
		throw new StEjsJsonError("不能删除根值", index, op);
	}
	const parent = readPointer(root, segments.slice(0, -1), index, op);
	const key = segments.at(-1) as string;
	if (Array.isArray(parent)) {
		parent.splice(arrayIndex(key, parent.length, false, index, op), 1);
		return root;
	}
	if (isJsonObject(parent)) {
		if (!Object.hasOwn(parent, key)) {
			throw new StEjsJsonError(`路径段 ${key} 不存在`, index, op);
		}
		delete parent[key];
		return root;
	}
	throw new StEjsJsonError("删除目标不是对象或数组", index, op);
}

function replaceValue(
	root: JsonValue,
	segments: readonly string[],
	value: JsonValue,
	index: number,
	op: string,
): JsonValue {
	if (segments.length === 0) return cloneJson(value);
	const parent = readPointer(root, segments.slice(0, -1), index, op);
	const key = segments.at(-1) as string;
	if (Array.isArray(parent)) {
		parent[arrayIndex(key, parent.length, false, index, op)] = cloneJson(value);
		return root;
	}
	if (isJsonObject(parent)) {
		if (!Object.hasOwn(parent, key)) {
			throw new StEjsJsonError(`路径段 ${key} 不存在`, index, op);
		}
		parent[key] = cloneJson(value);
		return root;
	}
	throw new StEjsJsonError("替换目标不是对象或数组", index, op);
}

function isPrefix(prefix: readonly string[], path: readonly string[]): boolean {
	return (
		prefix.length < path.length &&
		prefix.every((segment, index) => segment === path[index])
	);
}

/** 按 RFC 6902 应用补丁，返回新值；输入对象不被修改。 */
export function applyStEjsJsonPatch(
	target: unknown,
	patch: readonly unknown[],
): JsonValue {
	if (!Array.isArray(patch)) {
		throw new StEjsJsonError("jsonPatch 的补丁必须是数组");
	}
	let root = cloneJson(target) as JsonValue;
	patch.forEach((raw, index) => {
		if (typeof raw !== "object" || raw === null) {
			throw new StEjsJsonError("补丁条目必须是对象", index, null);
		}
		const record = raw as Record<string, unknown>;
		const op = record.op;
		if (typeof op !== "string") {
			throw new StEjsJsonError("补丁条目缺少 op", index, null);
		}
		const path = record.path;
		if (typeof path !== "string") {
			throw new StEjsJsonError("补丁条目缺少 path", index, op);
		}
		const segments = parsePointer(path, index, op);
		if (
			(op === "add" || op === "replace" || op === "test") &&
			!("value" in record)
		) {
			throw new StEjsJsonError(`${op} 缺少 value`, index, op);
		}
		switch (op) {
			case "add":
				root = addValue(root, segments, record.value as JsonValue, index, op);
				return;
			case "remove":
				root = removeValue(root, segments, index, op);
				return;
			case "replace":
				root = replaceValue(
					root,
					segments,
					record.value as JsonValue,
					index,
					op,
				);
				return;
			case "move": {
				const from = record.from;
				if (typeof from !== "string") {
					throw new StEjsJsonError("move 缺少 from", index, op);
				}
				const source = parsePointer(from, index, op);
				if (isPrefix(source, segments)) {
					throw new StEjsJsonError(
						"move 的 from 不能是 path 的上级",
						index,
						op,
					);
				}
				const value = cloneJson(readPointer(root, source, index, op));
				root = removeValue(root, source, index, op);
				root = addValue(root, segments, value, index, op);
				return;
			}
			case "copy": {
				const from = record.from;
				if (typeof from !== "string") {
					throw new StEjsJsonError("copy 缺少 from", index, op);
				}
				const value = cloneJson(
					readPointer(root, parsePointer(from, index, op), index, op),
				);
				root = addValue(root, segments, value, index, op);
				return;
			}
			case "test": {
				const actual = readPointer(root, segments, index, op);
				if (!lodash.isEqual(actual, record.value)) {
					throw new StEjsJsonError("test 的值不相等", index, op);
				}
				return;
			}
			default:
				throw new StEjsJsonError(`不认识的操作 ${op}`, index, op);
		}
	});
	return root;
}
