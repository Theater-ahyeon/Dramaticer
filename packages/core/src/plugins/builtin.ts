import type { PluginDefinition } from "./contracts.js";
import { SLOT_PLUGINS } from "./slots.js";

/**
 * 内置插件清单：内核按数组顺序装载。槽位插件需要运行环境提供存储与选项，
 * 缺配置的内置插件在快照里标为失败，不静默降级。
 */
export const BUILTIN_PLUGINS: readonly PluginDefinition[] = SLOT_PLUGINS;
