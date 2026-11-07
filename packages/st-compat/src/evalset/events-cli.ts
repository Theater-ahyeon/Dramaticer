import { mkdir, rm } from "node:fs/promises";
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
import {
	type EventsBackfillResult,
	runEventsBackfill,
} from "./events-backfill.js";
import { createCachedEmbeddingClient } from "./memory-cache.js";

export interface EventsBackfillCliOptions {
	readonly rawRoot: string;
	readonly dbPath: string;
	/** 事件抽取的模型响应缓存目录。 */
	readonly eventsCacheDir: string;
	readonly embeddingsCacheDir: string;
	readonly channelsPath: string;
	readonly envPath: string;
	readonly story?: string | null;
	readonly maxWindows?: number | null;
	/** 保留已有数据库接着跑；为 false 时先删除数据库从头导入。 */
	readonly resume: boolean;
	readonly log?: (message: string) => void;
	/** 测试注入；不提供时按渠道配置创建。 */
	readonly createEventClient?: (
		cacheDir: string,
	) => Promise<LlmStreamingClient>;
	readonly createEmbedder?: (cacheDir: string) => Promise<EmbeddingClient>;
}

export async function runEventsBackfillCli(
	options: EventsBackfillCliOptions,
): Promise<EventsBackfillResult> {
	const log = options.log ?? ((message: string) => console.log(message));
	let config: LlmChannelsConfig | null = null;
	const loadConfig = async (): Promise<LlmChannelsConfig> => {
		if (config !== null) return config;
		loadDotEnv(options.envPath);
		config = await loadChannelsConfig(options.channelsPath);
		return config;
	};

	const createEventClient =
		options.createEventClient ??
		(async (cacheDir: string) => {
			const channels = await loadConfig();
			return createLlmClient(channels, {
				defaultModel: resolveModelForRole(channels, "settler"),
				cacheDir,
			});
		});
	const createEmbedder =
		options.createEmbedder ??
		(async (cacheDir: string) => {
			const channels = await loadConfig();
			const provider = channels.embeddings.get("default");
			if (provider === undefined) {
				throw new Error(
					"channels.yaml 没有配置 embeddings.default，无法生成向量",
				);
			}
			return createCachedEmbeddingClient({
				inner: createEmbeddingClient(channels),
				cacheDir,
				label: `${provider.model}@${provider.dimensions}`,
			});
		});

	if (!options.resume) {
		await removeDatabase(options.dbPath);
	}
	const eventClient = await createEventClient(options.eventsCacheDir);
	const embedder = await createEmbedder(options.embeddingsCacheDir);
	const result = await runEventsBackfill({
		rawRoot: options.rawRoot,
		dbPath: options.dbPath,
		client: eventClient,
		embedder,
		story: options.story ?? null,
		maxWindows: options.maxWindows ?? null,
		log,
		onProgress: (progress) => {
			log(
				`${progress.story} 窗口 ${progress.window}：${progress.floors} 个楼层，累计 ${progress.totalFloors} 个楼层、${progress.events} 条事件，模型请求 ${progress.requests}（缓存命中 ${progress.cachedRequests}）`,
			);
		},
	});
	for (const story of result.stories) {
		log(
			`${story.story}${story.imported ? "（新导入）" : "（沿用已有导入）"}：${story.floorCount} 个楼层，${story.chunkCount} 个块，${story.vectorCount} 个向量，${story.entityCount} 个实体，${story.eventCount} 条事件，${story.windowCount} 个窗口`,
		);
	}
	log(
		`本批完成：${result.stories.length} 个故事，${result.windowCount} 个窗口，${result.extractedFloors} 个楼层，${result.eventCount} 条事件，模型请求 ${result.requests}（缓存命中 ${result.cachedRequests}）${result.stoppedEarly ? "，已到窗口上限" : ""}`,
	);
	log(`数据库：${options.dbPath}`);
	return result;
}

async function removeDatabase(dbPath: string): Promise<void> {
	await mkdir(path.dirname(dbPath), { recursive: true });
	await rm(dbPath, { force: true });
	await rm(`${dbPath}-wal`, { force: true });
	await rm(`${dbPath}-shm`, { force: true });
}

interface CliArgs {
	readonly story: string | null;
	readonly maxWindows: number | null;
	readonly resume: boolean;
	readonly dbPath: string | null;
	readonly help: boolean;
}

function parseArgs(args: readonly string[]): CliArgs {
	let story: string | null = null;
	let maxWindows: number | null = null;
	let resume = false;
	let dbPath: string | null = null;
	let help = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--resume") {
			resume = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			help = true;
			continue;
		}
		if (arg === "--story" || arg === "--limit" || arg === "--db") {
			const value = args[index + 1];
			if (value === undefined) throw new Error(`${arg} 需要一个值`);
			index += 1;
			if (arg === "--story") story = value;
			else if (arg === "--db") dbPath = value;
			else maxWindows = requirePositiveInteger(value, "--limit");
			continue;
		}
		throw new Error(`未知参数：${arg}`);
	}
	return { story, maxWindows, resume, dbPath, help };
}

function requirePositiveInteger(value: string, label: string): number {
	if (!/^\d+$/.test(value)) {
		throw new Error(`${label} 必须是不小于 1 的整数，收到 ${value}`);
	}
	const parsed = Number(value);
	if (parsed < 1) {
		throw new Error(`${label} 必须是不小于 1 的整数，收到 ${value}`);
	}
	return parsed;
}

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat events-backfill [选项]",
	"",
	"把 legacy 评测对话导入评测数据库，补齐实体、lore、块向量，然后按路径窗口批量抽取事件。",
	"",
	"选项：",
	"  --story <id>     只处理一个故事",
	"  --limit <n>      本次运行最多处理 n 个窗口（跨故事累计）",
	"  --resume         保留已有数据库，跳过已导入的故事与已抽取的窗口",
	"  --db <path>      数据库路径，默认 eval-private/memory-cache/eval.db",
	"  --help           显示本说明",
].join("\n");

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(USAGE);
		return;
	}
	const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
	const cacheRoot = path.join(repoRoot, "eval-private", "memory-cache");
	await runEventsBackfillCli({
		rawRoot: path.join(repoRoot, "eval-private", "raw"),
		dbPath: args.dbPath ?? path.join(cacheRoot, "eval.db"),
		eventsCacheDir: path.join(cacheRoot, "events"),
		embeddingsCacheDir: path.join(cacheRoot, "embeddings"),
		channelsPath: path.join(repoRoot, "data", "channels.yaml"),
		envPath: path.join(repoRoot, ".env"),
		story: args.story,
		maxWindows: args.maxWindows,
		resume: args.resume,
	});
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
