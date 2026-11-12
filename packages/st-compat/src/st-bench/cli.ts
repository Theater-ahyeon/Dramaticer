import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_SANDBOX_SERVER_PORT,
	DEFAULT_STUB_MODEL,
	configureSandboxServer,
	startSandboxServer,
} from "./launcher.js";
import { startPromptRecorder } from "./recorder.js";
import {
	DEFAULT_DATA_ENTRIES,
	type NodeModulesMode,
	type StBenchPaths,
	copySillyTavernSandbox,
	stBenchPaths,
} from "./sandbox.js";

const USAGE = `用法：st-bench <sandbox|record|serve> ...
  sandbox --source <SillyTavern 目录> [--target <目录>] [--private-root <目录>]
          [--node-modules link|copy|skip] [--data <相对路径>]... [--replace]
  record [--dir <录制目录>] [--host 127.0.0.1] [--port 8130]
         [--stub-model <名称>] [--max-requests <数量>]
  serve [--sandbox <目录>] [--port 8000]
        [--endpoint http://127.0.0.1:8130/v1] [--stub-model <名称>]
        [--configure-only]`;

export interface StBenchCliOptions {
	readonly repoRoot?: string;
	readonly log?: (message: string) => void;
}

/** st-bench 的所有产物都留在私有根目录；这里只打印路径与统计数字。 */
export async function runStBenchCli(
	args: readonly string[],
	options: StBenchCliOptions = {},
): Promise<void> {
	const log = options.log ?? ((message: string) => console.log(message));
	const command = args[0];
	if (command === undefined || command === "--help" || command === "-h") {
		log(USAGE);
		return;
	}
	const repoRoot = options.repoRoot ?? (await findRepoRoot());
	const paths = stBenchPaths(repoRoot);
	if (command === "sandbox") {
		await runSandbox(args.slice(1), paths, log);
		return;
	}
	if (command === "record") {
		await runRecord(args.slice(1), paths.recordingsDir, log);
		return;
	}
	if (command === "serve") {
		await runServe(args.slice(1), paths, log);
		return;
	}
	throw new Error(USAGE);
}

async function runSandbox(
	args: readonly string[],
	paths: StBenchPaths,
	log: (message: string) => void,
): Promise<void> {
	let source: string | null = null;
	let target = path.join(paths.sandboxDir, "st");
	let nodeModules: NodeModulesMode = "link";
	let replace = false;
	const dataEntries: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--replace") {
			replace = true;
			continue;
		}
		if (
			arg === "--source" ||
			arg === "--target" ||
			arg === "--node-modules" ||
			arg === "--data"
		) {
			const value = args[index + 1];
			if (value === undefined) throw new Error(`${arg} 需要一个值`);
			index += 1;
			if (arg === "--source") source = value;
			else if (arg === "--target") target = value;
			else if (arg === "--data") dataEntries.push(value);
			else nodeModules = parseNodeModulesMode(value);
			continue;
		}
		throw new Error(`未知参数：${arg}`);
	}
	if (source === null) {
		throw new Error("sandbox 需要 --source（源 SillyTavern 目录）");
	}
	const manifest = await copySillyTavernSandbox({
		sourceDir: source,
		privateRoot: paths.privateRoot,
		targetDir: target,
		dataEntries: dataEntries.length > 0 ? dataEntries : DEFAULT_DATA_ENTRIES,
		nodeModules,
		replace,
	});
	log(`沙箱副本：${manifest.targetDir}`);
	log(
		`来源：${manifest.stName ?? "未知"} ${manifest.stVersion ?? ""}（${manifest.license}）`.trim(),
	);
	log(
		`复制 ${manifest.copied.length} 项，源目录缺少 ${manifest.skipped.length} 项，node_modules 模式 ${manifest.nodeModules}`,
	);
	if (manifest.skipped.length > 0) {
		log(`缺失条目：${manifest.skipped.join("、")}`);
	}
}

