/**
 * 深回合的界面常量。core 是 Node 侧包，浏览器不能 import 它的运行时值；
 * `packages/web/test/deep-turn.test.ts` 与 core 的同名导出逐项比对，防止漂移。
 */

/** 深回合工具在界面上的顺序与文字；顺序跟 core 的 `DEEP_TURN_TOOLS` 一致。 */
export const DEEP_TURN_TOOL_OPTIONS: readonly {
	readonly value: string;
	readonly label: string;
}[] = [
	{ value: "memory_search", label: "回忆中……（memory_search）" },
	{ value: "lore_lookup", label: "查阅设定……（lore_lookup）" },
	{ value: "state_get", label: "读取状态……（state_get）" },
	{ value: "ledger_read", label: "读取台账……（ledger_read）" },
	{ value: "history_read", label: "翻阅历史……（history_read）" },
	{ value: "note_read", label: "翻看手记……（note_read）" },
	{ value: "ledger_write", label: "整理台账……（ledger_write）" },
	{ value: "note_write", label: "记录手记……（note_write）" },
	{ value: "draft_write", label: "整理草稿……（draft_write）" },
	{ value: "commit_draft", label: "提交正文……（commit_draft）" },
	{ value: "rule_check", label: "执行检定……（rule_check）" },
];

export const DEEP_TURN_TOOL_NAMES: readonly string[] =
	DEEP_TURN_TOOL_OPTIONS.map((option) => option.value);

export const NOTE_TURN_TOOL_NAMES: readonly string[] = [
	"note_read",
	"note_write",
];

export const DEEP_MAX_TOOL_CALLS_RANGE = { minimum: 1, maximum: 200 } as const;
export const DEEP_TIMEOUT_MS_RANGE = {
	minimum: 60_000,
	maximum: 3_600_000,
} as const;
export const DEEP_CONTEXT_TOKEN_MINIMUM = 1;
export const DEEP_RECENT_TOOL_STEPS_RANGE = {
	minimum: 1,
	maximum: 20,
} as const;
