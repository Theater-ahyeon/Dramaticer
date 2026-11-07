import type { StateDiffOp } from "../timeline.js";

/** 结构化输出的传输方式：函数调用或文本标签。 */
export type StructuredOutputMode = "function-call" | "text-tags";

/** 本模块负责校验的两类写入负载。 */
export type StructuredPayloadName = "state_update" | "plot_note";

/** 通过校验的状态变更，字段与 StateDiff 对齐。 */
export interface AcceptedStateUpdate {
	readonly path: readonly string[];
	readonly op: StateDiffOp;
	/** op 为 set 时是任意 JSON 值（可以是 null）；op 为 delete 时为 null。 */
	readonly value: unknown;
	readonly reason: string | null;
}

export interface AcceptedPlotNote {
	readonly text: string;
}

export type ValidatedPayload =
	| { readonly name: "state_update"; readonly value: AcceptedStateUpdate }
	| { readonly name: "plot_note"; readonly value: AcceptedPlotNote };

export type StructuredPayloadValidation =
	| { readonly ok: true; readonly payload: ValidatedPayload }
	| { readonly ok: false; readonly reason: string };

export interface StructuredOutputIssue {
	readonly payload: StructuredPayloadName;
	/** 被拒绝的负载：工具调用的参数对象，或标签里解析出的值（解析失败时是原文）。 */
	readonly raw: unknown;
	readonly reason: string;
}

export interface StructuredOutputCollection {
	readonly mode: StructuredOutputMode;
	readonly stateUpdates: readonly AcceptedStateUpdate[];
	readonly notes: readonly AcceptedPlotNote[];
	readonly issues: readonly StructuredOutputIssue[];
}
