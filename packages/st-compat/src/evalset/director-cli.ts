import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type EmbeddingClient,
	type LlmChannelsConfig,
	type LlmStreamingClient,
	createEmbeddingClient,
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
	resolveStructuredOutputMode,
} from "@dramaticer/core";
import {
	type DirectorEvalReport,
	collectDirectorEval,
} from "./director-eval.js";
import {
	renderPrivateDirectorReport,
	renderPublicDirectorReport,
} from "./director-report.js";
import { createCachedEmbeddingClient } from "./memory-cache.js";

export interface DirectorEvalCliOptions {
	readonly rawRoot: string;
	readonly channelsPath: string;
	readonly envPath: string;
	readonly workDir: string;
	/** embedding 与模型回复缓存目录，默认工作目录的上两级。 */
	readonly cacheDir?: string;
	readonly embeddingLabel?: string;
	readonly privateReportPath: string;
	readonly publicReportPath: string;
	readonly modelAlias?: string;
	readonly interval?: number;
	readonly rounds?: number;
	readonly pairs?: number;
	readonly maxBranchPointsPerStory?: number;
	readonly generatedAt?: string;
	readonly log?: (message: string) => void;
	/** 测试注入；不提供时从渠道配置创建。 */
	readonly embedder?: EmbeddingClient;
	readonly client?: LlmStreamingClient;
	readonly loadEnv?: (envPath: string) => void;
	readonly loadConfig?: (channelsPath: string) => Promise<LlmChannelsConfig>;
}

export interface DirectorEvalCliResult {
	readonly report: DirectorEvalReport;
	readonly privateReportPath: string;
	readonly publicReportPath: string;
}

export async function runDirectorEvalCli(
	options: DirectorEvalCliOptions,
): Promise<DirectorEvalCliResult> {
	const log = options.log ?? ((message: string) => console.log(message));
	const modelAlias = options.modelAlias ?? "main";
	let embedder = options.embedder;
	let client = options.client;
	let structuredOutput: "text-tags" | "function-call" = "text-tags";
	let budgetTokens = 32_768;
	let embeddingLabel: string | null = null;
	if (embedder === undefined || client === undefined) {
		const loadEnv = options.loadEnv ?? loadDotEnv;
		const loadConfig = options.loadConfig ?? loadChannelsConfig;
		loadEnv(options.envPath);
		const config = await loadConfig(options.channelsPath);
		const model = config.models.get(modelAlias);
		if (model === undefined) {
			throw new Error(
				`渠道配置里没有模型 ${modelAlias}；可用模型：${[...config.models.keys()].join("、")}`,
			);
		}
		structuredOutput = resolveStructuredOutputMode(model.probe);
		budgetTokens = model.contextWindow - model.maxTokens;
		if (budgetTokens <= 0) {
			throw new Error(
				`模型的上下文窗口 ${model.contextWindow} 不大于输出上限 ${model.maxTokens}`,
			);
		}
		if (embedder === undefined) {
			const provider = config.embeddings.get("default");
			if (provider === undefined) {
				throw new Error(
					"channels.yaml 没有配置 embeddings.default，无法计算节拍余弦",
				);
			}
			embeddingLabel = `${provider.model}@${provider.dimensions}`;
			const cacheDir =
				options.cacheDir ?? path.resolve(options.workDir, "..", "..");
			embedder = createCachedEmbeddingClient({
				inner: createEmbeddingClient(config),
				cacheDir: path.join(cacheDir, "embeddings"),
				label: embeddingLabel,
				onProgress: (progress) => {
					if (progress.done % 2048 === 0 || progress.done === progress.total) {
						log(
							`embedding ${progress.done}/${progress.total}，命中缓存 ${progress.cached}`,
						);
					}
				},
			});
		}
		if (client === undefined) {
			// 每一对都必须是独立生成；缓存会让同一分支点的多次运行得到同一份回复。
			client = createLlmClient(config, {
				defaultModel: modelAlias,
				cacheDir: null,
			});
		}
	}
	await mkdir(path.dirname(options.privateReportPath), { recursive: true });
	await mkdir(path.dirname(options.publicReportPath), { recursive: true });
	const report = await collectDirectorEval({
		rawRoot: options.rawRoot,
		workDir: options.workDir,
		embedder,
		embeddingLabel: embeddingLabel ?? options.embeddingLabel ?? "未提供",
		client,
		modelAlias,
		structuredOutput,
		budgetTokens,
		interval: options.interval,
		rounds: options.rounds,
		pairs: options.pairs,
		maxBranchPointsPerStory: options.maxBranchPointsPerStory,
		generatedAt: options.generatedAt,
		log,
	});
	await writeFile(
		options.privateReportPath,
		renderPrivateDirectorReport(report),
		"utf8",
	);
	await writeFile(
		options.publicReportPath,
		renderPublicDirectorReport(report),
		"utf8",
	);
	log(
		`对比评测完成：成功 ${report.runs.length} 次，失败 ${report.failures.length} 次。`,
	);
	log(
		`开启：Jaccard ${report.aggregate.on.jaccard.mean.toFixed(4)}、余弦 ${report.aggregate.on.cosine.mean.toFixed(4)}、兑现 ${report.aggregate.on.notesFulfilled}/${report.aggregate.on.notesCreated}。`,
	);
	log(
		`关闭：Jaccard ${report.aggregate.off.jaccard.mean.toFixed(4)}、余弦 ${report.aggregate.off.cosine.mean.toFixed(4)}、兑现 ${report.aggregate.off.notesFulfilled}/${report.aggregate.off.notesCreated}。`,
	);
	log(`私有报告：${options.privateReportPath}`);
	log(`统计报告：${options.publicReportPath}`);
	return {
		report,
		privateReportPath: options.privateReportPath,
		publicReportPath: options.publicReportPath,
	};
}

