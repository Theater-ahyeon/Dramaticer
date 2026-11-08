/** 自动试玩每一轮与每次操作记录的类型；报告由这些记录派生。 */

export const PLAYTEST_OPERATION_KINDS = ["swipe", "edit", "branch"] as const;

export type PlaytestOperationKind = (typeof PLAYTEST_OPERATION_KINDS)[number];

/** 四种偏好信号；条数从 `preference_events` 读出。 */
export const PLAYTEST_PREFERENCE_KINDS = [
	"swipe",
	"choice",
	"edit",
	"card_decision",
] as const;

export type PlaytestPreferenceKind = (typeof PLAYTEST_PREFERENCE_KINDS)[number];

export interface PlaytestScheduleView {
	readonly swipeAt: readonly number[];
	readonly editAt: readonly number[];
	readonly branchAt: readonly number[];
	readonly candidateAt: readonly number[];
	readonly optionAt: readonly number[];
}

export interface PlaytestOperationRecord {
	readonly kind: PlaytestOperationKind;
	readonly round: number;
	readonly stepId: string;
	readonly fromNodeId: string;
	readonly toNodeId: string;
	/** 操作生成的正文；编辑与重新生成各有自己的文本。 */
	readonly text: string | null;
}

export interface PlaytestUsage {
	readonly promptTokens: number | null;
	readonly completionTokens: number | null;
	readonly totalTokens: number | null;
	readonly reasoningTokens: number | null;
}

export interface PlaytestMechanismRecord {
	readonly name: string;
	readonly triggered: boolean;
	readonly reason: string;
}

export interface PlaytestDirectorRecord {
	readonly directive: string | null;
	readonly mechanisms: readonly PlaytestMechanismRecord[];
}

export interface PlaytestCandidateRecord {
	readonly count: number;
	readonly visible: boolean;
	/** 本轮点击后填入输入框的候选文本；没有点击时为 null。 */
	readonly pickedText: string | null;
}

export interface PlaytestBackgroundRecord {
	readonly pending: number;
	readonly running: number;
	readonly failed: number;
}

export interface PlaytestRoundRecord {
	readonly kind: "round";
	readonly round: number;
	readonly userNodeId: string;
	readonly assistantNodeId: string;
	/** 读 Trace 的楼层；编辑产生的楼层没有 Trace。 */
	readonly traceNodeId: string | null;
	readonly user: string;
	readonly assistant: string;
	readonly turnMode: string;
	readonly firstTokenMs: number | null;
	readonly durationMs: number;
	readonly usage: PlaytestUsage;
	readonly ledgerDiffCount: number;
	readonly newClueIds: readonly string[];
	readonly fulfilledClueIds: readonly string[];
	/** 兑现时距首次出现的轮数；早于本次试玩的线索不计入。 */
	readonly fulfilledClueAges: readonly number[];
	readonly director: PlaytestDirectorRecord | null;
	readonly candidateActions: PlaytestCandidateRecord | null;
	/** 开场候选只在第一轮记录；之后面板已经不再显示。 */
	readonly openingCandidates: PlaytestCandidateRecord | null;
	readonly operations: readonly PlaytestOperationRecord[];
	readonly background: PlaytestBackgroundRecord | null;
	readonly screenshot: string;
	readonly createdAt: string;
}

export interface PlaytestFailureRecord {
	readonly kind: "failure";
	readonly round: number;
	readonly stepId: string;
	readonly error: string;
	readonly screenshot: string;
	readonly createdAt: string;
}

export type PlaytestRecord = PlaytestRoundRecord | PlaytestFailureRecord;

export interface PlaytestRunMeta {
	readonly rounds: number;
	readonly viewport: string;
	readonly writerModel: string;
	readonly backgroundModel: string;
	readonly schedule: PlaytestScheduleView;
	readonly startedAt: string;
	readonly finishedAt: string;
}

export interface PlaytestPreferenceCounts {
	readonly swipe: number;
	readonly choice: number;
	readonly edit: number;
	readonly card_decision: number;
}

export interface PlaytestRunResult {
	readonly meta: PlaytestRunMeta;
	readonly records: readonly PlaytestRecord[];
	readonly preferenceCounts: PlaytestPreferenceCounts;
}

export function isPlaytestRoundRecord(
	record: PlaytestRecord,
): record is PlaytestRoundRecord {
	return record.kind === "round";
}

export function isPlaytestFailureRecord(
	record: PlaytestRecord,
): record is PlaytestFailureRecord {
	return record.kind === "failure";
}
