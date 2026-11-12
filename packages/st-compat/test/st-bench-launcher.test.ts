import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { parse } from "yaml";
import { runStBenchCli } from "../src/st-bench/cli.js";
import {
	configureSandboxServer,
	startSandboxServer,
} from "../src/st-bench/launcher.js";
import { stBenchPaths } from "../src/st-bench/sandbox.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(path.join(TEST_DIR, ".tmp-st-launcher-"));
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

interface FakeSandbox {
	readonly privateRoot: string;
	readonly sandboxDir: string;
}

/** 造一个带清单的沙箱副本；config.yaml 里故意留一条原安装的访问口令。 */
async function createFakeSandbox(
	root: string,
	options: {
		readonly serverScript?: string;
		readonly config?: string;
		readonly privateRoot?: string;
	} = {},
): Promise<FakeSandbox> {
	const privateRoot = options.privateRoot ?? path.join(root, "private");
	const sandboxDir = path.join(privateRoot, "st-sandbox", "st");
	await mkdir(path.join(sandboxDir, "data", "default-user"), {
		recursive: true,
	});
	await writeFile(
		path.join(sandboxDir, "sandbox.json"),
		JSON.stringify({
			format: "dramaticer.st-sandbox",
			formatVersion: 1,
			sourceDir: path.join(root, "source"),
			targetDir: sandboxDir,
			createdAt: new Date().toISOString(),
			stName: "sillytavern",
			stVersion: "1.18.0",
			license: "AGPL-3.0",
			nodeModules: "link",
			copied: ["server.js"],
			skipped: [],
		}),
	);
	await writeFile(
		path.join(sandboxDir, "config.yaml"),
		options.config ??
			[
				"dataRoot: ./data",
				"port: 8000",
				"listen: false",
				"sessionTimeout: -1",
				"basicAuthUser:",
				"  username: theater",
				"  password: theater0711",
				"extensions:",
				"  autoUpdate: true",
				"",
			].join("\n"),
	);
	await writeFile(
		path.join(sandboxDir, "server.js"),
		options.serverScript ?? "// fake st server\n",
	);
	return { privateRoot, sandboxDir };
}

async function getFreePort(): Promise<number> {
	const { promise, resolve, reject } = Promise.withResolvers<number>();
	const server = net.createServer();
	server.once("error", reject);
	server.listen(0, "127.0.0.1", () => {
		const address = server.address();
		server.close(() => {
			if (address === null || typeof address === "string") {
				reject(new Error("没有分配到端口"));
				return;
			}
			resolve(address.port);
		});
	});
	return promise;
}

describe("沙箱 ST 配置", () => {
	it("把监听、数据根与扩展更新固定到沙箱内部，并清掉访问口令", async () => {
		const root = await makeTempDir();
		const { privateRoot, sandboxDir } = await createFakeSandbox(root);

		const setup = await configureSandboxServer({
			sandboxDir,
			privateRoot,
			port: 8123,
			endpointUrl: "http://127.0.0.1:8130/v1",
		});

		expect(setup.url).toBe("http://127.0.0.1:8123");
		const config = parse(
			await readFile(path.join(sandboxDir, "config.yaml"), "utf8"),
		) as Record<string, unknown>;
		expect(config.dataRoot).toBe("./data");
		expect(config.port).toBe(8123);
		expect(config.listen).toBe(false);
		expect(config.protocol).toEqual({ ipv4: true, ipv6: false });
		expect(config.whitelistMode).toBe(true);
		expect(config.whitelist).toEqual(["127.0.0.1", "::1"]);
		expect(config.basicAuthMode).toBe(false);
		expect(config.basicAuthUser).toEqual({ username: "", password: "" });
		expect(config.extensions).toEqual({ enabled: false, autoUpdate: false });
		expect(config.sessionTimeout).toBe(-1);
		const configText = await readFile(setup.configFile, "utf8");
		expect(configText).not.toContain("theater0711");
	});

	it("写入指向录制服务的桩设置，不写任何密钥", async () => {
		const root = await makeTempDir();
		const { privateRoot, sandboxDir } = await createFakeSandbox(root);

		const setup = await configureSandboxServer({
			sandboxDir,
			privateRoot,
			endpointUrl: "http://127.0.0.1:8130/v1/",
			stubModel: "stub-model",
			maxContext: 4096,
			maxTokens: 256,
		});

		const settings = JSON.parse(
			await readFile(setup.settingsFile, "utf8"),
		) as Record<string, unknown>;
		expect(settings.main_api).toBe("openai");
		expect(settings.amount_gen).toBe(256);
		expect(settings.max_context).toBe(4096);
		expect(settings.oai_settings).toMatchObject({
			chat_completion_source: "custom",
			custom_url: "http://127.0.0.1:8130/v1",
			custom_model: "stub-model",
			openai_max_context: 4096,
			openai_max_tokens: 256,
		});
		const serialized = JSON.stringify(settings);
		expect(serialized).not.toContain("api_key");
		expect(serialized).not.toContain("password");
	});

	it("拒绝私有根目录之外的副本与缺少清单的目录", async () => {
		const root = await makeTempDir();
		const sandboxDir = path.join(root, "outside");
		await mkdir(sandboxDir, { recursive: true });
		await expect(
			configureSandboxServer({
				sandboxDir,
				privateRoot: path.join(root, "private"),
				endpointUrl: "http://127.0.0.1:8130/v1",
			}),
		).rejects.toThrow(/私有根目录/);

		const { privateRoot, sandboxDir: inside } = await createFakeSandbox(root);
		await rm(path.join(inside, "sandbox.json"));
		await expect(
			configureSandboxServer({
				sandboxDir: inside,
				privateRoot,
				endpointUrl: "http://127.0.0.1:8130/v1",
			}),
		).rejects.toThrow(/sandbox\.json/);
	});

	it("拒绝非本机端点、非法端口与越界预算", async () => {
		const root = await makeTempDir();
		const { privateRoot, sandboxDir } = await createFakeSandbox(root);
		const base = { sandboxDir, privateRoot };
		await expect(
			configureSandboxServer({
				...base,
				endpointUrl: "https://example.invalid/v1",
			}),
		).rejects.toThrow(/只允许本机地址/);
		await expect(
			configureSandboxServer({
				...base,
				port: 70_000,
				endpointUrl: "http://127.0.0.1:8130/v1",
			}),
		).rejects.toThrow(/端口必须是 1 到 65535/);
		await expect(
			configureSandboxServer({
				...base,
				maxContext: 128,
				maxTokens: 256,
				endpointUrl: "http://127.0.0.1:8130/v1",
			}),
		).rejects.toThrow(/maxTokens/);
	});
});

