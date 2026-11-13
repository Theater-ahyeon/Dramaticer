import type {
	AssistantConversation,
	AssistantConversationStatus,
	AssistantEvent,
	AssistantMessage,
	AssistantPermission,
	AssistantThinking,
	JsonObject,
	JsonValue,
	LlmUsage,
} from "@dramaticer/core";

/** 应用内助手的技能 id；未注册的技能在创建会话时被拒绝。 */
export const ASSISTANT_SKILL_IDS = [
	"troubleshoot",
	"ledger_revision",
	"strategy",
	"research",
	"card_workshop",
	"setup_wizard",
	"guide",
] as const;

export type AssistantSkillId = (typeof ASSISTANT_SKILL_IDS)[number];

export function isAssistantSkillId(value: unknown): value is AssistantSkillId {
	return (
		typeof value === "string" &&
		(ASSISTANT_SKILL_IDS as readonly string[]).includes(value)
	);
}

/** 会话与消息的响应形状与 core 的领域类型一致，界面直接使用。 */
export type AssistantConversationView = AssistantConversation;
export type AssistantMessageView = AssistantMessage;
export type AssistantEventView = AssistantEvent;
export type {
	AssistantConversationStatus,
	AssistantPermission,
	AssistantThinking,
} from "@dramaticer/core";

/** `POST /api/assistant/conversations` 的请求体。 */
export interface CreateAssistantConversationRequest {
	/** 省略表示不关联故事。 */
	readonly storyId?: string | null;
	readonly skill: AssistantSkillId;
	/** 省略时使用默认标题。 */
	readonly title?: string;
	readonly permission?: AssistantPermission;
	readonly modelAlias?: string | null;
	readonly thinking?: AssistantThinking;
	readonly contextBudget?: number;
	readonly compactionThreshold?: number;
}

/** `PATCH /api/assistant/conversations/:id` 的请求体；只修改提供的字段。 */
export interface UpdateAssistantConversationRequest {
	readonly title?: string;
	readonly skill?: AssistantSkillId;
	readonly permission?: AssistantPermission;
	readonly modelAlias?: string | null;
	readonly thinking?: AssistantThinking;
	readonly contextBudget?: number;
	readonly compactionThreshold?: number;
}

/** 一次搜索命中；检索词出现在标题或消息正文里，片段已经带标记。 */
export interface AssistantConversationMatch {
	readonly matchedIn: "title" | "message";
	readonly snippet: string;
	/** 命中消息的序号；标题命中为 null。 */
	readonly messageOrdinal: number | null;
	/** FTS5 的 bm25 原始分数，越小越相关；标题命中为 0。 */
	readonly score: number;
}

/**
 * `GET /api/assistant/conversations` 的响应。带 `query` 时 `matches` 与
 * `conversations` 一一对应；不带查询词时省略。
 */
export interface AssistantConversationListView {
	readonly conversations: readonly AssistantConversationView[];
	readonly matches?: readonly AssistantConversationMatch[];
}

/** `GET /api/assistant/conversations/:id` 的响应：会话与全部消息。 */
export interface AssistantConversationDetailView {
	readonly conversation: AssistantConversationView;
	readonly messages: readonly AssistantMessageView[];
}

/** `GET /api/assistant/conversations/:id/status` 的响应。 */
export interface AssistantConversationStatusView {
	readonly conversationId: string;
	readonly status: AssistantConversationStatus;
	/** 已写入的最后一个事件序号；没有事件时为 0。 */
	readonly lastEventSeq: number;
	readonly updatedAt: string;
	readonly lastMessageAt: string | null;
}

/** `GET /api/assistant/conversations/:id/events?after=<seq>` 的响应。 */
export interface AssistantConversationEventsView {
	readonly conversationId: string;
	readonly after: number;
	/** 读取后已经写入的最后一个事件序号，用作下一次续读的起点。 */
	readonly lastSeq: number;
	readonly events: readonly AssistantEventView[];
}

/** 助手事件种类的载荷；运行时写库与 SSE 推送共用这套形状。 */
export interface AssistantStartedPayload {
	readonly conversationId: string;
	readonly skill: string;
}

export interface AssistantTextDeltaPayload {
	readonly delta: string;
}

export interface AssistantThinkingDeltaPayload {
	readonly delta: string;
}

export interface AssistantToolCallPayload {
	readonly name: string;
	readonly arguments: JsonObject;
}

export interface AssistantToolResultPayload {
	readonly name: string;
	readonly ok: boolean;
	readonly result: JsonValue;
}

export interface AssistantUsagePayload {
	readonly usage: LlmUsage;
}

export interface AssistantCompletedPayload {
	readonly status: AssistantConversationStatus;
}

export interface AssistantErrorPayload {
	readonly message: string;
}

export interface AssistantEventPayloadMap {
	readonly started: AssistantStartedPayload;
	readonly "text.delta": AssistantTextDeltaPayload;
	readonly "thinking.delta": AssistantThinkingDeltaPayload;
	readonly "tool.call": AssistantToolCallPayload;
	readonly "tool.result": AssistantToolResultPayload;
	readonly usage: AssistantUsagePayload;
	readonly completed: AssistantCompletedPayload;
	readonly error: AssistantErrorPayload;
}
