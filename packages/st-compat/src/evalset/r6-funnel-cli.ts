import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type R6FunnelReport,
	formatR6FunnelReport,
	runR6Funnel,
} from "./r6-funnel.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat r6-funnel --dir <path> [--dir <path>] [选项]",
	"",
	"对 r6-compare 运行目录里每条判为矛盾的探针做遗忘漏斗归因：台账有没有原文支撑、事实有没有进入答题上下文、进入 prompt 是否答对。只读 sidecar 与副本数据库，不调用任何模型。",
	"",
	"选项：",
	"  --dir <path>       必填，可重复；r6-compare 的运行目录（其下有 runs/<故事>/<楼层>/native.json）",
	"  --json <path>      结果 JSON，默认 eval-private/reports/r6/funnel.json",
	"  --report <path>    报告，默认 eval-private/reports/r6/funnel.md",
	"  --help             显示本说明",
].join("\n");

export interface R6FunnelCliOptions {
	readonly dirs: readonly string[];
	readonly jsonPath: string;
	readonly reportPath: string;
	readonly log?: (message: string) => void;
	readonly now?: () => number;
}

export async function runR6FunnelCli(
	options: R6FunnelCliOptions,
): Promise<R6FunnelReport> {
	const log = options.log ?? ((message: string) => console.log(message));
	if (options.dirs.length === 0) {
		throw new Error(`至少需要一个 --dir；${USAGE}`);
	}
	for (const dir of options.dirs) {
		if (!existsSync(dir)) throw new Error(`运行目录不存在：${dir}`);
	}
	const report = await runR6Funnel({
		dirs: options.dirs,
		log,
		...(options.now === undefined ? {} : { now: options.now }),
	});
	await mkdir(path.dirname(options.jsonPath), { recursive: true });
	await writeFile(
		options.jsonPath,
		`${JSON.stringify(report, null, 2)}\n`,
		"utf8",
	);
	await mkdir(path.dirname(options.reportPath), { recursive: true });
	await writeFile(
		options.reportPath,
		`${formatR6FunnelReport(report)}\n`,
		"utf8",
	);
	const summary = report.summary;
	log(
		`遗忘漏斗：矛盾 ${summary.contradicted} 条，无依据 ${summary.classes["no-evidence"]}、未进入 prompt ${summary.classes["not-in-prompt"]}、进入 prompt 未答对 ${summary.classes["not-recalled"]}，无法归因 ${summary.unattributed}`,
	);
	log(`结果：${options.jsonPath}`);
	log(`报告：${options.reportPath}`);
	return report;
}

interface CliArgs {
	readonly dirs: readonly string[];
	readonly jsonPath: string | null;
	readonly reportPath: string | null;
	readonly help: boolean;
}

const VALUE_ARGS: Readonly<Record<string, true>> = {
	"--dir": true,
	"--json": true,
	"--report": true,
};

function parseArgs(args: readonly string[]): CliArgs {
	const dirs: string[] = [];
	let jsonPath: string | null = null;
	let reportPath: string | null = null;
	let help = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (arg === "--help" || arg === "-h") {
			help = true;
			continue;
		}
		if (VALUE_ARGS[arg] !== true) {
			throw new Error(`未知参数：${arg}`);
		}
		const value = args[index + 1];
		if (value === undefined) throw new Error(`${arg} 需要一个值`);
		index += 1;
		if (arg === "--dir") dirs.push(value);
		else if (arg === "--json") jsonPath = value;
		else reportPath = value;
	}
	return { dirs, jsonPath, reportPath, help };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(USAGE);
		return;
	}
	await runR6FunnelCli({
		dirs: args.dirs,
		jsonPath:
			args.jsonPath ??
			path.join(repoRoot, "eval-private", "reports", "r6", "funnel.json"),
		reportPath:
			args.reportPath ??
			path.join(repoRoot, "eval-private", "reports", "r6", "funnel.md"),
	});
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
