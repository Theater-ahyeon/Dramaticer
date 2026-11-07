import { describe, expect, it } from "vitest";
import {
	type EmbeddingClient,
	type StoryStore,
	retrieveMemory,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const DIMENSIONS = 1024;

function oneHot(index: number): number[] {
	const vector = new Array<number>(DIMENSIONS).fill(0);
	vector[index] = 1;
	return vector;
}

function scaled(index: number, value: number): number[] {
	const vector = new Array<number>(DIMENSIONS).fill(0);
	vector[index] = value;
	return vector;
}

function embedderReturning(vector: readonly number[]): EmbeddingClient {
	return {
		dimensions: vector.length,
		async embed(texts: readonly string[]): Promise<number[][]> {
			return texts.map(() => [...vector]);
		},
	};
}

function insertVectors(
	store: StoryStore,
	nodeId: string,
	vectors: readonly (readonly number[])[],
): void {
	const chunks = store.listChunksMissingVectors(nodeId);
	if (chunks.length !== vectors.length) {
		throw new Error(
			`楼层 ${nodeId} 有 ${chunks.length} 个块，但给了 ${vectors.length} 条向量`,
		);
	}
	store.insertChunkVectors(
		chunks.map((chunk, index) => ({
			chunkId: chunk.chunkId,
			embedding: [...(vectors[index] as readonly number[])],
		})),
	);
}

describe("多路融合检索", () => {
	it("BM25 与事件路同时命中，来源标记完整", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "融合" });
		const root = store.appendNode({
			id: "n-root",
			storyId: "s1",
			parentId: null,
			role: "system",
			raw: "青铜匕首藏在井底。",
		});
		const user = store.appendNode({
			id: "n-user",
			storyId: "s1",
			parentId: root.id,
			role: "user",
			raw: "我顺着绳子下井。",
		});
		const assistant = store.appendNode({
			id: "n-assistant",
			storyId: "s1",
			parentId: user.id,
			role: "assistant",
			raw: "你找到了青铜匕首。",
		});
		store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: root.id,
				ordinal: 0,
				participants: ["我"],
				importance: 0.9,
				knowers: [],
				text: "匕首藏在井底",
			},
			{
				storyId: "s1",
				sourceNodeId: user.id,
				ordinal: 0,
				participants: ["我"],
				importance: 0.1,
				knowers: [],
				text: "下井取匕首",
			},
		]);

		const hits = await retrieveMemory({
			store,
			storyId: "s1",
			query: "青铜匕首",
			beforeNodeId: assistant.id,
		});

		expect(hits.map((hit) => `${hit.kind}:${hit.nodeId}`)).toEqual([
			"event:n-root",
			"chunk:n-root",
			"event:n-user",
		]);
		expect(hits[0]?.sources).toEqual([{ route: "event", rank: 1 }]);
		expect(hits[1]?.sources).toEqual([{ route: "bm25", rank: 1 }]);
		expect(hits[2]?.sources).toEqual([{ route: "event", rank: 2 }]);
		expect(hits[0]?.score).toBeCloseTo(1 / 61);
		expect(hits[2]?.score).toBeCloseTo(1 / 62);
	});

	it("实体别名把相关事件排到更重要的无关事件前面", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s2", title: "实体" });
		const root = store.appendNode({
			id: "n-root",
			storyId: "s2",
			parentId: null,
			role: "system",
			raw: "山中雾气很重。",
		});
		const first = store.appendNode({
			id: "n-first",
			storyId: "s2",
			parentId: root.id,
			role: "assistant",
			raw: "剑鞘空着。",
		});
		const second = store.appendNode({
			id: "n-second",
			storyId: "s2",
			parentId: first.id,
			role: "assistant",
			raw: "有人离开。",
		});
		store.upsertEntity({
			storyId: "s2",
			kind: "item",
			name: "赤霄剑",
			source: "测试",
			aliases: ["赤霄"],
		});
		store.insertMemoryEvents([
			{
				storyId: "s2",
				sourceNodeId: first.id,
				ordinal: 0,
				participants: ["赤霄"],
				importance: 0.2,
				knowers: [],
				text: "剑被带走",
			},
			{
				storyId: "s2",
				sourceNodeId: second.id,
				ordinal: 0,
				participants: ["旁人"],
				importance: 0.9,
				knowers: [],
				text: "有人离开山门",
			},
		]);

		const hits = await retrieveMemory({
			store,
			storyId: "s2",
			query: "赤霄的来历",
		});

		expect(hits.map((hit) => hit.nodeId)).toEqual(["n-first", "n-second"]);
		expect(hits[0]?.sources).toEqual([
			{ route: "entity", rank: 1 },
			{ route: "event", rank: 2 },
		]);
		expect(hits[0]?.score).toBeCloseTo(1 / 61 + 1 / 62);
		expect(hits[1]?.sources).toEqual([{ route: "event", rank: 1 }]);
	});

	it("向量路按距离排序，同一楼层多个块只占一个位次", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s3", title: "向量" });
		const first = store.appendNode({
			id: "n-first",
			storyId: "s3",
			parentId: null,
			role: "user",
			raw: "无关乙",
		});
		const second = store.appendNode({
			id: "n-second",
			storyId: "s3",
			parentId: first.id,
			role: "assistant",
			raw: "无关甲",
		});
		const multi = store.appendNode({
			id: "n-multi",
			storyId: "s3",
			parentId: second.id,
			role: "assistant",
			raw: "丙".repeat(900),
		});
		insertVectors(store, first.id, [scaled(0, 0.5)]);
		insertVectors(store, second.id, [scaled(0, 0)]);
		insertVectors(store, multi.id, [scaled(0, 3), scaled(0, 1), scaled(0, 2)]);

		const hits = await retrieveMemory({
			store,
			embedder: embedderReturning(oneHot(0)),
			storyId: "s3",
			query: "无关词",
		});

		expect(hits.map((hit) => `${hit.kind}:${hit.nodeId}`)).toEqual([
			"chunk:n-multi",
			"chunk:n-first",
			"chunk:n-second",
		]);
		expect(hits[0]?.sources).toEqual([{ route: "vector", rank: 1 }]);
		expect(
			hits.some((hit) => hit.sources.some((s) => s.route === "bm25")),
		).toBe(false);
	});

	it("beforeNodeId 过滤分支上的块与事件", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s4", title: "分支" });
		const root = store.appendNode({
			id: "n-root",
			storyId: "s4",
			parentId: null,
			role: "system",
			raw: "青铜匕首在井底。",
		});
		const user = store.appendNode({
			id: "n-user",
			storyId: "s4",
			parentId: root.id,
			role: "user",
			raw: "我下井查看。",
		});
		const left = store.appendNode({
			id: "n-left",
			storyId: "s4",
			parentId: user.id,
			role: "assistant",
			raw: "左分支出现青铜匕首。",
		});
		const right = store.appendNode({
			id: "n-right",
			storyId: "s4",
			parentId: user.id,
			role: "assistant",
			raw: "右分支出现青铜匕首。",
		});
		store.insertMemoryEvents([
			{
				storyId: "s4",
				sourceNodeId: root.id,
				ordinal: 0,
				participants: ["我"],
				importance: 0.5,
				knowers: [],
				text: "匕首在井底",
			},
			{
				storyId: "s4",
				sourceNodeId: left.id,
				ordinal: 0,
				participants: ["我"],
				importance: 0.5,
				knowers: [],
				text: "左分支见到匕首",
			},
			{
				storyId: "s4",
				sourceNodeId: right.id,
				ordinal: 0,
				participants: ["我"],
				importance: 0.9,
				knowers: [],
				text: "右分支见到匕首",
			},
		]);

		const hits = await retrieveMemory({
			store,
			storyId: "s4",
			query: "青铜匕首",
			beforeNodeId: left.id,
		});
		expect(new Set(hits.map((hit) => hit.nodeId))).toEqual(new Set(["n-root"]));

		const atRoot = await retrieveMemory({
			store,
			storyId: "s4",
			query: "青铜匕首",
			beforeNodeId: root.id,
		});
		expect(atRoot).toEqual([]);
	});

	it("空查询返回重要事件与最近块，结果稳定", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s5", title: "空查询" });
		const root = store.appendNode({
			id: "n-root",
			storyId: "s5",
			parentId: null,
			role: "system",
			raw: "开场。",
		});
		const user = store.appendNode({
			id: "n-user",
			storyId: "s5",
			parentId: root.id,
			role: "user",
			raw: "我去集市。",
		});
		const assistant = store.appendNode({
			id: "n-assistant",
			storyId: "s5",
			parentId: user.id,
			role: "assistant",
			raw: "集市人很多。",
		});
		store.insertMemoryEvents([
			{
				storyId: "s5",
				sourceNodeId: root.id,
				ordinal: 0,
				participants: ["我"],
				importance: 0.2,
				knowers: [],
				text: "故事开场",
			},
			{
				storyId: "s5",
				sourceNodeId: user.id,
				ordinal: 0,
				participants: ["我"],
				importance: 0.95,
				knowers: [],
				text: "来到集市",
			},
		]);

		const hits = await retrieveMemory({ store, storyId: "s5", query: "" });
		expect(hits.map((hit) => `${hit.kind}:${hit.nodeId}`)).toEqual([
			"event:n-user",
			"chunk:n-assistant",
			"event:n-root",
			"chunk:n-user",
			"chunk:n-root",
		]);
		expect(hits[0]?.sources).toEqual([{ route: "event", rank: 1 }]);
		expect(hits[1]?.sources).toEqual([{ route: "recent", rank: 1 }]);

		const again = await retrieveMemory({ store, storyId: "s5", query: "" });
		expect(again).toEqual(hits);
	});

	it("limit 默认 8 且限制在 1 到 50", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s6", title: "条数" });
		let parentId: string | null = null;
		for (let index = 0; index < 12; index += 1) {
			const node = store.appendNode({
				id: `n-${index}`,
				storyId: "s6",
				parentId,
				role: "user",
				raw: `第 ${index} 楼。`,
			});
			parentId = node.id;
		}

		const hits = await retrieveMemory({ store, storyId: "s6", query: "" });
		expect(hits).toHaveLength(8);
		expect(
			await retrieveMemory({ store, storyId: "s6", query: "", limit: 1 }),
		).toHaveLength(1);
		await expect(
			retrieveMemory({ store, storyId: "s6", query: "", limit: 0 }),
		).rejects.toThrow("检索条数必须是 1 到 50 之间的整数");
		await expect(
			retrieveMemory({ store, storyId: "s6", query: "", limit: 51 }),
		).rejects.toThrow("检索条数必须是 1 到 50 之间的整数");
		await expect(
			retrieveMemory({ store, storyId: "s6", query: "", limit: 1.5 }),
		).rejects.toThrow("检索条数必须是 1 到 50 之间的整数");
	});

	it("缺失故事、缺失楼层与跨故事的 beforeNodeId 抛错", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s7", title: "校验" });
		const node = store.appendNode({
			id: "n-own",
			storyId: "s7",
			parentId: null,
			role: "user",
			raw: "第一楼",
		});
		store.createStory({ id: "s8", title: "另一个故事" });
		const foreign = store.appendNode({
			id: "n-foreign",
			storyId: "s8",
			parentId: null,
			role: "user",
			raw: "别处的楼层",
		});

		await expect(
			retrieveMemory({ store, storyId: "missing", query: "" }),
		).rejects.toThrow("故事不存在：missing");
		await expect(
			retrieveMemory({
				store,
				storyId: "s7",
				query: "",
				beforeNodeId: "n-missing",
			}),
		).rejects.toThrow("楼层节点不存在：n-missing");
		await expect(
			retrieveMemory({
				store,
				storyId: "s7",
				query: "",
				beforeNodeId: foreign.id,
			}),
		).rejects.toThrow("属于另一个故事");
		await expect(
			retrieveMemory({
				store,
				storyId: "s7",
				query: "",
				beforeNodeId: node.id,
				viewpoint: "",
			}),
		).rejects.toThrow("视角必须是非空字符串");
	});
});
