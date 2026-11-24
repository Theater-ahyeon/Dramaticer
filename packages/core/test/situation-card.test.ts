import { describe, expect, it } from "vitest";
import {
	type StoryStore,
	assembleContext,
	createDefaultContextTemplate,
	createSituationSlotProvider,
	createWorldIndexSlotProvider,
	editState,
	renderSituationCard,
	renderWorldIndex,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

// memory-v5/02：此刻局面卡与世界索引。

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "旧宅" });
	store.upsertEntity({
		storyId: "s1",
		kind: "character",
		name: "林雪",
		description: "旧宅的守夜人。",
		source: "test",
		aliases: [],
	});
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "门厅里只剩一盏灯。",
	});
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "a1",
		role: "user",
		raw: "我看着她。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "林雪把信藏进袖子里，阿宁在楼梯上没看见。",
	});
	store.appendStateDiffs([
		{
			storyId: "s1",
			nodeId: "a1",
			path: ["time", "current"],
			op: "set",
			value: "雨夜",
			source: "model",
		},
		{
			storyId: "s1",
			nodeId: "a1",
			path: ["scene", "current", "place"],
			op: "set",
			value: "门厅",
			source: "model",
		},
		{
			storyId: "s1",
			nodeId: "a2",
			path: ["character", "林雪", "status"],
			op: "set",
			value: "警觉",
			source: "model",
		},
		{
			storyId: "s1",
			nodeId: "a2",
			path: ["character", "阿宁", "status"],
			op: "set",
			value: "困倦",
			source: "model",
		},
	]);
	store.saveSceneLog({
		nodeId: "a2",
		storyId: "s1",
		beat: "试探",
		present: ["林雪", "阿宁"],
		sceneEnds: false,
		sceneCard: null,
		bits: [],
		conditions: [],
		states: [],
		quotes: { submitted: 0, verified: 0 },
		repairs: [],
	});
	store.insertMemoryEvents([
		{
			id: "ev-letter",
			storyId: "s1",
			sourceNodeId: "a2",
			ordinal: 0,
			storyTime: "雨夜",
			location: "门厅",
			participants: ["林雪"],
			importance: 0.8,
			knowers: ["林雪"],
			text: "林雪把信藏进袖子里",
		},
		{
			id: "ev-stairs",
			storyId: "s1",
			sourceNodeId: "a2",
			ordinal: 1,
			storyTime: "雨夜",
			location: "楼梯",
			participants: ["阿宁"],
			importance: 0.3,
			knowers: [],
			text: "阿宁站在楼梯上",
		},
	]);
}

