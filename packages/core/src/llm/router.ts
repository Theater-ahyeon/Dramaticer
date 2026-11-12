import { setTimeout as delay } from "node:timers/promises";
import { createTokenEstimator } from "../tokens.js";
import {
	readCachedResult,
	requestCacheKey,
	writeCachedResult,
} from "./cache.js";
import { createEventStream } from "./event-stream.js";
import {
	type ResolvedContinuationOptions,
	detectTruncation,
	resolveContinuationOptions,
} from "./truncation.js";
import {
	LlmAllChannelsFailedError,
	type LlmCallOptions,
	type LlmChannel,
	type LlmChannelFailure,
	type LlmModelInfo,
	LlmProviderError,
	type LlmProviderRequest,
	type LlmProviderResult,
	type LlmProviderStreamEvent,
	type LlmRequest,
	type LlmResult,
	type LlmStream,
	type LlmStreamEvent,
	type LlmStreamingClient,
	type LlmTruncationReason,
	type LlmUsage,
} from "./types.js";

export interface LlmRoute {
	readonly model: LlmModelInfo;
	/** 渠道 id，按优先级从高到低。 */
	readonly channels: readonly string[];
}

export interface LlmRouterOptions {
	readonly channels: ReadonlyMap<string, LlmChannel>;
	readonly routes: ReadonlyMap<string, LlmRoute>;
	/** 请求不指定 model 时使用的模型别名；只有一个模型时可以省略。 */
	readonly defaultModel?: string;
	readonly cacheDir?: string | null;
	readonly sleep?: (
		ms: number,
		signal: AbortSignal | undefined,
	) => Promise<void>;
	readonly now?: () => number;
}

/** 同一模型多渠道、重试、截断续写与缓存的路由层。 */
export class LlmRouter implements LlmStreamingClient {
	private readonly channels: ReadonlyMap<string, LlmChannel>;
	private readonly routes: ReadonlyMap<string, LlmRoute>;
	private readonly defaultModel: string;
	private readonly cacheDir: string | null;
	private readonly sleep: (
		ms: number,
		signal: AbortSignal | undefined,
	) => Promise<void>;
	private readonly now: () => number;
	private readonly queues = new Map<string, Promise<void>>();
	private readonly nextAllowedAt = new Map<string, number>();

	constructor(options: LlmRouterOptions) {
		this.channels = options.channels;
		this.routes = options.routes;
		if (this.routes.size === 0) {
			throw new Error("至少需要配置一个模型");
		}
		for (const [alias, route] of this.routes) {
			if (route.channels.length === 0) {
				throw new Error(`模型 ${alias} 没有配置渠道`);
			}
			for (const channelId of route.channels) {
				if (!this.channels.has(channelId)) {
					throw new Error(`模型 ${alias} 引用了不存在的渠道 ${channelId}`);
				}
			}
		}
		const defaultModel =
			options.defaultModel ??
			(this.routes.size === 1 ? [...this.routes.keys()][0] : undefined);
		if (defaultModel === undefined || !this.routes.has(defaultModel)) {
			throw new Error("必须指定一个存在于 routes 里的默认模型");
		}
		this.defaultModel = defaultModel;
		this.cacheDir = options.cacheDir ?? null;
		this.sleep =
			options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
		this.now = options.now ?? Date.now;
	}

	stream(request: LlmRequest, options?: LlmCallOptions): LlmStream {
		return createEventStream((emit) =>
			this.execute(request, options, emit, false),
		);
	}

	complete(request: LlmRequest, options?: LlmCallOptions): Promise<LlmResult> {
		return this.execute(request, options, () => undefined, true);
	}

