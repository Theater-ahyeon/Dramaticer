import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	readCachedResult,
	requestCacheKey,
	writeCachedResult,
} from "../src/llm/cache.js";

const identity = {
	baseUrl: "cache-base/",
	apiKey: "test-key",
};

function tempCacheDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-cache-"));
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

describe("requestCacheKey", () => {
	it("与 M0 客户端的请求体格式一致", () => {
		const key = requestCacheKey(identity, "test-model", {
			messages: [{ role: "user", content: "问题" }],
			temperature: 0.2,
			maxTokens: 100,
			reasoning: "low",
		});
		const body =
			'{"max_tokens":100,"messages":[{"content":"问题","role":"user"}],"model":"test-model","reasoning_effort":"low","stream":false,"temperature":0.2}';
		const expected = createHash("sha256")
			.update("cache-base")
			.update("\n")
			.update(createHash("sha256").update("test-key").digest("hex"))
			.update("\n")
			.update(body)
			.digest("hex");
		expect(key).toBe(expected);
	});

	it("模型、渠道与请求内容都会改变缓存键", () => {
		const request = {
			messages: [{ role: "user" as const, content: "问题" }],
		};
		const base = requestCacheKey(identity, "test-model", request);
		expect(requestCacheKey(identity, "other-model", request)).not.toBe(base);
		expect(
			requestCacheKey(
				{ ...identity, baseUrl: "other-cache-base" },
				"test-model",
				request,
			),
		).not.toBe(base);
		expect(
			requestCacheKey(
				{ ...identity, apiKey: "other-key" },
				"test-model",
				request,
			),
		).not.toBe(base);
		expect(
			requestCacheKey(identity, "test-model", {
				...request,
				temperature: 0.5,
			}),
		).not.toBe(base);
		expect(
			requestCacheKey(identity, "test-model", {
				...request,
				seed: 1,
			}),
		).not.toBe(
			requestCacheKey(identity, "test-model", { ...request, seed: 2 }),
		);
	});
});

describe("readCachedResult", () => {
	it("读取 M0 写出的缓存结构并补齐新字段", async () => {
		const dir = tempCacheDir();
		const key = "old-entry";
		writeFileSync(
			join(dir, `${key}.json`),
			`${JSON.stringify({
				version: 1,
				result: {
					text: "旧正文",
					reasoning: "旧思考",
					finishReason: "stop",
					model: "old-model",
					usage: {
						promptTokens: 3,
						completionTokens: 4,
						totalTokens: 7,
						reasoningTokens: 1,
						cachedTokens: null,
					},
					raw: {},
				},
			})}\n`,
			"utf8",
		);

		const result = await readCachedResult(dir, key);
		expect(result).toMatchObject({
			text: "旧正文",
			reasoning: "旧思考",
			stopReason: "stop",
			model: "old-model",
			channel: null,
			cached: true,
			attempts: 0,
			rounds: 1,
			truncation: null,
			continuation: null,
		});
	});

	it("原生签名随缓存结果写回", async () => {
		const dir = tempCacheDir();
		await writeCachedResult(dir, "native", {
			text: "",
			reasoning: "",
			toolCalls: [
				{
					id: "call-1",
					name: "ledger_read",
					arguments: {},
					native: { thoughtSignature: "signature-1" },
				},
			],
			finishReason: "tool_calls",
			stopReason: "toolUse",
			model: "fixture-model",
			channel: "fixture-channel",
			usage: {
				promptTokens: 1,
				completionTokens: 2,
				totalTokens: 3,
				reasoningTokens: 0,
				cachedTokens: 0,
			},
			raw: null,
			native: {
				content: [
					{
						type: "toolCall",
						id: "call-1",
						name: "ledger_read",
						arguments: {},
						thoughtSignature: "signature-1",
					},
				],
			},
			cached: false,
			attempts: 1,
			rounds: 1,
			truncation: null,
			continuation: null,
		});

		const result = await readCachedResult(dir, "native");
		expect(result?.native?.content[0]?.thoughtSignature).toBe("signature-1");
		expect(result?.toolCalls[0]?.native).toEqual({
			thoughtSignature: "signature-1",
		});
	});

	it("文件缺失或结构损坏时返回 null", async () => {
		const dir = tempCacheDir();
		expect(await readCachedResult(dir, "missing")).toBeNull();
		writeFileSync(join(dir, "broken.json"), "{", "utf8");
		expect(await readCachedResult(dir, "broken")).toBeNull();
		writeFileSync(
			join(dir, "wrong-version.json"),
			JSON.stringify({ version: 2, result: {} }),
			"utf8",
		);
		expect(await readCachedResult(dir, "wrong-version")).toBeNull();
	});
});
