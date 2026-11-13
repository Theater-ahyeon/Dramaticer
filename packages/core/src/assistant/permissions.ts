import type { JsonObject } from "../json.js";
import type { DeepToolDefinition, ToolPermission } from "../tools/registry.js";
import {
	type AssistantActionKind,
	canAutoExecuteAssistantAction,
} from "./actions.js";
import type { AssistantPermission } from "./types.js";

/**
 * 助手权限到工具权限的执行决定：
 * - `execute`：直接执行；
 * - `deny`：返回 `permission_denied` 工具结果并写事件；
 * - `pending`：调用照常执行，但工具只能生成待确认动作。
 */
export type AssistantToolDecision = "execute" | "deny" | "pending";

/**
 * 三级权限与四类工具权限的对应表。自动级别的 `side_effect` 仍然只生成
 * 待确认动作，具体工具再用 {@link canAutoExecuteAssistantAction} 判断是否能
 * 直接执行渠道这类不改变剧情内容的工作。
 */
export function decideAssistantToolExecution(
	permission: AssistantPermission,
	toolPermission: ToolPermission,
): AssistantToolDecision {
	if (toolPermission === "read") return "execute";
	switch (permission) {
		case "read_only":
			return "deny";
		case "confirm":
			return toolPermission === "control" ? "execute" : "pending";
		case "auto":
			return toolPermission === "control" ? "execute" : "pending";
	}
}

export interface AssistantToolRuntimeContext {
	readonly permission: AssistantPermission;
	readonly conversationId: string;
	/** 每次工具调用都回调；权限拒绝时也调用，方便写事件。 */
	readonly onToolCall?: (name: string, args: JsonObject) => void;
	readonly onToolResult?: (name: string, ok: boolean, content: string) => void;
	readonly onPermissionDenied?: (
		name: string,
		toolPermission: ToolPermission,
		reason: string,
	) => void;
}

/**
 * 按会话权限包装工具执行：只读级别拒绝只读以外的工具并把原因作为工具结果
 * 返回；其余级别照常执行，需要确认的工作由工具自己写成待确认动作。
 */
export function defineAssistantTool(
	context: AssistantToolRuntimeContext,
	definition: DeepToolDefinition,
): DeepToolDefinition {
	const { execute, ...rest } = definition;
	if (execute === undefined) {
		throw new Error(`助手工具 ${rest.name} 需要执行函数`);
	}
	return {
		...rest,
		// 深回合执行器只认 read/control/propose 的原生语义；助手权限已经
		// 在下面的 execute 里处理，暴露给它的一律是只读执行。
		permission: "read",
		execute: async (args: JsonObject): Promise<unknown> => {
			context.onToolCall?.(rest.name, args);
			const decision = decideAssistantToolExecution(
				context.permission,
				rest.permission,
			);
			if (decision === "deny") {
				const reason = permissionDeniedReason(
					context.permission,
					rest.permission,
					rest.name,
				);
				context.onPermissionDenied?.(rest.name, rest.permission, reason);
				context.onToolResult?.(rest.name, false, reason);
				return reason;
			}
			try {
				const content = await execute(args);
				const text =
					typeof content === "string" ? content : JSON.stringify(content);
				context.onToolResult?.(rest.name, true, text);
				return content;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				context.onToolResult?.(rest.name, false, `工具调用失败：${message}`);
				throw error;
			}
		},
	};
}

export function permissionDeniedReason(
	permission: AssistantPermission,
	toolPermission: ToolPermission,
	name: string,
): string {
	return `permission_denied：会话权限是 ${permission}，工具 ${name} 需要 ${toolPermission} 权限，本次调用被拒绝。`;
}

/**
 * 生成待确认动作前的最后一道检查：只读级别不允许生成，自动级别也要看
 * 动作种类是否属于可以直接执行的范畴。返回 null 表示可以继续。
 */
export function assistantActionGate(
	permission: AssistantPermission,
	kind: AssistantActionKind,
): "propose" | "execute" | "deny" {
	if (permission === "read_only") return "deny";
	if (permission === "auto" && canAutoExecuteAssistantAction(kind)) {
		return "execute";
	}
	return "propose";
}
