import { BLOCK_TYPE_PLUGINS } from "./block-types.js";
import type { PluginDefinition } from "./contracts.js";
import { MECHANISM_PLUGINS } from "./mechanisms.js";
import { SLOT_PLUGINS } from "./slots.js";

/**
 * 内置插件清单：内核按数组顺序装载。机制与块类型是静态插件，
 * 没有配置与依赖；槽位插件需要运行环境提供存储与选项，缺配置的内置插件
 * 在快照里标为失败。
 */
export const BUILTIN_PLUGINS: readonly PluginDefinition[] = [
	...MECHANISM_PLUGINS,
	...BLOCK_TYPE_PLUGINS,
	...SLOT_PLUGINS,
];
