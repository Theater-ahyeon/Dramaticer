import type { JsonObject, JsonValue, LlmRole } from "@dramaticer/core";
import { isJsonObject } from "@dramaticer/core";
import {
	optionalNumber,
	optionalString,
	readString,
} from "../field-readers.js";

/** 酒馆里一个人设档案的完整内容。 */
export interface StPersona {
	/** 活动头像文件名；没有头像时为 null。 */
	readonly avatar: string | null;
	readonly name: string;
	readonly description: string;
	readonly title: string | null;
	/** 0 提示词内、1 旧版角色之后（等同提示词内）、2 作者注释上方、3 作者注释下方、4 聊天内按深度、9 不注入。 */
	readonly position: number;
	/** 位置为 4 时使用；其余位置只保留元数据。 */
	readonly depth: number;
	/** 0 system，1 user，2 assistant。 */
	readonly role: number;
	readonly lorebook: string | null;
}

export type StPersonaPlacement =
	| "in-prompt"
	| "after-char"
	| "author-note-top"
	| "author-note-bottom"
	| "in-chat"
	| "disabled";

export interface StPersonaMappingIssue {
	readonly code: string;
	readonly detail: string;
}

export interface StPersonaMapping {
	/** 并入预设顺序时使用的酒馆 marker。 */
	readonly marker: "personaDescription";
	readonly text: string;
	readonly role: LlmRole;
	readonly placement: StPersonaPlacement;
	readonly depth: number | null;
	readonly issues: readonly StPersonaMappingIssue[];
}

const ROLE_NAMES: Readonly<Record<number, LlmRole>> = {
	0: "system",
	1: "user",
	2: "assistant",
};

const PLACEMENTS: Readonly<Record<number, StPersonaPlacement>> = {
	0: "in-prompt",
	1: "after-char",
	2: "author-note-top",
	3: "author-note-bottom",
	4: "in-chat",
	9: "disabled",
};

/**
 * 读取酒馆 `settings.json` 里的活动人设。`power_user` 缺失时按扁平结构读取，
 * 方便导入只保存了人设字段的设置文件。
 */
export function readStPersona(settings: JsonObject): StPersona | null {
	const powerUser = isJsonObject(settings.power_user)
		? settings.power_user
		: settings;
	const personas = readStringMap(powerUser, "personas", "人设");
	const descriptions = readDescriptionMap(
		powerUser,
		"persona_descriptions",
		"人设",
	);
	const avatar = readAvatar(settings);
	const legacyDescription = optionalString(
		powerUser,
		"persona_description",
		"人设",
	);
	const hasPersonaData =
		avatar !== null ||
		Object.keys(personas).length > 0 ||
		Object.keys(descriptions).length > 0 ||
		(legacyDescription !== null && legacyDescription.length > 0);
	if (!hasPersonaData) return null;

	const entry = avatar === null ? undefined : descriptions[avatar];
	const description =
		typeof entry === "string"
			? entry
			: isJsonObject(entry)
				? readString(entry, "description", "人设")
				: (legacyDescription ?? "");
	const title =
		entry !== null && typeof entry === "object" && !Array.isArray(entry)
			? optionalString(entry, "title", "人设")
			: null;
	const avatarName =
		avatar !== null && personas[avatar] !== undefined ? personas[avatar] : null;
	const username = optionalString(settings, "username", "人设");
	const name = avatarName ?? username ?? "User";

	return {
		avatar,
		name,
		description,
		title,
		position: readBoundedInteger(
			entry,
			powerUser,
			"position",
			"persona_description_position",
			0,
			[0, 1, 2, 3, 4, 9],
			"人设",
		),
		depth: readBoundedInteger(
			entry,
			powerUser,
			"depth",
			"persona_description_depth",
			2,
			null,
			"人设",
		),
		role: readBoundedInteger(
			entry,
			powerUser,
			"role",
			"persona_description_role",
			0,
			[0, 1, 2],
			"人设",
		),
		lorebook: readNullableText(
			entry,
			powerUser,
			"lorebook",
			"persona_description_lorebook",
			"人设",
		),
	};
}

