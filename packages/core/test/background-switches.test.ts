import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	StoryStore,
	createDefaultBackgroundJobRegistry,
	createMemorySlotProvider,
	readStoryBackgroundSwitches,
	readStoryFeatureState,
	readStoryFeatureView,
	readStoryPromiseLimit,
	resolveStoryBackgroundKinds,
} from "../src/index.js";

function openStory(): StoryStore {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-bg-switches-"));
	const store = StoryStore.open(join(dir, "story.db"));
	onTestFinished(() => {
		store.close();
		rmSync(dirname(join(dir, "story.db")), { recursive: true, force: true });
	});
	store.createStory({ id: "s1", title: "山门" });
	return store;
}

function addEntity(store: StoryStore): void {
	store.upsertEntity({
		storyId: "s1",
		kind: "character",
		name: "守门人",
		description: "住在山门旁。",
		source: "test",
		aliases: [],
	});
}

describe("后台开关跟随功能页", () => {
	it("标准档默认打开场记；有实体时同时打开归档", () => {
		const store = openStory();
		const registry = createDefaultBackgroundJobRegistry();
		const noEntities = resolveStoryBackgroundKinds(
			registry,
			readStoryBackgroundSwitches(store, "s1"),
		);
		expect(noEntities).toContain("scene_log");
		// 归档依赖实体能力；没有实体时功能页不显示它，也不运行。
		expect(noEntities).not.toContain("scene_archive");

		addEntity(store);
		const withEntities = resolveStoryBackgroundKinds(
			registry,
			readStoryBackgroundSwitches(store, "s1"),
		);
		expect(withEntities).toContain("scene_log");
		expect(withEntities).toContain("scene_archive");
	});

	it("省档或单独关掉场记时不运行场记与归档", () => {
		const store = openStory();
		addEntity(store);
		const registry = createDefaultBackgroundJobRegistry();
		store.updateStorySettings("s1", { featureTier: "lite" });
		const lite = resolveStoryBackgroundKinds(
			registry,
			readStoryBackgroundSwitches(store, "s1"),
		);
		expect(lite).not.toContain("scene_log");
		expect(lite).not.toContain("scene_archive");

		store.updateStorySettings("s1", {
			featureTier: "standard",
			featureSwitches: { scribe: false },
		});
		const off = resolveStoryBackgroundKinds(
			registry,
			readStoryBackgroundSwitches(store, "s1"),
		);
		expect(off).not.toContain("scene_log");
		// 归档依赖场记：场记关掉时归档开关打开也不运行。
		expect(off).not.toContain("scene_archive");
	});

	it("旧的 sceneLogEnabled 设置仍然能强制打开", () => {
		const store = openStory();
		store.updateStorySettings("s1", {
			featureTier: "lite",
			sceneLogEnabled: true,
		});
		const kinds = resolveStoryBackgroundKinds(
			createDefaultBackgroundJobRegistry(),
			readStoryBackgroundSwitches(store, "s1"),
		);
		expect(kinds).toContain("scene_log");
		expect(kinds).toContain("scene_archive");
	});
});

describe("其余接通的功能开关", () => {
	it("行动选项开关决定是否生成候选行动", () => {
		const store = openStory();
		const registry = createDefaultBackgroundJobRegistry();
		const on = resolveStoryBackgroundKinds(
			registry,
			readStoryBackgroundSwitches(store, "s1"),
		);
		expect(on).toContain("candidate_actions");
		store.updateStorySettings("s1", { featureSwitches: { choices: false } });
		const off = resolveStoryBackgroundKinds(
			registry,
			readStoryBackgroundSwitches(store, "s1"),
		);
		expect(off).not.toContain("candidate_actions");
	});

	it("伏笔上限跟随档位与玩家覆盖", () => {
		const store = openStory();
		expect(readStoryPromiseLimit(store, "s1")).toBe(5);
		store.updateStorySettings("s1", { featureTier: "lite" });
		expect(readStoryPromiseLimit(store, "s1")).toBe(3);
		store.updateStorySettings("s1", { featureSwitches: { promiseLimit: 8 } });
		expect(readStoryPromiseLimit(store, "s1")).toBe(8);
	});

	it("功能页标出哪些开关已经生效", () => {
		const store = openStory();
		addEntity(store);
		const switches = readStoryFeatureView(store, "s1").groups.flatMap(
			(group) => group.switches,
		);
		const wired = new Map(switches.map((item) => [item.id, item.wired]));
		expect(wired.get("scribe")).toBe(true);
		expect(wired.get("reunion")).toBe(true);
		expect(wired.get("choices")).toBe(true);
		// 出图以生图设置为准，不在功能页显示（ADR-0164）。
		expect(wired.has("draw")).toBe(false);
	});

	it("检索与工具查阅在标准档开、省档关；思考与原样兼容不在功能页显示", () => {
		const store = openStory();
		const standard = readStoryFeatureState(store, "s1").values;
		expect(standard.search).toBe(true);
		expect(standard.tools).toBe(true);
		store.updateStorySettings("s1", { featureTier: "lite" });
		const lite = readStoryFeatureState(store, "s1").values;
		expect(lite.search).toBe(false);
		expect(lite.tools).toBe(false);
		const ids = readStoryFeatureView(store, "s1").groups.flatMap((group) =>
			group.switches.map((item) => item.id),
		);
		expect(ids).not.toContain("think");
		expect(ids).not.toContain("raw");
	});

	it("全文检索关掉时记忆槽位为空", async () => {
		const store = openStory();
		const first = store.appendNode({
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "山门在夜里开着。",
		});
		const user = store.appendNode({
			storyId: "s1",
			parentId: first.id,
			role: "user",
			raw: "我推开山门。",
		});
		store.updateStorySettings("s1", { featureSwitches: { search: false } });
		const content = await createMemorySlotProvider(store).provide({
			slot: "memory",
			storyId: "s1",
			nodeId: user.id,
			switches: {},
			state: undefined,
		});
		expect(content).toBeNull();
	});
});
