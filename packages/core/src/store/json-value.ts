import { assertJsonValue } from "../json.js";

export function serializeJsonValue(value: unknown, path: string): string {
	assertJsonValue(value, path);
	return JSON.stringify(value);
}
