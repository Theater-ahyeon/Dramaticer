import {
	assertJsonValue,
	assertPlainObject,
	rejectUnknownKeys,
} from "../json.js";
import type { ContextCondition } from "./template.js";

export interface ParseContextConditionOptions {
	/** 卡扩展里的条件只允许 state、all、any、not。 */
	readonly allowSwitch?: boolean;
}

/**
 * 严格解析一个条件表达式。未知的条件类型、未知字段与非法参数都抛错，
 * 错误信息带上调用方给出的字段路径。
 */
export function parseContextCondition(
	value: unknown,
	path: string,
	options: ParseContextConditionOptions = {},
): ContextCondition {
	const object = assertPlainObject(value, path);
	const kind = object.kind;
	if (typeof kind !== "string" || kind.length === 0) {
		throw new Error(`${path}.kind 必须是非空字符串`);
	}
	switch (kind) {
		case "switch": {
			if (options.allowSwitch === false) {
				throw new Error(`${path}.kind 不能是 switch`);
			}
			rejectUnknownKeys(object, ["kind", "name", "equals"], path);
			const name = object.name;
			if (typeof name !== "string" || name.trim().length === 0) {
				throw new Error(`${path}.name 必须是非空字符串`);
			}
			const equals = object.equals ?? true;
			if (typeof equals !== "boolean") {
				throw new Error(`${path}.equals 必须是布尔值`);
			}
			return { kind: "switch", name: name.trim(), equals };
		}
		case "state": {
			rejectUnknownKeys(object, ["kind", "path", "op", "value"], path);
			const conditionPath = parseStatePath(object.path, `${path}.path`);
			const op = object.op;
			if (op !== "exists" && op !== "equals" && op !== "truthy") {
				throw new Error(`${path}.op 必须是 exists、equals 或 truthy 之一`);
			}
			if (op === "equals") {
				if (!Object.hasOwn(object, "value")) {
					throw new Error(`${path}.value 在 op 为 equals 时必须提供`);
				}
				assertJsonValue(object.value, `${path}.value`);
				return { kind: "state", path: conditionPath, op, value: object.value };
			}
			if (Object.hasOwn(object, "value")) {
				throw new Error(`${path}.value 只允许在 op 为 equals 时出现`);
			}
			return { kind: "state", path: conditionPath, op };
		}
		case "all":
		case "any": {
			rejectUnknownKeys(object, ["kind", "conditions"], path);
			const conditions = object.conditions;
			if (!Array.isArray(conditions) || conditions.length === 0) {
				throw new Error(`${path}.conditions 必须是非空数组`);
			}
			return {
				kind,
				conditions: conditions.map((item, index) =>
					parseContextCondition(item, `${path}.conditions[${index}]`, options),
				),
			};
		}
		case "not": {
			rejectUnknownKeys(object, ["kind", "condition"], path);
			if (!Object.hasOwn(object, "condition")) {
				throw new Error(`${path}.condition 必须提供`);
			}
			return {
				kind: "not",
				condition: parseContextCondition(
					object.condition,
					`${path}.condition`,
					options,
				),
			};
		}
		default:
			throw new Error(`${path}.kind 不是已知的条件类型：${kind}`);
	}
}

function parseStatePath(value: unknown, path: string): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${path} 必须是非空字符串数组`);
	}
	return value.map((segment, index) => {
		if (typeof segment !== "string" || segment.length === 0) {
			throw new Error(`${path}[${index}] 必须是非空字符串`);
		}
		return segment;
	});
}
