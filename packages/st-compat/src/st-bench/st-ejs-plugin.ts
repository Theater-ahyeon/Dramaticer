import type { CoexistPluginAdapter } from "./coexist.js";
import { buildStContentCoexistResult } from "./st-content-plugin.js";

export const ST_EJS_PLUGIN_ID = "st-ejs";

/**
 * `st-ejs` 在共存评测里的适配器。EJS 模板只存在于 ST 内容里，所以关闭组
 * 用同一份预设、世界书与角色卡的映射、只去掉模板执行，开启组再叠加 EJS
 * 流水线。两组输入相同，指标差异只来自模板执行与它带来的上下文变化。
 */
export const ST_EJS_COEXIST_PLUGIN: CoexistPluginAdapter = {
	id: ST_EJS_PLUGIN_ID,
	apply: (input) => buildStContentCoexistResult(input, { ejs: true }),
	baseline: (input) => buildStContentCoexistResult(input, { ejs: false }),
};
