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
	type R6InstrumentReport,
	formatR6InstrumentReport,
	runR6Instrument,
} from "./r6-instrument.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat r6-instrument --aa <path> [选项]",
	"",
	"跑 G0 的两件仪器：A/A 检验（种子 1 与种子 2 的两次生成）与 F0-T03 的真人标注配对。",
	"",
	"选项：",
	"  --aa <path>             必填，r6-replay 写出的 A/A 生成样本 JSONL",
	"  --pairs <path>          F0-T03 的配对文本，默认 eval-private/f0/pairs.jsonl",
	"  --label-records <path>  F0-T03 的判定记录（只取配对 id），默认 eval-private/f0/judge.jsonl",
	"  --dir <path>            运行目录，默认 eval-private/reports/r6/instrument",
	"  --json <path>           结果 JSON，默认 eval-private/reports/r6/instrument.json",
	"  --report <path>         报告，默认 eval-private/reports/r6/instrument.md",
	"  --judge-model <m>       裁判模型别名，默认按 roles.judge 解析",
	"  --max-tokens <n>        裁判输出上限，默认用模型在渠道里声明的上限",
	"  --cache <path>          模型响应缓存目录，默认 <dir>/cache",
	"  --channels <path>       渠道配置，默认 data/channels.yaml",
	"  --help                  显示本说明",
].join("\n");

export interface R6InstrumentCliOptions {
	readonly aaSamplesPath: string;
	readonly pairsPath: string;
	readonly labelRecordsPath: string;
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

export async function runR6InstrumentCli(
	options: R6InstrumentCliOptions,
): Promise<R6InstrumentReport> {
	const log = options.log ?? ((message: string) => console.log(message));
	if (!existsSync(options.aaSamplesPath)) {
		throw new Error(`A/A 样本不存在：${options.aaSamplesPath}`);
	}
	if (!existsSync(options.pairsPath)) {
		throw new Error(`F0-T03 配对文本不存在：${options.pairsPath}`);
	}
	if (!existsSync(options.labelRecordsPath)) {
		throw new Error(`F0-T03 判定记录不存在：${options.labelRecordsPath}`);
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
	const report = await runR6Instrument({
		aaSamplesPath: options.aaSamplesPath,
		pairsPath: options.pairsPath,
		labelRecordsPath: options.labelRecordsPath,
		dir: options.dir,
		judge: {
			client: createClient(channels, judgeAlias, cacheDir),
			model: judgeAlias,
			...(options.maxTokens === null ? {} : { maxTokens: options.maxTokens }),
		},
		log,
	});
	log(
		`G0 仪器：A/A 完成 ${report.aa.completedPairs}/${report.aa.plannedPairs} 对（失败 ${report.aa.failures}）；真人标注一致 ${report.humanLabels.acceptedChoices}/${report.humanLabels.judgements}`,
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
		`${formatR6InstrumentReport(report)}\n`,
		"utf8",
	);
	log(`结果：${options.jsonPath}`);
	log(`报告：${options.reportPath}`);
	return report;
}

interface CliArgs {
	readonly aaSamplesPath: string | null;
	readonly pairsPath: string | null;
	readonly labelRecordsPath: string | null;
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
	"--aa": true,
	"--pairs": true,
	"--label-records": true,
	"--dir": true,
	"--json": true,
	"--report": true,
	"--channels": true,
	"--cache": true,
	"--judge-model": true,
	"--max-tokens": true,
};

function parseArgs(args: readonly string[]): CliArgs {
	let aaSamplesPath: string | null = null;
	let pairsPath: string | null = null;
	let labelRecordsPath: string | null = null;
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
		if (arg === "--aa") aaSamplesPath = value;
		else if (arg === "--pairs") pairsPath = value;
		else if (arg === "--label-records") labelRecordsPath = value;
		else if (arg === "--dir") dir = value;
		else if (arg === "--json") jsonPath = value;
		else if (arg === "--report") reportPath = value;
		else if (arg === "--channels") channelsPath = value;
		else if (arg === "--cache") cacheDir = value;
		else if (arg === "--judge-model") judgeModel = value;
		else maxTokens = requirePositive(value, arg);
	}
	return {
		aaSamplesPath,
		pairsPath,
		labelRecordsPath,
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
	if (args.aaSamplesPath === null) {
		throw new Error(`缺少 --aa（A/A 生成样本）\n\n${USAGE}`);
	}
	const dir =
		args.dir ??
		path.join(repoRoot, "eval-private", "reports", "r6", "instrument");
	await runR6InstrumentCli({
		aaSamplesPath: args.aaSamplesPath,
		pairsPath:
			args.pairsPath ??
			path.join(repoRoot, "eval-private", "f0", "pairs.jsonl"),
		labelRecordsPath:
			args.labelRecordsPath ??
			path.join(repoRoot, "eval-private", "f0", "judge.jsonl"),
		dir,
		jsonPath:
			args.jsonPath ??
			path.join(repoRoot, "eval-private", "reports", "r6", "instrument.json"),
		reportPath:
			args.reportPath ??
			path.join(repoRoot, "eval-private", "reports", "r6", "instrument.md"),
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
