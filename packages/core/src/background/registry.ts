import type { StoryStore } from "../store/story-store.js";
import {
	type BackgroundJobEnqueueCondition,
	type BackgroundJobHandler,
	type BackgroundJobRegistry,
	type BackgroundJobTier,
	type BackgroundJobType,
	isBackgroundJobEnqueueCondition,
	isBackgroundJobTier,
} from "./types.js";

/** 任务定义；入队条件缺省为 confirmed，档位缺省为 gap。 */
export interface BackgroundJobDefinition {
	readonly handler: BackgroundJobHandler;
	readonly enqueue?: BackgroundJobEnqueueCondition;
	readonly tier?: BackgroundJobTier;
	/** 入队条件为 story 时必须提供；判断当前故事是否需要这个任务。 */
	readonly needsRun?: (store: StoryStore, storyId: string) => boolean;
}

/** 处理器可以只写函数，也可以附带入队条件与档位。 */
export type BackgroundJobEntry = BackgroundJobHandler | BackgroundJobDefinition;

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
		return { handler: entry, enqueue: "confirmed", tier: "gap" };
	}
	if (entry === null || typeof entry !== "object") {
		throw new Error(`后台任务类型 ${kind} 的定义必须是函数或对象`);
	}
	if (typeof entry.handler !== "function") {
		throw new Error(`后台任务类型 ${kind} 的处理器必须是函数`);
	}
	const enqueue = entry.enqueue ?? "confirmed";
	if (!isBackgroundJobEnqueueCondition(enqueue)) {
		throw new Error(
			`后台任务类型 ${kind} 的入队条件不合法：${String(enqueue)}`,
		);
	}
	const resolvedTier = entry.tier ?? "gap";
	if (!isBackgroundJobTier(resolvedTier)) {
		throw new Error(`后台任务类型 ${kind} 的档位不合法：${String(entry.tier)}`);
	}
	const needsRun = entry.needsRun;
	if (needsRun !== undefined) {
		if (typeof needsRun !== "function") {
			throw new Error(`后台任务类型 ${kind} 的 needsRun 必须是函数`);
		}
		if (enqueue !== "story") {
			throw new Error(
				`后台任务类型 ${kind} 只有在入队条件为 story 时才能提供 needsRun`,
			);
		}
	}
	if (enqueue === "story" && needsRun === undefined) {
		throw new Error(
			`后台任务类型 ${kind} 的入队条件是 story，必须提供 needsRun`,
		);
	}
	return {
		handler: entry.handler,
		enqueue,
		tier: resolvedTier,
		...(needsRun === undefined ? {} : { needsRun }),
	};
}
