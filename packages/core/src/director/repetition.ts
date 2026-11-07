import type { JsonObject } from "../json.js";
import { readStateValue } from "../state.js";
import type { TimelineNode } from "../timeline.js";
import type {
	DirectorConfig,
	DirectorMechanism,
	DirectorMechanismContext,
	DirectorMechanismResult,
	DirectorSuggestion,
} from "./types.js";

/** 文字重复是当前最需要打断的模式，优先级高于线索与事件池。 */
export const REPETITION_TEXT_PRIORITY = 40;
/** 场景停滞属于节奏问题，低于线索回收，高于事件池。 */
export const REPETITION_SCENE_PRIORITY = 25;

const THRESHOLD_SOURCE = "ADR-0025";
const SIGNAL_KEY = "repetition";

interface BeatVector {
	readonly nodeId: string;
	readonly vector: readonly number[];
}

interface SimilarityPair {
	readonly fromNodeId: string;
	readonly toNodeId: string;
	readonly similarity: number;
}

interface SimilarityWindow {
	readonly startPair: number;
	readonly endPair: number;
	readonly startNodeId: string;
	readonly endNodeId: string;
	readonly meanSimilarity: number;
}

interface RisingRun {
	readonly startWindow: number;
	readonly endWindow: number;
	readonly startNodeId: string;
	readonly endNodeId: string;
	readonly startMean: number;
	readonly endMean: number;
}

interface SceneEntry {
	readonly nodeId: string;
	readonly scene: string | null;
}

interface SceneRun {
	readonly scene: string;
	readonly length: number;
	readonly startNodeId: string;
	readonly endNodeId: string;
}

/**
 * 重复检测：节拍取已确认助手楼层，楼层向量取该楼层全部块向量的平均值。
 * 相邻节拍余弦按 ADR-0025 的窗口与上升规则判定，场景连续重复按状态路径或
 * 事件地点判定。两类信号同时命中时只输出优先级更高的一条。
 */
