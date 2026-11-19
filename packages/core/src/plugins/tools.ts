import { COMMIT_DRAFT_TOOL, DRAFT_WRITE_TOOL } from "../tools/draft-tools.js";
import { NOTE_WRITE_TOOL } from "../tools/note-tools.js";
import { DEEP_ONLY_READ_TOOLS, READ_TOOLS } from "../tools/read-tools.js";
import {
	type DeepToolDefinition,
	type DeepToolRegistry,
	type ToolPhase,
	createDeepToolRegistry,
} from "../tools/registry.js";
import { RULE_CHECK_TOOL } from "../tools/rule-tools.js";
import {
	FILE_PATCH_TOOL,
	FILE_READ_TOOL,
	FILE_SEARCH_TOOL,
	FILE_WRITE_TOOL,
} from "../tools/workspace-tools.js";
import { LEDGER_WRITE_TOOL } from "../tools/write-tools.js";
import type { PluginDefinition, PluginKernel } from "./contracts.js";
import { createStaticKernel } from "./static-kernel.js";

/** 内置工具插件：每个插件向内核注册一个模型可调用的工具。 */
export interface ToolPlugin extends PluginDefinition {
	readonly definition: DeepToolDefinition;
	readonly phases: readonly ToolPhase[];
}

export const MEMORY_SEARCH_TOOL_PLUGIN = "tool.memory-search";
export const LORE_LOOKUP_TOOL_PLUGIN = "tool.lore-lookup";
export const STATE_GET_TOOL_PLUGIN = "tool.state-get";
export const LEDGER_READ_TOOL_PLUGIN = "tool.ledger-read";
export const HISTORY_READ_TOOL_PLUGIN = "tool.history-read";
export const NOTE_READ_TOOL_PLUGIN = "tool.note-read";
export const LEDGER_WRITE_TOOL_PLUGIN = "tool.ledger-write";
export const NOTE_WRITE_TOOL_PLUGIN = "tool.note-write";
export const DRAFT_WRITE_TOOL_PLUGIN = "tool.draft-write";
export const COMMIT_DRAFT_TOOL_PLUGIN = "tool.commit-draft";
export const FILE_READ_TOOL_PLUGIN = "tool.file-read";
export const FILE_SEARCH_TOOL_PLUGIN = "tool.file-search";
export const FILE_WRITE_TOOL_PLUGIN = "tool.file-write";
export const FILE_PATCH_TOOL_PLUGIN = "tool.file-patch";
export const RULE_CHECK_TOOL_PLUGIN = "tool.rule-check";

function toolPlugin(
	plugin: string,
	definition: DeepToolDefinition,
	phases: readonly ToolPhase[],
): ToolPlugin {
	return {
		name: plugin,
		definition,
		phases,
		apply(context) {
			context.tool(definition, phases);
		},
	};
}

function toolByName(
	tools: readonly DeepToolDefinition[],
	name: string,
): DeepToolDefinition {
	const found = tools.find((tool) => tool.name === name);
	if (found === undefined) {
		throw new Error(`找不到内置工具定义：${name}`);
	}
	return found;
}

/** 内置工具；顺序即注册顺序，深回合按这个顺序暴露给模型。 */
export const TOOL_PLUGINS: readonly ToolPlugin[] = [
	toolPlugin(
		MEMORY_SEARCH_TOOL_PLUGIN,
		toolByName(READ_TOOLS, "memory_search"),
		["fast", "deep"],
	),
	toolPlugin(LORE_LOOKUP_TOOL_PLUGIN, toolByName(READ_TOOLS, "lore_lookup"), [
		"fast",
		"deep",
	]),
	toolPlugin(STATE_GET_TOOL_PLUGIN, toolByName(READ_TOOLS, "state_get"), [
		"fast",
		"deep",
	]),
	toolPlugin(LEDGER_READ_TOOL_PLUGIN, toolByName(READ_TOOLS, "ledger_read"), [
		"fast",
		"deep",
	]),
	toolPlugin(
		HISTORY_READ_TOOL_PLUGIN,
		toolByName(DEEP_ONLY_READ_TOOLS, "history_read"),
		["deep"],
	),
	toolPlugin(
		NOTE_READ_TOOL_PLUGIN,
		toolByName(DEEP_ONLY_READ_TOOLS, "note_read"),
		["deep"],
	),
	toolPlugin(LEDGER_WRITE_TOOL_PLUGIN, LEDGER_WRITE_TOOL, ["deep"]),
	toolPlugin(NOTE_WRITE_TOOL_PLUGIN, NOTE_WRITE_TOOL, ["deep"]),
	toolPlugin(FILE_READ_TOOL_PLUGIN, FILE_READ_TOOL, ["deep"]),
	toolPlugin(FILE_SEARCH_TOOL_PLUGIN, FILE_SEARCH_TOOL, ["deep"]),
	toolPlugin(FILE_WRITE_TOOL_PLUGIN, FILE_WRITE_TOOL, ["deep"]),
	toolPlugin(FILE_PATCH_TOOL_PLUGIN, FILE_PATCH_TOOL, ["deep"]),
	toolPlugin(DRAFT_WRITE_TOOL_PLUGIN, DRAFT_WRITE_TOOL, ["deep"]),
	toolPlugin(COMMIT_DRAFT_TOOL_PLUGIN, COMMIT_DRAFT_TOOL, ["deep"]),
	toolPlugin(RULE_CHECK_TOOL_PLUGIN, RULE_CHECK_TOOL, ["fast", "deep"]),
];

/** 只装载内置工具的内核；工具注册表从这里读出。 */
export const DEFAULT_TOOL_KERNEL: PluginKernel =
	createStaticKernel(TOOL_PLUGINS);

/** 从内核当前注册表读出某个回合模式的工具。 */
export function toolRegistryFromKernel(
	kernel: PluginKernel,
	phase: ToolPhase,
): DeepToolRegistry {
	return createDeepToolRegistry(kernel.tools(phase));
}

/**
 * 建立工具注册表：每个插件都必须装载成功，避免缺失的工具被静默省略。
 */
export function createToolRegistryFromPlugins(
	plugins: readonly ToolPlugin[],
	phase: ToolPhase,
): DeepToolRegistry {
	const kernel = createStaticKernel(plugins);
	for (const plugin of plugins) {
		const status = kernel.status(plugin.name);
		if (status.state !== "active") {
			throw new Error(
				`工具插件 ${plugin.name} 没有激活：${status.reason ?? "未知原因"}`,
			);
		}
	}
	return createDeepToolRegistry(kernel.tools(phase));
}

/** 缺省工具注册表；工具插件装载失败时直接抛错。 */
export function defaultToolRegistry(phase: ToolPhase): DeepToolRegistry {
	return createToolRegistryFromPlugins(TOOL_PLUGINS, phase);
}
