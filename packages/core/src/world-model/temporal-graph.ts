import type { JsonValue } from "../json.js";
import { isJsonObject } from "../json.js";
import { ledgerSourceOf, readLedger } from "../ledger/read.js";
import { type LedgerSource, isLedgerNamespace } from "../ledger/schema.js";
import { applyDiffEntriesTo } from "../state.js";
import type { StoryStore } from "../store/story-store.js";
import type { StateDiff, StoryTime } from "../timeline.js";
import { createLedgerWorldModel } from "./ledger.js";
import {
	type WorldModel,
	type WorldModelReadOptions,
	type WorldModelSection,
	type WorldModelView,
	type WorldModelWrite,
	type WorldModelWriteResult,
	assertTimeQuerySupported,
} from "./types.js";

/** 一版事实失效的原因：被同一路径的新值取代，或被删除。 */
export type TemporalEndReason = "superseded" | "deleted";

/**
 * 一版事实的有效区间。`endNodeId` 为空表示仍然成立；
 * `endStoryTime` 是结束事件自带的故事时间，参与按时间点判断。
 */
export interface TemporalFactVersion {
	readonly path: readonly string[];
	readonly value: JsonValue;
	readonly storyTime: StoryTime | null;
	readonly source: LedgerSource;
	readonly startNodeId: string;
	readonly endNodeId: string | null;
	readonly endReason: TemporalEndReason | null;
	readonly endStoryTime: StoryTime | null;
}

/** 时序图谱候选：读取除了统一视图，还能列出全部事实版本。 */
export interface TemporalGraphWorldModel extends WorldModel {
	versions(nodeId: string): readonly TemporalFactVersion[];
}

/**
 * 台账 diff 加上有效区间：每次 set 开启一版并取代同一路径上的旧版本，
 * delete 关闭区间并保留最后一版的值。记录只读，不新增表。
 */
export function createTemporalGraphWorldModel(
	store: StoryStore,
): TemporalGraphWorldModel {
	const ledger = createLedgerWorldModel(store);
	return {
		kind: "temporal_graph",
		read(nodeId: string, options?: WorldModelReadOptions): WorldModelView {
			assertTimeQuerySupported("temporal_graph", options);
			const diffs = store.getStateDiffsAlongPath(nodeId);
			const versions = replayVersions(diffs);
			if (options?.atStoryTime !== undefined) {
				return readAtStoryTime(nodeId, diffs, versions, options.atStoryTime);
			}
			const state = readLedger(store, nodeId);
			if (!isJsonObject(state)) {
				throw new Error(`台账快照 ${nodeId} 不是对象`);
			}
			const expired = versions.filter((version) => version.endNodeId !== null);
			return {
				state,
				sections: expiredSections(expired),
				source: `state:${diffs.length} 条 diff，已失效 ${expired.length} 条`,
			};
		},
		write(
			nodeId: string,
			writes: readonly WorldModelWrite[],
		): WorldModelWriteResult {
			return ledger.write(nodeId, writes);
		},
		versions(nodeId: string): readonly TemporalFactVersion[] {
			return replayVersions(store.getStateDiffsAlongPath(nodeId));
		},
	};
}

interface MutableVersion {
	path: string[];
	value: JsonValue;
	storyTime: StoryTime | null;
	source: LedgerSource;
	startNodeId: string;
	endNodeId: string | null;
	endReason: TemporalEndReason | null;
	endStoryTime: StoryTime | null;
}

function replayVersions(diffs: readonly StateDiff[]): TemporalFactVersion[] {
	const versions: MutableVersion[] = [];
	const active = new Map<string, MutableVersion>();
	for (const diff of diffs) {
		if (!isLedgerNamespace(diff.path[0] ?? "")) continue;
		closeVersions(active, diff);
		if (diff.op === "delete") continue;
		const version: MutableVersion = {
			path: [...diff.path],
			value: diff.value as JsonValue,
			storyTime: diff.storyTime,
			source: ledgerSourceOf(diff),
			startNodeId: diff.nodeId,
			endNodeId: null,
			endReason: null,
			endStoryTime: null,
		};
		versions.push(version);
		active.set(JSON.stringify(diff.path), version);
	}
	return versions;
}

/**
 * set 或 delete 都替换掉该路径与它下面的值；路径上方的版本仍然成立。
 */
