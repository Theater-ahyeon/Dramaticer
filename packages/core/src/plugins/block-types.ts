import { IMAGE_BLOCK_TEMPLATE } from "../blocks/templates.js";
import type {
	BlockTypeDefinition,
	BlockTypeRegistry,
} from "../blocks/types.js";
import { createBlockTypeRegistry } from "../blocks/types.js";
import type { PluginDefinition, PluginKernel } from "./contracts.js";
import { createStaticKernel } from "./static-kernel.js";

/** 内置块类型插件：每个插件向内核注册一个块类型。 */
export interface BlockTypePlugin extends PluginDefinition {
	readonly definition: BlockTypeDefinition;
}

function blockTypePlugin(
	plugin: string,
	definition: BlockTypeDefinition,
): BlockTypePlugin {
	return {
		name: plugin,
		definition,
		apply(context) {
			context.blockType(definition);
		},
	};
}

/** DESIGN §6 的原生协议块与 §11 的写入类文本标签；顺序即注册顺序。 */
export const BLOCK_TYPE_PLUGINS: readonly BlockTypePlugin[] = [
	blockTypePlugin("block.thinking", {
		name: "thinking",
		display: { kind: "hidden" },
		context: { kind: "drop" },
		semantics: { kind: "none" },
	}),
	blockTypePlugin("block.options", {
		name: "选项",
		display: { kind: "native", component: "options" },
		context: { kind: "keep" },
		semantics: { kind: "none" },
	}),
	blockTypePlugin("block.status", {
		name: "状态栏",
		display: { kind: "native", component: "status" },
		context: { kind: "keep" },
		semantics: { kind: "none" },
	}),
	blockTypePlugin("block.variables", {
		name: "变量更新",
		display: { kind: "hidden" },
		context: { kind: "drop" },
		semantics: { kind: "none" },
	}),
	blockTypePlugin("block.analysis", {
		name: "分析",
		display: { kind: "native", component: "analysis" },
		context: { kind: "keep" },
		semantics: { kind: "none" },
	}),
	blockTypePlugin("block.image", {
		name: "图片",
		display: { kind: "html", template: IMAGE_BLOCK_TEMPLATE },
		context: { kind: "keep" },
		semantics: { kind: "none" },
	}),
	blockTypePlugin("block.header", {
		name: "页眉",
		display: { kind: "native", component: "header" },
		context: { kind: "keep" },
		semantics: { kind: "none" },
	}),
	blockTypePlugin("block.whisper", {
		name: "悄悄话",
		display: { kind: "native", component: "whisper" },
		context: { kind: "keep" },
		semantics: { kind: "none" },
	}),
	blockTypePlugin("block.narration", {
		name: "旁白",
		display: { kind: "native", component: "narration" },
		context: { kind: "keep" },
		semantics: { kind: "none" },
	}),
	blockTypePlugin("block.memo", {
		name: "备忘",
		display: { kind: "native", component: "memo" },
		context: { kind: "keep" },
		semantics: { kind: "none" },
	}),
	blockTypePlugin("block.state-update", {
		name: "state_update",
		display: { kind: "hidden" },
		context: { kind: "drop" },
		semantics: { kind: "none" },
	}),
	blockTypePlugin("block.plot-note", {
		name: "plot_note",
		display: { kind: "hidden" },
		context: { kind: "drop" },
		semantics: { kind: "none" },
	}),
];

/** 内置块类型定义，顺序与注册顺序一致。 */
export const DEFAULT_BLOCK_TYPES: readonly BlockTypeDefinition[] =
	BLOCK_TYPE_PLUGINS.map((plugin) => plugin.definition);

/** 只装载内置块类型的内核；解析器的缺省块类型从这里取。 */
export const DEFAULT_BLOCK_TYPE_KERNEL: PluginKernel =
	createStaticKernel(BLOCK_TYPE_PLUGINS);

/** 按内核注册顺序读出块类型并复用 core 的块类型校验。 */
export function blockTypeRegistryFromKernel(
	kernel: PluginKernel,
): BlockTypeRegistry {
	const types = kernel.blockTypes().map((name) => {
		const definition = kernel.blockType(name);
		if (definition === null) {
			throw new Error(`块类型注册表缺少 ${name}`);
		}
		return definition;
	});
	return createBlockTypeRegistry(types);
}

/** 缺省块类型注册表；解析器与历史视图在没有传块类型时按内核当前注册读取。 */
export function defaultBlockTypeRegistry(): BlockTypeRegistry {
	return blockTypeRegistryFromKernel(DEFAULT_BLOCK_TYPE_KERNEL);
}
