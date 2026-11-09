import { setTimeout as delay } from "node:timers/promises";
import { isJsonObject } from "../json.js";
import type { LlmChannelsConfig } from "./channels.js";

export interface RerankCallOptions {
	readonly signal?: AbortSignal;
}

/** 重排序结果；`index` 是输入文档的下标，`score` 越大越相关。 */
export interface RerankScore {
	readonly index: number;
	readonly score: number;
}

/** 重排序客户端；返回的分数覆盖全部输入文档。 */
export interface RerankClient {
	rerank(
		query: string,
		documents: readonly string[],
		options?: RerankCallOptions,
	): Promise<readonly RerankScore[]>;
}

export interface OpenAiRerankClientOptions {
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly model: string;
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
const DEFAULT_TIMEOUT_MS = 30_000;

/** OpenAI 兼容的 `/rerank` 客户端：批量、限速、重试与分数校验。 */
export class OpenAiRerankClient implements RerankClient {
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

	constructor(options: OpenAiRerankClientOptions) {
		this.endpoint = `${options.baseUrl.replace(/\/+$/, "")}/rerank`;
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
			throw new Error("重排序批量大小必须是正整数");
		}
		if (
			!Number.isInteger(this.requestsPerMinute) ||
			this.requestsPerMinute < 0
		) {
			throw new Error("重排序每分钟请求数必须是不小于 0 的整数");
		}
		if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) {
			throw new Error("重排序重试次数必须是不小于 0 的整数");
		}
	}

	async rerank(
		query: string,
		documents: readonly string[],
		options: RerankCallOptions = {},
	): Promise<RerankScore[]> {
		if (typeof query !== "string" || query.trim().length === 0) {
			throw new Error("重排序查询必须是非空字符串");
		}
		if (!Array.isArray(documents)) {
			throw new Error("重排序输入必须是字符串数组");
		}
		documents.forEach((document, index) => {
			if (typeof document !== "string" || document.length === 0) {
				throw new Error(`重排序输入[${index}] 必须是非空字符串`);
			}
		});
		const scores: RerankScore[] = [];
		for (let start = 0; start < documents.length; start += this.batchSize) {
			const batch = documents.slice(start, start + this.batchSize);
			const batchScores = await this.requestBatch(query, batch, options.signal);
			scores.push(
				...batchScores.map((score) => ({
					index: score.index + start,
					score: score.score,
				})),
			);
		}
		return scores;
	}

	private async requestBatch(
		query: string,
		batch: readonly string[],
		signal: AbortSignal | undefined,
	): Promise<RerankScore[]> {
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
						query,
						documents: batch,
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
					`重排序请求失败：${error instanceof Error ? error.message : String(error)}`,
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
				throw new Error(`重排序渠道返回 ${response.status}：${body}`);
			}
			let payload: unknown;
			try {
				payload = await response.json();
			} catch (error) {
				throw new Error("重排序渠道返回的不是 JSON", { cause: error });
			}
			return this.parseResponse(payload, batch.length);
		}
	}

	private parseResponse(payload: unknown, expected: number): RerankScore[] {
		if (!isJsonObject(payload) || !Array.isArray(payload.results)) {
			throw new Error("重排序响应缺少 results 数组");
		}
		const scores: RerankScore[] = new Array(expected);
		const seen = new Set<number>();
		for (const item of payload.results) {
			if (!isJsonObject(item)) {
				throw new Error("重排序响应的 results 里只能有对象");
			}
			const index = item.index;
			if (
				typeof index !== "number" ||
				!Number.isInteger(index) ||
				index < 0 ||
				index >= expected
			) {
				throw new Error("重排序响应的 index 越界");
			}
			if (seen.has(index)) {
				throw new Error(`重排序响应的 index ${index} 重复`);
			}
			seen.add(index);
			const score = item.relevance_score;
			if (typeof score !== "number" || !Number.isFinite(score)) {
				throw new Error(
					`重排序响应[${index}] 的 relevance_score 必须是有限数字`,
				);
			}
			scores[index] = { index, score };
		}
		if (seen.size !== expected) {
			throw new Error(`重排序响应里只有 ${seen.size} 条，期望 ${expected} 条`);
		}
		return scores;
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

/** 从 `channels.yaml` 的 reranker 段创建客户端；没有配置或关闭时返回 null。 */
export function createRerankClient(
	config: LlmChannelsConfig,
): OpenAiRerankClient | null {
	const reranker = config.reranker ?? null;
	if (reranker === null || !reranker.enabled) return null;
	return new OpenAiRerankClient(reranker);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason;
}
