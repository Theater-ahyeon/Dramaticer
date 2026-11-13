import type { JsonObject } from "@dramaticer/core";
import type { StCharacterCard } from "../character-card.js";

/** 酒馆里与卡片字段绑定的 prompt marker。 */
export type StCardMarker =
	| "charDescription"
	| "charPersonality"
	| "scenario"
	| "main"
	| "dialogueExamples"
	| "jailbreak"
	| "personaDescription";

export type StCardPromptField =
	| "description"
	| "personality"
	| "scenario"
	| "system_prompt"
	| "mes_example"
	| "post_history_instructions";

export interface StCardPromptSection {
	readonly field: StCardPromptField;
	readonly marker: Exclude<StCardMarker, "personaDescription">;
	/** 卡片里原样保存的正文，不做宏替换或裁剪。 */
	readonly text: string;
}

export type StGreetingKind = "first" | "alternate" | "group-only";

export interface StGreetingCandidate {
	readonly kind: StGreetingKind;
	/** 备用问候与群聊问候在各自数组里的下标；开场白为 null。 */
	readonly index: number | null;
	readonly text: string;
}

export interface StCardFieldReport {
	readonly field: StCardPromptField;
	readonly marker: StCardPromptSection["marker"];
	readonly chars: number;
}

export interface StCardGreetingReport {
	readonly firstChars: number;
	readonly alternateCount: number;
	readonly groupOnlyCount: number;
}

export interface StCardMappingIssue {
	readonly code: string;
	readonly detail: string;
}

/** 兼容报告只保留标识、字符数与原因，不包含任何提示词正文。 */
export interface StCardMappingReport {
	readonly spec: StCharacterCard["spec"];
	readonly specVersion: string | null;
	readonly fields: readonly StCardFieldReport[];
	readonly greetings: StCardGreetingReport;
	readonly creatorNotesChars: number;
	readonly embeddedBookEntries: number | null;
	readonly unknownFields: readonly string[];
	readonly extensionKeys: readonly string[];
	readonly issues: readonly StCardMappingIssue[];
}

export interface StCardMapping {
	readonly name: string;
	/** 卡片里非空的 prompt 字段，按酒馆的 marker 标识输出。 */
	readonly sections: readonly StCardPromptSection[];
	readonly greetings: readonly StGreetingCandidate[];
	/** 卡片作者注释；只作为元数据保留，不进入提示词。 */
	readonly creatorNotes: string;
	readonly embeddedCharacterBook: JsonObject | null;
	readonly extensions: JsonObject;
	readonly raw: JsonObject;
	readonly report: StCardMappingReport;
}

const SECTION_FIELDS: readonly (readonly [
	StCardPromptField,
	StCardPromptSection["marker"],
	keyof StCharacterCard,
])[] = [
	["description", "charDescription", "description"],
	["personality", "charPersonality", "personality"],
	["scenario", "scenario", "scenario"],
	["system_prompt", "main", "systemPrompt"],
	["mes_example", "dialogueExamples", "messageExample"],
	["post_history_instructions", "jailbreak", "postHistoryInstructions"],
];

const V2_KNOWN_FIELDS = [
	"name",
	"description",
	"personality",
	"scenario",
	"first_mes",
	"mes_example",
	"creator_notes",
	"system_prompt",
	"post_history_instructions",
	"alternate_greetings",
	"tags",
	"creator",
	"character_version",
	"extensions",
	"character_book",
	"nickname",
	"group_only_greetings",
	"assets",
] as const;

const V1_KNOWN_FIELDS = [
	...V2_KNOWN_FIELDS,
	"creatorcomment",
	"avatar",
	"chat",
	"talkativeness",
	"fav",
	"create_date",
] as const;

