import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject } from "../json.js";
import type { LlmRequest, LlmResult, LlmUsage } from "./types.js";

const CACHE_VERSION = 1;

export interface CacheIdentity {
	readonly baseUrl: string;
	readonly apiKey: string;
}

interface CacheEnvelope {
	readonly version: 1;
	readonly result: LlmResult;
}

/**
 * 与旧后台客户端保持一致：按渠道、模型与请求内容寻址，
 * 因此迁移后仍能读取 eval-private/llm-cache 里已有的结果。
 */
export function requestCacheKey(
	identity: CacheIdentity,
	modelId: string,
	request: LlmRequest,
): string {
	const body: Record<string, unknown> = {
		model: modelId,
		messages: request.messages.map((message) => ({
			role: message.role,
			content: message.content,
		})),
		stream: false,
	};
	if (request.temperature !== undefined) {
		body.temperature = request.temperature;
	}
	if (request.maxTokens !== undefined) {
		body.max_tokens = request.maxTokens;
	}
	if (request.reasoning !== undefined) {
		body.reasoning_effort = request.reasoning;
	}
	const keyDigest = createHash("sha256").update(identity.apiKey).digest("hex");
	return createHash("sha256")
		.update(identity.baseUrl.replace(/\/+$/, ""))
		.update("\n")
		.update(keyDigest)
		.update("\n")
		.update(stableJson(body) ?? "")
		.digest("hex");
}

export async function readCachedResult(
	cacheDir: string,
	key: string,
): Promise<LlmResult | null> {
	const file = path.join(cacheDir, `${key}.json`);
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch (error) {
		if (isMissingFile(error)) return null;
		throw error;
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isJsonObject(value) || value.version !== CACHE_VERSION) return null;
	const result = parseCachedResult(value.result);
	return result ? { ...result, cached: true, attempts: 0 } : null;
}

export async function writeCachedResult(
	cacheDir: string,
	key: string,
	result: LlmResult,
): Promise<void> {
	await mkdir(cacheDir, { recursive: true });
	const envelope: CacheEnvelope = {
		version: CACHE_VERSION,
		result: { ...result, continuation: null },
	};
	await writeFile(
		path.join(cacheDir, `${key}.json`),
		`${JSON.stringify(envelope)}\n`,
		"utf8",
	);
}

function parseCachedResult(value: unknown): LlmResult | null {
	if (!isJsonObject(value)) return null;
	if (typeof value.text !== "string") return null;
	if (typeof value.reasoning !== "string") return null;
	if (!isJsonObject(value.usage)) return null;
	const usage: LlmUsage = {
		promptTokens: readNumber(value.usage.promptTokens),
		completionTokens: readNumber(value.usage.completionTokens),
		totalTokens: readNumber(value.usage.totalTokens),
		reasoningTokens: readNumber(value.usage.reasoningTokens),
		cachedTokens: readNumber(value.usage.cachedTokens),
	};
	return {
		text: value.text,
		reasoning: value.reasoning,
		finishReason:
			typeof value.finishReason === "string" ? value.finishReason : null,
		stopReason: isStopReason(value.stopReason) ? value.stopReason : "stop",
		model: typeof value.model === "string" ? value.model : "",
		channel: typeof value.channel === "string" ? value.channel : null,
		usage,
		raw: value.raw,
		cached: false,
		attempts: 0,
		rounds:
			typeof value.rounds === "number" &&
			Number.isInteger(value.rounds) &&
			value.rounds > 0
				? value.rounds
				: 1,
		truncation: isTruncationReason(value.truncation) ? value.truncation : null,
		continuation: null,
	};
}

/**
 * 与 JSON.stringify 语义一致：对象里值为 undefined 的属性被丢弃，数组里的空位与
 * undefined 变成 null，Date 与带 toJSON 的对象交给 JSON.stringify。
 */
function stableJson(value: unknown): string | undefined {
	if (Array.isArray(value)) {
		const parts: string[] = [];
		for (let index = 0; index < value.length; index += 1) {
			parts.push(stableJson(value[index]) ?? "null");
		}
		return `[${parts.join(",")}]`;
	}
	if (isPlainObject(value)) {
		const parts: string[] = [];
		for (const key of Object.keys(value).sort()) {
			const item = stableJson(value[key]);
			if (item === undefined) continue;
			parts.push(`${JSON.stringify(key)}:${item}`);
		}
		return `{${parts.join(",")}}`;
	}
	return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function isMissingFile(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

function isStopReason(value: unknown): value is LlmResult["stopReason"] {
	return (
		value === "stop" ||
		value === "length" ||
		value === "toolUse" ||
		value === "error" ||
		value === "aborted"
	);
}

function isTruncationReason(
	value: unknown,
): value is NonNullable<LlmResult["truncation"]> {
	return (
		value === "length" || value === "unclosed_tag" || value === "abrupt_end"
	);
}

function readNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