function closeVersions(
	active: Map<string, MutableVersion>,
	diff: StateDiff,
): void {
	for (const [key, version] of active) {
		if (!isPathPrefix(diff.path, version.path)) continue;
		version.endNodeId = diff.nodeId;
		version.endReason = diff.op === "delete" ? "deleted" : "superseded";
		version.endStoryTime = diff.storyTime;
		active.delete(key);
	}
}

function isPathPrefix(
	prefix: readonly string[],
	path: readonly string[],
): boolean {
	if (prefix.length > path.length) return false;
	return prefix.every((segment, index) => segment === path[index]);
}

function readAtStoryTime(
	nodeId: string,
	diffs: readonly StateDiff[],
	versions: readonly TemporalFactVersion[],
	label: string,
): WorldModelView {
	if (typeof label !== "string" || label.trim().length === 0) {
		throw new Error(
			`按故事时间点查询的时间点必须是非空字符串，收到 ${JSON.stringify(label)}`,
		);
	}
	const order = timeLabelOrder(diffs);
	const queryIndex = order.get(label);
	if (queryIndex === undefined) {
		throw new Error(
			`故事时间点 ${JSON.stringify(label)} 在楼层 ${nodeId} 的路径上没有记录`,
		);
	}
	const selected = new Map<string, TemporalFactVersion>();
	for (const version of versions) {
		if (version.storyTime === null) continue;
		const startIndex =
			version.storyTime.start === null
				? undefined
				: order.get(version.storyTime.start);
		if (startIndex !== undefined && startIndex > queryIndex) continue;
		const endIndex = effectiveEndIndex(version, order);
		if (endIndex !== undefined && endIndex < queryIndex) continue;
		selected.set(JSON.stringify(version.path), version);
	}
	const entries = [...selected.values()].map((version) => ({
		path: version.path,
		op: "set" as const,
		value: version.value as JsonValue,
	}));
	return {
		state: applyDiffEntriesTo({}, entries),
		sections: [],
		source: `state:时序图谱 ${entries.length} 条事实，故事时间 ${label}`,
	};
}

/**
 * 故事时间标签是不透明文字，按它们在当前路径上第一次出现的顺序排序；
 * 一次事实的结束时间取自身记录的终点与结束事件时间的较早者。
 */
function timeLabelOrder(diffs: readonly StateDiff[]): Map<string, number> {
	const order = new Map<string, number>();
	const add = (label: string | null): void => {
		if (label !== null && !order.has(label)) order.set(label, order.size);
	};
	for (const diff of diffs) {
		if (!isLedgerNamespace(diff.path[0] ?? "")) continue;
		add(diff.storyTime?.start ?? null);
		add(diff.storyTime?.end ?? null);
	}
	return order;
}

function effectiveEndIndex(
	version: TemporalFactVersion,
	order: Map<string, number>,
): number | undefined {
	const indexes: number[] = [];
	const ownEnd = version.storyTime?.end ?? null;
	const ownIndex = ownEnd === null ? undefined : order.get(ownEnd);
	if (ownIndex !== undefined) indexes.push(ownIndex);
	const closingBound = version.endStoryTime?.start ?? version.endStoryTime?.end;
	const closingIndex =
		closingBound === null || closingBound === undefined
			? undefined
			: order.get(closingBound);
	if (closingIndex !== undefined) indexes.push(closingIndex);
	if (indexes.length === 0) return undefined;
	return Math.min(...indexes);
}

function expiredSections(
	expired: readonly TemporalFactVersion[],
): WorldModelSection[] {
	if (expired.length === 0) return [];
	return [
		{
			title: "已失效事实",
			text: expired.map(formatExpired).join("\n"),
		},
	];
}

function formatExpired(version: TemporalFactVersion): string {
	const storyTime =
		version.storyTime === null
			? "未记录"
			: `${version.storyTime.start ?? "…"} 至 ${version.storyTime.end ?? "…"}`;
	const reason = version.endReason === "deleted" ? "已删除" : "被新值取代";
	return `${JSON.stringify(version.path)} = ${JSON.stringify(version.value)}（楼层 ${version.startNodeId} → ${version.endNodeId ?? "?"}；原因 ${reason}；来源 ${version.source}；故事时间 ${storyTime}）`;
}
