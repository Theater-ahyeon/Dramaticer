import { describe, expect, it } from "vitest";
import {
	type ContextSlotRequest,
	DEFAULT_STORY_SETTINGS_VALUES,
	DEFAULT_WORLD_MODEL_KIND,
	type StoryStore,
	WORLD_MODEL_KINDS,
	createLedgerWorldModel,
	createStateSlotProvider,
	createTemporalGraphWorldModel,
	createWorldModel,
	isWorldModelKind,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function seedPath(store: StoryStore): string {
	store.createStory({ id: "s1", title: "测试" });
	store.appendNode({
		id: "n-root",
		storyId: "s1",
		parentId: null,
		role: "system",
		raw: "开场。",
	});
	store.appendNode({
		id: "n-reply",
		storyId: "s1",
		parentId: "n-root",
		role: "assistant",
		raw: "山门开了。",
	});
	return "n-reply";
}

function request(nodeId: string | null): ContextSlotRequest {
	return {
		slot: "state",
		storyId: "s1",
		nodeId,
		switches: {},
		state: undefined,
	};
}

describe("世界模型接口", () => {
	it("种类清单包含三个候选，默认是台账", () => {
		expect(WORLD_MODEL_KINDS).toEqual(["ledger", "wiki", "temporal_graph"]);
		expect(DEFAULT_WORLD_MODEL_KIND).toBe("ledger");
		expect(isWorldModelKind("ledger")).toBe(true);
		expect(isWorldModelKind("nope")).toBe(false);
	});

	it("台账适配器的读取与状态快照一致，source 与状态槽位相同", async () => {
		const { store } = openTempStore();
		const nodeId = seedPath(store);
		store.appendStateDiff({
			storyId: "s1",
			nodeId,
			path: ["character", "卫宫", "status"],
			op: "set",
			value: "戒备",
			source: "model",
		});
		const world = createWorldModel(store, "ledger");
		expect(world.kind).toBe("ledger");
		const view = world.read(nodeId);
		expect(view.state).toEqual(store.getStateSnapshot(nodeId).state);
		expect(view.sections).toEqual([]);
		expect(view.source).toBe("state:1 条 diff");

		const provider = createStateSlotProvider(store);
		const content = await provider.provide(request(nodeId));
		expect(content?.source).toBe(view.source);
		expect(content?.messages).toEqual([
			{
				role: "system",
				content: `当前状态：\n${JSON.stringify(view.state, null, 2)}`,
			},
		]);
	});

	it("写入校验通过后立即可读，非法路径抛错并指出路径", () => {
		const { store } = openTempStore();
		const nodeId = seedPath(store);
		const world = createLedgerWorldModel(store);
		expect(
			world.write(nodeId, [
				{
					path: ["scene", "current", "place"],
					op: "set",
					value: "山门",
					source: "settler",
					storyTime: null,
					confidence: 0.8,
				},
			]),
		).toEqual({ written: 1 });
		expect(world.read(nodeId).state).toEqual({
			scene: { current: { place: "山门" } },
		});
		expect(store.getStateDiffs(nodeId)[0]?.confidence).toBe(0.8);
		expect(store.getStateDiffs(nodeId)[0]?.storyTime).toBeNull();

		expect(() =>
			world.write(nodeId, [
				{
					path: ["nope", "field"],
					op: "set",
					value: "x",
					source: "settler",
				},
			]),
		).toThrow("nope");
	});

	it("删除后的路径不再出现在读取结果里", () => {
		const { store } = openTempStore();
		const nodeId = seedPath(store);
		const world = createLedgerWorldModel(store);
		world.write(nodeId, [
			{
				path: ["item", "剑", "holder"],
				op: "set",
				value: "卫宫",
				source: "model",
			},
		]);
		world.write(nodeId, [
			{ path: ["item", "剑"], op: "delete", source: "model" },
		]);
		expect(world.read(nodeId).state).toEqual({ item: {} });
	});

	it("未知种类在选择时直接失败，三个候选都可以创建", () => {
		const { store } = openTempStore();
		seedPath(store);
		for (const kind of WORLD_MODEL_KINDS) {
			expect(createWorldModel(store, kind).kind).toBe(kind);
		}
		expect(() => createWorldModel(store, "nope" as never)).toThrow("不合法");
	});
});

describe("wiki 候选", () => {
	function seedCharacters(store: StoryStore): void {
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "n-root",
				path: ["character", "卫宫", "tier"],
				op: "set",
				value: "lead",
				source: "model",
			},
			{
				storyId: "s1",
				nodeId: "n-root",
				path: ["character", "卫宫", "identity"],
				op: "set",
				value: "剑士",
				source: "model",
			},
		]);
	}

	it("写入两版后读取到最新正文、版本数与出处", () => {
		const { store } = openTempStore();
		seedPath(store);
		seedCharacters(store);
		const world = createWorldModel(store, "wiki");
		expect(world.kind).toBe("wiki");
		world.write("n-root", [
			{
				path: ["profile", "卫宫"],
				op: "set",
				value: "初见面时冷淡，习惯独来独往。",
				source: "settler",
			},
		]);
		world.write("n-reply", [
			{
				path: ["profile", "卫宫"],
				op: "set",
				value: "山门一战后对玩家放下戒心，愿意并肩。",
				source: "settler",
				storyTime: { start: "第三日", end: "第三日" },
			},
		]);
		const view = world.read("n-reply");
		expect(view.state).toEqual({
			character: { 卫宫: { tier: "lead", identity: "剑士" } },
		});
		expect(view.source).toBe("state:2 条 diff，档案 2 版");
		expect(view.sections).toEqual([
			{
				title: "档案：卫宫",
				text: [
					"山门一战后对玩家放下戒心，愿意并肩。",
					"版本数：2；出处楼层：n-reply；最早出处：n-root",
				].join("\n"),
			},
		]);
		expect(store.listWikiRevisionsAlongPath("n-reply")[1]?.storyTime).toEqual({
			start: "第三日",
			end: "第三日",
		});
	});

	it("分支切换后只出现当前路径上的版本", () => {
		const { store } = openTempStore();
		seedPath(store);
		seedCharacters(store);
		store.appendNode({
			id: "n-a",
			storyId: "s1",
			parentId: "n-root",
			role: "assistant",
			raw: "A 线。",
		});
		store.appendNode({
			id: "n-b",
			storyId: "s1",
			parentId: "n-root",
			role: "assistant",
			raw: "B 线。",
		});
		const world = createWorldModel(store, "wiki");
		world.write("n-a", [
			{
				path: ["profile", "卫宫"],
				op: "set",
				value: "A 线的档案。",
				source: "settler",
			},
		]);
		world.write("n-b", [
			{
				path: ["profile", "卫宫"],
				op: "set",
				value: "B 线的档案。",
				source: "settler",
			},
		]);
		expect(world.read("n-a").sections[0]?.text).toContain("A 线的档案。");
		expect(world.read("n-a").sections[0]?.text).toContain("版本数：1");
		expect(world.read("n-b").sections[0]?.text).toContain("B 线的档案。");
		expect(world.read("n-root").sections).toEqual([]);
	});

	it("空正文、未知人物与删除在写入时抛错并指出字段", () => {
		const { store } = openTempStore();
		seedPath(store);
		seedCharacters(store);
		const world = createWorldModel(store, "wiki");
		expect(() =>
			world.write("n-reply", [
				{
					path: ["profile", "卫宫"],
					op: "set",
					value: "   ",
					source: "settler",
				},
			]),
		).toThrow("正文");
		expect(() =>
			world.write("n-reply", [
				{
					path: ["profile", "不存在的角色"],
					op: "set",
					value: "档案。",
					source: "settler",
				},
			]),
		).toThrow("人物不存在");
		expect(() =>
			world.write("n-reply", [
				{
					path: ["profile", "卫宫"],
					op: "delete",
					source: "settler",
				},
			]),
		).toThrow("只追加");
		expect(store.listWikiRevisionsAlongPath("n-reply")).toEqual([]);
	});

	it("同一批写入里新建的人物可以直接写档案", () => {
		const { store } = openTempStore();
		seedPath(store);
		const world = createWorldModel(store, "wiki");
		world.write("n-reply", [
			{
				path: ["character", "林夕", "tier"],
				op: "set",
				value: "lead",
				source: "model",
			},
			{
				path: ["character", "林夕", "identity"],
				op: "set",
				value: "药铺学徒",
				source: "model",
			},
			{
				path: ["profile", "林夕"],
				op: "set",
				value: "说话很快，怕黑。",
				source: "model",
			},
		]);
		expect(world.read("n-reply").state).toEqual({
			character: { 林夕: { tier: "lead", identity: "药铺学徒" } },
		});
		expect(world.read("n-reply").sections[0]?.title).toBe("档案：林夕");
	});

	it("状态槽位在 wiki 下包含档案段", async () => {
		const { store } = openTempStore();
		seedPath(store);
		seedCharacters(store);
		const world = createWorldModel(store, "wiki");
		world.write("n-reply", [
			{
				path: ["profile", "卫宫"],
				op: "set",
				value: "对玩家仍有保留。",
				source: "settler",
			},
		]);
		const provider = createStateSlotProvider(store, { worldModel: "wiki" });
		expect(provider.packKey).toBe("state:wiki");
		const view = world.read("n-reply");
		const content = await provider.provide(request("n-reply"));
		expect(content?.source).toBe(view.source);
		expect(content?.messages).toHaveLength(2);
		expect(content?.messages[0]).toEqual({
			role: "system",
			content: `当前状态：\n${JSON.stringify(view.state, null, 2)}`,
		});
		expect(content?.messages[1]?.content).toBe(
			"档案：卫宫：\n对玩家仍有保留。\n版本数：1；出处楼层：n-reply；最早出处：n-reply",
		);
	});
});

