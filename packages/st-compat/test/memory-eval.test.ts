import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type EmbeddingClient,
	type LlmResult,
	type LlmStreamingClient,
	StoryStore,
} from "@dramaticer/core";
import { onTestFinished } from "vitest";
import { describe, expect, it } from "vitest";
import { createCachedEmbeddingClient } from "../src/evalset/memory-cache.js";
import {
	buildStoryEvents,
	buildStoryVectors,
	collectMemoryEval,
	evaluateMemoryQuestions,
} from "../src/evalset/memory-eval.js";
import {
	type MemoryEvalReport,
	renderPrivateMemoryReport,
	renderPublicMemoryReport,
} from "../src/evalset/memory-report.js";
import type { RetrievalQuestion } from "../src/evalset/question-files.js";

const DIMENSIONS = 4;
const fixturesPath = fileURLToPath(new URL("./fixtures/", import.meta.url));

function fakeEmbedder(): EmbeddingClient & { calls: number } {
	let calls = 0;
	return {
		dimensions: DIMENSIONS,
		get calls() {
			return calls;
		},
		async embed(texts: readonly string[]): Promise<number[][]> {
			calls += 1;
			return texts.map((text) =>
				text.includes("匕首") ? [1, 0, 0, 0] : [0, 1, 0, 0],
			);
		},
	};
}

function insertMatchingVectors(store: StoryStore, nodeId: string): void {
	const chunks = store.listChunksMissingVectors(nodeId);
	store.insertChunkVectors(
		chunks.map((chunk) => ({
			chunkId: chunk.chunkId,
			embedding: chunk.text.includes("匕首") ? [1, 0, 0, 0] : [0, 1, 0, 0],
		})),
	);
}

function question(input: {
	id: string;
	askAtNode: string;
	evidenceNodes: readonly string[];
	kind: "state" | "event";
	question: string;
	answer?: string;
	path?: readonly string[];
}): RetrievalQuestion {
	return {
		id: input.id,
		story: "s-memory",
		askAtNode: input.askAtNode,
		question: input.question,
		answer: input.answer ?? "答案",
		evidenceNodes: input.evidenceNodes,
		kind: input.kind,
		...(input.path === undefined ? {} : { path: input.path }),
	};
}

function seedStory(): {
	store: StoryStore;
	root: string;
	first: string;
	ask: string;
} {
	const store = StoryStore.open(":memory:", {
		embeddingDimensions: DIMENSIONS,
	});
	store.createStory({ id: "s-memory", title: "记忆评测" });
	const root = store.appendNode({
		id: "n-root",
		storyId: "s-memory",
		parentId: null,
		role: "system",
		raw: "阿七把青铜匕首藏在井底。",
	});
	const first = store.appendNode({
		id: "n-first",
		storyId: "s-memory",
		parentId: root.id,
		role: "assistant",
		raw: "井底的青铜匕首被阿七收进木箱。",
	});
	store.appendStateDiffs([
		{
			storyId: "s-memory",
			nodeId: first.id,
			path: ["stat_data", "地点"],
			op: "set",
			value: ["井底", "匕首所在位置"],
			source: "test",
		},
	]);
	const ask = store.appendNode({
		id: "n-ask",
		storyId: "s-memory",
		parentId: first.id,
		role: "user",
		raw: "匕首现在在哪里？",
	});
	store.upsertEntity({
		storyId: "s-memory",
		kind: "character",
		name: "阿七",
		description: "守井人",
		source: "test",
		aliases: [],
	});
	store.insertMemoryEvents([
		{
			storyId: "s-memory",
			sourceNodeId: root.id,
			ordinal: 0,
			participants: ["阿七"],
			importance: 0.9,
			knowers: [],
			text: "阿七把匕首藏在井底",
		},
		{
			storyId: "s-memory",
			sourceNodeId: first.id,
			ordinal: 0,
			participants: ["阿七"],
			importance: 0.8,
			knowers: ["阿七"],
			text: "阿七把匕首收进木箱",
		},
	]);
	insertMatchingVectors(store, root.id);
	insertMatchingVectors(store, first.id);
	insertMatchingVectors(store, ask.id);
	return { store, root: root.id, first: first.id, ask: ask.id };
}

