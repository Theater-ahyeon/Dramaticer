import { type JsonObject, isJsonObject } from "@dramaticer/core";
import type { StCharacterCard } from "../character-card.js";
import type { StPreset } from "../preset.js";

/**
 * ST-Prompt-Template 的角色卡、预设与快捷回复读取函数。
 * 数据由调用方注入，函数不读文件、不访问网络。
 */

export interface StEjsQuickReply {
	readonly id: string | null;
	readonly label: string;
	readonly message: string;
	readonly raw?: JsonObject;
}

export interface StEjsQuickReplySet {
	readonly name: string;
	readonly replies: readonly StEjsQuickReply[];
}

export interface StEjsDataSource {
	readonly character?: StCharacterCard | null;
	readonly presets?: Readonly<Record<string, StPreset>>;
	readonly activePreset?: string | null;
	readonly quickReplies?: readonly StEjsQuickReplySet[];
}

export class StEjsDataError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StEjsDataError";
	}
}

const CHARACTER_FIELDS = [
	"name",
	"nickname",
	"description",
	"personality",
	"scenario",
	"first_mes",
	"mes_example",
	"creator_notes",
	"system_prompt",
	"post_history_instructions",
	"creator",
	"character_version",
	"tags",
	"alternate_greetings",
	"group_only_greetings",
] as const;

type CharacterField = (typeof CHARACTER_FIELDS)[number];

const CHARACTER_ALIASES: Readonly<Record<string, CharacterField>> = {
	name: "name",
	nickname: "nickname",
	description: "description",
	personality: "personality",
	scenario: "scenario",
	first_mes: "first_mes",
	firstmessage: "first_mes",
	first_message: "first_mes",
	mes_example: "mes_example",
	mesexample: "mes_example",
	message_example: "mes_example",
	creator_notes: "creator_notes",
	creatornotes: "creator_notes",
	system_prompt: "system_prompt",
	systemprompt: "system_prompt",
	post_history_instructions: "post_history_instructions",
	posthistoryinstructions: "post_history_instructions",
	creator: "creator",
	character_version: "character_version",
	characterversion: "character_version",
	tags: "tags",
	alternate_greetings: "alternate_greetings",
	alternategreetings: "alternate_greetings",
	group_only_greetings: "group_only_greetings",
	grouponlygreetings: "group_only_greetings",
};

function readCharacterField(
	card: StCharacterCard,
	field: CharacterField,
): string | readonly string[] {
	switch (field) {
		case "name":
			return card.name;
		case "nickname":
			return card.nickname ?? "";
		case "description":
			return card.description;
		case "personality":
			return card.personality;
		case "scenario":
			return card.scenario;
		case "first_mes":
			return card.firstMessage;
		case "mes_example":
			return card.messageExample;
		case "creator_notes":
			return card.creatorNotes;
		case "system_prompt":
			return card.systemPrompt;
		case "post_history_instructions":
			return card.postHistoryInstructions;
		case "creator":
			return card.creator;
		case "character_version":
			return card.characterVersion;
		case "tags":
			return [...card.tags];
		case "alternate_greetings":
			return [...card.alternateGreetings];
		case "group_only_greetings":
			return [...card.groupOnlyGreetings];
	}
}

function cloneJson<T>(value: T): T {
	return structuredClone(value);
}

export class StEjsDataReader {
	readonly #character: StCharacterCard | null;
	readonly #presets: Readonly<Record<string, StPreset>>;
	readonly #activePreset: string | null;
	readonly #quickReplies: readonly StEjsQuickReplySet[];

	constructor(source: StEjsDataSource = {}) {
		this.#character = source.character ?? null;
		this.#presets = source.presets ?? {};
		this.#activePreset = source.activePreset ?? null;
		this.#quickReplies = source.quickReplies ?? [];
	}

