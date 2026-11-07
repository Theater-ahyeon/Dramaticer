import { readFile } from "node:fs/promises";
import { decode as decodeText } from "png-chunk-text";
import type { DecodedText } from "png-chunk-text";
import extractChunks from "png-chunks-extract";
import type { PngChunk } from "png-chunks-extract";
import type { JsonObject } from "./json.js";
import { isJsonObject } from "./json.js";

export type StCardSpec = "chara_card_v1" | "chara_card_v2" | "chara_card_v3";

export interface StCharacterCard {
	readonly spec: StCardSpec;
	/** 卡里写的 spec_version，缺失时为 null */
	readonly specVersion: string | null;
	readonly name: string;
	readonly description: string;
	readonly personality: string;
	readonly scenario: string;
	readonly firstMessage: string;
	readonly messageExample: string;
	readonly creatorNotes: string;
	readonly systemPrompt: string;
	readonly postHistoryInstructions: string;
	readonly alternateGreetings: readonly string[];
	readonly groupOnlyGreetings: readonly string[];
	/** V3 的 nickname，V2 和 V1 缺失时为 null */
	readonly nickname: string | null;
	readonly tags: readonly string[];
	readonly creator: string;
	readonly characterVersion: string;
	/** 内嵌世界书，未经解析，原样保留；没有时为 null */
	readonly characterBook: JsonObject | null;
	/** 卡作者扩展字段，原样保留（同一个引用） */
	readonly extensions: JsonObject;
	/** 解码后的完整卡片对象，未识别的字段都留在这里 */
	readonly raw: JsonObject;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPngData(data: Uint8Array): boolean {
	if (data.length < PNG_SIGNATURE.length) return false;
	return PNG_SIGNATURE.every((byte, index) => data[index] === byte);
}

/** 解析 JSON 卡；V2 和 V3 读 data 节点，没有 spec 也没有 data 时按 V1 读根节点 */
export function parseCharacterCardJson(jsonText: string): StCharacterCard {
	const body = jsonText.charCodeAt(0) === 0xfeff ? jsonText.slice(1) : jsonText;
	let value: unknown;
	try {
		value = JSON.parse(body);
	} catch (error) {
		throw new Error("角色卡不是合法 JSON", { cause: error });
	}
	return normalizeCharacterCard(value);
}

/**
 * 解析 PNG 卡。V3 会同时写入 ccv3 和 chara 两个 tEXt 块，ccv3 优先；
 * 只有 chara 的旧卡按 JSON 里的 spec 判定版本。
 */
export function parseCharacterCardPng(data: Uint8Array): StCharacterCard {
	if (!isPngData(data)) throw new Error("不是 PNG 文件");
	let chunks: PngChunk[];
	try {
		chunks = extractChunks(data);
	} catch (error) {
		throw new Error("PNG 块读取失败", { cause: error });
	}
	const payloads = new Map<string, string>();
	for (const chunk of chunks) {
		if (chunk.name !== "tEXt") continue;
		let decoded: DecodedText;
		try {
			decoded = decodeText(chunk);
		} catch (error) {
			throw new Error("PNG tEXt 块解码失败", { cause: error });
		}
		if (decoded.keyword !== "chara" && decoded.keyword !== "ccv3") continue;
		if (!payloads.has(decoded.keyword)) {
			payloads.set(decoded.keyword, decoded.text);
		}
	}
	const entry = payloads.get("ccv3") ?? payloads.get("chara");
	if (entry === undefined) throw new Error("PNG 里没有 chara 或 ccv3 文本块");
	const jsonText = Buffer.from(entry, "base64").toString("utf8");
	try {
		return parseCharacterCardJson(jsonText);
	} catch (error) {
		throw new Error("PNG 里的角色卡数据解析失败", { cause: error });
	}
}

export async function parseCharacterCardFile(
	path: string,
): Promise<StCharacterCard> {
	const data = await readFile(path);
	try {
		return isPngData(data)
			? parseCharacterCardPng(data)
			: parseCharacterCardJson(data.toString("utf8"));
	} catch (error) {
		throw new Error(`解析角色卡失败：${path}`, { cause: error });
	}
}

function normalizeCharacterCard(value: unknown): StCharacterCard {
	if (!isJsonObject(value)) throw new Error("角色卡必须是 JSON 对象");
	const dataNode = value.data;
	let spec: StCardSpec;
	if (value.spec === undefined) {
		spec = dataNode === undefined ? "chara_card_v1" : "chara_card_v2";
	} else if (value.spec === "chara_card_v2" || value.spec === "chara_card_v3") {
		spec = value.spec;
	} else {
		throw new Error(`不支持的角色卡版本：${String(value.spec)}`);
	}
	const data =
		spec === "chara_card_v1" ? value : expectObject(dataNode, "data");
	const extensions = readExtensions(data);
	return {
		spec,
		specVersion: optionalText(value, "spec_version"),
		name: readText(data, "name"),
		description: readText(data, "description"),
		personality: readText(data, "personality"),
		scenario: readText(data, "scenario"),
		firstMessage: readText(data, "first_mes"),
		messageExample: readText(data, "mes_example"),
		creatorNotes: readCreatorNotes(data),
		systemPrompt: readText(data, "system_prompt"),
		postHistoryInstructions: readText(data, "post_history_instructions"),
		alternateGreetings: readTextList(data, "alternate_greetings"),
		groupOnlyGreetings: readTextList(data, "group_only_greetings"),
		nickname: optionalText(data, "nickname"),
		tags: readTextList(data, "tags"),
		creator: readText(data, "creator"),
		characterVersion: readText(data, "character_version"),
		characterBook: readCharacterBook(data),
		extensions,
		raw: value,
	};
}

function expectObject(value: unknown, field: string): JsonObject {
	if (!isJsonObject(value))
		throw new Error(`角色卡字段 "${field}" 不是 JSON 对象`);
	return value;
}

function readText(source: JsonObject, key: string): string {
	const value = source[key];
	if (value === undefined || value === null) return "";
	if (typeof value !== "string")
		throw new Error(`角色卡字段 "${key}" 不是字符串`);
	return value;
}

function optionalText(source: JsonObject, key: string): string | null {
	const value = source[key];
	if (value === undefined || value === null) return null;
	if (typeof value !== "string")
		throw new Error(`角色卡字段 "${key}" 不是字符串`);
	return value;
}

function readTextList(source: JsonObject, key: string): string[] {
	const value = source[key];
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw new Error(`角色卡字段 "${key}" 不是数组`);
	return value.map((item, index) => {
		if (typeof item !== "string") {
			throw new Error(`角色卡字段 "${key}[${index}]" 不是字符串`);
		}
		return item;
	});
}

/** V1 没有 data 节点，备注写在根节点的 creatorcomment 里 */
function readCreatorNotes(source: JsonObject): string {
	const notes = source.creator_notes;
	if (notes !== undefined && notes !== null) {
		return readText(source, "creator_notes");
	}
	return readText(source, "creatorcomment");
}

function readCharacterBook(source: JsonObject): JsonObject | null {
	const book = source.character_book;
	if (book === undefined || book === null) return null;
	return expectObject(book, "character_book");
}

function readExtensions(source: JsonObject): JsonObject {
	const value = source.extensions;
	if (value === undefined || value === null) return {};
	return expectObject(value, "extensions");
}
