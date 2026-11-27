/** 原著逐章抽取的提示词：模型只输出 JSON，程序负责校验与落库。 */
import type { CanonChunkPlan, CanonEntityKind } from "./types.js";

const ENTITY_KINDS: readonly CanonEntityKind[] = [
	"人物",
	"地点",
	"势力",
	"物品",
	"其他",
];

export interface CanonPromptRosterEntry {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly kind: CanonEntityKind;
}

export interface CanonExtractionPromptInput {
	readonly bookTitle: string;
	readonly chapterOrdinal: number;
	readonly chapterTitle: string;
	readonly chunk: CanonChunkPlan;
	readonly paragraphs: readonly string[];
	readonly roster: readonly CanonPromptRosterEntry[];
}

export interface CanonExtractionPrompt {
	readonly system: string;
	readonly user: string;
}

export function buildCanonExtractionPrompt(
	input: CanonExtractionPromptInput,
): CanonExtractionPrompt {
	const system = [
		"你是原著的事件抽取器。只输出一个 JSON 对象，不要解释，不要 Markdown。",
		"从给定的一块原文里抽出三样东西：",
		"1. events（事件）：每条都要有 title（短标题）、summary（一句话概要）、digest（3–5 句缩写）、participants（参与人物，用标准名）、location（地点，没有就写 null）、time（相对时间，如「三日后」，没有就写 null）、paragraphStart / paragraphEnd（本块原文标注的段落号，两端都包含）、isInterlude（插叙、回忆、梦境为 true，主时间线为 false）。",
		"2. voices（话术）：本章重要人物的代表性原话或心声，character 用标准名，kind 只能是 speech（说）或 thought（想），text 是原话；每人每章最多 5 条。",
		"3. facts（实体增量）：新出场或已有实体的新信息。name 写标准名，aliases 写已知别名，kind 只能是 人物、地点、势力、物品、其他，fact 写这一条事实或关系。",
		"硬性要求：",
		"- participants、voices 的 character、facts 的 name 必须使用标准名；名册里已有的别名要归到标准名，不要另起新人。",
		"- 事件的 participants 必须在本块原文里真实出现（标准名或它的别名出现都算）。",
		"- paragraphStart..paragraphEnd 必须落在本块给出的段落号范围内，不要引用块外段落。",
		"- 事件按原文顺序给出；不要编造原文没有的事件。",
		"输出形状：",
		'{"events":[{"title":"","summary":"","digest":"","participants":[],"location":null,"time":null,"paragraphStart":1,"paragraphEnd":1,"isInterlude":false}],',
		'"voices":[{"character":"","kind":"speech","text":""}],',
		'"facts":[{"name":"","aliases":[],"kind":"人物","fact":""}]}',
	].join("\n");
	const rosterLines =
		input.roster.length === 0
			? ["（还没有已发现的实体）"]
			: input.roster.map((entry) => {
					const aliases =
						entry.aliases.length === 0
							? ""
							: `（别名：${entry.aliases.join("、")}）`;
					return `- ${entry.name}${aliases}；${entry.kind}`;
				});
	const paragraphLines = input.paragraphs
		.slice(input.chunk.startParagraph - 1, input.chunk.endParagraph)
		.map((paragraph, index) => {
			const ordinal = input.chunk.startParagraph + index;
			return `[${ordinal}] ${paragraph}`;
		});
	const user = [
		`<原著>${input.bookTitle}</原著>`,
		`<本章 序号="${input.chapterOrdinal}" 标题="${input.chapterTitle}">`,
		`<名册>\n${rosterLines.join("\n")}\n</名册>`,
		`<块 段落="${input.chunk.startParagraph}-${input.chunk.endParagraph}">`,
		...paragraphLines,
		"</块>",
		"</本章>",
		`实体类别只能取：${ENTITY_KINDS.join("、")}。只输出 JSON。`,
	].join("\n");
	return { system, user };
}
