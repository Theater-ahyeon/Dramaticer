import { evaluateContextCondition } from "../context/template.js";
import { type JsonObject, isJsonObject } from "../json.js";
import type { EventPoolEntry } from "./pool.js";
import type {
	DirectorMechanism,
	DirectorMechanismContext,
	DirectorMechanismResult,
	DirectorSuggestion,
} from "./types.js";

/**
 * 事件池是最后手段：线索机制负责回收已有伏笔，事件池只在剧情停滞时注入
 * 卡作者准备的新事件，所以优先级低于线索。
 */
export const EVENT_POOL_PRIORITY = 10;

/** 决策记录里保存事件池结果的键，避免与其他机制的信号字段重名。 */
const SIGNAL_KEY = "eventPool";

interface Candidate {
	readonly entry: EventPoolEntry;
	readonly lastUsed: number;
	readonly surpriseHash: number;
}

/**
 * 事件池机制：当前分支最近 `stallFloors` 个已确认助手楼层既没有状态 diff、
 * 也没有新建剧情笔记时，按上次使用位置与 `source_id` 挑一条条件成立且不在
 * 冷却内的事件。只读数据库，不调用模型。
 */
export function createEventPoolMechanism(): DirectorMechanism {
	return {
		name: "event_pool",
		evaluate(context: DirectorMechanismContext): DirectorMechanismResult {
			const { store, storyId, nodeId, config } = context;
			const stallFloors = config.stallFloors;
			const path = store.getPathToNode(nodeId);
			const currentPosition = path.length - 1;
			const pool = store.listEventPool(storyId);

			const assistantFloors = path.filter(
				(node) => node.role === "assistant" && store.isNodeConfirmed(node.id),
			);
			const recent = assistantFloors.slice(-stallFloors);
			const checkedFloors = recent.map((node) => ({
				nodeId: node.id,
				stateDiffs: store.getStateDiffs(node.id).length,
				plotNotes: store.countPlotNotesForNode(node.id),
			}));
			const enoughFloors = recent.length === stallFloors;
			const stalled =
				enoughFloors &&
				checkedFloors.every(
					(floor) => floor.stateDiffs === 0 && floor.plotNotes === 0,
				);

			const baseSignals: JsonObject = {
				stallFloors,
				confirmedAssistantFloors: assistantFloors.length,
				checkedFloors,
				poolSize: pool.length,
				surprise: config.surprise,
			};

			if (pool.length === 0) {
				return idle("事件池为空", baseSignals);
			}
			if (!enoughFloors) {
				return idle(
					`当前分支只有 ${assistantFloors.length} 个已确认助手楼层，不足 ${stallFloors}`,
					baseSignals,
				);
			}
			if (!stalled) {
				return idle(
					`最近 ${stallFloors} 个已确认助手楼层里仍有状态 diff 或新建剧情笔记`,
					baseSignals,
				);
			}

			const state = store.getStateSnapshot(nodeId).state;
			const facts = { state, switches: {} };
			const positions = new Map(
				path.map((node, index) => [node.id, index] as const),
			);
			const lastUsed = lastUsageBySource(
				store.getDirectorDecisionsAlongPath(nodeId),
				positions,
				currentPosition,
			);

			const skipped: JsonObject[] = [];
			const eligible: Candidate[] = [];
			for (const entry of pool) {
				if (!entry.enabled) {
					skipped.push({ sourceId: entry.sourceId, reason: "已停用" });
					continue;
				}
				if (
					entry.preconditions !== null &&
					!evaluateContextCondition(entry.preconditions, facts)
				) {
					skipped.push({ sourceId: entry.sourceId, reason: "条件不成立" });
					continue;
				}
				const used = lastUsed.get(entry.sourceId) ?? -1;
				if (used >= 0 && currentPosition - used <= entry.cooldown) {
					skipped.push({ sourceId: entry.sourceId, reason: "仍在冷却" });
					continue;
				}
				eligible.push({
					entry,
					lastUsed: used,
					surpriseHash: stableUnitHash(
						`${storyId}\u0000${nodeId}\u0000${entry.sourceId}`,
					),
				});
			}
			eligible.sort((left, right) => {
				if (left.lastUsed !== right.lastUsed) {
					return left.lastUsed - right.lastUsed;
				}
				if (left.entry.sourceId === right.entry.sourceId) return 0;
				return left.entry.sourceId < right.entry.sourceId ? -1 : 1;
			});

			const candidates = eligible.map((candidate) => ({
				sourceId: candidate.entry.sourceId,
				lastUsed: candidate.lastUsed,
				surpriseHash: candidate.surpriseHash,
			}));
			const selected = eligible.find(
				(candidate) => candidate.surpriseHash < config.surprise,
			);
			if (selected === undefined) {
				const reason =
					eligible.length === 0
						? "没有通过条件与冷却的事件"
						: `没有事件通过意外门槛 ${config.surprise}`;
				return idle(reason, {
					...baseSignals,
					candidates,
					skipped,
				});
			}

			const detail: JsonObject = {
				...baseSignals,
				candidates,
				skipped,
				selectedSourceId: selected.entry.sourceId,
				selectedSurpriseHash: selected.surpriseHash,
				selectedLastUsed: selected.lastUsed,
			};
			const signals: JsonObject = { [SIGNAL_KEY]: detail };
			const suggestion: DirectorSuggestion = {
				mechanism: "event_pool",
				priority: EVENT_POOL_PRIORITY,
				directive: selected.entry.text,
				signals,
			};
			return {
				triggered: true,
				reason: `剧情停滞 ${stallFloors} 楼，选择事件 ${selected.entry.sourceId}`,
				suggestion,
				signals,
			};
		},
	};
}

function idle(reason: string, base: JsonObject): DirectorMechanismResult {
	const signals: JsonObject = {
		[SIGNAL_KEY]: { ...base, selectedSourceId: null },
	};
	return { triggered: false, reason, suggestion: null, signals };
}

/**
 * 读取当前分支上每个事件最近一次被选中的位置。当前楼层自己的旧记录不算，
 * 这样同一路径重复评估会得到同一条事件。
 */
function lastUsageBySource(
	decisions: readonly {
		readonly nodeId: string;
		readonly signals: JsonObject;
	}[],
	positions: ReadonlyMap<string, number>,
	currentPosition: number,
): Map<string, number> {
	const used = new Map<string, number>();
	for (const decision of decisions) {
		const position = positions.get(decision.nodeId);
		if (position === undefined || position === currentPosition) continue;
		const signal = decision.signals[SIGNAL_KEY];
		if (!isJsonObject(signal)) continue;
		const sourceId = signal.selectedSourceId;
		if (typeof sourceId !== "string" || sourceId.length === 0) continue;
		const previous = used.get(sourceId);
		if (previous === undefined || position > previous) {
			used.set(sourceId, position);
		}
	}
	return used;
}

/** FNV-1a 32 位哈希，映射到 [0, 1)，用于按楼层稳定地决定是否触发。 */
export function stableUnitHash(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash / 0x1_0000_0000;
}