/** 把角色卡映射成可以并入原生模板的 prompt 字段、问候候选与兼容报告。 */
export function mapCharacterCard(card: StCharacterCard): StCardMapping {
	const sections: StCardPromptSection[] = [];
	const fields: StCardFieldReport[] = [];
	for (const [field, marker, key] of SECTION_FIELDS) {
		const value = card[key];
		if (typeof value !== "string" || value.trim().length === 0) continue;
		sections.push({ field, marker, text: value });
		fields.push({ field, marker, chars: value.length });
	}

	const bookEntries = readBookEntryCount(card.characterBook);
	const data = card.spec === "chara_card_v1" ? card.raw : readRawData(card);
	const known = new Set<string>(
		card.spec === "chara_card_v1" ? V1_KNOWN_FIELDS : V2_KNOWN_FIELDS,
	);
	const unknownFields = Object.keys(data)
		.filter((key) => !known.has(key))
		.sort();

	return {
		name: card.name,
		sections,
		greetings: listCharacterGreetings(card),
		creatorNotes: card.creatorNotes,
		embeddedCharacterBook: card.characterBook,
		extensions: card.extensions,
		raw: card.raw,
		report: {
			spec: card.spec,
			specVersion: card.specVersion,
			fields,
			greetings: {
				firstChars: card.firstMessage.trim().length,
				alternateCount: card.alternateGreetings.filter(
					(text) => text.trim().length > 0,
				).length,
				groupOnlyCount: card.groupOnlyGreetings.filter(
					(text) => text.trim().length > 0,
				).length,
			},
			creatorNotesChars: card.creatorNotes.length,
			embeddedBookEntries: bookEntries,
			unknownFields,
			extensionKeys: Object.keys(card.extensions).sort(),
			issues:
				bookEntries === null && card.characterBook !== null
					? [
							{
								code: "character-book-entries",
								detail: "character_book.entries 不是数组",
							},
						]
					: [],
		},
	};
}

/**
 * 群聊只使用 `group_only_greetings`，没有时退回单聊候选；
 * 单聊不使用群聊问候。
 */
export function listCharacterGreetings(
	card: StCharacterCard,
	options: { readonly group?: boolean } = {},
): StGreetingCandidate[] {
	if (options.group === true) {
		const groupOnly = card.groupOnlyGreetings
			.map((text, index) => ({ kind: "group-only" as const, index, text }))
			.filter((candidate) => candidate.text.trim().length > 0);
		if (groupOnly.length > 0) return groupOnly;
	}
	return soloGreetings(card);
}

function soloGreetings(card: StCharacterCard): StGreetingCandidate[] {
	const candidates: StGreetingCandidate[] = [];
	if (card.firstMessage.trim().length > 0) {
		candidates.push({
			kind: "first",
			index: null,
			text: card.firstMessage,
		});
	}
	for (const [index, text] of card.alternateGreetings.entries()) {
		if (text.trim().length === 0) continue;
		candidates.push({ kind: "alternate", index, text });
	}
	return candidates;
}

export function selectCharacterGreeting(
	card: StCharacterCard,
	options: {
		readonly group?: boolean;
		readonly alternateIndex?: number | null;
	} = {},
): StGreetingCandidate | null {
	const alternateIndex = options.alternateIndex ?? null;
	if (options.group === true) {
		if (alternateIndex !== null) {
			throw new Error("群聊不能按备用问候下标选择开场");
		}
		return listCharacterGreetings(card, { group: true })[0] ?? null;
	}
	if (alternateIndex === null) return soloGreetings(card)[0] ?? null;
	if (!Number.isInteger(alternateIndex) || alternateIndex < 0) {
		throw new Error(`备用问候下标必须是非负整数：${alternateIndex}`);
	}
	const text = card.alternateGreetings[alternateIndex];
	if (text === undefined || text.trim().length === 0) {
		throw new Error(
			`备用问候下标 ${alternateIndex} 越界或正文为空；共有 ${card.alternateGreetings.length} 条`,
		);
	}
	return { kind: "alternate", index: alternateIndex, text };
}

function readRawData(card: StCharacterCard): JsonObject {
	const data = card.raw.data;
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		throw new Error("角色卡缺少 data 节点");
	}
	return data as JsonObject;
}

function readBookEntryCount(book: JsonObject | null): number | null {
	if (book === null) return null;
	const entries = book.entries;
	return Array.isArray(entries) ? entries.length : null;
}
