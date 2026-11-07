import type { JsonObject } from "../json.js";
import type { StoryStore } from "../store/story-store.js";
import { createClueTrackingMechanism } from "./clue.js";
import { createEventPoolMechanism } from "./event-pool.js";
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
	createEventPoolMechanism(),
];

function assertDirectorConfig(config: DirectorConfig): void {
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
