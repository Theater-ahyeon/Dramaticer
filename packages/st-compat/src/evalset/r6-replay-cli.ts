import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type LlmChannelsConfig,
	type LlmStreamingClient,
	StoryStore as StoryStoreClass,
	createEmbeddingClient,
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
	resolveDefaultMaxTokens,
	resolveModelForRole,
	resolveStructuredOutputMode,
	resolveToolTransport,
} from "@dramaticer/core";
import {
	DEFAULT_R6_REPLAY_SEED,
	type R6ReplayReport,
	formatR6ReplayReport,
	runR6Replay,
} from "./r6-replay.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat r6-replay --db <path> --story <id>[,<id>] [选项]",
	"",
	"从源数据库规划重 roll 点，每个点复制一份数据库、预热 12 楼，按种子 1 与种子 2 各生成一次续写；种子 1 的续写与被放弃侧、被接受侧各配对一次，两种展示顺序各判一次。同时写出 A/A 样本供 r6-instrument 使用。",
	"",
	"选项：",
	"  --db <path>        必填，已经导入故事与卡的数据库",
	"  --story <id>       必填，故事 id；多个用逗号分隔或重复传入",
	"  --floors <楼层>    只跑指定的玩家楼层，逗号分隔；只能配一个故事，用于缩样",
	"  --dir <path>       运行目录，默认 eval-private/reports/r6/replay",
	"  --json <path>      结果 JSON，默认 <dir>/replay.json",
	"  --report <path>    报告，默认 <dir>/replay.md",
	"  --aa <path>        A/A 样本 JSONL，默认 <dir>/aa-samples.jsonl",
	"  --model <alias>    写作模型，默认按 writer 角色解析",
	"  --judge-model <alias> 裁判模型，默认按 judge 角色解析",
	"  --background-model <alias> 预热后台模型，默认按 settler 角色解析",
	"  --channels <path>  渠道配置，默认 data/channels.yaml",
	"  --cache <path>     模型响应缓存目录，默认 <dir>/cache",
	"  --seed <n>         种子 1，默认 1；A/A 的第二次生成固定用种子 2",
	"  --budget <n>       输入 token 预算，默认按模型上下文窗口与输出上限计算",
	"  --max-tokens <n>   输出上限，默认取故事设置或模型声明",
	"  --help             显示本说明",
].join("\n");

export interface R6ReplayCliOptions {
	readonly dbPath: string;
	readonly stories: readonly string[];
	readonly floors: readonly number[] | null;
	readonly dir: string;
	readonly jsonPath: string;
	readonly reportPath: string;
	readonly aaSamplesPath: string;
	readonly channelsPath: string;
	readonly envPath: string;
	readonly cacheDir: string | null;
	readonly model: string | null;
	readonly judgeModel: string | null;
	readonly backgroundModel: string | null;
	readonly seed: number;
	readonly budgetTokens: number | null;
	readonly maxTokens: number | null;
	readonly log?: (message: string) => void;
	readonly loadEnv?: (filePath: string) => void;
	readonly loadConfig?: (filePath: string) => Promise<LlmChannelsConfig>;
	readonly createClient?: (
		channels: LlmChannelsConfig,
		alias: string,
		cacheDir: string,
	) => LlmStreamingClient;
}

