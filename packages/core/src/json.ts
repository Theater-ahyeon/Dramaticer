export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| JsonObject;

export interface JsonObject {
	[key: string]: JsonValue;
}

/** JSON 对象的最小类型守卫；解析外部数据时统一从这里收窄。 */
export function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertJsonValueInner(
	value: unknown,
	path: string,
	seen: Set<object>,
): void {
	if (value === null) return;
	switch (typeof value) {
		case "string":
		case "boolean":
			return;
		case "number":
			if (!Number.isFinite(value)) {
				throw new Error(`${path} 不是有限数字`);
			}
			return;
		case "object": {
			if (seen.has(value)) {
				throw new Error(`${path} 存在循环引用`);
			}
			seen.add(value);
			if (Array.isArray(value)) {
				for (let index = 0; index < value.length; index += 1) {
					assertJsonValueInner(value[index], `${path}[${index}]`, seen);
				}
			} else {
				const prototype = Object.getPrototypeOf(value);
				if (prototype !== Object.prototype && prototype !== null) {
					throw new Error(`${path} 不是纯 JSON 对象`);
				}
				for (const [key, child] of Object.entries(value)) {
					assertJsonValueInner(child, `${path}.${key}`, seen);
				}
			}
			seen.delete(value);
			return;
		}
		default:
			throw new Error(`${path} 不是 JSON 值（${typeof value}）`);
	}
}

/** 校验一个值可以被 JSON 序列化，错误信息带上字段路径。 */
export function assertJsonValue(value: unknown, path: string): void {
	assertJsonValueInner(value, path, new Set());
}

/** 收窄普通对象；数组、null 和其他类的实例都会被拒绝。 */
export function assertPlainObject(
	value: unknown,
	path: string,
): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} 必须是对象`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new Error(`${path} 必须是普通对象`);
	}
	return value as Record<string, unknown>;
}

/** 外部数据一律拒绝未知字段，避免拼错的字段名被静默忽略。 */
export function rejectUnknownKeys(
	object: Record<string, unknown>,
	allowed: readonly string[],
	path: string,
): void {
	for (const key of Object.keys(object)) {
		if (!allowed.includes(key)) {
			throw new Error(`${path}.${key} 是未知字段`);
		}
	}
}