describe("时序知识图谱候选", () => {
	function seedThird(store: StoryStore): void {
		store.appendNode({
			id: "n-third",
			storyId: "s1",
			parentId: "n-reply",
			role: "assistant",
			raw: "剑断了。",
		});
	}

	it("set 后 delete 的事实仍在读取结果里且带失效楼层与最后值", () => {
		const { store } = openTempStore();
		seedPath(store);
		seedThird(store);
		const world = createTemporalGraphWorldModel(store);
		world.write("n-reply", [
			{
				path: ["item", "剑", "holder"],
				op: "set",
				value: "卫宫",
				source: "model",
				storyTime: { start: "第一天", end: null },
			},
		]);
		world.write("n-third", [
			{
				path: ["item", "剑"],
				op: "delete",
				source: "settler",
				storyTime: { start: "第三天", end: null },
			},
		]);
		const view = world.read("n-third");
		expect(view.state).toEqual({ item: {} });
		expect(view.source).toBe("state:2 条 diff，已失效 1 条");
		expect(view.sections).toEqual([
			{
				title: "已失效事实",
				text: '["item","剑","holder"] = "卫宫"（楼层 n-reply → n-third；原因 已删除；来源 model；故事时间 第一天 至 …）',
			},
		]);
		expect(world.versions("n-third")).toEqual([
			{
				path: ["item", "剑", "holder"],
				value: "卫宫",
				storyTime: { start: "第一天", end: null },
				source: "model",
				startNodeId: "n-reply",
				endNodeId: "n-third",
				endReason: "deleted",
				endStoryTime: { start: "第三天", end: null },
			},
		]);
	});

	it("按时间点查询只返回该时间成立的事实，没有时间的事实只在当前视图出现", () => {
		const { store } = openTempStore();
		seedPath(store);
		seedThird(store);
		const world = createTemporalGraphWorldModel(store);
		world.write("n-reply", [
			{
				path: ["relation", "凛", "卫宫", "stage"],
				op: "set",
				value: "警惕",
				source: "model",
				storyTime: { start: "第一天", end: null },
			},
			{
				path: ["scene", "current", "place"],
				op: "set",
				value: "山门",
				source: "model",
			},
		]);
		world.write("n-third", [
			{
				path: ["relation", "凛", "卫宫", "stage"],
				op: "set",
				value: "并肩",
				source: "settler",
				storyTime: { start: "第三天", end: null },
			},
		]);
		const past = world.read("n-third", { atStoryTime: "第一天" });
		expect(past.state).toEqual({
			relation: { 凛: { 卫宫: { stage: "警惕" } } },
		});
		expect(past.source).toBe("state:时序图谱 1 条事实，故事时间 第一天");
		const later = world.read("n-third", { atStoryTime: "第三天" });
		expect(later.state).toEqual({
			relation: { 凛: { 卫宫: { stage: "并肩" } } },
		});
		expect(world.read("n-third").state).toEqual({
			relation: { 凛: { 卫宫: { stage: "并肩" } } },
			scene: { current: { place: "山门" } },
		});
		expect(() => world.read("n-third", { atStoryTime: "第九天" })).toThrow(
			"没有记录",
		);
	});

	it("分支切换只看到当前路径上的版本与失效段", () => {
		const { store } = openTempStore();
		seedPath(store);
		store.appendNode({
			id: "n-a",
			storyId: "s1",
			parentId: "n-root",
			role: "assistant",
			raw: "A 线拿到剑。",
		});
		store.appendNode({
			id: "n-a2",
			storyId: "s1",
			parentId: "n-a",
			role: "assistant",
			raw: "A 线剑断了。",
		});
		store.appendNode({
			id: "n-b",
			storyId: "s1",
			parentId: "n-root",
			role: "assistant",
			raw: "B 线拿到剑。",
		});
		const world = createTemporalGraphWorldModel(store);
		world.write("n-a", [
			{
				path: ["item", "剑", "holder"],
				op: "set",
				value: "卫宫",
				source: "model",
			},
		]);
		world.write("n-a2", [
			{ path: ["item", "剑"], op: "delete", source: "model" },
		]);
		world.write("n-b", [
			{
				path: ["item", "剑", "holder"],
				op: "set",
				value: "凛",
				source: "model",
			},
		]);
		expect(world.read("n-a2").state).toEqual({ item: {} });
		expect(world.read("n-a2").sections[0]?.text).toContain(
			"楼层 n-a → n-a2；原因 已删除",
		);
		expect(world.read("n-a2").sections[0]?.text).toContain('"卫宫"');
		expect(world.read("n-b").state).toEqual({
			item: { 剑: { holder: "凛" } },
		});
		expect(world.read("n-b").sections).toEqual([]);
		expect(world.versions("n-b")).toHaveLength(1);
		expect(world.versions("n-a2")).toHaveLength(1);
	});

	it("状态槽位在时序图谱下包含失效段", async () => {
		const { store } = openTempStore();
		seedPath(store);
		seedThird(store);
		const world = createTemporalGraphWorldModel(store);
		world.write("n-reply", [
			{
				path: ["item", "剑", "holder"],
				op: "set",
				value: "卫宫",
				source: "model",
			},
		]);
		world.write("n-third", [
			{ path: ["item", "剑"], op: "delete", source: "model" },
		]);
		const provider = createStateSlotProvider(store, {
			worldModel: "temporal_graph",
		});
		expect(provider.packKey).toBe("state:temporal_graph");
		const view = world.read("n-third");
		const content = await provider.provide(request("n-third"));
		expect(content?.source).toBe(view.source);
		expect(content?.messages).toHaveLength(2);
		expect(content?.messages[1]?.content).toBe(
			`已失效事实：\n${view.sections[0]?.text}`,
		);
	});

	it("台账与 wiki 收到时间点查询时直接失败", () => {
		const { store } = openTempStore();
		seedPath(store);
		expect(() =>
			createWorldModel(store, "ledger").read("n-reply", {
				atStoryTime: "第一天",
			}),
		).toThrow("不支持按故事时间点查询");
		expect(() =>
			createWorldModel(store, "wiki").read("n-reply", {
				atStoryTime: "第一天",
			}),
		).toThrow("不支持按故事时间点查询");
	});
});

