import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
	resolveModelForRole,
} from "@dramaticer/core";
import {
	COEXIST_DEFAULT_BUDGET_TOKENS,
	type CoexistRunConfig,
	ST_BENCH_COEXIST_PLUGINS,
	loadCoexistCards,
	loadCoexistConfig,
	runCoexistComparisons,
	writeCoexistOutputs,
} from "./coexist.js";
import { compareSandboxBatch } from "./compare.js";
import {
	DEFAULT_COMBINATION_TIMEOUT_MS,
	DEFAULT_DRIVE_RECORDER_PORT,
	driveSandboxBatch,
} from "./driver.js";
import {
	DEFAULT_SANDBOX_SERVER_PORT,
	DEFAULT_STUB_MODEL,
	configureSandboxServer,
	startSandboxServer,
} from "./launcher.js";
import {
	RUN_MANIFEST_FILE,
	assertBatchName,
	discoverSandboxInputs,
	planSandboxCombinations,
	writeSandboxPlan,
} from "./plan.js";
import { startPromptRecorder } from "./recorder.js";
import {
	DEFAULT_DATA_ENTRIES,
	type NodeModulesMode,
	type StBenchPaths,
	copySillyTavernSandbox,
	isPathInside,
	stBenchPaths,
} from "./sandbox.js";

const USAGE = `用法：st-bench <sandbox|record|serve|plan|drive|compare|coexist> ...
  sandbox --source <SillyTavern 目录> [--target <目录>] [--private-root <目录>]
          [--node-modules link|copy|skip] [--data <相对路径>]... [--replace]
  record [--dir <录制目录>] [--host 127.0.0.1] [--port 8130]
         [--stub-model <名称>] [--max-requests <数量>]
  serve [--sandbox <目录>] [--port 8000]
        [--endpoint http://127.0.0.1:8130/v1] [--stub-model <名称>]
        [--configure-only]
  plan [--sandbox <目录>] [--batch <名称>] [--limit <数量>]
  drive [--sandbox <目录>] [--batch <名称>] [--limit <数量>]
        [--port 8000] [--recorder-port 8130] [--stub-model <名称>]
        [--combination-timeout <秒>] [--headed]
  compare [--sandbox <目录>] [--batch <名称>] [--limit <数量>]
  coexist --config <配置.json> [--out <目录>]`;

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
	if (command === "plan") {
		await runPlan(args.slice(1), paths, log);
		return;
	}
	if (command === "drive") {
		await runDrive(args.slice(1), paths, log);
		return;
	}
	if (command === "compare") {
		await runCompare(args.slice(1), paths, log);
		return;
	}
	if (command === "coexist") {
		await runCoexist(args.slice(1), paths, repoRoot, log);
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

async function runPlan(
	args: readonly string[],
	paths: StBenchPaths,
	log: (message: string) => void,
): Promise<void> {
	let sandboxDir = path.join(paths.sandboxDir, "st");
	let batch = "default";
	let limit: number | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--sandbox" || arg === "--batch" || arg === "--limit") {
			const value = args[index + 1];
			if (value === undefined) throw new Error(`${arg} 需要一个值`);
			index += 1;
			if (arg === "--sandbox") sandboxDir = value;
			else if (arg === "--batch") batch = assertBatchName(value);
			else limit = parsePositiveInteger(value, "--limit");
			continue;
		}
		throw new Error(`未知参数：${arg}`);
	}
	const resolvedSandbox = path.resolve(sandboxDir);
	if (!isPathInside(resolvedSandbox, paths.privateRoot)) {
		throw new Error(
			`沙箱目录必须在私有根目录 ${paths.privateRoot} 内部，收到 ${resolvedSandbox}`,
		);
	}
	const dataRoot = path.join(resolvedSandbox, "data", "default-user");
	const inputs = await discoverSandboxInputs({ dataRoot });
	const combinations = planSandboxCombinations(inputs, { limit });
	const batchDir = path.join(paths.sandboxDir, "runs", batch);
	const result = await writeSandboxPlan({
		batchDir,
		privateRoot: paths.privateRoot,
		combinations,
	});
	log(
		`预设 ${inputs.presets.length} 个，角色卡 ${inputs.characters.length} 个，聊天片段 ${inputs.chats.length} 个`,
	);
	log(
		`组合 ${result.total} 个：新建 ${result.created}，已完成 ${result.completed}，待跑 ${result.pending}，重试 ${result.retried}`,
	);
	log(`清单：${path.join(batchDir, RUN_MANIFEST_FILE)}`);
}

async function runDrive(
	args: readonly string[],
	paths: StBenchPaths,
	log: (message: string) => void,
): Promise<void> {
	let sandboxDir = path.join(paths.sandboxDir, "st");
	let batch = "default";
	let limit: number | undefined;
	let port = DEFAULT_SANDBOX_SERVER_PORT;
	let recorderPort = DEFAULT_DRIVE_RECORDER_PORT;
	let stubModel = DEFAULT_STUB_MODEL;
	let combinationTimeoutMs = DEFAULT_COMBINATION_TIMEOUT_MS;
	let headless = true;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--headed") {
			headless = false;
			continue;
		}
		if (
			arg === "--sandbox" ||
			arg === "--batch" ||
			arg === "--limit" ||
			arg === "--port" ||
			arg === "--recorder-port" ||
			arg === "--stub-model" ||
			arg === "--combination-timeout"
		) {
			const value = args[index + 1];
			if (value === undefined) throw new Error(`${arg} 需要一个值`);
			index += 1;
			if (arg === "--sandbox") sandboxDir = value;
			else if (arg === "--batch") batch = assertBatchName(value);
			else if (arg === "--limit")
				limit = parsePositiveInteger(value, "--limit");
			else if (arg === "--port") port = parsePort(value);
			else if (arg === "--recorder-port") recorderPort = parsePort(value);
			else if (arg === "--stub-model") stubModel = value;
			else {
				combinationTimeoutMs =
					parsePositiveInteger(value, "--combination-timeout") * 1000;
			}
			continue;
		}
		throw new Error(`未知参数：${arg}`);
	}
	const batchDir = path.join(paths.sandboxDir, "runs", batch);
	const result = await driveSandboxBatch({
		sandboxDir,
		privateRoot: paths.privateRoot,
		batchDir,
		port,
		recorderPort,
		limit,
		stubModel,
		combinationTimeoutMs,
		headless,
		log,
	});
	log(
		`驱动结束：完成 ${result.completed}，失败 ${result.failed}，跳过 ${result.skipped}，组合 ${result.total} 个`,
	);
	log(`清单：${path.join(batchDir, RUN_MANIFEST_FILE)}`);
	log(`录制：${path.join(batchDir, "index.jsonl")}`);
}