	private async execute(
		request: LlmRequest,
		options: LlmCallOptions | undefined,
		emit: (event: LlmStreamEvent) => void,
		useCache: boolean,
	): Promise<LlmResult> {
		if (request.messages.length === 0) {
			throw new Error("messages 不能为空");
		}
		throwIfAborted(request.signal);
		const alias = request.model ?? this.defaultModel;
		const route = this.routes.get(alias);
		if (route === undefined) {
			throw new Error(`没有配置模型 ${alias}`);
		}
		const channels = route.channels.map((id) => {
			const channel = this.channels.get(id);
			if (channel === undefined) {
				throw new Error(`路由里引用了不存在的渠道 ${id}`);
			}
			return channel;
		});
		const continuationOptions = resolveContinuationOptions(
			options?.continuation,
		);
		const cacheDir =
			useCache && request.continuation === undefined ? this.cacheDir : null;

		if (cacheDir !== null) {
			for (const channel of channels) {
				throwIfAborted(request.signal);
				const cached = await readCachedResult(
					cacheDir,
					requestCacheKey(channel, route.model.id, request),
				);
				if (cached !== null) return cached;
			}
		}

		const totalRounds = 1 + continuationOptions.maxRounds;
		/** 本次调用的输出上限；续写轮次与首轮共用这个上限。 */
		const outputCap = request.maxTokens ?? route.model.maxTokens;
		let outputTokens = 0;
		let rounds = 0;
		let attempts = 0;
		let generatedText = request.continuation?.text ?? "";
		let generatedReasoning = request.continuation?.reasoning ?? "";
		let continuation = request.continuation;
		let usage: LlmUsage = emptyUsage();
		let last: { result: LlmProviderResult; channel: LlmChannel } | null = null;
		let truncation: LlmTruncationReason | null = null;

		while (true) {
			throwIfAborted(request.signal);
			const priorChars = generatedText.length;
			const round = await this.runRound({
				route,
				channels,
				request,
				priorText: generatedText,
				priorReasoning: generatedReasoning,
				continuation,
				maxTokens: Math.max(1, outputCap - outputTokens),
				emit,
			});
			attempts += round.attempts;
			rounds += 1;
			generatedText = round.text;
			generatedReasoning = round.reasoning;
			usage = addUsage(usage, round.usage);
			outputTokens += roundOutputTokens(round, priorChars);
			last = { result: round.result, channel: round.channel };
			truncation = detectTruncation(
				{ text: generatedText, stopReason: round.result.stopReason },
				truncationOptions(continuationOptions),
			);
			const interrupted =
				round.result.stopReason === "error" &&
				generatedText.length + generatedReasoning.length > 0;
			const shouldContinue =
				rounds < totalRounds &&
				outputTokens < outputCap &&
				((truncation !== null &&
					continuationOptions.continueOn.includes(truncation)) ||
					interrupted);
			if (!shouldContinue) break;
			continuation = {
				text: generatedText,
				reasoning: generatedReasoning,
			};
		}
		throwIfAborted(request.signal);

		const final: LlmResult = {
			text: generatedText,
			reasoning: generatedReasoning,
			toolCalls: last.result.toolCalls,
			finishReason: last.result.finishReason,
			stopReason: last.result.stopReason,
			model: last.result.model,
			channel: last.channel.id,
			usage,
			raw: last.result.raw,
			...(last.result.native === undefined
				? {}
				: { native: last.result.native }),
			cached: false,
			attempts,
			rounds,
			truncation,
			continuation:
				generatedText.length > 0 || generatedReasoning.length > 0
					? { text: generatedText, reasoning: generatedReasoning }
					: null,
		};
		if (
			cacheDir !== null &&
			final.stopReason !== "aborted" &&
			final.stopReason !== "error" &&
			final.continuation !== null
		) {
			await writeCachedResult(
				cacheDir,
				requestCacheKey(last.channel, route.model.id, request),
				final,
			);
		}
		return final;
	}

