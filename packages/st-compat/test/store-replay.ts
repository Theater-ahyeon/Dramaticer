import type {
	JsonObject,
	JsonValue,
	StateDiff,
	StoryStore,
} from "../src/index.js";
import { isJsonObject } from "../src/index.js";

/** 把按路径顺序（根在前）排列的 diff 依次累加到一个空对象上。 */
export function replayDiffs(diffs: readonly StateDiff[]): JsonObject {
	const root: JsonObject = {};
	for (const diff of diffs) {
		let parent = root;
		for (const key of diff.path.slice(0, -1)) {
			const child = parent[key];
			if (child === undefined) {
				const created: JsonObject = {};
				parent[key] = created;
				parent = created;
				continue;
			}
			if (!isJsonObject(child)) {
				throw new Error(`路径 ${diff.path.join(".")} 的父级不是对象`);
			}
			parent = child;
		}
		const leaf = diff.path[diff.path.length - 1];
		if (leaf === undefined) {
			throw new Error("状态 diff 的路径为空");
		}
		if (diff.op === "set") {
			parent[leaf] = diff.value as JsonValue;
		} else {
			delete parent[leaf];
		}
	}
	return root;
}

/** 回放某个楼层节点沿路径累加后的变量快照。 */
export function snapshotAt(store: StoryStore, nodeId: string): JsonObject {
	return replayDiffs(store.getStateDiffsAlongPath(nodeId));
}

/** 回放某个楼层的 MVU 变量快照；没有变量时返回空对象。 */
export function mvuSnapshotAt(store: StoryStore, nodeId: string): JsonObject {
	const root = snapshotAt(store, nodeId);
	const value = root.mvu;
	if (value === undefined) return {};
	if (!isJsonObject(value)) {
		throw new Error(`楼层 ${nodeId} 的 mvu 命名空间不是对象`);
	}
	return value;
}
