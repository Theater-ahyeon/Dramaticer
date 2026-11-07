import { setTimeout as delay } from "node:timers/promises";
import { isJsonObject } from "../json.js";
import type { LlmChannelsConfig } from "./channels.js";

export interface EmbeddingCallOptions {
	readonly signal?: AbortSignal;
}

/** 文本嵌入客户端；返回的向量顺序与输入一致。 */
export interface EmbeddingClient {
	readonly dimensions: number;
	embed(
		texts: readonly string[],
		options?: EmbeddingCallOptions,
	): Promise<number[][]>;
}

export interface OpenAiEmbeddingClientOptions {
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly model: string;
	readonly dimensions: number;
	readonly batchSize?: number;
	readonly requestsPerMinute?: number;
	readonly maxRetries?: number;
	readonly retryBaseDelayMs?: number;
	readonly timeoutMs?: number;
	readonly fetch?: typeof fetch;
	readonly sleep?: (
		ms: number,
		signal: AbortSignal | undefined,
	) => Promise<void>;
	readonly now?: () => number;
}

const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_REQUESTS_PER_MINUTE = 30;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 300_000;

/** OpenAI 兼容的 `/embeddings` 客户端：批量、限速、重试与维度校验。 */
export class OpenAiEmbeddingClient implements EmbeddingClient {
	readonly dimensions: number;
	private readonly endpoint: string;
	private readonly apiKey: string;
	private readonly model: string;
	private readonly batchSize: number;
	private readonly requestsPerMinute: number;
	private readonly maxRetries: number;
	private readonly retryBaseDelayMs: number;
	private readonly timeoutMs: number;
	private readonly fetch: typeof fetch;
	private readonly sleep: (
		ms: number,
		signal: AbortSignal | undefined,
	) => Promise<void>;
	private readonly now: () => number;
	private queue: Promise<void> = Promise.resolve();
	private nextAllowedAt = Number.NEGATIVE_INFINITY;

