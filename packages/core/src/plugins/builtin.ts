import { BACKGROUND_JOB_PLUGINS } from "./background-jobs.js";
import { BLOCK_TYPE_PLUGINS } from "./block-types.js";
import type { PluginDefinition } from "./contracts.js";
import { SLOT_PLUGINS } from "./slots.js";
import { TOOL_PLUGINS } from "./tools.js";

/**
 * 内置插件清单：内核按数组顺序装载。块类型、工具与后台任务类型是
 * 静态插件，没有配置与依赖；槽位插件需要运行环境提供存储与选项，缺配置的
 * 内置插件在快照里标为失败。
 */
export const BUILTIN_PLUGINS: readonly PluginDefinition[] = [
	...BLOCK_TYPE_PLUGINS,
	...TOOL_PLUGINS,
	...BACKGROUND_JOB_PLUGINS,
	...SLOT_PLUGINS,
];
