import type {
	DeepTurnStopReason,
	JsonObject,
	JsonValue,
	LlmUsage,
} from "@dramaticer/core";
import {
	ASSISTANT_SSE_EVENT_NAMES,
	type AssistantConversationStatus,
	type AssistantEventView,
	type AssistantSseEventMap,
	type AssistantSseEventName,
} from "@dramaticer/protocol";
import { type RawSseEvent, parseNamedSseStream } from "../api/sse";

export type AssistantSseEvent = {
	readonly [K in AssistantSseEventName]: {
		readonly event: K;
		readonly data: AssistantSseEventMap[K];
	};
}[AssistantSseEventName];

const ASSISTANT_EVENT_NAMES: ReadonlySet<string> = new Set(
	Object.values(ASSISTANT_SSE_EVENT_NAMES),
);

/** 一次运行里的一次工具调用；结果按名字与最近一条未配对的调用配对。 */
export interface AssistantToolActivity {
	readonly name: string;
	readonly arguments: JsonObject | null;
	readonly ok: boolean | null;
	readonly result: JsonValue | null;
	/** 被权限拒绝时的权限级别；正常调用为 null。 */
	readonly deniedPermission: string | null;
	readonly reason: string | null;
}

/**
 * 当前运行的增量视图。`lastSeq` 是已经应用过的最后一个持久事件序号；
 * 续读时只用它作起点，不会把同一段正文应用两次。
 */
export interface AssistantRunState {
	readonly text: string;
	readonly thinking: string;
	readonly tools: readonly AssistantToolActivity[];
	readonly usage: LlmUsage | null;
	readonly status: AssistantConversationStatus | null;
	readonly stopReason: DeepTurnStopReason | null;
	readonly error: string | null;
	readonly lastSeq: number;
}

export function createAssistantRunState(lastSeq = 0): AssistantRunState {
	return {
		text: "",
		thinking: "",
		tools: [],
		usage: null,
		status: null,
		stopReason: null,
		error: null,
		lastSeq,
	};
}

/** 一次新运行开始时清空正文、工具与错误，保留续读水位。 */
export function resetAssistantRunState(
	state: AssistantRunState,
): AssistantRunState {
	return createAssistantRunState(state.lastSeq);
}

export function applyAssistantSseEvent(
	state: AssistantRunState,
	event: AssistantSseEvent,
): AssistantRunState {
	switch (event.event) {
		case "assistant.started":
			return {
				...resetAssistantRunState(state),
				status: "running",
			};
		case "assistant.text.delta":
			return { ...state, text: state.text + event.data.delta };
		case "assistant.thinking.delta":
			return { ...state, thinking: state.thinking + event.data.delta };
		case "assistant.tool.call":
			return {
				...state,
				tools: [
					...state.tools,
					{
						name: event.data.name,
						arguments: event.data.arguments,
						ok: null,
						result: null,
						deniedPermission: null,
						reason: null,
					},
				],
			};
		case "assistant.tool.result":
			return { ...state, tools: pairToolResult(state.tools, event.data) };
		case "assistant.permission.denied":
			return {
				...state,
				tools: [
					...state.tools,
					{
						name: event.data.name,
						arguments: null,
						ok: false,
						result: null,
						deniedPermission: event.data.permission,
						reason: event.data.reason,
					},
				],
			};
		case "assistant.usage":
			return { ...state, usage: event.data.usage };
		case "assistant.completed":
			return {
				...state,
				status: event.data.status,
				stopReason: event.data.stopReason,
			};
		case "assistant.error":
			return { ...state, error: event.data.message };
	}
}

/** 把持久事件恢复成一次运行的增量视图；序号不大于水位的直接跳过。 */
export function applyPersistedAssistantEvent(
	state: AssistantRunState,
	event: AssistantEventView,
): AssistantRunState {
	if (event.seq <= state.lastSeq) return state;
	const next = applyAssistantSseEvent(state, toAssistantSseEvent(event));
	return { ...next, lastSeq: event.seq };
}

export function applyPersistedAssistantEvents(
	state: AssistantRunState,
	events: readonly AssistantEventView[],
): AssistantRunState {
	let next = state;
	for (const event of events) next = applyPersistedAssistantEvent(next, event);
	return next;
}

/** 事件表里最后一次运行的事件；重连时只重放这一段。 */
export function selectLatestRunEvents(
	events: readonly AssistantEventView[],
): readonly AssistantEventView[] {
	let start = -1;
	for (let index = 0; index < events.length; index += 1) {
		if (events[index]?.kind === "started") start = index;
	}
	return start < 0 ? [] : events.slice(start);
}

