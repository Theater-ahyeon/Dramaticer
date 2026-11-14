import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type LlmChannelsConfig,
	type LlmStreamingClient,
	StoryStore as StoryStoreClass,
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
	resolveDefaultMaxTokens,
	resolveModelForRole,
	resolveStructuredOutputMode,
	resolveToolTransport,
} from "@dramaticer/core";
import { resolveStoryContextTemplate } from "../chat/session.js";
import { readMemoryQuestionFile } from "./memory-questions.js";
import {
	DEFAULT_PROBE_COUNT,
	DEFAULT_REPETITIONS,
	DEFAULT_TIME_PROBE_COUNT,
	type WorldModelCompareReport,
	formatWorldModelCompareReport,
	runWorldModelCompare,
} from "./world-model-compare.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat world-model-compare --db <path> --story <id> --messages <path> [选项]",
	"",
	"在台账、实体档案与时序图谱三个候选上各跑固定轮数的自动试玩，比较矛盾率、编造回忆率、盲测胜率与每轮成本。",
	"",
	"选项：",
	"  --db <path>        必填，已经导入故事与卡的数据库",
	"  --story <id>       必填，数据库里的故事 id",
	"  --messages <path>  必填，JSON 数组，玩家每轮的发言",
	"  --rounds <n>       轮数，默认等于消息条数",
	"  --repeat <n>       每种候选的重复次数，默认 3",
	"  --questions <path> 记忆题文件（JSONL），所有候选共用",
	"  --dir <path>       运行目录，默认 eval-private/memory-cache/world-model-compare/<故事>",
	"  --json <path>      结果 JSON，默认 eval-private/reports/world-model-compare-<故事>.json",
	"  --report <path>    统计报告，默认 eval-private/reports/world-model-compare-<故事>.md",
	"  --model <alias>    写作模型，默认按 writer 角色解析",
	"  --judge-model <alias> 裁判模型，默认按 judge 角色解析",
	"  --channels <path>  渠道配置，默认 data/channels.yaml",
	"  --cache <path>     模型响应缓存目录，默认 <dir>/cache",
	"  --seed <n>         随机种子，默认 1",
	"  --probe-count <n>  召回探针数，默认 4",
	"  --time-probe-count <n> 时间点探针数，默认 2",
	"  --budget <n>       输入 token 预算，默认按模型上下文窗口与输出上限计算",
	"  --max-tokens <n>   输出上限，默认取故事设置或模型声明",
	"  --help             显示本说明",
].join("\n");