describe("故事设置的世界模型", () => {
	it("默认值是台账，写入后读回，非法值被拒绝", () => {
		const { store } = openTempStore();
		seedPath(store);
		expect(store.getStorySettings("s1").worldModel).toBe("ledger");
		expect(DEFAULT_STORY_SETTINGS_VALUES.worldModel).toBe("ledger");
		const saved = store.updateStorySettings("s1", {
			worldModel: "temporal_graph",
		});
		expect(saved.worldModel).toBe("temporal_graph");
		expect(store.getStorySettings("s1").worldModel).toBe("temporal_graph");
		expect(() =>
			store.updateStorySettings("s1", { worldModel: "nope" as never }),
		).toThrow("worldModel");
	});

	it("状态槽位按设置选择实现，空状态返回空", async () => {
		const { store } = openTempStore();
		seedPath(store);
		const ledger = createStateSlotProvider(store, { worldModel: "ledger" });
		expect(ledger.packKey).toBe("state:ledger");
		expect(await ledger.provide(request("n-reply"))).toBeNull();
		const temporal = createStateSlotProvider(store, {
			worldModel: "temporal_graph",
		});
		expect(temporal.packKey).toBe("state:temporal_graph");
		expect(await temporal.provide(request("n-reply"))).toBeNull();
	});
});
