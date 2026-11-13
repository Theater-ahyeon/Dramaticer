import {
	type JsonObject,
	type JsonValue,
	assertJsonValue,
	isJsonObject,
} from "@dramaticer/core";

/** MVU 里一个二元数组 `[值, 说明]` 的判定；第二个元素是字符串就按值加说明处理。 */
export function isMvuValueWithDescription(
	value: unknown,
): value is [JsonValue, string] {
	return (
		Array.isArray(value) && value.length === 2 && typeof value[1] === "string"
	);
}

export interface MvuPrimitiveSchemaNode {
	type: "string" | "number" | "boolean" | "any";
	required?: boolean;
}

export interface MvuObjectSchemaNode {
	type: "object";
	properties: Record<string, MvuSchemaNode>;
	extensible: boolean;
	recursiveExtensible?: boolean;
	template?: JsonValue;
	required?: boolean;
}

export interface MvuArraySchemaNode {
	type: "array";
	elementType: MvuSchemaNode;
	extensible: boolean;
	recursiveExtensible?: boolean;
	template?: JsonValue;
	required?: boolean;
}

export type MvuSchemaNode =
	| MvuObjectSchemaNode
	| MvuArraySchemaNode
	| MvuPrimitiveSchemaNode;

export interface MvuRootOptions {
	strictSet: boolean;
	strictTemplate: boolean;
	concatTemplateArray: boolean;
}

export interface MvuState {
	data: JsonObject;
	schema: MvuObjectSchemaNode;
	options: MvuRootOptions;
}

export const DEFAULT_MVU_ROOT_OPTIONS: MvuRootOptions = {
	strictSet: false,
	strictTemplate: false,
	concatTemplateArray: true,
};

const ARRAY_EXTENSIBLE_MARKER = "$__META_EXTENSIBLE__$";
const META_KEY = "$meta";
export const MVU_UNSAFE_KEYS = ["__proto__", "constructor", "prototype"];

function assertSafeKey(key: string, label: string): void {
	if (MVU_UNSAFE_KEYS.includes(key)) {
		throw new Error(`${label} 不能使用键 ${key}`);
	}
}

/** 从变量数据里提取 `$meta`，生成后续更新使用的结构，并清掉元信息。 */
export function buildMvuInitState(value: unknown): MvuState {
	assertJsonValue(value, "initvar");
	if (!isJsonObject(value)) {
		throw new Error("initvar 的根必须是 JSON 对象");
	}
	const options = readMvuRootOptions(value);
	const built = buildMvuNode(value, false);
	if (built.schema.type !== "object") {
		throw new Error("initvar 的根必须是对象");
	}
	return { data: built.data as JsonObject, schema: built.schema, options };
}

/** 根级 `$meta` 里的开关；其余 `$meta` 字段只作为结构信息。 */
export function readMvuRootOptions(root: JsonObject): MvuRootOptions {
	const meta = root[META_KEY];
	if (meta === undefined) return { ...DEFAULT_MVU_ROOT_OPTIONS };
	if (!isJsonObject(meta)) {
		throw new Error("initvar 的 $meta 必须是对象");
	}
	return {
		strictSet: readOptionalBoolean(meta, "strictSet") ?? false,
		strictTemplate: readOptionalBoolean(meta, "strictTemplate") ?? false,
		concatTemplateArray:
			readOptionalBoolean(meta, "concatTemplateArray") ?? true,
	};
}

/**
 * 把一段变量数据转换成台账里保存的值与对应的结构。
 * 对象上的 `$meta`、数组里的可扩展标记与 `$arrayMeta` 都在这里被移除。
 */
export function buildMvuNode(
	value: JsonValue,
	inheritedExtensible: boolean,
): { data: JsonValue; schema: MvuSchemaNode } {
	if (Array.isArray(value)) {
		return buildArrayNode(value, inheritedExtensible);
	}
	if (isJsonObject(value)) {
		return buildObjectNode(value, inheritedExtensible);
	}
	return { data: value, schema: primitiveNode(value) };
}

function buildObjectNode(
	value: JsonObject,
	inheritedExtensible: boolean,
): { data: JsonObject; schema: MvuObjectSchemaNode } {
	const meta = readMeta(value, "变量对象");
	const explicit = meta.explicitExtensible;
	const recursive = meta.recursiveExtensible;
	const extensible = recursive ? true : (explicit ?? inheritedExtensible);
	const childInherited = recursive
		? true
		: explicit === false
			? false
			: inheritedExtensible;
	const requiredKeys = meta.requiredKeys;
	const properties: Record<string, MvuSchemaNode> = {};
	const data: JsonObject = {};
	for (const [key, child] of Object.entries(value)) {
		if (key === META_KEY) continue;
		assertSafeKey(key, "初始变量");
		const built = buildMvuNode(child, childInherited);
		built.schema.required = extensible ? requiredKeys.includes(key) : true;
		properties[key] = built.schema;
		data[key] = built.data;
	}
	return {
		data,
		schema: {
			type: "object",
			properties,
			extensible,
			...(recursive ? { recursiveExtensible: true } : {}),
			...(meta.template === undefined ? {} : { template: meta.template }),
		},
	};
}

