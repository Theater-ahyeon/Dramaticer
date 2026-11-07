import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIRECTOR_CONFIG,
	REPETITION_SCENE_PRIORITY,
	REPETITION_TEXT_PRIORITY,
	type StoryStore,
	evaluateDirector,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const DIMENSIONS = 1024;

function config(
	overrides: Partial<typeof DEFAULT_DIRECTOR_CONFIG> = {},
): typeof DEFAULT_DIRECTOR_CONFIG {
	return { ...DEFAULT_DIRECTOR_CONFIG, ...overrides };
}

/**
 * 在 s1 上追加一串助手楼层，并在最后追加一个用户楼层让全部助手楼层已确认。
 * 返回助手楼层 id 与用于评估的末端用户楼层 id。
 */
function appendBeatChain(
	store: StoryStore,
	prefix: string,
	count: number,
	parentId: string | null = null,
	firstRaw?: string,
): { beats: string[]; tail: string } {
	let parent = parentId;
	const beats: string[] = [];
	for (let index = 0; index < count; index += 1) {
		const id = `${prefix}-a${index}`;
		store.appendNode({
			id,
			storyId: "s1",
			parentId: parent,
			role: "assistant",
			raw:
				index === 0 && firstRaw !== undefined ? firstRaw : `助手楼层 ${index}`,
		});
		beats.push(id);
		parent = id;
	}
	const tail = `${prefix}-u`;
	store.appendNode({
		id: tail,
		storyId: "s1",
		parentId: parent,
		role: "user",
		raw: "用户楼层",
	});
	return { beats, tail };
}

function setFloorVectors(
	store: StoryStore,
	nodeId: string,
	vectors: readonly (readonly number[])[],
): void {
	const chunks = store.listChunksMissingVectors(nodeId);
	if (chunks.length !== vectors.length) {
		throw new Error(
			`楼层 ${nodeId} 有 ${chunks.length} 个块，测试提供了 ${vectors.length} 个向量`,
		);
	}
	store.insertChunkVectors(
		chunks.map((chunk, index) => ({
			chunkId: chunk.chunkId,
			embedding: vectors[index] ?? [],
		})),
	);
}

function angleVector(angle: number): number[] {
	const vector = new Array<number>(DIMENSIONS).fill(0);
	vector[0] = Math.cos(angle);
	vector[1] = Math.sin(angle);
	return vector;
}

/** 让相邻节拍的余弦等于给定的序列。 */
function vectorsForSimilarities(similarities: readonly number[]): number[][] {
	let angle = 0;
	const vectors = [angleVector(angle)];
	for (const similarity of similarities) {
		angle += Math.acos(similarity);
		vectors.push(angleVector(angle));
	}
	return vectors;
}

function applySimilarities(
	store: StoryStore,
	beats: readonly string[],
	similarities: readonly number[],
): void {
	const vectors = vectorsForSimilarities(similarities);
	if (vectors.length !== beats.length) {
		throw new Error("测试相似度序列与节拍数量不匹配");
	}
	for (let index = 0; index < beats.length; index += 1) {
		const beat = beats[index];
		const vector = vectors[index];
		if (beat === undefined || vector === undefined) {
			throw new Error("测试节拍与向量数量不匹配");
		}
		setFloorVectors(store, beat, [vector]);
	}
}

function readArrayField(value: unknown, key: string, label: string): unknown[] {
	if (typeof value !== "object" || value === null || !(key in value)) {
		throw new Error(`${label} 缺少 ${key}`);
	}
	const field = value[key];
	if (!Array.isArray(field)) throw new Error(`${label}.${key} 不是数组`);
	return field;
}

function readObjectField(value: unknown, key: string, label: string): unknown {
	if (typeof value !== "object" || value === null || !(key in value)) {
		throw new Error(`${label} 缺少 ${key}`);
	}
	const field = value[key];
	if (typeof field !== "object" || field === null || Array.isArray(field)) {
		throw new Error(`${label}.${key} 不是对象`);
	}
	return field;
}

