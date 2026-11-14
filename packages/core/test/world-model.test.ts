import { describe, expect, it } from "vitest";
import {
	type ContextSlotRequest,
	DEFAULT_STORY_SETTINGS_VALUES,
	DEFAULT_WORLD_MODEL_KIND,
	type StoryStore,
	WORLD_MODEL_KINDS,
	createLedgerWorldModel,
	createStateSlotProvider,
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

	it("未实现的候选在选择时直接失败", () => {
		const { store } = openTempStore();
		seedPath(store);
		expect(() => createWorldModel(store, "wiki")).toThrow("尚未实现");
		expect(() => createWorldModel(store, "temporal_graph")).toThrow("尚未实现");
		expect(() => createWorldModel(store, "nope" as never)).toThrow("不合法");
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

	it("状态槽位按设置选择实现，未实现时在装载槽位时失败", async () => {
		const { store } = openTempStore();
		seedPath(store);
		store.updateStorySettings("s1", { worldModel: "ledger" });
		const provider = createStateSlotProvider(store, { worldModel: "ledger" });
		expect(provider.packKey).toBe("state:ledger");
		const content = await provider.provide(request("n-reply"));
		expect(content).toBeNull();
		expect(() =>
			createStateSlotProvider(store, { worldModel: "wiki" }),
		).toThrow("尚未实现");
	});
});