function buildArrayNode(
	value: readonly JsonValue[],
	inheritedExtensible: boolean,
): { data: JsonValue[]; schema: MvuArraySchemaNode } {
	const arrayMeta = readArrayMeta(value);
	const marker = value.includes(ARRAY_EXTENSIBLE_MARKER);
	const explicit = arrayMeta?.explicitExtensible ?? (marker ? true : undefined);
	const recursive = arrayMeta?.recursiveExtensible === true;
	const extensible = recursive ? true : (explicit ?? inheritedExtensible);
	const childInherited = recursive
		? true
		: explicit === false
			? false
			: inheritedExtensible;
	const elements = value.filter(
		(item) => item !== ARRAY_EXTENSIBLE_MARKER && !isArrayMetaObject(item),
	);
	const built = elements.map((item) => buildMvuNode(item, childInherited));
	const data = built.map((item) => item.data);
	const elementType =
		built.length === 0
			? primitiveNode(null, "any")
			: isMvuValueWithDescription(data)
				? (built[0]?.schema ?? primitiveNode(null, "any"))
				: (built[0]?.schema ?? primitiveNode(null, "any"));
	return {
		data,
		schema: {
			type: "array",
			elementType,
			extensible,
			...(recursive ? { recursiveExtensible: true } : {}),
			...(arrayMeta?.template === undefined
				? {}
				: { template: arrayMeta.template }),
		},
	};
}

interface ObjectMeta {
	explicitExtensible: boolean | undefined;
	recursiveExtensible: boolean;
	requiredKeys: readonly string[];
	template: JsonValue | undefined;
}

function readMeta(value: JsonObject, label: string): ObjectMeta {
	const meta = value[META_KEY];
	if (meta === undefined) {
		return {
			explicitExtensible: undefined,
			recursiveExtensible: false,
			requiredKeys: [],
			template: undefined,
		};
	}
	if (!isJsonObject(meta)) {
		throw new Error(`${label} 的 $meta 必须是对象`);
	}
	const required = meta.required;
	if (required !== undefined && !isStringArray(required)) {
		throw new Error(`${label} 的 $meta.required 必须是字符串数组`);
	}
	return {
		explicitExtensible: readOptionalBoolean(meta, "extensible", label),
		recursiveExtensible:
			readOptionalBoolean(meta, "recursiveExtensible", label) ?? false,
		requiredKeys: required ?? [],
		template: meta.template,
	};
}

interface ArrayMeta {
	explicitExtensible: boolean | undefined;
	recursiveExtensible: boolean;
	template: JsonValue | undefined;
}

function readArrayMeta(value: readonly JsonValue[]): ArrayMeta | null {
	for (const item of value) {
		if (!isArrayMetaObject(item)) continue;
		const meta = item[META_KEY];
		if (meta !== undefined && !isJsonObject(meta)) {
			throw new Error("数组的 $arrayMeta.$meta 必须是对象");
		}
		return {
			explicitExtensible:
				meta === undefined
					? undefined
					: readOptionalBoolean(meta, "extensible", "数组 $meta"),
			recursiveExtensible:
				meta === undefined
					? false
					: (readOptionalBoolean(meta, "recursiveExtensible", "数组 $meta") ??
						false),
			template: meta?.template,
		};
	}
	return null;
}

function isArrayMetaObject(value: JsonValue): value is JsonObject {
	return isJsonObject(value) && value.$arrayMeta === true;
}

function primitiveNode(
	value: JsonValue,
	forced?: "string" | "number" | "boolean" | "any",
): MvuPrimitiveSchemaNode {
	if (forced !== undefined) return { type: forced };
	if (typeof value === "string") return { type: "string" };
	if (typeof value === "number") return { type: "number" };
	if (typeof value === "boolean") return { type: "boolean" };
	return { type: "any" };
}

function readOptionalBoolean(
	value: JsonObject,
	key: string,
	label = "initvar 的 $meta",
): boolean | undefined {
	const field = value[key];
	if (field === undefined) return undefined;
	if (typeof field !== "boolean") {
		throw new Error(`${label}.${key} 必须是布尔值`);
	}
	return field;
}

function isStringArray(value: JsonValue): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

/** 校验并收窄酒馆消息变量里保存的 MVU 结构。 */
export function parseMvuSchema(value: unknown): MvuObjectSchemaNode {
	assertJsonValue(value, "schema");
	const schema = parseSchemaNode(value, "schema");
	if (schema.type !== "object") {
		throw new Error("schema 的根必须是对象结构");
	}
	return schema;
}

