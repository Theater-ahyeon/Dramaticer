import type { TurnMode } from "./chat/mode.js";
import type { JsonObject } from "./json.js";

export const TURN_RUN_STATUSES = [
	"running",
	"completed",
	"interrupted",
	"failed",
	"aborted",
] as const;

export type TurnRunStatus = (typeof TURN_RUN_STATUSES)[number];

/** 运行结束后允许写入的状态。 */
export const TURN_RUN_FINAL_STATUSES = [
	"completed",
	"interrupted",
	"failed",
	"aborted",
] as const;

export type TurnRunFinalStatus = (typeof TURN_RUN_FINAL_STATUSES)[number];

/**
 * 运行事件的种类。事件表只追加：同一运行内按 `seq` 严格递增，
 * 已写入的事件不能修改或删除。
 */
export const TURN_RUN_EVENT_KINDS = [
	"model.request",
	"model.response",
	"tool.call",
	"tool.result",
	"draft.replace",
	"draft.commit",
	"steering",
	"limit",
	"error",
] as const;

export type TurnRunEventKind = (typeof TURN_RUN_EVENT_KINDS)[number];

/** 一次深回合运行：从第一次请求开始，到楼层提交、失败或中止结束。 */
export interface TurnRunRecord {
	readonly runId: string;
	readonly storyId: string;
	readonly userNodeId: string;
	/** 提交后的助手楼层；失败或中止且没有楼层时为 null。 */
	readonly nodeId: string | null;
	readonly mode: TurnMode;
	readonly status: TurnRunStatus;
	readonly startedAt: string;
	readonly finishedAt: string | null;
}

export interface TurnRunEvent {
	readonly runId: string;
	readonly seq: number;
	readonly kind: TurnRunEventKind;
	readonly payload: JsonObject;
	readonly createdAt: string;
}

export interface TurnRunDetail {
	readonly run: TurnRunRecord;
	readonly events: readonly TurnRunEvent[];
}

/** 执行器交给存储层的一条事件；`seq` 与时间由存储层补齐。 */
export interface TurnRunEventInput {
	readonly kind: TurnRunEventKind;
	readonly payload: JsonObject;
}

export function isTurnRunStatus(value: unknown): value is TurnRunStatus {
	return (
		typeof value === "string" &&
		(TURN_RUN_STATUSES as readonly string[]).includes(value)
	);
}

export function isTurnRunFinalStatus(
	value: unknown,
): value is TurnRunFinalStatus {
	return (
		typeof value === "string" &&
		(TURN_RUN_FINAL_STATUSES as readonly string[]).includes(value)
	);
}

export function isTurnRunEventKind(value: unknown): value is TurnRunEventKind {
	return (
		typeof value === "string" &&
		(TURN_RUN_EVENT_KINDS as readonly string[]).includes(value)
	);
}

export function assertTurnRunEventKind(
	value: unknown,
	label: string,
): asserts value is TurnRunEventKind {
	if (!isTurnRunEventKind(value)) {
		throw new Error(`${label} 不是运行事件种类：${String(value)}`);
	}
}
