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
import { type R6InstrumentGateInput, R6_GATE_VERSION } from "./gates.js";
import { R6_INSTRUMENT_FORMAT } from "./r6-instrument.js";
import {
	type TurnModeCompareReport,
	formatTurnModeCompareReport,
	runTurnModeCompare,
} from "./turn-mode-compare.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat turn-mode-compare --db <path> --story <id> --messages <path> --instrument <path> [选项]",
	"",
	"在同一批分支点与同一串玩家消息上分别跑快速、规划与深度，比较胜率、矛盾率、每楼调用数与等待时间。裁判必须先通过 G0 才会开始运行。",
	"",
	"选项：",
	"  --db <path>         必填，已经导入故事与卡的数据库",
	"  --story <id>        必填，数据库里的故事 id",
	"  --messages <path>   必填，JSON 数组，玩家每轮的发言",
	"  --instrument <path> 必填，r6-instrument 的 G0 结果；不通过时直接失败",
	"  --rounds <n>        轮数，默认等于消息条数",
	"  --repeat <n>        每种写法的重复次数，默认 1",
	"  --branch <floor>    只跑指定分支点楼层，可重复；默认取首、中、末三个",
	"  --dir <path>        运行目录，默认 eval-private/memory-cache/turn-mode-compare/<故事>",
	"  --json <path>       结果 JSON，默认 eval-private/reports/turn-mode-compare-<故事>.json",
	"  --report <path>     统计报告，默认 eval-private/reports/turn-mode-compare-<故事>.md",
	"  --model <alias>     写作模型，默认按 writer 角色解析",
	"  --judge-model <alias> 裁判模型，默认按 judge 角色解析",
	"  --channels <path>   渠道配置，默认 data/channels.yaml",
	"  --cache <path>      模型响应缓存目录，默认 <dir>/cache",
	"  --seed <n>          随机种子，默认 1",
	"  --budget <n>        输入 token 预算，默认按模型上下文窗口与输出上限计算",
	"  --max-tokens <n>    输出上限，默认取故事设置或模型声明",
	"  --help              显示本说明",
].join("\n");

export interface TurnModeCompareCliOptions {
	readonly dbPath: string;
	readonly story: string;
	readonly messagesPath: string;
	readonly instrumentPath: string;
	readonly rounds: number | null;
	readonly repetitions: number;
	readonly branchFloors: readonly number[];
	readonly dir: string;
	readonly jsonPath: string;
	readonly reportPath: string;
	readonly channelsPath: string;
	readonly envPath: string;
	readonly cacheDir: string | null;
	readonly model: string | null;
	readonly judgeModel: string | null;
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

export async function runTurnModeCompareCli(
	options: TurnModeCompareCliOptions,
): Promise<TurnModeCompareReport> {
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
			`没有模型 ${judgeAlias}；可用模型：${[...channels.models.keys()].join("、")}`,
		);
	}
	const messages = await readMessagesFile(options.messagesPath);
	const rounds = options.rounds ?? messages.length;
	if (rounds < 1 || rounds > messages.length) {
		throw new Error(
			`轮数 ${rounds} 必须在 1 到消息条数 ${messages.length} 之间`,
		);
	}
	const instrument = await readInstrumentInput(options.instrumentPath);
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
	log(
		`写法对照：故事 ${options.story}，轮数 ${rounds}，重复 ${options.repetitions}，写作 ${writerAlias}，裁判 ${judgeAlias}`,
	);
	const report = await runTurnModeCompare({
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
		instrument,
		branchFloors:
			options.branchFloors.length === 0 ? undefined : options.branchFloors,
		toolTransport: resolveToolTransport(writerModel),
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
		`${formatTurnModeCompareReport(report)}\n`,
		"utf8",
	);
	log(`结果：${options.jsonPath}`);
	log(`报告：${options.reportPath}`);
	return report;
}

