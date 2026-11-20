import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelsView } from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { upsertEnvFile } from "../src/env-file.js";
import { startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "dramaticer-setup-"));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

async function start(
	dir: string,
	fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>,
) {
	const running = await startServer({
		dbPath: join(dir, "story.db"),
		webRoot: join(dir, "web"),
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => {},
		channels: {
			path: join(dir, "channels.yaml"),
			env: {},
			envFile: join(dir, ".env"),
			...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
		},
	});
	onTestFinished(() => running.close());
	return running;
}

function call(origin: string, path: string, method = "GET", body?: unknown) {
	return fetch(`${origin}${path}`, {
		method,
		headers: { "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

describe("新装环境的渠道向导接口", () => {
	it("没有渠道文件也能启动；读取返回空视图", async () => {
		const dir = tempDir();
		const running = await start(dir);
		const response = await call(running.origin, "/api/channels");
		expect(response.status).toBe(200);
		const view = (await response.json()) as ChannelsView;
		expect(view.channels).toEqual([]);
		expect(view.roles.writer).toBeNull();
	});

	it("保存密钥写进 env 文件、立即生效，响应不回传密钥；随后能创建渠道", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, ".env"), "# 注释\nOTHER=1\n");
		const running = await start(dir);
		const saved = await call(running.origin, "/api/channels/keys", "POST", {
			name: "DRAMATICER_KEY_DEEPSEEK",
			value: "sk-test-123",
		});
		expect(saved.status).toBe(200);
		const text = await saved.text();
		expect(text).not.toContain("sk-test-123");
		const envText = readFileSync(join(dir, ".env"), "utf8");
		expect(envText).toContain("# 注释\nOTHER=1\n");
		expect(envText).toContain("DRAMATICER_KEY_DEEPSEEK=sk-test-123");

		const put = await call(running.origin, "/api/channels", "PUT", {
			channels: {
				deepseek: {
					api: "openai-completions",
					baseUrl: "http://127.0.0.1:9/v1",
					apiKeyEnv: "DRAMATICER_KEY_DEEPSEEK",
					requestsPerMinute: 0,
					maxRetries: 1,
					retryBaseDelayMs: 1000,
					timeoutMs: 60000,
				},
			},
			models: {
				main: {
					id: "deepseek-chat",
					contextWindow: 64000,
					maxTokens: 4096,
					reasoning: false,
					enabled: true,
					channels: ["deepseek"],
				},
			},
			embeddings: {},
			roles: {
				writer: "main",
				settler: "main",
				planner: "main",
				judge: "main",
			},
		});
		expect(put.status).toBe(200);
		const view = (await put.json()) as ChannelsView;
		expect(view.channels[0]?.apiKeySet).toBe(true);
		expect(existsSync(join(dir, "channels.yaml"))).toBe(true);
		expect(readFileSync(join(dir, "channels.yaml"), "utf8")).not.toContain(
			"sk-test-123",
		);
	});

	it("拒绝不合法的名字与带空格的密钥", async () => {
		const running = await start(tempDir());
		const badName = await call(running.origin, "/api/channels/keys", "POST", {
			name: "lower",
			value: "x",
		});
		expect(badName.status).toBe(400);
		const badValue = await call(running.origin, "/api/channels/keys", "POST", {
			name: "GOOD_NAME",
			value: "has space",
		});
		expect(badValue.status).toBe(400);
	});

	it("用保存的密钥获取模型列表；OpenAI 与 Gemini 两种格式都能读，401 给出明确提示", async () => {
		const dir = tempDir();
		const seen: { url: string; headers: Record<string, string> }[] = [];
		let status = 200;
		const running = await start(dir, async (url, init) => {
			seen.push({ url, headers: init?.headers as Record<string, string> });
			if (status !== 200) return new Response("no", { status });
			return url.includes("gemini")
				? Response.json({ models: [{ name: "models/gemini-x" }] })
				: Response.json({ data: [{ id: "b-model" }, { id: "a-model" }] });
		});
		await call(running.origin, "/api/channels/keys", "POST", {
			name: "K_ONE",
			value: "sk-1",
		});
		const openai = await call(running.origin, "/api/channels/models", "POST", {
			api: "openai-completions",
			baseUrl: "http://127.0.0.1:9/v1/",
			apiKeyEnv: "K_ONE",
		});
		expect(await openai.json()).toEqual({ models: ["a-model", "b-model"] });
		expect(seen[0]?.url).toBe("http://127.0.0.1:9/v1/models");
		expect(seen[0]?.headers.Authorization).toBe("Bearer sk-1");
		const gemini = await call(running.origin, "/api/channels/models", "POST", {
			api: "google-generative-ai",
			baseUrl: "http://127.0.0.1:9/gemini",
			apiKeyEnv: "K_ONE",
		});
		expect(await gemini.json()).toEqual({ models: ["gemini-x"] });
		status = 401;
		const denied = await call(running.origin, "/api/channels/models", "POST", {
			api: "openai-completions",
			baseUrl: "http://127.0.0.1:9/v1",
			apiKeyEnv: "K_ONE",
		});
		expect(denied.status).toBe(502);
		expect(await denied.text()).toContain("密钥被拒绝");
	});
});

describe("env 文件写入", () => {
	it("替换已有的同名行，保留其它行；含 # 的值加引号", async () => {
		const dir = tempDir();
		const file = join(dir, ".env");
		writeFileSync(file, "A=1\nexport KEY_X=old\nB=2");
		await upsertEnvFile(file, "KEY_X", "new#v");
		expect(readFileSync(file, "utf8")).toBe('A=1\nKEY_X="new#v"\nB=2');
		await upsertEnvFile(file, "KEY_Y", "y");
		expect(readFileSync(file, "utf8")).toBe(
			'A=1\nKEY_X="new#v"\nB=2\nKEY_Y=y\n',
		);
	});
});
