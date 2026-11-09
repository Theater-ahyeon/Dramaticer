import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	type BackgroundJob,
	type EmbeddingClient,
	LATEST_SCHEMA_VERSION,
	StoryStore,
	createBackgroundJobRegistry,
	createEmbeddingsHandler,
	drainBackgroundJobs,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const DIMENSIONS = 1024;

function vectorAt(first: number): number[] {
	const vector = new Array<number>(DIMENSIONS).fill(0);
	vector[0] = first;
	return vector;
}

interface FakeEmbedder extends EmbeddingClient {
	readonly calls: string[][];
}

function createFakeEmbedder(): FakeEmbedder {
	const calls: string[][] = [];
	return {
		dimensions: DIMENSIONS,
		calls,
		async embed(texts: readonly string[]): Promise<number[][]> {
			calls.push([...texts]);
			return texts.map((_, index) => vectorAt(index + 1));
		},
	};
}

function chunkIdOf(store: StoryStore, nodeId: string): number {
	const chunks = store.listChunksMissingVectors(nodeId);
	if (chunks.length === 0) throw new Error(`楼层 ${nodeId} 没有块`);
	return chunks[0]?.chunkId as number;
}

function makeJob(nodeId: string): BackgroundJob {
	return {
		id: 1,
		storyId: "s1",
		nodeId,
		kind: "embeddings",
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: "2026-11-07T00:00:00.000Z",
		startedAt: "2026-11-07T00:00:01.000Z",
		finishedAt: null,
	};
}

const unusedClient = {
	complete: () => Promise.reject(new Error("向量任务不应该调用模型")),
};

