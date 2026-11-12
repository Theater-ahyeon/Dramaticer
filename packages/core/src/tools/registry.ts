import type { LlmToolDefinition } from "../llm/types.js";

/**
 * 工具权限级别：只读、只收集待提交写入、运行控制、有外部副作用。
 * 安装时的权限展示属于插件内核，这里只声明与执行。
 */
export const TOOL_PERMISSIONS = [
	"read",
	"propose",
	"control",
	"side_effect",
] as const;

export type ToolPermission = (typeof TOOL_PERMISSIONS)[number];

const TOOL_PERMISSION_SET: ReadonlySet<string> = new Set(TOOL_PERMISSIONS);

/** 深回合可用的工具定义：在模型看到的定义之上声明权限与进度阶段。 */
export interface DeepToolDefinition extends LlmToolDefinition {
	readonly permission: ToolPermission;
	/** 界面进度阶段文字，例如“回忆中……”。 */
	readonly progressLabel: string;
}

/** 执行工具前发给界面的进度事件。 */
export interface ToolProgressEvent {
	readonly type: "progress";
	readonly phase: string;
	readonly detail: string;
}

export function isToolPermission(value: unknown): value is ToolPermission {
	return typeof value === "string" && TOOL_PERMISSION_SET.has(value);
}

export function assertToolPermission(
	value: unknown,
	label: string,
): asserts value is ToolPermission {
	if (!isToolPermission(value)) {
		throw new Error(
			`${label} 只能是 ${TOOL_PERMISSIONS.join("、")}，收到 ${JSON.stringify(value)}`,
		);
	}
}

export interface DeepToolRegistry {
	readonly tools: readonly DeepToolDefinition[];
	get(name: string): DeepToolDefinition | undefined;
	has(name: string): boolean;
}

/**
 * 建立工具注册表：工具名必须唯一，权限必须是已声明级别，
 * 进度阶段文字不能为空。
 */
export function createDeepToolRegistry(
	definitions: readonly DeepToolDefinition[],
): DeepToolRegistry {
	const byName = new Map<string, DeepToolDefinition>();
	for (const tool of definitions) {
		if (typeof tool.name !== "string" || tool.name.trim().length === 0) {
			throw new Error("工具名必须是非空字符串");
		}
		assertToolPermission(
			tool.permission,
			`工具 ${tool.name} 的 permission`,
		);
		if (
			typeof tool.progressLabel !== "string" ||
			tool.progressLabel.trim().length === 0
		) {
			throw new Error(`工具 ${tool.name} 的 progressLabel 必须是非空字符串`);
		}
		if (byName.has(tool.name)) {
			throw new Error(`重复的工具名：${tool.name}`);
		}
		byName.set(tool.name, tool);
	}
	const tools = Object.freeze([...byName.values()]);
	return {
		tools,
		get: (name) => byName.get(name),
		has: (name) => byName.has(name),
	};
}
