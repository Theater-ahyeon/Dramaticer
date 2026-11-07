import type { LlmModelProbe } from "../llm/channels.js";
import type { LlmToolDefinition } from "../llm/types.js";
import type { StructuredOutputMode } from "./types.js";

/**
 * state_update 的 JSON Schema。与 validateStructuredPayload 表达同一套约束：
 * path 非空、op 二选一、set 必须带 value、delete 不能带 value。
 */
export const STATE_UPDATE_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		path: {
			type: "array",
			items: { type: "string", minLength: 1 },
			minItems: 1,
			description: '状态路径，从宽到窄，例如 ["角色","卫宫","好感度"]',
		},
		op: {
			type: "string",
			enum: ["set", "delete"],
			description: "set 写入新值；delete 删除该路径",
		},
		value: {
			description:
				"op 为 set 时的新值，可以是任意 JSON 值；op 为 delete 时省略",
		},
		reason: {
			type: ["string", "null"],
			description: "一句话说明为什么改",
		},
	},
	required: ["path", "op"],
	additionalProperties: false,
};

export const PLOT_NOTE_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		text: {
			type: "string",
			minLength: 1,
			description: "一句剧情笔记，写尚未兑现的伏笔或线索，不要复述正文",
		},
	},
	required: ["text"],
	additionalProperties: false,
};

/** 函数调用模式下提供给模型的写入类工具。 */
export const STRUCTURED_OUTPUT_TOOLS: readonly LlmToolDefinition[] = [
	{
		name: "state_update",
		description: "更新一个状态字段。正文输出结束后调用，可以多次调用。",
		parameters: STATE_UPDATE_SCHEMA,
	},
	{
		name: "plot_note",
		description: "记录一条剧情笔记。正文输出结束后调用，可以多次调用。",
		parameters: PLOT_NOTE_SCHEMA,
	},
];

/** 体检结果优先；没有跑过体检时用文本标签模式，它不依赖渠道的工具能力。 */
export function resolveStructuredOutputMode(
	probe: LlmModelProbe | null,
): StructuredOutputMode {
	return probe?.structuredOutput ?? "text-tags";
}
