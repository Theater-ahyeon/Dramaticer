import { spawn } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultConfigPath = join(
	repoRoot,
	".devloop",
	"scratch",
	"R5-T14",
	"supervisor-config.json",
);

const configPath = readConfigPath(process.argv.slice(2));
const config = readConfig(configPath);
const workDir = resolve(repoRoot, config.workDir);
const statusPath = join(workDir, "supervisor.json");
const lockPath = join(workDir, "supervisor.lock");
const logPath = join(workDir, "supervisor.log");
const serverLogPath = join(workDir, "server.log");
const dbPath = resolve(repoRoot, config.dbPath);
const channelsPath = resolve(repoRoot, config.channelsPath);
const progressPath = resolve(repoRoot, config.progressPath);
const privateReportPath = resolve(repoRoot, config.privateReportPath);
const statsReportPath = resolve(repoRoot, config.statsReportPath);
const screenshotDir = resolve(repoRoot, config.screenshotDir);
const baseUrl = config.baseUrl ?? `http://127.0.0.1:${config.port}`;
const startedAt = new Date().toISOString();

mkdirSync(workDir, { recursive: true });

const lock = acquireLock();
if (lock.blocked) {
	console.log(
		`监督进程已在运行（pid ${lock.pid}）；状态见 ${statusPath}`,
	);
	process.exit(1);
}

let server = null;
let serverExit = null;
let stopping = false;
let completedRounds = 0;
let failures = 0;
let invocations = 0;

process.once("SIGINT", () => {
	void shutdown("interrupted", "收到 SIGINT").then(() => process.exit(1));
});
process.once("SIGTERM", () => {
	void shutdown("interrupted", "收到 SIGTERM").then(() => process.exit(1));
});
process.on("uncaughtException", (error) => {
	void shutdown("failed", `未捕获异常：${error.message}`).then(() =>
		process.exit(1),
	);
});
process.on("unhandledRejection", (error) => {
	void shutdown(
		"failed",
		`未处理的 Promise 拒绝：${error instanceof Error ? error.message : String(error)}`,
	).then(() => process.exit(1));
});

completedRounds = readProgressSnapshot().rounds;
updateStatus("running", "启动监督进程");
logLine(
	`监督进程启动：目标 ${config.rounds} 轮，当前 ${completedRounds} 轮，每次调用预算 ${config.timeBudgetMinutes} 分钟`,
);

try {
	if (completedRounds >= config.rounds) {
		await shutdown("completed", `已有 ${completedRounds} 轮记录`);
		process.exit(0);
	}
	await build();
	if (config.baseUrl === null) {
		await startServer();
	} else {
		logLine(`复用已有服务 ${baseUrl}`);
	}
	await waitForHealth();

	let lastRounds = 0;
	let stalls = 0;
	let consecutiveFailures = 0;
	while (!stopping) {
		invocations += 1;
		if (invocations > config.maxInvocations) {
			throw new Error(
				`调用次数超过上限 ${config.maxInvocations}，停在 ${completedRounds}/${config.rounds} 轮`,
			);
		}
		logLine(
			`第 ${invocations} 次试玩调用，当前 ${completedRounds}/${config.rounds} 轮`,
		);
		const exitCode = await runPlaytest();
		const snapshot = readProgressSnapshot();
		completedRounds = snapshot.rounds;
		failures = snapshot.failures;
		updateStatus(
			"running",
			`第 ${invocations} 次调用结束（退出码 ${exitCode}），${completedRounds}/${config.rounds} 轮`,
		);
		if (completedRounds >= config.rounds) {
			await shutdown("completed", `完成 ${completedRounds} 轮`);
			process.exit(0);
		}
		if (snapshot.lastFailure !== null) {
			consecutiveFailures += 1;
			logLine(
				`第 ${completedRounds + 1} 轮失败：${snapshot.lastFailure}（连续 ${consecutiveFailures} 次）`,
			);
			if (consecutiveFailures > config.maxConsecutiveFailures) {
				throw new Error(
					`连续 ${consecutiveFailures} 次失败：${snapshot.lastFailure}`,
				);
			}
		} else {
			consecutiveFailures = 0;
			if (completedRounds <= lastRounds) {
				stalls += 1;
				logLine(
					`本轮调用没有新增轮次（停滞 ${stalls} 次）`,
				);
				if (stalls > config.maxStalls) {
					throw new Error(
						`连续 ${stalls} 次调用没有新增轮次，停在 ${completedRounds}/${config.rounds} 轮`,
					);
				}
			} else {
				stalls = 0;
			}
		}
		lastRounds = completedRounds;
		await sleep(2_000);
	}
} catch (error) {
	await shutdown(
		"failed",
		error instanceof Error ? error.message : String(error),
	);
	process.exit(1);
}

