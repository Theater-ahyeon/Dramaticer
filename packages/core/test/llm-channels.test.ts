import { describe, expect, it } from "vitest";
import {
	applyChannelsUpdate,
	createLlmClient,
	modelFamily,
	parseChannelsConfig,
	readChannelsKeyRefs,
	resolveDefaultMaxTokens,
	resolveModelForRole,
	resolveToolTransport,
} from "../src/index.js";

const env = {
	BG_URL: "http://127.0.0.1:3425/v1",
	BG_KEY: "bg-secret",
	BG_MODEL: "opendesign/deepseek-v4.1-flash",
	MAIN_URL: "http://127.0.0.1:3425/v1",
	MAIN_KEY: "main-secret",
	MAIN_MODEL: "opendesign/deepseek-v4.1-flash",
};

function configText(overrides = ""): string {
	return `
channels:
  bg:
    api: openai-completions
    baseUrl: \${BG_URL}
    apiKey: \${BG_KEY}
    requestsPerMinute: 20
    maxRetries: 1
    timeoutMs: 120000
  backup:
    baseUrl: \${MAIN_URL}
    apiKey: \${MAIN_KEY}
models:
  background:
    id: \${BG_MODEL}
    contextWindow: 65536
    maxTokens: 4096
    reasoning: false
    channels: [bg, backup]
${overrides}
`;
}

describe("parseChannelsConfig", () => {
	it("解析渠道、模型和优先级顺序", () => {
		const config = parseChannelsConfig(configText(), env);
		const bg = config.channels.get("bg");
		expect(bg).toMatchObject({
			id: "bg",
			api: "openai-completions",
			baseUrl: "http://127.0.0.1:3425/v1",
			apiKey: "bg-secret",
			requestsPerMinute: 20,
			maxRetries: 1,
			timeoutMs: 120_000,
		});
		expect(config.channels.get("backup")?.api).toBe("openai-completions");
		const model = config.models.get("background");
		expect(model).toMatchObject({
			alias: "background",
			id: "opendesign/deepseek-v4.1-flash",
			contextWindow: 65_536,
			maxTokens: 4_096,
			reasoning: false,
			enabled: true,
			channels: ["bg", "backup"],
		});
	});

	it("用默认值补齐省略的字段", () => {
		const text = `
channels:
  only:
    baseUrl: \${BG_URL}
    apiKey: \${BG_KEY}
models:
  background:
    id: \${BG_MODEL}
    channels: [only]
`;
		const config = parseChannelsConfig(text, env);
		expect(config.channels.get("only")).toMatchObject({
			requestsPerMinute: 30,
			maxRetries: 2,
			retryBaseDelayMs: 1_000,
			timeoutMs: 300_000,
		});
		expect(config.models.get("background")).toMatchObject({
			contextWindow: 131_072,
			maxTokens: 8_192,
			reasoning: true,
		});
	});

	it("支持 Gemini 适配器", () => {
		const text = configText().replace(
			"api: openai-completions",
			"api: google-generative-ai",
		);
		expect(parseChannelsConfig(text, env).channels.get("bg")?.api).toBe(
			"google-generative-ai",
		);
	});

	it("支持 Vertex 适配器与空 apiKey（服务账号凭证走环境变量）", () => {
		const text = configText()
			.replace("api: openai-completions", "api: google-vertex")
			.replace("apiKey: ${BG_KEY}", 'apiKey: ""');
		const channel = parseChannelsConfig(text, env).channels.get("bg");
		expect(channel?.api).toBe("google-vertex");
		expect(channel?.apiKey).toBe("");
	});

	it("环境变量缺失时指出变量名", () => {
		expect(() =>
			parseChannelsConfig(configText(), { ...env, BG_KEY: undefined }),
		).toThrow("BG_KEY");
	});

	it("apiKey 必须写成环境变量引用", () => {
		const text = configText().replace("apiKey: ${BG_KEY}", "apiKey: literal");
		expect(() => parseChannelsConfig(text, env)).toThrow("channels.bg.apiKey");
	});

	it("引用不存在的渠道时抛错", () => {
		const text = configText().replace("[bg, backup]", "[bg, missing]");
		expect(() => parseChannelsConfig(text, env)).toThrow("missing");
	});

	it("重复引用渠道时抛错", () => {
		const text = configText().replace("[bg, backup]", "[bg, bg]");
		expect(() => parseChannelsConfig(text, env)).toThrow("重复");
	});

	it("未知适配器时抛错", () => {
		const text = configText().replace(
			"api: openai-completions",
			"api: not-an-api",
		);
		expect(() => parseChannelsConfig(text, env)).toThrow("openai-completions");
	});

	it("没有模型时抛错", () => {
		const text = `
channels:
  bg:
    baseUrl: \${BG_URL}
    apiKey: \${BG_KEY}
models: {}
`;
		expect(() => parseChannelsConfig(text, env)).toThrow("models");
	});
});

