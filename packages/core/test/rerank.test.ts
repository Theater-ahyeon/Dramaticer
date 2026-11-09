import { describe, expect, it } from "vitest";
import {
	OpenAiRerankClient,
	type RerankClient,
	type StoryStore,
	createRerankClient,
	isJsonObject,
	parseChannelsConfig,
	retrieveMemory,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const env = {
	BG_URL: "http://127.0.0.1:3425/v1",
	BG_KEY: "bg-secret",
	BG_MODEL: "fake-model",
	RR_URL: "http://127.0.0.1:5678/v1",
	RR_KEY: "rr-secret",
};

function configText(reranker = ""): string {
	return `
channels:
  bg:
    baseUrl: \${BG_URL}
    apiKey: \${BG_KEY}
models:
  background:
    id: \${BG_MODEL}
    channels: [bg]
${reranker}
`;
}

const rerankerSection = `
reranker:
  enabled: true
  api: openai-rerank
  baseUrl: \${RR_URL}
  apiKey: \${RR_KEY}
  model: BAAI/bge-reranker-v2-m3
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

function scoreResponse(scores: readonly number[]): Response {
	return new Response(
		JSON.stringify({
			results: scores.map((score, index) => ({
				index,
				relevance_score: score,
			})),
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}

function makeClient(
	fetchImpl: typeof fetch,
	overrides: Partial<ConstructorParameters<typeof OpenAiRerankClient>[0]> = {},
): OpenAiRerankClient {
	return new OpenAiRerankClient({
		baseUrl: "http://127.0.0.1:5678/v1/",
		apiKey: "secret",
		model: "BAAI/bge-reranker-v2-m3",
		requestsPerMinute: 0,
		maxRetries: 1,
		retryBaseDelayMs: 10,
		timeoutMs: 5_000,
		fetch: fetchImpl,
		sleep: async () => undefined,
		...overrides,
	});
}

describe("reranker 配置", () => {
	it("解析 reranker 段并应用默认值", () => {
		const config = parseChannelsConfig(
			configText(rerankerSection),
			env,
			"test.yaml",
		);
		expect(config.reranker).toMatchObject({
			id: "reranker",
			api: "openai-rerank",
			enabled: true,
			baseUrl: "http://127.0.0.1:5678/v1",
			apiKey: "rr-secret",
			model: "BAAI/bge-reranker-v2-m3",
			batchSize: 2,
			requestsPerMinute: 0,
			maxRetries: 1,
			retryBaseDelayMs: 1_000,
			timeoutMs: 30_000,
		});
	});

	it("没有 reranker 段时为 null，enabled 缺省关闭", () => {
		const absent = parseChannelsConfig(configText(), env);
		expect(absent.reranker).toBeNull();
		const disabled = rerankerSection.replace("  enabled: true\n", "");
		const config = parseChannelsConfig(configText(disabled), env);
		expect(config.reranker?.enabled).toBe(false);
	});

	it("非法适配器、字面量密钥与缺少模型都抛错", () => {
		const badApi = rerankerSection.replace("openai-rerank", "other-api");
		expect(() => parseChannelsConfig(configText(badApi), env)).toThrow(
			"reranker.api",
		);
		const literal = rerankerSection.replace(
			"apiKey: ${RR_KEY}",
			"apiKey: literal",
		);
		expect(() => parseChannelsConfig(configText(literal), env)).toThrow(
			"reranker.apiKey",
		);
		const missingModel = rerankerSection.replace(
			"  model: BAAI/bge-reranker-v2-m3\n",
			"",
		);
		expect(() => parseChannelsConfig(configText(missingModel), env)).toThrow(
			"reranker.model",
		);
	});

	it("工厂只在配置存在且 enabled 时创建客户端", () => {
		const disabled = parseChannelsConfig(
			configText(rerankerSection.replace("enabled: true", "enabled: false")),
			env,
		);
		expect(createRerankClient(disabled)).toBeNull();
		const absent = parseChannelsConfig(configText(), env);
		expect(createRerankClient(absent)).toBeNull();
		const enabled = parseChannelsConfig(configText(rerankerSection), env);
		expect(createRerankClient(enabled)).toBeInstanceOf(OpenAiRerankClient);
	});
});

describe("OpenAI 兼容 rerank 客户端", () => {
	it("按批量拆分请求，并按 index 还原全局下标", async () => {
		const { fetch, calls } = createFetch((call) => {
			const documents = call.body?.documents;
			if (!Array.isArray(documents)) throw new Error("请求体缺少 documents");
			return scoreResponse(documents.map((_, index) => index + 1));
		});
		const client = makeClient(fetch, { batchSize: 2 });
		const scores = await client.rerank("查询", ["一", "二", "三"]);
		expect(calls).toHaveLength(2);
		expect(calls[0]?.url).toBe("http://127.0.0.1:5678/v1/rerank");
		expect(calls[0]?.body).toEqual({
			model: "BAAI/bge-reranker-v2-m3",
			query: "查询",
			documents: ["一", "二"],
		});
		expect(calls[1]?.body).toEqual({
			model: "BAAI/bge-reranker-v2-m3",
			query: "查询",
			documents: ["三"],
		});
		expect(scores).toEqual([
			{ index: 0, score: 1 },
			{ index: 1, score: 2 },
			{ index: 2, score: 1 },
		]);
	});

	it("响应缺条目、越界、重复与非有限分数都抛错", async () => {
		const missing = createFetch(
			() => new Response(JSON.stringify({ results: [] }), { status: 200 }),
		);
		await expect(
			makeClient(missing.fetch).rerank("查询", ["一"]),
		).rejects.toThrow("期望 1 条");

		const outOfRange = createFetch(
			() =>
				new Response(
					JSON.stringify({ results: [{ index: 1, relevance_score: 1 }] }),
					{ status: 200 },
				),
		);
		await expect(
			makeClient(outOfRange.fetch).rerank("查询", ["一"]),
		).rejects.toThrow("越界");

		const duplicate = createFetch(
			() =>
				new Response(
					JSON.stringify({
						results: [
							{ index: 0, relevance_score: 1 },
							{ index: 0, relevance_score: 2 },
						],
					}),
					{ status: 200 },
				),
		);
		await expect(
			makeClient(duplicate.fetch).rerank("查询", ["一", "二"]),
		).rejects.toThrow("重复");

		const nan = createFetch(
			() =>
				new Response(
					JSON.stringify({
						results: [{ index: 0, relevance_score: Number.NaN }],
					}),
					{ status: 200 },
				),
		);
		await expect(makeClient(nan.fetch).rerank("查询", ["一"])).rejects.toThrow(
			"有限数字",
		);
	});

	it("429/5xx 按次数重试，4xx 直接抛错", async () => {
		const retrying = createFetch((_call, index) =>
			index === 0 ? new Response("busy", { status: 503 }) : scoreResponse([1]),
		);
		await expect(
			makeClient(retrying.fetch).rerank("查询", ["一"]),
		).resolves.toEqual([{ index: 0, score: 1 }]);
		expect(retrying.calls).toHaveLength(2);

		const rejected = createFetch(() => new Response("bad", { status: 400 }));
		await expect(
			makeClient(rejected.fetch).rerank("查询", ["一"]),
		).rejects.toThrow("400");
		expect(rejected.calls).toHaveLength(1);
	});

	it("重试用尽后抛错，空文档不发起请求", async () => {
		const { fetch, calls } = createFetch(
			() => new Response("busy", { status: 429 }),
		);
		await expect(makeClient(fetch).rerank("查询", ["一"])).rejects.toThrow(
			"429",
		);
		expect(calls).toHaveLength(2);
		await expect(makeClient(fetch).rerank("查询", [])).resolves.toEqual([]);
		expect(calls).toHaveLength(2);
	});

	it("查询为空、文档为空字符串与中止信号都直接抛错", async () => {
		const { fetch, calls } = createFetch(() => scoreResponse([1]));
		await expect(makeClient(fetch).rerank("  ", ["一"])).rejects.toThrow(
			"查询",
		);
		await expect(makeClient(fetch).rerank("查询", [""])).rejects.toThrow(
			"重排序输入",
		);
		const controller = new AbortController();
		controller.abort(new Error("手动中止"));
		await expect(
			makeClient(fetch).rerank("查询", ["一"], {
				signal: controller.signal,
			}),
		).rejects.toThrow("手动中止");
		expect(calls).toHaveLength(0);
	});
});

interface RerankFixture {
	readonly store: StoryStore;
	readonly rootId: string;
	readonly assistantId: string;
	readonly askId: string;
}

function buildFixture(): RerankFixture {
	const { store } = openTempStore();
	store.createStory({ id: "s-rerank", title: "重排序" });
	const root = store.appendNode({
		id: "n-root",
		storyId: "s-rerank",
		parentId: null,
		role: "system",
		raw: "青铜匕首藏在井底。",
	});
	const assistant = store.appendNode({
		id: "n-assistant",
		storyId: "s-rerank",
		parentId: root.id,
		role: "assistant",
		raw: "井底只有青铜匕首的鞘。",
	});
	const ask = store.appendNode({
		id: "n-ask",
		storyId: "s-rerank",
		parentId: assistant.id,
		role: "user",
		raw: "我找青铜匕首。",
	});
	store.insertMemoryEvents([
		{
			storyId: "s-rerank",
			sourceNodeId: root.id,
			ordinal: 0,
			participants: ["我"],
			importance: 0.5,
			knowers: [],
			text: "匕首藏在井底",
		},
	]);
	return {
		store,
		rootId: root.id,
		assistantId: assistant.id,
		askId: ask.id,
	};
}

describe("检索重排序", () => {
	it("关闭时融合顺序与现状逐条一致", async () => {
		const { store, askId } = buildFixture();
		const options = {
			store,
			storyId: "s-rerank",
			query: "青铜匕首",
			beforeNodeId: askId,
			limit: 10,
		};
		const initial = await retrieveMemory(options);
		const disabled = await retrieveMemory({ ...options, reranker: null });
		expect(disabled.hits).toEqual([...initial.hits]);
	});

	it("融合后按重排序分数重排候选，父段与事件正文都作为文档", async () => {
		const { store, assistantId, askId } = buildFixture();
		let receivedQuery: string | null = null;
		let received: readonly string[] = [];
		const reranker: RerankClient = {
			async rerank(query, documents) {
				receivedQuery = query;
				received = documents;
				return documents.map((document, index) => ({
					index,
					score: document.includes("鞘") ? 1 : 0,
				}));
			},
		};
		const result = await retrieveMemory({
			store,
			storyId: "s-rerank",
			query: "青铜匕首",
			beforeNodeId: askId,
			limit: 10,
			reranker,
		});
		expect(receivedQuery).toBe("青铜匕首");
		expect(received).toContain("匕首藏在井底");
		expect(received).toContain("井底只有青铜匕首的鞘。");
		expect(result.hits[0]?.nodeId).toBe(assistantId);
		expect(result.hits[0]?.kind).toBe("chunk");
	});

	it("只把前 rerankCandidates 条交给重排序，非法条数抛错", async () => {
		const { store, askId } = buildFixture();
		let received: readonly string[] = [];
		const reranker: RerankClient = {
			async rerank(_query, documents) {
				received = documents;
				return documents.map((_, index) => ({ index, score: 0 }));
			},
		};
		await retrieveMemory({
			store,
			storyId: "s-rerank",
			query: "青铜匕首",
			beforeNodeId: askId,
			limit: 10,
			reranker,
			rerankCandidates: 1,
		});
		expect(received).toHaveLength(1);
		await expect(
			retrieveMemory({
				store,
				storyId: "s-rerank",
				query: "青铜匕首",
				beforeNodeId: askId,
				reranker,
				rerankCandidates: 0,
			}),
		).rejects.toThrow("重排序候选条数");
	});

	it("重排序客户端返回的分数不足或有重复下标时抛错", async () => {
		const { store, askId } = buildFixture();
		const missing: RerankClient = {
			async rerank() {
				return [];
			},
		};
		await expect(
			retrieveMemory({
				store,
				storyId: "s-rerank",
				query: "青铜匕首",
				beforeNodeId: askId,
				reranker: missing,
			}),
		).rejects.toThrow("期望");
		const duplicated: RerankClient = {
			async rerank(_query, documents) {
				return documents.map(() => ({ index: 0, score: 1 }));
			},
		};
		await expect(
			retrieveMemory({
				store,
				storyId: "s-rerank",
				query: "青铜匕首",
				beforeNodeId: askId,
				reranker: duplicated,
			}),
		).rejects.toThrow("重复");
	});
});