/** 把活动人设映射为原生 persona 文本，并列出原生模板暂时表达不了的部分。 */
export function mapStPersona(persona: StPersona): StPersonaMapping {
	const issues: StPersonaMappingIssue[] = [];
	const placement = PLACEMENTS[persona.position];
	if (placement === undefined) {
		throw new Error(`人设位置超出范围：${persona.position}`);
	}
	if (placement === "author-note-top" || placement === "author-note-bottom") {
		issues.push({
			code: `persona-${placement}`,
			detail: "原生模板无法相对作者注释定位",
		});
	}
	const role = ROLE_NAMES[persona.role];
	if (role === undefined) {
		throw new Error(`人设角色超出范围：${persona.role}`);
	}
	if (persona.lorebook !== null) {
		issues.push({
			code: "persona-lorebook",
			detail: `关联世界书 ${persona.lorebook.length} 字符`,
		});
	}
	return {
		marker: "personaDescription",
		text: persona.description,
		role,
		placement,
		depth: placement === "in-chat" ? persona.depth : null,
		issues,
	};
}

function readAvatar(settings: JsonObject): string | null {
	const avatar = optionalString(settings, "user_avatar", "人设");
	if (
		avatar === null ||
		avatar.trim().length === 0 ||
		avatar === "undefined" ||
		avatar === "none"
	) {
		return null;
	}
	return avatar;
}

function readStringMap(
	source: JsonObject,
	key: string,
	context: string,
): Readonly<Record<string, string>> {
	const value = source[key];
	if (value === undefined || value === null) return {};
	if (!isJsonObject(value)) {
		throw new Error(`${context}字段 "${key}" 不是 JSON 对象`);
	}
	const result: Record<string, string> = {};
	for (const [name, entry] of Object.entries(value)) {
		if (typeof entry !== "string") {
			throw new Error(`${context}字段 "${key}.${name}" 不是字符串`);
		}
		result[name] = entry;
	}
	return result;
}

function readDescriptionMap(
	source: JsonObject,
	key: string,
	context: string,
): Readonly<Record<string, JsonValue | JsonObject>> {
	const value = source[key];
	if (value === undefined || value === null) return {};
	if (!isJsonObject(value)) {
		throw new Error(`${context}字段 "${key}" 不是 JSON 对象`);
	}
	return value;
}

/**
 * 优先读人设自己的字段，缺失时读全局设置；全局字段缺失时用默认值。
 * 两边都出现但类型不对时立刻报错，不做静默回退。
 */
function readBoundedInteger(
	entry: JsonValue | JsonObject | undefined,
	fallbackSource: JsonObject,
	entryKey: string,
	fallbackKey: string,
	defaultValue: number,
	allowed: readonly number[] | null,
	context: string,
): number {
	const fromEntry =
		entry !== null && typeof entry === "object" && !Array.isArray(entry)
			? optionalNumber(entry, entryKey, context)
			: null;
	const fromFallback = optionalNumber(fallbackSource, fallbackKey, context);
	const value = fromEntry ?? fromFallback ?? defaultValue;
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${context}字段 "${entryKey}" 必须是非负整数：${value}`);
	}
	if (allowed !== null && !allowed.includes(value)) {
		throw new Error(
			`${context}字段 "${entryKey}" 超出范围：${value}（只允许 ${allowed.join("、")}）`,
		);
	}
	return value;
}

function readNullableText(
	entry: JsonValue | JsonObject | undefined,
	fallbackSource: JsonObject,
	entryKey: string,
	fallbackKey: string,
	context: string,
): string | null {
	const fromEntry =
		entry !== null && typeof entry === "object" && !Array.isArray(entry)
			? optionalString(entry, entryKey, context)
			: null;
	const value =
		fromEntry ?? optionalString(fallbackSource, fallbackKey, context);
	if (value === null || value.trim().length === 0) return null;
	return value;
}
