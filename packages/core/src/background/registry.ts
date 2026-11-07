import {
	type BackgroundJobHandler,
	type BackgroundJobRegistry,
	type BackgroundJobType,
	isBackgroundJobEnqueueCondition,
} from "./types.js";

/** 处理器可以只写函数（入队条件为 confirmed），也可以附带入队条件。 */
export type BackgroundJobEntry = BackgroundJobHandler | BackgroundJobType;

export function createBackgroundJobRegistry(
	handlers: Readonly<Record<string, BackgroundJobEntry>>,
): BackgroundJobRegistry {
	const registry = new Map<string, BackgroundJobType>();
	for (const [kind, entry] of Object.entries(handlers)) {
		if (kind.length === 0 || kind !== kind.trim()) {
			throw new Error(`后台任务类型必须是去掉首尾空白后的非空字符串：${kind}`);
		}
		registry.set(kind, normaliseEntry(kind, entry));
	}
	return registry;
}

function normaliseEntry(
	kind: string,
	entry: BackgroundJobEntry,
): BackgroundJobType {
	if (typeof entry === "function") {
		return { handler: entry, enqueue: "confirmed" };
	}
	if (entry === null || typeof entry !== "object") {
		throw new Error(`后台任务类型 ${kind} 的定义必须是函数或对象`);
	}
	if (typeof entry.handler !== "function") {
		throw new Error(`后台任务类型 ${kind} 的处理器必须是函数`);
	}
	if (!isBackgroundJobEnqueueCondition(entry.enqueue)) {
		throw new Error(
			`后台任务类型 ${kind} 的入队条件不合法：${String(entry.enqueue)}`,
		);
	}
	return { handler: entry.handler, enqueue: entry.enqueue };
}
