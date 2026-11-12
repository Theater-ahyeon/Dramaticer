import type {
	JsonObject,
	TurnRunEvent,
	TurnRunEventKind,
	TurnRunStatus,
} from "@dramaticer/core";
import type { NodeRunView } from "@dramaticer/protocol";

const EVENT_LABELS: Readonly<Record<TurnRunEventKind, string>> = {
	"model.request": "模型请求",
	"model.response": "模型响应",
	"tool.call": "工具调用",
	"tool.result": "工具结果",
	"draft.replace": "草稿替换",
	"draft.commit": "草稿提交",
	steering: "追加要求",
	limit: "达到上限",
	error: "错误",
};

const STATUS_LABELS: Readonly<Record<TurnRunStatus, string>> = {
	running: "进行中",
	completed: "已完成",
	interrupted: "已中断",
	failed: "失败",
	aborted: "已中止",
};

const PERMISSION_LABELS: Readonly<Record<string, string>> = {
	read: "读取",
	propose: "收集写入",
	control: "控制草稿",
	side_effect: "侧效应",
};

const LIMIT_REASONS: Readonly<Record<string, string>> = {
	timeout: "运行时长上限",
	max_tool_calls: "工具调用次数上限",
	max_read_rounds: "读取工具轮数上限",
};

const TRANSPORT_LABELS: Readonly<Record<string, string>> = {
	native: "原生工具调用",
	text: "文本协议",
};

export interface RunTimelineRow {
	readonly seq: number;
	readonly kind: TurnRunEventKind;
	readonly label: string;
	readonly detail: string;
	readonly at: string;
}

export interface RunTimelineView {
	readonly runId: string;
	readonly status: TurnRunStatus;
	readonly statusLabel: string;
	readonly rows: readonly RunTimelineRow[];
	/** 中断、失败与中止时停在哪一步；正常完成或仍在进行时为 null。 */
	readonly stoppedAt: string | null;
	readonly eventCount: number;
}

/** 运行事件的时间线按 `seq` 升序；存储层只追加，序号在运行内唯一。 */
export function sortRunEvents(
	events: readonly TurnRunEvent[],
): readonly TurnRunEvent[] {
	return [...events].sort((left, right) => left.seq - right.seq);
}

export function describeRunStatus(status: TurnRunStatus): string {
	return STATUS_LABELS[status];
}

/** 一条运行事件的标题与可读细节；载荷里没有的字段不显示。 */
export function describeRunEvent(event: TurnRunEvent): RunTimelineRow {
	return {
		seq: event.seq,
		kind: event.kind,
		label: EVENT_LABELS[event.kind],
		detail: describePayload(event.kind, event.payload),
		at: event.createdAt,
	};
}

export function buildRunTimeline(view: NodeRunView): RunTimelineView {
	const rows = sortRunEvents(view.events).map(describeRunEvent);
	const final =
		view.run.status === "completed" || view.run.status === "running"
			? null
			: describeStop(rows.at(-1));
	return {
		runId: view.run.runId,
		status: view.run.status,
		statusLabel: describeRunStatus(view.run.status),
		rows,
		stoppedAt: final,
		eventCount: rows.length,
	};
}

function describeStop(row: RunTimelineRow | undefined): string | null {
	if (row === undefined) return "没有任何运行事件";
	return row.detail.length === 0
		? `第 ${row.seq} 步：${row.label}`
		: `第 ${row.seq} 步：${row.label}（${row.detail}）`;
}

function describePayload(kind: TurnRunEventKind, payload: JsonObject): string {
	switch (kind) {
		case "model.request":
			return joinParts([
				describeRound(payload.round),
				stringOf(payload.model) ?? "默认模型",
				numberOf(payload.messages) === null
					? null
					: `${numberOf(payload.messages)} 条消息`,
				numberOf(payload.tools) === null
					? null
					: `${numberOf(payload.tools)} 个工具`,
				TRANSPORT_LABELS[stringOf(payload.transport) ?? ""] ?? null,
			]);
		case "model.response":
			return joinParts([
				describeRound(payload.round),
				stringOf(payload.stopReason) ?? null,
				numberOf(payload.textLength) === null
					? null
					: `${numberOf(payload.textLength)} 字`,
				totalTokensOf(payload.usage),
				numberOf(payload.durationMs) === null
					? null
					: `${numberOf(payload.durationMs)} 毫秒`,
			]);
		case "tool.call":
			return joinParts([
				describeRound(payload.round),
				stringOf(payload.name) ?? "未知工具",
				PERMISSION_LABELS[stringOf(payload.permission) ?? ""] ?? null,
			]);
		case "tool.result": {
			const ok = payload.ok === true;
			const error = stringOf(payload.error);
			return joinParts([
				describeRound(payload.round),
				stringOf(payload.name) ?? "未知工具",
				ok ? "成功" : "失败",
				!ok && error !== null ? error : null,
				numberOf(payload.resultLength) === null
					? null
					: `${numberOf(payload.resultLength)} 字`,
			]);
		}
		case "draft.replace":
			return joinParts([
				numberOf(payload.version) === null
					? null
					: `第 ${numberOf(payload.version)} 版`,
				numberOf(payload.textLength) === null
					? null
					: `${numberOf(payload.textLength)} 字`,
			]);
		case "draft.commit":
			return joinParts([
				numberOf(payload.version) === null
					? null
					: `第 ${numberOf(payload.version)} 版`,
				numberOf(payload.textLength) === null
					? null
					: `${numberOf(payload.textLength)} 字`,
				stringOf(payload.method) === "auto" ? "自动提交" : "工具提交",
			]);
		case "steering":
			return numberOf(payload.textLength) === null
				? ""
				: `追加 ${numberOf(payload.textLength)} 字`;
		case "limit":
			return describeLimit(payload);
		case "error":
			return joinParts([stringOf(payload.message), stringOf(payload.reason)]);
	}
}

function describeLimit(payload: JsonObject): string {
	const reason = stringOf(payload.reason) ?? "";
	const label = LIMIT_REASONS[reason] ?? reason;
	return joinParts([
		label.length === 0 ? null : label,
		numberOf(payload.maxToolCalls) === null
			? null
			: `上限 ${numberOf(payload.maxToolCalls)} 次`,
		numberOf(payload.maxDurationMs) === null
			? null
			: `上限 ${numberOf(payload.maxDurationMs)} 毫秒`,
		numberOf(payload.maxReadRounds) === null
			? null
			: `上限 ${numberOf(payload.maxReadRounds)} 轮`,
		numberOf(payload.durationMs) === null
			? null
			: `已运行 ${numberOf(payload.durationMs)} 毫秒`,
	]);
}

function describeRound(value: unknown): string | null {
	return numberOf(value) === null ? null : `第 ${numberOf(value)} 次`;
}

function totalTokensOf(value: unknown): string | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const total = numberOf((value as JsonObject).totalTokens);
	return total === null ? null : `${total} token`;
}

function numberOf(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOf(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function joinParts(parts: readonly (string | null)[]): string {
	return parts.filter((part): part is string => part !== null).join(" · ");
}
