import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type LlmChannelsConfig,
	type LlmStreamingClient,
	StoryStore,
	createEmbeddingClient,
	createLlmClient,
	createStandardChatSlots,
	loadChannelsConfig,
	loadDotEnv,
	resolveDefaultMaxTokens,
	resolveModelForRole,
	resolveStructuredOutputMode,
	resolveToolTransport,
} from "@dramaticer/core";
import { resolveStoryContextTemplate } from "../chat/session.js";
import { importBenchmark } from "./benchmark.js";
import {
	DEFAULT_DEEP_EVAL_BRANCHES,
	DEFAULT_DEEP_EVAL_TURNS,
	type DeepEvalRecord,
	parseDeepEvalJsonl,
	runDeepEval,
	serializeDeepEvalRecord,
	summarizeDeepEval,
} from "./deep-eval.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
export const DEFAULT_DEEP_EVAL_MODEL = "main-fallback";
export const DEFAULT_DEEP_EVAL_USER_MODEL = "background";
export const DEFAULT_DEEP_EVAL_STORY = "benchmark-mist-harbor";

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat deep-eval --db <path> --story <id> [选项]",
	"",
	"在固定合成卡上连续跑深回合，并在同一批分支点上做快/深盲评。",
	"逐条记录写进私有 JSONL；统计只输出数字。",
	"",
	"选项：",
	"  --db <path>        必填，数据库路径；不存在时新建",
	"  --benchmark <dir>  基准目录，默认仓库里的 benchmarks",
	`  --story <id>       基准故事，默认 ${DEFAULT_DEEP_EVAL_STORY}`,
	`  --turns <n>        深回合轮数，默认 ${DEFAULT_DEEP_EVAL_TURNS}`,
	`  --branches <n>     分支点数，默认 ${DEFAULT_DEEP_EVAL_BRANCHES}`,
	"  --profile <p>      对话档位 native 或 naive，默认 native",
	`  --model <m>        助手模型别名，默认 ${DEFAULT_DEEP_EVAL_MODEL}`,
	`  --user-model <m>   模拟用户模型别名，默认 ${DEFAULT_DEEP_EVAL_USER_MODEL}`,
	"  --judge-model <m>  裁判模型别名，默认按 roles.judge 解析",
	"  --seed <n>         模拟用户的写作提示种子，默认 1",
	"  --out <path>       私有 JSONL 路径，默认 eval-private/reports/R3b-deep.jsonl",
	"  --summary <path>   统计 JSON 路径，默认 eval-private/reports/R3b-deep.json",
	"  --resume           从已有记录之后继续，不删除已有文件",
	"  --summary-only     只从已有 JSONL 生成统计，不调用模型",
	"  --channels <path>  渠道配置，默认 data/channels.yaml",
	"  --help             显示本说明",
].join("\n");

interface ParsedArgs {
	readonly dbPath: string;
	readonly benchmarkDir: string;
	readonly storyId: string;
	readonly turns: number;
	readonly branches: number;
	readonly profile: "native" | "naive";
	readonly model: string;
	readonly userModel: string;
	readonly judgeModel: string | null;
	readonly seed: number;
	readonly outPath: string;
	readonly summaryPath: string;
	readonly resume: boolean;
	readonly summaryOnly: boolean;
	readonly channelsPath: string;
}

export interface DeepEvalCliDependencies {
	readonly envPath?: string;
	readonly channelsPath?: string;
	readonly loadEnv?: (filePath: string) => void;
	readonly loadConfig?: (filePath: string) => Promise<LlmChannelsConfig>;
	readonly createClient?: (
		config: LlmChannelsConfig,
		modelAlias: string,
	) => LlmStreamingClient;
	readonly now?: () => number;
	readonly log?: (message: string) => void;
}

