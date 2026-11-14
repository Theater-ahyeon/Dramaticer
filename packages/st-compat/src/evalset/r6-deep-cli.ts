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
	DEFAULT_R6_DEEP_SEED,
	type R6DeepReport,
	formatR6DeepReport,
	runR6Deep,
} from "./r6-deep.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat r6-deep --db <path> --story <id>[,<id>] [选项]",
	"",
	"每个故事复制一份源数据库并预热 12 楼，跑 20 轮深回合；在 8 个分支点的同一玩家楼层再生成一次快回合，两种展示顺序各判一次，汇总成 G5 的判定输入。",
	"",
	"选项：",
	"  --db <path>        必填，已经导入故事与卡的数据库",
	"  --story <id>       必填，故事 id；多个用逗号分隔或重复传入",
	"  --dir <path>       运行目录，默认 eval-private/reports/r6/deep",
	"  --json <path>      结果 JSON，默认 eval-private/reports/r6/deep.json",
	"  --report <path>    报告，默认 eval-private/reports/r6/deep.md",
	"  --rounds <n>       每个故事的深回合轮数，默认 20",
	"  --branches <n>     每个故事的分支点数，默认 8",
	"  --model <alias>    写作模型，默认按 writer 角色解析",
	"  --user-model <alias> 模拟用户模型，默认 background",
	"  --judge-model <alias> 裁判模型，默认按 judge 角色解析",
	"  --background-model <alias> 预热后台模型，默认按 settler 角色解析",
	"  --channels <path>  渠道配置，默认 data/channels.yaml",
	"  --cache <path>     模型响应缓存目录，默认 <dir>/cache",
	"  --seed <n>         随机种子，默认 1",
	"  --budget <n>       输入 token 预算，默认按模型上下文窗口与输出上限计算",
	"  --max-tokens <n>   输出上限，默认取故事设置或模型声明",
	"  --help             显示本说明",
].join("\n");

