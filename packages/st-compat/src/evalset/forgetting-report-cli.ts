import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type ForgettingRunResult,
	parseForgettingRun,
	renderForgettingReport,
	summarizeForgettingRuns,
} from "./forgetting.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat forgetting-report --input <path> [选项]",
	"",
	"汇总忘记评测的运行结果，生成私有版与统计版报告。",
	"",
	"选项：",
	"  --input <path>      必填，运行结果 JSON 或其所在目录",
	"  --private-out <p>   私有版报告路径，默认 eval-private/reports/R2-forgetting.md",
	"  --public-out <p>    统计版报告路径，默认 docs/dev/reports/R2-forgetting.md",
	"  --help              显示本说明",
].join("\n");

export interface ForgettingReportCliOptions {
	readonly log?: (message: string) => void;
}

export interface ForgettingReportCliResult {
	readonly runCount: number;
	readonly privateReportPath: string;
	readonly publicReportPath: string;
}

export async function runForgettingReportCli(
	args: readonly string[],
	options: ForgettingReportCliOptions = {},
): Promise<ForgettingReportCliResult> {
	const log = options.log ?? console.log;
	if (args.includes("--help") || args.includes("-h")) {
		log(USAGE);
		return {
			runCount: 0,
			privateReportPath: "",
			publicReportPath: "",
		};
	}
	const parsed = parseArgs(args);
	const runs = await readRuns(parsed.inputPath);
	const summary = summarizeForgettingRuns(runs);
	const privateText = renderForgettingReport(summary, {
		privateDetails: true,
		runs,
	});
	const publicText = renderForgettingReport(summary, {
		privateDetails: false,
	});
	await mkdir(path.dirname(parsed.privateOutPath), { recursive: true });
	await mkdir(path.dirname(parsed.publicOutPath), { recursive: true });
	await writeFile(parsed.privateOutPath, privateText, "utf8");
	await writeFile(parsed.publicOutPath, publicText, "utf8");
	log(
		`遗忘评测报告：${runs.length} 次运行，私有版 ${parsed.privateOutPath}，统计版 ${parsed.publicOutPath}`,
	);
	return {
		runCount: runs.length,
		privateReportPath: parsed.privateOutPath,
		publicReportPath: parsed.publicOutPath,
	};
}

async function readRuns(inputPath: string): Promise<ForgettingRunResult[]> {
	if (!existsSync(inputPath)) {
		throw new Error(`输入路径不存在：${inputPath}`);
	}
	const stats = statSync(inputPath);
	if (stats.isFile()) {
		return [await readRunFile(inputPath)];
	}
	if (!stats.isDirectory()) {
		throw new Error(`输入路径既不是文件也不是目录：${inputPath}`);
	}
	const entries = await readdir(inputPath, { withFileTypes: true });
	const files = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
		.map((entry) => entry.name)
		.sort();
	if (files.length === 0) {
		throw new Error(`目录里没有 JSON 运行结果：${inputPath}`);
	}
	const runs: ForgettingRunResult[] = [];
	for (const file of files) {
		runs.push(await readRunFile(path.join(inputPath, file)));
	}
	return runs;
}

async function readRunFile(filePath: string): Promise<ForgettingRunResult> {
	let value: unknown;
	try {
		value = JSON.parse(await readFile(filePath, "utf8"));
	} catch (error) {
		throw new Error(
			`${filePath} 不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`,
		);
	}
	try {
		return parseForgettingRun(value);
	} catch (error) {
		throw new Error(
			`${filePath} 不是合法的遗忘评测结果：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

interface ReportArgs {
	readonly inputPath: string;
	readonly privateOutPath: string;
	readonly publicOutPath: string;
}

function parseArgs(args: readonly string[]): ReportArgs {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (!arg.startsWith("--")) {
			throw new Error(`多余的参数 ${arg}；${USAGE}`);
		}
		const equals = arg.indexOf("=");
		const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
		if (key !== "input" && key !== "private-out" && key !== "public-out") {
			throw new Error(`不认识的参数 --${key}；${USAGE}`);
		}
		if (values.has(key)) {
			throw new Error(`参数 --${key} 重复；${USAGE}`);
		}
		let value: string | undefined;
		if (equals !== -1) {
			value = arg.slice(equals + 1);
		} else {
			value = args[index + 1];
			index += 1;
		}
		if (value === undefined || value.trim().length === 0) {
			throw new Error(`--${key} 后面必须写值；${USAGE}`);
		}
		values.set(key, value);
	}
	const inputPath = values.get("input");
	if (inputPath === undefined) {
		throw new Error(`--input 必填；${USAGE}`);
	}
	return {
		inputPath,
		privateOutPath:
			values.get("private-out") ??
			path.join(repoRoot, "eval-private", "reports", "R2-forgetting.md"),
		publicOutPath:
			values.get("public-out") ??
			path.join(repoRoot, "docs", "dev", "reports", "R2-forgetting.md"),
	};
}

async function main(): Promise<void> {
	await runForgettingReportCli(process.argv.slice(2));
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
