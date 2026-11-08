import type { JsonObject } from "../json.js";
import { type DirectorIntensity, renderByIntensity } from "./intensity.js";
import { type ResolvedDirectorBeat, resolveCurrentBeat } from "./plan.js";
import type {
	DirectorMechanism,
	DirectorMechanismContext,
	DirectorMechanismResult,
	DirectorSuggestion,
} from "./types.js";

/**
 * 拍建议压过线索过多（20）、事件池（10）与节奏（5），
 * 让位给重复正文（40）、开场（35）、线索过老（30）与场景重复（25）。
 */
export const BEAT_PRIORITY = 23;

/** 决策记录里保存拍结果的键。 */
const SIGNAL_KEY = "beat";

/**
 * 短线层：从计划里取当前拍，按强度拼出一条具体建议。
 * 全程只读数据库与配置，不调用模型（I9）。
 */
export function createBeatMechanism(): DirectorMechanism {
	return {
		name: "beat",
		evaluate(context: DirectorMechanismContext): DirectorMechanismResult {
			const { store, storyId, nodeId, config } = context;
			const floorDepth = store
				.getPathToNode(nodeId)
				.filter((node) => node.role === "assistant").length;
			const resolved = resolveCurrentBeat(store, storyId, nodeId);
			if (resolved === null) {
				return idle("当前计划没有可推进的拍", {
					[SIGNAL_KEY]: { floorDepth, beatId: null },
				});
			}

			const intensity = config.intensity;
			const usedFitPoints =
				intensity === "setup" ? [] : [...resolved.beat.fitPoints];
			const signals: JsonObject = {
				[SIGNAL_KEY]: {
					arcId: resolved.arc.id,
					sequenceId: resolved.sequence.id,
					beatId: resolved.beat.id,
					intensity,
					difficulty: resolved.arc.difficulty,
					usedFitPoints,
					floorDepth,
				},
			};
			const suggestion: DirectorSuggestion = {
				mechanism: "beat",
				priority: BEAT_PRIORITY,
				directive: buildBeatDirective(resolved, intensity),
				signals,
			};
			return {
				triggered: true,
				reason: `当前拍 ${resolved.beat.id}，强度 ${intensity}`,
				suggestion,
				signals,
			};
		},
	};
}

function idle(reason: string, signals: JsonObject): DirectorMechanismResult {
	return { triggered: false, reason, suggestion: null, signals };
}

function buildBeatDirective(
	beat: ResolvedDirectorBeat,
	intensity: DirectorIntensity,
): string {
	return renderByIntensity(intensity, {
		setup: `当前拍：「${beat.beat.goal}」。起始迹象：${beat.beat.entrySigns.join("；")}。`,
		natural: `契合点：${beat.beat.fitPoints.join("；")}。`,
		detonate: `本楼必须出现可见变化。可选方向：${detonateDirections(beat).join("；")}。`,
	});
}

/** 三条方向都从计划原文里取，不另造情节。 */
function detonateDirections(beat: ResolvedDirectorBeat): string[] {
	return [
		`直接推进目标：让「${beat.beat.goal}」在本楼有结果`,
		`让起始迹象当场出现：${first(beat.beat.entrySigns)}`,
		`用契合点引爆冲突：${first(beat.beat.fitPoints)}`,
	];
}

function first(items: readonly string[]): string {
	const value = items[0];
	if (value === undefined) {
		throw new Error("导演节拍缺少起始迹象或契合点");
	}
	return value;
}
