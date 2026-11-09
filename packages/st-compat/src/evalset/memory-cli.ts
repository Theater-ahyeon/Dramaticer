import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type EmbeddingClient,
	type LlmChannelsConfig,
	type LlmStreamingClient,
	OpenAiRerankClient,
	type RerankClient,
	createEmbeddingClient,
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
	resolveModelForRole,
} from "@dramaticer/core";
import { createCachedEmbeddingClient } from "./memory-cache.js";
import {
	type JudgedMemoryEvalOptions,
	type MemoryEvalReport,
	collectMemoryEval,
} from "./memory-eval.js";
import {
	renderPrivateMemoryReport,
	renderPublicMemoryReport,
} from "./memory-report.js";

export interface MemoryEvalCliOptions {
	readonly rawRoot: string;
	readonly evalsetRoot: string;
	readonly channelsPath: string;
	readonly envPath: string;
	readonly dbPath: string;
	readonly cacheDir: string;
	readonly privateReportPath: string;
	readonly publicReportPath: string;
	readonly buildEvents?: boolean;
	readonly viewpoint?: string | null;
	readonly generatedAt?: string;
	readonly log?: (message: string) => void;
	/** 设置后运行五类记忆题与编造回忆判分；测试可以注入客户端 */
	readonly judged?: JudgedMemoryEvalOptions | null;
	/** 从渠道配置按 writer 与 judge 角色创建判分客户端 */
	readonly judgedEnabled?: boolean;
	/** 测试注入；不提供时从渠道配置创建 */
	readonly embedder?: EmbeddingClient | null;
	readonly eventClient?: LlmStreamingClient | null;
	/** 测试注入的重排序客户端；显式 null 表示不评测重排序 */
	readonly reranker?: RerankClient | null;
	/** 从渠道配置创建重排序客户端，即使配置里的 enabled 为 false */
	readonly rerankEnabled?: boolean;
	/** 报告标题；默认沿用 M2 报告标题 */
	readonly title?: string;
	readonly loadEnv?: (envPath: string) => void;
	readonly loadConfig?: (channelsPath: string) => Promise<LlmChannelsConfig>;
}

export interface MemoryEvalCliResult {
	readonly report: MemoryEvalReport;
	readonly privateReportPath: string;
	readonly publicReportPath: string;
}

export async function runMemoryEvalCli(
	options: MemoryEvalCliOptions,
): Promise<MemoryEvalCliResult> {
	const log = options.log ?? ((message: string) => console.log(message));
	let config: LlmChannelsConfig | null = null;
	const loadConfig = async (): Promise<LlmChannelsConfig> => {
		if (config !== null) return config;
		const loadEnv = options.loadEnv ?? loadDotEnv;
		const load = options.loadConfig ?? loadChannelsConfig;
		loadEnv(options.envPath);
		config = await load(options.channelsPath);
		return config;
	};

	let embedder: EmbeddingClient | null = null;
	let embeddingLabel: string | null = null;
	if (options.embedder === undefined) {
		const channels = await loadConfig();
		const provider = channels.embeddings.get("default");
		if (provider === undefined) {
			throw new Error(
				"channels.yaml 没有配置 embeddings.default，无法生成向量",
			);
		}
		const inner = createEmbeddingClient(channels);
		embeddingLabel = `${provider.model}@${provider.dimensions}`;
		embedder = createCachedEmbeddingClient({
			inner,
			cacheDir: path.join(options.cacheDir, "embeddings"),
			label: embeddingLabel,
			onProgress: (progress) => {
				if (progress.done % 1024 === 0 || progress.done === progress.total) {
					log(
						`embedding ${progress.done}/${progress.total}，命中缓存 ${progress.cached}`,
					);
				}
			},
		});
	} else {
		embedder = options.embedder;
	}

	let eventClient: LlmStreamingClient | null = null;
	if (options.buildEvents) {
		if (options.eventClient !== undefined) {
			eventClient = options.eventClient;
		} else {
			const channels = await loadConfig();
			eventClient = createLlmClient(channels, {
				defaultModel: resolveModelForRole(channels, "settler"),
				cacheDir: path.join(options.cacheDir, "events"),
			});
		}
	}

	let reranker: RerankClient | null = options.reranker ?? null;
	if (options.reranker === undefined && options.rerankEnabled === true) {
		const channels = await loadConfig();
		const section = channels.reranker;
		if (section === null) {
			throw new Error("channels.yaml 没有配置 reranker，无法评测重排序");
		}
		reranker = new OpenAiRerankClient(section);
	}

	let judged = options.judged ?? null;
	if (judged === null && options.judgedEnabled === true) {
		const channels = await loadConfig();
		const answerModel = resolveModelForRole(channels, "writer");
		const judgeModel = resolveModelForRole(channels, "judge");
		judged = {
			answer: {
				client: createLlmClient(channels, {
					defaultModel: answerModel,
					cacheDir: path.join(options.cacheDir, "judged-answer"),
				}),
				model: answerModel,
			},
			judge: {
				client: createLlmClient(channels, {
					defaultModel: judgeModel,
					cacheDir: path.join(options.cacheDir, "judged"),
				}),
				model: judgeModel,
			},
		};
	}

	await mkdir(path.dirname(options.dbPath), { recursive: true });
	await mkdir(path.dirname(options.privateReportPath), { recursive: true });
	await mkdir(path.dirname(options.publicReportPath), { recursive: true });
	try {
		const report = await collectMemoryEval({
			rawRoot: options.rawRoot,
			evalsetRoot: options.evalsetRoot,
			dbPath: options.dbPath,
			embedder,
			embeddingLabel,
			eventClient,
			judged,
			reranker,
			viewpoint: options.viewpoint ?? null,
			generatedAt: options.generatedAt,
			log,
		});
		await writeFile(
			options.privateReportPath,
			renderPrivateMemoryReport(report, options.title),
			"utf8",
		);
		await writeFile(
			options.publicReportPath,
			renderPublicMemoryReport(report, options.title),
			"utf8",
		);
		log(
			`记忆评测完成：${report.total.questionCount} 道题，融合命中@5 ${report.total.hitAt5}，命中@10 ${report.total.hitAt10}，命中@20 ${report.total.hitAt20}。`,
		);
		for (const threshold of report.thresholds) {
			log(
				`${threshold.passed ? "通过" : "未通过"}：${threshold.label}（${threshold.hits}/${threshold.questionCount}）`,
			);
		}
		log(`私有报告：${options.privateReportPath}`);
		log(`统计报告：${options.publicReportPath}`);
		return {
			report,
			privateReportPath: options.privateReportPath,
			publicReportPath: options.publicReportPath,
		};
	} finally {
		await rm(options.dbPath, { force: true });
		await rm(`${options.dbPath}-wal`, { force: true });
		await rm(`${options.dbPath}-shm`, { force: true });
	}
}

