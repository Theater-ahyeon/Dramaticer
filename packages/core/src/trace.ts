import type { TurnMode } from "./chat/mode.js";
import type { ChatProfile } from "./chat/profile.js";
import type { ContextTrace } from "./context/assembler.js";
import type { LlmModelRole, LlmToolTransport } from "./llm/channels.js";
import type {
	LlmStopReason,
	LlmTruncationReason,
	LlmUsage,
} from "./llm/types.js";
import type { TurnHookTraceEntry } from "./plugins/turn-hooks.js";
import type { TurnRunStatus } from "./run-log.js";
import type {
	StructuredOutputIssue,
	StructuredOutputMode,
} from "./structured/types.js";
import type { ToolPermission } from "./tools/registry.js";

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
	/** 本次调用的权限级别；未注册的工具为 null。 */
	readonly permission: ToolPermission | null;
}

/** 文本协议里被拒绝、没有执行的工具调用。 */
export interface TurnTraceToolRejection {
	readonly name: string;
	readonly reason: string;
}

export interface TurnTraceTools {
	/** 工具调用使用的传输方式：原生函数调用或文本协议。 */
	readonly transport: LlmToolTransport;
	/** 实际执行工具的轮数。 */
	readonly rounds: number;
	/** 快回合每轮读取工具的软上限；深回合按工具调用总次数收束。 */
	readonly maxRounds: number;
	/** 模型在软上限处仍请求工具，本轮按上限收束。 */
	readonly capped: boolean;
	/** 每次工具调用的结果与权限级别，按调用顺序；参数非法的调用也记录。 */
	readonly calls: readonly TurnTraceToolCall[];
	/** 被拒绝、没有执行的工具调用；只记录未知工具名。 */
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

/** 深回合的收束原因；快回合不写这一段。 */
export const DEEP_TURN_STOP_REASONS = [
	"completed",
	"max_tool_calls",
	"timeout",
	"aborted",
	"error",
] as const;

export type DeepTurnStopReason = (typeof DEEP_TURN_STOP_REASONS)[number];

const DEEP_TURN_STOP_REASON_SET: ReadonlySet<string> = new Set(
	DEEP_TURN_STOP_REASONS,
);

export function isDeepTurnStopReason(
	value: unknown,
): value is DeepTurnStopReason {
	return typeof value === "string" && DEEP_TURN_STOP_REASON_SET.has(value);
}

/** 深回合每次请求前对工具往返做的成对省略。 */
export interface TurnTraceDeepContextOmitted {
	/** 省略的工具往返对数。 */
	readonly pairs: number;
	/** 省略的消息条数。 */
	readonly messages: number;
	/** 省略消息的估算 token 数。 */
	readonly tokens: number;
	readonly reason: "context_limit";
}

/** 深回合的防失控上限与运行结果；快回合为 null。 */
export interface TurnTraceDeep {
	readonly maxToolCalls: number;
	readonly maxDurationMs: number;
	/** 实际执行的工具调用次数。 */
	readonly toolCallCount: number;
	readonly durationMs: number;
	readonly stopReason: DeepTurnStopReason;
	/** 楼层怎么来的：模型调用提交工具、运行结束自动提交，或没有提交。 */
	readonly commit: "tool" | "auto" | "none";
	/** 正常结束但没有调用提交工具时记为 missing_commit；其余为 null。 */
	readonly drift: "missing_commit" | null;
	/** 工具往返的成对省略；没有省略时不写这一段。 */
	readonly contextOmitted?: TurnTraceDeepContextOmitted;
}

/** 本轮对应的运行日志；快回合不写运行表，为 null。 */
export interface TurnTraceRun {
	readonly runId: string;
	/** 运行结束时的状态。 */
	readonly status: TurnRunStatus;
	/** 这次运行写入的事件条数。 */
	readonly eventCount: number;
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
	/** 深回合的上限与收束原因；快回合为 null。 */
	readonly deep: TurnTraceDeep | null;
	/** 本轮运行日志；快回合为 null。 */
	readonly run: TurnTraceRun | null;
	/**
	 * 回合内钩子的耗时与跳过原因；没有被计时的钩子时没有这个字段。
	 * 超时跳过的提供者按缺失槽位处理，回合继续。
	 */
	readonly hooks?: readonly TurnHookTraceEntry[];
}