	private async runRound(input: {
		readonly route: LlmRoute;
		readonly channels: readonly LlmChannel[];
		readonly request: LlmRequest;
		readonly priorText: string;
		readonly priorReasoning: string;
		readonly continuation: LlmRequest["continuation"];
		/** 本轮允许生成的输出 token 数；续写轮次只拿剩余额度。 */
		readonly maxTokens: number;
		readonly emit: (event: LlmStreamEvent) => void;
	}): Promise<{
		readonly result: LlmProviderResult;
		readonly channel: LlmChannel;
		readonly attempts: number;
		readonly text: string;
		readonly reasoning: string;
		readonly usage: LlmUsage;
	}> {
		const failures: LlmChannelFailure[] = [];
		let attempts = 0;
		let roundText = "";
		let roundReasoning = "";
		let roundUsage = emptyUsage();
		let activeContinuation = input.continuation;
		let partial: { result: LlmProviderResult; channel: LlmChannel } | null =
			null;

		for (const channel of input.channels) {
			for (let retries = 0; ; ) {
				throwIfAborted(input.request.signal);
				await this.acquireSlot(channel, input.request.signal);
				attempts += 1;
				const providerRequest: LlmProviderRequest = {
					model: input.route.model,
					messages: input.request.messages,
					tools: input.request.tools,
					temperature: input.request.temperature,
					maxTokens: input.maxTokens,
					reasoning: input.request.reasoning,
					continuation: activeContinuation,
					signal: input.request.signal,
				};
				let attemptText = "";
				let attemptReasoning = "";
				const emitAttempt = (event: LlmProviderStreamEvent): void => {
					if (event.type === "text_delta") {
						attemptText += event.delta;
						input.emit({ type: "text_delta", delta: event.delta });
					} else {
						attemptReasoning += event.delta;
						input.emit({
							type: "thinking_delta",
							delta: event.delta,
						});
					}
				};
				let result: LlmProviderResult;
				try {
					const stream = channel.stream(providerRequest);
					for await (const event of stream) emitAttempt(event);
					result = await stream.result();
					if (attemptText.length === 0 && result.text.length > 0) {
						attemptText = result.text;
						input.emit({ type: "text_delta", delta: result.text });
					}
					if (attemptReasoning.length === 0 && result.reasoning.length > 0) {
						attemptReasoning = result.reasoning;
						input.emit({
							type: "thinking_delta",
							delta: result.reasoning,
						});
					}
				} catch (error) {
					throwIfAborted(input.request.signal);
					failures.push({ channel: channel.id, error });
					if (attemptText.length + attemptReasoning.length === 0) {
						if (isRetryable(error) && retries < channel.maxRetries) {
							retries += 1;
							await this.backoff(channel, retries, input.request.signal);
							continue;
						}
						break;
					}
					partial = {
						result: failedResult(
							error,
							attemptText,
							attemptReasoning,
							input.route.model.id,
						),
						channel,
					};
					roundText += attemptText;
					roundReasoning += attemptReasoning;
					break;
				}

				if (result.stopReason === "error" || result.stopReason === "aborted") {
					throwIfAborted(input.request.signal);
					failures.push({
						channel: channel.id,
						error: new LlmProviderError(
							result.errorMessage ??
								(result.finishReason === null
									? "渠道返回失败"
									: `渠道结束原因为 ${result.finishReason}`),
							{
								status: result.status,
								retryable: result.retryable,
							},
						),
					});
					if (attemptText.length + attemptReasoning.length === 0) {
						if (result.retryable && retries < channel.maxRetries) {
							retries += 1;
							await this.backoff(channel, retries, input.request.signal);
							continue;
						}
						break;
					}
					partial = { result, channel };
					roundText += attemptText;
					roundReasoning += attemptReasoning;
					break;
				}

				roundText += attemptText;
				roundReasoning += attemptReasoning;
				roundUsage = addUsage(roundUsage, result.usage);
				return {
					result,
					channel,
					attempts,
					text: input.priorText + roundText,
					reasoning: input.priorReasoning + roundReasoning,
					usage: roundUsage,
				};
			}

			if (partial !== null) {
				activeContinuation = {
					text: input.priorText + roundText,
					reasoning: input.priorReasoning + roundReasoning,
				};
			}
		}

		if (partial !== null) {
			return {
				result: {
					...partial.result,
					text: roundText,
					reasoning: roundReasoning,
					continuation:
						roundText.length > 0 || roundReasoning.length > 0
							? { text: roundText, reasoning: roundReasoning }
							: null,
				},
				channel: partial.channel,
				attempts,
				text: input.priorText + roundText,
				reasoning: input.priorReasoning + roundReasoning,
				usage: roundUsage,
			};
		}
		throw new LlmAllChannelsFailedError(input.route.model.id, failures);
	}

