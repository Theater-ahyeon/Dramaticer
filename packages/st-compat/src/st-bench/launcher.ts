import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject } from "@dramaticer/core";
import { parseDocument, stringify } from "yaml";
import { isPathInside } from "./sandbox.js";

export const SANDBOX_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SANDBOX_SERVER_PORT = 8000;
export const DEFAULT_STUB_MODEL = "dramaticer-st-bench";
/** 沙箱 ST 首次启动要用 webpack 编译前端，留足等待时间。 */
export const DEFAULT_READINESS_TIMEOUT_MS = 180_000;

const SANDBOX_MANIFEST_FORMAT = "dramaticer.st-sandbox";
const DEFAULT_MAX_CONTEXT = 8192;
const DEFAULT_MAX_TOKENS = 512;

export interface SandboxServerOptions {
	readonly sandboxDir: string;
	/** 私有根目录；沙箱副本必须落在它内部，防止改动源安装目录。 */
	readonly privateRoot: string;
	readonly port?: number;
	/** 录制服务的 OpenAI 兼容根地址，例如 http://127.0.0.1:8130/v1。 */
	readonly endpointUrl: string;
	readonly stubModel?: string;
	readonly maxContext?: number;
	readonly maxTokens?: number;
}

export interface SandboxServerSetup {
	readonly sandboxDir: string;
	readonly privateRoot: string;
	readonly port: number;
	readonly host: string;
	readonly url: string;
	readonly configFile: string;
	readonly settingsFile: string;
	readonly dataRoot: string;
	readonly endpointUrl: string;
	readonly stubModel: string;
	readonly maxContext: number;
	readonly maxTokens: number;
}

export interface StartSandboxServerOptions extends SandboxServerOptions {
	readonly readinessTimeoutMs?: number;
	readonly log?: (line: string) => void;
}

export interface SandboxServerHandle {
	readonly setup: SandboxServerSetup;
	readonly url: string;
	readonly process: ChildProcess;
	readonly logFile: string;
	/** 子进程退出后完成；进程启动失败时拒绝。 */
	readonly closed: Promise<number | null>;
	stop(): Promise<void>;
}

/**
 * 把沙箱副本的 ST 配置固定在本机回环地址，并写入指向录制服务的桩设置。
 * 只接受私有根目录内带 sandbox.json 清单的副本，源安装目录不会被改动。
 */
export async function configureSandboxServer(
	options: SandboxServerOptions,
): Promise<SandboxServerSetup> {
	const sandboxDir = path.resolve(options.sandboxDir);
	const privateRoot = path.resolve(options.privateRoot);
	await assertSandboxCopy(sandboxDir, privateRoot);
	const port = options.port ?? DEFAULT_SANDBOX_SERVER_PORT;
	assertPort(port);
	const endpointUrl = assertRecorderEndpoint(options.endpointUrl);
	const stubModel = options.stubModel ?? DEFAULT_STUB_MODEL;
	if (stubModel.trim() === "") throw new Error("桩模型名不能为空");
	const maxContext = options.maxContext ?? DEFAULT_MAX_CONTEXT;
	const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
	assertPositiveInteger(maxContext, "maxContext");
	assertPositiveInteger(maxTokens, "maxTokens");
	if (maxTokens > maxContext) {
		throw new Error(`maxTokens ${maxTokens} 不能大于 maxContext ${maxContext}`);
	}

	const configFile = path.join(sandboxDir, "config.yaml");
	const rawConfig = await readFile(configFile, "utf8");
	const document = parseDocument(rawConfig);
	if (document.errors.length > 0) {
		throw new Error(
			`无法解析沙箱配置 ${configFile}：${document.errors[0]?.message ?? "未知错误"}`,
		);
	}
	document.setIn(["dataRoot"], "./data");
	document.setIn(["port"], port);
	// listen 为 false 时 ST 只绑定 127.0.0.1 与 [::1]，不再暴露到局域网。
	document.setIn(["listen"], false);
	document.setIn(["protocol", "ipv4"], true);
	document.setIn(["protocol", "ipv6"], false);
	document.setIn(["whitelistMode"], true);
	document.setIn(["whitelist"], [SANDBOX_SERVER_HOST, "::1"]);
	document.setIn(["basicAuthMode"], false);
	// 副本里可能带着玩家的访问口令，沙箱不保留任何凭证。
	document.setIn(["basicAuthUser"], { username: "", password: "" });
	document.setIn(["enableUserAccounts"], false);
	document.setIn(["browserLaunch", "enabled"], false);
	document.setIn(["extensions", "enabled"], false);
	document.setIn(["extensions", "autoUpdate"], false);
	document.setIn(["thumbnails", "enabled"], false);
	document.setIn(["enableCorsProxy"], false);
	document.setIn(["requestProxy", "enabled"], false);
	document.setIn(["ssl", "enabled"], false);
	document.setIn(["hostWhitelist", "enabled"], false);
	document.setIn(["backups", "chat", "enabled"], false);
	document.setIn(["logging", "enableAccessLog"], false);
	await writeFile(configFile, ensureTrailingNewline(stringify(document)));

	const dataRoot = path.join(sandboxDir, "data", "default-user");
	const settingsFile = path.join(dataRoot, "settings.json");
	await mkdir(dataRoot, { recursive: true });
	await writeFile(
		settingsFile,
		`${JSON.stringify(
			buildSandboxSettings({ endpointUrl, stubModel, maxContext, maxTokens }),
			null,
			"\t",
		)}\n`,
	);

	return {
		sandboxDir,
		privateRoot,
		port,
		host: SANDBOX_SERVER_HOST,
		url: `http://${SANDBOX_SERVER_HOST}:${port}`,
		configFile,
		settingsFile,
		dataRoot,
		endpointUrl,
		stubModel,
		maxContext,
		maxTokens,
	};
}

