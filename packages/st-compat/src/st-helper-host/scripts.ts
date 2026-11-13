import { type JsonObject, isJsonObject } from "@dramaticer/core";
import type { StCharacterCard } from "../character-card.js";

/** 角色卡里酒馆助手脚本库的一条脚本；正文保持原样。 */
export interface StHelperScript {
	readonly id: string;
	readonly name: string;
	readonly content: string;
	readonly enabled: boolean;
	readonly type: string;
	readonly info: string;
	readonly button: JsonObject;
	readonly data: JsonObject;
	readonly source: "card";
}

/**
 * 读取 `extensions.tavern_helper.scripts`。上游脚本库允许禁用脚本留在卡里，
 * 所以禁用的条目照常返回；重复 id 与错误结构直接失败，不猜测修复。
 */
export function discoverStHelperScripts(
	card: StCharacterCard,
): readonly StHelperScript[] {
	const tavernHelper = card.extensions.tavern_helper;
	if (tavernHelper === undefined || tavernHelper === null) return [];
	if (!isJsonObject(tavernHelper)) {
		throw new Error("角色卡 extensions.tavern_helper 必须是对象");
	}
	const rawScripts = tavernHelper.scripts;
	if (rawScripts === undefined || rawScripts === null) return [];
	if (!Array.isArray(rawScripts)) {
		throw new Error("角色卡 extensions.tavern_helper.scripts 必须是数组");
	}
	const seen = new Set<string>();
	const scripts: StHelperScript[] = [];
	for (const [index, raw] of rawScripts.entries()) {
		const label = `角色卡 extensions.tavern_helper.scripts[${index}]`;
		if (!isJsonObject(raw)) {
			throw new Error(`${label} 必须是对象`);
		}
		const id = readString(raw, "id", label);
		if (seen.has(id)) {
			throw new Error(`${label}.id 重复：${id}`);
		}
		seen.add(id);
		scripts.push({
			id,
			name: readString(raw, "name", label),
			content: readString(raw, "content", label),
			enabled: readBoolean(raw, "enabled", label),
			type: readString(raw, "type", label),
			info: readOptionalString(raw, "info", label),
			button: readOptionalObject(raw, "button", label),
			data: readOptionalObject(raw, "data", label),
			source: "card",
		});
	}
	return scripts;
}

function readString(source: JsonObject, key: string, label: string): string {
	const value = source[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label}.${key} 必须是非空字符串`);
	}
	return value;
}

function readOptionalString(
	source: JsonObject,
	key: string,
	label: string,
): string {
	const value = source[key];
	if (value === undefined || value === null) return "";
	if (typeof value !== "string") {
		throw new Error(`${label}.${key} 必须是字符串`);
	}
	return value;
}

function readBoolean(source: JsonObject, key: string, label: string): boolean {
	const value = source[key];
	if (typeof value !== "boolean") {
		throw new Error(`${label}.${key} 必须是布尔值`);
	}
	return value;
}

function readOptionalObject(
	source: JsonObject,
	key: string,
	label: string,
): JsonObject {
	const value = source[key];
	if (value === undefined || value === null) return {};
	if (!isJsonObject(value)) {
		throw new Error(`${label}.${key} 必须是对象`);
	}
	return value;
}
