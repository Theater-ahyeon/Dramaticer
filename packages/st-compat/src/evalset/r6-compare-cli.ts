import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type LlmChannelsConfig,
	type LlmStreamingClient,
	StoryStore as StoryStoreClass,
	createDefaultBackgroundJobRegistry,
	createEmbeddingClient,
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
	resolveDefaultMaxTokens,
	resolveModelForRole,
	resolveStructuredOutputMode,
	resolveToolTransport,
} from "@dramaticer/core";
import { R6_C1_ROUNDS } from "./gates.js";
import {
	DEFAULT_R6_COMPARE_SEED,
	type R6CompareReport,
	formatR6CompareReport,
	runR6Compare,
} from "./r6-compare.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat r6-compare --db <path> --story <id>[,<id>] [选项]",
	"",
	"按路径深度取分支点，每个分支点复制两份数据库：原生档先跑并写模拟用户消息，朴素档逐字重放；报告给出重复度、推进度、成本、时延与失败。",
	"",
	"选项：",
	"  --db <path>        必填，已经导入故事与卡的数据库",
	"  --story <id>       必填，故事 id；多个用逗号分隔或重复传入",
	"  --rounds <n>       每个分支点每个档位的轮数，默认 30",
	"  --branches <楼层>  只跑指定的分支点楼层，逗号分隔；只能配一个故事，用于缩样",
	"  --dir <path>       运行目录，默认 eval-private/reports/r6/runs/<故事>",
	"  --json <path>      结果 JSON，默认 eval-private/reports/r6/compare-<故事>.json",
	"  --report <path>    统计报告，默认 eval-private/reports/r6/compare-<故事>.md",
	"  --model <alias>    写作模型，默认按 writer 角色解析",
	"  --user-model <alias> 模拟用户模型，默认按 settler 角色解析",
	"  --judge-model <alias> 裁判模型，默认按 judge 角色解析",
	"  --background-model <alias> 后台任务模型，默认按 settler 角色解析",
	"  --channels <path>  渠道配置，默认 data/channels.yaml",
	"  --cache <path>     模型响应缓存目录，默认 <dir>/cache",
	"  --seed <n>         随机种子，默认 1",
	"  --budget <n>       输入 token 预算，默认按模型上下文窗口与输出上限计算",
	"  --max-tokens <n>   输出上限，默认取故事设置或模型声明",
	"  --help             显示本说明",
].join("\n");

