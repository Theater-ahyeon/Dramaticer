import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	LlmAllChannelsFailedError,
	type LlmChannel,
	type LlmModelInfo,
	LlmProviderError,
	type LlmProviderRequest,
	type LlmProviderResult,
	LlmRouter,
	type LlmStreamEvent,
	type LlmUsage,
	createEventStream,
} from "../src/index.js";

const model: LlmModelInfo = {
	id: "test-model",
	contextWindow: 1_000,
	maxTokens: 100,
	reasoning: true,
};

interface Script {
	readonly deltas?: readonly string[];
	readonly thinkingDeltas?: readonly string[];
	readonly text?: string;
	readonly reasoning?: string;
	readonly stopReason?: LlmProviderResult["stopReason"];
	readonly retryable?: boolean;
	readonly throw?: unknown;
	readonly usage?: LlmUsage;
}

interface FakeChannel extends LlmChannel {
	readonly calls: LlmProviderRequest[];
}

function usage(promptTokens: number, completionTokens: number): LlmUsage {
	return {
		promptTokens,
		completionTokens,
		totalTokens: promptTokens + completionTokens,
		reasoningTokens: null,
		cachedTokens: null,
	};
}

function fakeChannel(
	id: string,
	respond: (request: LlmProviderRequest, call: number) => Script,
	overrides: Partial<
		Pick<LlmChannel, "maxRetries" | "baseUrl" | "apiKey">
	> = {},
): FakeChannel {
	const calls: LlmProviderRequest[] = [];
	return {
		id,
		baseUrl: overrides.baseUrl ?? `fake-${id}`,
		apiKey: overrides.apiKey ?? `key-${id}`,
		requestsPerMinute: 0,
		maxRetries: overrides.maxRetries ?? 1,
		retryBaseDelayMs: 1,
		calls,
		stream(request) {
			calls.push(request);
			const script = respond(request, calls.length);
			return createEventStream(async (emit) => {
				for (const delta of script.deltas ?? []) {
					emit({ type: "text_delta", delta });
				}
				for (const delta of script.thinkingDeltas ?? []) {
					emit({ type: "thinking_delta", delta });
				}
				if (script.throw !== undefined) throw script.throw;
				const text = script.text ?? (script.deltas ?? []).join("");
				const reasoning =
					script.reasoning ?? (script.thinkingDeltas ?? []).join("");
				const stopReason = script.stopReason ?? "stop";
				return {
					text,
					reasoning,
					finishReason: stopReason,
					stopReason,
					model: model.id,
					usage: script.usage ?? usage(10, 5),
					raw: null,
					retryable: script.retryable ?? false,
					status: null,
					errorMessage: null,
					continuation:
						text.length > 0 || reasoning.length > 0
							? { text, reasoning }
							: null,
				};
			});
		},
	};
}

function createRouter(
	channels: readonly LlmChannel[],
	cacheDir: string | null = null,
): LlmRouter {
	return new LlmRouter({
		channels: new Map(channels.map((channel) => [channel.id, channel])),
		routes: new Map([
			["model", { model, channels: channels.map((channel) => channel.id) }],
		]),
		defaultModel: "model",
		cacheDir,
		sleep: async () => undefined,
		now: () => 0,
	});
}

function request() {
	return { messages: [{ role: "user" as const, content: "问题" }] };
}

function tempCacheDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-router-"));
	onTestFinished(() => {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
	});
	return dir;
}

