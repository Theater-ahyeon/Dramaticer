import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { runProbeCli } from "../src/cli/index.js";
import {
	type LlmChannel,
	type LlmModelProbe,
	type LlmProviderRequest,
	type LlmProviderResult,
	type LlmUsage,
	createEventStream,
	loadChannelsConfig,
	parseChannelsConfig,
	probeChannel,
	writeModelProbe,
} from "../src/index.js";

const model = {
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
	readonly toolCalls?: LlmProviderResult["toolCalls"];
	readonly stopReason?: LlmProviderResult["stopReason"];
	readonly usage?: LlmUsage;
	readonly errorMessage?: string;
	readonly error?: unknown;
}

function usage(promptTokens: number, completionTokens: number, cached = 0) {
	return {
		promptTokens,
		completionTokens,
		totalTokens: promptTokens + completionTokens,
		reasoningTokens: null,
		cachedTokens: cached,
	};
}

function scriptedChannel(
	respond: (request: LlmProviderRequest, call: number) => Script,
	id = "main",
): LlmChannel {
	let call = 0;
	return {
		id,
		baseUrl: "fake-endpoint",
		apiKey: "",
		requestsPerMinute: 0,
		maxRetries: 0,
		retryBaseDelayMs: 0,
		stream(request) {
			call += 1;
			const script = respond(request, call);
			return createEventStream(async (emit) => {
				for (const delta of script.deltas ?? []) {
					emit({ type: "text_delta", delta });
				}
				for (const delta of script.thinkingDeltas ?? []) {
					emit({ type: "thinking_delta", delta });
				}
				if (script.error !== undefined) throw script.error;
				const text = script.text ?? (script.deltas ?? []).join("");
				const reasoning =
					script.reasoning ?? (script.thinkingDeltas ?? []).join("");
				return {
					text,
					reasoning,
					toolCalls: script.toolCalls ?? [],
					finishReason: script.stopReason ?? "stop",
					stopReason: script.stopReason ?? "stop",
					model: model.id,
					usage: script.usage ?? usage(10, 5),
					raw: null,
					retryable: false,
					status: null,
					errorMessage: script.errorMessage ?? null,
					continuation: null,
				};
			});
		},
	};
}

function normalChannel(): LlmChannel {
	let cacheCalls = 0;
	return scriptedChannel((request) => {
		if (request.tools !== undefined) {
			return {
				toolCalls: [
					{
						id: "call-1",
						name: "dramaticer_probe",
						arguments: { value: "ok" },
					},
				],
				stopReason: "toolUse",
			};
		}
		if (request.messages.at(-1)?.role === "assistant") {
			return { text: '"probe":"prefill-ok"}' };
		}
		if (request.messages.some((message) => message.role === "system")) {
			cacheCalls += 1;
			return {
				text: "OK",
				usage: usage(2_000, 1, cacheCalls === 2 ? 1_800 : 0),
			};
		}
		return {
			deltas: ["第一段", "第二段"],
			thinkingDeltas: ["先想一下"],
			usage: usage(12, 8),
		};
	});
}

function tempChannelsFile(text: string): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-probe-"));
	onTestFinished(() => {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
	});
	const file = join(dir, "channels.yaml");
	writeFileSync(file, text, "utf8");
	return file;
}

const CLI_CONFIG = `# 保留这条注释
channels:
  main:
    api: openai-completions
    baseUrl: fake-main
    apiKey: ""
    requestsPerMinute: 0
  backup:
    api: openai-completions
    baseUrl: fake-backup
    apiKey: ""
    requestsPerMinute: 0
models:
  text:
    id: model-a
    channels: [main, backup]
  other:
    id: model-b
    channels: [main]
`;

describe("probeChannel", () => {
	it("识别流式、思考、用量、函数调用、预填充与缓存统计", async () => {
		const probe = await probeChannel({
			channel: normalChannel(),
			model,
			now: () => 1_000,
		});
		expect(probe).toMatchObject({
			probedAt: "1970-01-01T00:00:01.000Z",
			channel: "main",
			modelId: "test-model",
			streaming: "streaming",
			functionCalling: "supported",
			thinking: "supported",
			prefill: "supported",
			usage: "supported",
			cacheStats: "supported",
			structuredOutput: "function-call",
		});
		expect(probe.notes.length).toBeGreaterThan(0);
	});

	it("只收到一个正文增量时判为假流式", async () => {
		const channel = scriptedChannel((request) => {
			if (request.tools !== undefined) return { toolCalls: [] };
			if (request.messages.at(-1)?.role === "assistant") {
				return { text: '{"probe":"prefill-ok"}' };
			}
			if (request.messages.some((message) => message.role === "system")) {
				return { text: "OK", usage: usage(10, 1, 0) };
			}
			return { deltas: ["一次性正文"] };
		});
		const probe = await probeChannel({ channel, model });
		expect(probe.streaming).toBe("buffered");
		expect(probe.thinking).toBe("unsupported");
		expect(probe.functionCalling).toBe("unsupported");
		expect(probe.prefill).toBe("unsupported");
		expect(probe.cacheStats).toBe("unsupported");
		expect(probe.structuredOutput).toBe("text-tags");
	});

	it("渠道拒绝工具定义时判为不支持函数调用", async () => {
		const channel = scriptedChannel((request) => {
			if (request.tools !== undefined) {
				return {
					stopReason: "error",
					errorMessage: "tools are not supported by this endpoint",
				};
			}
			if (request.messages.at(-1)?.role === "assistant") {
				return { text: '"probe":"prefill-ok"}' };
			}
			if (request.messages.some((message) => message.role === "system")) {
				return { text: "OK" };
			}
			return { deltas: ["甲", "乙"], thinkingDeltas: ["思考"] };
		});
		const probe = await probeChannel({ channel, model });
		expect(probe.functionCalling).toBe("unsupported");
		expect(probe.structuredOutput).toBe("text-tags");
	});

	it("流式请求失败时对应能力记为未知，其他检查继续", async () => {
		const channel = scriptedChannel((request) => {
			if (request.tools !== undefined) {
				return {
					toolCalls: [
						{
							id: "call-1",
							name: "dramaticer_probe",
							arguments: { value: "ok" },
						},
					],
					stopReason: "toolUse",
				};
			}
			if (request.messages.at(-1)?.role === "assistant") {
				return { text: '"probe":"prefill-ok"}' };
			}
			if (request.messages.some((message) => message.role === "system")) {
				return { text: "OK", usage: usage(10, 1, 5) };
			}
			return { error: new Error("连接被拒绝") };
		});
		const probe = await probeChannel({ channel, model });
		expect(probe.streaming).toBe("unknown");
		expect(probe.thinking).toBe("unknown");
		expect(probe.usage).toBe("unknown");
		expect(probe.functionCalling).toBe("supported");
		expect(probe.notes.some((note) => note.includes("连接被拒绝"))).toBe(true);
	});
});

