import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../env.js";
import {
	type LlmChannelsConfig,
	loadChannelsConfig,
	resolveModelForRole,
} from "../llm/channels.js";
import { createLlmClient } from "../llm/configure.js";
import {
	type EmbeddingClient,
	createEmbeddingClient,
} from "../llm/embeddings.js";
import type { LlmClient } from "../llm/types.js";
import { DEFAULT_EMBEDDING_DIMENSIONS } from "../store/migrations.js";
import { StoryStore } from "../store/story-store.js";
import { type GapWorkBacklog, readGapWorkBacklog } from "./backlog.js";
import {
	createDefaultBackgroundJobRegistry,
	resolveStoryBackgroundKinds,
} from "./defaults.js";
import {
	type BackgroundJobRun,
	DEFAULT_BACKGROUND_JOB_LIMIT,
	drainBackgroundJobs,
} from "./drain.js";
import type { BackgroundJobCounts, BackgroundJobRegistry } from "./types.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE =
	"用法：dramaticer work --db <path> [--limit <n>] [--kind <kind>] [--gap-seconds <n>]（--limit 是每个故事本轮最多执行的任务数；--gap-seconds 是上一轮落定到现在的秒数，不给时按会话结束处理）";

export interface WorkCliDependencies {
	readonly envPath?: string;
	readonly channelsPath?: string;
	readonly loadEnv?: (filePath: string) => void;
	readonly loadConfig?: (filePath: string) => Promise<LlmChannelsConfig>;
	readonly createClient?: (config: LlmChannelsConfig) => LlmClient;
	readonly createEmbedder?: (config: LlmChannelsConfig) => EmbeddingClient;
	readonly registry?: BackgroundJobRegistry;
	readonly now?: () => number;
	readonly log?: (message: string) => void;
}

export interface WorkCliResult {
	readonly dbPath: string;
	readonly stories: number;
	readonly enqueued: number;
	readonly discarded: number;
	readonly gapBacklog: GapWorkBacklog;
	readonly runs: readonly BackgroundJobRun[];
}

/** `dramaticer work`：执行一轮后台任务后退出。 */
export async function runWorkCli(
	args: readonly string[],
	dependencies: WorkCliDependencies = {},
): Promise<WorkCliResult> {
	const parsed = parseWorkArgs(args);
	const envPath = dependencies.envPath ?? path.join(repoRoot, ".env");
	const channelsPath =
		dependencies.channelsPath ?? path.join(repoRoot, "data", "channels.yaml");
	const loadEnv = dependencies.loadEnv ?? loadDotEnv;
	const loadConfig = dependencies.loadConfig ?? loadChannelsConfig;
	const createClient =
		dependencies.createClient ??
		((config: LlmChannelsConfig) =>
			createLlmClient(config, {
				defaultModel: resolveModelForRole(config, "settler"),
				cacheDir: null,
			}));
	const log = dependencies.log ?? console.log;

	if (!existsSync(parsed.dbPath)) {
		throw new Error(`数据库不存在：${parsed.dbPath}`);
	}
	loadEnv(envPath);
	const config = await loadConfig(channelsPath);
	resolveModelForRole(config, "settler");
	const client = createClient(config);
	const embeddingConfig = config.embeddings.get("default");
	const embedder = embeddingConfig
		? (dependencies.createEmbedder ?? createEmbeddingClient)(config)
		: null;
	const registry: BackgroundJobRegistry =
		dependencies.registry ?? createDefaultBackgroundJobRegistry({ embedder });

	const store = StoryStore.open(parsed.dbPath, {
		embeddingDimensions:
			embeddingConfig?.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS,
	});
	try {
		const stories = store.listStories();
		const runs: BackgroundJobRun[] = [];
		const backlog = {
			pending: 0,
			running: 0,
			done: 0,
			failed: 0,
			discarded: 0,
		};
		let enqueued = 0;
		let discarded = 0;
		for (const story of stories) {
			const kinds = resolveStoryBackgroundKinds(registry, {
				gapPassEnabled: store.getStorySettings(story.id).gapPassEnabled,
				requested: parsed.kind,
			});
			if (kinds.length === 0) continue;
			const result = await drainBackgroundJobs({
				store,
				registry,
				client,
				storyId: story.id,
				kinds,
				limit: parsed.limit ?? DEFAULT_BACKGROUND_JOB_LIMIT,
				gapSeconds: parsed.gapSeconds ?? 0,
				sessionEnded: parsed.gapSeconds === null,
				now: dependencies.now,
			});
			enqueued += result.enqueued;
			discarded += result.discarded;
			runs.push(...result.runs);
			const gapKinds = kinds.filter(
				(kind) => registry.get(kind)?.tier === "gap",
			);
			if (gapKinds.length === 0) continue;
			const storyBacklog = readGapWorkBacklog(store, story.id, gapKinds);
			backlog.pending += storyBacklog.counts.pending;
			backlog.running += storyBacklog.counts.running;
			backlog.done += storyBacklog.counts.done;
			backlog.failed += storyBacklog.counts.failed;
			backlog.discarded += storyBacklog.counts.discarded;
		}
		const done = runs.filter((run) => run.status === "done").length;
		const retrying = runs.filter((run) => run.status === "pending").length;
		const failed = runs.filter((run) => run.status === "failed").length;
		log(
			`后台任务：故事 ${stories.length} 个，新增任务 ${enqueued} 条，执行 ${runs.length} 条（完成 ${done}，待重试 ${retrying}，失败 ${failed}，丢弃 ${discarded}）`,
		);
		const unfinished = backlog.pending + backlog.running;
		const total = unfinished + backlog.done + backlog.failed;
		const gapBacklog: GapWorkBacklog = {
			counts: backlog satisfies BackgroundJobCounts,
			unfinishedRatio: total === 0 ? 0 : unfinished / total,
		};
		log(
			`关键间隙工作：待办 ${backlog.pending}，进行中 ${backlog.running}，完成 ${backlog.done}，失败 ${backlog.failed}，未完成率 ${(gapBacklog.unfinishedRatio * 100).toFixed(1)}%`,
		);
		for (const run of runs) {
			if (run.status === "failed") {
				log(
					`失败：${run.kind} ${formatRunNode(run.nodeId)}（第 ${run.attempts} 次）：${run.error}`,
				);
			}
		}
		return {
			dbPath: parsed.dbPath,
			stories: stories.length,
			enqueued,
			discarded,
			gapBacklog,
			runs,
		};
	} finally {
		store.close();
	}
}

