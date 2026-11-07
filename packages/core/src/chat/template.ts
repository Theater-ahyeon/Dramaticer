import type { ContextTemplate } from "../context/template.js";
import type { StructuredOutputMode } from "../structured/types.js";

export const DEFAULT_CONTEXT_TEMPLATE_ID = "dramaticer-default";

export interface DefaultContextTemplateOptions {
	readonly structuredOutput: StructuredOutputMode;
}

const TEXT_TAG_PROTOCOL = `你在扮演故事里的角色，用正文推进故事。正文结束后，用标签提交本轮产生的状态变更与剧情笔记。

标签规则：
- 一个标签只写一条，内容是 JSON 对象，写在正文之后。
- 写入或修改状态字段：<state_update>{"path":["角色","卫宫","好感度"],"op":"set","value":12,"reason":"一句话说明原因"}</state_update>
- 删除状态字段：<state_update>{"path":["角色","卫宫","好感度"],"op":"delete"}</state_update>
- 记录剧情笔记：<plot_note>{"text":"尚未兑现的伏笔或线索"}</plot_note>
- path 从宽到窄，不能为空；没有变化的字段不要提交。`;

const FUNCTION_CALL_PROTOCOL = `你在扮演故事里的角色，用正文推进故事。正文结束后，通过工具调用提交本轮产生的状态变更与剧情笔记。

工具规则：
- state_update 每次调用只写一条变更，path 从宽到窄，不能为空。
- plot_note 每次调用只写一条笔记，记录尚未兑现的伏笔或线索。
- 没有变化的字段不要提交；不要在正文里写这些 JSON。`;

/** 默认的原生上下文模板：角色、世界书、状态、摘要、记忆、导演、协议、历史。 */
export function createDefaultContextTemplate(
	options: DefaultContextTemplateOptions,
): ContextTemplate {
	const protocol =
		options.structuredOutput === "function-call"
			? FUNCTION_CALL_PROTOCOL
			: TEXT_TAG_PROTOCOL;
	return {
		id: DEFAULT_CONTEXT_TEMPLATE_ID,
		segments: [
			{ id: "character", kind: "slot", slot: "character", priority: 90 },
			{ id: "lore", kind: "slot", slot: "lore", priority: 80 },
			{ id: "state", kind: "slot", slot: "state", priority: 85 },
			{ id: "summary", kind: "slot", slot: "summary", priority: 70 },
			{ id: "memory", kind: "slot", slot: "memory", priority: 60 },
			{ id: "director", kind: "slot", slot: "director", priority: 50 },
			{
				id: "protocol",
				kind: "static",
				text: protocol,
				priority: 95,
			},
			{ id: "history", kind: "slot", slot: "history", priority: 100 },
		],
	};
}