const roleEnv = {
	URL: "http://127.0.0.1:3425/v1",
	KEY: "secret",
};

interface RoleConfigOptions {
	readonly roles?: string;
	readonly backgroundId?: string;
}

function roleConfig(options: RoleConfigOptions = {}): string {
	return `
channels:
  gateway:
    baseUrl: \${URL}
    apiKey: \${KEY}
models:
  main:
    id: opendesign/deepseek-v4.1-flash
    channels: [gateway]
  background:
    id: ${options.backgroundId ?? "agy-gemini-3.8-flash-medium"}
    channels: [gateway]
  planner:
    id: codex/gpt-6.1-terra
    channels: [gateway]
${options.roles ?? ""}`;
}

describe("按岗位配置模型", () => {
	it("四个角色各自解析到配置的模型别名", () => {
		const config = parseChannelsConfig(
			roleConfig({
				roles: `roles:
  writer: main
  settler: background
  planner: planner
  judge: background
`,
			}),
			roleEnv,
		);
		expect([...config.roles]).toEqual([
			["writer", "main"],
			["settler", "background"],
			["planner", "planner"],
			["judge", "background"],
		]);
		expect(resolveModelForRole(config, "writer")).toBe("main");
		expect(resolveModelForRole(config, "settler")).toBe("background");
		expect(resolveModelForRole(config, "planner")).toBe("planner");
		expect(resolveModelForRole(config, "judge")).toBe("background");
	});

	it("没有配置角色时 writer 回落到 main、其余回落到 background", () => {
		const config = parseChannelsConfig(roleConfig(), roleEnv);
		expect(config.roles.size).toBe(0);
		expect(resolveModelForRole(config, "writer")).toBe("main");
		expect(resolveModelForRole(config, "settler")).toBe("background");
		expect(resolveModelForRole(config, "planner")).toBe("background");
		expect(resolveModelForRole(config, "judge")).toBe("background");
	});

	it("回落目标不存在时抛错并指出角色", () => {
		const text = `
channels:
  only:
    baseUrl: \${BG_URL}
    apiKey: \${BG_KEY}
models:
  main:
    id: opendesign/deepseek-v4.1-flash
    channels: [only]
`;
		const config = parseChannelsConfig(text, env);
		expect(() => resolveModelForRole(config, "settler")).toThrow(
			"角色 settler",
		);
		expect(() => resolveModelForRole(config, "settler")).toThrow(
			"background 模型",
		);
	});

	it("enabled: false 的模型不能担任角色", () => {
		const text = `
channels:
  gateway:
    baseUrl: \${URL}
    apiKey: \${KEY}
models:
  main:
    id: opendesign/deepseek-v4.1-flash
    channels: [gateway]
    enabled: false
  background:
    id: agy-gemini-3.8-flash-medium
    channels: [gateway]
roles:
  writer: main
`;
		const config = parseChannelsConfig(text, roleEnv);
		expect(config.models.get("main")?.enabled).toBe(false);
		expect(() => resolveModelForRole(config, "writer")).toThrow(
			"角色 writer 指向的模型 main 已经被停用",
		);
	});

	it("未知角色与不存在的模型别名都被拒绝", () => {
		expect(() =>
			parseChannelsConfig(
				roleConfig({ roles: "roles:\n  role: main\n" }),
				roleEnv,
			),
		).toThrow("roles.role");
		expect(() =>
			parseChannelsConfig(
				roleConfig({ roles: "roles:\n  writer: missing\n" }),
				roleEnv,
			),
		).toThrow("不存在的模型 missing");
	});

	it("由模型名映射家族，映射不到时按完整模型名比较", () => {
		expect(modelFamily("agy-gemini-3.8-flash-medium")).toBe("gemini");
		expect(modelFamily("opendesign/deepseek-v4.1-flash")).toBe("deepseek");
		expect(modelFamily("codex/gpt-6.1-terra")).toBe("gpt");
		expect(modelFamily("vendor/model-x")).toBe("vendor/model-x");
	});

	it("裁判与写作属于同一模型家族时创建路由抛错并指出两个角色", () => {
		const config = parseChannelsConfig(
			roleConfig({
				backgroundId: "auto/deepseek-v4.1-flash",
				roles: "roles:\n  writer: main\n  judge: background\n",
			}),
			roleEnv,
		);
		expect(() => createLlmClient(config)).toThrow("judge 与 writer");
		expect(() => createLlmClient(config)).toThrow("deepseek");
	});

	it("baseUrl 相同但模型不同家族的配置可以创建路由", () => {
		const config = parseChannelsConfig(
			roleConfig({
				roles: "roles:\n  writer: main\n  judge: background\n",
			}),
			roleEnv,
		);
		expect(config.channels.get("gateway")?.baseUrl).toBe(roleEnv.URL);
		expect(() =>
			createLlmClient(config, { defaultModel: "main" }),
		).not.toThrow();
	});

	it("没有配置角色时也按回落角色校验家族", () => {
		const config = parseChannelsConfig(
			roleConfig({ backgroundId: "auto/deepseek-v4.1-flash" }),
			roleEnv,
		);
		expect(() => createLlmClient(config)).toThrow("judge 与 writer");
	});
});

