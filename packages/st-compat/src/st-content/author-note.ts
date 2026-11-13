import type { JsonValue, LlmRole } from "@dramaticer/core";
import { isJsonObject } from "@dramaticer/core";
import { optionalNumber, readString } from "../field-readers.js";

/**
 * 酒馆的作者注释位置：0 在提示词内（主提示之后），1 在聊天内按深度注入，
 * 2 在主提示之前。默认在聊天内、深度 4。
 */
export type StAuthorNotePlacement = "in-prompt" | "in-chat" | "before-prompt";

export interface StAuthorNote {
	readonly text: string;
	/** 每隔多少条玩家消息注入一次。 */
	readonly interval: number;
	readonly placement: StAuthorNotePlacement;
	/** placement 为 in-chat 时使用的深度。 */
	readonly depth: number;
	readonly role: LlmRole;
}

const PLACEMENTS: Readonly<Record<number, StAuthorNotePlacement>> = {
	0: "in-prompt",
	1: "in-chat",
	2: "before-prompt",
};

const ROLES: Readonly<Record<number, LlmRole>> = {
	0: "system",
	1: "user",
	2: "assistant",
};

/** 读取聊天头部 `chat_metadata` 里的作者注释；没有正文时返回 null。 */
export function readStAuthorNote(
	metadata: JsonValue | undefined,
): StAuthorNote | null {
	if (metadata === undefined || metadata === null) return null;
	if (!isJsonObject(metadata)) {
		throw new Error("聊天元数据不是 JSON 对象，无法读取作者注释");
	}
	const text = readString(metadata, "note_prompt", "作者注释");
	if (text.trim().length === 0) return null;
	return {
		text,
		interval: readInteger(metadata, "note_interval", 1, 1),
		placement: readEnum(metadata, "note_position", PLACEMENTS, 1),
		depth: readInteger(metadata, "note_depth", 4, 0),
		role: readEnum(metadata, "note_role", ROLES, 0),
	};
}

function readInteger(
	metadata: Record<string, JsonValue>,
	key: string,
	fallback: number,
	minimum: number,
): number {
	const value = optionalNumber(metadata, key, "作者注释") ?? fallback;
	if (!Number.isInteger(value) || value < minimum) {
		throw new Error(
			`作者注释字段 "${key}" 必须是不小于 ${minimum} 的整数：${value}`,
		);
	}
	return value;
}

function readEnum<T>(
	metadata: Record<string, JsonValue>,
	key: string,
	values: Readonly<Record<number, T>>,
	fallback: number,
): T {
	const value = optionalNumber(metadata, key, "作者注释") ?? fallback;
	const mapped = values[value];
	if (mapped === undefined) {
		throw new Error(`作者注释字段 "${key}" 超出范围：${value}`);
	}
	return mapped;
}
