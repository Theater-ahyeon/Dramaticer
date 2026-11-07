import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isJsonObject } from "../json.js";

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
	readonly role: LlmRole;
	readonly content: string;
}

export interface LlmRequest {
	readonly messages: readonly LlmMessage[];
	/** 覆盖客户端默认模型。 */
	readonly model?: string;
	readonly temperature?: number;
	readonly maxTokens?: number;
	/** 原样作为 reasoning_effort 发给渠道；不支持这个参数的渠道不要设置。 */
	readonly reasoningEffort?: string;
	/** 额外请求字段；model、messages、stream 由客户端覆盖。 */
	readonly extraBody?: Readonly<Record<string, unknown>>;
	readonly signal?: AbortSignal;
}

export interface LlmUsage {
	readonly promptTokens: number | null;
	readonly completionTokens: number | null;
	readonly totalTokens: number | null;
	readonly reasoningTokens: number | null;
	readonly cachedTokens: number | null;
}

export interface LlmResult {
	readonly text: string;
	readonly reasoning: string;
	readonly finishReason: string | null;
	readonly model: string;
	readonly usage: LlmUsage;
	readonly raw: unknown;
	/** 命中本地缓存时为 true，此时没有发出网络请求。 */
	readonly cached: boolean;
	/** 实际发出的 HTTP 尝试次数；缓存命中为 0。 */
	readonly attempts: number;
}

/** 后台任务只依赖这个接口，测试可以注入假实现。 */
export interface LlmClient {
	complete(request: LlmRequest): Promise<LlmResult>;
}

export type LlmFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface OpenAiCompatibleClientOptions {
	readonly baseUrl: string;
	/** 空字符串表示不发送 Authorization 头。 */
	readonly apiKey: string;
	readonly model: string;
	/** 每分钟请求数上限，默认 30；小于等于 0 表示不限速。 */
	readonly requestsPerMinute?: number;
	/** 失败后的重试次数，默认 4。 */
	readonly maxRetries?: number;
	readonly timeoutMs?: number;
	readonly retryBaseDelayMs?: number;
	/** 渠道给出的 Retry-After 超过这个毫秒数时按这个值等待，默认 60000。 */
	readonly maxRetryAfterMs?: number;
	/** 缓存目录；不设置就不缓存。 */
	readonly cacheDir?: string | null;
	readonly fetchFn?: LlmFetch;
	readonly sleep?: (
		ms: number,
		signal: AbortSignal | undefined,
	) => Promise<void>;
	readonly now?: () => number;
}

export class LlmHttpError extends Error {
	readonly status: number;
	readonly body: string;

	constructor(status: number, body: string) {
		super(
			`LLM 请求失败：HTTP ${status}${body ? `：${truncate(body, 300)}` : ""}`,
		);
		this.name = "LlmHttpError";
		this.status = status;
		this.body = body;
	}
}

export class LlmResponseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LlmResponseError";
	}
}

interface ResolvedClientOptions {
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly model: string;
	readonly requestsPerMinute: number;
	readonly maxRetries: number;
	readonly timeoutMs: number;
	readonly retryBaseDelayMs: number;
	readonly maxRetryAfterMs: number;
	readonly cacheDir: string | null;
	readonly fetchFn: LlmFetch;
	readonly sleep: (
		ms: number,
		signal: AbortSignal | undefined,
	) => Promise<void>;
	readonly now: () => number;
}

interface CacheEnvelope {
	readonly version: 1;
	readonly result: LlmResult;
}

const CACHE_VERSION = 1;

/**
 * 最小的 OpenAI 兼容 Chat Completions 客户端，只服务 M0 的后台任务。
 *
 * 负责限速、重试和按请求内容寻址的本地缓存；不解释模型名，不流式输出。
 * 缓存目录里的内容包含私有正文，只能放在被 git 忽略的目录里。
 */
export class OpenAiCompatibleClient implements LlmClient {
	private readonly options: ResolvedClientOptions;
	private queue: Promise<void> = Promise.resolve();
	private nextAllowedAt = Number.NEGATIVE_INFINITY;