export interface R6DeepCliOptions {
	readonly dbPath: string;
	readonly stories: readonly string[];
	readonly dir: string;
	readonly jsonPath: string;
	readonly reportPath: string;
	readonly channelsPath: string;
	readonly envPath: string;
	readonly cacheDir: string | null;
	readonly rounds: number;
	readonly branches: number;
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

export async function runR6DeepCli(
	options: R6DeepCliOptions,
): Promise<R6DeepReport> {
	const log = options.log ?? ((message: string) => console.log(message));
	if (!existsSync(options.dbPath)) {
		throw new Error(`数据库不存在：${options.dbPath}`);
	}
	(options.loadEnv ?? loadDotEnv)(options.envPath);
	const channels = await (options.loadConfig ?? loadChannelsConfig)(
		options.channelsPath,
	);
	const writerAlias = options.model ?? resolveModelForRole(channels, "writer");
	const userAlias = options.userModel ?? "background";
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
	const report = await runR6Deep({
		sourceDbPath: options.dbPath,
		stories: options.stories,
		rounds: options.rounds,
		branches: options.branches,
		dir: options.dir,
		writer: {
			client: createClient(channels, writerAlias, cacheDir),
			model: writerAlias,
		},
		user: {
			client: createClient(channels, userAlias, cacheDir),
			model: userAlias,
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
		log,
	});
	log(
		`R6 深回合：写作 ${writerAlias}、用户 ${userAlias}、裁判 ${judgeAlias}；计划 ${report.summary.plannedPairs} 对，完成 ${report.summary.completedPairs}`,
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
		`${formatR6DeepReport(report)}\n`,
		"utf8",
	);
	log(`结果：${options.jsonPath}`);
	log(`报告：${options.reportPath}`);
	return report;
}

interface CliArgs {
	readonly dbPath: string | null;
	readonly stories: readonly string[];
	readonly dir: string | null;
	readonly jsonPath: string | null;
	readonly reportPath: string | null;
	readonly channelsPath: string | null;
	readonly cacheDir: string | null;
	readonly rounds: number;
	readonly branches: number;
	readonly model: string | null;
	readonly userModel: string | null;
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
	"--dir": true,
	"--json": true,
	"--report": true,
	"--rounds": true,
	"--branches": true,
	"--model": true,
	"--user-model": true,
	"--judge-model": true,
	"--background-model": true,
	"--channels": true,
	"--cache": true,
	"--seed": true,
	"--budget": true,
	"--max-tokens": true,
};

export function parseR6DeepArgs(args: readonly string[]): CliArgs {
	let dbPath: string | null = null;
	const stories: string[] = [];
	let dir: string | null = null;
	let jsonPath: string | null = null;
	let reportPath: string | null = null;
	let channelsPath: string | null = null;
	let cacheDir: string | null = null;
	let rounds = 20;
	let branches = 8;
	let model: string | null = null;
	let userModel: string | null = null;
	let judgeModel: string | null = null;
	let backgroundModel: string | null = null;
	let seed = DEFAULT_R6_DEEP_SEED;
	let budgetTokens: number | null = null;
	let maxTokens: number | null = null;
	let help = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (arg === "--help" || arg === "-h") {
			help = true;
			continue;
		}
		if (!arg.startsWith("--")) {
			throw new Error(`不认识的参数 ${arg}；${USAGE}`);
		}
		const key = arg.slice(2);
		const flag = `--${key}`;
		if (!Object.hasOwn(VALUE_ARGS, flag)) {
			throw new Error(`不认识的参数 ${flag}；${USAGE}`);
		}
		const value = args[index + 1];
		if (value === undefined || value.startsWith("--")) {
			throw new Error(`${flag} 后面必须写值`);
		}
		index += 1;
		switch (key) {
			case "db":
				dbPath = value;
				break;
			case "story":
				for (const item of value.split(",")) {
					const id = item.trim();
					if (id.length > 0) stories.push(id);
				}
				break;
			case "dir":
				dir = value;
				break;
			case "json":
				jsonPath = value;
				break;
			case "report":
				reportPath = value;
				break;
			case "channels":
				channelsPath = value;
				break;
			case "cache":
				cacheDir = value;
				break;
			case "rounds":
				rounds = parseInteger(value, "--rounds", 1);
				break;
			case "branches":
				branches = parseInteger(value, "--branches", 1);
				break;
			case "model":
				model = value;
				break;
			case "user-model":
				userModel = value;
				break;
			case "judge-model":
				judgeModel = value;
				break;
			case "background-model":
				backgroundModel = value;
				break;
			case "seed":
				seed = parseInteger(value, "--seed", 0);
				break;
			case "budget":
				budgetTokens = parseInteger(value, "--budget", 1);
				break;
			case "max-tokens":
				maxTokens = parseInteger(value, "--max-tokens", 1);
				break;
			default:
				throw new Error(`不认识的参数 ${flag}；${USAGE}`);
		}
	}
	if (help) {
		return {
			dbPath,
			stories,
			dir,
			jsonPath,
			reportPath,
			channelsPath,
			cacheDir,
			rounds,
			branches,
			model,
			userModel,
			judgeModel,
			backgroundModel,
			seed,
			budgetTokens,
			maxTokens,
			help,
		};
	}
	if (dbPath === null || dbPath.trim().length === 0) {
		throw new Error(`缺少 --db\n${USAGE}`);
	}
	if (stories.length === 0) {
		throw new Error(`缺少 --story\n${USAGE}`);
	}
	return {
		dbPath: path.resolve(repoRoot, dbPath),
		stories,
		dir: path.resolve(repoRoot, dir ?? "eval-private/reports/r6/deep"),
		jsonPath: path.resolve(
			repoRoot,
			jsonPath ?? "eval-private/reports/r6/deep.json",
		),
		reportPath: path.resolve(
			repoRoot,
			reportPath ?? "eval-private/reports/r6/deep.md",
		),
		channelsPath: path.resolve(repoRoot, channelsPath ?? "data/channels.yaml"),
		cacheDir: cacheDir === null ? null : path.resolve(repoRoot, cacheDir),
		rounds,
		branches,
		model,
		userModel,
		judgeModel,
		backgroundModel,
		seed,
		budgetTokens,
		maxTokens,
		help,
	};
}

function parseInteger(text: string, label: string, minimum: number): number {
	const value = Number(text);
	if (!Number.isInteger(value) || value < minimum) {
		throw new Error(`${label} 必须是不小于 ${minimum} 的整数，收到 ${text}`);
	}
	return value;
}

async function main(): Promise<void> {
	const parsed = parseR6DeepArgs(process.argv.slice(2));
	if (parsed.help) {
		console.log(USAGE);
		return;
	}
	await runR6DeepCli({
		...parsed,
		dbPath: parsed.dbPath as string,
		dir: parsed.dir as string,
		jsonPath: parsed.jsonPath as string,
		reportPath: parsed.reportPath as string,
		channelsPath: parsed.channelsPath as string,
		envPath: path.join(repoRoot, ".env"),
	});
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
