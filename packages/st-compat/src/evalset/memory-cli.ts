import { mkdir, rm, writeFile } from "node:fs/promises";
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
	resolveModelForRole,
} from "@dramaticer/core";
import { createCachedEmbeddingClient } from "./memory-cache.js";
import { type MemoryEvalReport, collectMemoryEval } from "./memory-eval.js";
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
	/** 测试注入；不提供时从渠道配置创建 */
	readonly embedder?: EmbeddingClient | null;
	readonly eventClient?: LlmStreamingClient | null;
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
				cacheDir: path.join(options.cacheDir, "llm"),
			});
		}
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
			viewpoint: options.viewpoint ?? null,
			generatedAt: options.generatedAt,
			log,
		});
		await writeFile(
			options.privateReportPath,
			renderPrivateMemoryReport(report),
			"utf8",
		);
		await writeFile(
			options.publicReportPath,
			renderPublicMemoryReport(report),
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
	readonly viewpoint: string | null;
	readonly dbPath: string | null;
}

function parseArgs(args: readonly string[]): CliArgs {
	let buildEvents = false;
	let viewpoint: string | null = null;
	let dbPath: string | null = null;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--events") {
			buildEvents = true;
			continue;
		}
		if (arg === "--viewpoint") {
			const value = args[index + 1];
			if (value === undefined || value.length === 0) {
				throw new Error("--viewpoint 需要非空的视角名称");
			}
			viewpoint = value;
			index += 1;
			continue;
		}
		if (arg === "--db") {
			const value = args[index + 1];
			if (value === undefined || value.length === 0) {
				throw new Error("--db 需要数据库路径");
			}
			dbPath = value;
			index += 1;
			continue;
		}
		throw new Error(`未知参数：${arg}`);
	}
	return { buildEvents, viewpoint, dbPath };
}

async function main(): Promise<void> {
	const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
	const parsed = parseArgs(process.argv.slice(2));
	const cacheDir = path.join(repoRoot, "eval-private", "memory-cache");
	await runMemoryEvalCli({
		rawRoot: path.join(repoRoot, "eval-private", "raw"),
		evalsetRoot: path.join(repoRoot, "eval-private", "evalset"),
		channelsPath: path.join(repoRoot, "data", "channels.yaml"),
		envPath: path.join(repoRoot, ".env"),
		dbPath: parsed.dbPath ?? path.join(cacheDir, "tmp", "memory-eval.db"),
		cacheDir,
		privateReportPath: path.join(
			repoRoot,
			"eval-private",
			"reports",
			"m2-retrieval.md",
		),
		publicReportPath: path.join(
			repoRoot,
			"docs",
			"dev",
			"reports",
			"M2-retrieval.md",
		),
		buildEvents: parsed.buildEvents,
		viewpoint: parsed.viewpoint,
	});
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