	constructor(options: OpenAiCompatibleClientOptions) {
		const baseUrl = requireNonEmpty(options.baseUrl, "baseUrl").replace(
			/\/+$/,
			"",
		);
		const model = requireNonEmpty(options.model, "model");
		const requestsPerMinute = options.requestsPerMinute ?? 30;
		const maxRetries = options.maxRetries ?? 4;
		const timeoutMs = options.timeoutMs ?? 120_000;
		const retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
		const maxRetryAfterMs = options.maxRetryAfterMs ?? 60_000;
		if (!Number.isFinite(requestsPerMinute)) {
			throw new Error("requestsPerMinute 必须是数字");
		}
		if (!Number.isInteger(maxRetries) || maxRetries < 0) {
			throw new Error("maxRetries 必须是非负整数");
		}
		if (!(timeoutMs > 0)) {
			throw new Error("timeoutMs 必须是正数");
		}
		if (!(retryBaseDelayMs >= 0)) {
			throw new Error("retryBaseDelayMs 不能是负数");
		}
		if (!(maxRetryAfterMs > 0)) {
			throw new Error("maxRetryAfterMs 必须是正数");
		}
		this.options = {
			baseUrl,
			apiKey: options.apiKey,
			model,
			requestsPerMinute,
			maxRetries,
			timeoutMs,
			retryBaseDelayMs,
			maxRetryAfterMs,
			cacheDir: options.cacheDir ?? null,
			fetchFn: options.fetchFn ?? ((url, init) => fetch(url, init)),
			sleep:
				options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal })),
			now: options.now ?? Date.now,
		};
	}

	async complete(request: LlmRequest): Promise<LlmResult> {
		if (request.messages.length === 0) {
			throw new Error("messages 不能为空");
		}
		const model = request.model ?? this.options.model;
		const body: Record<string, unknown> = {
			...request.extraBody,
			model,
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
		if (request.reasoningEffort !== undefined) {
			body.reasoning_effort = request.reasoningEffort;
		}

		const cacheKey = this.cacheKey(body);
		const cached = await this.readCache(cacheKey);
		if (cached) return cached;

		const url = `${this.options.baseUrl}/chat/completions`;
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.options.apiKey.length > 0) {
			headers.Authorization = `Bearer ${this.options.apiKey}`;
		}

		for (let attempt = 1; ; attempt += 1) {
			await this.acquireSlot(request.signal);
			let response: Response;
			try {
				response = await this.options.fetchFn(url, {
					method: "POST",
					headers,
					body: JSON.stringify(body),
					signal: this.requestSignal(request.signal),
				});
			} catch (error) {
				throwIfAborted(request.signal);
				if (!this.shouldRetry(error, attempt, request.signal)) throw error;
				await this.backoff(attempt, null, request.signal);
				continue;
			}

			if (!response.ok) {
				const errorBody = await response.text();
				throwIfAborted(request.signal);
				const error = new LlmHttpError(response.status, errorBody);
				if (!this.shouldRetry(error, attempt, request.signal)) throw error;
				await this.backoff(
					attempt,
					response.headers.get("retry-after"),
					request.signal,
				);
				continue;
			}

			const payload = await this.readPayload(response);
			const result = parseCompletion(payload, model, attempt);
			await this.writeCache(cacheKey, result);
			return result;
		}
	}

	/** 2xx 的响应体只读一次：JSON 语法错误包装成 LlmResponseError，中止与超时等读取错误原样抛出。 */
	private async readPayload(response: Response): Promise<unknown> {
		try {
			return await response.json();
		} catch (error) {
			if (error instanceof SyntaxError) {
				throw new LlmResponseError(`渠道返回的不是 JSON：${error.message}`);
			}
			throw error;
		}
	}

	private requestSignal(signal: AbortSignal | undefined): AbortSignal {
		const timeout = AbortSignal.timeout(this.options.timeoutMs);
		return signal ? AbortSignal.any([signal, timeout]) : timeout;
	}

	private shouldRetry(
		error: unknown,
		attempt: number,
		signal: AbortSignal | undefined,
	): boolean {
		if (attempt > this.options.maxRetries) return false;
		if (signal?.aborted) return false;
		if (error instanceof LlmHttpError) {
			return error.status === 429 || error.status >= 500;
		}
		if (error instanceof Error) {
			return error.name === "TimeoutError" || error.name === "TypeError";
		}
		return false;
	}

	private async backoff(
		attempt: number,
		retryAfter: string | null,
		signal: AbortSignal | undefined,
	): Promise<void> {
		const requested = parseRetryAfter(retryAfter, this.options.now());
		const exponential = this.options.retryBaseDelayMs * 2 ** (attempt - 1);
		const ms =
			requested === null
				? exponential
				: Math.min(requested, this.options.maxRetryAfterMs);
		await this.wait(ms, signal);
	}

	private async wait(
		ms: number,
		signal: AbortSignal | undefined,
	): Promise<void> {
		throwIfAborted(signal);
		if (ms <= 0) return;
		await this.options.sleep(ms, signal);
	}

	/** 串行排队，保证相邻请求的起点至少间隔 60 秒除以每分钟请求数。 */
	private acquireSlot(signal: AbortSignal | undefined): Promise<void> {
		if (this.options.requestsPerMinute <= 0) {
			throwIfAborted(signal);
			return Promise.resolve();
		}
		const interval = 60_000 / this.options.requestsPerMinute;
		const run = this.queue.then(async () => {
			throwIfAborted(signal);
			const wait = this.nextAllowedAt - this.options.now();
			await this.wait(wait, signal);
			this.nextAllowedAt = this.options.now() + interval;
		});
		this.queue = run.catch(() => undefined);
		return run;
	}

	private cacheKey(body: Record<string, unknown>): string {
		const keyDigest = createHash("sha256")
			.update(this.options.apiKey)
			.digest("hex");
		return createHash("sha256")
			.update(this.options.baseUrl)
			.update("\n")
			.update(keyDigest)
			.update("\n")
			.update(stableJson(body) ?? "")
			.digest("hex");
	}

	private async readCache(key: string): Promise<LlmResult | null> {
		if (!this.options.cacheDir) return null;
		const file = path.join(this.options.cacheDir, `${key}.json`);
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

	private async writeCache(key: string, result: LlmResult): Promise<void> {
		if (!this.options.cacheDir) return;
		await mkdir(this.options.cacheDir, { recursive: true });
		const envelope: CacheEnvelope = { version: CACHE_VERSION, result };
		await writeFile(
			path.join(this.options.cacheDir, `${key}.json`),
			`${JSON.stringify(envelope)}\n`,
			"utf8",
		);
	}
}