describe("沙箱 ST 启动", () => {
	it("等前台可访问后返回，停止后子进程退出", async () => {
		const root = await makeTempDir();
		const port = await getFreePort();
		const { privateRoot, sandboxDir } = await createFakeSandbox(root, {
			serverScript: [
				'import http from "node:http";',
				'const index = process.argv.indexOf("--port");',
				"const port = Number(process.argv[index + 1]);",
				'http.createServer((request, response) => { response.writeHead(200); response.end("ready"); }).listen(port, "127.0.0.1");',
				"",
			].join("\n"),
		});

		const server = await startSandboxServer({
			sandboxDir,
			privateRoot,
			port,
			endpointUrl: "http://127.0.0.1:8130/v1",
			readinessTimeoutMs: 15_000,
		});
		const response = await fetch(`${server.url}/`);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ready");
		expect(await readFile(server.logFile, "utf8")).toBe("");

		await server.stop();
		expect(
			server.process.exitCode !== null || server.process.signalCode !== null,
		).toBe(true);
	});

	it("进程提前退出时报告退出码", async () => {
		const root = await makeTempDir();
		const { privateRoot, sandboxDir } = await createFakeSandbox(root, {
			serverScript: "process.exit(3);\n",
		});
		await expect(
			startSandboxServer({
				sandboxDir,
				privateRoot,
				port: 8124,
				endpointUrl: "http://127.0.0.1:8130/v1",
				readinessTimeoutMs: 15_000,
			}),
		).rejects.toThrow(/退出码 3/);
	});
});

describe("st-bench serve", () => {
	it("--configure-only 只写配置与桩设置", async () => {
		const root = await makeTempDir();
		const repoRoot = path.join(root, "repo");
		const { sandboxDir } = await createFakeSandbox(root, {
			privateRoot: stBenchPaths(repoRoot).privateRoot,
		});
		const messages: string[] = [];
		await runStBenchCli(
			[
				"serve",
				"--sandbox",
				sandboxDir,
				"--port",
				"8125",
				"--endpoint",
				"http://127.0.0.1:8130/v1",
				"--stub-model",
				"serve-stub",
				"--configure-only",
			],
			{
				repoRoot,
				log: (message) => messages.push(message),
			},
		);
		expect(messages.join("\n")).toContain("沙箱 ST 未启动");
		const settings = JSON.parse(
			await readFile(
				path.join(sandboxDir, "data/default-user/settings.json"),
				"utf8",
			),
		) as { oai_settings: { custom_model: string } };
		expect(settings.oai_settings.custom_model).toBe("serve-stub");
	});
});