describe("LlmRouter", () => {
	it("可重试错误后在同一个渠道重试", async () => {
		const channel = fakeChannel("a", (_request, call) => {
			if (call === 1) {
				return {
					throw: new LlmProviderError("上游 500", {
						status: 500,
						retryable: true,
					}),
				};
			}
			return { text: "成功" };
		});
		const result = await createRouter([channel]).complete(request());

		expect(result.text).toBe("成功");
		expect(result.channel).toBe("a");
		expect(result.attempts).toBe(2);
		expect(result.rounds).toBe(1);
		expect(channel.calls).toHaveLength(2);
	});

	it("不可重试错误直接切换渠道", async () => {
		const first = fakeChannel("a", () => ({
			throw: new LlmProviderError("参数错误", {
				status: 400,
				retryable: false,
			}),
		}));
		const second = fakeChannel("b", () => ({ text: "备用渠道" }));
		const result = await createRouter([first, second]).complete(request());

		expect(result.text).toBe("备用渠道");
		expect(result.channel).toBe("b");
		expect(result.attempts).toBe(2);
		expect(first.calls).toHaveLength(1);
		expect(second.calls).toHaveLength(1);
	});

	it("重试耗尽后切换渠道", async () => {
		const first = fakeChannel("a", () => ({
			throw: new LlmProviderError("上游 503", {
				status: 503,
				retryable: true,
			}),
		}));
		const second = fakeChannel("b", () => ({ text: "切换成功" }));
		const result = await createRouter([first, second]).complete(request());

		expect(result.channel).toBe("b");
		expect(result.attempts).toBe(3);
		expect(first.calls).toHaveLength(2);
	});

	it("所有渠道失败时抛出汇总错误", async () => {
		const first = fakeChannel("a", () => ({
			throw: new LlmProviderError("坏请求", {
				status: 400,
				retryable: false,
			}),
		}));
		const second = fakeChannel("b", () => ({
			throw: new LlmProviderError("没有权限", {
				status: 403,
				retryable: false,
			}),
		}));
		const error = await createRouter([first, second])
			.complete(request())
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(LlmAllChannelsFailedError);
		expect(
			(error as LlmAllChannelsFailedError).failures.map(
				(failure) => failure.channel,
			),
		).toEqual(["a", "b"]);
	});

	it("按顺序输出正文增量与思考增量", async () => {
		const channel = fakeChannel("a", () => ({
			deltas: ["前", "后"],
			thinkingDeltas: ["想"],
			text: "前后",
			reasoning: "想",
		}));
		const stream = createRouter([channel]).stream(request());
		const events: LlmStreamEvent[] = [];
		for await (const event of stream) events.push(event);
		const result = await stream.result();

		expect(events).toEqual([
			{ type: "text_delta", delta: "前" },
			{ type: "text_delta", delta: "后" },
			{ type: "thinking_delta", delta: "想" },
		]);
		expect(result.text).toBe("前后");
		expect(result.reasoning).toBe("想");
	});

	it("以 length 结束时自动续写并合并用量", async () => {
		const channel = fakeChannel("a", (providerRequest, call) => {
			if (call === 1) {
				expect(providerRequest.continuation).toBeUndefined();
				return {
					text: "前半",
					stopReason: "length",
					usage: usage(10, 5),
				};
			}
			expect(providerRequest.continuation?.text).toBe("前半");
			return { text: "后半", usage: usage(20, 7) };
		});
		const result = await createRouter([channel]).complete(request());

		expect(result.text).toBe("前半后半");
		expect(result.rounds).toBe(2);
		expect(result.attempts).toBe(2);
		expect(result.stopReason).toBe("stop");
		expect(result.usage.promptTokens).toBe(30);
		expect(result.usage.completionTokens).toBe(12);
	});

	it("未闭合的标签按配置续写", async () => {
		const channel = fakeChannel("a", (_request, call) => {
			if (call === 1) {
				return {
					text: '<state_update>{"hp":1}',
					stopReason: "stop",
				};
			}
			return { text: "</state_update>" };
		});
		const result = await createRouter([channel]).complete(request(), {
			continuation: {
				expectedTags: ["state_update"],
				continueOn: ["unclosed_tag"],
			},
		});

		expect(result.text).toBe('<state_update>{"hp":1}</state_update>');
		expect(result.rounds).toBe(2);
		expect(result.truncation).toBeNull();
	});

	it("中途断流后带已有正文切换渠道续写", async () => {
		const first = fakeChannel("a", () => ({
			deltas: ["已经写出的"],
			stopReason: "error",
			text: "已经写出的",
			retryable: false,
		}));
		const second = fakeChannel("b", (providerRequest) => {
			expect(providerRequest.continuation?.text).toBe("已经写出的");
			return { text: "后续内容" };
		});
		const result = await createRouter([first, second]).complete(request());

		expect(result.text).toBe("已经写出的后续内容");
		expect(result.channel).toBe("b");
		expect(result.rounds).toBe(1);
	});

	it("按渠道的每分钟请求数排队", async () => {
		let clock = 0;
		const sleeps: number[] = [];
		const channel = {
			...fakeChannel("a", () => ({ text: "ok" })),
			requestsPerMinute: 2,
		};
		const router = new LlmRouter({
			channels: new Map([["a", channel]]),
			routes: new Map([["model", { model, channels: ["a"] }]]),
			defaultModel: "model",
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
			now: () => clock,
		});

		await router.complete(request());
		await router.complete(request());

		expect(sleeps).toEqual([30_000]);
		expect(channel.calls).toHaveLength(2);
	});

	it("成功结果写入缓存，第二次不再请求渠道", async () => {
		const dir = tempCacheDir();
		const channel = fakeChannel("a", () => ({ text: "缓存正文" }));
		const first = await createRouter([channel], dir).complete(request());
		expect(first.cached).toBe(false);
		expect(channel.calls).toHaveLength(1);

		const second = await createRouter([channel], dir).complete(request());
		expect(second.cached).toBe(true);
		expect(second.attempts).toBe(0);
		expect(second.text).toBe("缓存正文");
		expect(channel.calls).toHaveLength(1);

		const other = fakeChannel("a", () => ({ text: "未命中" }), {
			baseUrl: "other-fake",
		});
		const third = await createRouter([other], dir).complete(request());
		expect(third.cached).toBe(false);
		expect(third.channel).toBe("a");
		expect(other.calls).toHaveLength(1);
	});

	it("失败的半截结果不写入缓存", async () => {
		const dir = tempCacheDir();
		const channel = fakeChannel("a", (_request, call) => {
			if (call === 1) {
				return {
					deltas: ["半截"],
					text: "半截",
					stopReason: "error",
					retryable: false,
				};
			}
			return { text: "第二次成功" };
		});
		const first = await createRouter([channel], dir).complete(request(), {
			continuation: { maxRounds: 0 },
		});
		expect(first.stopReason).toBe("error");
		const second = await createRouter([channel], dir).complete(request(), {
			continuation: { maxRounds: 0 },
		});
		expect(second.cached).toBe(false);
		expect(second.text).toBe("第二次成功");
		expect(channel.calls).toHaveLength(2);
	});

	it("调用方中止后不重试", async () => {
		const channel = fakeChannel("a", () => ({
			throw: new LlmProviderError("连接断开", {
				status: 500,
				retryable: true,
			}),
		}));
		const controller = new AbortController();
		controller.abort(new Error("用户停止"));
		await expect(
			createRouter([channel]).complete({
				...request(),
				signal: controller.signal,
			}),
		).rejects.toThrow("用户停止");
		expect(channel.calls).toHaveLength(0);
	});

	it("流式过程中中止时 result() 抛出中止原因", async () => {
		const channel = fakeChannel("a", () => ({
			deltas: ["一", "二"],
			text: "一二",
		}));
		const controller = new AbortController();
		const stream = createRouter([channel]).stream({
			...request(),
			signal: controller.signal,
		});
		await expect(
			(async () => {
				for await (const _event of stream) {
					controller.abort(new Error("中途停止"));
				}
			})(),
		).rejects.toThrow("中途停止");
		await expect(stream.result()).rejects.toThrow("中途停止");
	});
});