export async function runR6ReplayCli(
	options: R6ReplayCliOptions,
): Promise<R6ReplayReport> {
	const log = options.log ?? ((message: string) => console.log(message));
	if (!existsSync(options.dbPath)) {
		throw new Error(`数据库不存在：${options.dbPath}`);
	}
	(options.loadEnv ?? loadDotEnv)(options.envPath);
	const channels = await (options.loadConfig ?? loadChannelsConfig)(
		options.channelsPath,
	);
	const writerAlias = options.model ?? resolveModelForRole(channels, "writer");
	const judgeAlias =
		options.judgeModel ?? resolveModelForRole(channels, "judge");
	const backgroundAlias =
		options.backgroundModel ?? resolveModelForRole(channels, "settler");
	const writerModel = channels.models.get(writerAlias);
	if (writerModel === undefined) {
		throw new Error(
			`没有模型 ${writerAlias}；可用模型：${[...channels.models.keys()].join("、")}`,
		);
	}
	for (const alias of [judgeAlias, backgroundAlias]) {
		if (!channels.models.has(alias)) {
			throw new Error(
				`没有模型 ${alias}；可用模型：${[...channels.models.keys()].join("、")}`,
			);
		}
	}
	const cacheDir = options.cacheDir ?? path.join(options.dir, "cache");
	await mkdir(cacheDir, { recursive: true });
	const structuredOutput = resolveStructuredOutputMode(writerModel.probe);
	const embeddingConfig = channels.embeddings.get("default");
	const embedder = embeddingConfig ? createEmbeddingClient(channels) : null;
	const sourceStore = StoryStoreClass.open(
		options.dbPath,
		embeddingConfig === undefined
			? {}
			: { embeddingDimensions: embeddingConfig.dimensions },
	);
	const prepared = (() => {
		try {
			for (const story of options.stories) {
				if (sourceStore.getStory(story) === null) {
					throw new Error(`数据库 ${options.dbPath} 里没有故事 ${story}`);
				}
			}
			const firstStory = options.stories[0] as string;
			const settings = sourceStore.getStorySettings(firstStory);
			const maxTokens =
				options.maxTokens ??
				(sourceStore.hasStorySettings(firstStory)
					? settings.maxTokens
					: resolveDefaultMaxTokens(channels, writerAlias));
			const budgetTokens =
				options.budgetTokens ?? writerModel.contextWindow - maxTokens;
			if (budgetTokens <= 0) {
				throw new Error(
					`模型 ${writerAlias} 的上下文窗口 ${writerModel.contextWindow} 不大于输出上限 ${maxTokens}`,
				);
			}
			return {
				maxTokens,
				budgetTokens,
				temperature: settings.temperature,
				reasoning: settings.reasoning,
			};
		} finally {
			sourceStore.close();
		}
	})();
	const createClient =
		options.createClient ??
		((config: LlmChannelsConfig, alias: string, cache: string) =>
			createLlmClient(config, { defaultModel: alias, cacheDir: cache }));
	const report = await runR6Replay({
		sourceDbPath: options.dbPath,
		stories: options.stories,
		dir: options.dir,
		writer: {
			client: createClient(channels, writerAlias, cacheDir),
			model: writerAlias,
		},
		judge: {
			client: createClient(channels, judgeAlias, cacheDir),
			model: judgeAlias,
		},
		background: {
			client: createClient(channels, backgroundAlias, cacheDir),
		},
		structuredOutput,
		budgetTokens: prepared.budgetTokens,
		toolTransport: resolveToolTransport(writerModel),
		embedder,
		maxTokens: prepared.maxTokens,
		temperature: prepared.temperature,
		reasoning: prepared.reasoning,
		seed: options.seed,
		floors: options.floors ?? undefined,
		log,
	});
	log(
		`R6 重 roll 回放：写作 ${writerAlias}，裁判 ${judgeAlias}，预热 ${backgroundAlias}；${report.summary.plannedPairs} 个点，对放弃侧完成 ${report.summary.groups.abandoned.completedPairs}，对接受侧完成 ${report.summary.groups.accepted.completedPairs}`,
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
		`${formatR6ReplayReport(report)}\n`,
		"utf8",
	);
	log(`结果：${options.jsonPath}`);
	log(`报告：${options.reportPath}`);
	log(`A/A 样本：${options.aaSamplesPath}`);
	return report;
}

interface CliArgs {
	readonly dbPath: string | null;
	readonly stories: readonly string[];
	readonly floors: readonly number[] | null;
	readonly dir: string | null;
	readonly jsonPath: string | null;
	readonly reportPath: string | null;
	readonly aaSamplesPath: string | null;
	readonly channelsPath: string | null;
	readonly cacheDir: string | null;
	readonly model: string | null;
	readonly judgeModel: string | null;
	readonly backgroundModel: string | null;
	readonly seed: number;
	readonly budgetTokens: number | null;
	readonly maxTokens: number | null;
	readonly help: boolean;
}

const VALUE_ARGS: Readonly<Record<string, true>> = {
	"--db": true,
	"--story": true,
	"--floors": true,
	"--dir": true,
	"--json": true,
	"--report": true,
	"--aa": true,
	"--channels": true,
	"--cache": true,
	"--model": true,
	"--judge-model": true,
	"--background-model": true,
	"--seed": true,
	"--budget": true,
	"--max-tokens": true,
};

