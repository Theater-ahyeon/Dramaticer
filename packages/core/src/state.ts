import type { JsonObject, JsonValue } from "./json.js";
import type { StateDiff } from "./timeline.js";

/** 沿路径累加状态 diff，得到当前状态。删除不存在的路径按没有变化处理。 */
export function applyStateDiffs(diffs: readonly StateDiff[]): JsonObject {
	const root: JsonObject = {};
	for (const diff of diffs) {
		validatePath(diff.path);
		if (diff.op === "set") {
			setValue(root, diff.path as readonly string[], diff.value);
		} else {
			deleteValue(root, diff.path as readonly string[]);
		}
	}
	return root;
}

function validatePath(path: readonly string[]): void {
	if (
		!Array.isArray(path) ||
		path.length === 0 ||
		path.some((segment) => typeof segment !== "string" || segment.length === 0)
	) {
		throw new Error("状态 diff 的 path 必须是非空字符串组成的非空数组");
	}
}

function setValue(
	root: JsonObject,
	path: readonly string[],
	value: unknown,
): void {
	let current: JsonObject = root;
	for (const segment of path.slice(0, -1)) {
		const next = Object.hasOwn(current, segment) ? current[segment] : undefined;
		if (typeof next === "object" && next !== null && !Array.isArray(next)) {
			current = next as JsonObject;
			continue;
		}
		const created: JsonObject = {};
		defineOwn(current, segment, created);
		current = created;
	}
	defineOwn(current, path[path.length - 1] as string, value as JsonValue);
}

function deleteValue(root: JsonObject, path: readonly string[]): void {
	let current: JsonObject = root;
	for (const segment of path.slice(0, -1)) {
		const next = Object.hasOwn(current, segment) ? current[segment] : undefined;
		if (typeof next !== "object" || next === null || Array.isArray(next)) {
			return;
		}
		current = next as JsonObject;
	}
	delete (current as Record<string, unknown>)[path[path.length - 1] as string];
}

/** 用 defineProperty 写自身属性，避免 __proto__ 之类的段修改原型链。 */
function defineOwn(target: JsonObject, key: string, value: JsonValue): void {
	Object.defineProperty(target, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true,
	});
}
