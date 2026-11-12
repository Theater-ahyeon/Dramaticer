import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	DECLARATIVE_PLUGIN_FORMAT,
	DECLARATIVE_PLUGIN_FORMAT_VERSION,
	PLAYPACK_FORMAT,
	PLAYPACK_FORMAT_VERSION,
	type PlaypackManifest,
	StoryStore,
	parsePlaypackManifest,
	resolveStoryPlugins,
} from "../src/index.js";

const KNOWN = ["slot.memory", "slot.summary", "slot.lore"];

function skillPlugin(name: string): Record<string, unknown> {
	return {
		format: DECLARATIVE_PLUGIN_FORMAT,
		formatVersion: DECLARATIVE_PLUGIN_FORMAT_VERSION,
		name,
		version: "1.0.0",
		kind: "skill",
		payload: { name: "剑法", description: "说明", content: "正文" },
	};
}

function pack(): PlaypackManifest {
	return parsePlaypackManifest({
		format: PLAYPACK_FORMAT,
		formatVersion: PLAYPACK_FORMAT_VERSION,
		name: "xianxia",
		version: "1.0.0",
		plugins: [skillPlugin("xianxia.core"), skillPlugin("xianxia.extra")],
		config: {
			"slot.memory": { limit: 20, nested: { a: 1, b: 2 } },
			"xianxia.core": { tone: "包默认" },
		},
	});
}

function openStore(): {
	store: StoryStore;
	path: string;
	close: () => void;
} {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-story-plugins-"));
	const path = join(dir, "story.db");
	const store = StoryStore.open(path);
	let open = true;
	const close = () => {
		if (!open) return;
		store.close();
		open = false;
	};
	onTestFinished(() => {
		close();
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return { store, path, close };
}

describe("故事级插件状态", () => {
	it("覆盖与开关保存后重新打开仍然保留，分支切换不改变", () => {
		const { store, path, close } = openStore();
		store.createStory({ id: "s1", title: "山门" });
		const root = store.appendNode({
			storyId: "s1",
			parentId: null,
			role: "user",
			raw: "开始",
		});
		const first = store.appendNode({
			storyId: "s1",
			parentId: root.id,
			role: "assistant",
			raw: "甲",
		});
		const second = store.appendNode({
			storyId: "s1",
			parentId: root.id,
			role: "assistant",
			raw: "乙",
		});
		store.updateStorySettings("s1", {
			pluginOverrides: {
				config: {
					"slot.memory": { limit: 8, nested: { a: 3 } },
					"xianxia.core": { tone: "故事覆盖" },
				},
				switches: { "xianxia.extra": false, "slot.summary": false },
			},
		});
		const expected = resolveStoryPlugins([pack()], {
			knownPluginNames: KNOWN,
			overrides: store.getStorySettings("s1").pluginOverrides,
		});
		expect(expected.plugins.map((plugin) => plugin.name)).toEqual([
			"xianxia.core",
		]);
		expect(expected.configs["slot.memory"]).toEqual({
			limit: 8,
			nested: { a: 3, b: 2 },
		});
		expect(expected.configs["xianxia.core"]).toEqual({ tone: "故事覆盖" });
		expect(expected.configs["xianxia.extra"]).toBeUndefined();
		expect(expected.disabledPlugins).toEqual(["xianxia.extra", "slot.summary"]);

		close();
		const reopened = StoryStore.open(path);
		try {
			for (const head of [first, second]) {
				reopened.setHead("s1", head.id);
				const settings = reopened.getStorySettings("s1");
				expect(settings.pluginOverrides).toEqual({
					config: {
						"slot.memory": { limit: 8, nested: { a: 3 } },
						"xianxia.core": { tone: "故事覆盖" },
					},
					switches: { "xianxia.extra": false, "slot.summary": false },
				});
				expect(
					resolveStoryPlugins([pack()], {
						knownPluginNames: KNOWN,
						overrides: settings.pluginOverrides,
					}),
				).toEqual(expected);
			}
		} finally {
			reopened.close();
		}
	});

	it("不同故事各自保存，未覆盖的故事使用包默认值", () => {
		const { store } = openStore();
		store.createStory({ id: "s1", title: "山门" });
		store.createStory({ id: "s2", title: "海港" });
		store.updateStorySettings("s1", {
			pluginOverrides: { switches: { "slot.summary": false } },
		});
		expect(store.getStorySettings("s2").pluginOverrides).toEqual({
			config: {},
			switches: {},
		});
		const second = resolveStoryPlugins([pack()], {
			knownPluginNames: KNOWN,
			overrides: store.getStorySettings("s2").pluginOverrides,
		});
		expect(second.plugins.map((plugin) => plugin.name)).toEqual([
			"xianxia.core",
			"xianxia.extra",
		]);
		expect(second.configs["slot.memory"]).toEqual({
			limit: 20,
			nested: { a: 1, b: 2 },
		});
		expect(second.disabledPlugins).toEqual([]);
	});
});
