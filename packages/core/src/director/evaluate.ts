import type { JsonObject } from "../json.js";
import type { StoryStore } from "../store/story-store.js";
import { createClueTrackingMechanism } from "./clue.js";
import { createEventPoolMechanism } from "./event-pool.js";
import { createPacingMechanism } from "./pacing.js";
import { createRepetitionMechanism } from "./repetition.js";
import type {
	DirectorConfig,
	DirectorMechanism,
	DirectorMechanismRecord,
	DirectorSuggestion,
} from "./types.js";

export interface EvaluateDirectorInput {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly nodeId: string;
	readonly config: DirectorConfig;
	/** 默认使用内置机制；测试与后续机制通过这里注入。 */
	readonly mechanisms?: readonly DirectorMechanism[];
}

export const DEFAULT_DIRECTOR_MECHANISMS: readonly DirectorMechanism[] = [
	createClueTrackingMechanism(),
	createRepetitionMechanism(),
	createEventPoolMechanism(),
	createPacingMechanism(),
];

export function assertDirectorConfig(config: DirectorConfig): void {
	if (typeof config !== "object" || config === null) {
		throw new Error("导演配置必须是对象");
	}
	if (typeof config.enabled !== "boolean") {
		throw new Error("导演配置的 enabled 必须是布尔值");
	}
	if (!Number.isInteger(config.clueAgeWarning) || config.clueAgeWarning < 0) {
		throw new Error("导演配置的 clueAgeWarning 必须是非负整数");
	}
	if (!Number.isInteger(config.maxOpenClues) || config.maxOpenClues < 1) {
		throw new Error("导演配置的 maxOpenClues 必须是正整数");
	}
	if (!Number.isInteger(config.stallFloors) || config.stallFloors < 1) {
		throw new Error("导演配置的 stallFloors 必须是正整数");
	}
	if (
		typeof config.surprise !== "number" ||
		!Number.isFinite(config.surprise) ||
		config.surprise < 0 ||
		config.surprise > 1
	) {
		throw new Error("导演配置的 surprise 必须是 0 到 1 之间的数字");
	}
	if (
		typeof config.similarityThreshold !== "number" ||
		!Number.isFinite(config.similarityThreshold) ||
		config.similarityThreshold < 0 ||
		config.similarityThreshold > 1
	) {
		throw new Error("导演配置的 similarityThreshold 必须是 0 到 1 之间的数字");
	}
	if (
		!Number.isInteger(config.similarityWindow) ||
		config.similarityWindow < 2
	) {
		throw new Error("导演配置的 similarityWindow 必须是不小于 2 的整数");
	}
	if (!Number.isInteger(config.similarityStep) || config.similarityStep < 1) {
		throw new Error("导演配置的 similarityStep 必须是正整数");
	}
	if (
		!Number.isInteger(config.similarityRiseWindows) ||
		config.similarityRiseWindows < 2
	) {
		throw new Error("导演配置的 similarityRiseWindows 必须是不小于 2 的整数");
	}
	if (
		typeof config.similarityRiseDelta !== "number" ||
		!Number.isFinite(config.similarityRiseDelta) ||
		config.similarityRiseDelta < 0
	) {
		throw new Error("导演配置的 similarityRiseDelta 必须是非负数字");
	}
	if (
		typeof config.similarityRiseMinimum !== "number" ||
		!Number.isFinite(config.similarityRiseMinimum) ||
		config.similarityRiseMinimum < 0
	) {
		throw new Error("导演配置的 similarityRiseMinimum 必须是非负数字");
	}
	if (
		config.scenePath !== undefined &&
		(!Array.isArray(config.scenePath) ||
			config.scenePath.length === 0 ||
			config.scenePath.some(
				(segment) => typeof segment !== "string" || segment.trim().length === 0,
			))
	) {
		throw new Error("导演配置的 scenePath 必须是非空的字符串数组");
	}
	if (
		!Number.isInteger(config.sceneRepeatThreshold) ||
		config.sceneRepeatThreshold < 1
	) {
		throw new Error("导演配置的 sceneRepeatThreshold 必须是正整数");
	}
	if (
		config.tensionPath !== undefined &&
		(!Array.isArray(config.tensionPath) ||
			config.tensionPath.length === 0 ||
			config.tensionPath.some(
				(segment) => typeof segment !== "string" || segment.trim().length === 0,
			))
	) {
		throw new Error("导演配置的 tensionPath 必须是非空的字符串数组");
	}
	for (const [name, value] of [
		["tensionEscalate", config.tensionEscalate],
		["tensionClimax", config.tensionClimax],
	] as const) {
		if (
			typeof value !== "number" ||
			!Number.isFinite(value) ||
			value < 0 ||
			value > 1
		) {
			throw new Error(`导演配置的 ${name} 必须是 0 到 1 之间的数字`);
		}
	}
	if (config.tensionEscalate >= config.tensionClimax) {
		throw new Error("导演配置的 tensionEscalate 必须小于 tensionClimax");
	}
	for (const [name, value] of [
		["tensionStateWeight", config.tensionStateWeight],
		["tensionNoteWeight", config.tensionNoteWeight],
		["tensionEventWeight", config.tensionEventWeight],
	] as const) {
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
			throw new Error(`导演配置的 ${name} 必须是非负数字`);
		}
	}
	const weightSum =
		config.tensionStateWeight +
		config.tensionNoteWeight +
		config.tensionEventWeight;
	if (weightSum <= 0) {
		throw new Error("导演配置的张力权重之和必须大于 0");
	}
	if (
		!Number.isInteger(config.tensionStateDiffsPerFloor) ||
		config.tensionStateDiffsPerFloor < 1
	) {
		throw new Error("导演配置的 tensionStateDiffsPerFloor 必须是正整数");
	}
	if (
		!Number.isInteger(config.tensionNotesPerFloor) ||
		config.tensionNotesPerFloor < 1
	) {
		throw new Error("导演配置的 tensionNotesPerFloor 必须是正整数");
	}
	if (
		typeof config.pace !== "number" ||
		!Number.isFinite(config.pace) ||
		config.pace <= 0
	) {
		throw new Error("导演配置的 pace 必须是正数");
	}
	for (const [name, value] of [
		["minSetupFloors", config.minSetupFloors],
		["minEscalateFloors", config.minEscalateFloors],
		["climaxFloors", config.climaxFloors],
		["breatheFloors", config.breatheFloors],
	] as const) {
		if (!Number.isInteger(value) || value < 1) {
			throw new Error(`导演配置的 ${name} 必须是正整数`);
		}
	}
}

