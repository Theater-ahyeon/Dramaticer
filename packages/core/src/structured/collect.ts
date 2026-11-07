import { parseBlocks } from "../blocks/parser.js";
import type { ParsedBlock, ParsedContent } from "../blocks/types.js";
import type { LlmToolCall } from "../llm/types.js";
import type {
	AcceptedPlotNote,
	AcceptedStateUpdate,
	StructuredOutputCollection,
	StructuredOutputIssue,
	StructuredPayloadName,
} from "./types.js";
import { validateStructuredPayload } from "./validate.js";

const PROTOCOL_NAMES: Record<string, StructuredPayloadName> = {
	state_update: "state_update",
	plot_note: "plot_note",
};

function isProtocolName(name: string): name is StructuredPayloadName {
	return Object.hasOwn(PROTOCOL_NAMES, name);
}

interface Sink {
	readonly stateUpdates: AcceptedStateUpdate[];
	readonly notes: AcceptedPlotNote[];
	readonly issues: StructuredOutputIssue[];
}

function createSink(): Sink {
	return { stateUpdates: [], notes: [], issues: [] };
}

function applyValidation(
	sink: Sink,
	name: StructuredPayloadName,
	value: unknown,
): void {
	const validation = validateStructuredPayload(name, value);
	if (!validation.ok) {
		sink.issues.push({ payload: name, raw: value, reason: validation.reason });
		return;
	}
	if (validation.payload.name === "state_update") {
		sink.stateUpdates.push(validation.payload.value);
	} else {
		sink.notes.push(validation.payload.value);
	}
}

/** 函数调用模式：只认两个写入类工具，其余调用（读取类工具）忽略。 */
export function collectStructuredOutputFromToolCalls(
	toolCalls: readonly LlmToolCall[],
): StructuredOutputCollection {
	const sink = createSink();
	for (const call of toolCalls) {
		if (!isProtocolName(call.name)) continue;
		applyValidation(sink, call.name, call.arguments);
	}
	return { mode: "function-call", ...sink };
}

/** 文本标签模式：解析完整回复，取出已闭合的写入类块并逐个校验。 */
export function collectStructuredOutputFromText(
	text: string,
): StructuredOutputCollection {
	const sink = createSink();
	walk(parseBlocks(text), sink);
	return { mode: "text-tags", ...sink };
}

function walk(items: readonly ParsedContent[], sink: Sink): void {
	for (const item of items) {
		if (item.kind !== "block") continue;
		if (isProtocolName(item.name)) {
			collectTextBlock(sink, item);
			continue;
		}
		walk(item.content, sink);
	}
}

function collectTextBlock(sink: Sink, block: ParsedBlock): void {
	const name = block.name as StructuredPayloadName;
	if (!block.complete) {
		sink.issues.push({
			payload: name,
			raw: block.raw,
			reason: `${name} 块没有闭合`,
		});
		return;
	}
	const text = block.raw.trim();
	if (text.length === 0) {
		sink.issues.push({
			payload: name,
			raw: block.raw,
			reason: `${name} 块内容为空，必须是 JSON 对象`,
		});
		return;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		sink.issues.push({
			payload: name,
			raw: block.raw,
			reason: `${name} 块内容不是合法 JSON：${(error as Error).message}`,
		});
		return;
	}
	applyValidation(sink, name, parsed);
}
