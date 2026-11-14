import {
	CONTEXT_LAYOUTS,
	type ContextLayout,
	type ContextLayoutKind,
	type ContextSegment,
	type ContextStaticSegment,
	type ContextTemplate,
	DEFAULT_CONTEXT_TEMPLATE_ID,
	WRITING_CONTRACT_SEGMENT_ID,
} from "../context/template.js";
import type { StructuredOutputMode } from "../structured/types.js";

export interface DefaultContextTemplateOptions {
	readonly structuredOutput: StructuredOutputMode;
	/** 是否附上 state_update 与 plot_note 的格式说明段，默认关闭（I13）。 */
	readonly blockFormat?: boolean;
	/** 段落排布；默认按易变性排布，`full` 是 v4 之前的顺序，用于对照。 */
	readonly layout?: ContextLayout;
}

/** 两种协议共用的写作契约；朴素模式只带这一段的文本。 */
export const WRITING_CONTRACT = `写作契约：
- 玩家输入是本轮演出的指引，不是已经发生的剧情；按指引编排接下来发生的事。
- 玩家不是上帝：角色可以按人设拒绝、反对、打断，也可以有玩家没有预料的反应。
- 每轮都让剧情有所推进，不重复之前的正文。
- 遵守用户意志里的偏好、底线与纠正。`;

const TEXT_TAG_PROTOCOL = `${WRITING_CONTRACT}

你扮演故事里的角色，用正文推进故事。正文结束后，用标签提交本轮产生的状态变更与剧情笔记。

标签规则：
- 一个标签只写一条，内容是 JSON 对象，写在正文之后。
- 写入或修改状态字段：<state_update>{"path":["角色","卫宫","好感度"],"op":"set","value":12,"reason":"一句话说明原因"}</state_update>
- 删除状态字段：<state_update>{"path":["角色","卫宫","好感度"],"op":"delete"}</state_update>
- 记录剧情笔记：<plot_note>{"text":"尚未兑现的伏笔或线索"}</plot_note>
- path 从宽到窄，不能为空；没有变化的字段不要提交。`;

const FUNCTION_CALL_PROTOCOL = `${WRITING_CONTRACT}

你扮演故事里的角色，用正文推进故事。正文结束后，通过工具调用提交本轮产生的状态变更与剧情笔记。

工具规则：
- 需要回忆过去的原文或事件时，可以调用 memory_search；需要世界书资料或实体档案时，调用 lore_lookup；需要核对状态值时，调用 state_get。读取工具返回结果后继续写正文。
- state_update 每次调用只写一条变更，path 从宽到窄，不能为空。
- plot_note 每次调用只写一条笔记，记录尚未兑现的伏笔或线索。
- 没有变化的字段不要提交；不要在正文里写这些 JSON。`;

const TEXT_TAG_BLOCK_FORMAT = `块格式参考：正文之后记录状态变更与剧情笔记的块，内容都是一个 JSON 对象，写法如下。
- <state_update>{"path":["角色","卫宫","好感度"],"op":"set","value":12,"reason":"一句话说明原因"}</state_update>：path 从宽到窄，op 取 set 或 delete，delete 时不带 value。
- <plot_note>{"text":"尚未兑现的伏笔或线索"}</plot_note>：text 是一句话。
要不要写、写几条，按剧情需要决定。`;

const FUNCTION_CALL_BLOCK_FORMAT = `块格式参考：状态变更与剧情笔记分别由 state_update 与 plot_note 两个工具传入，参数都是一个 JSON 对象，写法如下。
- state_update：{"path":["角色","卫宫","好感度"],"op":"set","value":12,"reason":"一句话说明原因"}；path 从宽到窄，op 取 set 或 delete，delete 时不带 value。
- plot_note：{"text":"尚未兑现的伏笔或线索"}；text 是一句话。
要不要调用、调用几次，按剧情需要决定。`;

/** 朴素模式（B0）的模板 id：只有角色、persona、历史原文与写作契约。 */
export const DEFAULT_NAIVE_CONTEXT_TEMPLATE_ID = "dramaticer-naive";

/**
 * 朴素模式（B0）的上下文模板。协议段只放写作契约的正文，
 * 不要求模型输出结构化写入，因为朴素模式不写台账。
 */
export function createNaiveContextTemplate(): ContextTemplate {
	return {
		id: DEFAULT_NAIVE_CONTEXT_TEMPLATE_ID,
		segments: [
			{ id: "character", kind: "slot", slot: "character", priority: 90 },
			{ id: "persona", kind: "slot", slot: "persona", priority: 95 },
			{ id: "history", kind: "slot", slot: "history", priority: 100 },
			{
				id: WRITING_CONTRACT_SEGMENT_ID,
				kind: "static",
				text: WRITING_CONTRACT,
				priority: 95,
			},
		],
	};
}