function readConfigPath(args) {
	const index = args.indexOf("--config");
	if (index === -1) return defaultConfigPath;
	const value = args[index + 1];
	if (value === undefined || value.startsWith("--")) {
		throw new Error("--config 后面必须写配置文件路径");
	}
	return resolve(value);
}

function readConfig(path) {
	if (!existsSync(path)) {
		throw new Error(`没有监督进程配置 ${path}`);
	}
	const value = JSON.parse(readFileSync(path, "utf8"));
	const config = {
		rounds: requireInteger(value.rounds, "rounds", 2),
		timeBudgetMinutes: requireNumber(
			value.timeBudgetMinutes,
			"timeBudgetMinutes",
		),
		dbPath: requireString(value.dbPath, "dbPath"),
		channelsPath: requireString(value.channelsPath, "channelsPath"),
		port: requireInteger(value.port, "port", 1),
		workDir: requireString(value.workDir ?? ".devloop/scratch/R5-T14", "workDir"),
		progressPath: requireString(value.progressPath, "progressPath"),
		privateReportPath: requireString(
			value.privateReportPath,
			"privateReportPath",
		),
		statsReportPath: requireString(value.statsReportPath, "statsReportPath"),
		screenshotDir: requireString(value.screenshotDir, "screenshotDir"),
		storyTitle: requireString(value.storyTitle, "storyTitle"),
		baseUrl: value.baseUrl ?? null,
		password: value.password ?? null,
		maxConsecutiveFailures: requireInteger(
			value.maxConsecutiveFailures ?? 3,
			"maxConsecutiveFailures",
			1,
		),
		maxStalls: requireInteger(value.maxStalls ?? 3, "maxStalls", 1),
		maxInvocations: requireInteger(
			value.maxInvocations ?? 12,
			"maxInvocations",
			1,
		),
	};
	if (config.baseUrl !== null && typeof config.baseUrl !== "string") {
		throw new Error("baseUrl 必须是字符串或 null");
	}
	if (config.password !== null && typeof config.password !== "string") {
		throw new Error("password 必须是字符串或 null");
	}
	return config;
}

function requireString(value, name) {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${name} 必须是非空字符串`);
	}
	return value;
}

function requireNumber(value, name) {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} 必须是正数`);
	}
	return value;
}

function requireInteger(value, name, min) {
	if (!Number.isInteger(value) || value < min) {
		throw new Error(`${name} 必须是不小于 ${min} 的整数`);
	}
	return value;
}

function acquireLock() {
	if (existsSync(lockPath)) {
		const pid = Number(readFileSync(lockPath, "utf8").trim());
		if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) {
			return { blocked: true, pid };
		}
		rmSync(lockPath, { force: true });
	}
	writeFileSync(lockPath, String(process.pid), { flag: "wx" });
	return { blocked: false, pid: process.pid };
}

function isProcessAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

async function build() {
	logLine("构建 server 与 web");
	const stdout = openSync(logPath, "a");
	try {
		await runCommand(
			"pnpm",
			[
				"--filter",
				"@dramaticer/server...",
				"--filter",
				"@dramaticer/web...",
				"build",
			],
			{
				cwd: repoRoot,
				shell: process.platform === "win32",
				stdio: ["ignore", stdout, stdout],
			},
		);
	} finally {
		closeSync(stdout);
	}
}

async function startServer() {
	logLine(`启动服务 ${baseUrl}，数据库 ${dbPath}`);
	const stdout = openSync(serverLogPath, "a");
	server = spawn(
		process.execPath,
		[
			join(repoRoot, "packages", "server", "dist", "cli.js"),
			"--db",
			dbPath,
			"--channels",
			channelsPath,
			"--port",
			String(config.port),
		],
		{
			cwd: repoRoot,
			env: process.env,
			stdio: ["ignore", stdout, stdout],
		},
	);
	server.on("exit", (code, signal) => {
		serverExit = { code, signal };
	});
	server.on("error", (error) => {
		serverExit = { code: null, signal: error.message };
	});
	closeSync(stdout);
}