function formatRunNode(nodeId: string | null): string {
	return nodeId === null ? "故事级任务" : `楼层 ${nodeId}`;
}

interface WorkArgs {
	readonly dbPath: string;
	readonly limit: number | null;
	readonly kind: string | null;
	readonly gapSeconds: number | null;
}

function parseWorkArgs(args: readonly string[]): WorkArgs {
	if (args[0] !== "work") throw new Error(USAGE);
	const allowed: Readonly<Record<string, true>> = {
		db: true,
		limit: true,
		kind: true,
		"gap-seconds": true,
	};
	const values = new Map<string, string>();
	for (let index = 1; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (!arg.startsWith("--")) {
			throw new Error(`多余的参数 ${arg}；${USAGE}`);
		}
		const equals = arg.indexOf("=");
		const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
		if (allowed[key] !== true) {
			throw new Error(`不认识的参数 --${key}；${USAGE}`);
		}
		if (values.has(key)) {
			throw new Error(`参数 --${key} 重复；${USAGE}`);
		}
		const value = equals === -1 ? args[index + 1] : arg.slice(equals + 1);
		if (equals === -1) index += 1;
		if (value === undefined) {
			throw new Error(`--${key} 后面必须写值；${USAGE}`);
		}
		values.set(key, value);
	}
	const dbPath = values.get("db");
	if (dbPath === undefined || dbPath.trim().length === 0) {
		throw new Error(`--db 必须是非空路径；${USAGE}`);
	}
	const limit = values.get("limit");
	const parsedLimit = limit === undefined ? null : Number(limit);
	if (
		parsedLimit !== null &&
		(!Number.isInteger(parsedLimit) || parsedLimit < 1)
	) {
		throw new Error(`--limit 必须是不小于 1 的整数；${USAGE}`);
	}
	const kind = values.get("kind");
	if (kind !== undefined && (kind.length === 0 || kind !== kind.trim())) {
		throw new Error(`--kind 必须是非空字符串；${USAGE}`);
	}
	const gapSeconds = values.get("gap-seconds");
	const parsedGapSeconds = gapSeconds === undefined ? null : Number(gapSeconds);
	if (
		parsedGapSeconds !== null &&
		(!Number.isFinite(parsedGapSeconds) || parsedGapSeconds < 0)
	) {
		throw new Error(`--gap-seconds 必须是非负数字；${USAGE}`);
	}
	return {
		dbPath,
		limit: parsedLimit,
		kind: kind ?? null,
		gapSeconds: parsedGapSeconds,
	};
}
