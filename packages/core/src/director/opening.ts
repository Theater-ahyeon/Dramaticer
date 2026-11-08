import type { JsonObject } from "../json.js";
import {
	type OpeningPackPayload,
	readOpeningPack,
} from "../opening/opening.js";
import { type DirectorIntensity, renderByIntensity } from "./intensity.js";
import type {
	DirectorMechanism,
	DirectorMechanismContext,
	DirectorMechanismResult,
	DirectorSuggestion,
} from "./types.js";

/**
 * 开局建议优先于线索年龄（30）与节奏（5），重复度（40）仍然盖过它，
 * 因为重复是更紧急的止损信号。
 */
export const OPENING_PRIORITY = 35;

/** 决策记录里保存开局结果的键。 */
const SIGNAL_KEY = "opening";

type OpeningField =
	| "place"
	| "time"
	| "participants"
	| "conflict"
	| "directions";

const FIELDS_BY_INTENSITY: Record<DirectorIntensity, readonly OpeningField[]> =
	{
		setup: ["place", "time", "conflict"],
		natural: ["place", "time", "participants", "conflict"],
		detonate: ["place", "time", "participants", "conflict", "directions"],
	};

/**
 * 开场导演：当前路径的助手楼层数小于 `openingFloors` 时，用后台备好的开局包
 * 给出一条具体建议。只读数据库与配置，不调用模型（I9）。
 */
export function createOpeningMechanism(): DirectorMechanism {
	return {
		name: "opening",
		evaluate(context: DirectorMechanismContext): DirectorMechanismResult {
			const { store, storyId, nodeId, config } = context;
			const floorDepth = store
				.getPathToNode(nodeId)
				.filter((node) => node.role === "assistant").length;
			const baseSignals: JsonObject = {
				[SIGNAL_KEY]: {
					floorDepth,
					openingFloors: config.openingFloors,
					intensity: config.openingIntensity,
					usedFields: [],
				},
			};

			if (floorDepth >= config.openingFloors) {
				return idle(
					`当前路径已有 ${floorDepth} 个助手楼层，不小于开场阈值 ${config.openingFloors}`,
					baseSignals,
				);
			}
			const pack = readOpeningPack(store, storyId);
			if (pack === null) {
				return idle("故事还没有开局包", baseSignals);
			}

			const usedFields = FIELDS_BY_INTENSITY[config.openingIntensity];
			const signals: JsonObject = {
				[SIGNAL_KEY]: {
					floorDepth,
					openingFloors: config.openingFloors,
					intensity: config.openingIntensity,
					usedFields: [...usedFields],
				},
			};
			const suggestion: DirectorSuggestion = {
				mechanism: "opening",
				priority: OPENING_PRIORITY,
				directive: buildDirective(
					pack,
					floorDepth + 1,
					config.openingIntensity,
				),
				signals,
			};
			return {
				triggered: true,
				reason: `开场第 ${floorDepth + 1} 楼，强度 ${config.openingIntensity}`,
				suggestion,
				signals,
			};
		},
	};
}

function idle(reason: string, signals: JsonObject): DirectorMechanismResult {
	return { triggered: false, reason, suggestion: null, signals };
}

function buildDirective(
	pack: OpeningPackPayload,
	floor: number,
	intensity: DirectorIntensity,
): string {
	return renderByIntensity(intensity, {
		setup: [
			`开场第 ${floor} 楼：场景在${pack.place}，时间是${pack.time}。`,
			`本楼目标：让冲突「${pack.conflict}」往前推进。`,
		].join(""),
		natural: `在场人物各自的行动：${pack.participants
			.map(
				(participant) =>
					`${participant.name}会为「${participant.wants}」采取行动`,
			)
			.join("；")}。`,
		detonate: `开场方向可选：${pack.directions.join("；")}。本轮挑一条推进，让冲突当场出现变化。`,
	});
}