async function waitForHealth() {
	const deadline = Date.now() + 60_000;
	for (;;) {
		if (serverExit !== null) {
			throw new Error(
				`服务在就绪前退出：${JSON.stringify(serverExit)}，日志见 ${serverLogPath}`,
			);
		}
		try {
			const response = await fetch(`${baseUrl}/api/health`, {
				signal: AbortSignal.timeout(2_000),
			});
			if (response.ok) {
				logLine("服务已就绪");
				return;
			}
			logLine(`健康检查返回 ${response.status}`);
		} catch {
			// 服务还没开始监听，继续等。
		}
		if (Date.now() >= deadline) {
			throw new Error(`服务在 60 秒内没有就绪：${baseUrl}`);
		}
		await sleep(1_000);
	}
}

async function runPlaytest() {
	const playtestEnv = {
		...process.env,
		PLAYTEST: "1",
		PLAYTEST_LIVE: "1",
		PLAYTEST_BASE_URL: baseUrl,
		PLAYTEST_DB: dbPath,
		PLAYTEST_CHANNELS: channelsPath,
		PLAYTEST_ROUNDS: String(config.rounds),
		PLAYTEST_RESUME: "1",
		PLAYTEST_TIME_BUDGET_MS: String(
			Math.round(config.timeBudgetMinutes * 60_000),
		),
		PLAYTEST_PROGRESS: progressPath,
		PLAYTEST_PRIVATE_REPORT: privateReportPath,
		PLAYTEST_STATS_REPORT: statsReportPath,
		PLAYTEST_SCREENSHOT_DIR: screenshotDir,
		PLAYTEST_STORY_TITLE: config.storyTitle,
	};
	if (config.password !== null) {
		playtestEnv.PLAYTEST_PASSWORD = config.password;
	}
	const stdout = openSync(logPath, "a");
	try {
		return await runCommand(
			process.execPath,
			[join(repoRoot, "packages", "web", "e2e", "playtest", "cli.mjs")],
			{
				cwd: join(repoRoot, "packages", "web"),
				env: playtestEnv,
				stdio: ["ignore", stdout, stdout],
				allowFailure: true,
			},
		);
	} finally {
		closeSync(stdout);
	}
}

function runCommand(command, args, options) {
	return new Promise((resolvePromise, reject) => {
		logLine(`执行 ${command} ${args.join(" ")}`);
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			shell: options.shell ?? false,
			stdio: options.stdio ?? ["ignore", "inherit", "inherit"],
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code !== 0 && options.allowFailure !== true) {
				reject(new Error(`${command} 退出码 ${code}`));
				return;
			}
			resolvePromise(code ?? 1);
		});
	});
}

function readProgressSnapshot() {
	if (!existsSync(progressPath)) {
		return { rounds: 0, failures: 0, lastFailure: null };
	}
	const progress = JSON.parse(readFileSync(progressPath, "utf8"));
	const records = Array.isArray(progress.records) ? progress.records : [];
	let rounds = 0;
	let failures = 0;
	let lastFailure = null;
	for (const record of records) {
		if (record.kind === "round") rounds += 1;
		if (record.kind === "failure") {
			failures += 1;
			lastFailure = `${record.stepId}：${String(record.error).slice(0, 300)}`;
		}
	}
	return { rounds, failures, lastFailure };
}

function updateStatus(state, message) {
	const status = {
		state,
		pid: process.pid,
		startedAt,
		updatedAt: new Date().toISOString(),
		rounds: completedRounds,
		target: config.rounds,
		invocations,
		failures,
		baseUrl,
		dbPath,
		channelsPath,
		progressPath,
		logPath,
		serverLogPath,
		message,
	};
	mkdirSync(dirname(statusPath), { recursive: true });
	const temporary = `${statusPath}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`, "utf8");
	renameSync(temporary, statusPath);
}

function logLine(message) {
	const line = `${new Date().toISOString()} ${message}\n`;
	mkdirSync(workDir, { recursive: true });
	writeFileSync(logPath, line, { flag: "a" });
}

async function shutdown(state, message) {
	if (stopping) return;
	stopping = true;
	updateStatus(state, message);
	logLine(`${state}：${message}`);
	if (server !== null) {
		server.kill();
		const deadline = Date.now() + 5_000;
		while (serverExit === null && Date.now() < deadline) {
			await sleep(100);
		}
		if (serverExit === null) {
			logLine("服务没有在 5 秒内退出，强制结束");
			await runCommand(
				"taskkill",
				["/PID", String(server.pid), "/T", "/F"],
				{ allowFailure: true, shell: process.platform === "win32" },
			).catch(() => undefined);
		}
	}
	rmSync(lockPath, { force: true });
}

function sleep(ms) {
	return new Promise((resolvePromise) => {
		setTimeout(resolvePromise, ms);
	});
}
