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
