import { describe, expect, it } from "vitest";
import {
	BLOCK_TYPE_PLUGINS,
	DEFAULT_BLOCK_TYPES,
	DEFAULT_BLOCK_TYPE_KERNEL,
	DEFAULT_DIRECTOR_CONFIG,
	DEFAULT_MECHANISM_KERNEL,
	MECHANISM_PLUGINS,
	type PluginDefinition,
	type StoryStore,
	blockTypeRegistryFromKernel,
	createPluginKernel,
	evaluateDirector,
	parseBlocks,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const MECHANISM_NAMES = [
	"clue",
	"opening",
	"beat",
	"repetition",
	"event_pool",
	"pacing",
];

describe("内置 Director 机制插件", () => {
	it("每个机制都有注册表条目且评估顺序与改动前一致", () => {
		expect(
			DEFAULT_MECHANISM_KERNEL.mechanisms().map(({ name }) => name),
		).toEqual(MECHANISM_NAMES);
		expect(DEFAULT_MECHANISM_KERNEL.snapshot().mechanisms).toEqual(
			MECHANISM_NAMES,
		);
		expect(MECHANISM_PLUGINS.map(({ name }) => name)).toEqual([
			"mechanism.clue",
			"mechanism.opening",
			"mechanism.beat",
			"mechanism.repetition",
			"mechanism.event-pool",
			"mechanism.pacing",
		]);
	});

	it("缺省评估与显式传入内核机制得到同一条建议", () => {
		const { store } = openTempStore();
		seedStory(store);
		const chain = buildChain(store, 14);
		store.insertPlotNotes([
			{ id: "clue1", storyId: "s1", sourceNodeId: "n0", text: "井底的人影" },
		]);
		const nodeId = chain[13] as string;

		const explicit = evaluateDirector({
			store,
			storyId: "s1",
			nodeId,
			config: DEFAULT_DIRECTOR_CONFIG,
			mechanisms: DEFAULT_MECHANISM_KERNEL.mechanisms(),
		});
		const implicit = evaluateDirector({
			store,
			storyId: "s1",
			nodeId,
			config: DEFAULT_DIRECTOR_CONFIG,
		});

		expect(implicit).toEqual(explicit);
		expect(implicit?.mechanism).toBe("clue");
	});

	it("重复注册机制失败且回滚同一插件已经注册的条目", async () => {
		const clue = pluginAt(MECHANISM_PLUGINS, 0);
		const opening = pluginAt(MECHANISM_PLUGINS, 1);
		const kernel = await createPluginKernel({ plugins: [clue] });
		const duplicate: PluginDefinition = {
			name: "test.duplicate-mechanism",
			apply(context) {
				context.directorMechanism(opening.mechanism);
				context.directorMechanism(clue.mechanism);
			},
		};

		const status = await kernel.load(duplicate);

		expect(status.state).toBe("failed");
		expect(status.reason).toContain("重复注册：clue");
		expect(kernel.mechanisms().map(({ name }) => name)).toEqual(["clue"]);
		await kernel.dispose();
	});
});

describe("内置块类型插件", () => {
	it("每个块类型都有注册表条目且顺序与改动前一致", () => {
		const names = DEFAULT_BLOCK_TYPES.map(({ name }) => name);
		expect(names).toEqual([
			"thinking",
			"选项",
			"状态栏",
			"变量更新",
			"分析",
			"图片",
			"页眉",
			"悄悄话",
			"旁白",
			"备忘",
			"state_update",
			"plot_note",
		]);
		expect(DEFAULT_BLOCK_TYPE_KERNEL.blockTypes()).toEqual(names);
		expect(BLOCK_TYPE_PLUGINS.map(({ name }) => name)).toHaveLength(
			names.length,
		);
	});

	it("解析器缺省块类型来自内核注册表", () => {
		const items = parseBlocks(
			"<页眉>序章</页眉><选项>甲</选项><未知>乙</未知>",
		);

		expect(items.map((item) => item.kind)).toEqual(["block", "block", "text"]);
		expect(items[0]?.kind === "block" ? items[0].name : null).toBe("页眉");
		expect(items[1]?.kind === "block" ? items[1].name : null).toBe("选项");
	});

	it("重复注册块类型失败且回滚同一插件已经注册的条目", async () => {
		const thinking = pluginAt(BLOCK_TYPE_PLUGINS, 0);
		const options = pluginAt(BLOCK_TYPE_PLUGINS, 1);
		const kernel = await createPluginKernel({ plugins: [options] });
		const duplicate: PluginDefinition = {
			name: "test.duplicate-block",
			apply(context) {
				context.blockType(thinking.definition);
				context.blockType(options.definition);
			},
		};

		const status = await kernel.load(duplicate);

		expect(status.state).toBe("failed");
		expect(status.reason).toContain("块类型重复注册：选项");
		expect(kernel.blockTypes()).toEqual(["选项"]);
		await kernel.dispose();
	});

	it("卸载块类型插件后该类型不再进入解析器", async () => {
		const options = pluginAt(BLOCK_TYPE_PLUGINS, 1);
		const header = pluginAt(BLOCK_TYPE_PLUGINS, 6);
		const kernel = await createPluginKernel({
			plugins: [options, header],
		});
		await kernel.unload(options.name);
		const registry = blockTypeRegistryFromKernel(kernel);

		const items = parseBlocks("<页眉>序章</页眉><选项>甲</选项>", { registry });

		expect(items.map((item) => item.kind)).toEqual(["block", "text"]);
		await kernel.dispose();
	});
});

function pluginAt<T>(plugins: readonly T[], index: number): T {
	const plugin = plugins[index];
	if (plugin === undefined) {
		throw new Error(`缺少下标 ${index} 的内置插件`);
	}
	return plugin;
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "插件机制" });
}

function buildChain(store: StoryStore, length: number): string[] {
	const ids: string[] = [];
	for (let index = 0; index < length; index += 1) {
		const id = `n${index}`;
		store.appendNode({
			id,
			storyId: "s1",
			parentId: index === 0 ? null : `n${index - 1}`,
			role: index % 2 === 0 ? "assistant" : "user",
			raw: `楼层 ${index}`,
		});
		ids.push(id);
	}
	return ids;
}