describe("writeModelProbe", () => {
	it("写回模型配置并保留注释与环境变量引用", async () => {
		const file = tempChannelsFile(`# 保留这条注释
channels:
  main:
    api: openai-completions
    baseUrl: \${TEST_URL}
    apiKey: \${TEST_KEY}
models:
  text:
    id: \${TEST_MODEL}
    channels: [main]
`);
		const probe: LlmModelProbe = {
			probedAt: "2026-11-07T00:00:00.000Z",
			channel: "main",
			modelId: "model-a",
			streaming: "streaming",
			functionCalling: "supported",
			thinking: "supported",
			prefill: "unsupported",
			usage: "supported",
			cacheStats: "unsupported",
			structuredOutput: "function-call",
			notes: ["正文增量 3 个"],
		};
		await writeModelProbe(file, "text", probe);
		const text = readFileSync(file, "utf8");
		expect(text).toContain("# 保留这条注释");
		expect(text).toContain("${TEST_URL}");
		expect(text).toContain("${TEST_KEY}");
		expect(text).toContain("${TEST_MODEL}");
		const parsed = parseChannelsConfig(text, {
			TEST_URL: "resolved-url",
			TEST_KEY: "resolved-key",
			TEST_MODEL: "resolved-model",
		});
		expect(parsed.models.get("text")?.probe).toEqual(probe);
	});

	it("模型不存在时抛错", async () => {
		const file = tempChannelsFile(CLI_CONFIG);
		const probe: LlmModelProbe = {
			probedAt: "2026-11-07T00:00:00.000Z",
			channel: "main",
			modelId: "model-a",
			streaming: "streaming",
			functionCalling: "supported",
			thinking: "supported",
			prefill: "unsupported",
			usage: "supported",
			cacheStats: "unsupported",
			structuredOutput: "function-call",
			notes: [],
		};
		await expect(writeModelProbe(file, "missing", probe)).rejects.toThrow(
			"没有模型 missing",
		);
	});

	it("拒绝结构不合法的 probe 字段", () => {
		expect(() =>
			parseChannelsConfig(`
channels:
  main:
    baseUrl: fake
    apiKey: ""
models:
  text:
    id: model-a
    channels: [main]
    probe:
      probedAt: "2026-11-07T00:00:00.000Z"
      channel: main
      modelId: model-a
      streaming: maybe
      functionCalling: supported
      thinking: supported
      prefill: unsupported
      usage: supported
      cacheStats: unsupported
      structuredOutput: function-call
      notes: []
`),
		).toThrow("probe.streaming");
	});
});

describe("runProbeCli", () => {
	it("写回指定模型，并在多渠道模型之间要求 --model", async () => {
		const file = tempChannelsFile(CLI_CONFIG);
		const channel = normalChannel();
		const result = await runProbeCli(["probe", "main", "--model", "text"], {
			channelsPath: file,
			loadEnv: () => undefined,
			createChannel: () => channel,
			log: () => undefined,
			now: () => 1_000,
		});
		expect(result.alias).toBe("text");
		expect(result.probe.streaming).toBe("streaming");
		const parsed = await loadChannelsConfig(file, {});
		expect(parsed.models.get("text")?.probe?.functionCalling).toBe("supported");
		expect(parsed.models.get("other")?.probe).toBeNull();

		await expect(
			runProbeCli(["probe", "main"], {
				channelsPath: file,
				loadEnv: () => undefined,
				createChannel: () => channel,
				log: () => undefined,
			}),
		).rejects.toThrow("请用 --model 指定");
	});

	it("渠道不存在或参数不合法时抛错", async () => {
		const file = tempChannelsFile(CLI_CONFIG);
		const deps = {
			channelsPath: file,
			loadEnv: () => undefined,
			createChannel: () => normalChannel(),
			log: () => undefined,
		};
		await expect(runProbeCli(["probe", "missing"], deps)).rejects.toThrow(
			"没有渠道 missing",
		);
		await expect(runProbeCli(["probe"], deps)).rejects.toThrow("用法");
		await expect(
			runProbeCli(["probe", "main", "--unknown"], deps),
		).rejects.toThrow("不认识的参数");
	});
});