export interface R6CompareCliOptions {
	readonly dbPath: string;
	readonly stories: readonly string[];
	readonly rounds: number;
	readonly branchFloors: readonly number[] | null;
	readonly dir: string;
	readonly jsonPath: string;
	readonly reportPath: string;
	readonly channelsPath: string;
	readonly envPath: string;
	readonly cacheDir: string | null;
	readonly model: string | null;
	readonly userModel: string | null;
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

export async function runR6CompareCli(
	options: R6CompareCliOptions,
): Promise<R6CompareReport> {
	const log = options.log ?? ((message: string) => console.log(message));
	if (!existsSync(options.dbPath)) {
		throw new Error(`数据库不存在：${options.dbPath}`);
	}
	(options.loadEnv ?? loadDotEnv)(options.envPath);
	const channels = await (options.loadConfig ?? loadChannelsConfig)(
		options.channelsPath,
	);
	const writerAlias = options.model ?? resolveModelForRole(channels, "writer");
	const userAlias =
		options.userModel ?? resolveModelForRole(channels, "settler");
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
	for (const alias of [userAlias, judgeAlias, backgroundAlias]) {
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
	const writer = {
		client: createClient(channels, writerAlias, cacheDir),
		model: writerAlias,
	};
	const user = {
		client: createClient(channels, userAlias, cacheDir),
		model: userAlias,
	};
	const judge = {
		client: createClient(channels, judgeAlias, cacheDir),
		model: judgeAlias,
	};
	const background = {
		client: createClient(channels, backgroundAlias, cacheDir),
		registry: createDefaultBackgroundJobRegistry({ embedder }),
	};
	log(
		`R6 原生与朴素对比：故事 ${options.stories.join("、")}，轮数 ${options.rounds}，写作 ${writerAlias}，模拟用户 ${userAlias}，裁判 ${judgeAlias}，后台 ${backgroundAlias}`,
	);
	const report = await runR6Compare({
		sourceDbPath: options.dbPath,
		stories: options.stories,
		rounds: options.rounds,
		dir: options.dir,
		writer,
		user,
		judge,
		background,
		structuredOutput,
		budgetTokens: prepared.budgetTokens,
		toolTransport: resolveToolTransport(writerModel),
		embedder,
		maxTokens: prepared.maxTokens,
		temperature: prepared.temperature,
		reasoning: prepared.reasoning,
		seed: options.seed,
		branchFloors: options.branchFloors ?? undefined,
		log,
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
		`${formatR6CompareReport(report)}\n`,
		"utf8",
	);
	log(`结果：${options.jsonPath}`);
	log(`报告：${options.reportPath}`);
	return report;
}

interface CliArgs {
	readonly dbPath: string | null;
	readonly stories: readonly string[];
	readonly rounds: number;
	readonly branchFloors: readonly number[] | null;
	readonly dir: string | null;
	readonly jsonPath: string | null;
	readonly reportPath: string | null;
	readonly channelsPath: string | null;
	readonly model: string | null;
	readonly userModel: string | null;
	readonly judgeModel: string | null;
	readonly backgroundModel: string | null;
	readonly cacheDir: string | null;
	readonly seed: number;
	readonly budgetTokens: number | null;
	readonly maxTokens: number | null;
	readonly help: boolean;
}

function parseArgs(args: readonly string[]): CliArgs {
	let dbPath: string | null = null;
	const stories: string[] = [];
	let rounds = R6_C1_ROUNDS;
	let branchFloors: number[] | null = null;
	let dir: string | null = null;
	let jsonPath: string | null = null;
	let reportPath: string | null = null;
	let channelsPath: string | null = null;
	let model: string | null = null;
	let userModel: string | null = null;
	let judgeModel: string | null = null;
	let backgroundModel: string | null = null;
	let cacheDir: string | null = null;
	let seed = DEFAULT_R6_COMPARE_SEED;
	let budgetTokens: number | null = null;
	let maxTokens: number | null = null;
	let help = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") {
			help = true;
			continue;
		}
		if (
			arg === "--db" ||
			arg === "--story" ||
			arg === "--rounds" ||
			arg === "--branches" ||
			arg === "--dir" ||
			arg === "--json" ||
			arg === "--report" ||
			arg === "--channels" ||
			arg === "--model" ||
			arg === "--user-model" ||
			arg === "--judge-model" ||
			arg === "--background-model" ||
			arg === "--cache" ||
			arg === "--seed" ||
			arg === "--budget" ||
			arg === "--max-tokens"
		) {
			const value = args[index + 1];
			if (value === undefined) throw new Error(`${arg} 需要一个值`);
			index += 1;
			if (arg === "--db") dbPath = value;
			else if (arg === "--story") stories.push(...requireList(value, arg));
			else if (arg === "--rounds") rounds = requirePositive(value, arg);
			else if (arg === "--branches") {
				branchFloors = requireList(value, arg).map((item) =>
					requirePositive(item, arg),
				);
			} else if (arg === "--dir") dir = value;
			else if (arg === "--json") jsonPath = value;
			else if (arg === "--report") reportPath = value;
			else if (arg === "--channels") channelsPath = value;
			else if (arg === "--model") model = value;
			else if (arg === "--user-model") userModel = value;
			else if (arg === "--judge-model") judgeModel = value;
			else if (arg === "--background-model") backgroundModel = value;
			else if (arg === "--cache") cacheDir = value;
			else if (arg === "--seed") seed = requireNonNegative(value, arg);
			else if (arg === "--budget") budgetTokens = requirePositive(value, arg);
			else maxTokens = requirePositive(value, arg);
			continue;
		}
		throw new Error(`未知参数：${arg}`);
	}
	return {
		dbPath,
		stories,
		rounds,
		branchFloors,
		dir,
		jsonPath,
		reportPath,
		channelsPath,
		model,
		userModel,
		judgeModel,
		backgroundModel,
		cacheDir,
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
	if (!/^\d+$/.test(value)) {
		throw new Error(`${label} 必须是不小于 1 的整数，收到 ${value}`);
	}
	const parsed = Number(value);
	if (parsed < 1) {
		throw new Error(`${label} 必须是不小于 1 的整数，收到 ${value}`);
	}
	return parsed;
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
	if (args.dbPath === null) throw new Error("缺少 --db");
	if (args.stories.length === 0) throw new Error("缺少 --story");
	if (args.branchFloors !== null && args.stories.length !== 1) {
		throw new Error("--branches 只能和单个故事一起使用");
	}
	const segment = args.stories.map(safeSegment).join("-");
	const reportsDir = path.join(repoRoot, "eval-private", "reports", "r6");
	const dir = args.dir ?? path.join(reportsDir, "runs", segment);
	await runR6CompareCli({
		dbPath: args.dbPath,
		stories: args.stories,
		rounds: args.rounds,
		branchFloors: args.branchFloors,
		dir,
		jsonPath: args.jsonPath ?? path.join(reportsDir, `compare-${segment}.json`),
		reportPath:
			args.reportPath ?? path.join(reportsDir, `compare-${segment}.md`),
		channelsPath:
			args.channelsPath ?? path.join(repoRoot, "data", "channels.yaml"),
		envPath: path.join(repoRoot, ".env"),
		cacheDir: args.cacheDir,
		model: args.model,
		userModel: args.userModel,
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