function parseArgs(args: readonly string[]): CliArgs {
	let dbPath: string | null = null;
	const stories: string[] = [];
	let floors: number[] | null = null;
	let dir: string | null = null;
	let jsonPath: string | null = null;
	let reportPath: string | null = null;
	let aaSamplesPath: string | null = null;
	let channelsPath: string | null = null;
	let cacheDir: string | null = null;
	let model: string | null = null;
	let judgeModel: string | null = null;
	let backgroundModel: string | null = null;
	let seed = DEFAULT_R6_REPLAY_SEED;
	let budgetTokens: number | null = null;
	let maxTokens: number | null = null;
	let help = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (arg === "--help" || arg === "-h") {
			help = true;
			continue;
		}
		if (VALUE_ARGS[arg] !== true) throw new Error(`未知参数：${arg}`);
		const value = args[index + 1];
		if (value === undefined) throw new Error(`${arg} 需要一个值`);
		index += 1;
		if (arg === "--db") dbPath = value;
		else if (arg === "--story") stories.push(...requireList(value, arg));
		else if (arg === "--floors") {
			floors = requireList(value, arg).map((item) =>
				requirePositive(item, arg),
			);
		} else if (arg === "--dir") dir = value;
		else if (arg === "--json") jsonPath = value;
		else if (arg === "--report") reportPath = value;
		else if (arg === "--aa") aaSamplesPath = value;
		else if (arg === "--channels") channelsPath = value;
		else if (arg === "--cache") cacheDir = value;
		else if (arg === "--model") model = value;
		else if (arg === "--judge-model") judgeModel = value;
		else if (arg === "--background-model") backgroundModel = value;
		else if (arg === "--seed") seed = requireNonNegative(value, arg);
		else if (arg === "--budget") budgetTokens = requirePositive(value, arg);
		else maxTokens = requirePositive(value, arg);
	}
	return {
		dbPath,
		stories,
		floors,
		dir,
		jsonPath,
		reportPath,
		aaSamplesPath,
		channelsPath,
		cacheDir,
		model,
		judgeModel,
		backgroundModel,
		seed,
		budgetTokens,
		maxTokens,
		help,
	};
}

function requireList(value: string, label: string): string[] {
	const items = value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	if (items.length === 0) throw new Error(`${label} 需要一个非空值`);
	return items;
}

function requirePositive(value: string, label: string): number {
	if (!/^\d+$/.test(value) || Number(value) < 1) {
		throw new Error(`${label} 必须是不小于 1 的整数，收到 ${value}`);
	}
	return Number(value);
}

function requireNonNegative(value: string, label: string): number {
	if (!/^\d+$/.test(value)) {
		throw new Error(`${label} 必须是非负整数，收到 ${value}`);
	}
	return Number(value);
}

function safeSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(USAGE);
		return;
	}
	if (args.dbPath === null) throw new Error(`缺少 --db\n\n${USAGE}`);
	if (args.stories.length === 0) throw new Error(`缺少 --story\n\n${USAGE}`);
	if (args.floors !== null && args.stories.length !== 1) {
		throw new Error("--floors 只能和单个故事一起使用");
	}
	const segment = args.stories.map(safeSegment).join("-");
	const dir =
		args.dir ?? path.join(repoRoot, "eval-private", "reports", "r6", "replay");
	await runR6ReplayCli({
		dbPath: args.dbPath,
		stories: args.stories,
		floors: args.floors,
		dir,
		jsonPath: args.jsonPath ?? path.join(dir, `replay-${segment}.json`),
		reportPath: args.reportPath ?? path.join(dir, `replay-${segment}.md`),
		aaSamplesPath: args.aaSamplesPath ?? path.join(dir, "aa-samples.jsonl"),
		channelsPath:
			args.channelsPath ?? path.join(repoRoot, "data", "channels.yaml"),
		envPath: path.join(repoRoot, ".env"),
		cacheDir: args.cacheDir,
		model: args.model,
		judgeModel: args.judgeModel,
		backgroundModel: args.backgroundModel,
		seed: args.seed,
		budgetTokens: args.budgetTokens,
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
