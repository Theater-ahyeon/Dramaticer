import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { runStBenchCli } from "../src/st-bench/cli.js";
import {
	RECORD_ONLY_STUB_TEXT,
	readPromptRecordFile,
	readPromptRecordIndex,
	startPromptRecorder,
} from "../src/st-bench/recorder.js";
import {
	assertSandboxTarget,
	copySillyTavernSandbox,
	isDeniedSourcePath,
	stBenchPaths,
} from "../src/st-bench/sandbox.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(path.join(TEST_DIR, ".tmp-st-bench-"));
	onTestFinished(async () => {
		await rm(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	});
	return dir;
}

interface HttpResult {
	readonly status: number;
	readonly text: string;
}

function sendHttp(
	url: string,
	method: string,
	body?: string,
	headers: Record<string, string> = {},
): Promise<HttpResult> {
	const target = new URL(url);
	const { promise, resolve, reject } = Promise.withResolvers<HttpResult>();
	const request = http.request(
		{
			hostname: target.hostname,
			port: target.port,
			path: `${target.pathname}${target.search}`,
			method,
			headers: {
				...(body === undefined ? {} : { "content-type": "application/json" }),
				...headers,
			},
		},
		(response) => {
			const chunks: Buffer[] = [];
			response.on("data", (chunk: Buffer) => chunks.push(chunk));
			response.on("end", () => {
				resolve({
					status: response.statusCode ?? 0,
					text: Buffer.concat(chunks).toString("utf8"),
				});
			});
		},
	);
	request.on("error", reject);
	if (body !== undefined) request.write(body);
	request.end();
	return promise;
}

function chatBody(stream: boolean): string {
	return JSON.stringify({
		model: "st-test-model",
		stream,
		messages: [
			{ role: "system", content: "系统提示" },
			{ role: "user", content: "你好" },
		],
		temperature: 0.7,
	});
}

describe("ST prompt 录制服务", () => {
	it("非流式请求返回桩响应并把请求写入索引", async () => {
		const dir = await makeTempDir();
		const recorder = await startPromptRecorder({ dir });
		onTestFinished(() => recorder.close());

		const response = await sendHttp(
			`${recorder.url}/v1/chat/completions`,
			"POST",
			chatBody(false),
			{ authorization: "Bearer secret-token", "x-api-key": "another-secret" },
		);
		expect(response.status).toBe(200);
		const payload = JSON.parse(response.text) as {
			choices: { message: { role: string; content: string } }[];
		};
		expect(payload.choices[0]?.message.content).toBe(RECORD_ONLY_STUB_TEXT);
		expect(payload.choices[0]?.message.role).toBe("assistant");

		await recorder.close();
		const index = await readPromptRecordIndex(dir);
		expect(index).toHaveLength(1);
		expect(index[0]?.model).toBe("st-test-model");
		expect(index[0]?.stream).toBe(false);
		expect(index[0]?.messageCount).toBe(2);
		const first = index[0];
		if (first === undefined) throw new Error("索引缺少第一条记录");
		const record = await readPromptRecordFile(dir, first);
		expect(record.body).toEqual({
			model: "st-test-model",
			stream: false,
			messages: [
				{ role: "system", content: "系统提示" },
				{ role: "user", content: "你好" },
			],
			temperature: 0.7,
		});
		expect(record.headers.authorization).toBe("<redacted>");
		expect(record.headers["x-api-key"]).toBe("<redacted>");
	});

	it("流式请求返回 OpenAI SSE 桩，达到上限后自动停止", async () => {
		const dir = await makeTempDir();
		const recorder = await startPromptRecorder({ dir, maxRequests: 1 });
		const response = await sendHttp(
			`${recorder.url}/v1/chat/completions`,
			"POST",
			chatBody(true),
		);
		expect(response.status).toBe(200);
		expect(response.text).toContain("chat.completion.chunk");
		expect(response.text).toContain(RECORD_ONLY_STUB_TEXT);
		expect(response.text.trimEnd().endsWith("data: [DONE]")).toBe(true);

		await recorder.closed;
		await recorder.close();
		const index = await readPromptRecordIndex(dir);
		expect(index).toHaveLength(1);
		expect(index[0]?.stream).toBe(true);
	});

	it("录制期间不发起任何外呼（全局 fetch 未被调用）", async () => {
		const dir = await makeTempDir();
		const recorder = await startPromptRecorder({ dir });
		onTestFinished(() => recorder.close());

		const outbound = vi.fn(() => {
			throw new Error("录制服务不允许外呼");
		});
		vi.stubGlobal("fetch", outbound);
		const response = await sendHttp(
			`${recorder.url}/v1/chat/completions`,
			"POST",
			chatBody(false),
		);
		vi.unstubAllGlobals();
		expect(response.status).toBe(200);
		expect(outbound).not.toHaveBeenCalled();

		const models = await sendHttp(`${recorder.url}/v1/models`, "GET");
		expect(models.status).toBe(200);
		expect(JSON.parse(models.text)).toEqual({
			object: "list",
			data: [
				{
					id: "dramaticer-record-only",
					object: "model",
					created: 0,
					owned_by: "dramaticer-st-bench",
				},
			],
		});
		await recorder.close();
		expect(await readPromptRecordIndex(dir)).toHaveLength(1);
	});

	it("请求体超限时返回 413，索引只记数量不缓存正文", async () => {
		const dir = await makeTempDir();
		const recorder = await startPromptRecorder({ dir, maxBodyBytes: 16 });
		onTestFinished(() => recorder.close());
		const response = await sendHttp(
			`${recorder.url}/v1/chat/completions`,
			"POST",
			chatBody(false),
		);
		expect(response.status).toBe(413);
		await recorder.close();
		const index = await readPromptRecordIndex(dir);
		expect(index).toHaveLength(1);
		expect(index[0]?.file).toBeNull();
		expect(index[0]?.bodyBytes).toBeGreaterThan(16);
	});
});