describe("故事设置的输出上限缺省值", () => {
	const text = `
channels:
  gateway:
    baseUrl: \${URL}
    apiKey: \${KEY}
models:
  large:
    id: opendesign/deepseek-v4.1-flash
    maxTokens: 8192
    channels: [gateway]
  small:
    id: vendor/model-x
    maxTokens: 2048
    channels: [gateway]
`;

	it("渠道声明大于 4096 时取 4096", () => {
		const config = parseChannelsConfig(text, { URL: "u", KEY: "k" });
		expect(resolveDefaultMaxTokens(config, "large")).toBe(4_096);
	});

	it("渠道声明小于 4096 时取声明值", () => {
		const config = parseChannelsConfig(text, { URL: "u", KEY: "k" });
		expect(resolveDefaultMaxTokens(config, "small")).toBe(2_048);
	});

	it("模型不在配置里时抛错", () => {
		const config = parseChannelsConfig(text, { URL: "u", KEY: "k" });
		expect(() => resolveDefaultMaxTokens(config, "missing")).toThrow(
			"没有配置模型 missing",
		);
	});
});

describe("工具传输", () => {
	const text = (modelExtra: string, probe = "") => `
channels:
  gateway:
    baseUrl: \${URL}
    apiKey: \${KEY}
models:
  main:
    id: vendor/model-x
    channels: [gateway]
${modelExtra}${probe}
`;

	it("显式配置 tools.transport 时按配置解析", () => {
		const config = parseChannelsConfig(
			text("    tools:\n      transport: text\n"),
			{ URL: "u", KEY: "k" },
		);
		const model = config.models.get("main");
		expect(model?.tools).toEqual({ transport: "text" });
		expect(model === undefined ? null : resolveToolTransport(model)).toBe(
			"text",
		);
	});

	it("没有配置工具传输时按体检结果决定默认值", () => {
		const config = parseChannelsConfig(
			text(
				"",
				`    probe:
      probedAt: 2026-11-07T00:00:00.000Z
      channel: gateway
      modelId: vendor/model-x
      streaming: streaming
      functionCalling: unsupported
      thinking: unknown
      prefill: unknown
      usage: supported
      cacheStats: unknown
      structuredOutput: text-tags
      notes: []
`,
			),
			{ URL: "u", KEY: "k" },
		);
		const model = config.models.get("main");
		expect(model?.tools).toBeNull();
		expect(model === undefined ? null : resolveToolTransport(model)).toBe(
			"text",
		);
	});

	it("没有体检结果时默认走原生函数调用", () => {
		const config = parseChannelsConfig(text(""), { URL: "u", KEY: "k" });
		const model = config.models.get("main");
		expect(model === undefined ? null : resolveToolTransport(model)).toBe(
			"native",
		);
	});

	it("非法的 tools.transport 抛错并指出字段", () => {
		expect(() =>
			parseChannelsConfig(text("    tools:\n      transport: grpc\n"), {
				URL: "u",
				KEY: "k",
			}),
		).toThrow("models.main.tools.transport");
	});
});