export async function runDeepEvalCli(
	args: readonly string[],
	dependencies: DeepEvalCliDependencies = {},
): Promise<void> {
	const log = dependencies.log ?? console.log;
	if (args.includes("--help") || args.includes("-h")) {
		log(USAGE);
		return;
	}
	const parsed = parseDeepEvalArgs(args);
	const envPath = dependencies.envPath ?? path.join(repoRoot, ".env");
	const channelsPath =
		parsed.channelsPath.length === 0
			? (dependencies.channelsPath ??
				path.join(repoRoot, "data", "channels.yaml"))
			: parsed.channelsPath;
	if (!parsed.summaryOnly) {
		(dependencies.loadEnv ?? loadDotEnv)(envPath);
	}
	const config = await (dependencies.loadConfig ?? loadChannelsConfig)(
		channelsPath,
	);
	const assistantModel = config.models.get(parsed.model);
	if (assistantModel === undefined) {
		throw new Error(
			`没有模型 ${parsed.model}；可用模型：${[...config.models.keys()].join("、")}`,
		);
	}
	if (!config.models.has(parsed.userModel)) {
		throw new Error(
			`没有模拟用户模型 ${parsed.userModel}；可用模型：${[...config.models.keys()].join("、")}`,
		);
	}
	const judgeModel = parsed.judgeModel ?? resolveModelForRole(config, "judge");
	if (!config.models.has(judgeModel)) {
		throw new Error(
			`没有裁判模型 ${judgeModel}；可用模型：${[...config.models.keys()].join("、")}`,
		);
	}
	if (parsed.summaryOnly) {
		const records = existsSync(parsed.outPath)
			? parseDeepEvalJsonl(await readFile(parsed.outPath, "utf8"))
			: [];
		await writeSummary(parsed.summaryPath, records, log);
		return;
	}
	await mkdir(path.dirname(parsed.dbPath), { recursive: true });
	const embeddingConfig = config.embeddings.get("default");
	const embedder = embeddingConfig ? createEmbeddingClient(config) : null;
	const store = StoryStore.open(
		parsed.dbPath,
		embeddingConfig === undefined
			? {}
			: { embeddingDimensions: embeddingConfig.dimensions },
	);
	try {
		if (store.getStory(parsed.storyId) === null) {
			if (!existsSync(path.join(parsed.benchmarkDir, "manifest.json"))) {
				throw new Error(`基准目录不完整：${parsed.benchmarkDir}`);
			}
			const imported = await importBenchmark(store, {
				rootDir: parsed.benchmarkDir,
				storyIds: [parsed.storyId],
			});
			log(
				`已导入基准故事：${imported.stories.map((story) => `${story.storyId}（${story.nodeCount} 楼）`).join("、")}`,
			);
		}
		const settings = store.getStorySettings(parsed.storyId);
		const characterPrompt = settings.characterPrompt;
		if (characterPrompt === null || characterPrompt.trim().length === 0) {
			throw new Error(`故事 ${parsed.storyId} 没有角色提示词`);
		}
		const maxTokens = store.hasStorySettings(parsed.storyId)
			? settings.maxTokens
			: resolveDefaultMaxTokens(config, parsed.model);
		const budgetTokens = assistantModel.contextWindow - maxTokens;
		if (budgetTokens <= 0) {
			throw new Error(
				`模型的上下文窗口 ${assistantModel.contextWindow} 不大于输出上限 ${maxTokens}`,
			);
		}
		const mode = resolveStructuredOutputMode(assistantModel.probe);
		const template = resolveStoryContextTemplate(
			store,
			settings.templateId,
			mode,
		);
		const providers = (
			await createStandardChatSlots({
				store,
				characterPrompt,
				embedder,
				directorConfig: DEFAULT_DIRECTOR_CONFIG,
				historyBlockPolicy: settings.historyBlockPolicy,
				worldModel: settings.worldModel,
				directorOrganization: settings.directorOrganization,
			})
		).providers;
		const existing = parsed.resume
			? existsSync(parsed.outPath)
				? parseDeepEvalJsonl(await readFile(parsed.outPath, "utf8"))
				: []
			: [];
		await mkdir(path.dirname(parsed.outPath), { recursive: true });
		if (!parsed.resume) {
			await writeFile(parsed.outPath, "", "utf8");
		}
		const createClient =
			dependencies.createClient ??
			((channels: LlmChannelsConfig, alias: string) =>
				createLlmClient(channels, { defaultModel: alias, cacheDir: null }));
		log(
			`深回合评测：故事 ${parsed.storyId}，${parsed.turns} 轮深回合，${parsed.branches} 个分支点，助手 ${parsed.model}，模拟用户 ${parsed.userModel}，裁判 ${judgeModel}`,
		);
		const result = await runDeepEval({
			store,
			storyId: parsed.storyId,
			turns: parsed.turns,
			branches: parsed.branches,
			profile: parsed.profile,
			seed: parsed.seed,
			assistant: {
				client: createClient(config, parsed.model),
				model: parsed.model,
			},
			user: {
				client: createClient(config, parsed.userModel),
				model: parsed.userModel,
			},
			judge: {
				client: createClient(config, judgeModel),
				model: judgeModel,
			},
			turn: {
				template,
				providers,
				budgetTokens,
				structuredOutput: mode,
				toolTransport: resolveToolTransport(assistantModel),
				embedder,
				viewpoint: settings.viewpoint,
				maxTokens,
				temperature: settings.temperature,
				reasoning: settings.reasoning,
			},
			existing,
			onRecord: async (record) => {
				await appendFile(
					parsed.outPath,
					serializeDeepEvalRecord(record),
					"utf8",
				);
			},
			log,
			now: dependencies.now,
		});
		await writeSummary(parsed.summaryPath, result.records, log);
	} finally {
		store.close();
	}
}