describe("记忆引擎评测", () => {
	it("按题打分并给出每一路的单独结果", async () => {
		const { store, root, first, ask } = seedStory();
		const report = await evaluateMemoryQuestions({
			store,
			storyId: "s-memory",
			questions: [
				question({
					id: "q-state",
					askAtNode: ask,
					evidenceNodes: [first],
					kind: "state",
					question: "匕首在谁手里？",
					answer: "井底",
					path: ["stat_data", "地点"],
				}),
				question({
					id: "q-event",
					askAtNode: ask,
					evidenceNodes: [root],
					kind: "event",
					question: "阿七把匕首藏在哪里？",
				}),
			],
			embedder: fakeEmbedder(),
		});

		expect(report.total).toEqual({
			questionCount: 2,
			hitAt5: 2,
			hitAt10: 2,
			hitAt20: 2,
		});
		expect(report.vectorCount).toBe(
			store.countChunksForNode(root) +
				store.countChunksForNode(first) +
				store.countChunksForNode(ask),
		);
		expect(report.entityCount).toBe(1);
		expect(report.eventCount).toBe(2);
		const bm25 = report.routes.find((route) => route.route === "bm25");
		expect(bm25?.total.questionCount).toBe(2);
		const fused = report.routes.find((route) => route.route === "fused");
		expect(fused?.byKind.map((score) => score.kind)).toEqual([
			"state",
			"event",
		]);
		expect(report.stateAccuracy).toEqual({
			questionCount: 1,
			correct: 1,
			missing: 0,
		});
	});

	it("视角排除原文块并统计过滤前后的事件数", async () => {
		const { store, first, ask } = seedStory();
		const report = await evaluateMemoryQuestions({
			store,
			storyId: "s-memory",
			questions: [
				question({
					id: "q-event",
					askAtNode: ask,
					evidenceNodes: [first],
					kind: "event",
					question: "阿七做了什么？",
				}),
			],
			embedder: fakeEmbedder(),
			viewpoint: "阿七",
		});

		expect(report.filter).toEqual({
			viewpoint: "阿七",
			eventsBeforeFilter: 2,
			eventsAfterFilter: 2,
			queriesWithExcludedChunks: 1,
		});
		const bm25 = report.routes.find((route) => route.route === "bm25");
		expect(bm25?.total.hitAt5).toBe(0);
	});

	it("向量已经写入的块不再调用 embedding", async () => {
		const { store } = seedStory();
		const embedder = fakeEmbedder();
		await buildStoryVectors({
			store,
			storyId: "s-memory",
			embedder,
			batchSize: 1,
		});
		const before = embedder.calls;
		await buildStoryVectors({
			store,
			storyId: "s-memory",
			embedder,
			batchSize: 1,
		});
		expect(embedder.calls).toBe(before);
	});

	it("事件抽取沿主路径写入事件", async () => {
		const store = StoryStore.open(":memory:");
		store.createStory({ id: "s-events", title: "事件" });
		const root = store.appendNode({
			id: "e-root",
			storyId: "s-events",
			parentId: null,
			role: "system",
			raw: "开场。",
		});
		store.appendNode({
			id: "e-next",
			storyId: "s-events",
			parentId: root.id,
			role: "assistant",
			raw: "阿七收下匕首。",
		});
		const client = fakeLlmClient(
			'[{"text":"阿七收下匕首","participants":["阿七"],"knowers":["阿七"],"importance":0.7}]',
		);
		const result = await buildStoryEvents({
			store,
			storyId: "s-events",
			client,
		});
		expect(result).toEqual({ nodeCount: 1, eventCount: 1 });
		expect(store.countEventsForNode("e-root")).toBe(1);
	});

	it("embedding 缓存按文本复用，中止后可以接着跑", async () => {
		const dir = await mkdtemp(
			path.join(import.meta.dirname, ".tmp-memory-cache-"),
		);
		onTestFinished(async () => {
			await rm(dir, { recursive: true, force: true });
		});
		const inner = fakeEmbedder();
		const client = createCachedEmbeddingClient({
			inner,
			cacheDir: dir,
			label: "test",
			chunkSize: 2,
		});
		const first = await client.embed(["匕首", "木箱", "井底"]);
		const calls = inner.calls;
		const second = await client.embed(["匕首", "木箱", "井底"]);
		expect(second).toEqual(first);
		expect(inner.calls).toBe(calls);
		expect(first).toHaveLength(3);
	});

	it("统计版报告不出现私有故事名，私有版保留", () => {
		const report = sampleReport();
		expect(renderPublicMemoryReport(report)).not.toContain("仙侠雌竞");
		expect(renderPrivateMemoryReport(report)).toContain("仙侠雌竞");
		expect(renderPublicMemoryReport(report)).toContain("对话 1");
	});

	it("从 manifest 与题目文件汇总完整报告", async () => {
		const dir = await mkdtemp(
			path.join(import.meta.dirname, ".tmp-memory-eval-"),
		);
		onTestFinished(async () => {
			await rm(dir, { recursive: true, force: true });
		});
		const report = await collectMemoryEval({
			rawRoot: fixturesPath,
			evalsetRoot: path.join(fixturesPath, "evalset"),
			dbPath: path.join(dir, "story.db"),
			generatedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(report.stories).toHaveLength(1);
		expect(report.total.questionCount).toBeGreaterThan(0);
		expect(report.eventsBuilt).toBe(false);
		expect(report.embeddingLabel).toBeNull();
		expect(report.thresholds.length).toBeGreaterThan(0);
		const publicReport = renderPublicMemoryReport(report);
		expect(publicReport).not.toContain("测试角色");
	});
});

function fakeLlmClient(text: string): LlmStreamingClient {
	return {
		async complete(): Promise<LlmResult> {
			return {
				text,
				reasoning: "",
				toolCalls: [],
				finishReason: "stop",
				stopReason: "stop",
				model: "fake",
				channel: null,
				usage: {
					promptTokens: null,
					completionTokens: null,
					totalTokens: null,
					reasoningTokens: null,
					cachedTokens: null,
				},
				raw: null,
				cached: false,
				attempts: 1,
				rounds: 1,
				truncation: null,
				continuation: null,
			};
		},
		stream() {
			throw new Error("事件抽取不应使用流式接口");
		},
	};
}

function sampleReport(): MemoryEvalReport {
	const score = {
		questionCount: 2,
		hitAt5: 1,
		hitAt10: 1,
		hitAt20: 2,
	};
	const kindScore = (kind: "state" | "event") => ({ kind, ...score });
	const story = {
		story: "仙侠雌竞",
		floorCount: 2,
		chunkCount: 3,
		vectorCount: 3,
		entityCount: 1,
		eventCount: 1,
		byKind: [kindScore("state"), kindScore("event")],
		routes: [
			{
				route: "bm25" as const,
				byKind: [kindScore("state"), kindScore("event")],
				total: score,
			},
			{
				route: "fused" as const,
				byKind: [kindScore("state"), kindScore("event")],
				total: score,
			},
		],
		total: score,
		filter: {
			viewpoint: null,
			eventsBeforeFilter: 0,
			eventsAfterFilter: 0,
			queriesWithExcludedChunks: 0,
		},
		stateAccuracy: {
			questionCount: 1,
			correct: 0,
			missing: 1,
		},
	};
	return {
		generatedAt: "2026-01-01T00:00:00.000Z",
		embeddingLabel: "test@4",
		eventsBuilt: false,
		stories: [story],
		byKind: [kindScore("state"), kindScore("event")],
		routes: story.routes.map((route) => ({ ...route })),
		total: score,
		filter: story.filter,
		stateAccuracy: story.stateAccuracy,
		thresholds: [],
	};
}
