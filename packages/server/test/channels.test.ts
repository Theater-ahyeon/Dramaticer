import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type LlmChannel,
	type LlmChannelConfig,
	type LlmProviderResult,
	type LlmProviderStream,
	type LlmProviderStreamEvent,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	createBackgroundJobRegistry,
} from "@dramaticer/core";
import type {
	ApiErrorResponse,
	ChannelProbeResult,
	ChannelsView,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

const ENV = {
	TEST_KEY: "secret-value",
	TEST_URL: "http://127.0.0.1:9/v1",
};

const SOURCE = `channels:
  gateway:
    baseUrl: \${TEST_URL}
    apiKey: \${TEST_KEY}
models:
  main:
    id: auto/deepseek-v4.1-flash
    channels: [gateway]
  background:
    id: agy-gemini-3.8-flash-medium
    channels: [gateway]
  judge:
    id: codex/gpt-6.1-terra
    channels: [gateway]
roles:
  writer: main
  judge: judge
`;

function emptyUsage(overrides: Partial<LlmUsage> = {}): LlmUsage {
	return {
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		reasoningTokens: null,
		cachedTokens: null,
		...overrides,
	};
}

function streamOf(
	events: readonly LlmProviderStreamEvent[],
	overrides: Partial<LlmProviderResult>,
): LlmProviderStream {
	const result: LlmProviderResult = {
		text: "",
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		usage: emptyUsage(),
		raw: null,
		retryable: false,
		status: 200,
		errorMessage: null,
		continuation: null,
		...overrides,
	};
	return {
		async *[Symbol.asyncIterator]() {
			yield* events;
		},
		async result() {
			return result;
		},
	};
}

/** 按体检提示词返回固定结果；缓存检查在第二次报告命中。 */
function fakeChannel(config: LlmChannelConfig): LlmChannel {
	let cacheCalls = 0;
	return {
		id: config.id,
		baseUrl: config.baseUrl,
		apiKey: config.apiKey,
		requestsPerMinute: 0,
		maxRetries: 0,
		retryBaseDelayMs: 0,
		stream(request) {
			const prompt = request.messages[0]?.content ?? "";
			if (prompt.startsWith("请用一句话")) {
				return streamOf(
					[
						{ type: "text_delta", delta: "你" },
						{ type: "text_delta", delta: "好" },
					],
					{
						text: "你好",
						reasoning: "想一想",
						usage: emptyUsage({
							promptTokens: 10,
							completionTokens: 5,
						}),
					},
				);
			}
			if (prompt.startsWith("请调用")) {
				return streamOf([], {
					stopReason: "toolUse",
					finishReason: "tool_calls",
					toolCalls: [
						{
							id: "call-1",
							name: "dramaticer_probe",
							arguments: { value: "ok" },
						},
					],
				});
			}
			if (prompt.startsWith("请只输出")) {
				return streamOf([], { text: 'probe":"prefill-ok"}' });
			}
			cacheCalls += 1;
			return streamOf([], {
				text: "OK",
				usage: emptyUsage({
					promptTokens: 10,
					completionTokens: 1,
					cachedTokens: cacheCalls > 1 ? 128 : null,
				}),
			});
		},
	};
}

interface TestServer {
	readonly running: RunningServer;
	readonly file: string;
	readonly dir: string;
	readonly builds: string[];
}

function replyClient(): LlmStreamingClient {
	const result: LlmResult = {
		text: "好",
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake",
		usage: emptyUsage({ promptTokens: 1, completionTokens: 1 }),
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
	return {
		async complete() {
			throw new Error("回合不应该调用 complete");
		},
		stream() {
			return {
				async *[Symbol.asyncIterator]() {
					yield { type: "text_delta" as const, delta: "好" };
				},
				async result() {
					return result;
				},
			};
		},
	};
}

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-channels-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

async function startChannelsServer(
	client?: LlmStreamingClient,
	createChannel: (config: LlmChannelConfig) => LlmChannel = fakeChannel,
): Promise<TestServer> {
	const dir = tempDir();
	const file = join(dir, "channels.yaml");
	writeFileSync(file, SOURCE);
	const builds: string[] = [];
	const running = await startServer({
		dbPath: join(dir, "story.db"),
		webRoot: join(dir, "web"),
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => {},
		channels: {
			path: file,
			env: ENV,
			createChannel,
			...(client === undefined
				? {}
				: {
						createClient: (_config, alias) => {
							builds.push(alias);
							return client;
						},
						createBackgroundRegistry: () => createBackgroundJobRegistry([]),
					}),
		},
	});
	onTestFinished(() => running.close());
	return { running, file, dir, builds };
}

async function request(
	origin: string,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${origin}${path}`, {
		...init,
		headers: { "Content-Type": "application/json", ...init.headers },
	});
}

function send(
	origin: string,
	path: string,
	method: string,
	body: unknown,
): Promise<Response> {
	return request(origin, path, { method, body: JSON.stringify(body) });
}

const CHANNELS = {
	gateway: {
		api: "openai-completions",
		baseUrl: "${TEST_URL}",
		apiKeyEnv: "TEST_KEY",
		requestsPerMinute: 5,
		maxRetries: 1,
		retryBaseDelayMs: 0,
		timeoutMs: 1_000,
	},
};

const MODELS = {
	main: {
		id: "auto/deepseek-v4.1-flash",
		contextWindow: 65_536,
		maxTokens: 4_096,
		reasoning: true,
		enabled: true,
		channels: ["gateway"],
	},
	background: {
		id: "agy-gemini-3.8-flash-medium",
		contextWindow: 65_536,
		maxTokens: 4_096,
		reasoning: true,
		enabled: true,
		channels: ["gateway"],
	},
	judge: {
		id: "codex/gpt-6.1-terra",
		contextWindow: 65_536,
		maxTokens: 4_096,
		reasoning: true,
		enabled: true,
		channels: ["gateway"],
	},
};

function updateBody(
	overrides: {
		readonly channels?: unknown;
		readonly models?: unknown;
		readonly roles?: unknown;
		readonly embeddings?: unknown;
	} = {},
): unknown {
	return {
		channels: overrides.channels ?? CHANNELS,
		models: overrides.models ?? MODELS,
		embeddings: overrides.embeddings ?? {},
		roles: overrides.roles ?? { writer: "main", judge: "judge" },
	};
}

async function errorOf(response: Response): Promise<ApiErrorResponse["error"]> {
	return ((await response.json()) as ApiErrorResponse).error;
}

describe("GET /api/channels", () => {
	it("返回脱敏视图与岗位，不出现密钥值", async () => {
		const { running } = await startChannelsServer();
		const response = await request(running.origin, "/api/channels");
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).not.toContain("secret-value");
		const view = JSON.parse(text) as ChannelsView;
		expect(view.channels).toEqual([
			{
				id: "gateway",
				api: "openai-completions",
				baseUrl: "http://127.0.0.1:9/v1",
				apiKeyEnv: "TEST_KEY",
				apiKeySet: true,
				requestsPerMinute: 30,
				maxRetries: 2,
				retryBaseDelayMs: 1_000,
				timeoutMs: 300_000,
			},
		]);
		expect(view.models.map((model) => model.alias)).toEqual([
			"main",
			"background",
			"judge",
		]);
		expect(view.models.every((model) => model.enabled)).toBe(true);
		expect(view.models[0]?.probe).toBeNull();
		expect(view.roles).toEqual({
			writer: "main",
			settler: "background",
			planner: "background",
			judge: "judge",
		});
		expect(view.configuredRoles).toEqual({ writer: "main", judge: "judge" });
	});

	it("现有配置引用未设置的环境变量时返回 400", async () => {
		const { running, file } = await startChannelsServer();
		writeFileSync(
			file,
			SOURCE.replace("apiKey: ${TEST_KEY}", "apiKey: ${MISSING_KEY}"),
		);
		const response = await request(running.origin, "/api/channels");
		expect(response.status).toBe(400);
		const error = await errorOf(response);
		expect(error.message).toContain("MISSING_KEY");
	});
});

describe("PUT /api/channels", () => {
	it("原子写回新配置并保留密钥引用", async () => {
		const { running, file } = await startChannelsServer();
		const response = await send(
			running.origin,
			"/api/channels",
			"PUT",
			updateBody({
				channels: {
					gateway: { ...CHANNELS.gateway, requestsPerMinute: 5 },
					backup: {
						...CHANNELS.gateway,
						apiKeyEnv: "TEST_KEY",
						requestsPerMinute: 0,
					},
				},
				models: {
					...MODELS,
					main: {
						...MODELS.main,
						enabled: false,
						channels: ["gateway", "backup"],
					},
				},
				roles: { writer: "background", settler: "background", judge: "judge" },
			}),
		);
		expect(response.status).toBe(200);
		const view = (await response.json()) as ChannelsView;
		expect(view.channels.map((channel) => channel.id)).toEqual([
			"gateway",
			"backup",
		]);
		expect(view.models.find((model) => model.alias === "main")?.enabled).toBe(
			false,
		);
		expect(view.roles.writer).toBe("background");
		const written = readFileSync(file, "utf8");
		expect(written).toContain("${TEST_KEY}");
		expect(written).not.toContain("secret-value");
		expect(written).toContain("enabled: false");
		const reread = (await (
			await request(running.origin, "/api/channels")
		).json()) as ChannelsView;
		expect(reread.channels).toHaveLength(2);
		expect(reread.roles.writer).toBe("background");
	});

	it("缺失的环境变量返回 400", async () => {
		const { running } = await startChannelsServer();
		const response = await send(
			running.origin,
			"/api/channels",
			"PUT",
			updateBody({
				channels: {
					gateway: { ...CHANNELS.gateway, apiKeyEnv: "MISSING_KEY" },
				},
			}),
		);
		expect(response.status).toBe(400);
		const error = await errorOf(response);
		expect(error.message).toContain("MISSING_KEY");
	});

	it("roles 指向未知别名返回 400", async () => {
		const { running } = await startChannelsServer();
		const response = await send(
			running.origin,
			"/api/channels",
			"PUT",
			updateBody({ roles: { writer: "missing" } }),
		);
		expect(response.status).toBe(400);
		const error = await errorOf(response);
		expect(error.details).toMatchObject({ path: "roles.writer" });
	});

	it("writer 与 judge 同家族时照常保存，只在视图里提醒", async () => {
		const { running } = await startChannelsServer();
		const response = await send(
			running.origin,
			"/api/channels",
			"PUT",
			updateBody({ roles: { writer: "main", judge: "main" } }),
		);
		expect(response.status).toBe(200);
		const view = (await response.json()) as ChannelsView;
		expect(view.warnings.join("\n")).toContain("不影响游玩");
	});

	it("重复引用同一个渠道返回 400", async () => {
		const { running } = await startChannelsServer();
		const response = await send(
			running.origin,
			"/api/channels",
			"PUT",
			updateBody({
				models: {
					...MODELS,
					main: { ...MODELS.main, channels: ["gateway", "gateway"] },
				},
			}),
		);
		expect(response.status).toBe(400);
		const error = await errorOf(response);
		expect(error.message).toContain("重复引用了渠道 gateway");
	});

	it("写入后下一回合使用新的 writer", async () => {
		const { running, builds } = await startChannelsServer(replyClient());
		running.store.createStory({ id: "s1", title: "测试故事" });
		const turn = (text: string) =>
			request(running.origin, "/api/stories/s1/turns", {
				method: "POST",
				body: JSON.stringify({ text }),
			});
		const first = await turn("第一轮");
		expect(first.status).toBe(200);
		await first.text();
		expect(builds.slice(0, 3)).toEqual(["main", "background", "background"]);

		builds.length = 0;
		const response = await send(
			running.origin,
			"/api/channels",
			"PUT",
			updateBody({
				roles: { writer: "background", judge: "judge" },
			}),
		);
		expect(response.status).toBe(200);

		const second = await turn("第二轮");
		expect(second.status).toBe(200);
		await second.text();
		expect(builds.slice(0, 3)).toEqual([
			"background",
			"background",
			"background",
		]);
	});

	it("现有文件不是合法 YAML 时返回 400", async () => {
		const { running, file } = await startChannelsServer();
		writeFileSync(file, "models: [");
		const response = await send(
			running.origin,
			"/api/channels",
			"PUT",
			updateBody(),
		);
		expect(response.status).toBe(400);
		const error = await errorOf(response);
		expect(error.message).toContain("不是合法的 YAML");
	});
});

describe("POST /api/channels/probe", () => {
	it("用假通道体检并写回配置", async () => {
		const { running, file } = await startChannelsServer();
		const response = await send(running.origin, "/api/channels/probe", "POST", {
			alias: "main",
		});
		expect(response.status).toBe(200);
		const result = (await response.json()) as ChannelProbeResult;
		expect(result.alias).toBe("main");
		expect(result.channel).toBe("gateway");
		expect(result.probe).toMatchObject({
			streaming: "streaming",
			functionCalling: "supported",
			thinking: "supported",
			usage: "supported",
			cacheStats: "supported",
			structuredOutput: "function-call",
		});
		const written = readFileSync(file, "utf8");
		expect(written).toContain("probedAt:");
		expect(written).not.toContain("secret-value");
		const view = (await (
			await request(running.origin, "/api/channels")
		).json()) as ChannelsView;
		expect(
			view.models.find((model) => model.alias === "main")?.probe,
		).not.toBeNull();
	});

	it("按岗位体检：体检这个岗位当前生效的模型并写回", async () => {
		const { running, file } = await startChannelsServer();
		const response = await send(running.origin, "/api/channels/probe", "POST", {
			role: "settler",
		});
		expect(response.status).toBe(200);
		const result = (await response.json()) as ChannelProbeResult;
		expect(result.alias).toBe("background");
		expect(readFileSync(file, "utf8")).toContain("probedAt:");
		const both = await send(running.origin, "/api/channels/probe", "POST", {
			role: "settler",
			alias: "main",
		});
		expect(both.status).toBe(400);
		const unknown = await send(running.origin, "/api/channels/probe", "POST", {
			role: "cook",
		});
		expect(unknown.status).toBe(400);
	});

	it("渠道视图带上配置提醒：后台模型没有保底", async () => {
		const { running } = await startChannelsServer();
		const view = (await (
			await request(running.origin, "/api/channels")
		).json()) as ChannelsView;
		expect(view.warnings.some((item) => item.includes("没有配置保底"))).toBe(
			true,
		);
		expect(
			view.models.find((model) => model.alias === "background"),
		).toMatchObject({ fallback: null });
	});

	it("未知模型与没有配置的渠道返回 400", async () => {
		const { running } = await startChannelsServer();
		const unknownAlias = await send(
			running.origin,
			"/api/channels/probe",
			"POST",
			{ alias: "missing" },
		);
		expect(unknownAlias.status).toBe(400);
		const unknownChannel = await send(
			running.origin,
			"/api/channels/probe",
			"POST",
			{ alias: "main", channel: "missing" },
		);
		expect(unknownChannel.status).toBe(400);
	});

	it("体检通道创建失败时返回具体原因", async () => {
		const { running } = await startChannelsServer(undefined, () => {
			throw new Error("体检通道不可用：连接被拒绝");
		});
		const response = await send(running.origin, "/api/channels/probe", "POST", {
			alias: "main",
		});
		expect(response.status).toBe(400);
		const error = await errorOf(response);
		expect(error.message).toBe("渠道体检失败：体检通道不可用：连接被拒绝");
		expect(error.details).toEqual({ path: "alias" });
	});
});

describe("GET /api/stories/:id/background/health", () => {
	it("连续渠道失败时报告暂停、岗位、渠道与错误摘要，成功后恢复", async () => {
		const { running } = await startChannelsServer();
		const store = running.store;
		store.createStory({ id: "s1", title: "测试" });
		const fail = (kind: string) => {
			const [job] = store.enqueueStoryBackgroundJobs({
				storyId: "s1",
				kinds: [kind],
			});
			if (job === undefined) throw new Error("任务没有入队");
			store.startBackgroundJob(job.id);
			store.failBackgroundJob(job.id, {
				error:
					"模型 agy-gemini-3.8-flash-medium 的所有渠道都失败了：gateway：402 insufficient_balance",
				maxAttempts: 1,
			});
		};
		for (const kind of ["a", "b", "c"]) {
			fail(kind);
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		const health = (await (
			await request(running.origin, "/api/stories/s1/background/health")
		).json()) as {
			paused: boolean;
			roles: string[];
			channel: string | null;
			error: string | null;
		};
		expect(health.paused).toBe(true);
		expect(health.roles).toEqual(["settler", "planner"]);
		expect(health.channel).toBe("gateway");
		expect(health.error).toContain("402");
		expect(JSON.stringify(health)).not.toContain("secret-value");

		const [ok] = store.enqueueStoryBackgroundJobs({
			storyId: "s1",
			kinds: ["d"],
		});
		if (ok === undefined) throw new Error("任务没有入队");
		store.startBackgroundJob(ok.id);
		store.finishBackgroundJob(ok.id);
		const recovered = (await (
			await request(running.origin, "/api/stories/s1/background/health")
		).json()) as { paused: boolean };
		expect(recovered.paused).toBe(false);
	});
});

describe("GET /api/stories/:id/stats/rerolls", () => {
	it("给出每百楼重写率与原因分布，不含楼层原文", async () => {
		const { running } = await startChannelsServer();
		const store = running.store;
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "u1",
			storyId: "s1",
			parentId: null,
			role: "user",
			raw: "私密一",
		});
		store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: "u1",
			role: "assistant",
			raw: "私密二",
		});
		store.recordPreference({
			storyId: "s1",
			nodeId: "a1",
			kind: "swipe",
			payload: {
				abandonedNodeId: "a1",
				acceptedNodeId: "a1",
				reason: "too-short",
			},
		});
		const response = await request(
			running.origin,
			"/api/stories/s1/stats/rerolls",
		);
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).not.toContain("私密");
		const report = JSON.parse(text) as {
			total: { floors: number; rerolls: number; perHundred: number };
		};
		expect(report.total).toEqual({ floors: 1, rerolls: 1, perHundred: 100 });
	});
});