	private async acquireSlot(
		channel: LlmChannel,
		signal: AbortSignal | undefined,
	): Promise<void> {
		if (channel.requestsPerMinute <= 0) {
			throwIfAborted(signal);
			return;
		}
		const interval = 60_000 / channel.requestsPerMinute;
		const previous = this.queues.get(channel.id) ?? Promise.resolve();
		const run = previous.then(async () => {
			throwIfAborted(signal);
			const wait =
				(this.nextAllowedAt.get(channel.id) ?? Number.NEGATIVE_INFINITY) -
				this.now();
			await this.wait(wait, signal);
			this.nextAllowedAt.set(channel.id, this.now() + interval);
		});
		this.queues.set(
			channel.id,
			run.catch(() => undefined),
		);
		await run;
	}

	private async backoff(
		channel: LlmChannel,
		retries: number,
		signal: AbortSignal | undefined,
	): Promise<void> {
		await this.wait(channel.retryBaseDelayMs * 2 ** (retries - 1), signal);
	}

	private async wait(
		ms: number,
		signal: AbortSignal | undefined,
	): Promise<void> {
		throwIfAborted(signal);
		if (ms <= 0) return;
		await this.sleep(ms, signal);
	}
}

function truncationOptions(options: ResolvedContinuationOptions) {
	return {
		expectedTags: options.expectedTags,
		terminators: options.terminators,
		detectAbruptEnd: options.detectAbruptEnd,
	};
}

const estimateTokens = createTokenEstimator();

/** 一轮实际消耗的输出 token；渠道没有报告用量时按正文估算。 */
function roundOutputTokens(
	round: { readonly usage: LlmUsage; readonly text: string },
	priorChars: number,
): number {
	const reported = round.usage.completionTokens;
	if (reported !== null) return reported;
	return estimateTokens(round.text.slice(priorChars));
}

function failedResult(
	error: unknown,
	text: string,
	reasoning: string,
	model: string,
): LlmProviderResult {
	const providerError = error instanceof LlmProviderError ? error : undefined;
	return {
		text,
		reasoning,
		toolCalls: [],
		finishReason: null,
		stopReason: "error",
		model,
		usage: emptyUsage(),
		raw: null,
		retryable: providerError?.retryable ?? false,
		status: providerError?.status ?? null,
		errorMessage: providerError?.message ?? String(error),
		continuation:
			text.length > 0 || reasoning.length > 0 ? { text, reasoning } : null,
	};
}

function isRetryable(error: unknown): boolean {
	return error instanceof LlmProviderError && error.retryable;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason;
}

function emptyUsage(): LlmUsage {
	return {
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		reasoningTokens: null,
		cachedTokens: null,
	};
}

function addUsage(left: LlmUsage, right: LlmUsage): LlmUsage {
	return {
		promptTokens: addNullable(left.promptTokens, right.promptTokens),
		completionTokens: addNullable(
			left.completionTokens,
			right.completionTokens,
		),
		totalTokens: addNullable(left.totalTokens, right.totalTokens),
		reasoningTokens: addNullable(left.reasoningTokens, right.reasoningTokens),
		cachedTokens: addNullable(left.cachedTokens, right.cachedTokens),
	};
}

function addNullable(left: number | null, right: number | null): number | null {
	if (left === null) return right;
	if (right === null) return left;
	return left + right;
}