async function runRecord(
	args: readonly string[],
	defaultDir: string,
	log: (message: string) => void,
): Promise<void> {
	let dir = defaultDir;
	let host = "127.0.0.1";
	let port = 8130;
	let stubModel = "dramaticer-record-only";
	let maxRequests: number | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (
			arg === "--dir" ||
			arg === "--host" ||
			arg === "--port" ||
			arg === "--stub-model" ||
			arg === "--max-requests"
		) {
			const value = args[index + 1];
			if (value === undefined) throw new Error(`${arg} 需要一个值`);
			index += 1;
			if (arg === "--dir") dir = value;
			else if (arg === "--host") host = value;
			else if (arg === "--stub-model") stubModel = value;
			else if (arg === "--port") port = parsePort(value);
			else maxRequests = parsePositiveInteger(value, "--max-requests");
			continue;
		}
		throw new Error(`未知参数：${arg}`);
	}

	const recorder = await startPromptRecorder({
		dir,
		host,
		port,
		stubModel,
		maxRequests,
	});
	log(`录制服务：${recorder.url}`);
	log(`录制目录：${recorder.dir}`);
	log(`把 ST 的自定义端点设为 ${recorder.url}/v1，模型名不限`);
	log("服务只记录请求并返回固定桩响应，不调用任何模型");

	const stop = Promise.withResolvers<void>();
	const onSignal = (): void => {
		stop.resolve();
	};
	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);
	try {
		await Promise.race([recorder.closed, stop.promise]);
	} finally {
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
	}
	await recorder.close();
	log(`已录制 ${recorder.records.length} 条请求`);
}

async function runServe(
	args: readonly string[],
	paths: StBenchPaths,
	log: (message: string) => void,
): Promise<void> {
	let sandboxDir = path.join(paths.sandboxDir, "st");
	let port = DEFAULT_SANDBOX_SERVER_PORT;
	let endpointUrl = "http://127.0.0.1:8130/v1";
	let stubModel = DEFAULT_STUB_MODEL;
	let configureOnly = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--configure-only") {
			configureOnly = true;
			continue;
		}
		if (
			arg === "--sandbox" ||
			arg === "--port" ||
			arg === "--endpoint" ||
			arg === "--stub-model"
		) {
			const value = args[index + 1];
			if (value === undefined) throw new Error(`${arg} 需要一个值`);
			index += 1;
			if (arg === "--sandbox") sandboxDir = value;
			else if (arg === "--port") port = parsePort(value);
			else if (arg === "--endpoint") endpointUrl = value;
			else stubModel = value;
			continue;
		}
		throw new Error(`未知参数：${arg}`);
	}

	const options = {
		sandboxDir,
		privateRoot: paths.privateRoot,
		port,
		endpointUrl,
		stubModel,
		log,
	};
	if (configureOnly) {
		const setup = await configureSandboxServer(options);
		log(`沙箱配置：${setup.configFile}`);
		log(`桩设置：${setup.settingsFile}`);
		log(`自定义端点 ${setup.endpointUrl}，模型 ${setup.stubModel}`);
		log("只写配置，沙箱 ST 未启动");
		return;
	}

	const server = await startSandboxServer(options);
	log(`沙箱 ST 已就绪：${server.url}`);
	log(`日志：${server.logFile}`);
	log("按 Ctrl+C 停止沙箱 ST");

	const stop = Promise.withResolvers<void>();
	const onSignal = (): void => {
		stop.resolve();
	};
	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);
	try {
		await stop.promise;
	} finally {
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
	}
	await server.stop();
	log("沙箱 ST 已停止");
}

function parseNodeModulesMode(value: string): NodeModulesMode {
	if (value === "link" || value === "copy" || value === "skip") return value;
	throw new Error(`--node-modules 只接受 link、copy、skip，收到 ${value}`);
}

function parsePort(value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
		throw new Error(`--port 必须是 0 到 65535 的整数，收到 ${value}`);
	}
	return parsed;
}

function parsePositiveInteger(value: string, label: string): number {
	if (!/^\d+$/.test(value) || Number(value) < 1) {
		throw new Error(`${label} 必须是正整数，收到 ${value}`);
	}
	return Number(value);
}

async function findRepoRoot(): Promise<string> {
	let current = path.dirname(fileURLToPath(import.meta.url));
	for (;;) {
		if (
			await stat(path.join(current, "pnpm-workspace.yaml")).then(
				() => true,
				() => false,
			)
		) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			throw new Error("找不到仓库根目录（pnpm-workspace.yaml）");
		}
		current = parent;
	}
}

const entry = process.argv[1];
const invokedDirectly =
	entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	try {
		await runStBenchCli(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