describe("此刻局面卡", () => {
	it("渲染时间地点、在场者与知情边界，不超过 500 token", () => {
		const { store } = openTempStore();
		seed(store);
		const card = renderSituationCard(store, "s1", "a2");
		expect(card?.text).toContain("时间地点：雨夜，门厅");
		expect(card?.text).toContain("在场：林雪（警觉）");
		expect(card?.text).toContain("知情边界：「林雪把信藏进袖子里」");
		expect(card?.text).toContain("阿宁不知道");
		expect(card?.tokens ?? 999).toBeLessThanOrEqual(500);
	});

	it("未知情者那一行不带秘密内容", () => {
		const { store } = openTempStore();
		seed(store);
		const card = renderSituationCard(store, "s1", "a2");
		const aning = card?.lines.find((line) =>
			line.text.startsWith("在场：阿宁"),
		);
		expect(aning?.text).toBe("在场：阿宁（困倦）");
		expect(aning?.text).not.toContain("信");
	});

	it("玩家锁定的事实不被下一楼的写入覆盖", () => {
		const { store } = openTempStore();
		seed(store);
		editState(store, "s1", "a2", ["character", "林雪", "status"], "镇定");
		store.appendNode({
			id: "u2",
			storyId: "s1",
			parentId: "a2",
			role: "user",
			raw: "我开口。",
		});
		store.appendNode({
			id: "a3",
			storyId: "s1",
			parentId: "u2",
			role: "assistant",
			raw: "林雪皱眉。",
		});
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "a3",
				path: ["character", "林雪", "status"],
				op: "set",
				value: "慌张",
				source: "settler",
			},
		]);
		const card = renderSituationCard(store, "s1", "a3");
		expect(card?.text).toContain("林雪（镇定）");
		expect(card?.text).not.toContain("慌张");
	});

	it("卡自带状态体系时只留在场者、已死之人与知情边界", () => {
		const { store } = openTempStore();
		seed(store);
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "a2",
				path: ["mvu", "体力"],
				op: "set",
				value: 80,
				source: "model",
			},
		]);
		const card = renderSituationCard(store, "s1", "a2");
		expect(card?.cardStateful).toBe(true);
		expect(card?.text).not.toContain("时间地点");
		expect(card?.text).not.toContain("警觉");
		expect(card?.text).toContain("在场：林雪");
		expect(card?.text).toContain("知情边界");
	});

	it("分支切换后按当前路径重算", () => {
		const { store } = openTempStore();
		seed(store);
		store.appendNode({
			id: "a2b",
			storyId: "s1",
			parentId: "u1",
			role: "assistant",
			raw: "另一条分支：林雪离开了门厅。",
		});
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "a2b",
				path: ["scene", "current", "place"],
				op: "set",
				value: "后院",
				source: "model",
			},
		]);
		expect(renderSituationCard(store, "s1", "a2b")?.text).toContain("后院");
		expect(renderSituationCard(store, "s1", "a2")?.text).toContain("门厅");
		expect(renderSituationCard(store, "s1", "a2")?.text).not.toContain("后院");
	});
});

describe("世界索引", () => {
	it("每个实体与未收的线一行，约 200 字", () => {
		const { store } = openTempStore();
		seed(store);
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "a2",
				path: ["clue", "信", "text"],
				op: "set",
				value: "那封信写了什么",
				source: "model",
			},
			{
				storyId: "s1",
				nodeId: "a2",
				path: ["clue", "信", "status"],
				op: "set",
				value: "open",
				source: "model",
			},
		]);
		const index = renderWorldIndex(store, "s1", "a2");
		expect(index?.text).toContain("林雪");
		expect(index?.text).toContain("未收的线：那封信写了什么");
		expect(index?.text.length ?? 999).toBeLessThanOrEqual(300);
	});
});

describe("局面卡与索引进上下文", () => {
	it("默认模板里两段都在，并且每行有 Trace 来源；关掉开关时不注入", async () => {
		const { store } = openTempStore();
		seed(store);
		const providers = {
			situation: createSituationSlotProvider(store),
			world_index: createWorldIndexSlotProvider(store),
		};
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		});
		const context = await assembleContext({
			template,
			budgetTokens: 8_000,
			storyId: "s1",
			nodeId: "a2",
			providers,
		});
		const situation = context.trace.entries.find(
			(entry) => entry.segmentId === "situation",
		);
		expect(situation?.status).toBe("included");
		expect(situation?.items?.length ?? 0).toBeGreaterThan(0);
		expect(situation?.items?.[0]?.source.kind).toBe("state");
		const index = context.trace.entries.find(
			(entry) => entry.segmentId === "world_index",
		);
		expect(index?.status).toBe("included");
		expect(index?.items?.some((item) => item.source.kind === "wiki")).toBe(
			true,
		);

		store.updateStorySettings("s1", {
			featureSwitches: { situation: false, notebook: false },
		});
		const off = await assembleContext({
			template,
			budgetTokens: 8_000,
			storyId: "s1",
			nodeId: "a2",
			providers,
		});
		expect(
			off.trace.entries.find((entry) => entry.segmentId === "situation")
				?.status,
		).toBe("missing-slot");
		expect(
			off.trace.entries.find((entry) => entry.segmentId === "world_index")
				?.status,
		).toBe("missing-slot");
	});
});
