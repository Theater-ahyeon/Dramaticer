import { describe, expect, it } from "vitest";
import {
	OpenAiEmbeddingClient,
	createEmbeddingClient,
	isJsonObject,
	parseChannelsConfig,
} from "../src/index.js";

const env = {
	BG_URL: "http://127.0.0.1:3425/v1",
	BG_KEY: "bg-secret",
	BG_MODEL: "fake-model",
	EMB_URL: "http://127.0.0.1:1234/v1",
	EMB_KEY: "emb-secret",
};

function configText(embeddings = ""): string {
	return `
channels:
  bg:
    baseUrl: \${BG_URL}
    apiKey: \${BG_KEY}
models:
  background:
    id: \${BG_MODEL}
    channels: [bg]
${embeddings}
`;
}

const embeddingSection = `
embeddings:
  default:
    api: openai-embeddings
    baseUrl: \${EMB_URL}
    apiKey: \${EMB_KEY}
    model: BAAI/bge-m3
    dimensions: 4
    batchSize: 2
    requestsPerMinute: 0
    maxRetries: 1
`;

interface FetchCall {
	readonly url: string;
	readonly body: Readonly<Record<string, unknown>> | null;
}

function createFetch(
	respond: (call: FetchCall, index: number) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: FetchCall[] } {
	const calls: FetchCall[] = [];
	const fake = async (
		input: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		const url = typeof input === "string" ? input : input.toString();
		const parsed: unknown =
			typeof init?.body === "string" ? JSON.parse(init.body) : null;
		if (parsed !== null && !isJsonObject(parsed)) {
			throw new Error("测试请求体必须是对象");
		}
		const call = { url, body: parsed };
		calls.push(call);
		return respond(call, calls.length - 1);
	};
	return { fetch: fake as typeof fetch, calls };
}