	/** 角色卡字段；省略字段时返回整张卡的规范化视图。 */
	getCharData(field?: string): unknown {
		const card = this.#requireCharacter();
		if (field === undefined) {
			return cloneJson({
				name: card.name,
				nickname: card.nickname ?? "",
				description: card.description,
				personality: card.personality,
				scenario: card.scenario,
				first_mes: card.firstMessage,
				mes_example: card.messageExample,
				creator_notes: card.creatorNotes,
				system_prompt: card.systemPrompt,
				post_history_instructions: card.postHistoryInstructions,
				creator: card.creator,
				character_version: card.characterVersion,
				tags: [...card.tags],
				alternate_greetings: [...card.alternateGreetings],
				group_only_greetings: [...card.groupOnlyGreetings],
			});
		}
		const resolved = CHARACTER_ALIASES[field.trim().toLowerCase()];
		if (resolved === undefined) {
			throw new StEjsDataError(
				`角色卡没有字段 ${field}；可用字段：${CHARACTER_FIELDS.join("、")}`,
			);
		}
		return readCharacterField(card, resolved);
	}

	/** 预设数据；省略名称时使用当前预设。 */
	getPreset(name?: string): StPreset {
		const resolved = name ?? this.#activePreset;
		if (resolved === null || resolved === undefined) {
			throw new StEjsDataError("没有指定预设，也没有当前预设");
		}
		const preset = this.#presets[resolved];
		if (preset === undefined) {
			throw new StEjsDataError(`没有预设 ${resolved}`);
		}
		return cloneJson(preset);
	}

	/** 快捷回复集；省略名称时返回全部。 */
	getQuickReplyData(
		name?: string,
	): StEjsQuickReplySet | readonly StEjsQuickReplySet[] {
		if (name === undefined) return cloneJson(this.#quickReplies);
		const set = this.#findSet(name);
		return cloneJson(set);
	}

	/** 按标签读取一条快捷回复的正文；`getqr(set, label)` 限定集合。 */
	getQuickReply(setOrLabel: string, label?: string): string {
		if (label === undefined) {
			for (const set of this.#quickReplies) {
				const reply = set.replies.find((item) => item.label === setOrLabel);
				if (reply !== undefined) return reply.message;
			}
			throw new StEjsDataError(`没有标签为 ${setOrLabel} 的快捷回复`);
		}
		const set = this.#findSet(setOrLabel);
		const reply = set.replies.find((item) => item.label === label);
		if (reply === undefined) {
			throw new StEjsDataError(`快捷回复集 ${setOrLabel} 里没有 ${label}`);
		}
		return reply.message;
	}

	#requireCharacter(): StCharacterCard {
		if (this.#character === null) {
			throw new StEjsDataError("没有提供角色卡");
		}
		return this.#character;
	}

	#findSet(name: string): StEjsQuickReplySet {
		const set = this.#quickReplies.find((item) => item.name === name);
		if (set === undefined) {
			throw new StEjsDataError(`没有快捷回复集 ${name}`);
		}
		return set;
	}
}

/** 兼容酒馆快捷回复条目的常见字段名。 */
export function normalizeStEjsQuickReplySet(
	name: string,
	input: unknown,
): StEjsQuickReplySet {
	if (typeof name !== "string" || name.length === 0) {
		throw new StEjsDataError("快捷回复集需要非空名称");
	}
	if (!isJsonObject(input)) {
		throw new StEjsDataError(`快捷回复集 ${name} 必须是对象`);
	}
	const list = input.qrList;
	if (!Array.isArray(list)) {
		throw new StEjsDataError(`快捷回复集 ${name} 缺少 qrList 数组`);
	}
	const replies = list.map((item, index) => {
		if (!isJsonObject(item)) {
			throw new StEjsDataError(
				`快捷回复集 ${name} 的第 ${index + 1} 条不是对象`,
			);
		}
		const label = item.label;
		const message = item.message;
		if (typeof label !== "string") {
			throw new StEjsDataError(
				`快捷回复集 ${name} 的第 ${index + 1} 条缺少 label`,
			);
		}
		if (typeof message !== "string") {
			throw new StEjsDataError(
				`快捷回复集 ${name} 的第 ${index + 1} 条缺少 message`,
			);
		}
		const id = item.id;
		if (id !== undefined && typeof id !== "string" && typeof id !== "number") {
			throw new StEjsDataError(
				`快捷回复集 ${name} 的第 ${index + 1} 条 id 非法`,
			);
		}
		return {
			id: id === undefined ? null : String(id),
			label,
			message,
			raw: item,
		};
	});
	return { name, replies };
}
