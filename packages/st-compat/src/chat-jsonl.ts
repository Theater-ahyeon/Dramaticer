import { createReadStream } from "node:fs";
import type { JsonObject, JsonValue } from "./json.js";
import { isJsonObject } from "./json.js";

export interface StChatHeader {
	readonly characterName: string | null;
	readonly userName: string | null;
	readonly chatMetadata: JsonValue;
	readonly raw: JsonObject;
}

export interface StSwipe {
	readonly index: number;
	readonly text: string;
	/** swipe_info[index]，原始值 */
	readonly info: JsonValue;
	/** variables[index]，这一条 swipe 的 MVU 变量快照 */
	readonly variables: JsonValue;
}

export interface StChatMessage {
	/** 从 0 开始的消息序号，不含头部 */
	readonly index: number;
	readonly name: string;
	readonly isUser: boolean;
	readonly isSystem: boolean;
	readonly sendDate: string | number | null;
	/** 当前显示的正文，即 mes；编辑过的消息可能不等于 swipes[swipeId] */
	readonly text: string;
	readonly swipes: readonly StSwipe[];
	readonly swipeId: number | null;
	/** extra.reasoning */
	readonly reasoning: string | null;
	/** 当前 swipe 对应的 MVU 变量快照 */
	readonly variables: JsonValue;
	/** 原始记录完整对象，未识别的字段原样保留在这里 */
	readonly raw: JsonObject;
}

export type StChatEntry =
	| { readonly kind: "header"; readonly header: StChatHeader }
	| { readonly kind: "message"; readonly message: StChatMessage };

export interface SourceLine {
	readonly line: string;
	readonly lineNumber: number;
}

/** 把任意切分的字符串块还原成行；跨块的换行和多字节序列都在这里处理 */
export async function* splitChatLines(
	chunks: AsyncIterable<string> | Iterable<string>,
): AsyncGenerator<SourceLine, void, undefined> {
	let pending = "";
	let lineNumber = 0;
	for await (const chunk of chunks) {
		let start = 0;
		for (let i = 0; i < chunk.length; i += 1) {
			if (chunk.charCodeAt(i) !== 10) continue;
			lineNumber += 1;
			const rawLine = pending + chunk.slice(start, i);
			yield {
				line: rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine,
				lineNumber,
			};
			pending = "";
			start = i + 1;
		}
		pending += chunk.slice(start);
	}
	if (pending.length > 0) {
		lineNumber += 1;
		yield {
			line: pending.endsWith("\r") ? pending.slice(0, -1) : pending,
			lineNumber,
		};
	}
}

/**
 * 逐行解析 ST 聊天 jsonl：第一行是头部，之后每行一条消息。
 * 整个文件不会被一次性读入内存，单行长度没有上限。
 */
export async function* parseChatJsonl(
	chunks: AsyncIterable<string> | Iterable<string>,
): AsyncGenerator<StChatEntry, void, undefined> {
	let header: StChatHeader | null = null;
	let messageIndex = 0;
	for await (const { line, lineNumber } of splitChatLines(chunks)) {
		const record = parseRecord(line, lineNumber);
		if (header === null) {
			header = toHeader(record);
			yield { kind: "header", header };
			continue;
		}
		yield { kind: "message", message: toMessage(record, messageIndex) };
		messageIndex += 1;
	}
	if (header === null) {
		throw new Error("聊天记录为空：缺少头部");
	}
}

export async function* parseChatJsonlFile(
	path: string,
): AsyncGenerator<StChatEntry, void, undefined> {
	try {
		yield* parseChatJsonl(readUtf8Chunks(path));
	} catch (error) {
		throw new Error(`解析聊天文件失败：${path}`, { cause: error });
	}
}

async function* readUtf8Chunks(
	path: string,
): AsyncGenerator<string, void, undefined> {
	const stream = createReadStream(path, { encoding: "utf8" });
	for await (const chunk of stream) {
		yield chunk as string;
	}
}

function stripCarriageReturn(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function parseRecord(line: string, lineNumber: number): JsonObject {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch (error) {
		throw new Error(`第 ${lineNumber} 行不是合法 JSON`, { cause: error });
	}
	if (!isJsonObject(value)) {
		throw new Error(`第 ${lineNumber} 行不是 JSON 对象`);
	}
	return value;
}

function toHeader(raw: JsonObject): StChatHeader {
	return {
		characterName: optionalString(raw.character_name),
		userName: optionalString(raw.user_name),
		chatMetadata: raw.chat_metadata ?? null,
		raw,
	};
}

function toMessage(raw: JsonObject, index: number): StChatMessage {
	const swipeId = typeof raw.swipe_id === "number" ? raw.swipe_id : null;
	const variables = Array.isArray(raw.variables) ? raw.variables : [];
	return {
		index,
		name: optionalString(raw.name) ?? "",
		isUser: raw.is_user === true,
		isSystem: raw.is_system === true,
		sendDate:
			typeof raw.send_date === "string" || typeof raw.send_date === "number"
				? raw.send_date
				: null,
		text: optionalString(raw.mes) ?? "",
		swipes: toSwipes(raw),
		swipeId,
		reasoning: readReasoning(raw.extra),
		variables: variables[swipeId ?? 0] ?? null,
		raw,
	};
}

function toSwipes(raw: JsonObject): StSwipe[] {
	if (!Array.isArray(raw.swipes)) return [];
	const infos = Array.isArray(raw.swipe_info) ? raw.swipe_info : [];
	const variables = Array.isArray(raw.variables) ? raw.variables : [];
	return raw.swipes.map((text, index) => ({
		index,
		text: optionalString(text) ?? "",
		info: infos[index] ?? null,
		variables: variables[index] ?? null,
	}));
}

function readReasoning(extra: JsonValue | undefined): string | null {
	if (!isJsonObject(extra)) return null;
	return optionalString(extra.reasoning);
}

function optionalString(value: JsonValue | undefined): string | null {
	return typeof value === "string" ? value : null;
}
