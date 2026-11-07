import type { BackgroundJobHandler, BackgroundJobRegistry } from "./types.js";

export function createBackgroundJobRegistry(
	handlers: Readonly<Record<string, BackgroundJobHandler>>,
): BackgroundJobRegistry {
	const registry = new Map<string, BackgroundJobHandler>();
	for (const [kind, handler] of Object.entries(handlers)) {
		if (kind.length === 0 || kind !== kind.trim()) {
			throw new Error(`后台任务类型必须是去掉首尾空白后的非空字符串：${kind}`);
		}
		if (typeof handler !== "function") {
			throw new Error(`后台任务类型 ${kind} 的处理器必须是函数`);
		}
		registry.set(kind, handler);
	}
	return registry;
}
