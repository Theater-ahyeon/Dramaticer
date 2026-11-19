import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	StoryStore,
	createDefaultBackgroundJobRegistry,
	readStoryBackgroundSwitches,
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
