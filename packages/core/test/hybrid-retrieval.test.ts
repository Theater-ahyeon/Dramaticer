import { describe, expect, it } from "vitest";
import {
	type EmbeddingClient,
	type StoryStore,
	fuseRetrievalRoutes,
	rankMemoryRoutes,
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

		const { hits } = await retrieveMemory({
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

	it("融合按楼层去重时保留命中父段的文本", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s-parent", title: "父段" });
		const floor = store.appendNode({
			id: "n-parent",
			storyId: "s-parent",
			parentId: null,
			role: "assistant",
			raw: `${"甲".repeat(700)}\n${"乙".repeat(700)}`,
		});
		const ask = store.appendNode({
			id: "n-ask",
			storyId: "s-parent",
			parentId: floor.id,
			role: "user",
			raw: "乙乙乙",
		});

		const { hits } = await retrieveMemory({
			store,
			storyId: "s-parent",
			query: "乙乙乙",
			beforeNodeId: ask.id,
		});
		const chunk = hits.find((hit) => hit.kind === "chunk");
		expect(chunk).toMatchObject({
			nodeId: floor.id,
			parentOrdinal: 1,
			parentText: "乙".repeat(700),
		});
	});

	it("每一路的原始名次可单独读取，融合结果与 retrieveMemory 一致", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s-routes", title: "名次" });
		const root = store.appendNode({
			id: "n-root",
			storyId: "s-routes",
			parentId: null,
			role: "system",
			raw: "青铜匕首藏在井底。",
		});
		const ask = store.appendNode({
			id: "n-ask",
			storyId: "s-routes",
			parentId: root.id,
			role: "user",
			raw: "我去找匕首。",
		});
		store.insertMemoryEvents([
			{
				storyId: "s-routes",
				sourceNodeId: root.id,
				ordinal: 0,
				participants: ["我"],
				importance: 0.8,
				knowers: [],
				text: "匕首藏在井底",
			},
		]);

		const rankings = await rankMemoryRoutes({
			store,
			storyId: "s-routes",
			query: "青铜匕首",
			beforeNodeId: ask.id,
			limit: 20,
		});
		const bm25 = rankings.routes.find((route) => route.route === "bm25");
		const events = rankings.routes.find((route) => route.route === "event");
		expect(bm25?.items[0]).toMatchObject({
			kind: "chunk",
			nodeId: root.id,
			parentOrdinal: 0,
		});
		expect(events?.items[0]).toEqual({ kind: "event", nodeId: root.id });
		expect(rankings.filter).toEqual({
			viewpoint: null,
			eventsBeforeFilter: 1,
			eventsAfterFilter: 1,
			chunksExcluded: false,
		});

		const fused = fuseRetrievalRoutes(rankings.routes).slice(0, 20);
		const direct = await retrieveMemory({
			store,
			storyId: "s-routes",
			query: "青铜匕首",
			beforeNodeId: ask.id,
			limit: 20,
		});
		expect(fused).toEqual([...direct.hits]);
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

		const { hits } = await retrieveMemory({
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

		const { hits } = await retrieveMemory({
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

		const { hits } = await retrieveMemory({
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
		expect(atRoot.hits).toEqual([]);
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

		const { hits } = await retrieveMemory({ store, storyId: "s5", query: "" });
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
		expect(again.hits).toEqual(hits);
		expect(again.filter).toEqual({
			viewpoint: null,
			eventsBeforeFilter: 2,
			eventsAfterFilter: 2,
			chunksExcluded: false,
		});
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

		const { hits } = await retrieveMemory({ store, storyId: "s6", query: "" });
		expect(hits).toHaveLength(8);
		expect(
			(await retrieveMemory({ store, storyId: "s6", query: "", limit: 1 }))
				.hits,
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

	it("视角过滤只保留公开、星号与知情者命中的事件", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s9", title: "视角" });
		const root = store.appendNode({
			id: "n-root",
			storyId: "s9",
			parentId: null,
			role: "system",
			raw: "青铜匕首藏在井底。",
		});
		const starred = store.appendNode({
			id: "n-star",
			storyId: "s9",
			parentId: root.id,
			role: "assistant",
			raw: "青铜匕首泛着冷光。",
		});
		const secret = store.appendNode({
			id: "n-secret",
			storyId: "s9",
			parentId: starred.id,
			role: "assistant",
			raw: "守卫把青铜匕首收走。",
		});
		const known = store.appendNode({
			id: "n-known",
			storyId: "s9",
			parentId: secret.id,
			role: "assistant",
			raw: "阿七记下了青铜匕首。",
		});
		const ask = store.appendNode({
			id: "n-ask",
			storyId: "s9",
			parentId: known.id,
			role: "user",
			raw: "我记得青铜匕首吗？",
		});
		store.upsertEntity({
			storyId: "s9",
			kind: "character",
			name: "林七",
			source: "测试",
			aliases: ["阿七"],
		});
		store.insertMemoryEvents([
			{
				storyId: "s9",
				sourceNodeId: root.id,
				ordinal: 0,
				participants: ["我"],
				importance: 0.9,
				knowers: ["林七"],
				text: "匕首在井底",
			},
			{
				storyId: "s9",
				sourceNodeId: starred.id,
				ordinal: 0,
				participants: ["我"],
				importance: 0.8,
				knowers: ["*"],
				text: "所有人看见匕首",
			},
			{
				storyId: "s9",
				sourceNodeId: secret.id,
				ordinal: 0,
				participants: ["守卫"],
				importance: 0.99,
				knowers: ["守卫"],
				text: "守卫收走匕首",
			},
			{
				storyId: "s9",
				sourceNodeId: known.id,
				ordinal: 0,
				participants: ["我"],
				importance: 0.7,
				knowers: ["阿七"],
				text: "阿七记下匕首",
			},
		]);

		const { hits, filter } = await retrieveMemory({
			store,
			storyId: "s9",
			query: "青铜匕首",
			beforeNodeId: ask.id,
			viewpoint: "阿七",
		});
		expect(hits.map((hit) => `${hit.kind}:${hit.nodeId}`)).toEqual([
			"event:n-root",
			"event:n-star",
			"event:n-known",
		]);
		expect(filter).toEqual({
			viewpoint: "阿七",
			eventsBeforeFilter: 4,
			eventsAfterFilter: 3,
			chunksExcluded: true,
		});

		const omniscient = await retrieveMemory({
			store,
			storyId: "s9",
			query: "青铜匕首",
			beforeNodeId: ask.id,
		});
		expect(omniscient.filter).toEqual({
			viewpoint: null,
			eventsBeforeFilter: 4,
			eventsAfterFilter: 4,
			chunksExcluded: false,
		});
		expect(omniscient.hits.some((hit) => hit.kind === "chunk")).toBe(true);
		expect(omniscient.hits.some((hit) => hit.nodeId === secret.id)).toBe(true);
	});

	it("视角与知情者按实体别名双向匹配", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s10", title: "别名" });
		const root = store.appendNode({
			id: "n-root",
			storyId: "s10",
			parentId: null,
			role: "system",
			raw: "开场。",
		});
		const tale = store.appendNode({
			id: "n-tale",
			storyId: "s10",
			parentId: root.id,
			role: "assistant",
			raw: "只有阿七知道暗道。",
		});
		const ask = store.appendNode({
			id: "n-ask",
			storyId: "s10",
			parentId: tale.id,
			role: "user",
			raw: "暗道在哪里？",
		});
		store.upsertEntity({
			storyId: "s10",
			kind: "character",
			name: "林七",
			source: "测试",
			aliases: ["阿七"],
		});
		store.insertMemoryEvents([
			{
				storyId: "s10",
				sourceNodeId: tale.id,
				ordinal: 0,
				participants: ["阿七"],
				importance: 0.6,
				knowers: ["阿七"],
				text: "阿七知道暗道",
			},
			{
				storyId: "s10",
				sourceNodeId: root.id,
				ordinal: 0,
				participants: ["我"],
				importance: 0.5,
				knowers: [],
				text: "开场",
			},
		]);

		for (const viewpoint of ["林七", "阿七", "林 七"]) {
			const result = await retrieveMemory({
				store,
				storyId: "s10",
				query: "暗道",
				beforeNodeId: ask.id,
				viewpoint,
			});
			expect(result.hits.map((hit) => `${hit.kind}:${hit.nodeId}`)).toEqual([
				"event:n-tale",
				"event:n-root",
			]);
			expect(result.filter.eventsAfterFilter).toBe(2);
		}

		const outsider = await retrieveMemory({
			store,
			storyId: "s10",
			query: "暗道",
			beforeNodeId: ask.id,
			viewpoint: "陌生人",
		});
		expect(outsider.hits.map((hit) => `${hit.kind}:${hit.nodeId}`)).toEqual([
			"event:n-root",
		]);
		expect(outsider.filter.eventsAfterFilter).toBe(1);
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

	it("按每一路的权重改变 RRF 分数与顺序", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s-weighted", title: "权重" });
		const root = store.appendNode({
			id: "n-root",
			storyId: "s-weighted",
			parentId: null,
			role: "system",
			raw: "青铜匕首藏在井底。",
		});
		const user = store.appendNode({
			id: "n-user",
			storyId: "s-weighted",
			parentId: root.id,
			role: "user",
			raw: "我顺着绳子下井。",
		});
		const ask = store.appendNode({
			id: "n-ask",
			storyId: "s-weighted",
			parentId: user.id,
			role: "assistant",
			raw: "你找到了青铜匕首。",
		});
		store.insertMemoryEvents([
			{
				storyId: "s-weighted",
				sourceNodeId: root.id,
				ordinal: 0,
				participants: ["我"],
				importance: 0.9,
				knowers: [],
				text: "匕首藏在井底",
			},
		]);
		const rankings = await rankMemoryRoutes({
			store,
			storyId: "s-weighted",
			query: "青铜匕首",
			beforeNodeId: ask.id,
		});
		const equal = fuseRetrievalRoutes(rankings.routes);
		expect(equal[0]?.kind).toBe("event");
		const weighted = fuseRetrievalRoutes(rankings.routes, { bm25: 2 });
		expect(weighted[0]?.kind).toBe("chunk");
		expect(weighted[0]?.score).toBeGreaterThan(weighted[1]?.score ?? 0);
	});

	it("非法的路权重直接抛错", () => {
		expect(() => fuseRetrievalRoutes([], { bm25: Number.NaN })).toThrow(
			"权重必须",
		);
		expect(() => fuseRetrievalRoutes([], { event: 0 })).toThrow("权重必须");
		expect(() => fuseRetrievalRoutes([], { unknown: 1 } as never)).toThrow(
			"未知的检索路权重",
		);
	});
});