function readNumberField(value: unknown, key: string, label: string): number {
	if (typeof value !== "object" || value === null || !(key in value)) {
		throw new Error(`${label} 缺少 ${key}`);
	}
	const field = value[key];
	if (typeof field !== "number") throw new Error(`${label}.${key} 不是数字`);
	return field;
}

function readBooleanField(value: unknown, key: string, label: string): boolean {
	if (typeof value !== "object" || value === null || !(key in value)) {
		throw new Error(`${label} 缺少 ${key}`);
	}
	const field = value[key];
	if (typeof field !== "boolean") throw new Error(`${label}.${key} 不是布尔值`);
	return field;
}

function readStringField(value: unknown, key: string, label: string): string {
	if (typeof value !== "object" || value === null || !(key in value)) {
		throw new Error(`${label} 缺少 ${key}`);
	}
	const field = value[key];
	if (typeof field !== "string") throw new Error(`${label}.${key} 不是字符串`);
	return field;
}

function repetitionSignals(store: StoryStore, nodeId: string): unknown {
	return store.getDirectorDecision(nodeId)?.signals.repetition;
}

describe("块向量读取", () => {
	it("按块序号返回楼层向量，缺失楼层直接抛错", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "向量" });
		const node = store.appendNode({
			id: "root",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "长".repeat(600),
		});
		const chunks = store.listChunksMissingVectors(node.id);
		expect(chunks).toHaveLength(2);
		const first = new Array<number>(DIMENSIONS).fill(0);
		first[0] = 0.5;
		const second = new Array<number>(DIMENSIONS).fill(0);
		second[1] = 0.25;
		const firstChunk = chunks[0];
		const secondChunk = chunks[1];
		if (firstChunk === undefined || secondChunk === undefined) {
			throw new Error("测试楼层没有两个块");
		}
		store.insertChunkVectors([
			{ chunkId: firstChunk.chunkId, embedding: first },
			{ chunkId: secondChunk.chunkId, embedding: second },
		]);

		const vectors = store.listChunkVectorsForNode(node.id);
		expect(vectors.map((item) => item.ordinal)).toEqual([0, 1]);
		expect(vectors[0]?.vector).toEqual(first);
		expect(vectors[1]?.vector).toEqual(second);
		expect(() => store.listChunkVectorsForNode("missing")).toThrow(
			"楼层节点不存在",
		);
	});
});

