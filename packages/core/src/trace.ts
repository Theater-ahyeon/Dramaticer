import type { TurnMode } from "./chat/mode.js";
import type { ChatProfile } from "./chat/profile.js";
import type { ContextTrace } from "./context/assembler.js";
import type { LlmModelRole, LlmToolTransport } from "./llm/channels.js";
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
	/** 这一轮使用的模型角色；正文生成为 writer。 */
	readonly role: LlmModelRole;
	readonly model: string;
	readonly channel: string | null;
	readonly stopReason: LlmStopReason;
	readonly finishReason: string | null;
	/** 检出的全部截断原因；没有截断时为空数组。 */
	readonly truncations: readonly LlmTruncationReason[];
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

export interface TurnTraceToolCall {
	readonly name: string;
	readonly ok: boolean;
	/** 失败原因；成功时为 null。 */
	readonly error: string | null;
}

/** 文本协议里被拒绝、没有执行的工具调用。 */
export interface TurnTraceToolRejection {
	readonly name: string;
	readonly reason: string;
}

export interface TurnTraceTools {
	/** 工具调用使用的传输方式：原生函数调用或文本协议。 */
	readonly transport: LlmToolTransport;
	/** 实际执行的读取工具轮数。 */
	readonly rounds: number;
	/** 每轮读取工具的软上限；快回合默认 3。 */
	readonly maxRounds: number;
	/** 模型在软上限处仍请求读取工具，本轮按上限收束。 */
	readonly capped: boolean;
	/** 每次读取工具调用的结果，按调用顺序；参数非法的调用也记录。 */
	readonly calls: readonly TurnTraceToolCall[];
	/** 文本协议里被拒绝的工具调用；原生传输下为空数组。 */
	readonly rejected: readonly TurnTraceToolRejection[];
}

export interface TurnTraceImages {
	/** 本楼接受的出图登记数。 */
	readonly accepted: number;
	/** 被拒绝的 illustrate 调用原因，按调用顺序。 */
	readonly rejected: readonly string[];
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
	/** 本轮的回合模式；由玩家选择，程序不自动切换。 */
	readonly turnMode: TurnMode;
	/** 本轮的对话档位：native 使用全部槽位，naive 是 B0 基线。 */
	readonly profile: ChatProfile;
	readonly createdAt: string;
	readonly context: ContextTrace;
	readonly llm: TurnTraceLlm;
	readonly tools: TurnTraceTools;
	readonly structured: TurnTraceStructuredOutput;
	readonly images?: TurnTraceImages;
	readonly timing: TurnTraceTiming;
}
