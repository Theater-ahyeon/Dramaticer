import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	type LlmFetch,
	LlmHttpError,
	LlmResponseError,
	OpenAiCompatibleClient,
} from "../src/index.js";

function completionPayload(
	content: string,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: "chatcmpl-test",
		model: "test-model",
		choices: [
			{
				index: 0,
				message: { role: "assistant", content },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
		...extra,
	};
}

function jsonResponse(payload: unknown, status = 200, headers = {}): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function tempCacheDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-llm-"));
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

function baseOptions(
	overrides: Partial<Parameters<typeof OpenAiCompatibleClient>[0]>,
) {
	return {
		baseUrl: "http://127.0.0.1:9999/v1/",
		apiKey: "test-key",
		model: "test-model",
		requestsPerMinute: 0,
		maxRetries: 2,
		retryBaseDelayMs: 10,
		sleep: async () => undefined,
		...overrides,
	};
}

describe("OpenAiCompatibleClient", () => {
	it("发送 OpenAI 兼容请求并解析正文、思考内容与用量", async () => {
		let seenUrl = "";
		let seenBody: Record<string, unknown> = {};
		const fetchFn: LlmFetch = async (url, init) => {
			seenUrl = url;
			seenBody = JSON.parse(String(init.body));
			return jsonResponse(
				completionPayload("答案", {
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: "答案",
								reasoning_content: "先想一下",
							},
							finish_reason: "stop",
						},
					],
					usage: {
						prompt_tokens: 12,
						completion_tokens: 7,
						total_tokens: 19,
						completion_tokens_details: { reasoning_tokens: 5 },
						prompt_tokens_details: { cached_tokens: 3 },
					},
				}),
			);
		};
		const client = new OpenAiCompatibleClient(baseOptions({ fetchFn }));

		const result = await client.complete({
			messages: [
				{ role: "system", content: "系统" },
				{ role: "user", content: "问题" },
			],
			temperature: 0.2,
			maxTokens: 100,
			reasoningEffort: "low",
			extraBody: { seed: 7 },
		});

		expect(seenUrl).toBe("http://127.0.0.1:9999/v1/chat/completions");
		expect(seenBody).toMatchObject({
			model: "test-model",
			messages: [
				{ role: "system", content: "系统" },
				{ role: "user", content: "问题" },
			],
			stream: false,
			temperature: 0.2,
			max_tokens: 100,
			reasoning_effort: "low",
			seed: 7,
		});
		expect(result.text).toBe("答案");
		expect(result.reasoning).toBe("先想一下");
		expect(result.usage).toEqual({
			promptTokens: 12,
			completionTokens: 7,
			totalTokens: 19,
			reasoningTokens: 5,
			cachedTokens: 3,
		});
		expect(result.cached).toBe(false);
		expect(result.attempts).toBe(1);
	});

	it("同样的请求命中缓存，不会重复调用渠道", async () => {
		const calls = { count: 0 };
		const fetchFn: LlmFetch = async () => {
			calls.count += 1;
			return jsonResponse(completionPayload("缓存内容"));
		};
		const cacheDir = tempCacheDir();
		const options = baseOptions({ fetchFn, cacheDir });
		await new OpenAiCompatibleClient(options).complete({
			messages: [{ role: "user", content: "问题" }],
		});
		const second = await new OpenAiCompatibleClient(options).complete({
			messages: [{ role: "user", content: "问题" }],
		});

		expect(calls.count).toBe(1);
		expect(second.cached).toBe(true);
		expect(second.attempts).toBe(0);
		expect(second.text).toBe("缓存内容");
	});

	it("429 按 Retry-After 等待后重试", async () => {
		const sleeps: number[] = [];
		let attempt = 0;
		const fetchFn: LlmFetch = async () => {
			attempt += 1;
			if (attempt === 1) {
				return jsonResponse({ error: { message: "限流" } }, 429, {
					"retry-after": "0.05",
				});
			}
			return jsonResponse(completionPayload("成功"));
		};
		const client = new OpenAiCompatibleClient(
			baseOptions({
				fetchFn,
				sleep: async (ms) => {
					sleeps.push(ms);
				},
			}),
		);

		const result = await client.complete({
			messages: [{ role: "user", content: "问题" }],
		});

		expect(result.text).toBe("成功");
		expect(result.attempts).toBe(2);
		expect(sleeps).toEqual([50]);
	});

	it("网络错误按指数退避重试", async () => {
		const sleeps: number[] = [];
		let attempt = 0;
		const fetchFn: LlmFetch = async () => {
			attempt += 1;
			if (attempt === 1) throw new TypeError("连接被拒绝");
			return jsonResponse(completionPayload("恢复"));
		};
		const client = new OpenAiCompatibleClient(
			baseOptions({
				fetchFn,
				sleep: async (ms) => {
					sleeps.push(ms);
				},
			}),
		);

		const result = await client.complete({
			messages: [{ role: "user", content: "问题" }],
		});

		expect(result.attempts).toBe(2);
		expect(sleeps).toEqual([10]);
	});

	it("4xx 不重试，直接抛出带状态码的错误", async () => {
		let calls = 0;
		const fetchFn: LlmFetch = async () => {
			calls += 1;
			return jsonResponse({ error: { message: "参数错误" } }, 400);
		};
		const client = new OpenAiCompatibleClient(baseOptions({ fetchFn }));

		await expect(
			client.complete({ messages: [{ role: "user", content: "问题" }] }),
		).rejects.toBeInstanceOf(LlmHttpError);
		expect(calls).toBe(1);
	});

	it("按每分钟请求数限制相邻请求的起始间隔", async () => {
		const sleeps: number[] = [];
		let clock = 0;
		const client = new OpenAiCompatibleClient(
			baseOptions({
				requestsPerMinute: 60,
				fetchFn: async () => jsonResponse(completionPayload("ok")),
				sleep: async (ms) => {
					sleeps.push(ms);
					clock += ms;
				},
				now: () => clock,
			}),
		);
		await client.complete({ messages: [{ role: "user", content: "一" }] });
		await client.complete({ messages: [{ role: "user", content: "二" }] });
		expect(sleeps).toEqual([1000]);
	});

	it("内容块数组会被拼成正文，空 content 不报错", async () => {
		const fetchFn: LlmFetch = async () =>
			jsonResponse({
				model: "test-model",
				choices: [
					{
						message: {
							role: "assistant",
							content: [
								{ type: "text", text: "第一段" },
								{ type: "text", text: "第二段" },
							],
						},
						finish_reason: "stop",
					},
				],
			});
		const client = new OpenAiCompatibleClient(baseOptions({ fetchFn }));
		const result = await client.complete({
			messages: [{ role: "user", content: "问题" }],
		});
		expect(result.text).toBe("第一段第二段");
		expect(result.usage.promptTokens).toBeNull();
	});

	it("2xx 但响应体不是 JSON 时只请求一次", async () => {
		let calls = 0;
		const fetchFn: LlmFetch = async () => {
			calls += 1;
			return new Response("<html>网关错误页</html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			});
		};
		const client = new OpenAiCompatibleClient(baseOptions({ fetchFn }));

		const error = await client
			.complete({ messages: [{ role: "user", content: "问题" }] })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(LlmResponseError);
		expect((error as Error).message).toContain("渠道返回的不是 JSON");
		expect(calls).toBe(1);
	});

	it("响应体读取时的非语法错误原样抛出，不重试", async () => {
		let calls = 0;
		const bodyError = new TypeError("响应体读取失败");
		const fetchFn: LlmFetch = async () => {
			calls += 1;
			const response = new Response("{}", { status: 200 });
			response.json = async () => {
				throw bodyError;
			};
			return response;
		};
		const client = new OpenAiCompatibleClient(baseOptions({ fetchFn }));

		await expect(
			client.complete({ messages: [{ role: "user", content: "问题" }] }),
		).rejects.toBe(bodyError);
		expect(calls).toBe(1);
	});

	it("重试等待期间响应中止信号并抛出 AbortError", async () => {
		const controller = new AbortController();
		let seenSignal: AbortSignal | undefined;
		const client = new OpenAiCompatibleClient(
			baseOptions({
				maxRetries: 3,
				fetchFn: async () =>
					jsonResponse({ error: { message: "限流" } }, 429, {
						"retry-after": "30",
					}),
				sleep: (_ms, signal) => {
					seenSignal = signal;
					const { promise, reject } = Promise.withResolvers<void>();
					if (!signal) {
						reject(new Error("等待时必须传中止信号"));
					} else if (signal.aborted) {
						reject(signal.reason);
					} else {
						signal.addEventListener("abort", () => reject(signal.reason), {
							once: true,
						});
						queueMicrotask(() => controller.abort());
					}
					return promise;
				},
			}),
		);

		await expect(
			client.complete({
				messages: [{ role: "user", content: "问题" }],
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(seenSignal).toBe(controller.signal);
	});

	it("已经中止的信号在发起请求前就抛出 AbortError", async () => {
		const controller = new AbortController();
		controller.abort();
		let calls = 0;
		const client = new OpenAiCompatibleClient(
			baseOptions({
				fetchFn: async () => {
					calls += 1;
					return jsonResponse(completionPayload("不应到达"));
				},
			}),
		);

		await expect(
			client.complete({
				messages: [{ role: "user", content: "问题" }],
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(calls).toBe(0);
	});

	it("Retry-After 超过上限时按上限等待", async () => {
		const sleeps: number[] = [];
		let attempt = 0;
		const fetchFn: LlmFetch = async () => {
			attempt += 1;
			if (attempt === 1) {
				return jsonResponse({ error: { message: "限流" } }, 429, {
					"retry-after": "3600",
				});
			}
			return jsonResponse(completionPayload("成功"));
		};
		const client = new OpenAiCompatibleClient(
			baseOptions({
				fetchFn,
				maxRetryAfterMs: 5_000,
				sleep: async (ms) => {
					sleeps.push(ms);
				},
			}),
		);

		await client.complete({ messages: [{ role: "user", content: "问题" }] });

		expect(sleeps).toEqual([5_000]);
	});

	it("缓存键忽略 undefined 属性，Date 按 JSON 序列化", async () => {
		const cacheDir = tempCacheDir();
		let calls = 0;
		const fetchFn: LlmFetch = async () => {
			calls += 1;
			return jsonResponse(completionPayload("缓存内容"));
		};
		const options = baseOptions({ fetchFn, cacheDir });
		const request = (extraBody: Record<string, unknown>) => ({
			messages: [{ role: "user" as const, content: "问题" }],
			extraBody,
		});

		await new OpenAiCompatibleClient(options).complete(
			request({
				seed: 1,
				tag: undefined,
				at: new Date("2026-01-01T00:00:00.000Z"),
			}),
		);
		const hit = await new OpenAiCompatibleClient(options).complete(
			request({ seed: 1, at: new Date("2026-01-01T00:00:00.000Z") }),
		);
		expect(hit.cached).toBe(true);
		expect(calls).toBe(1);

		const miss = await new OpenAiCompatibleClient(options).complete(
			request({ seed: 1, at: new Date("2026-01-02T00:00:00.000Z") }),
		);
		expect(miss.cached).toBe(false);
		expect(calls).toBe(2);
	});

	it("缓存键包含 apiKey 的摘要", async () => {
		const cacheDir = tempCacheDir();
		let calls = 0;
		const fetchFn: LlmFetch = async () => {
			calls += 1;
			return jsonResponse(completionPayload("内容"));
		};
		const request = {
			messages: [{ role: "user" as const, content: "问题" }],
		};

		await new OpenAiCompatibleClient(
			baseOptions({ fetchFn, cacheDir, apiKey: "key-a" }),
		).complete(request);
		await new OpenAiCompatibleClient(
			baseOptions({ fetchFn, cacheDir, apiKey: "key-a" }),
		).complete(request);
		expect(calls).toBe(1);

		await new OpenAiCompatibleClient(
			baseOptions({ fetchFn, cacheDir, apiKey: "key-b" }),
		).complete(request);
		expect(calls).toBe(2);
	});

	it.each([
		["响应不是对象", [1, 2, 3], "渠道响应不是对象"],
		["响应里带错误", { error: { message: "配额不足" } }, "渠道响应里带错误"],
		["缺少 choices", { model: "test-model" }, "渠道响应缺少 choices"],
		["choices[0] 不是对象", { choices: ["文本"] }, "choices[0] 不是对象"],
	] as const)("响应校验失败：%s", async (_label, payload, message) => {
		let calls = 0;
		const client = new OpenAiCompatibleClient(
			baseOptions({
				fetchFn: async () => {
					calls += 1;
					return jsonResponse(payload);
				},
			}),
		);

		const error = await client
			.complete({ messages: [{ role: "user", content: "问题" }] })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(LlmResponseError);
		expect((error as Error).message).toContain(message);
		expect(calls).toBe(1);
	});

	it("5xx 会重试，并在成功后返回结果", async () => {
		let attempt = 0;
		const sleeps: number[] = [];
		const fetchFn: LlmFetch = async () => {
			attempt += 1;
			if (attempt === 1) return new Response("上游不可用", { status: 503 });
			return jsonResponse(completionPayload("恢复"));
		};
		const client = new OpenAiCompatibleClient(
			baseOptions({
				fetchFn,
				sleep: async (ms) => {
					sleeps.push(ms);
				},
			}),
		);

		const result = await client.complete({
			messages: [{ role: "user", content: "问题" }],
		});

		expect(result.attempts).toBe(2);
		expect(sleeps).toEqual([10]);
	});

	it("5xx 重试用尽后抛出带状态码与错误体的错误", async () => {
		let calls = 0;
		const client = new OpenAiCompatibleClient(
			baseOptions({
				maxRetries: 1,
				fetchFn: async () => {
					calls += 1;
					return new Response("上游错误", { status: 500 });
				},
			}),
		);

		const error = await client
			.complete({ messages: [{ role: "user", content: "问题" }] })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(LlmHttpError);
		expect((error as LlmHttpError).status).toBe(500);
		expect((error as LlmHttpError).body).toBe("上游错误");
		expect(calls).toBe(2);
	});
});
