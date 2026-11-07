import type { ContextTrace } from "./context/assembler.js";
import type {
	LlmStopReason,
	LlmTruncationReason,
	LlmUsage,
} from "./llm/types.js";
import type {
	StructuredOutputIssue,
	StructuredOutputMode,
} from "./structured/types.js";

export interface TurnTraceLlm {
	readonly model: string;
	readonly channel: string | null;
	readonly stopReason: LlmStopReason;
	readonly finishReason: string | null;
	readonly truncation: LlmTruncationReason | null;
	readonly usage: LlmUsage;
	readonly attempts: number;
	readonly rounds: number;
	readonly cached: boolean;
}

export interface TurnTraceStructuredOutput {
	readonly mode: StructuredOutputMode;
	readonly acceptedStateUpdates: number;
	readonly acceptedNotes: number;
	readonly issues: readonly StructuredOutputIssue[];
}

export interface TurnTraceTiming {
	/** 第一个正文增量到达的毫秒数；没有正文时为 null。 */
	readonly firstTokenMs: number | null;
	readonly durationMs: number;
}

/** 一轮生成的完整记录，按楼层节点存放。 */
export interface TurnTrace {
	readonly storyId: string;
	readonly nodeId: string;
	readonly parentNodeId: string | null;
	readonly templateId: string;
	readonly createdAt: string;
	readonly context: ContextTrace;
	readonly llm: TurnTraceLlm;
	readonly structured: TurnTraceStructuredOutput;
	readonly timing: TurnTraceTiming;
}
