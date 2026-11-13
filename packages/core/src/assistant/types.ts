import type { JsonObject, JsonValue } from "../json.js";

/**
 * 应用内助手的权限级别。只读只执行读取工具；确认级别把有外部影响的调用
 * 写成待确认动作；自动级别可以直接执行不改变剧情内容的工作。
 */
export const ASSISTANT_PERMISSIONS = ["read_only", "confirm", "auto"] as const;

export type AssistantPermission = (typeof ASSISTANT_PERMISSIONS)[number];

export const ASSISTANT_CONVERSATION_STATUSES = [
	"idle",
	"running",
	"completed",
	"failed",
	"cancelled",
	"interrupted",
] as const;

export type AssistantConversationStatus =
	(typeof ASSISTANT_CONVERSATION_STATUSES)[number];

/** 会话级思考强度；与渠道推理等级分开，避免把内部的完整枚举暴露给界面。 */
export const ASSISTANT_THINKING_LEVELS = ["off", "low", "high"] as const;

export type AssistantThinking = (typeof ASSISTANT_THINKING_LEVELS)[number];

export const ASSISTANT_MESSAGE_ROLES = [
	"user",
	"assistant",
	"tool",
	"system",
] as const;

export type AssistantMessageRole = (typeof ASSISTANT_MESSAGE_ROLES)[number];

/**
 * 助手事件种类。事件表只追加：同一会话内按 `seq` 严格递增，
 * 已写入的事件不能修改；会话删除时随会话一起删除。
 */
export const ASSISTANT_EVENT_KINDS = [
	"started",
	"text.delta",
	"thinking.delta",
	"tool.call",
	"tool.result",
	"usage",
	"completed",
	"error",
] as const;

export type AssistantEventKind = (typeof ASSISTANT_EVENT_KINDS)[number];

export const DEFAULT_ASSISTANT_CONTEXT_BUDGET = 48_000;
export const DEFAULT_ASSISTANT_COMPACTION_THRESHOLD = 0.8;
export const MIN_ASSISTANT_COMPACTION_THRESHOLD = 0.5;
export const MAX_ASSISTANT_COMPACTION_THRESHOLD = 0.95;
export const DEFAULT_ASSISTANT_PERMISSION: AssistantPermission = "confirm";
export const DEFAULT_ASSISTANT_THINKING: AssistantThinking = "off";
export const DEFAULT_ASSISTANT_TITLE = "新会话";
export const DEFAULT_ASSISTANT_LIST_LIMIT = 20;
export const MAX_ASSISTANT_LIST_LIMIT = 100;

/** 一个助手会话；`storyId` 为空表示不关联故事（使用指南、设置向导）。 */
export interface AssistantConversation {
	readonly id: string;
	readonly storyId: string | null;
	readonly skill: string;
	readonly title: string;
	readonly permission: AssistantPermission;
	readonly status: AssistantConversationStatus;
	/** 为空时使用 `roles.writer` 解析到的模型。 */
	readonly modelAlias: string | null;
	readonly thinking: AssistantThinking;
	readonly contextBudget: number;
	readonly compactionThreshold: number;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly lastMessageAt: string | null;
}

/** 会话内的一条消息；`ordinal` 在同一会话里从 1 开始递增。 */
export interface AssistantMessage {
	readonly conversationId: string;
	readonly ordinal: number;
	readonly role: AssistantMessageRole;
	readonly text: string;
	/** 只有工具消息有工具名。 */
	readonly toolName: string | null;
	/** 工具结果的原始 JSON；只有工具消息有。 */
	readonly toolResult: JsonValue | null;
	/** 模型用量；只有助手消息有。 */
	readonly usage: JsonObject | null;
	readonly createdAt: string;
}

export interface AssistantEvent {
	readonly conversationId: string;
	readonly seq: number;
	readonly kind: AssistantEventKind;
	readonly payload: JsonObject;
	readonly createdAt: string;
}

export interface NewAssistantConversationInput {
	readonly id?: string;
	readonly storyId?: string | null;
	readonly skill: string;
	readonly title?: string;
	readonly permission?: AssistantPermission;
	readonly modelAlias?: string | null;
	readonly thinking?: AssistantThinking;
	readonly contextBudget?: number;
	readonly compactionThreshold?: number;
	readonly createdAt?: string;
}

/** 只修改提供的字段；`modelAlias` 显式传 null 表示恢复默认模型。 */
export interface AssistantConversationUpdate {
	readonly title?: string;
	readonly skill?: string;
	readonly permission?: AssistantPermission;
	readonly modelAlias?: string | null;
	readonly thinking?: AssistantThinking;
	readonly contextBudget?: number;
	readonly compactionThreshold?: number;
}