export function createRepetitionMechanism(): DirectorMechanism {
	return {
		name: "repetition",
		evaluate(context: DirectorMechanismContext): DirectorMechanismResult {
			const { store, config } = context;
			const path = store.getPathToNode(context.nodeId);
			const beats = path.filter(
				(node) => node.role === "assistant" && store.isNodeConfirmed(node.id),
			);

			const beatVectors: BeatVector[] = [];
			let missingVectors = 0;
			for (const beat of beats) {
				const chunks = store.listChunkVectorsForNode(beat.id);
				if (chunks.length === 0) {
					missingVectors += 1;
					continue;
				}
				beatVectors.push({
					nodeId: beat.id,
					vector: meanVector(
						chunks.map((chunk) => chunk.vector),
						`楼层 ${beat.id}`,
					),
				});
			}

			const pairs: SimilarityPair[] = [];
			for (let index = 1; index < beatVectors.length; index += 1) {
				const previous = beatVectors[index - 1];
				const current = beatVectors[index];
				if (previous === undefined || current === undefined) {
					throw new Error("节拍向量索引越界");
				}
				pairs.push({
					fromNodeId: previous.nodeId,
					toNodeId: current.nodeId,
					similarity: cosineSimilarity(previous.vector, current.vector),
				});
			}

			const windows = buildWindows(pairs, config);
			const rising = findRisingRun(windows, config);

			const sceneSequence: SceneEntry[] = [];
			let missingScenes = 0;
			for (const beat of beats) {
				const scene = resolveScene(store, beat, config);
				if (scene === null) missingScenes += 1;
				sceneSequence.push({ nodeId: beat.id, scene });
			}
			const sceneRun = longestSceneRun(sceneSequence);
			const sceneTriggered =
				sceneRun !== null && sceneRun.length > config.sceneRepeatThreshold;

			const similarityTriggered = rising !== null;
			const detail: JsonObject = {
				thresholdSource: THRESHOLD_SOURCE,
				params: {
					similarityThreshold: config.similarityThreshold,
					similarityWindow: config.similarityWindow,
					similarityStep: config.similarityStep,
					similarityRiseWindows: config.similarityRiseWindows,
					similarityRiseDelta: config.similarityRiseDelta,
					similarityRiseMinimum: config.similarityRiseMinimum,
					sceneRepeatThreshold: config.sceneRepeatThreshold,
				},
				confirmedAssistantFloors: beats.length,
				beats: beats.map((beat) => beat.id),
				vectorBeats: beatVectors.map((beat) => beat.nodeId),
				missingVectors,
				pairs: pairs.map((pair) => ({
					fromNodeId: pair.fromNodeId,
					toNodeId: pair.toNodeId,
					similarity: pair.similarity,
				})),
				windows: windows.map((window) => ({
					startPair: window.startPair,
					endPair: window.endPair,
					startNodeId: window.startNodeId,
					endNodeId: window.endNodeId,
					meanSimilarity: window.meanSimilarity,
				})),
				rise:
					rising === null
						? null
						: {
								startWindow: rising.startWindow,
								endWindow: rising.endWindow,
								startNodeId: rising.startNodeId,
								endNodeId: rising.endNodeId,
								startMean: rising.startMean,
								endMean: rising.endMean,
							},
				similarityTriggered,
				scene: {
					path: config.scenePath === undefined ? null : [...config.scenePath],
					sequence: sceneSequence.map((entry) => ({
						nodeId: entry.nodeId,
						scene: entry.scene,
					})),
					missingScenes,
					repeatThreshold: config.sceneRepeatThreshold,
					longestRun:
						sceneRun === null
							? null
							: {
									scene: sceneRun.scene,
									length: sceneRun.length,
									startNodeId: sceneRun.startNodeId,
									endNodeId: sceneRun.endNodeId,
								},
					triggered: sceneTriggered,
				},
				selected: similarityTriggered
					? "similarity"
					: sceneTriggered
						? "scene"
						: null,
			};

			if (!similarityTriggered && !sceneTriggered) {
				return {
					triggered: false,
					reason: describeIdle(
						pairs,
						windows,
						beats.length,
						sceneRun,
						config,
						missingScenes,
					),
					suggestion: null,
					signals: { [SIGNAL_KEY]: detail },
				};
			}

			const reasons: string[] = [];
			let suggestion: DirectorSuggestion;
			if (rising !== null) {
				reasons.push(
					`相邻节拍相似度连续 ${config.similarityRiseWindows} 个窗口上升，窗口均值从 ${rising.startMean.toFixed(2)} 到 ${rising.endMean.toFixed(2)}，超过阈值 ${config.similarityThreshold}`,
				);
				suggestion = {
					mechanism: "repetition",
					priority: REPETITION_TEXT_PRIORITY,
					directive: `最近几轮回复的重复度持续上升（窗口均值 ${rising.endMean.toFixed(2)}，阈值 ${config.similarityThreshold}），请改变表达方式并推进新信息。`,
					signals: { [SIGNAL_KEY]: detail },
				};
			} else {
				if (sceneRun === null) {
					throw new Error("场景重复触发但没有场景序列");
				}
				reasons.push(
					`场景「${sceneRun.scene}」连续 ${sceneRun.length} 个节拍，超过阈值 ${config.sceneRepeatThreshold}`,
				);
				suggestion = {
					mechanism: "repetition",
					priority: REPETITION_SCENE_PRIORITY,
					directive: `场景「${sceneRun.scene}」已连续 ${sceneRun.length} 个节拍，请转换场景并引入新的环境信息。`,
					signals: { [SIGNAL_KEY]: detail },
				};
			}
			if (rising !== null && sceneRun !== null && sceneTriggered) {
				reasons.push(
					`场景「${sceneRun.scene}」连续 ${sceneRun.length} 个节拍，超过阈值 ${config.sceneRepeatThreshold}`,
				);
			}
			return {
				triggered: true,
				reason: reasons.join("；"),
				suggestion,
				signals: { [SIGNAL_KEY]: detail },
			};
		},
	};
}

function describeIdle(
	pairs: readonly SimilarityPair[],
	windows: readonly SimilarityWindow[],
	beatCount: number,
	sceneRun: SceneRun | null,
	config: DirectorConfig,
	missingScenes: number,
): string {
	if (beatCount === 0) return "当前分支没有已确认助手楼层";
	const parts: string[] = [];
	if (pairs.length === 0) {
		parts.push("没有同时带向量的相邻节拍");
	} else if (windows.length === 0) {
		parts.push(
			`只有 ${pairs.length} 对相邻节拍，不足窗口 ${config.similarityWindow}`,
		);
	} else {
		parts.push("相邻节拍相似度没有持续上升并超过阈值");
	}
	if (sceneRun === null) {
		parts.push(missingScenes > 0 ? "没有可用的场景数据" : "场景序列为空");
	} else {
		parts.push(
			`同一场景最长连续 ${sceneRun.length} 个节拍，未超过阈值 ${config.sceneRepeatThreshold}`,
		);
	}
	return parts.join("；");
}

/** 楼层向量取全部块向量的平均值；评测复用同一口径。 */
export function meanVector(
	vectors: readonly (readonly number[])[],
	label: string,
): number[] {
	const first = vectors[0];
	if (first === undefined) {
		throw new Error(`${label} 没有块向量`);
	}
	const dimensions = first.length;
	if (dimensions === 0) {
		throw new Error(`${label} 的块向量维度不能为 0`);
	}
	const total = new Array<number>(dimensions).fill(0);
	for (const vector of vectors) {
		if (vector.length !== dimensions) {
			throw new Error(
				`${label} 的块向量维度不一致：${dimensions} 与 ${vector.length}`,
			);
		}
		for (let index = 0; index < dimensions; index += 1) {
			total[index] += vector[index];
		}
	}
	for (let index = 0; index < dimensions; index += 1) {
		total[index] /= vectors.length;
	}
	return total;
}

