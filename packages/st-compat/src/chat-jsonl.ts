import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import {
	type JsonObject,
	type JsonValue,
	isJsonObject,
} from "@dramaticer/core";

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

/** 一份完整的聊天记录；每条消息的 `raw` 保留未识别字段，序列化时原样写回。 */
export interface StChatDocument {
	readonly header: StChatHeader;
	readonly messages: readonly StChatMessage[];
}

export interface ChatJsonlParseOptions {
	/**
	 * swipe_id 越界或不是非负整数时是否抛错。默认抛错，避免导入时静默丢弃状态；
	 * 只读分析传 false，把无法对应的 swipe_id 记为 null。
	 */
	readonly strictSwipeId?: boolean;
}

interface SourceLine {
	readonly line: string;
	readonly lineNumber: number;
}

/** 把任意切分的字符串块还原成行；跨块的换行和多字节序列都在这里处理 */
async function* splitChatLines(
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
				line: stripCarriageReturn(rawLine),
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
			line: stripCarriageReturn(pending),
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
	options: ChatJsonlParseOptions = {},
): AsyncGenerator<StChatEntry, void, undefined> {
	const strictSwipeId = options.strictSwipeId ?? true;
	let header: StChatHeader | null = null;
	let messageIndex = 0;
	for await (const { line, lineNumber } of splitChatLines(chunks)) {
		const record = parseRecord(
			lineNumber === 1 && line.charCodeAt(0) === 0xfeff ? line.slice(1) : line,
			lineNumber,
		);
		if (header === null) {
			header = toHeader(record);
			yield { kind: "header", header };
			continue;
		}
		yield {
			kind: "message",
			message: toMessage(record, messageIndex, lineNumber, strictSwipeId),
		};
		messageIndex += 1;
	}
	if (header === null) {
		throw new Error("聊天记录为空：缺少头部");
	}
}

export async function* parseChatJsonlFile(
	path: string,
	options: ChatJsonlParseOptions = {},
): AsyncGenerator<StChatEntry, void, undefined> {
	try {
		yield* parseChatJsonl(readUtf8Chunks(path), options);
	} catch (error) {
		throw new Error(`解析聊天文件失败：${path}`, { cause: error });
	}
}

/** 收集整份聊天记录；与逐行解析共用同一套字段与校验。 */
export async function collectChatDocument(
	entries: AsyncIterable<StChatEntry> | Iterable<StChatEntry>,
): Promise<StChatDocument> {
	let header: StChatHeader | null = null;
	const messages: StChatMessage[] = [];
	for await (const entry of entries) {
		if (entry.kind === "header") {
			if (header !== null) throw new Error("聊天记录里出现了第二个头部");
			header = entry.header;
			continue;
		}
		messages.push(entry.message);
	}
	if (header === null) throw new Error("聊天记录为空：缺少头部");
	return { header, messages };
}

export async function parseChatDocument(
	chunks: AsyncIterable<string> | Iterable<string>,
	options: ChatJsonlParseOptions = {},
): Promise<StChatDocument> {
	return collectChatDocument(parseChatJsonl(chunks, options));
}

export async function parseChatDocumentFile(
	path: string,
	options: ChatJsonlParseOptions = {},
): Promise<StChatDocument> {
	return collectChatDocument(parseChatJsonlFile(path, options));
}

/** 用原始记录构造文档；导出器先生成原始对象，再走与解析相同的字段规则。 */
export function createChatDocument(
	header: JsonObject,
	messages: readonly JsonObject[],
): StChatDocument {
	return {
		header: toHeader(header),
		messages: messages.map((raw, index) =>
			toMessage(raw, index, index + 2, true),
		),
	};
}

/**
 * 序列化成 ST 的 jsonl：一行头部，之后一行一条消息。
 * 每行直接写回原始记录，未识别字段与字段顺序之外的差异不会丢失。
 */
export function serializeChatJsonl(document: StChatDocument): string {
	const lines = [
		JSON.stringify(document.header.raw),
		...document.messages.map((message) => JSON.stringify(message.raw)),
	];
	return `${lines.join("\n")}\n`;
}

export async function writeChatJsonlFile(
	path: string,
	document: StChatDocument,
): Promise<void> {
	await writeFile(path, serializeChatJsonl(document), "utf8");
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

function toMessage(
	raw: JsonObject,
	index: number,
	lineNumber: number,
	strictSwipeId: boolean,
): StChatMessage {
	const swipes = toSwipes(raw);
	const swipeId = readSwipeId(
		raw.swipe_id,
		swipes.length,
		lineNumber,
		strictSwipeId,
	);
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
		swipes,
		swipeId,
		reasoning: readReasoning(raw.extra),
		variables: variables[swipeId ?? 0] ?? null,
		raw,
	};
}

/**
 * swipe_id 决定主路径节点 id 与 MVU 快照的下标，越界或非整数时无法可靠还原，
 * 直接报错，避免静默丢弃某个 swipe 的状态。
 */
function readSwipeId(
	value: JsonValue | undefined,
	swipeCount: number,
	lineNumber: number,
	strict: boolean,
): number | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		if (!strict) return null;
		throw new Error(
			`第 ${lineNumber} 行的 swipe_id 必须是非负整数：${JSON.stringify(value)}`,
		);
	}
	if (value >= Math.max(swipeCount, 1)) {
		if (!strict) return null;
		throw new Error(
			`第 ${lineNumber} 行的 swipe_id ${value} 超出范围（共 ${swipeCount} 个 swipe）`,
		);
	}
	return value;
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
