import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { loadImagesConfig, parseImagesConfig } from "../src/index.js";

const env = {
	COMFY_URL: "http://127.0.0.1:8188",
	COMFY_KEY: "comfy-secret",
};

function configText(overrides = ""): string {
	return `
providers:
  comfy:
    api: comfyui
    baseUrl: \${COMFY_URL}
    apiKey: \${COMFY_KEY}
${overrides}
`;
}

describe("parseImagesConfig", () => {
	it("解析 provider 与默认超时、轮询间隔", () => {
		const config = parseImagesConfig(configText(), env);
		expect(config.providers.get("comfy")).toEqual({
			id: "comfy",
			api: "comfyui",
			baseUrl: "http://127.0.0.1:8188",
			apiKey: "comfy-secret",
			timeoutMs: 300_000,
			pollIntervalMs: 1_000,
		});
	});

	it("接受显式超时、轮询间隔与空 apiKey", () => {
		const text = configText()
			.replace("apiKey: ${COMFY_KEY}", 'apiKey: ""')
			.replace(
				"    baseUrl: ${COMFY_URL}",
				"    baseUrl: ${COMFY_URL}\n    timeoutMs: 120000\n    pollIntervalMs: 250",
			);
		const config = parseImagesConfig(text, env);
		expect(config.providers.get("comfy")).toMatchObject({
			apiKey: "",
			timeoutMs: 120_000,
			pollIntervalMs: 250,
		});
	});

	it("providers 为空时返回空配置", () => {
		expect(parseImagesConfig("providers: {}\n", env).providers.size).toBe(0);
	});

	it("未知根字段、未知 api 与未知 provider 字段都抛错并指出路径", () => {
		expect(() => parseImagesConfig("providers: {}\nextra: 1\n", env)).toThrow(
			/images\.yaml\.extra/,
		);
		const unknownApi = configText().replace("api: comfyui", "api: novelai");
		expect(() => parseImagesConfig(unknownApi, env)).toThrow(
			/images\.yaml\.providers\.comfy\.api/,
		);
		const unknownField = configText().replace(
			"    apiKey: ${COMFY_KEY}",
			"    apiKey: ${COMFY_KEY}\n    secret: x",
		);
		expect(() => parseImagesConfig(unknownField, env)).toThrow(
			/images\.yaml\.providers\.comfy\.secret/,
		);
	});

	it("非法 URL 与非正数超时都抛错", () => {
		const badUrl = configText().replace("${COMFY_URL}", "not a url");
		expect(() => parseImagesConfig(badUrl, env)).toThrow(
			/images\.yaml\.providers\.comfy\.baseUrl/,
		);
		const ftpUrl = configText().replace("${COMFY_URL}", "ftp://127.0.0.1:8188");
		expect(() => parseImagesConfig(ftpUrl, env)).toThrow(
			/images\.yaml\.providers\.comfy\.baseUrl/,
		);
		const zeroTimeout = configText().replace(
			"    apiKey: ${COMFY_KEY}",
			"    apiKey: ${COMFY_KEY}\n    timeoutMs: 0",
		);
		expect(() => parseImagesConfig(zeroTimeout, env)).toThrow(
			/images\.yaml\.providers\.comfy\.timeoutMs/,
		);
		const zeroPoll = configText().replace(
			"    apiKey: ${COMFY_KEY}",
			"    apiKey: ${COMFY_KEY}\n    pollIntervalMs: -1",
		);
		expect(() => parseImagesConfig(zeroPoll, env)).toThrow(
			/images\.yaml\.providers\.comfy\.pollIntervalMs/,
		);
	});

	it("apiKey 不是环境变量引用或变量缺失时抛错", () => {
		const literal = configText().replace("${COMFY_KEY}", "secret-value");
		expect(() => parseImagesConfig(literal, env)).toThrow(
			/images\.yaml\.providers\.comfy\.apiKey/,
		);
		const missing = configText().replace("${COMFY_KEY}", "${NOT_SET}");
		expect(() => parseImagesConfig(missing, env)).toThrow(
			/images\.yaml\.providers\.comfy\.apiKey/,
		);
	});

	it("文件不存在时返回空配置", async () => {
		const dir = mkdtempSync(join(import.meta.dirname, ".tmp-images-"));
		onTestFinished(() => {
			rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
		});
		const config = await loadImagesConfig(join(dir, "images.yaml"), env);
		expect(config.providers.size).toBe(0);
	});
});
