import { DEEP_ONLY_READ_TOOLS, READ_TOOLS } from "./read-tools.js";
import { createDeepToolRegistry } from "./registry.js";
import { LEDGER_WRITE_TOOL } from "./write-tools.js";

export * from "./read-tools.js";
export * from "./registry.js";
export * from "./write-tools.js";

/** 快回合可用的工具：公共只读工具，加上按配置启用的侧效应工具。 */
export const FAST_TURN_TOOLS = createDeepToolRegistry(READ_TOOLS);

/** 深回合可用的工具：公共只读、历史回溯与台账写入。 */
export const DEEP_TURN_TOOLS = createDeepToolRegistry([
	...READ_TOOLS,
	...DEEP_ONLY_READ_TOOLS,
	LEDGER_WRITE_TOOL,
]);