/** 启动沙箱 ST，等到首页可访问再返回；超时或提前退出时终止子进程并抛错。 */
export async function startSandboxServer(
	options: StartSandboxServerOptions,
): Promise<SandboxServerHandle> {
	const setup = await configureSandboxServer(options);
	const logFile = path.join(setup.sandboxDir, "st-bench-server.log");
	const logStream = createWriteStream(logFile, { flags: "w" });
	const child = spawn(
		process.execPath,
		["server.js", "--port", String(setup.port)],
		{
			cwd: setup.sandboxDir,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		},
	);
	const {
		promise: closed,
		resolve: resolveClosed,
		reject: rejectClosed,
	} = Promise.withResolvers<number | null>();
	child.once("error", rejectClosed);
	child.once("exit", (code) => resolveClosed(code));

	let logClosed = false;
	function forwardLog(chunk: string): void {
		if (logClosed) return;
		logStream.write(chunk);
		for (const line of chunk.split(/\r?\n/)) {
			if (line.trim() !== "") options.log?.(line);
		}
	}

	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (chunk: string) => forwardLog(chunk));
	child.stdout?.setEncoding("utf8");
	child.stdout?.on("data", (chunk: string) => forwardLog(chunk));

	let stopping: Promise<void> | null = null;
	const stop = (): Promise<void> => {
		stopping ??= (async () => {
			if (child.exitCode === null && !child.killed) child.kill();
			await closed.catch(() => null);
			logClosed = true;
			logStream.end();
		})();
		return stopping;
	};

	const readinessTimeoutMs =
		options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
	const deadline = Date.now() + readinessTimeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			logClosed = true;
			logStream.end();
			throw new Error(
				`沙箱 ST 在就绪前退出（退出码 ${child.exitCode}）；日志：${logFile}`,
			);
		}
		try {
			const response = await fetch(`${setup.url}/`, {
				signal: AbortSignal.timeout(2_000),
			});
			if (response.ok) {
				return {
					setup,
					url: setup.url,
					process: child,
					logFile,
					closed,
					stop,
				};
			}
		} catch {
			// 端口还没监听时连接会被拒绝，继续等到超时。
		}
		await sleep(500);
	}
	await stop();
	throw new Error(
		`沙箱 ST 在 ${readinessTimeoutMs} 毫秒内没有就绪；日志：${logFile}`,
	);
}

function buildSandboxSettings(input: {
	readonly endpointUrl: string;
	readonly stubModel: string;
	readonly maxContext: number;
	readonly maxTokens: number;
}): Record<string, unknown> {
	return {
		firstRun: false,
		main_api: "openai",
		username: "Bench",
		amount_gen: input.maxTokens,
		max_context: input.maxContext,
		oai_settings: {
			chat_completion_source: "custom",
			custom_url: input.endpointUrl,
			custom_model: input.stubModel,
			openai_max_context: input.maxContext,
			openai_max_tokens: input.maxTokens,
			stream_openai: true,
			function_calling: false,
			request_images: false,
			enable_web_search: false,
			squash_system_messages: false,
		},
		power_user: {},
		extension_settings: {},
	};
}

async function assertSandboxCopy(
	sandboxDir: string,
	privateRoot: string,
): Promise<void> {
	if (sandboxDir === privateRoot) {
		throw new Error("沙箱目录不能就是私有根目录本身");
	}
	if (!isPathInside(sandboxDir, privateRoot)) {
		throw new Error(
			`沙箱目录必须在私有根目录 ${privateRoot} 内部，收到 ${sandboxDir}`,
		);
	}
	const manifestFile = path.join(sandboxDir, "sandbox.json");
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(manifestFile, "utf8"));
	} catch {
		throw new Error(`沙箱目录缺少可读的 sandbox.json：${manifestFile}`);
	}
	if (!isJsonObject(parsed) || parsed.format !== SANDBOX_MANIFEST_FORMAT) {
		throw new Error(`${manifestFile} 不是 ${SANDBOX_MANIFEST_FORMAT} 清单`);
	}
}

function assertRecorderEndpoint(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`录制服务地址不是合法 URL：${value}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`录制服务地址必须是 http 或 https：${value}`);
	}
	const loopback: Record<string, true> = {
		"127.0.0.1": true,
		localhost: true,
		"::1": true,
		"[::1]": true,
	};
	if (loopback[url.hostname] !== true) {
		throw new Error(
			`录制服务只允许本机地址，收到 ${url.hostname}；沙箱不配置真实模型端点`,
		);
	}
	if (url.username !== "" || url.password !== "") {
		throw new Error("录制服务地址不能包含账号或密码");
	}
	return url.toString().replace(/\/$/, "");
}

function assertPort(port: number): void {
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`端口必须是 1 到 65535 的整数，收到 ${port}`);
	}
}

function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${name} 必须是正整数，收到 ${value}`);
	}
}

function ensureTrailingNewline(text: string): string {
	return text.endsWith("\n") ? text : `${text}\n`;
}

async function sleep(milliseconds: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, milliseconds);
	await promise;
}