interface CliArgs {
	readonly model: string | null;
	readonly interval: number | null;
	readonly rounds: number | null;
	readonly pairs: number | null;
	readonly maxBranchPoints: number | null;
}

function parseArgs(args: readonly string[]): CliArgs {
	let model: string | null = null;
	let interval: number | null = null;
	let rounds: number | null = null;
	let pairs: number | null = null;
	let maxBranchPoints: number | null = null;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--model") {
			const value = args[index + 1];
			if (value === undefined || value.trim().length === 0) {
				throw new Error("--model 需要非空的模型别名");
			}
			model = value;
			index += 1;
			continue;
		}
		if (arg === "--interval") {
			interval = positiveInteger(args[index + 1], "--interval");
			index += 1;
			continue;
		}
		if (arg === "--rounds") {
			rounds = positiveInteger(args[index + 1], "--rounds");
			index += 1;
			continue;
		}
		if (arg === "--pairs") {
			pairs = positiveInteger(args[index + 1], "--pairs");
			index += 1;
			continue;
		}
		if (arg === "--max-points") {
			maxBranchPoints = positiveInteger(args[index + 1], "--max-points");
			index += 1;
			continue;
		}
		throw new Error(`未知参数：${arg}`);
	}
	return { model, interval, rounds, pairs, maxBranchPoints };
}

function positiveInteger(value: string | undefined, label: string): number {
	if (value === undefined) throw new Error(`${label} 需要一个正整数`);
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${label} 必须是不小于 1 的整数`);
	}
	return parsed;
}

async function main(): Promise<void> {
	const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
	const parsed = parseArgs(process.argv.slice(2));
	const cacheDir = path.join(repoRoot, "eval-private", "memory-cache");
	await runDirectorEvalCli({
		rawRoot: path.join(repoRoot, "eval-private", "raw"),
		channelsPath: path.join(repoRoot, "data", "channels.yaml"),
		envPath: path.join(repoRoot, ".env"),
		workDir: path.join(cacheDir, "tmp", "director-eval"),
		cacheDir,
		privateReportPath: path.join(
			repoRoot,
			"eval-private",
			"reports",
			"m3-director.md",
		),
		publicReportPath: path.join(
			repoRoot,
			"docs",
			"dev",
			"reports",
			"M3-director.md",
		),
		modelAlias: parsed.model ?? "main",
		interval: parsed.interval ?? undefined,
		rounds: parsed.rounds ?? undefined,
		pairs: parsed.pairs ?? undefined,
		maxBranchPointsPerStory: parsed.maxBranchPoints ?? undefined,
	});
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