async function writeSummary(
	summaryPath: string,
	records: readonly DeepEvalRecord[],
	log: (message: string) => void,
): Promise<void> {
	const summary = summarizeDeepEval(records);
	await mkdir(path.dirname(summaryPath), { recursive: true });
	await writeFile(
		summaryPath,
		`${JSON.stringify(summary, null, "\t")}\n`,
		"utf8",
	);
	log(
		`统计已写入 ${summaryPath}：深回合 ${summary.turns.completed} 成功 / ${summary.turns.failed} 失败，分支点深胜 ${summary.branches.deepWins}、快胜 ${summary.branches.fastWins}、平局 ${summary.branches.ties}、不一致 ${summary.branches.inconsistent}`,
	);
}

export function parseDeepEvalArgs(args: readonly string[]): ParsedArgs {
	const values = new Map<string, string>();
	const flags = new Set<string>();
	const valueKeys: Record<string, true> = {
		db: true,
		benchmark: true,
		story: true,
		turns: true,
		branches: true,
		profile: true,
		model: true,
		"user-model": true,
		"judge-model": true,
		seed: true,
		out: true,
		summary: true,
		channels: true,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (!arg.startsWith("--")) {
			throw new Error(`不认识的参数 ${arg}；${USAGE}`);
		}
		const key = arg.slice(2);
		if (key === "resume" || key === "summary-only") {
			if (flags.has(key)) throw new Error(`参数 --${key} 重复`);
			flags.add(key);
			continue;
		}
		if (!Object.hasOwn(valueKeys, key)) {
			throw new Error(`不认识的参数 --${key}；${USAGE}`);
		}
		if (values.has(key)) throw new Error(`参数 --${key} 重复`);
		const value = args[index + 1];
		if (value === undefined || value.startsWith("--")) {
			throw new Error(`--${key} 后面必须写值`);
		}
		values.set(key, value);
		index += 1;
	}
	const dbPath = requireValue(values, "db");
	const storyId = values.get("story") ?? DEFAULT_DEEP_EVAL_STORY;
	const profile = values.get("profile") ?? "native";
	const channels = values.get("channels");
	if (profile !== "native" && profile !== "naive") {
		throw new Error(`--profile 只接受 native 或 naive，收到 ${profile}`);
	}
	return {
		dbPath: path.resolve(repoRoot, dbPath),
		benchmarkDir: path.resolve(
			repoRoot,
			values.get("benchmark") ?? "benchmarks",
		),
		storyId,
		turns: parseInteger(
			values.get("turns") ?? String(DEFAULT_DEEP_EVAL_TURNS),
			"--turns",
			1,
		),
		branches: parseInteger(
			values.get("branches") ?? String(DEFAULT_DEEP_EVAL_BRANCHES),
			"--branches",
			0,
		),
		profile,
		model: values.get("model") ?? DEFAULT_DEEP_EVAL_MODEL,
		userModel: values.get("user-model") ?? DEFAULT_DEEP_EVAL_USER_MODEL,
		judgeModel: values.get("judge-model") ?? null,
		seed: parseInteger(values.get("seed") ?? "1", "--seed", 0),
		outPath: path.resolve(
			repoRoot,
			values.get("out") ?? "eval-private/reports/R3b-deep.jsonl",
		),
		summaryPath: path.resolve(
			repoRoot,
			values.get("summary") ?? "eval-private/reports/R3b-deep.json",
		),
		resume: flags.has("resume"),
		summaryOnly: flags.has("summary-only"),
		channelsPath:
			channels === undefined ? "" : path.resolve(repoRoot, channels),
	};
}

function requireValue(
	values: ReadonlyMap<string, string>,
	key: string,
): string {
	const value = values.get(key);
	if (value === undefined || value.trim().length === 0) {
		throw new Error(`缺少 --${key}；${USAGE}`);
	}
	return value;
}

function parseInteger(text: string, label: string, minimum: number): number {
	const value = Number(text);
	if (!Number.isInteger(value) || value < minimum) {
		throw new Error(`${label} 必须是不小于 ${minimum} 的整数，收到 ${text}`);
	}
	return value;
}

async function main(): Promise<void> {
	await runDeepEvalCli(process.argv.slice(2));
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
