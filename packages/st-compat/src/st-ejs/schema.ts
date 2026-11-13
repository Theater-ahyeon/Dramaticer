import lodash from "lodash";
import { StEjsVariableError } from "./variables.js";

/**
 * `setVariableSchema` 使用的结构描述。只描述类型、成员与枚举，
 * 不执行卡内 zod 脚本；写入时按这里声明的结构校验。
 */

export type StEjsVariableSchemaType =
	| "any"
	| "string"
	| "number"
	| "boolean"
	| "object"
	| "array"
	| "null";

export interface StEjsVariableSchemaNode {
	readonly type?: StEjsVariableSchemaType;
	readonly properties?: Readonly<Record<string, StEjsVariableSchemaNode>>;
	readonly items?: StEjsVariableSchemaNode;
	readonly required?: readonly string[];
	readonly enum?: readonly unknown[];
}

const SCHEMA_TYPES: readonly StEjsVariableSchemaType[] = [
	"any",
	"string",
	"number",
	"boolean",
	"object",
	"array",
	"null",
];

function isSchemaNode(value: unknown): value is StEjsVariableSchemaNode {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验结构描述本身；非法结构直接抛错。 */
export function assertStEjsVariableSchema(
	schema: unknown,
	label = "变量结构",
): asserts schema is StEjsVariableSchemaNode {
	if (!isSchemaNode(schema)) {
		throw new StEjsVariableError(`${label} 必须是对象`);
	}
	const type = schema.type;
	if (type !== undefined && !SCHEMA_TYPES.includes(type)) {
		throw new StEjsVariableError(`${label} 的 type ${String(type)} 非法`);
	}
	if (schema.required !== undefined) {
		if (
			!Array.isArray(schema.required) ||
			schema.required.some((key) => typeof key !== "string" || key.length === 0)
		) {
			throw new StEjsVariableError(`${label} 的 required 必须是非空字符串数组`);
		}
	}
	if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
		throw new StEjsVariableError(`${label} 的 enum 必须是数组`);
	}
	if (schema.properties !== undefined) {
		if (!isSchemaNode(schema.properties)) {
			throw new StEjsVariableError(`${label} 的 properties 必须是对象`);
		}
		for (const [key, child] of Object.entries(schema.properties)) {
			if (key.length === 0) {
				throw new StEjsVariableError(`${label} 的 properties 不能有空键`);
			}
			assertStEjsVariableSchema(child, `${label}.${key}`);
		}
	}
	if (schema.items !== undefined) {
		assertStEjsVariableSchema(schema.items, `${label}.items`);
	}
}

/** 按路径找到结构节点；结构里没有声明的路径不做校验。 */
export function findStEjsSchemaNode(
	schema: StEjsVariableSchemaNode | null,
	path: string | null,
): StEjsVariableSchemaNode | undefined {
	if (schema === null) return undefined;
	if (path === null) return schema;
	let current: StEjsVariableSchemaNode | undefined = schema;
	for (const segment of lodash.toPath(path)) {
		if (current === undefined) return undefined;
		const child: StEjsVariableSchemaNode | undefined =
			current.properties?.[segment];
		if (child !== undefined) {
			current = child;
			continue;
		}
		if (/^\d+$/.test(segment) && current.items !== undefined) {
			current = current.items;
			continue;
		}
		return undefined;
	}
	return current;
}

function describe(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

/** 按结构节点校验一个值；`path` 只用于错误信息。 */
export function assertStEjsSchemaValue(
	node: StEjsVariableSchemaNode,
	value: unknown,
	path: string,
): void {
	if (node.enum !== undefined) {
		const matched = node.enum.some((entry) => lodash.isEqual(entry, value));
		if (!matched) {
			throw new StEjsVariableError(`${path} 不在允许的取值里`);
		}
	}
	const type = node.type ?? "any";
	switch (type) {
		case "any":
			return;
		case "null":
			if (value !== null) {
				throw new StEjsVariableError(
					`${path} 必须是 null，收到 ${describe(value)}`,
				);
			}
			return;
		case "string":
			if (typeof value !== "string") {
				throw new StEjsVariableError(
					`${path} 必须是 string，收到 ${describe(value)}`,
				);
			}
			return;
		case "number":
			if (typeof value !== "number" || !Number.isFinite(value)) {
				throw new StEjsVariableError(
					`${path} 必须是有限数字，收到 ${describe(value)}`,
				);
			}
			return;
		case "boolean":
			if (typeof value !== "boolean") {
				throw new StEjsVariableError(
					`${path} 必须是 boolean，收到 ${describe(value)}`,
				);
			}
			return;
		case "array":
			if (!Array.isArray(value)) {
				throw new StEjsVariableError(
					`${path} 必须是数组，收到 ${describe(value)}`,
				);
			}
			if (node.items !== undefined) {
				value.forEach((item, index) =>
					assertStEjsSchemaValue(
						node.items as StEjsVariableSchemaNode,
						item,
						`${path}[${index}]`,
					),
				);
			}
			return;
		case "object": {
			if (!isSchemaNode(value) || Array.isArray(value)) {
				throw new StEjsVariableError(
					`${path} 必须是对象，收到 ${describe(value)}`,
				);
			}
			for (const key of node.required ?? []) {
				if (!Object.hasOwn(value, key)) {
					throw new StEjsVariableError(`${path} 缺少必填字段 ${key}`);
				}
			}
			for (const [key, child] of Object.entries(node.properties ?? {})) {
				const record = value as Record<string, unknown>;
				if (Object.hasOwn(record, key)) {
					assertStEjsSchemaValue(child, record[key], `${path}.${key}`);
				}
			}
			return;
		}
	}
}