describe("重复检测机制", () => {
	it("楼层向量取块向量平均值，相邻节拍余弦写入信号", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "平均" });
		const { beats, tail } = appendBeatChain(
			store,
			"m",
			3,
			null,
			"长".repeat(600),
		);

		const horizontal = new Array<number>(DIMENSIONS).fill(0);
		horizontal[0] = 1;
		const vertical = new Array<number>(DIMENSIONS).fill(0);
		vertical[1] = 1;
		const diagonal = new Array<number>(DIMENSIONS).fill(0);
		diagonal[0] = 1;
		diagonal[1] = 1;
		setFloorVectors(store, beats[0], [horizontal, vertical]);
		setFloorVectors(store, beats[1], [horizontal]);
		setFloorVectors(store, beats[2], [diagonal]);

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: tail,
			config: config({
				similarityWindow: 2,
				similarityStep: 1,
				similarityRiseWindows: 2,
				similarityThreshold: 0.9,
				similarityRiseMinimum: 0,
			}),
		});
		expect(suggestion).toBeNull();

		const signals = repetitionSignals(store, tail);
		const pairs = readArrayField(signals, "pairs", "信号");
		expect(pairs).toHaveLength(2);
		expect(readNumberField(pairs[0], "similarity", "第一对")).toBeCloseTo(
			Math.SQRT1_2,
			6,
		);
		expect(readNumberField(pairs[1], "similarity", "第二对")).toBeCloseTo(
			Math.SQRT1_2,
			6,
		);
		const windows = readArrayField(signals, "windows", "信号");
		expect(windows).toHaveLength(1);
		expect(
			readNumberField(windows[0], "meanSimilarity", "第一个窗口"),
		).toBeCloseTo(Math.SQRT1_2, 6);
		expect(readBooleanField(signals, "similarityTriggered", "信号")).toBe(
			false,
		);
	});

	it("窗口均值连续上升并超过阈值时触发，单个高值不触发", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "上升" });
		const risingChain = appendBeatChain(store, "r", 12);
		applySimilarities(
			store,
			risingChain.beats,
			[0.1, 0.1, 0.11, 0.12, 0.2, 0.2, 0.55, 0.55, 0.6, 0.6, 0.7],
		);
		const risingConfig = config({
			similarityWindow: 2,
			similarityStep: 1,
			similarityRiseWindows: 5,
			similarityThreshold: 0.5,
			similarityRiseDelta: 0.02,
			similarityRiseMinimum: 0.03,
		});

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: risingChain.tail,
			config: risingConfig,
		});
		expect(suggestion?.mechanism).toBe("repetition");
		expect(suggestion?.priority).toBe(REPETITION_TEXT_PRIORITY);
		expect(suggestion?.directive).toContain("重复度持续上升");
		const signals = repetitionSignals(store, risingChain.tail);
		expect(readBooleanField(signals, "similarityTriggered", "信号")).toBe(true);
		const rise = readArrayField(signals, "windows", "信号");
		expect(rise.length).toBe(10);

		store.createStory({ id: "s2", title: "单峰" });
		const spikeChain = appendBeatChain(store, "s", 12);
		applySimilarities(
			store,
			spikeChain.beats,
			[0.2, 0.2, 0.2, 0.9, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2],
		);
		const spike = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: spikeChain.tail,
			config: risingConfig,
		});
		expect(spike).toBeNull();
		expect(
			readBooleanField(
				repetitionSignals(store, spikeChain.tail),
				"similarityTriggered",
				"信号",
			),
		).toBe(false);
	});

	it("缺失向量的楼层被跳过并计入信号，已有向量照常配对", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "缺失" });
		const { beats, tail } = appendBeatChain(store, "v", 4);
		const vector = new Array<number>(DIMENSIONS).fill(0);
		vector[0] = 1;
		setFloorVectors(store, beats[0], [vector]);
		setFloorVectors(store, beats[2], [vector]);

		evaluateDirector({
			store,
			storyId: "s1",
			nodeId: tail,
			config: config({ similarityWindow: 2, similarityStep: 1 }),
		});
		const signals = repetitionSignals(store, tail);
		expect(readNumberField(signals, "missingVectors", "信号")).toBe(2);
		const pairs = readArrayField(signals, "pairs", "信号");
		expect(pairs).toHaveLength(1);
		expect(readArrayField(signals, "windows", "信号")).toHaveLength(0);
	});

	it("同一场景连续超过阈值时建议换场景，另一分支不参与", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "场景" });
		const main = appendBeatChain(store, "c", 5);
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: main.beats[0],
				path: ["场景"],
				op: "set",
				value: "山洞",
				source: "test",
			},
		]);
		const branch = appendBeatChain(store, "b", 4, main.beats[0]);

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: main.tail,
			config: config({
				scenePath: ["场景"],
				sceneRepeatThreshold: 3,
			}),
		});
		expect(suggestion?.mechanism).toBe("repetition");
		expect(suggestion?.priority).toBe(REPETITION_SCENE_PRIORITY);
		expect(suggestion?.directive).toContain("山洞");
		expect(suggestion?.signals.repetition).toBeDefined();

		const signals = repetitionSignals(store, main.tail);
		const beats = readArrayField(signals, "beats", "信号");
		expect(beats).toEqual(main.beats);
		expect(beats).not.toContain(branch.beats[0]);
		const sceneSignals = readObjectField(signals, "scene", "信号");
		expect(readBooleanField(sceneSignals, "triggered", "场景")).toBe(true);
		const longestRun = readObjectField(sceneSignals, "longestRun", "场景");
		expect(readNumberField(longestRun, "length", "最长场景")).toBe(5);
		expect(readStringField(longestRun, "scene", "最长场景")).toBe("山洞");
	});

	it("没有场景路径时用该楼层最近事件的地点", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "地点" });
		const { beats, tail } = appendBeatChain(store, "e", 4);
		store.insertMemoryEvents(
			beats.map((nodeId, index) => ({
				storyId: "s1",
				sourceNodeId: nodeId,
				ordinal: index,
				location: "码头",
				participants: [],
				importance: 0.5,
				knowers: [],
				text: `事件 ${index}`,
			})),
		);

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: tail,
			config: config({ sceneRepeatThreshold: 2 }),
		});
		expect(suggestion?.mechanism).toBe("repetition");
		expect(suggestion?.priority).toBe(REPETITION_SCENE_PRIORITY);
		expect(suggestion?.directive).toContain("码头");
	});

	it("两类信号同时命中时只输出重复度更高优先级的指令", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "两类" });
		const { beats, tail } = appendBeatChain(store, "x", 12);
		applySimilarities(
			store,
			beats,
			[0.1, 0.1, 0.11, 0.12, 0.2, 0.2, 0.55, 0.55, 0.6, 0.6, 0.7],
		);
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: beats[0],
				path: ["场景"],
				op: "set",
				value: "长廊",
				source: "test",
			},
		]);

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: tail,
			config: config({
				similarityWindow: 2,
				similarityStep: 1,
				similarityRiseWindows: 5,
				similarityThreshold: 0.5,
				scenePath: ["场景"],
				sceneRepeatThreshold: 3,
			}),
		});
		expect(suggestion?.priority).toBe(REPETITION_TEXT_PRIORITY);
		expect(suggestion?.directive).toContain("重复度持续上升");
		expect(suggestion?.directive).not.toContain("长廊");
		const signals = repetitionSignals(store, tail);
		expect(readBooleanField(signals, "similarityTriggered", "信号")).toBe(true);
		expect(
			readBooleanField(
				readObjectField(signals, "scene", "信号"),
				"triggered",
				"场景",
			),
		).toBe(true);
	});

	it("默认窗口、步长与阈值按 ADR-0025 触发持续上升", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "默认参数" });
		const { beats, tail } = appendBeatChain(store, "d", 61);
		const similarities = Array.from(
			{ length: 60 },
			(_, index) => 0.5 + (index * 0.4) / 59,
		);
		applySimilarities(store, beats, similarities);

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: tail,
			config: DEFAULT_DIRECTOR_CONFIG,
		});
		expect(suggestion?.priority).toBe(REPETITION_TEXT_PRIORITY);
		const signals = repetitionSignals(store, tail);
		const params = readObjectField(signals, "params", "信号");
		expect(readNumberField(params, "similarityWindow", "参数")).toBe(20);
		expect(readNumberField(params, "similarityStep", "参数")).toBe(10);
		expect(readNumberField(params, "similarityThreshold", "参数")).toBe(0.73);
		expect(readNumberField(params, "similarityRiseWindows", "参数")).toBe(5);
	});

	it("窗口小于 2 或阈值不在 0 到 1 之间时直接抛错", () => {
		const { store } = openTempStore();
		expect(() =>
			evaluateDirector({
				store,
				storyId: "missing",
				nodeId: "missing",
				config: config({ similarityWindow: 1 }),
			}),
		).toThrow("similarityWindow");
		expect(() =>
			evaluateDirector({
				store,
				storyId: "missing",
				nodeId: "missing",
				config: config({ similarityThreshold: 1.1 }),
			}),
		).toThrow("similarityThreshold");
		expect(() =>
			evaluateDirector({
				store,
				storyId: "missing",
				nodeId: "missing",
				config: config({ sceneRepeatThreshold: 0 }),
			}),
		).toThrow("sceneRepeatThreshold");
		expect(() =>
			evaluateDirector({
				store,
				storyId: "missing",
				nodeId: "missing",
				config: config({ scenePath: [] }),
			}),
		).toThrow("scenePath");
	});
});
