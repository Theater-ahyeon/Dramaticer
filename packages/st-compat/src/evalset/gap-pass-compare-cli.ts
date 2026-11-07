import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type LlmChannelsConfig,
	type LlmStreamingClient,
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
	resolveModelForRole,
} from "@dramaticer/core";
import {
	type GapPassCompareReport,
	MIN_COMPARE_FLOORS,
	formatCompareReport,
	runGapPassCompare,
} from "./gap-pass-compare.js";

export interface GapPassCompareCliOptions {
	readonly rawRoot: string;
	readonly story: string;
	readonly floors: number;
	readonly dir: string;
	readonly reportPath: string;
	readonly cacheDir: string;
	readonly channelsPath: string;
	readonly envPath: string;
	/** 覆盖 settler 角色解析到的模型；评测换路由时使用。 */
	readonly model?: string | null;
	/** 结算窗口的楼层数；默认 4。 */
	readonly windowSize?: number;
	readonly log?: (message: string) => void;
	/** 测试注入；不提供时按渠道配置创建。 */
	readonly createClient?: (cacheDir: string) => Promise<LlmStreamingClient>;
}

export async function runGapPassCompareCli(
	options: GapPassCompareCliOptions,
): Promise<GapPassCompareReport> {
	const log = options.log ?? ((message: string) => console.log(message));
	let config: LlmChannelsConfig | null = null;
	const loadConfig = async (): Promise<LlmChannelsConfig> => {
		if (config !== null) return config;
		loadDotEnv(options.envPath);
		config = await loadChannelsConfig(options.channelsPath);
		return config;
	};
	const createClient =
		options.createClient ??
		(async (cacheDir: string) => {
			const channels = await loadConfig();
			return createLlmClient(channels, {
				defaultModel: options.model ?? resolveModelForRole(channels, "settler"),
				cacheDir,
			});
		});
	await mkdir(options.cacheDir, { recursive: true });
	const client = await createClient(options.cacheDir);
	log(
		options.model === undefined || options.model === null
			? "模型：按 settler 角色解析"
			: `模型：${options.model}`,
	);
	const report = await runGapPassCompare({
		rawRoot: options.rawRoot,
		story: options.story,
		floors: options.floors,
		dir: options.dir,
		client,
		log,
		windowSize: options.windowSize,
	});
	await mkdir(path.dirname(options.reportPath), { recursive: true });
	await writeFile(
		options.reportPath,
		`${JSON.stringify(report, null, 2)}\n`,
		"utf8",
	);
	log(formatCompareReport(report));
	log(`报告：${options.reportPath}`);
	return report;
}

interface CliArgs {
	readonly story: string | null;
	readonly floors: number;
	readonly dir: string | null;
	readonly reportPath: string | null;
	readonly model: string | null;
	readonly channelsPath: string | null;
	readonly windowSize: number | null;
	readonly cacheDir: string | null;
	readonly help: boolean;
}

function parseArgs(args: readonly string[]): CliArgs {
	let story: string | null = null;
	let floors = MIN_COMPARE_FLOORS;
	let dir: string | null = null;
	let reportPath: string | null = null;
	let model: string | null = null;
	let channelsPath: string | null = null;
	let windowSize: number | null = null;
	let cacheDir: string | null = null;
	let help = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") {
			help = true;
			continue;
		}
		if (
			arg === "--story" ||
			arg === "--floors" ||
			arg === "--dir" ||
			arg === "--report" ||
			arg === "--model" ||
			arg === "--channels" ||
			arg === "--window" ||
			arg === "--cache"
		) {
			const value = args[index + 1];
			if (value === undefined) throw new Error(`${arg} 需要一个值`);
			index += 1;
			if (arg === "--story") story = value;
			else if (arg === "--floors") floors = requireFloorCount(value);
			else if (arg === "--dir") dir = value;
			else if (arg === "--model") model = value;
			else if (arg === "--channels") channelsPath = value;
			else if (arg === "--window")
				windowSize = requirePositiveInteger(value, "--window");
			else if (arg === "--cache") cacheDir = value;
			else reportPath = value;
			continue;
		}
		throw new Error(`未知参数：${arg}`);
	}
	return {
		story,
		floors,
		dir,
		reportPath,
		model,
		channelsPath,
		windowSize,
		cacheDir,
		help,
	};
}

function requirePositiveInteger(value: string, label: string): number {
	if (!/^\d+$/.test(value)) {
		throw new Error(`${label} 必须是不小于 1 的整数，收到 ${value}`);
	}
	const parsed = Number(value);
	if (parsed < 1) {
		throw new Error(`${label} 必须是不小于 1 的整数，收到 ${value}`);
	}
	return parsed;
}

function requireFloorCount(value: string): number {
	if (!/^\d+$/.test(value)) {
		throw new Error(
			`--floors 必须是不小于 ${MIN_COMPARE_FLOORS} 的整数，收到 ${value}`,
		);
	}
	const parsed = Number(value);
	if (parsed < MIN_COMPARE_FLOORS) {
		throw new Error(
			`--floors 必须是不小于 ${MIN_COMPARE_FLOORS} 的整数，收到 ${value}`,
		);
	}
	return parsed;
}

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat gap-pass-compare --story <id> [选项]",
	"",
	"在同一个对话的同一段楼层上分别运行合并调用 gap_pass 与四个独立后台任务，对比结算结果。",
	"",
	"选项：",
	"  --story <id>     必填，manifest 里的对话 id",
	`  --floors <n>     样本楼层数，默认与下限都是 ${MIN_COMPARE_FLOORS}`,
	"  --dir <path>     两个对比数据库的目录，默认 eval-private/memory-cache/gap-pass-compare",
	"  --report <path>  报告路径，默认 eval-private/reports/gap-pass-compare.json",
	"  --model <alias>  覆盖 settler 角色的模型，默认按渠道配置的 roles.settler",
	"  --channels <path> 渠道配置文件，默认 data/channels.yaml",
	"  --cache <path>   模型响应缓存目录，默认 eval-private/memory-cache/gap-pass-compare/cache",
	"  --window <n>     结算窗口楼层数，默认 4",
	"  --help           显示本说明",
].join("\n");

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(USAGE);
		return;
	}
	if (args.story === null) throw new Error("缺少 --story");
	const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
	const cacheRoot = path.join(repoRoot, "eval-private", "memory-cache");
	await runGapPassCompareCli({
		rawRoot: path.join(repoRoot, "eval-private", "raw"),
		story: args.story,
		floors: args.floors,
		dir: args.dir ?? path.join(cacheRoot, "gap-pass-compare", "db"),
		reportPath:
			args.reportPath ??
			path.join(repoRoot, "eval-private", "reports", "gap-pass-compare.json"),
		cacheDir:
			args.cacheDir ?? path.join(cacheRoot, "gap-pass-compare", "cache"),
		channelsPath:
			args.channelsPath ?? path.join(repoRoot, "data", "channels.yaml"),
		envPath: path.join(repoRoot, ".env"),
		model: args.model,
	});
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