describe("块向量索引", () => {
	it("写入向量后按距离检索，并只保留祖先路径", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "向量" });
		const root = store.appendNode({
			id: "n-root",
			storyId: "s1",
			parentId: null,
			role: "system",
			raw: "根节点",
		});
		const user = store.appendNode({
			id: "n-user",
			storyId: "s1",
			parentId: root.id,
			role: "user",
			raw: "用户楼层",
		});
		const left = store.appendNode({
			id: "n-left",
			storyId: "s1",
			parentId: user.id,
			role: "assistant",
			raw: "左分支",
		});
		const right = store.appendNode({
			id: "n-right",
			storyId: "s1",
			parentId: user.id,
			role: "assistant",
			raw: "右分支",
		});
		store.insertChunkVectors([
			{ chunkId: chunkIdOf(store, root.id), embedding: vectorAt(10) },
			{ chunkId: chunkIdOf(store, user.id), embedding: vectorAt(1) },
			{ chunkId: chunkIdOf(store, left.id), embedding: vectorAt(2) },
			{ chunkId: chunkIdOf(store, right.id), embedding: vectorAt(0.5) },
		]);
		for (const node of [root, user, left, right]) {
			expect(store.countChunkVectorsForNode(node.id)).toBe(1);
			expect(store.listChunksMissingVectors(node.id)).toEqual([]);
		}

		expect(
			store
				.searchVectors(vectorAt(0), { storyId: "s1" })
				.map((match) => match.nodeId),
		).toEqual([right.id, user.id, left.id, root.id]);
		expect(
			store
				.searchVectors(vectorAt(0), {
					storyId: "s1",
					beforeNodeId: left.id,
					limit: 10,
				})
				.map((match) => match.nodeId),
		).toEqual([user.id, root.id]);
		expect(
			store.searchVectors(vectorAt(0), {
				storyId: "s1",
				beforeNodeId: root.id,
			}),
		).toEqual([]);
		expect(
			store
				.searchVectors(vectorAt(0), { storyId: "s1", limit: 2 })
				.map((match) => match.nodeId),
		).toEqual([right.id, user.id]);
	});

	it("向量检索返回命中的父段文本", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "父段" });
		const first = "甲".repeat(700);
		const node = store.appendNode({
			id: "n-parent",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: `${first}\n${"乙".repeat(700)}`,
		});
		const chunks = store.listChunksMissingVectors(node.id);
		expect(chunks).toHaveLength(4);
		store.insertChunkVectors(
			chunks.map((chunk, index) => ({
				chunkId: chunk.chunkId,
				embedding: vectorAt(index === 0 ? 0 : 1 + index),
			})),
		);
		const matches = store.searchVectors(vectorAt(0), { storyId: "s1" });
		expect(matches[0]?.nodeId).toBe(node.id);
		expect(matches[0]?.parentOrdinal).toBe(0);
		expect(matches[0]?.parentText).toBe(first);
	});

	it("其他故事与更近的向量不会混入结果", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "一" });
		store.createStory({ id: "s2", title: "二" });
		const first = store.appendNode({
			id: "s1-n",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "第一个故事",
		});
		const second = store.appendNode({
			id: "s2-n",
			storyId: "s2",
			parentId: null,
			role: "assistant",
			raw: "第二个故事",
		});
		store.insertChunkVectors([
			{ chunkId: chunkIdOf(store, first.id), embedding: vectorAt(5) },
			{ chunkId: chunkIdOf(store, second.id), embedding: vectorAt(0.1) },
		]);
		const matches = store.searchVectors(vectorAt(0), { storyId: "s1" });
		expect(matches).toHaveLength(1);
		expect(matches[0]?.nodeId).toBe(first.id);
		expect(matches[0]?.distance).toBeCloseTo(5);
	});

	it("维度、未知块、重复写入与非有限数字都直接抛错", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "校验" });
		const node = store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "内容",
		});
		const chunkId = chunkIdOf(store, node.id);
		expect(() =>
			store.insertChunkVectors([{ chunkId, embedding: [1, 0] }]),
		).toThrow("维度必须是 1024");
		const invalid = vectorAt(0);
		invalid[3] = Number.POSITIVE_INFINITY;
		expect(() =>
			store.insertChunkVectors([{ chunkId, embedding: invalid }]),
		).toThrow("有限数字");
		expect(() =>
			store.insertChunkVectors([{ chunkId: 999_999, embedding: vectorAt(0) }]),
		).toThrow("不存在的块");
		expect(() =>
			store.insertChunkVectors([
				{ chunkId, embedding: vectorAt(0) },
				{ chunkId, embedding: vectorAt(1) },
			]),
		).toThrow("重复写入块");
		store.insertChunkVectors([{ chunkId, embedding: vectorAt(0) }]);
		expect(() =>
			store.insertChunkVectors([{ chunkId, embedding: vectorAt(1) }]),
		).toThrow();
		expect(() => store.searchVectors([1, 0], { storyId: "s1" })).toThrow(
			"维度必须是 1024",
		);
	});

	it("打开数据库时校验向量维度", () => {
		const dbPath = join(
			mkdtempSync(join(import.meta.dirname, ".tmp-vectors-")),
			"story.db",
		);
		onTestFinished(() => {
			rmSync(dirname(dbPath), { recursive: true, force: true, maxRetries: 5 });
		});
		const store = StoryStore.open(dbPath, { embeddingDimensions: 4 });
		try {
			store.createStory({ id: "s1", title: "维度" });
			const node = store.appendNode({
				id: "n1",
				storyId: "s1",
				parentId: null,
				role: "assistant",
				raw: "内容",
			});
			const chunkId = chunkIdOf(store, node.id);
			store.insertChunkVectors([{ chunkId, embedding: [1, 0, 0, 0] }]);
			expect(store.searchVectors([0, 0, 0, 0], { storyId: "s1" })).toHaveLength(
				1,
			);
			expect(store.getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION);
		} finally {
			store.close();
		}
		expect(() => StoryStore.open(dbPath, { embeddingDimensions: 8 })).toThrow(
			"不一致",
		);
		const reopened = StoryStore.open(dbPath, { embeddingDimensions: 4 });
		try {
			expect(reopened.getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION);
		} finally {
			reopened.close();
		}
	});

	it("后台处理器只处理缺失向量，第二次执行不重复调用", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "处理器" });
		const node = store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "甲".repeat(900),
		});
		const expected = store.countChunksForNode(node.id);
		expect(expected).toBeGreaterThan(1);
		const embedder = createFakeEmbedder();
		const handler = createEmbeddingsHandler({ embedder });
		await handler({ store, client: unusedClient, job: makeJob(node.id) });
		expect(store.countChunkVectorsForNode(node.id)).toBe(expected);
		expect(embedder.calls).toHaveLength(1);
		expect(embedder.calls[0]).toHaveLength(expected);

		await handler({ store, client: unusedClient, job: makeJob(node.id) });
		expect(embedder.calls).toHaveLength(1);
		expect(store.countChunkVectorsForNode(node.id)).toBe(expected);
	});

	it("空文本楼层不调用 embedding", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "空" });
		const node = store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "",
		});
		const embedder = createFakeEmbedder();
		const handler = createEmbeddingsHandler({ embedder });
		await handler({ store, client: unusedClient, job: makeJob(node.id) });
		expect(embedder.calls).toEqual([]);
	});

	it("失败后按后台任务规则重试，达到上限标记失败", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "重试" });
		const parent = store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "已确认楼层",
		});
		store.appendNode({
			id: "n2",
			storyId: "s1",
			parentId: parent.id,
			role: "user",
			raw: "末端",
		});
		const failing: EmbeddingClient = {
			dimensions: DIMENSIONS,
			async embed(): Promise<number[][]> {
				throw new Error("渠道不可用");
			},
		};
		const registry = createBackgroundJobRegistry({
			embeddings: createEmbeddingsHandler({ embedder: failing }),
		});
		const run = () =>
			drainBackgroundJobs({
				store,
				registry,
				client: unusedClient,
				storyId: "s1",
				maxAttempts: 3,
				now: () => Date.UTC(2026, 10, 7, 12, 0, 0),
			});
		expect((await run()).runs[0]?.status).toBe("pending");
		expect((await run()).runs[0]?.status).toBe("pending");
		const last = await run();
		expect(last.runs[0]?.status).toBe("failed");
		expect(last.runs[0]?.attempts).toBe(3);
		expect(last.runs[0]?.error).toBe("渠道不可用");
	});
});
