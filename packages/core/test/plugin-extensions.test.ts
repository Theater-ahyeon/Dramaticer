import { describe, expect, it } from "vitest";
import {
	BLOCK_TYPE_PLUGINS,
	DEFAULT_BLOCK_TYPES,
	DEFAULT_BLOCK_TYPE_KERNEL,
	type PluginDefinition,
	blockTypeRegistryFromKernel,
	createPluginKernel,
	parseBlocks,
} from "../src/index.js";

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
