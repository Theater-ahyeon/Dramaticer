import type {
	BlockDisplayStrategy,
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
	turnProgress: "turn.progress",
	draftReplace: "draft.replace",
	turnCommitted: "turn.committed",
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

export interface DisplayedText {
	readonly kind: "text";
	readonly text: string;
}

/** 可以 JSON 传输的块：解析时的注册表定义换成只看显示的字段。 */
export interface DisplayedBlock {
	readonly kind: "block";
	readonly name: string;
	readonly complete: boolean;
	readonly raw: string;
	readonly content: readonly DisplayedContent[];
	/** 块注册表给出的显示策略；没有策略时为 null，界面按原文显示。 */
	readonly display: BlockDisplayStrategy | null;
}

export type DisplayedContent = DisplayedText | DisplayedBlock;

/** 把解析结果摊平成显示载荷；块注册表在解析时已经挂到 `type` 上。 */
export function toDisplayedBlocks(
	items: readonly ParsedContent[],
): readonly DisplayedContent[] {
	return items.map((item): DisplayedContent => {
		if (item.kind === "text") return { kind: "text", text: item.text };
		return {
			kind: "block",
			name: item.name,
			complete: item.complete,
			raw: item.raw,
			content: toDisplayedBlocks(item.content),
			display: item.type.display,
		};
	});
}

export interface BlocksReplacePayload {
	readonly blocks: readonly DisplayedContent[];
}

export interface ToolCallPayload {
	readonly name: string;
	readonly ok: boolean;
}

/** 深回合执行工具前的阶段提示；同一阶段连续调用只发一次。 */
export interface TurnProgressPayload {
	readonly phase: string;
	readonly detail: string;
}

/** 深回合草稿整份替换后的快照；提交前不会写成楼层。 */
export interface DraftReplacePayload {
	readonly text: string;
	readonly version: number;
}

/** 草稿提交为助手楼层：模型调用提交工具，或运行结束自动提交。 */
export interface TurnCommittedPayload {
	readonly storyId: string;
	readonly runId: string;
	readonly nodeId: string;
	readonly blocks: readonly DisplayedContent[];
	readonly commit: "tool" | "auto";
}

export interface TurnCompletedPayload {
	readonly storyId: string;
	readonly userNode: TimelineNode;
	readonly node: TimelineNode;
	readonly blocks: readonly DisplayedContent[];
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
	"turn.progress": TurnProgressPayload;
	"draft.replace": DraftReplacePayload;
	"turn.committed": TurnCommittedPayload;
	"turn.completed": TurnCompletedPayload;
	"turn.error": TurnErrorPayload;
}

/** 一帧 SSE：event 字段与解析后的 JSON 数据。 */
export type SseEvent = {
	[N in SseEventName]: { readonly event: N; readonly data: SseEventMap[N] };
}[SseEventName];