function parseSchemaNode(value: unknown, path: string): MvuSchemaNode {
	if (!isJsonObject(value)) {
		throw new Error(`${path} 必须是对象`);
	}
	const type = value.type;
	if (type === "object") {
		const properties = value.properties;
		if (!isJsonObject(properties)) {
			throw new Error(`${path}.properties 必须是对象`);
		}
		const parsed: Record<string, MvuSchemaNode> = {};
		for (const [key, child] of Object.entries(properties)) {
			assertSafeKey(key, `${path}.properties`);
			parsed[key] = parseSchemaNode(child, `${path}.properties.${key}`);
		}
		return {
			type: "object",
			properties: parsed,
			extensible: readSchemaBoolean(value, "extensible", path) ?? false,
			...(readSchemaBoolean(value, "recursiveExtensible", path) === true
				? { recursiveExtensible: true }
				: {}),
			...(value.template === undefined ? {} : { template: value.template }),
			...(readSchemaBoolean(value, "required", path) === undefined
				? {}
				: { required: readSchemaBoolean(value, "required", path) }),
		};
	}
	if (type === "array") {
		if (value.elementType === undefined) {
			throw new Error(`${path}.elementType 缺失`);
		}
		return {
			type: "array",
			elementType: parseSchemaNode(value.elementType, `${path}.elementType`),
			extensible: readSchemaBoolean(value, "extensible", path) ?? false,
			...(readSchemaBoolean(value, "recursiveExtensible", path) === true
				? { recursiveExtensible: true }
				: {}),
			...(value.template === undefined ? {} : { template: value.template }),
			...(readSchemaBoolean(value, "required", path) === undefined
				? {}
				: { required: readSchemaBoolean(value, "required", path) }),
		};
	}
	if (
		type === "string" ||
		type === "number" ||
		type === "boolean" ||
		type === "any"
	) {
		return {
			type,
			...(readSchemaBoolean(value, "required", path) === undefined
				? {}
				: { required: readSchemaBoolean(value, "required", path) }),
		};
	}
	throw new Error(`${path}.type 不是支持的变量类型`);
}

function readSchemaBoolean(
	value: JsonObject,
	key: string,
	path: string,
): boolean | undefined {
	const field = value[key];
	if (field === undefined) return undefined;
	if (typeof field !== "boolean") {
		throw new Error(`${path}.${key} 必须是布尔值`);
	}
	return field;
}

/** 按结构校验一份变量值；返回每条问题的完整路径。 */
export function validateMvuSchemaValue(
	schema: MvuSchemaNode,
	value: JsonValue,
	path = "",
): string[] {
	if (schema.type === "object") {
		if (!isJsonObject(value)) {
			return [`${path} 必须是 object`];
		}
		const issues: string[] = [];
		for (const [key, child] of Object.entries(schema.properties)) {
			if (child.required === true && !(key in value)) {
				issues.push(`${path}/${key} 是必填项`);
			}
		}
		for (const [key, child] of Object.entries(value)) {
			const property = schema.properties[key];
			if (property === undefined) {
				if (!schema.extensible) {
					issues.push(`${path}/${key} 不在锁定的对象结构里`);
				}
				continue;
			}
			issues.push(...validateMvuSchemaValue(property, child, `${path}/${key}`));
		}
		return issues;
	}
	if (schema.type === "array") {
		if (!Array.isArray(value)) {
			return [`${path} 必须是 array`];
		}
		if (isMvuValueWithDescription(value)) {
			return validateMvuSchemaValue(schema.elementType, value[0], `${path}[0]`);
		}
		return value.flatMap((item, index) =>
			validateMvuSchemaValue(schema.elementType, item, `${path}[${index}]`),
		);
	}
	if (schema.type === "any") return [];
	const actual = value === null ? "null" : typeof value;
	if (schema.type === "number") {
		return typeof value === "number" && Number.isFinite(value)
			? []
			: [`${path} 必须是 number`];
	}
	if (schema.type === "string") {
		return typeof value === "string" ? [] : [`${path} 必须是 string`];
	}
	if (schema.type === "boolean") {
		return typeof value === "boolean" ? [] : [`${path} 必须是 boolean`];
	}
	return [`${path} 必须是 ${schema.type}（实际是 ${actual}）`];
}

/** 克隆结构，更新操作在副本上执行，失败时整条回退。 */
export function cloneMvuSchema<T extends MvuSchemaNode>(schema: T): T {
	if (schema.type === "object") {
		const properties: Record<string, MvuSchemaNode> = {};
		for (const [key, child] of Object.entries(schema.properties)) {
			properties[key] = cloneMvuSchema(child);
		}
		return {
			...schema,
			properties,
			...(schema.template === undefined
				? {}
				: { template: JSON.parse(JSON.stringify(schema.template)) }),
		} as T;
	}
	if (schema.type === "array") {
		return {
			...schema,
			elementType: cloneMvuSchema(schema.elementType),
			...(schema.template === undefined
				? {}
				: { template: JSON.parse(JSON.stringify(schema.template)) }),
		} as T;
	}
	return { ...schema } as T;
}