async function runCompare(
	args: readonly string[],
	paths: StBenchPaths,
	log: (message: string) => void,
): Promise<void> {
	let sandboxDir = path.join(paths.sandboxDir, "st");
	let batch = "default";
	let limit: number | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--sandbox" || arg === "--batch" || arg === "--limit") {
			const value = args[index + 1];
			if (value === undefined) throw new Error(`${arg} 需要一个值`);
			index += 1;
			if (arg === "--sandbox") sandboxDir = value;
			else if (arg === "--batch") batch = assertBatchName(value);
			else limit = parsePositiveInteger(value, "--limit");
			continue;
		}
		throw new Error(`未知参数：${arg}`);
	}
	const batchDir = path.join(paths.sandboxDir, "runs", batch);
	const result = await compareSandboxBatch({
		sandboxDir,
		privateRoot: paths.privateRoot,
		batchDir,
		limit,
		log,
	});
	log(
		`比对结束：组合 ${result.combinations}，请求 ${result.requests}，消息覆盖率 ${(result.summary.messageCoverage * 100).toFixed(2)}%，差异 ${result.summary.diffCount}，不支持功能 ${result.summary.unsupportedCount}`,
	);
	log(
		`采样参数一致 ${result.summary.matchedSamplingFields}/${result.summary.comparedSamplingFields}`,
	);
	log(`报告：${result.reportFile}`);
	log(`差异清单：${result.diffsFile}`);
}

async function runCoexist(
	args: readonly string[],
	paths: StBenchPaths,
	repoRoot: string,
	log: (message: string) => void,
): Promise<void> {
	let configPath: string | null = null;
	let outDir: string | null = null;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--config" || arg === "--out") {
			const value = args[index + 1];
			if (value === undefined) throw new Error(`${arg} 需要一个值`);
			index += 1;
			if (arg === "--config") configPath = value;
			else outDir = value;
			continue;
		}
		throw new Error(`未知参数：${arg}`);
	}
	if (configPath === null)
		throw new Error("coexist 需要 --config（配置 JSON）");
	const file = await loadCoexistConfig(configPath);
	const resolvedOut =
		outDir ??
		path.join(
			paths.privateRoot,
			"coexist",
			path.basename(configPath).replace(/\.json$/i, ""),
		);
	if (!isPathInside(path.resolve(resolvedOut), paths.privateRoot)) {
		throw new Error(
			`输出目录必须在私有根目录 ${paths.privateRoot} 内部，收到 ${resolvedOut}`,
		);
	}
	loadDotEnv(path.join(repoRoot, ".env"));
	const channels = await loadChannelsConfig(
		path.join(repoRoot, "data", "channels.yaml"),
	);
	if (!channels.models.has(file.writerModel)) {
		throw new Error(
			`没有正文模型 ${file.writerModel}；可用模型：${[...channels.models.keys()].join("、")}`,
		);
	}
	const judgeModel = file.judgeModel ?? resolveModelForRole(channels, "judge");
	if (!channels.models.has(judgeModel)) {
		throw new Error(
			`没有裁判模型 ${judgeModel}；可用模型：${[...channels.models.keys()].join("、")}`,
		);
	}
	const config: CoexistRunConfig = {
		pluginIds: file.plugins,
		cards: await loadCoexistCards(file),
		rounds: file.rounds,
		budgetTokens: file.budgetTokens ?? COEXIST_DEFAULT_BUDGET_TOKENS,
		maxTokens: file.maxTokens,
		temperature: file.temperature,
		structuredOutput: file.structuredOutput,
	};
	log(
		`共存对照：插件 ${file.plugins.join("、")}，卡 ${config.cards.length} 张，正文模型 ${file.writerModel}，裁判模型 ${judgeModel}`,
	);
	const comparisons = await runCoexistComparisons({
		config,
		plugins: ST_BENCH_COEXIST_PLUGINS,
		writer: {
			client: createLlmClient(channels, {
				defaultModel: file.writerModel,
				cacheDir: null,
			}),
			model: file.writerModel,
		},
		judge: {
			client: createLlmClient(channels, {
				defaultModel: judgeModel,
				cacheDir: null,
			}),
			model: judgeModel,
		},
		runDir: path.join(resolvedOut, "runs"),
		log,
	});
	for (const comparison of comparisons) {
		const files = await writeCoexistOutputs(
			path.join(resolvedOut, comparison.pluginId),
			comparison,
			config,
		);
		log(
			`插件 ${comparison.pluginId}：轮数 ${comparison.roundsOff}/${comparison.roundsOn}，失败 ${comparison.failedRoundsOff}/${comparison.failedRoundsOn}，明显变差 ${comparison.degraded.length} 项`,
		);
		log(`报告：${files.reportFile}`);
		log(`指标：${files.metricsFile}`);
	}
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