/**
 * 按注册顺序评估全部机制，只输出优先级最高的一条建议，并把本次评估写入
 * 该楼层的决策记录。整个过程只读数据库与配置，不调用模型。
 */
export function evaluateDirector(
	input: EvaluateDirectorInput,
): DirectorSuggestion | null {
	const { store, storyId, nodeId, config } = input;
	assertDirectorConfig(config);
	if (!store.getStory(storyId)) {
		throw new Error(`故事不存在：${storyId}`);
	}
	const node = store.getNode(nodeId);
	if (!node) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	if (node.storyId !== storyId) {
		throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	if (!config.enabled) return null;

	const mechanisms = input.mechanisms ?? DEFAULT_DIRECTOR_MECHANISMS;
	const records: DirectorMechanismRecord[] = [];
	const signals: JsonObject = {};
	let best: DirectorSuggestion | null = null;

	for (const mechanism of mechanisms) {
		const name = mechanism.name.trim();
		if (name.length === 0) {
			throw new Error("导演机制的名字不能是空字符串");
		}
		if (records.some((record) => record.name === name)) {
			throw new Error(`导演机制的名字重复：${name}`);
		}
		const result = mechanism.evaluate({ store, storyId, nodeId, config });
		records.push({
			name,
			triggered: result.triggered,
			reason: result.reason,
		});
		Object.assign(signals, result.signals);
		if (result.triggered) {
			if (result.suggestion === null) {
				throw new Error(`导演机制 ${name} 触发了但没有给出建议`);
			}
			if (result.suggestion.mechanism !== name) {
				throw new Error(
					`导演机制 ${name} 返回的建议来自 ${result.suggestion.mechanism}`,
				);
			}
			if (best === null || result.suggestion.priority > best.priority) {
				best = result.suggestion;
			}
		} else if (result.suggestion !== null) {
			throw new Error(`导演机制 ${name} 没有触发却给出了建议`);
		}
	}

	store.saveDirectorDecision({
		nodeId,
		storyId,
		directive: best === null ? null : best.directive,
		mechanisms: records,
		signals,
	});
	return best;
}