function vectorResponse(vectors: readonly (readonly number[])[]): Response {
	return new Response(
		JSON.stringify({
			data: vectors.map((embedding, index) => ({ index, embedding })),
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}

function makeClient(
	fetchImpl: typeof fetch,
	overrides: Partial<
		ConstructorParameters<typeof OpenAiEmbeddingClient>[0]
	> = {},
): OpenAiEmbeddingClient {
	return new OpenAiEmbeddingClient({
		baseUrl: "http://127.0.0.1:1234/v1/",
		apiKey: "secret",
		model: "BAAI/bge-m3",
		dimensions: 4,
		requestsPerMinute: 0,
		maxRetries: 1,
		retryBaseDelayMs: 10,
		timeoutMs: 5_000,
		fetch: fetchImpl,
		sleep: async () => undefined,
		...overrides,
	});
}

describe("embeddings 配置", () => {
	it("解析 embeddings 段并应用默认值", () => {
		const config = parseChannelsConfig(
			configText(embeddingSection),
			env,
			"test.yaml",
		);
		expect(config.embeddings.get("default")).toMatchObject({
			id: "default",
			api: "openai-embeddings",
			baseUrl: "http://127.0.0.1:1234/v1",
			apiKey: "emb-secret",
			model: "BAAI/bge-m3",
			dimensions: 4,
			batchSize: 2,
			requestsPerMinute: 0,
			maxRetries: 1,
			retryBaseDelayMs: 1_000,
			timeoutMs: 300_000,
		});
	});

	it("没有 embeddings 段时返回空映射", () => {
		const config = parseChannelsConfig(configText(), env);
		expect(config.embeddings.size).toBe(0);
	});

	it("缺少维度、非法适配器与字面量密钥都抛错", () => {
		const missing = embeddingSection.replace("    dimensions: 4\n", "");
		expect(() => parseChannelsConfig(configText(missing), env)).toThrow(
			"embeddings.default.dimensions",
		);
		const badApi = embeddingSection.replace("openai-embeddings", "other-api");
		expect(() => parseChannelsConfig(configText(badApi), env)).toThrow(
			"openai-embeddings",
		);
		const literal = embeddingSection.replace(
			"apiKey: ${EMB_KEY}",
			"apiKey: literal",
		);
		expect(() => parseChannelsConfig(configText(literal), env)).toThrow(
			"embeddings.default.apiKey",
		);
	});

	it("工厂按别名取出配置", () => {
		const config = parseChannelsConfig(
			configText(embeddingSection),
			env,
			"test.yaml",
		);
		const client = createEmbeddingClient(config);
		expect(client.dimensions).toBe(4);
		expect(() => createEmbeddingClient(config, "missing")).toThrow(
			"embeddings.missing",
		);
	});
});

describe("OpenAI 兼容 embedding 客户端", () => {
	it("按批量拆分请求，并按 index 还原顺序", async () => {
		const { fetch, calls } = createFetch((call) => {
			const input = call.body?.input;
			if (!Array.isArray(input)) throw new Error("请求体缺少 input");
			const reversed = input
				.map((_, index) => index)
				.reverse()
				.map((index) => ({
					index,
					embedding: [index + 1, 0, 0, 0],
				}));
			return new Response(JSON.stringify({ data: reversed }), {
				status: 200,
			});
		});
		const client = makeClient(fetch, { batchSize: 2 });
		const vectors = await client.embed(["一", "二", "三"]);
		expect(calls).toHaveLength(2);
		expect(calls[0]?.url).toBe("http://127.0.0.1:1234/v1/embeddings");
		expect(calls[0]?.body).toEqual({
			model: "BAAI/bge-m3",
			input: ["一", "二"],
		});
		expect(calls[1]?.body).toEqual({
			model: "BAAI/bge-m3",
			input: ["三"],
		});
		expect(vectors).toEqual([
			[1, 0, 0, 0],
			[2, 0, 0, 0],
			[1, 0, 0, 0],
		]);
	});

	it("维度不符、缺少条目与非法数字直接抛错", async () => {
		const { fetch } = createFetch(() => vectorResponse([[1, 0, 0]]));
		await expect(makeClient(fetch).embed(["一"])).rejects.toThrow(
			"维度必须是 4",
		);

		const missing = createFetch(() => vectorResponse([]));
		await expect(makeClient(missing.fetch).embed(["一"])).rejects.toThrow(
			"期望 1 条",
		);

		const nan = createFetch(() => vectorResponse([[1, Number.NaN, 0, 0]]));
		await expect(makeClient(nan.fetch).embed(["一"])).rejects.toThrow(
			"有限数字",
		);
	});

	it("429/5xx 按次数重试，4xx 直接抛错", async () => {
		const retrying = createFetch((_call, index) =>
			index === 0
				? new Response("busy", { status: 503 })
				: vectorResponse([[1, 0, 0, 0]]),
		);
		await expect(makeClient(retrying.fetch).embed(["一"])).resolves.toEqual([
			[1, 0, 0, 0],
		]);
		expect(retrying.calls).toHaveLength(2);

		const rejected = createFetch(() => new Response("bad", { status: 400 }));
		await expect(makeClient(rejected.fetch).embed(["一"])).rejects.toThrow(
			"400",
		);
		expect(rejected.calls).toHaveLength(1);
	});

	it("重试用尽后抛错，空输入不发起请求", async () => {
		const { fetch, calls } = createFetch(
			() => new Response("busy", { status: 429 }),
		);
		await expect(makeClient(fetch).embed(["一"])).rejects.toThrow("429");
		expect(calls).toHaveLength(2);
		await expect(makeClient(fetch).embed([])).resolves.toEqual([]);
		expect(calls).toHaveLength(2);
	});

	it("中止信号原样抛出", async () => {
		const controller = new AbortController();
		controller.abort(new Error("手动中止"));
		const { fetch } = createFetch(() => vectorResponse([[1, 0, 0, 0]]));
		await expect(
			makeClient(fetch).embed(["一"], { signal: controller.signal }),
		).rejects.toThrow("手动中止");
	});
});
