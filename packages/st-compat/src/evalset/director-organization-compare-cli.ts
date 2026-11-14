import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type DirectorBit,
	type LlmChannelsConfig,
	type LlmStreamingClient,
	StoryStore as StoryStoreClass,
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
	parseDirectorBitDefinitions,
	resolveDefaultMaxTokens,
	resolveModelForRole,
	resolveStructuredOutputMode,
	resolveToolTransport,
} from "@dramaticer/core";
import { resolveStoryContextTemplate } from "../chat/session.js";
import {
	type DirectorConditionSample,
	readDirectorConditionSampleFile,
} from "./condition-samples.js";
import {
	DEFAULT_REPETITIONS,
	type DirectorOrganizationCompareReport,
	formatDirectorOrganizationCompareReport,
	runDirectorOrganizationCompare,
} from "./director-organization-compare.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat director-organization-compare --db <path> --story <id> --messages <path> [选项]",
	"",
	"在现有机制序列与剧情小品引擎上各跑固定轮数的自动试玩，比较重复度、推进度、线索兑现率、盲测胜率与每轮成本。",
	"",
	"选项：",
	"  --db <path>        必填，已经导入故事与卡的数据库",
	"  --story <id>       必填，数据库里的故事 id",
	"  --messages <path>  必填，JSON 数组，玩家每轮的发言",
	"  --rounds <n>       轮数，默认等于消息条数",
	"  --repeat <n>       每种候选的重复次数，默认 3",
	"  --bits <path>      剧情小品 JSON 数组；不设置时使用源数据库里已有的小品",
	"  --conditions <path> 条件判断样本 JSON；不设置时跳过条件核对",
	"  --dir <path>       运行目录，默认 eval-private/memory-cache/director-organization-compare/<故事>",
	"  --json <path>      结果 JSON，默认 eval-private/reports/director-organization-compare-<故事>.json",
	"  --report <path>    统计报告，默认 eval-private/reports/director-organization-compare-<故事>.md",
	"  --model <alias>    写作模型，默认按 writer 角色解析",
	"  --judge-model <alias> 裁判模型，默认按 judge 角色解析",
	"  --background-model <alias> 条件判断模型，默认按 settler 角色解析",
	"  --channels <path>  渠道配置，默认 data/channels.yaml",
	"  --cache <path>     模型响应缓存目录，默认 <dir>/cache",
	"  --seed <n>         随机种子，默认 1",
	"  --budget <n>       输入 token 预算，默认按模型上下文窗口与输出上限计算",
	"  --max-tokens <n>   输出上限，默认取故事设置或模型声明",
	"  --help             显示本说明",
].join("\n");

export interface DirectorOrganizationCompareCliOptions {
	readonly dbPath: string;
	readonly story: string;
	readonly messagesPath: string;
	readonly rounds: number | null;
	readonly repetitions: number;
	readonly bitsPath: string | null;
	readonly conditionsPath: string | null;
	readonly dir: string;
	readonly jsonPath: string;
	readonly reportPath: string;
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

export async function runDirectorOrganizationCompareCli(
	options: DirectorOrganizationCompareCliOptions,
): Promise<DirectorOrganizationCompareReport> {
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
	const messages = await readMessagesFile(options.messagesPath);
	const rounds = options.rounds ?? messages.length;
	if (rounds < 1 || rounds > messages.length) {
		throw new Error(
			`轮数 ${rounds} 必须在 1 到消息条数 ${messages.length} 之间`,
		);
	}
	const bits =
		options.bitsPath === null ? null : await readBitsFile(options.bitsPath);
	const conditionSamples =
		options.conditionsPath === null
			? []
			: await readDirectorConditionSampleFile(options.conditionsPath);
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
				settings.contextLayout,
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
	const background = {
		client: createClient(channels, backgroundAlias, cacheDir),
		model: backgroundAlias,
	};
	log(
		`导演组织方式对比：故事 ${options.story}，轮数 ${rounds}，重复 ${options.repetitions}，写作 ${writerAlias}，裁判 ${judgeAlias}，条件判断 ${backgroundAlias}`,
	);
	const report = await runDirectorOrganizationCompare({
		sourceDbPath: options.dbPath,
		story: options.story,
		rounds,
		messages,
		repetitions: options.repetitions,
		dir: options.dir,
		writer,
		judge,
		background,
		template: prepared.template,
		budgetTokens: prepared.budgetTokens,
		structuredOutput,
		toolTransport: resolveToolTransport(writerModel),
		bits,
		conditionSamples,
		maxTokens: prepared.maxTokens,
		temperature: prepared.settings.temperature,
		reasoning: prepared.settings.reasoning,
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
		`${formatDirectorOrganizationCompareReport(report)}\n`,
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

async function readBitsFile(filePath: string): Promise<DirectorBit[]> {
	const raw = await readFile(filePath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`${filePath} 不是合法的 JSON`);
	}
	return parseDirectorBitDefinitions(parsed, filePath);
}

interface CliArgs {
	readonly dbPath: string | null;
	readonly story: string | null;
	readonly messagesPath: string | null;
	readonly rounds: number | null;
	readonly repetitions: number;
	readonly bitsPath: string | null;
	readonly conditionsPath: string | null;
	readonly dir: string | null;
	readonly jsonPath: string | null;
	readonly reportPath: string | null;
	readonly channelsPath: string | null;
	readonly model: string | null;
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
	let story: string | null = null;
	let messagesPath: string | null = null;
	let rounds: number | null = null;
	let repetitions = DEFAULT_REPETITIONS;
	let bitsPath: string | null = null;
	let conditionsPath: string | null = null;
	let dir: string | null = null;
	let jsonPath: string | null = null;
	let reportPath: string | null = null;
	let channelsPath: string | null = null;
	let model: string | null = null;
	let judgeModel: string | null = null;
	let backgroundModel: string | null = null;
	let cacheDir: string | null = null;
	let seed = 1;
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
			arg === "--bits" ||
			arg === "--conditions" ||
			arg === "--dir" ||
			arg === "--json" ||
			arg === "--report" ||
			arg === "--channels" ||
			arg === "--model" ||
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
			else if (arg === "--story") story = value;
			else if (arg === "--messages") messagesPath = value;
			else if (arg === "--rounds") rounds = requirePositive(value, arg);
			else if (arg === "--repeat") repetitions = requirePositive(value, arg);
			else if (arg === "--bits") bitsPath = value;
			else if (arg === "--conditions") conditionsPath = value;
			else if (arg === "--dir") dir = value;
			else if (arg === "--json") jsonPath = value;
			else if (arg === "--report") reportPath = value;
			else if (arg === "--channels") channelsPath = value;
			else if (arg === "--model") model = value;
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
		story,
		messagesPath,
		rounds,
		repetitions,
		bitsPath,
		conditionsPath,
		dir,
		jsonPath,
		reportPath,
		channelsPath,
		model,
		judgeModel,
		backgroundModel,
		cacheDir,
		seed,
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
			"director-organization-compare",
			segment,
		);
	await runDirectorOrganizationCompareCli({
		dbPath: args.dbPath,
		story: args.story,
		messagesPath: args.messagesPath,
		rounds: args.rounds,
		repetitions: args.repetitions,
		bitsPath: args.bitsPath,
		conditionsPath: args.conditionsPath,
		dir,
		jsonPath:
			args.jsonPath ??
			path.join(
				repoRoot,
				"eval-private",
				"reports",
				`director-organization-compare-${segment}.json`,
			),
		reportPath:
			args.reportPath ??
			path.join(
				repoRoot,
				"eval-private",
				"reports",
				`director-organization-compare-${segment}.md`,
			),
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