describe("改写渠道配置文本", () => {
	const source = `
# 顶部注释
channels:
  gateway:
    baseUrl: \${URL}
    apiKey: \${KEY}
  backup:
    baseUrl: \${URL}
    apiKey: \${KEY}
models:
  main:
    id: opendesign/deepseek-v4.1-flash
    maxTokens: 4096
    channels: [gateway, backup]
    tools:
      transport: text
    probe:
      probedAt: 2026-01-01T00:00:00.000Z
      channel: gateway
      modelId: old-model
      streaming: streaming
      functionCalling: supported
      thinking: supported
      prefill: unsupported
      usage: supported
      cacheStats: unsupported
      structuredOutput: function-call
      notes: []
roles:
  writer: main
`;

	it("编辑渠道、模型与角色，保留 probe、tools 与注释", () => {
		const updated = applyChannelsUpdate(
			source,
			{
				channels: {
					gateway: {
						api: "openai-completions",
						baseUrl: "${URL}",
						apiKeyEnv: "KEY",
						requestsPerMinute: 5,
						maxRetries: 1,
						retryBaseDelayMs: 0,
						timeoutMs: 1_000,
					},
				},
				models: {
					main: {
						id: "auto/deepseek-v4.1-flash",
						contextWindow: 65_536,
						maxTokens: 2_048,
						reasoning: false,
						enabled: false,
						channels: ["gateway"],
					},
				},
				embeddings: {},
				roles: { writer: "main", settler: "main" },
			},
			"channels.yaml",
		);
		expect(updated).toContain("# 顶部注释");
		expect(updated).toContain("${KEY}");
		expect(updated).not.toContain("secret");
		const config = parseChannelsConfig(
			updated,
			{ URL: "http://127.0.0.1:9/v1", KEY: "secret" },
			"channels.yaml",
		);
		expect([...config.channels.keys()]).toEqual(["gateway"]);
		expect(config.channels.get("gateway")?.requestsPerMinute).toBe(5);
		const model = config.models.get("main");
		expect(model).toMatchObject({
			id: "auto/deepseek-v4.1-flash",
			contextWindow: 65_536,
			maxTokens: 2_048,
			reasoning: false,
			enabled: false,
			channels: ["gateway"],
			tools: { transport: "text" },
		});
		expect(model?.probe?.modelId).toBe("old-model");
		expect(config.roles.get("writer")).toBe("main");
		expect(config.roles.get("settler")).toBe("main");
	});

	it("重新启用的模型不再写 enabled 字段", () => {
		const disabled = applyChannelsUpdate(
			source,
			{
				channels: {},
				models: {
					main: {
						id: "auto/deepseek-v4.1-flash",
						contextWindow: 65_536,
						maxTokens: 2_048,
						reasoning: true,
						enabled: false,
						channels: ["gateway", "backup"],
					},
				},
				embeddings: {},
				roles: {},
			},
			"channels.yaml",
		);
		expect(disabled).toContain("enabled: false");
		const enabled = applyChannelsUpdate(
			disabled,
			{
				channels: {},
				models: {
					main: {
						id: "auto/deepseek-v4.1-flash",
						contextWindow: 65_536,
						maxTokens: 2_048,
						reasoning: true,
						enabled: true,
						channels: ["gateway", "backup"],
					},
				},
				embeddings: {},
				roles: {},
			},
			"channels.yaml",
		);
		expect(enabled).not.toContain("enabled:");
	});

	it("非法 YAML 直接抛错", () => {
		expect(() =>
			applyChannelsUpdate(
				"models: [",
				{ channels: {}, models: {}, embeddings: {}, roles: {} },
				"channels.yaml",
			),
		).toThrow("不是合法的 YAML");
	});

	it("读出密钥引用的环境变量名", () => {
		const refs = readChannelsKeyRefs(source, "channels.yaml");
		expect(refs.channels.get("gateway")).toBe("KEY");
		expect(refs.channels.get("backup")).toBe("KEY");
		expect(refs.embeddings.size).toBe(0);
		const noKey = readChannelsKeyRefs(
			`
channels:
  local:
    baseUrl: http://127.0.0.1:9/v1
    apiKey: ""
models: {}
`,
			"channels.yaml",
		);
		expect(noKey.channels.get("local")).toBeNull();
	});
});
