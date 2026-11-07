import { type JsonObject, isJsonObject } from "../json.js";
import type { MemoryEvent } from "../memory/event.js";
import { readStateValue } from "../state.js";
import type { TimelineNode } from "../timeline.js";
import type {
	DirectorConfig,
	DirectorDecision,
	DirectorMechanism,
	DirectorMechanismContext,
	DirectorMechanismResult,
	DirectorSuggestion,
} from "./types.js";

/** 节奏指令是兜底语气，低于事件池，有更具体的建议时让位。 */
export const PACING_PRIORITY = 5;

/** 推导张力时查看的已确认助手楼层数。 */
export const TENSION_WINDOW_FLOORS = 3;

const SIGNAL_KEY = "pacing";

export type DirectorPhase = "setup" | "escalate" | "climax" | "breathe";

const PHASES: readonly DirectorPhase[] = [
	"setup",
	"escalate",
	"climax",
	"breathe",
];

const PHASE_DIRECTIVES: Record<DirectorPhase, string> = {
	setup:
		"阶段：铺垫。稳住节奏，交代必要的环境与人物关系，为下一次冲突积累条件。",
	escalate: "阶段：升级。让当前冲突加码，给主角制造新的阻力或代价。",
	climax: "阶段：高潮。集中释放冲突，写出明确的对决、抉择或其结果。",
	breathe: "阶段：喘息。放慢节奏，处理高潮后的余波与人物关系变化。",
};

interface PreviousPhase {
	readonly phase: DirectorPhase;
	readonly phaseStartNodeId: string;
}

interface TensionResult {
	readonly tension: number;
	readonly source: "state" | "derived";
	readonly components: JsonObject;
}

/**
 * 节奏状态机：张力优先读状态路径，取不到时用最近 3 个已确认助手楼层推导；
 * 阶段按张力与当前阶段已持续的楼层数转移。只在阶段变化时给出指令，当前阶段
 * 与张力每轮都写入决策记录，下一轮按当前路径的记录恢复状态。
 */
export function createPacingMechanism(): DirectorMechanism {
	return {
		name: "pacing",
		evaluate(context: DirectorMechanismContext): DirectorMechanismResult {
			const { store, storyId, nodeId, config } = context;
			const path = store.getPathToNode(nodeId);
			const positions = new Map(
				path.map((node, index) => [node.id, index] as const),
			);
			const currentPosition = path.length - 1;
			const previous = recoverPhase(
				store.getDirectorDecisionsAlongPath(nodeId),
				positions,
			);

			let phase = previous === null ? "setup" : previous.phase;
			let phaseStartNodeId =
				previous === null ? nodeId : previous.phaseStartNodeId;
			let floorsInPhase = positions.get(phaseStartNodeId);
			if (floorsInPhase === undefined) {
				phase = "setup";
				phaseStartNodeId = nodeId;
				floorsInPhase = currentPosition;
			} else {
				floorsInPhase = currentPosition - floorsInPhase;
			}

			const tension = resolveTension(path, nodeId, context);
			const previousPhase = phase;
			const requiredSetupFloors = requiredFloors(
				config.minSetupFloors,
				config.pace,
			);
			const requiredEscalateFloors = requiredFloors(
				config.minEscalateFloors,
				config.pace,
			);

			const next = nextPhase(phase, {
				tension: tension.tension,
				floorsInPhase,
				config,
				requiredSetupFloors,
				requiredEscalateFloors,
			});
			const changed = next !== phase;
			phase = next;

			const signals: JsonObject = {
				[SIGNAL_KEY]: {
					phase,
					previousPhase,
					changed,
					phaseStartNodeId: changed ? nodeId : phaseStartNodeId,
					floorsInPhase: changed ? 0 : floorsInPhase,
					tension: tension.tension,
					tensionSource: tension.source,
					tensionPath:
						config.tensionPath === undefined ? null : [...config.tensionPath],
					components: tension.components,
					thresholds: {
						escalate: config.tensionEscalate,
						climax: config.tensionClimax,
					},
					weights: {
						state: config.tensionStateWeight,
						note: config.tensionNoteWeight,
						event: config.tensionEventWeight,
					},
					pace: config.pace,
					requiredSetupFloors,
					requiredEscalateFloors,
					climaxFloors: config.climaxFloors,
					breatheFloors: config.breatheFloors,
				},
			};

			if (!changed) {
				return {
					triggered: false,
					reason: `阶段保持 ${phase}：张力 ${tension.tension.toFixed(2)}，已持续 ${floorsInPhase} 楼`,
					suggestion: null,
					signals,
				};
			}

			const suggestion: DirectorSuggestion = {
				mechanism: "pacing",
				priority: PACING_PRIORITY,
				directive: PHASE_DIRECTIVES[phase],
				signals,
			};
			return {
				triggered: true,
				reason: `${previousPhase} → ${phase}：张力 ${tension.tension.toFixed(2)}，在 ${floorsInPhase} 楼后转移`,
				suggestion,
				signals,
			};
		},
	};
}