function parseCompletion(
	payload: unknown,
	requestedModel: string,
	attempts: number,
): LlmResult {
	if (!isJsonObject(payload)) {
		throw new LlmResponseError("渠道响应不是对象");
	}
	if (payload.error !== undefined && payload.error !== null) {
		throw new LlmResponseError(
			`渠道响应里带错误：${truncate(JSON.stringify(payload.error), 500)}`,
		);
	}
	const choices = payload.choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new LlmResponseError("渠道响应缺少 choices");
	}
	const choice = choices[0];
	if (!isJsonObject(choice)) {
		throw new LlmResponseError("choices[0] 不是对象");
	}
	const message = isJsonObject(choice.message) ? choice.message : {};
	const text = readContent(message.content);
	const reasoning =
		readString(message.reasoning_content) ??
		readString(message.reasoning) ??
		"";
	const finishReason = readString(choice.finish_reason);
	const usage = isJsonObject(payload.usage)
		? parseUsage(payload.usage)
		: {
				promptTokens: null,
				completionTokens: null,
				totalTokens: null,
				reasoningTokens: null,
				cachedTokens: null,
			};
	const model = readString(payload.model) ?? requestedModel;
	return {
		text,
		reasoning,
		finishReason,
		model,
		usage,
		raw: payload,
		cached: false,
		attempts,
	};
}

/** 部分渠道（尤其带思考的）把 content 返回成内容块数组。 */
function readContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	const parts: string[] = [];
	for (const part of value) {
		if (typeof part === "string") {
			parts.push(part);
			continue;
		}
		if (!isJsonObject(part)) continue;
		const text = readString(part.text);
		if (text !== null) parts.push(text);
	}
	return parts.join("");
}

function parseUsage(usage: Record<string, unknown>): LlmUsage {
	const completionDetails = isJsonObject(usage.completion_tokens_details)
		? usage.completion_tokens_details
		: {};
	const promptDetails = isJsonObject(usage.prompt_tokens_details)
		? usage.prompt_tokens_details
		: {};
	return {
		promptTokens: readNumber(usage.prompt_tokens),
		completionTokens: readNumber(usage.completion_tokens),
		totalTokens: readNumber(usage.total_tokens),
		reasoningTokens:
			readNumber(completionDetails.reasoning_tokens) ??
			readNumber(usage.reasoning_tokens),
		cachedTokens: readNumber(promptDetails.cached_tokens),
	};
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
		model: typeof value.model === "string" ? value.model : "",
		usage,
		raw: value.raw,
		cached: false,
		attempts: 0,
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

function parseRetryAfter(value: string | null, nowMs: number): number | null {
	if (!value) return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
	const date = Date.parse(value);
	if (Number.isFinite(date)) return Math.max(0, date - nowMs);
	return null;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason;
}

function isMissingFile(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}

function readString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requireNonEmpty(value: string, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value;
}

function truncate(value: string, limit: number): string {
	return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}
