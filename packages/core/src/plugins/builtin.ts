import type { PluginDefinition } from "./contracts.js";

/**
 * 内置插件清单：内核按数组顺序装载。P2.c 起把上下文槽位、Director 机制、
 * 块类型、后台任务与工具逐个改成插件定义加到这里。
 */
export const BUILTIN_PLUGINS: readonly PluginDefinition[] = [];
