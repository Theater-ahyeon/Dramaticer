/** 全书汇编的提示词：别名合并、关键转折、实体记事页底色；模型只输出 JSON。 */
import type {
	CanonBaseEntry,
	CanonEntityKind,
	CanonEntityRecord,
	CanonEventRecord,
	CanonFactRecord,
	CanonVoiceRecord,
} from "./types.js";

export interface CanonPrompt {
	readonly system: string;
	readonly user: string;
}

/** 一个实体的汇编素材：名册、事实、参与的事件与他的原话。 */
export interface CanonEntityMaterial {
	readonly entity: CanonEntityRecord;
	readonly facts: readonly CanonFactRecord[];
	readonly events: readonly CanonEventRecord[];
	readonly voices: readonly CanonVoiceRecord[];
}

const ENTITY_KINDS: readonly CanonEntityKind[] = [
	"人物",
	"地点",
	"势力",
	"物品",
	"其他",
];

export interface CanonMergePromptInput {
	readonly bookTitle: string;
	readonly entities: readonly CanonEntityRecord[];
	/** 程序挑出的可能指同一实体的一组名字；只作提示，模型自己判断。 */
	readonly candidates: readonly (readonly string[])[];
}

export function buildCanonMergePrompt(
	input: CanonMergePromptInput,
): CanonPrompt {
	const system = [
		"你是原著的人物与别名合并器。只输出一个 JSON 对象，不要解释，不要 Markdown。",
		"把指同一个人的名字合成一组：同样的名字、别名、尊称、小名都算同一个人；不同的人即使同姓也不要合并。",
		"canonicalName 必须是组里出现的一个名字，优先用出现最早、信息最多的全名。",
		"aliases 写组里其余的写法；names 写这一组包含的所有名字。",
		"没有把握合并的名字就不要放进任何组。",
		"输出形状：",
		'{"merges":[{"canonicalName":"","names":[],"aliases":[]}]}',
	].join("\n");
	const entityLines = input.entities.map((entity) => {
		const aliases =
			entity.aliases.length === 0
				? ""
				: `（别名：${entity.aliases.join("、")}）`;
		return `- ${entity.name}${aliases}；${entity.kind}；第 ${entity.firstChapterOrdinal}–${entity.lastChapterOrdinal} 章`;
	});
	const candidateLines =
		input.candidates.length === 0
			? ["（没有候选）"]
			: input.candidates.map((group) => `- ${group.join(" | ")}`);
	const user = [
		`<原著>${input.bookTitle}</原著>`,
		`<实体>\n${entityLines.join("\n")}\n</实体>`,
		`<候选>\n${candidateLines.join("\n")}\n</候选>`,
		`实体类别只能取：${ENTITY_KINDS.join("、")}。只输出 JSON。`,
	].join("\n");
	return { system, user };
}

export interface CanonTurningPointPromptInput {
	readonly bookTitle: string;
	readonly events: readonly CanonEventRecord[];
}

export function buildCanonTurningPointPrompt(
	input: CanonTurningPointPromptInput,
): CanonPrompt {
	const system = [
		"你是原著的时间线编者。只输出一个 JSON 对象，不要解释，不要 Markdown。",
		"从给出的事件里标出关键转折：人物关系、目标、身份或局势发生不可逆变化的那种事件。",
		"普通推进、过场、铺陈不标；一段剧情里通常只有一两个转折，宁可少标。",
		"turningPoints 里只写给出的方括号事件编号，不要编造。",
		"输出形状：",
		'{"turningPoints":[1]}',
	].join("\n");
	const eventLines = input.events.map(
		(event) =>
			`- [${event.id}] 第 ${event.chapterOrdinal} 章 ${event.title}：${event.summary}`,
	);
	const user = [
		`<原著>${input.bookTitle}</原著>`,
		`<事件>\n${eventLines.join("\n")}\n</事件>`,
		"只输出 JSON。",
	].join("\n");
	return { system, user };
}

export interface CanonEntityPagePromptInput {
	readonly bookTitle: string;
	readonly materials: readonly CanonEntityMaterial[];
}

export function buildCanonEntityPagePrompt(
	input: CanonEntityPagePromptInput,
): CanonPrompt {
	const system = [
		"你是原著的人物页编者。只输出一个 JSON 对象，不要解释，不要 Markdown。",
		"为每个实体写两样东西：lead 是一行简介（15–40 字，给世界索引与初次见面用）；entries 是记事页的底色条目，每条带章节号。",
		"lead 只写这个实体在全书里始终成立的定位，不写结局与后期揭晓的秘密。",
		"entries 按章节从早到晚排列，每条写「到这一章为止已经成立」的事实，15–60 字；后面章节才揭晓的身份、关系、结局不能提前写进前面的条目。",
		"chapter 必须是这个实体出现的章节号，并且落在首章与末章之间；text 不要重复同一条事实。",
		"输出形状：",
		'{"entities":[{"name":"","lead":"","entries":[{"chapter":1,"text":""}]}]}',
	].join("\n");
	const blocks = input.materials.map((material) => {
		const { entity } = material;
		const factLines =
			material.facts.length === 0
				? ["（没有事实）"]
				: material.facts.map(
						(fact) => `[第 ${fact.chapterOrdinal} 章] ${fact.fact}`,
					);
		const eventLines =
			material.events.length === 0
				? ["（没有参与的事件）"]
				: material.events.map(
						(event) =>
							`[第 ${event.chapterOrdinal} 章] ${event.title}：${event.summary}`,
					);
		const voiceLines =
			material.voices.length === 0
				? ["（没有原话）"]
				: material.voices.map(
						(voice) =>
							`[第 ${voice.chapterOrdinal} 章] ${voice.kind === "speech" ? "说" : "想"}：${voice.text}`,
					);
		return [
			`<实体 名="${entity.name}" 类别="${entity.kind}" 首章="${entity.firstChapterOrdinal}" 末章="${entity.lastChapterOrdinal}">`,
			`<事实>\n${factLines.join("\n")}\n</事实>`,
			`<事件>\n${eventLines.join("\n")}\n</事件>`,
			`<原话>\n${voiceLines.join("\n")}\n</原话>`,
			"</实体>",
		].join("\n");
	});
	const user = [
		`<原著>${input.bookTitle}</原著>`,
		...blocks,
		"只输出 JSON。",
	].join("\n");
	return { system, user };
}

/** 从模型回复里取出 JSON 对象；允许 ```json 围栏与前后少量说明。 */
export function parseCanonCompileResponse(text: string): unknown {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) {
		throw new Error("模型回复里没有 JSON 对象");
	}
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch (error) {
		throw new Error(
			`模型回复的 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function sortCanonBaseEntries(
	entries: readonly CanonBaseEntry[],
): readonly CanonBaseEntry[] {
	return [...entries].sort(
		(left, right) => left.chapterOrdinal - right.chapterOrdinal,
	);
}

/** 底色文本由带锚点的条目拼成，章节顺序与锚点一致。 */
export function renderCanonBaseText(
	entries: readonly CanonBaseEntry[],
): string {
	return sortCanonBaseEntries(entries)
		.map((entry) => `第${entry.chapterOrdinal}章：${entry.text}`)
		.join("\n");
}
