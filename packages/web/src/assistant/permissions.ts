import type {
	AssistantConversationStatus,
	AssistantPermission,
	AssistantSkillId,
	AssistantThinking,
} from "@dramaticer/protocol";

export interface AssistantPermissionOption {
	readonly value: AssistantPermission;
	readonly label: string;
	readonly description: string;
}

/** 三级权限的界面文案；顺序与从宽松到严格的设置顺序无关，按限制从多到少排列。 */
export const ASSISTANT_PERMISSION_OPTIONS: readonly AssistantPermissionOption[] =
	[
		{
			value: "read_only",
			label: "只读",
			description: "只执行读取工具，提案与外部影响都不会发生",
		},
		{
			value: "confirm",
			label: "修改前确认",
			description: "提案写成待确认动作，批准后才执行",
		},
		{
			value: "auto",
			label: "自动执行",
			description: "不改变剧情内容的动作直接执行，其余仍然待确认",
		},
	];

export const ASSISTANT_THINKING_OPTIONS: readonly {
	readonly value: AssistantThinking;
	readonly label: string;
}[] = [
	{ value: "off", label: "不思考" },
	{ value: "low", label: "低强度" },
	{ value: "high", label: "高强度" },
];

/** 新会话的默认设置：排障技能、修改前确认、模型跟随 writer 岗位。 */
export interface AssistantConversationDefaults {
	readonly skill: AssistantSkillId;
	readonly permission: AssistantPermission;
	readonly modelAlias: null;
	readonly thinking: AssistantThinking;
}

export const ASSISTANT_CONVERSATION_DEFAULTS: AssistantConversationDefaults = {
	skill: "troubleshoot",
	permission: "confirm",
	modelAlias: null,
	thinking: "off",
};

export function permissionLabel(permission: AssistantPermission): string {
	const option = ASSISTANT_PERMISSION_OPTIONS.find(
		(item) => item.value === permission,
	);
	if (option === undefined) {
		throw new Error(`未知的助手权限：${permission}`);
	}
	return option.label;
}

export function thinkingLabel(thinking: AssistantThinking): string {
	const option = ASSISTANT_THINKING_OPTIONS.find(
		(item) => item.value === thinking,
	);
	if (option === undefined) {
		throw new Error(`未知的思考强度：${thinking}`);
	}
	return option.label;
}

const STATUS_LABELS: Readonly<Record<AssistantConversationStatus, string>> = {
	idle: "空闲",
	running: "运行中",
	completed: "已完成",
	failed: "失败",
	cancelled: "已取消",
	interrupted: "已中断",
};

export function conversationStatusLabel(
	status: AssistantConversationStatus,
): string {
	return STATUS_LABELS[status];
}

/** 运行中的会话才能取消；其他状态调用取消接口只会得到 409。 */
export function canCancel(status: AssistantConversationStatus): boolean {
	return status === "running";
}

/** 列表与徽标关心的事件状态：运行中、失败（含中断）与有未完成工作。 */
export function isAssistantFailure(
	status: AssistantConversationStatus,
): boolean {
	return status === "failed" || status === "interrupted";
}
