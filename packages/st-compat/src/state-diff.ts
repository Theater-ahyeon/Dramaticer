import { isDeepStrictEqual } from "node:util";
import type { JsonObject, JsonValue } from "./json.js";
import { isJsonObject } from "./json.js";

export type SnapshotDiffOp = "set" | "delete";

export interface SnapshotDiffSet {
	readonly path: readonly string[];
	readonly op: "set";
	readonly value: JsonValue;
}

export interface SnapshotDiffDelete {
	readonly path: readonly string[];
	readonly op: "delete";
}

export type SnapshotDiff = SnapshotDiffSet | SnapshotDiffDelete;

/**
 * 读取 MVU 快照；根不是对象时直接报错。
 *
 * null 表示这一层没有更新；ST 在没有变量更新的楼层写 `[{}]`，解析后是空对象，
 * 同样表示没有更新。真正清空全部变量时 MVU 写的是 `{"stat_data":{}}` 之类的嵌套空对象。
 */
export function readSnapshot(
	value: JsonValue,
	label: string,
): JsonObject | null {
	if (value === null) return null;
	if (!isJsonObject(value)) {
		throw new Error(`${label}的 MVU 变量快照必须是对象或 null`);
	}
	if (Object.keys(value).length === 0) return null;
	return value;
}

/**
 * 比较两个 MVU 快照，产出从 base 到 next 的增量。
 *
 * 对象逐键递归；消失的键写 delete；新出现的对象递归到叶子，空对象写 set 的 {}；
 * 数组整体比较，变化时在数组路径写 set。next 为 null 时没有更新。
 */
export function diffSnapshots(
	base: JsonObject | null,
	next: JsonObject | null,
): SnapshotDiff[] {
	const diffs: SnapshotDiff[] = [];
	if (next === null) return diffs;
	collectObjectDiffs(diffs, base ?? {}, next, []);
	return diffs;
}

function collectObjectDiffs(
	diffs: SnapshotDiff[],
	base: JsonObject,
	next: JsonObject,
	path: readonly string[],
): void {
	for (const key of Object.keys(next)) {
		const nextPath = [...path, key];
		const nextValue = next[key];
		if (Object.hasOwn(base, key)) {
			collectValueDiff(diffs, base[key], nextValue, nextPath);
		} else {
			collectFreshValue(diffs, nextValue, nextPath);
		}
	}
	for (const key of Object.keys(base)) {
		if (Object.hasOwn(next, key)) continue;
		diffs.push({ path: [...path, key], op: "delete" });
	}
}

function collectValueDiff(
	diffs: SnapshotDiff[],
	base: JsonValue,
	next: JsonValue,
	path: readonly string[],
): void {
	if (isDeepStrictEqual(base, next)) return;
	if (isJsonObject(base) && isJsonObject(next)) {
		collectObjectDiffs(diffs, base, next, path);
		return;
	}
	diffs.push({ path, op: "set", value: next });
}

function collectFreshValue(
	diffs: SnapshotDiff[],
	next: JsonValue,
	path: readonly string[],
): void {
	if (isJsonObject(next) && Object.keys(next).length > 0) {
		collectObjectDiffs(diffs, {}, next, path);
		return;
	}
	diffs.push({ path, op: "set", value: next });
}