/** 相邻节拍相似度与重复度评测共用的余弦计算。 */
export function cosineSimilarity(
	left: readonly number[],
	right: readonly number[],
): number {
	if (left.length !== right.length) {
		throw new Error(`向量维度不一致：${left.length} 与 ${right.length}`);
	}
	let dot = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	for (let index = 0; index < left.length; index += 1) {
		const a = left[index];
		const b = right[index];
		dot += a * b;
		leftNorm += a * a;
		rightNorm += b * b;
	}
	if (leftNorm === 0 || rightNorm === 0) {
		throw new Error("节拍向量是零向量，无法计算余弦相似度");
	}
	return dot / Math.sqrt(leftNorm * rightNorm);
}

function buildWindows(
	pairs: readonly SimilarityPair[],
	config: DirectorConfig,
): SimilarityWindow[] {
	const windows: SimilarityWindow[] = [];
	for (
		let start = 0;
		start + config.similarityWindow <= pairs.length;
		start += config.similarityStep
	) {
		const end = start + config.similarityWindow;
		const first = pairs[start];
		const last = pairs[end - 1];
		if (first === undefined || last === undefined) {
			throw new Error("重复度窗口越界");
		}
		let total = 0;
		for (let index = start; index < end; index += 1) {
			const pair = pairs[index];
			if (pair === undefined) throw new Error("重复度窗口越界");
			total += pair.similarity;
		}
		windows.push({
			startPair: start,
			endPair: end - 1,
			startNodeId: first.fromNodeId,
			endNodeId: last.toNodeId,
			meanSimilarity: total / config.similarityWindow,
		});
	}
	return windows;
}

/**
 * 上升判定沿用 D-T03 的窗口语义：连续 riseWindows 个窗口均值不下降，
 * 首尾上涨至少 riseDelta，起点不低于 riseMinimum；最后一个窗口必须高于
 * 绝对阈值。单个窗口的高值不足以触发。
 */
function findRisingRun(
	windows: readonly SimilarityWindow[],
	config: DirectorConfig,
): RisingRun | null {
	for (
		let start = 0;
		start + config.similarityRiseWindows <= windows.length;
		start += 1
	) {
		const first = windows[start];
		if (first === undefined) continue;
		if (first.meanSimilarity < config.similarityRiseMinimum) continue;
		let rising = true;
		for (
			let index = start;
			index + 1 < start + config.similarityRiseWindows;
			index += 1
		) {
			const current = windows[index];
			const next = windows[index + 1];
			if (current === undefined || next === undefined) {
				throw new Error("重复度窗口越界");
			}
			if (next.meanSimilarity < current.meanSimilarity) {
				rising = false;
				break;
			}
		}
		if (!rising) continue;
		const last = windows[start + config.similarityRiseWindows - 1];
		if (last === undefined) continue;
		if (
			last.meanSimilarity - first.meanSimilarity <
			config.similarityRiseDelta
		) {
			continue;
		}
		if (last.meanSimilarity <= config.similarityThreshold) continue;
		return {
			startWindow: start,
			endWindow: start + config.similarityRiseWindows - 1,
			startNodeId: first.startNodeId,
			endNodeId: last.endNodeId,
			startMean: first.meanSimilarity,
			endMean: last.meanSimilarity,
		};
	}
	return null;
}

function resolveScene(
	store: DirectorMechanismContext["store"],
	beat: TimelineNode,
	config: DirectorConfig,
): string | null {
	if (config.scenePath !== undefined) {
		const value = readStateValue(
			store.getStateSnapshot(beat.id).state,
			config.scenePath,
		);
		if (typeof value === "string" && value.trim() !== "") {
			return value.trim();
		}
	}
	const events = store.getEventsForNode(beat.id);
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event === undefined) continue;
		const location = event.location;
		if (typeof location === "string" && location.trim() !== "") {
			return location.trim();
		}
	}
	return null;
}

function longestSceneRun(sequence: readonly SceneEntry[]): SceneRun | null {
	let best: SceneRun | null = null;
	let current: string | null = null;
	let currentLength = 0;
	let currentStart = "";
	for (let index = 0; index < sequence.length; index += 1) {
		const entry = sequence[index];
		if (entry === undefined) continue;
		if (entry.scene === null) {
			current = null;
			currentLength = 0;
			continue;
		}
		if (entry.scene === current) {
			currentLength += 1;
		} else {
			current = entry.scene;
			currentLength = 1;
			currentStart = entry.nodeId;
		}
		if (best === null || currentLength > best.length) {
			best = {
				scene: entry.scene,
				length: currentLength,
				startNodeId: currentStart,
				endNodeId: entry.nodeId,
			};
		}
	}
	return best;
}
