import type { JsonObject, JsonValue } from "./json.js";
import { isJsonObject } from "./json.js";

/**
 * 严格读取：字段缺失或为 null 时返回给定默认值，类型不对时立刻抛错。
 * context 用于错误信息，例如 "世界书"。
 */
export function readString(
	source: JsonObject,
	key: string,
	context: string,
): string {
	const value = source[key];
	if (value === undefined || value === null) return "";
	if (typeof value !== "string") throw fieldTypeError(context, key, "字符串");
	return value;
}

export function optionalString(
	source: JsonObject,
	key: string,
	context: string,
): string | null {
	const value = source[key];
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") throw fieldTypeError(context, key, "字符串");
	return value;
}

export function optionalNumber(
	source: JsonObject,
	key: string,
	context: string,
): number | null {
	const value = source[key];
	if (value === undefined || value === null) return null;
	if (typeof value !== "number") throw fieldTypeError(context, key, "数字");
	return value;
}

export function optionalBoolean(
	source: JsonObject,
	key: string,
	context: string,
): boolean | null {
	const value = source[key];
	if (value === undefined || value === null) return null;
	if (typeof value !== "boolean") throw fieldTypeError(context, key, "布尔值");
	return value;
}

export function optionalNumberOrBoolean(
	source: JsonObject,
	key: string,
	context: string,
): number | boolean | null {
	const value = source[key];
	if (value === undefined || value === null) return null;
	if (typeof value !== "number" && typeof value !== "boolean") {
		throw fieldTypeError(context, key, "数字或布尔值");
	}
	return value;
}

export function readBoolean(
	source: JsonObject,
	key: string,
	context: string,
	fallback: boolean,
): boolean {
	const value = optionalBoolean(source, key, context);
	return value === null ? fallback : value;
}

export function readStringList(
	source: JsonObject,
	key: string,
	context: string,
): string[] {
	const value = source[key];
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw fieldTypeError(context, key, "数组");
	return value.map((item, index) => {
		if (typeof item !== "string") {
			throw new Error(`${context}字段 "${key}[${index}]" 不是字符串`);
		}
		return item;
	});
}

export function readNumberList(
	source: JsonObject,
	key: string,
	context: string,
): number[] {
	const value = source[key];
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw fieldTypeError(context, key, "数组");
	return value.map((item, index) => {
		if (typeof item !== "number") {
			throw new Error(`${context}字段 "${key}[${index}]" 不是数字`);
		}
		return item;
	});
}

export function optionalJsonArray(
	source: JsonObject,
	key: string,
	context: string,
): readonly JsonValue[] | null {
	const value = source[key];
	if (value === undefined || value === null) return null;
	if (!Array.isArray(value)) throw fieldTypeError(context, key, "数组");
	return value;
}

export function optionalObject(
	source: JsonObject,
	key: string,
	context: string,
): JsonObject | null {
	const value = source[key];
	if (value === undefined || value === null) return null;
	if (!isJsonObject(value)) throw fieldTypeError(context, key, "JSON 对象");
	return value;
}

export function readObject(
	source: JsonObject,
	key: string,
	context: string,
): JsonObject {
	return optionalObject(source, key, context) ?? {};
}

function fieldTypeError(context: string, key: string, expected: string): Error {
	return new Error(`${context}字段 "${key}" 不是${expected}`);
}