interface CliArgs {
	readonly buildEvents: boolean;
	readonly judged: boolean;
	readonly rerank: boolean;
	readonly viewpoint: string | null;
	readonly dbPath: string | null;
	readonly privateReportPath: string | null;
	readonly publicReportPath: string | null;
	readonly title: string | null;
}

function parseArgs(args: readonly string[]): CliArgs {
	let buildEvents = false;
	let judged = false;
	let rerank = false;
	let viewpoint: string | null = null;
	let dbPath: string | null = null;
	let privateReportPath: string | null = null;
	let publicReportPath: string | null = null;
	let title: string | null = null;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--events") {
			buildEvents = true;
			continue;
		}
		if (arg === "--judged") {
			judged = true;
			continue;
		}
		if (arg === "--rerank") {
			rerank = true;
			continue;
		}
		if (
			arg === "--viewpoint" ||
			arg === "--db" ||
			arg === "--private-report" ||
			arg === "--public-report" ||
			arg === "--title"
		) {
			const value = args[index + 1];
			if (value === undefined || value.length === 0) {
				throw new Error(`${arg} 需要一个非空值`);
			}
			index += 1;
			if (arg === "--viewpoint") viewpoint = value;
			else if (arg === "--db") dbPath = value;
			else if (arg === "--private-report") privateReportPath = value;
			else if (arg === "--public-report") publicReportPath = value;
			else title = value;
			continue;
		}
		throw new Error(`未知参数：${arg}`);
	}
	return {
		buildEvents,
		judged,
		rerank,
		viewpoint,
		dbPath,
		privateReportPath,
		publicReportPath,
		title,
	};
}

async function main(): Promise<void> {
	const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
	const parsed = parseArgs(process.argv.slice(2));
	const cacheDir = path.join(repoRoot, "eval-private", "memory-cache");
	const resolve = (value: string | null): string | null =>
		value === null ? null : path.resolve(repoRoot, value);
	await runMemoryEvalCli({
		rawRoot: path.join(repoRoot, "eval-private", "raw"),
		evalsetRoot: path.join(repoRoot, "eval-private", "evalset"),
		channelsPath: path.join(repoRoot, "data", "channels.yaml"),
		envPath: path.join(repoRoot, ".env"),
		dbPath:
			resolve(parsed.dbPath) ?? path.join(cacheDir, "tmp", "memory-eval.db"),
		cacheDir,
		privateReportPath:
			resolve(parsed.privateReportPath) ??
			path.join(repoRoot, "eval-private", "reports", "m2-retrieval.md"),
		publicReportPath:
			resolve(parsed.publicReportPath) ??
			path.join(repoRoot, "docs", "dev", "reports", "M2-retrieval.md"),
		buildEvents: parsed.buildEvents,
		judgedEnabled: parsed.judged,
		rerankEnabled: parsed.rerank,
		viewpoint: parsed.viewpoint,
		title: parsed.title ?? undefined,
	});
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