async function createFakeSource(root: string): Promise<void> {
	const files: Record<string, string> = {
		"server.js": "// fake st server\n",
		"package.json": JSON.stringify({ name: "sillytavern", version: "1.18.0" }),
		"src/index.js": "export const value = 1;\n",
		"public/app.js": "// frontend\n",
		"public/scripts/extensions/third-party/ext.js": "// player extension\n",
		"node_modules/dep/index.js": "export const dep = 1;\n",
		"data/default-user/OpenAI Settings/preset.json": "{}\n",
		"data/default-user/characters/card.png": "png\n",
		"data/default-user/secrets.json": '{"api_key":"secret"}\n',
		"data/default-user/settings.json": '{"api_key":"secret"}\n',
		"backups/old.zip": "zip\n",
		"plugins/evil.js": "// server plugin\n",
	};
	for (const [relative, content] of Object.entries(files)) {
		const file = path.join(root, relative);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, content);
	}
}

describe("ST 沙箱副本", () => {
	it("只复制程序与指定数据子集，跳过密钥、扩展与缓存", async () => {
		const root = await makeTempDir();
		const source = path.join(root, "source");
		const privateRoot = path.join(root, "private");
		const target = path.join(privateRoot, "st-sandbox", "st");
		await createFakeSource(source);
		const before = await stat(path.join(source, "server.js"));

		const manifest = await copySillyTavernSandbox({
			sourceDir: source,
			privateRoot,
			targetDir: target,
			dataEntries: [
				"data/default-user/OpenAI Settings",
				"data/default-user/characters",
			],
		});

		expect(manifest.stName).toBe("sillytavern");
		expect(manifest.stVersion).toBe("1.18.0");
		expect(manifest.copied).toContain("server.js");
		expect(manifest.copied).toContain("data/default-user/characters");
		expect(manifest.skipped).toContain("config.yaml");
		await expect(
			readFile(path.join(target, "public/app.js"), "utf8"),
		).resolves.toBe("// frontend\n");
		await expect(
			readFile(
				path.join(target, "data/default-user/OpenAI Settings/preset.json"),
				"utf8",
			),
		).resolves.toBe("{}\n");
		await expect(
			readFile(path.join(target, "node_modules/dep/index.js"), "utf8"),
		).resolves.toBe("export const dep = 1;\n");
		for (const denied of [
			"public/scripts/extensions/third-party/ext.js",
			"data/default-user/secrets.json",
			"data/default-user/settings.json",
			"backups/old.zip",
			"plugins/evil.js",
		]) {
			await expect(stat(path.join(target, denied))).rejects.toThrow();
		}
		const after = await stat(path.join(source, "server.js"));
		expect(after.mtimeMs).toBe(before.mtimeMs);
		const sandboxManifest = JSON.parse(
			await readFile(path.join(target, "sandbox.json"), "utf8"),
		) as { format: string; license: string };
		expect(sandboxManifest.format).toBe("dramaticer.st-sandbox");
		expect(sandboxManifest.license).toBe("AGPL-3.0");
	});

	it("拒绝私有根目录以外的目标与互相包含的目录", async () => {
		const root = await makeTempDir();
		const source = path.join(root, "source");
		const privateRoot = path.join(root, "private");
		await createFakeSource(source);

		expect(() =>
			assertSandboxTarget(source, privateRoot, path.join(root, "public", "st")),
		).toThrow(/私有根目录/);
		expect(() =>
			assertSandboxTarget(
				path.join(privateRoot, "source"),
				privateRoot,
				path.join(privateRoot, "source", "nested"),
			),
		).toThrow(/互相包含/);

		const target = path.join(privateRoot, "st-sandbox", "st");
		await mkdir(target, { recursive: true });
		await expect(
			copySillyTavernSandbox({
				sourceDir: source,
				privateRoot,
				targetDir: target,
				nodeModules: "skip",
			}),
		).rejects.toThrow(/已存在/);
	});

	it("拒绝绝对路径与带 .. 的数据条目", async () => {
		const root = await makeTempDir();
		const source = path.join(root, "source");
		await createFakeSource(source);
		await expect(
			copySillyTavernSandbox({
				sourceDir: source,
				privateRoot: path.join(root, "private"),
				targetDir: path.join(root, "private", "st"),
				dataEntries: ["../outside"],
				nodeModules: "skip",
			}),
		).rejects.toThrow(/\.\./);
	});

	it("deny 规则覆盖密钥、扩展与备份目录", async () => {
		const source = path.join(TEST_DIR, "source");
		expect(
			isDeniedSourcePath(
				source,
				path.join(source, "data/default-user/secrets.json"),
			),
		).toBe(true);
		expect(
			isDeniedSourcePath(
				source,
				path.join(source, "public/scripts/extensions/third-party/ext.js"),
			),
		).toBe(true);
		expect(isDeniedSourcePath(source, path.join(source, "backups/a.zip"))).toBe(
			true,
		);
		expect(isDeniedSourcePath(source, path.join(source, "public/app.js"))).toBe(
			false,
		);
	});
});

describe("st-bench 命令行", () => {
	it("sandbox 子命令在仓库私有根目录下建立副本", async () => {
		const root = await makeTempDir();
		const source = path.join(root, "source");
		const repoRoot = path.join(root, "repo");
		await createFakeSource(source);
		const messages: string[] = [];
		await runStBenchCli(
			[
				"sandbox",
				"--source",
				source,
				"--node-modules",
				"skip",
				"--data",
				"data/default-user/OpenAI Settings",
			],
			{ repoRoot, log: (message) => messages.push(message) },
		);
		const target = path.join(stBenchPaths(repoRoot).sandboxDir, "st");
		await expect(
			readFile(path.join(target, "server.js"), "utf8"),
		).resolves.toBe("// fake st server\n");
		expect(messages.join("\n")).toContain("沙箱副本");
	});

	it("record 子命令拒绝非法端口", async () => {
		const root = await makeTempDir();
		await expect(
			runStBenchCli(["record", "--port", "70000"], {
				repoRoot: root,
				log: () => {},
			}),
		).rejects.toThrow(/--port/);
	});
});