	constructor(options: OpenAiEmbeddingClientOptions) {
		if (!Number.isInteger(options.dimensions) || options.dimensions < 1) {
			throw new Error("embedding 维度必须是正整数");
		}
		this.dimensions = options.dimensions;
		this.endpoint = `${options.baseUrl.replace(/\/+$/, "")}/embeddings`;
		this.apiKey = options.apiKey;
		this.model = options.model;
		this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
		this.requestsPerMinute =
			options.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE;
		this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
		this.retryBaseDelayMs =
			options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.fetch = options.fetch ?? fetch;
		this.sleep =
			options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
		this.now = options.now ?? Date.now;
		if (!Number.isInteger(this.batchSize) || this.batchSize < 1) {
			throw new Error("embedding 批量大小必须是正整数");
		}
		if (
			!Number.isInteger(this.requestsPerMinute) ||
			this.requestsPerMinute < 0
		) {
			throw new Error("embedding 每分钟请求数必须是不小于 0 的整数");
		}
		if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) {
			throw new Error("embedding 重试次数必须是不小于 0 的整数");
		}
	}

	async embed(
		texts: readonly string[],
		options: EmbeddingCallOptions = {},
	): Promise<number[][]> {
		if (!Array.isArray(texts)) {
			throw new Error("embedding 输入必须是字符串数组");
		}
		texts.forEach((text, index) => {
			if (typeof text !== "string" || text.length === 0) {
				throw new Error(`embedding 输入[${index}] 必须是非空字符串`);
			}
		});
		const vectors: number[][] = [];
		for (let start = 0; start < texts.length; start += this.batchSize) {
			const batch = texts.slice(start, start + this.batchSize);
			vectors.push(...(await this.requestBatch(batch, options.signal)));
		}
		return vectors;
	}

	private async requestBatch(
		batch: readonly string[],
		signal: AbortSignal | undefined,
	): Promise<number[][]> {
		for (let attempt = 0; ; attempt += 1) {
			throwIfAborted(signal);
			await this.acquireSlot(signal);
			const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
			const requestSignal = signal
				? AbortSignal.any([signal, timeoutSignal])
				: timeoutSignal;
			let response: Response;
			try {
				response = await this.fetch(this.endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...(this.apiKey.length > 0
							? { Authorization: `Bearer ${this.apiKey}` }
							: {}),
					},
					body: JSON.stringify({
						model: this.model,
						input: batch,
					}),
					signal: requestSignal,
				});
			} catch (error) {
				throwIfAborted(signal);
				if (attempt < this.maxRetries) {
					await this.backoff(attempt + 1, signal);
					continue;
				}
				throw new Error(
					`embedding 请求失败：${error instanceof Error ? error.message : String(error)}`,
					{ cause: error },
				);
			}
			if (!response.ok) {
				const body = (await response.text()).slice(0, 500);
				if (
					(response.status === 429 || response.status >= 500) &&
					attempt < this.maxRetries
				) {
					await this.backoff(attempt + 1, signal);
					continue;
				}
				throw new Error(`embedding 渠道返回 ${response.status}：${body}`);
			}
			let payload: unknown;
			try {
				payload = await response.json();
			} catch (error) {
				throw new Error("embedding 渠道返回的不是 JSON", { cause: error });
			}
			return this.parseResponse(payload, batch.length);
		}
	}

	private parseResponse(payload: unknown, expected: number): number[][] {
		if (!isJsonObject(payload) || !Array.isArray(payload.data)) {
			throw new Error("embedding 响应缺少 data 数组");
		}
		const vectors: number[][] = new Array(expected);
		const seen = new Set<number>();
		for (const item of payload.data) {
			if (!isJsonObject(item)) {
				throw new Error("embedding 响应的 data 里只能有对象");
			}
			const index = item.index;
			if (
				typeof index !== "number" ||
				!Number.isInteger(index) ||
				index < 0 ||
				index >= expected
			) {
				throw new Error("embedding 响应的 index 越界");
			}
			if (seen.has(index)) {
				throw new Error(`embedding 响应的 index ${index} 重复`);
			}
			seen.add(index);
			const embedding = item.embedding;
			if (!Array.isArray(embedding)) {
				throw new Error(`embedding 响应[${index}] 缺少数字数组`);
			}
			if (embedding.length !== this.dimensions) {
				throw new Error(
					`embedding 维度必须是 ${this.dimensions}，实际为 ${embedding.length}`,
				);
			}
			vectors[index] = embedding.map((value, position) => {
				if (typeof value !== "number" || !Number.isFinite(value)) {
					throw new Error(
						`embedding 响应[${index}][${position}] 必须是有限数字`,
					);
				}
				return value;
			});
		}
		if (seen.size !== expected) {
			throw new Error(
				`embedding 响应里只有 ${seen.size} 条，期望 ${expected} 条`,
			);
		}
		return vectors;
	}

	private async acquireSlot(signal: AbortSignal | undefined): Promise<void> {
		if (this.requestsPerMinute <= 0) {
			throwIfAborted(signal);
			return;
		}
		const interval = 60_000 / this.requestsPerMinute;
		const previous = this.queue;
		const run = previous.then(async () => {
			throwIfAborted(signal);
			const wait = this.nextAllowedAt - this.now();
			if (wait > 0) await this.sleep(wait, signal);
			this.nextAllowedAt = this.now() + interval;
		});
		this.queue = run.catch(() => undefined);
		await run;
	}

	private async backoff(
		retries: number,
		signal: AbortSignal | undefined,
	): Promise<void> {
		const ms = this.retryBaseDelayMs * 2 ** (retries - 1);
		if (ms > 0) await this.sleep(ms, signal);
	}
}

/** 从 `channels.yaml` 的 embeddings 段创建客户端。 */
export function createEmbeddingClient(
	config: LlmChannelsConfig,
	alias = "default",
): OpenAiEmbeddingClient {
	const provider = config.embeddings.get(alias);
	if (provider === undefined) {
		throw new Error(
			`没有配置 embeddings.${alias}；可用项：${[...config.embeddings.keys()].join("、")}`,
		);
	}
	return new OpenAiEmbeddingClient(provider);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason;
}
