import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	type LlmFetch,
	LlmHttpError,
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
});
