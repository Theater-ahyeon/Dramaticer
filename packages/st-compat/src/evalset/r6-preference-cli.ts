import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type LlmChannelsConfig,
	type LlmClient,
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
	resolveModelForRole,
} from "@dramaticer/core";
import {
	type R6PreferenceReport,
	formatR6PreferenceReport,
	runR6Preference,
} from "./r6-preference.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat r6-preference --db <path> [选项]",
	"",
	"把 `preferences export` 的回复对按两种顺序交给裁判，换算成配对级一致率，作为 G6 的判定输入。",
	"",
	"选项：",
	"  --db <path>          必填，回复对所在故事的数据库",
	"  --pairs <path>       导出目录或单个 .pairs.jsonl，默认 eval-private/preferences",
	"  --story <id>         只评判这个故事的回复对",
	"  --dir <path>         运行目录，默认 eval-private/reports/r6/preference",
	"  --json <path>        结果 JSON，默认 eval-private/reports/r6/preference.json",
	"  --report <path>      报告，默认 eval-private/reports/r6/preference.md",
	"  --judge-model <m>    裁判模型别名，默认按 roles.judge 解析",
	"  --max-tokens <n>     裁判输出上限，默认用模型在渠道里声明的上限",
	"  --cache <path>       模型响应缓存目录，默认 <dir>/cache",
	"  --channels <path>    渠道配置，默认 data/channels.yaml",
	"  --help               显示本说明",
].join("\n");

export interface R6PreferenceCliOptions {
	readonly dbPath: string;
	readonly pairsPath: string;
	readonly story: string | null;
	readonly dir: string;
	readonly jsonPath: string;
	readonly reportPath: string;
	readonly channelsPath: string;
	readonly envPath: string;
	readonly cacheDir: string | null;
	readonly judgeModel: string | null;
	readonly maxTokens: number | null;
	readonly log?: (message: string) => void;
	readonly loadEnv?: (filePath: string) => void;
	readonly loadConfig?: (filePath: string) => Promise<LlmChannelsConfig>;
	readonly createClient?: (
		channels: LlmChannelsConfig,
		alias: string,
		cacheDir: string,
	) => LlmClient;
}

export async function runR6PreferenceCli(
	options: R6PreferenceCliOptions,
): Promise<R6PreferenceReport> {
	const log = options.log ?? ((message: string) => console.log(message));
	if (!existsSync(options.dbPath)) {
		throw new Error(`数据库不存在：${options.dbPath}`);
	}
	(options.loadEnv ?? loadDotEnv)(options.envPath);
	const channels = await (options.loadConfig ?? loadChannelsConfig)(
		options.channelsPath,
	);
	const judgeAlias =
		options.judgeModel ?? resolveModelForRole(channels, "judge");
	if (!channels.models.has(judgeAlias)) {
		throw new Error(
			`没有模型 ${judgeAlias}；可用模型：${[...channels.models.keys()].join("、")}`,
		);
	}
	const cacheDir = options.cacheDir ?? path.join(options.dir, "cache");
	await mkdir(cacheDir, { recursive: true });
	const createClient =
		options.createClient ??
		((config: LlmChannelsConfig, alias: string, cache: string) =>
			createLlmClient(config, { defaultModel: alias, cacheDir: cache }));
	const report = await runR6Preference({
		sourceDbPath: options.dbPath,
		pairsPath: options.pairsPath,
		dir: options.dir,
		story: options.story,
		judge: {
			client: createClient(channels, judgeAlias, cacheDir),
			model: judgeAlias,
			...(options.maxTokens === null ? {} : { maxTokens: options.maxTokens }),
		},
		log,
	});
	log(
		`R6 偏好一致率：裁判 ${judgeAlias}；计划 ${report.summary.plannedPairs} 对，完成 ${report.summary.completedPairs}，一致 ${report.summary.accepted}${report.summary.insufficient ? "（样本不足，未证实）" : ""}`,
	);
	await mkdir(path.dirname(options.jsonPath), { recursive: true });
	await writeFile(
		options.jsonPath,
		`${JSON.stringify(report, null, 2)}\n`,
		"utf8",
	);
	await mkdir(path.dirname(options.reportPath), { recursive: true });
	await writeFile(
		options.reportPath,
		`${formatR6PreferenceReport(report)}\n`,
		"utf8",
	);
	log(`结果：${options.jsonPath}`);
	log(`报告：${options.reportPath}`);
	return report;
}

interface CliArgs {
	readonly dbPath: string | null;
	readonly pairsPath: string | null;
	readonly story: string | null;
	readonly dir: string | null;
	readonly jsonPath: string | null;
	readonly reportPath: string | null;
	readonly channelsPath: string | null;
	readonly cacheDir: string | null;
	readonly judgeModel: string | null;
	readonly maxTokens: number | null;
	readonly help: boolean;
}

const VALUE_ARGS: Readonly<Record<string, true>> = {
	"--db": true,
	"--pairs": true,
	"--story": true,
	"--dir": true,
	"--json": true,
	"--report": true,
	"--channels": true,
	"--cache": true,
	"--judge-model": true,
	"--max-tokens": true,
};

function parseArgs(args: readonly string[]): CliArgs {
	let dbPath: string | null = null;
	let pairsPath: string | null = null;
	let story: string | null = null;
	let dir: string | null = null;
	let jsonPath: string | null = null;
	let reportPath: string | null = null;
	let channelsPath: string | null = null;
	let cacheDir: string | null = null;
	let judgeModel: string | null = null;
	let maxTokens: number | null = null;
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
		if (arg === "--db") dbPath = value;
		else if (arg === "--pairs") pairsPath = value;
		else if (arg === "--story") story = value;
		else if (arg === "--dir") dir = value;
		else if (arg === "--json") jsonPath = value;
		else if (arg === "--report") reportPath = value;
		else if (arg === "--channels") channelsPath = value;
		else if (arg === "--cache") cacheDir = value;
		else if (arg === "--judge-model") judgeModel = value;
		else maxTokens = requirePositive(value, arg);
	}
	return {
		dbPath,
		pairsPath,
		story,
		dir,
		jsonPath,
		reportPath,
		channelsPath,
		cacheDir,
		judgeModel,
		maxTokens,
		help,
	};
}

function requirePositive(value: string, label: string): number {
	if (!/^\d+$/.test(value) || Number(value) < 1) {
		throw new Error(`${label} 必须是不小于 1 的整数，收到 ${value}`);
	}
	return Number(value);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(USAGE);
		return;
	}
	if (args.dbPath === null) throw new Error("缺少 --db");
	const reportsDir = path.join(repoRoot, "eval-private", "reports", "r6");
	await runR6PreferenceCli({
		dbPath: args.dbPath,
		pairsPath:
			args.pairsPath ?? path.join(repoRoot, "eval-private", "preferences"),
		story: args.story,
		dir: args.dir ?? path.join(reportsDir, "preference"),
		jsonPath: args.jsonPath ?? path.join(reportsDir, "preference.json"),
		reportPath: args.reportPath ?? path.join(reportsDir, "preference.md"),
		channelsPath:
			args.channelsPath ?? path.join(repoRoot, "data", "channels.yaml"),
		envPath: path.join(repoRoot, ".env"),
		cacheDir: args.cacheDir,
		judgeModel: args.judgeModel,
		maxTokens: args.maxTokens,
	});
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