export interface WorldModelCompareCliOptions {
	readonly dbPath: string;
	readonly story: string;
	readonly messagesPath: string;
	readonly rounds: number | null;
	readonly repetitions: number;
	readonly questionsPath: string | null;
	readonly dir: string;
	readonly jsonPath: string;
	readonly reportPath: string;
	readonly channelsPath: string;
	readonly envPath: string;
	readonly cacheDir: string | null;
	readonly model: string | null;
	readonly judgeModel: string | null;
	readonly seed: number;
	readonly probeCount: number;
	readonly timeProbeCount: number;
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

export async function runWorldModelCompareCli(
	options: WorldModelCompareCliOptions,
): Promise<WorldModelCompareReport> {
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
	const writerModel = channels.models.get(writerAlias);
	if (writerModel === undefined) {
		throw new Error(
			`没有模型 ${writerAlias}；可用模型：${[...channels.models.keys()].join("、")}`,
		);
	}
	if (!channels.models.has(judgeAlias)) {
		throw new Error(
			`没有裁判模型 ${judgeAlias}；可用模型：${[...channels.models.keys()].join("、")}`,
		);
	}
	const messages = await readMessagesFile(options.messagesPath);
	const rounds = options.rounds ?? messages.length;
	if (rounds < 1 || rounds > messages.length) {
		throw new Error(
			`轮数 ${rounds} 必须在 1 到消息条数 ${messages.length} 之间`,
		);
	}
	const questions =
		options.questionsPath === null
			? []
			: await readMemoryQuestionFile(options.questionsPath);
	const cacheDir = options.cacheDir ?? path.join(options.dir, "cache");
	await mkdir(cacheDir, { recursive: true });
	const structuredOutput = resolveStructuredOutputMode(writerModel.probe);
	const sourceStore = StoryStoreClass.open(options.dbPath);
	const prepared = (() => {
		try {
			if (sourceStore.getStory(options.story) === null) {
				throw new Error(`故事不存在：${options.story}`);
			}
			const settings = sourceStore.getStorySettings(options.story);
			const template = resolveStoryContextTemplate(
				sourceStore,
				settings.templateId,
				structuredOutput,
			);
			const maxTokens =
				options.maxTokens ??
				(sourceStore.hasStorySettings(options.story)
					? settings.maxTokens
					: resolveDefaultMaxTokens(channels, writerAlias));
			const budgetTokens =
				options.budgetTokens ?? writerModel.contextWindow - maxTokens;
			if (budgetTokens <= 0) {
				throw new Error(
					`模型 ${writerAlias} 的上下文窗口 ${writerModel.contextWindow} 不大于输出上限 ${maxTokens}`,
				);
			}
			return { settings, template, maxTokens, budgetTokens };
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
	const judge = {
		client: createClient(channels, judgeAlias, cacheDir),
		model: judgeAlias,
	};
	log(
		`世界模型对比：故事 ${options.story}，轮数 ${rounds}，重复 ${options.repetitions}，写作 ${writerAlias}，裁判 ${judgeAlias}`,
	);
	const report = await runWorldModelCompare({
		sourceDbPath: options.dbPath,
		story: options.story,
		rounds,
		messages,
		repetitions: options.repetitions,
		dir: options.dir,
		writer,
		judge,
		template: prepared.template,
		budgetTokens: prepared.budgetTokens,
		structuredOutput,
		toolTransport: resolveToolTransport(writerModel),
		questions,
		maxTokens: prepared.maxTokens,
		temperature: prepared.settings.temperature,
		reasoning: prepared.settings.reasoning,
		probeCount: options.probeCount,
		timeProbeCount: options.timeProbeCount,
		seed: options.seed,
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
		`${formatWorldModelCompareReport(report)}\n`,
		"utf8",
	);
	log(`结果：${options.jsonPath}`);
	log(`报告：${options.reportPath}`);
	return report;
}

async function readMessagesFile(filePath: string): Promise<string[]> {
	const raw = await readFile(filePath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`${filePath} 不是合法的 JSON`);
	}
	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw new Error(`${filePath} 必须是非空数组`);
	}
	return parsed.map((value, index) => {
		if (typeof value !== "string" || value.trim().length === 0) {
			throw new Error(`${filePath} 的第 ${index + 1} 条消息必须是非空字符串`);
		}
		return value;
	});
}

interface CliArgs {
	readonly dbPath: string | null;
	readonly story: string | null;
	readonly messagesPath: string | null;
	readonly rounds: number | null;
	readonly repetitions: number;
	readonly questionsPath: string | null;
	readonly dir: string | null;
	readonly jsonPath: string | null;
	readonly reportPath: string | null;
	readonly channelsPath: string | null;
	readonly model: string | null;
	readonly judgeModel: string | null;
	readonly cacheDir: string | null;
	readonly seed: number;
	readonly probeCount: number;
	readonly timeProbeCount: number;
	readonly budgetTokens: number | null;
	readonly maxTokens: number | null;
	readonly help: boolean;
}

function parseArgs(args: readonly string[]): CliArgs {
	let dbPath: string | null = null;
	let story: string | null = null;
	let messagesPath: string | null = null;
	let rounds: number | null = null;
	let repetitions = DEFAULT_REPETITIONS;
	let questionsPath: string | null = null;
	let dir: string | null = null;
	let jsonPath: string | null = null;
	let reportPath: string | null = null;
	let channelsPath: string | null = null;
	let model: string | null = null;
	let judgeModel: string | null = null;
	let cacheDir: string | null = null;
	let seed = 1;
	let probeCount = DEFAULT_PROBE_COUNT;
	let timeProbeCount = DEFAULT_TIME_PROBE_COUNT;
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
			arg === "--messages" ||
			arg === "--rounds" ||
			arg === "--repeat" ||
			arg === "--questions" ||
			arg === "--dir" ||
			arg === "--json" ||
			arg === "--report" ||
			arg === "--channels" ||
			arg === "--model" ||
			arg === "--judge-model" ||
			arg === "--cache" ||
			arg === "--seed" ||
			arg === "--probe-count" ||
			arg === "--time-probe-count" ||
			arg === "--budget" ||
			arg === "--max-tokens"
		) {
			const value = args[index + 1];
			if (value === undefined) throw new Error(`${arg} 需要一个值`);
			index += 1;
			if (arg === "--db") dbPath = value;
			else if (arg === "--story") story = value;
			else if (arg === "--messages") messagesPath = value;
			else if (arg === "--rounds") rounds = requirePositive(value, arg);
			else if (arg === "--repeat") repetitions = requirePositive(value, arg);
			else if (arg === "--questions") questionsPath = value;
			else if (arg === "--dir") dir = value;
			else if (arg === "--json") jsonPath = value;
			else if (arg === "--report") reportPath = value;
			else if (arg === "--channels") channelsPath = value;
			else if (arg === "--model") model = value;
			else if (arg === "--judge-model") judgeModel = value;
			else if (arg === "--cache") cacheDir = value;
			else if (arg === "--seed") seed = requireNonNegative(value, arg);
			else if (arg === "--probe-count")
				probeCount = requireNonNegative(value, arg);
			else if (arg === "--time-probe-count")
				timeProbeCount = requireNonNegative(value, arg);
			else if (arg === "--budget") budgetTokens = requirePositive(value, arg);
			else maxTokens = requirePositive(value, arg);
			continue;
		}
		throw new Error(`未知参数：${arg}`);
	}
	return {
		dbPath,
		story,
		messagesPath,
		rounds,
		repetitions,
		questionsPath,
		dir,
		jsonPath,
		reportPath,
		channelsPath,
		model,
		judgeModel,
		cacheDir,
		seed,
		probeCount,
		timeProbeCount,
		budgetTokens,
		maxTokens,
		help,
	};
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
	if (args.story === null) throw new Error("缺少 --story");
	if (args.messagesPath === null) throw new Error("缺少 --messages");
	const segment = safeSegment(args.story);
	const dir =
		args.dir ??
		path.join(
			repoRoot,
			"eval-private",
			"memory-cache",
			"world-model-compare",
			segment,
		);
	await runWorldModelCompareCli({
		dbPath: args.dbPath,
		story: args.story,
		messagesPath: args.messagesPath,
		rounds: args.rounds,
		repetitions: args.repetitions,
		questionsPath: args.questionsPath,
		dir,
		jsonPath:
			args.jsonPath ??
			path.join(
				repoRoot,
				"eval-private",
				"reports",
				`world-model-compare-${segment}.json`,
			),
		reportPath:
			args.reportPath ??
			path.join(
				repoRoot,
				"eval-private",
				"reports",
				`world-model-compare-${segment}.md`,
			),
		channelsPath:
			args.channelsPath ?? path.join(repoRoot, "data", "channels.yaml"),
		envPath: path.join(repoRoot, ".env"),
		cacheDir: args.cacheDir,
		model: args.model,
		judgeModel: args.judgeModel,
		seed: args.seed,
		probeCount: args.probeCount,
		timeProbeCount: args.timeProbeCount,
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
