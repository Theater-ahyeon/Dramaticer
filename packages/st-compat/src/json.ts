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

export function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
