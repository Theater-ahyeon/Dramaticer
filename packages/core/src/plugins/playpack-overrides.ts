import {
	type JsonObject,
	type JsonValue,
	assertJsonValue,
	assertPlainObject,
	isJsonObject,
	rejectUnknownKeys,
} from "../json.js";

/** 最上层的手工覆盖，不写回任何玩法包文件。 */
export interface PlaypackUserOverrides {
	readonly config: Readonly<Record<string, JsonObject>>;
	readonly switches: Readonly<Record<string, boolean>>;
}

/** 空覆盖；故事没有保存过覆盖、也没有手工覆盖时使用。 */
export const EMPTY_PLAYPACK_USER_OVERRIDES: PlaypackUserOverrides =
	Object.freeze({
		config: Object.freeze({}),
		switches: Object.freeze({}),
	});

const OVERRIDE_KEYS = ["config", "switches"];

/** 解析用户覆盖；省略时返回空覆盖。 */
export function parsePlaypackUserOverrides(
	value: unknown,
	path = "playpackOverrides",
): PlaypackUserOverrides {
	if (value === undefined || value === null) {
		return EMPTY_PLAYPACK_USER_OVERRIDES;
	}
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, OVERRIDE_KEYS, path);
	return {
		config: parsePlaypackConfigPatches(object.config, `${path}.config`),
		switches: parsePlaypackSwitches(object.switches, `${path}.switches`),
	};
}

/** 配置补丁表：插件名到 JSON 对象；输入只读，返回新对象。 */
export function parsePlaypackConfigPatches(
	value: unknown,
	path: string,
): Record<string, JsonObject> {
	if (value === undefined) return {};
	const object = assertPlainObject(value, path);
	const patches: Record<string, JsonObject> = {};
	for (const [pluginName, patch] of Object.entries(object)) {
		if (pluginName.trim().length === 0) {
			throw new Error(`${path} 的键名不能是空字符串`);
		}
		const patchPath = `${path}.${pluginName}`;
		assertJsonValue(patch, patchPath);
		patches[pluginName] = clonePlaypackJsonObject(
			assertPlainObject(patch, patchPath) as JsonObject,
		);
	}
	return patches;
}

/** 开关表：插件名到布尔值。 */
export function parsePlaypackSwitches(
	value: unknown,
	path: string,
): Record<string, boolean> {
	if (value === undefined) return {};
	const object = assertPlainObject(value, path);
	const switches: Record<string, boolean> = {};
	for (const [pluginName, enabled] of Object.entries(object)) {
		if (pluginName.trim().length === 0) {
			throw new Error(`${path} 的键名不能是空字符串`);
		}
		if (typeof enabled !== "boolean") {
			throw new Error(`${path}.${pluginName} 必须是布尔值`);
		}
		switches[pluginName] = enabled;
	}
	return switches;
}

export function clonePlaypackJson(value: JsonValue): JsonValue {
	if (Array.isArray(value)) return value.map((item) => clonePlaypackJson(item));
	if (isJsonObject(value)) return clonePlaypackJsonObject(value);
	return value;
}

export function clonePlaypackJsonObject(value: JsonObject): JsonObject {
	const copy: JsonObject = {};
	for (const [key, child] of Object.entries(value)) {
		copy[key] = clonePlaypackJson(child);
	}
	return copy;
}
