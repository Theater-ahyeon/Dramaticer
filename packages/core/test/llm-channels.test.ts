import { describe, expect, it } from "vitest";
import { parseChannelsConfig } from "../src/index.js";

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