/** `block_format` 段：说明原生块的写法；是否加入模板由玩家决定（I13）。 */
export function createBlockFormatSegment(
	structuredOutput: StructuredOutputMode,
): ContextStaticSegment {
	return {
		id: "block_format",
		kind: "static",
		text:
			structuredOutput === "function-call"
				? FUNCTION_CALL_BLOCK_FORMAT
				: TEXT_TAG_BLOCK_FORMAT,
		priority: 95,
	};
}

/** 默认模板的各个段落；顺序由 `DEFAULT_CONTEXT_SEGMENT_ORDER` 决定。 */
const DEFAULT_SEGMENTS: Readonly<Record<string, ContextSegment>> = {
	character: { id: "character", kind: "slot", slot: "character", priority: 90 },
	lore: { id: "lore", kind: "slot", slot: "lore", priority: 80 },
	summary: { id: "summary", kind: "slot", slot: "summary", priority: 70 },
	history: { id: "history", kind: "slot", slot: "history", priority: 100 },
	state: { id: "state", kind: "slot", slot: "state", priority: 85 },
	memory: { id: "memory", kind: "slot", slot: "memory", priority: 60 },
	scene: { id: "scene", kind: "slot", slot: "scene", priority: 55 },
	profile: {
		id: "profile",
		kind: "slot",
		slot: "profile",
		priority: 53,
	},
	scene_card: {
		id: "scene_card",
		kind: "slot",
		slot: "scene_card",
		priority: 52,
	},
	director: { id: "director", kind: "slot", slot: "director", priority: 50 },
	user_will: {
		id: "user_will",
		kind: "slot",
		slot: "user_will",
		priority: 110,
	},
};

/**
 * 默认模板在两种排布下的段落顺序（不含 `block_format`，它始终插在 `protocol` 之前）。
 * `volatility` 把只追加的卡、常驻设定、章节档案与历史原文放在前缀，每轮变化的槽位排在后面。
 */
export const DEFAULT_CONTEXT_SEGMENT_ORDER: Readonly<
	Record<ContextLayout, readonly string[]>
> = {
	volatility: [
		"character",
		"lore",
		"summary",
		"history",
		"state",
		"memory",
		"scene",
		"profile",
		"scene_card",
		"director",
		"user_will",
		WRITING_CONTRACT_SEGMENT_ID,
	],
	full: [
		"character",
		"lore",
		"state",
		"summary",
		"memory",
		"scene",
		"profile",
		"scene_card",
		"director",
		"user_will",
		"history",
		WRITING_CONTRACT_SEGMENT_ID,
	],
};

/**
 * 从模板的段落顺序判断它用的是哪种默认排布；两者都不匹配时返回 `custom`。
 * `block_format` 不参与比较，它只是插在 `protocol` 之前的可选静态段。
 */
export function detectContextLayout(
	template: ContextTemplate,
): ContextLayoutKind {
	const ids = template.segments
		.map((segment) => segment.id)
		.filter((id) => id !== "block_format");
	for (const layout of CONTEXT_LAYOUTS) {
		const expected = DEFAULT_CONTEXT_SEGMENT_ORDER[layout];
		if (
			ids.length === expected.length &&
			expected.every((id, index) => ids[index] === id)
		) {
			return layout;
		}
	}
	return "custom";
}

/** 默认的原生上下文模板：段落顺序按 `layout` 排布，protocol 写作契约固定在最后。 */
export function createDefaultContextTemplate(
	options: DefaultContextTemplateOptions,
): ContextTemplate {
	const protocol =
		options.structuredOutput === "function-call"
			? FUNCTION_CALL_PROTOCOL
			: TEXT_TAG_PROTOCOL;
	const layout = options.layout ?? "volatility";
	const segments = DEFAULT_CONTEXT_SEGMENT_ORDER[layout]
		.filter((id) => id !== WRITING_CONTRACT_SEGMENT_ID)
		.map((id) => DEFAULT_SEGMENTS[id] as ContextSegment);
	return {
		id: DEFAULT_CONTEXT_TEMPLATE_ID,
		segments: [
			...segments,
			...(options.blockFormat === true
				? [createBlockFormatSegment(options.structuredOutput)]
				: []),
			{
				id: WRITING_CONTRACT_SEGMENT_ID,
				kind: "static",
				text: protocol,
				priority: 95,
			},
		],
	};
}
