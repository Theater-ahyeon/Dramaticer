import { defaultToolRegistry } from "../plugins/tools.js";

export * from "./draft-tools.js";
export * from "./note-tools.js";
export * from "./read-tools.js";
export * from "./registry.js";
export * from "./write-tools.js";

/** 快回合可用的工具：内置工具插件里开放给快回合的那些。 */
export const FAST_TURN_TOOLS = defaultToolRegistry("fast");

/** 深回合可用的工具：公共只读、历史回溯、台账写入、手记与草稿控制。 */
export const DEEP_TURN_TOOLS = defaultToolRegistry("deep");