async function readInstrumentInput(
	filePath: string,
): Promise<R6InstrumentGateInput> {
	let value: unknown;
	try {
		value = JSON.parse(await readFile(filePath, "utf8"));
	} catch (error) {
		throw new Error(
			`${filePath} 不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${filePath} 必须是 JSON 对象`);
	}
	const record = value as Record<string, unknown>;
	if (record.format !== R6_INSTRUMENT_FORMAT) {
		throw new Error(
			`${filePath} 的 format 是 ${String(record.format)}，应为 ${R6_INSTRUMENT_FORMAT}`,
		);
	}
	if (record.gateVersion !== R6_GATE_VERSION) {
		throw new Error(
			`${filePath} 的门槛版本是 ${String(record.gateVersion)}，当前是 ${R6_GATE_VERSION}`,
		);
	}
	const gateInput = isObject(record.gateInput)
		? record.gateInput
		: isObject(record.summary) && isObject(record.summary.gateInput)
			? record.summary.gateInput
			: null;
	if (gateInput === null) {
		throw new Error(`${filePath} 里没有 G0 的 gateInput`);
	}
	return gateInput as unknown as R6InstrumentGateInput;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
	readonly instrumentPath: string | null;
	readonly rounds: number | null;
	readonly repetitions: number;
	readonly branchFloors: readonly number[];
	readonly dir: string | null;
	readonly jsonPath: string | null;
	readonly reportPath: string | null;
	readonly channelsPath: string | null;
	readonly model: string | null;
	readonly judgeModel: string | null;
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
	let instrumentPath: string | null = null;
	let rounds: number | null = null;
	let repetitions = 1;
	const branchFloors: number[] = [];
	let dir: string | null = null;
	let jsonPath: string | null = null;
	let reportPath: string | null = null;
	let channelsPath: string | null = null;
	let model: string | null = null;
	let judgeModel: string | null = null;
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
			arg === "--instrument" ||
			arg === "--rounds" ||
			arg === "--repeat" ||
			arg === "--branch" ||
			arg === "--dir" ||
			arg === "--json" ||
			arg === "--report" ||
			arg === "--channels" ||
			arg === "--model" ||
			arg === "--judge-model" ||
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
			else if (arg === "--instrument") instrumentPath = value;
			else if (arg === "--rounds") rounds = requirePositive(value, arg);
			else if (arg === "--repeat") repetitions = requirePositive(value, arg);
			else if (arg === "--branch")
				branchFloors.push(requirePositive(value, arg));
			else if (arg === "--dir") dir = value;
			else if (arg === "--json") jsonPath = value;
			else if (arg === "--report") reportPath = value;
			else if (arg === "--channels") channelsPath = value;
			else if (arg === "--model") model = value;
			else if (arg === "--judge-model") judgeModel = value;
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
		instrumentPath,
		rounds,
		repetitions,
		branchFloors,
		dir,
		jsonPath,
		reportPath,
		channelsPath,
		model,
		judgeModel,
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
	if (args.instrumentPath === null) throw new Error("缺少 --instrument");
	const segment = safeSegment(args.story);
	const dir =
		args.dir ??
		path.join(
			repoRoot,
			"eval-private",
			"memory-cache",
			"turn-mode-compare",
			segment,
		);
	await runTurnModeCompareCli({
		dbPath: args.dbPath,
		story: args.story,
		messagesPath: args.messagesPath,
		instrumentPath: args.instrumentPath,
		rounds: args.rounds,
		repetitions: args.repetitions,
		branchFloors: args.branchFloors,
		dir,
		jsonPath:
			args.jsonPath ??
			path.join(
				repoRoot,
				"eval-private",
				"reports",
				`turn-mode-compare-${segment}.json`,
			),
		reportPath:
			args.reportPath ??
			path.join(
				repoRoot,
				"eval-private",
				"reports",
				`turn-mode-compare-${segment}.md`,
			),
		channelsPath:
			args.channelsPath ?? path.join(repoRoot, "data", "channels.yaml"),
		envPath: path.join(repoRoot, ".env"),
		cacheDir: args.cacheDir,
		model: args.model,
		judgeModel: args.judgeModel,
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