export interface NewAssistantMessageInput {
	readonly conversationId: string;
	readonly role: AssistantMessageRole;
	readonly text: string;
	readonly toolName?: string | null;
	readonly toolResult?: JsonValue;
	readonly usage?: JsonObject;
	readonly createdAt?: string;
}

export interface ListAssistantConversationsOptions {
	readonly storyId?: string;
	readonly skill?: string;
	readonly limit?: number;
}

export interface AssistantConversationSearchOptions {
	readonly storyId?: string;
	readonly limit?: number;
}

export interface AssistantSearchHit {
	readonly conversation: AssistantConversation;
	readonly matchedIn: "title" | "message";
	readonly snippet: string;
	/** 命中消息的序号；标题命中为 null。 */
	readonly messageOrdinal: number | null;
	/** FTS5 的 bm25 原始分数，越小越相关；标题命中为 0。 */
	readonly score: number;
}

export interface ListAssistantEventsOptions {
	/** 只返回序号大于它的记录；默认 0。 */
	readonly afterSeq?: number;
}

/** 列表与搜索的条数：1 到 100，默认 20。 */
export function assertAssistantListLimit(
	value: unknown,
	label: string,
): asserts value is number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 1 ||
		value > MAX_ASSISTANT_LIST_LIMIT
	) {
		throw new Error(
			`${label} 必须是 1 到 ${MAX_ASSISTANT_LIST_LIMIT} 之间的整数：${String(value)}`,
		);
	}
}

export function isAssistantPermission(
	value: unknown,
): value is AssistantPermission {
	return (
		typeof value === "string" &&
		(ASSISTANT_PERMISSIONS as readonly string[]).includes(value)
	);
}

export function assertAssistantPermission(
	value: unknown,
	label: string,
): asserts value is AssistantPermission {
	if (!isAssistantPermission(value)) {
		throw new Error(`${label} 不是助手权限级别：${String(value)}`);
	}
}

export function isAssistantConversationStatus(
	value: unknown,
): value is AssistantConversationStatus {
	return (
		typeof value === "string" &&
		(ASSISTANT_CONVERSATION_STATUSES as readonly string[]).includes(value)
	);
}

export function assertAssistantConversationStatus(
	value: unknown,
	label: string,
): asserts value is AssistantConversationStatus {
	if (!isAssistantConversationStatus(value)) {
		throw new Error(`${label} 不是助手会话状态：${String(value)}`);
	}
}

export function isAssistantThinking(
	value: unknown,
): value is AssistantThinking {
	return (
		typeof value === "string" &&
		(ASSISTANT_THINKING_LEVELS as readonly string[]).includes(value)
	);
}

export function assertAssistantThinking(
	value: unknown,
	label: string,
): asserts value is AssistantThinking {
	if (!isAssistantThinking(value)) {
		throw new Error(`${label} 不是助手思考强度：${String(value)}`);
	}
}

export function isAssistantMessageRole(
	value: unknown,
): value is AssistantMessageRole {
	return (
		typeof value === "string" &&
		(ASSISTANT_MESSAGE_ROLES as readonly string[]).includes(value)
	);
}

export function assertAssistantMessageRole(
	value: unknown,
	label: string,
): asserts value is AssistantMessageRole {
	if (!isAssistantMessageRole(value)) {
		throw new Error(`${label} 不是助手消息角色：${String(value)}`);
	}
}

export function isAssistantEventKind(
	value: unknown,
): value is AssistantEventKind {
	return (
		typeof value === "string" &&
		(ASSISTANT_EVENT_KINDS as readonly string[]).includes(value)
	);
}

export function assertAssistantEventKind(
	value: unknown,
	label: string,
): asserts value is AssistantEventKind {
	if (!isAssistantEventKind(value)) {
		throw new Error(`${label} 不是助手事件种类：${String(value)}`);
	}
}

/** 上下文预算必须是正整数 token 数。 */
export function assertAssistantContextBudget(
	value: unknown,
	label: string,
): asserts value is number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`${label} 必须是大于等于 1 的整数：${String(value)}`);
	}
}

/** 压缩阈值限定在 0.5 到 0.95，避免刚开聊就压缩或永不压缩。 */
export function assertAssistantCompactionThreshold(
	value: unknown,
	label: string,
): asserts value is number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < MIN_ASSISTANT_COMPACTION_THRESHOLD ||
		value > MAX_ASSISTANT_COMPACTION_THRESHOLD
	) {
		throw new Error(
			`${label} 必须在 ${MIN_ASSISTANT_COMPACTION_THRESHOLD} 到 ${MAX_ASSISTANT_COMPACTION_THRESHOLD} 之间：${String(value)}`,
		);
	}
}
