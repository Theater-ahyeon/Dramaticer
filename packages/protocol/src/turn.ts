import type {
	DirectorIntensity,
	LlmUsage,
	ParsedContent,
	PlotNote,
	StateDiff,
	TimelineNode,
	TurnMode,
	TurnTrace,
} from "@dramaticer/core";
import type { ApiErrorBody } from "./errors.js";

export interface TurnRequest {
	readonly text: string;
	/** 单轮模式；省略时使用故事设置的 `turnMode`。 */
	readonly mode?: TurnMode;
	/** 单轮导演强度；省略时使用导演配置的强度。 */
	readonly intensity?: DirectorIntensity;
}

/** SSE 的 event 字段取值；客户端按这些名字分发。 */
export const SSE_EVENT_NAMES = {
	turnStarted: "turn.started",
	textDelta: "text.delta",
	thinkingDelta: "thinking.delta",
	blocksReplace: "blocks.replace",
	toolCall: "tool.call",
	turnCompleted: "turn.completed",
	turnError: "turn.error",
} as const;

export type SseEventName =
	(typeof SSE_EVENT_NAMES)[keyof typeof SSE_EVENT_NAMES];

export interface TurnStartedPayload {
	readonly storyId: string;
	readonly userNodeId: string;
}

export interface TextDeltaPayload {
	readonly delta: string;
}

export interface ThinkingDeltaPayload {
	readonly delta: string;
}

export interface BlocksReplacePayload {
	readonly blocks: readonly ParsedContent[];
}

export interface ToolCallPayload {
	readonly name: string;
	readonly ok: boolean;
}

export interface TurnCompletedPayload {
	readonly storyId: string;
	readonly userNode: TimelineNode;
	readonly node: TimelineNode;
	readonly stateDiffs: readonly StateDiff[];
	readonly plotNotes: readonly PlotNote[];
	readonly usage: LlmUsage;
	readonly trace: TurnTrace;
	readonly firstTokenMs: number | null;
}

export type TurnErrorPayload = ApiErrorBody;

export interface SseEventMap {
	"turn.started": TurnStartedPayload;
	"text.delta": TextDeltaPayload;
	"thinking.delta": ThinkingDeltaPayload;
	"blocks.replace": BlocksReplacePayload;
	"tool.call": ToolCallPayload;
	"turn.completed": TurnCompletedPayload;
	"turn.error": TurnErrorPayload;
}

/** 一帧 SSE：event 字段与解析后的 JSON 数据。 */
export type SseEvent = {
	[N in SseEventName]: { readonly event: N; readonly data: SseEventMap[N] };
}[SseEventName];