/** 把事件表里的行还原成 SSE 形状；载荷缺字段时直接失败。 */
export function toAssistantSseEvent(
	event: AssistantEventView,
): AssistantSseEvent {
	const payload = event.payload;
	switch (event.kind) {
		case "started":
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.started,
				data: {
					conversationId: readText(payload, "conversationId"),
					skill: readText(payload, "skill"),
				},
			};
		case "text.delta":
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.textDelta,
				data: { delta: readText(payload, "delta") },
			};
		case "thinking.delta":
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.thinkingDelta,
				data: { delta: readText(payload, "delta") },
			};
		case "tool.call":
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.toolCall,
				data: {
					name: readText(payload, "name"),
					arguments: readObject(payload, "arguments"),
				},
			};
		case "tool.result":
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.toolResult,
				data: {
					name: readText(payload, "name"),
					ok: readBoolean(payload, "ok"),
					result: readValue(payload, "result"),
				},
			};
		case "permission.denied":
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.permissionDenied,
				data: {
					name: readText(payload, "name"),
					permission: readText(payload, "permission"),
					reason: readText(payload, "reason"),
				},
			};
		case "usage":
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.usage,
				data: { usage: readUsage(payload) },
			};
		case "completed":
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.completed,
				data: {
					status: readStatus(payload, "status"),
					stopReason: readStopReason(payload, "stopReason"),
				},
			};
		case "error":
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.error,
				data: { message: readText(payload, "message") },
			};
	}
}

export async function* parseAssistantSseStream(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<AssistantSseEvent> {
	for await (const raw of parseNamedSseStream(stream, ASSISTANT_EVENT_NAMES)) {
		yield toAssistantSseEventFromRaw(raw);
	}
}

function toAssistantSseEventFromRaw(raw: RawSseEvent): AssistantSseEvent {
	const name = raw.event as AssistantSseEventName;
	return { event: name, data: raw.data } as AssistantSseEvent;
}

function pairToolResult(
	tools: readonly AssistantToolActivity[],
	result: {
		readonly name: string;
		readonly ok: boolean;
		readonly result: JsonValue;
	},
): readonly AssistantToolActivity[] {
	for (let index = tools.length - 1; index >= 0; index -= 1) {
		const tool = tools[index];
		if (tool === undefined || tool.name !== result.name) continue;
		if (tool.ok !== null) continue;
		return tools.map((item, position) =>
			position === index
				? { ...item, ok: result.ok, result: result.result }
				: item,
		);
	}
	return [
		...tools,
		{
			name: result.name,
			arguments: null,
			ok: result.ok,
			result: result.result,
			deniedPermission: null,
			reason: null,
		},
	];
}

function readText(payload: JsonObject, key: string): string {
	const value = payload[key];
	if (typeof value !== "string") {
		throw new Error(`助手事件字段 ${key} 必须是字符串`);
	}
	return value;
}

function readBoolean(payload: JsonObject, key: string): boolean {
	const value = payload[key];
	if (typeof value !== "boolean") {
		throw new Error(`助手事件字段 ${key} 必须是布尔值`);
	}
	return value;
}

function readObject(payload: JsonObject, key: string): JsonObject {
	const value = payload[key];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`助手事件字段 ${key} 必须是 JSON 对象`);
	}
	return value as JsonObject;
}

function readValue(payload: JsonObject, key: string): JsonValue {
	const value = payload[key];
	if (value === undefined) {
		throw new Error(`助手事件缺少字段 ${key}`);
	}
	return value;
}

function readUsage(payload: JsonObject): LlmUsage {
	const usage = readObject(payload, "usage");
	return {
		promptTokens: readNullableNumber(usage, "promptTokens"),
		completionTokens: readNullableNumber(usage, "completionTokens"),
		totalTokens: readNullableNumber(usage, "totalTokens"),
		reasoningTokens: readNullableNumber(usage, "reasoningTokens"),
		cachedTokens: readNullableNumber(usage, "cachedTokens"),
	};
}

function readNullableNumber(payload: JsonObject, key: string): number | null {
	const value = payload[key];
	if (value === null || value === undefined) return null;
	if (typeof value !== "number") {
		throw new Error(`助手事件字段 ${key} 必须是数字或 null`);
	}
	return value;
}

function readStatus(
	payload: JsonObject,
	key: string,
): AssistantConversationStatus {
	const value = readText(payload, key);
	if (
		value !== "idle" &&
		value !== "running" &&
		value !== "completed" &&
		value !== "failed" &&
		value !== "cancelled" &&
		value !== "interrupted"
	) {
		throw new Error(`助手事件字段 ${key} 不是合法状态：${value}`);
	}
	return value;
}

function readStopReason(payload: JsonObject, key: string): DeepTurnStopReason {
	const value = readText(payload, key);
	const reasons: readonly DeepTurnStopReason[] = [
		"completed",
		"max_tool_calls",
		"timeout",
		"aborted",
		"error",
	];
	if (!(reasons as readonly string[]).includes(value)) {
		throw new Error(`助手事件字段 ${key} 不是合法结束原因：${value}`);
	}
	return value as DeepTurnStopReason;
}