interface NextPhaseInput {
	readonly tension: number;
	readonly floorsInPhase: number;
	readonly config: DirectorConfig;
	readonly requiredSetupFloors: number;
	readonly requiredEscalateFloors: number;
}

function nextPhase(phase: DirectorPhase, input: NextPhaseInput): DirectorPhase {
	switch (phase) {
		case "setup":
			return input.tension >= input.config.tensionEscalate &&
				input.floorsInPhase >= input.requiredSetupFloors
				? "escalate"
				: phase;
		case "escalate":
			return input.tension >= input.config.tensionClimax &&
				input.floorsInPhase >= input.requiredEscalateFloors
				? "climax"
				: phase;
		case "climax":
			return input.floorsInPhase >= input.config.climaxFloors
				? "breathe"
				: phase;
		case "breathe":
			return input.floorsInPhase >= input.config.breatheFloors
				? "setup"
				: phase;
	}
}

function requiredFloors(base: number, pace: number): number {
	return Math.max(1, Math.ceil(base / pace));
}

function recoverPhase(
	decisions: readonly DirectorDecision[],
	positions: ReadonlyMap<string, number>,
): PreviousPhase | null {
	for (let index = decisions.length - 1; index >= 0; index -= 1) {
		const decision = decisions[index];
		if (decision === undefined) continue;
		const value = decision.signals[SIGNAL_KEY];
		if (value === undefined) continue;
		if (!isJsonObject(value)) {
			throw new Error(`楼层 ${decision.nodeId} 的节奏信号必须是对象`);
		}
		const phase = value.phase;
		if (typeof phase !== "string" || !PHASES.includes(phase as DirectorPhase)) {
			throw new Error(
				`楼层 ${decision.nodeId} 的节奏阶段非法：${String(phase)}`,
			);
		}
		const phaseStartNodeId = value.phaseStartNodeId;
		if (typeof phaseStartNodeId !== "string" || phaseStartNodeId.length === 0) {
			throw new Error(`楼层 ${decision.nodeId} 的节奏起点必须是非空字符串`);
		}
		if (!positions.has(phaseStartNodeId)) return null;
		return { phase: phase as DirectorPhase, phaseStartNodeId };
	}
	return null;
}

function resolveTension(
	path: readonly TimelineNode[],
	nodeId: string,
	context: DirectorMechanismContext,
): TensionResult {
	const { store, config } = context;
	if (config.tensionPath !== undefined) {
		const value = readStateValue(
			store.getStateSnapshot(nodeId).state,
			config.tensionPath,
		);
		if (value !== undefined) {
			if (
				typeof value !== "number" ||
				!Number.isFinite(value) ||
				value < 0 ||
				value > 1
			) {
				throw new Error(
					`导演配置的 tensionPath 取到的值必须是 0 到 1 之间的数字：${JSON.stringify(value)}`,
				);
			}
			return { tension: value, source: "state", components: {} };
		}
	}

	const assistantFloors = path.filter(
		(node) => node.role === "assistant" && store.isNodeConfirmed(node.id),
	);
	const recent = assistantFloors.slice(-TENSION_WINDOW_FLOORS);
	let stateDiffs = 0;
	let plotNotes = 0;
	let latestEvent: MemoryEvent | null = null;
	for (const floor of recent) {
		stateDiffs += store.getStateDiffs(floor.id).length;
		plotNotes += store.countPlotNotesForNode(floor.id);
		const events = store.getEventsForNode(floor.id);
		const last = events[events.length - 1];
		if (last !== undefined) latestEvent = last;
	}

	const stateDiffScore = clamp01(
		stateDiffs / (TENSION_WINDOW_FLOORS * config.tensionStateDiffsPerFloor),
	);
	const plotNoteScore = clamp01(
		plotNotes / (TENSION_WINDOW_FLOORS * config.tensionNotesPerFloor),
	);
	const eventImportance = latestEvent === null ? null : latestEvent.importance;
	const eventScore = latestEvent === null ? 0 : latestEvent.importance;
	const tension = clamp01(
		config.tensionStateWeight * stateDiffScore +
			config.tensionNoteWeight * plotNoteScore +
			config.tensionEventWeight * eventScore,
	);

	return {
		tension,
		source: "derived",
		components: {
			floorIds: recent.map((floor) => floor.id),
			stateDiffs,
			stateDiffScore,
			plotNotes,
			plotNoteScore,
			eventImportance,
			eventScore,
		},
	};
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
