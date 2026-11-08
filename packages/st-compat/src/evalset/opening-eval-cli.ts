import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type LlmChannelsConfig,
	type LlmStreamingClient,
	OPENING_JOB_KIND,
	StoryStore,
	createBackgroundJobRegistry,
	createLlmClient,
	createOpeningHandler,
	drainBackgroundJobs,
	enqueueMissingJobs,
	generateOpeningCandidates,
	loadChannelsConfig,
	loadDotEnv,
	openingPackNeedsRun,
	resolveModelForRole,
} from "@dramaticer/core";
import {
	type StCharacterCard,
	parseCharacterCardFile,
} from "../character-card.js";
import { importCardContent } from "../chat/session.js";
import {
	DEFAULT_OPENING_EVAL_ROUNDS,
	type OpeningEvalCandidateMeta,
	type OpeningEvalInput,
	type OpeningEvalManifest,
	type OpeningEvalRunInput,
	type OpeningEvalRunMeta,
	type OpeningEvalSummary,
	chooseOpeningCandidate,
	renderOpeningEvalReport,
	summarizeOpeningEval,
} from "./opening-eval.js";
import { runPlaytestCli } from "./playtest-cli.js";
import {
	DEFAULT_PLAYTEST_MODEL,
	DEFAULT_PLAYTEST_USER_MODEL,
	type PlaytestRecord,
	parsePlaytestJsonl,
} from "./playtest.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const EVAL_PERSONA = "你是一位主动推进剧情、重视角色反应的玩家。";

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat opening-eval --card <path> [--card <path> ...] [选项]",
	"",
	"在同一批卡与固定种子上对比开局导演开启与关闭，统计重 roll 率、",
	"指令遵循率、候选采用率与首字延迟，写出私有版与统计版报告。",
	"",
	"选项：",
	"  --card <path>        必填，角色卡（PNG 或 JSON），可以重复",
	`  --rounds <n>         每张卡每种配置的轮数，默认 ${DEFAULT_OPENING_EVAL_ROUNDS}`,
	"  --seed <n>           随机种子，默认 1",
	`  --model <m>          助手模型别名，默认 ${DEFAULT_PLAYTEST_MODEL}`,
	`  --user-model <m>     模拟用户与候选选择的模型别名，默认 ${DEFAULT_PLAYTEST_USER_MODEL}`,
	"  --judge-model <m>    裁判模型别名，默认按 roles.judge 解析",
	"  --db <path>          数据库路径，默认 <out-dir>/eval.db",
	"  --out-dir <path>     运行产物目录，默认 eval-private/reports/opening-eval",
	"  --private-out <path> 私有报告路径，默认 eval-private/reports/O-opening.md",
	"  --public-out <path>  统计版报告路径，默认 docs/dev/reports/O-opening.md",
	"  --candidate-count <n> 每张卡生成的候选数，默认 3",
	"  --channels <path>    渠道配置，默认 data/channels.yaml",
	"  --report-only        只从已有 manifest 与 JSONL 重新生成报告",
	"  --help               显示本说明",
].join("\n");

export interface OpeningEvalCliDependencies {
	readonly envPath?: string;
	readonly channelsPath?: string;
	readonly loadEnv?: (filePath: string) => void;
	readonly loadConfig?: (filePath: string) => Promise<LlmChannelsConfig>;
	readonly loadCard?: (filePath: string) => Promise<StCharacterCard>;
	readonly createClient?: (
		config: LlmChannelsConfig,
		modelAlias: string,
	) => LlmStreamingClient;
	readonly runPlaytest?: (
		args: readonly string[],
		dependencies?: { readonly channelsPath?: string },
	) => Promise<unknown>;
	readonly now?: () => number;
	readonly log?: (message: string) => void;
}

export interface OpeningEvalCliResult {
	readonly outDir: string;
	readonly summary: OpeningEvalSummary | null;
}

type MutableRunMeta = {
	-readonly [Key in keyof OpeningEvalRunMeta]: OpeningEvalRunMeta[Key];
};

interface OpeningEvalArgs {
	readonly cardPaths: readonly string[];
	readonly rounds: number;
	readonly seed: number;
	readonly model: string;
	readonly userModel: string;
	readonly judgeModel: string | null;
	readonly dbPath: string;
	readonly outDir: string;
	readonly privateOut: string;
	readonly publicOut: string;
	readonly candidateCount: number;
	readonly channelsPath: string | null;
	readonly reportOnly: boolean;
}

export async function runOpeningEvalCli(
	args: readonly string[],
	dependencies: OpeningEvalCliDependencies = {},
): Promise<OpeningEvalCliResult> {
	const log = dependencies.log ?? console.log;
	if (args.includes("--help") || args.includes("-h")) {
		log(USAGE);
		return { outDir: "", summary: null };
	}
	const parsed = parseArgs(args);
	if (parsed.reportOnly) {
		return reportOnly(parsed, dependencies);
	}
	if (parsed.cardPaths.length === 0) {
		throw new Error(`至少提供一个 --card；${USAGE}`);
	}
	for (const cardPath of parsed.cardPaths) {
		if (!existsSync(cardPath)) {
			throw new Error(`角色卡不存在：${cardPath}`);
		}
	}
	const envPath = dependencies.envPath ?? path.join(repoRoot, ".env");
	const channelsPath =
		parsed.channelsPath ??
		dependencies.channelsPath ??
		path.join(repoRoot, "data", "channels.yaml");
	(dependencies.loadEnv ?? loadDotEnv)(envPath);
	const config = await (dependencies.loadConfig ?? loadChannelsConfig)(
		channelsPath,
	);
	for (const alias of [parsed.model, parsed.userModel]) {
		if (!config.models.has(alias)) {
			throw new Error(
				`没有模型 ${alias}；可用模型：${[...config.models.keys()].join("、")}`,
			);
		}
	}
	const judgeModel = parsed.judgeModel ?? resolveModelForRole(config, "judge");
	if (!config.models.has(judgeModel)) {
		throw new Error(
			`没有裁判模型 ${judgeModel}；可用模型：${[...config.models.keys()].join("、")}`,
		);
	}
	const createClient =
		dependencies.createClient ??
		((channels: LlmChannelsConfig, alias: string) =>
			createLlmClient(channels, { defaultModel: alias, cacheDir: null }));
	const loadCard = dependencies.loadCard ?? parseCharacterCardFile;
	const runPlaytest = dependencies.runPlaytest ?? runPlaytestCli;
	const now = dependencies.now ?? Date.now;
	await mkdir(parsed.outDir, { recursive: true });
	await removeDatabase(parsed.dbPath);
	const embeddingConfig = config.embeddings.get("default");
	const store = StoryStore.open(
		parsed.dbPath,
		embeddingConfig === undefined
			? {}
			: { embeddingDimensions: embeddingConfig.dimensions },
	);
	const settlerClient = createClient(
		config,
		resolveModelForRole(config, "settler"),
	);
	const userClient = createClient(config, parsed.userModel);
	const runs: MutableRunMeta[] = [];
	const candidates: OpeningEvalCandidateMeta[] = [];
	try {
		for (const [index, cardPath] of parsed.cardPaths.entries()) {
			const cardIndex = index + 1;
			const card = await loadCard(cardPath);
			log(`卡 ${cardIndex}：${card.name}`);
			for (const configName of ["opening", "baseline"] as const) {
				const storyId = `opening-eval-${cardIndex}-${configName === "opening" ? "on" : "off"}`;
				const imported = seedStory(store, storyId, card, configName);
				let openingPack = false;
				if (configName === "opening") {
					openingPack = await ensureOpeningPack(store, storyId, settlerClient);
					if (!openingPack) {
						throw new Error(`卡 ${cardIndex} 的开局包没有生成`);
					}
				}
				runs.push({
					runId: `card-${cardIndex}-${configName}`,
					cardIndex,
					cardLabel: card.name,
					config: configName,
					storyId,
					openingFloors:
						configName === "opening"
							? DEFAULT_DIRECTOR_CONFIG.openingFloors
							: 0,
					openingPack,
					path: `card-${cardIndex}-${configName}.jsonl`,
					error: null,
				});
				log(
					`卡 ${cardIndex} ${configName === "opening" ? "开局开启" : "开局关闭"}：故事 ${storyId}，开局包 ${openingPack ? "有" : "无"}，角色提示词 ${imported.characterPrompt.length} 字符`,
				);
			}
			candidates.push(
				await evaluateCandidates({
					store,
					cardIndex,
					card,
					storyId: `opening-eval-${cardIndex}-candidates`,
					count: parsed.candidateCount,
					settlerClient,
					userClient,
					userModel: parsed.userModel,
				}),
			);
		}
	} finally {
		store.close();
	}
	for (const run of runs) {
		const outPath = path.join(parsed.outDir, run.path);
		try {
			await runPlaytest(
				[
					"--db",
					parsed.dbPath,
					"--story",
					run.storyId,
					"--rounds",
					String(parsed.rounds),
					"--seed",
					String(parsed.seed),
					"--model",
					parsed.model,
					"--user-model",
					parsed.userModel,
					"--judge-model",
					judgeModel,
					"--judge-turns",
					"--opening",
					run.config === "opening" ? "on" : "off",
					"--no-background",
					"--out",
					outPath,
					...(parsed.channelsPath === null
						? []
						: ["--channels", parsed.channelsPath]),
				],
				{ channelsPath },
			);
			log(`运行完成：${run.runId}，记录 ${outPath}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			run.error = message;
			log(`运行失败：${run.runId}：${message}`);
		}
	}
	const manifest: OpeningEvalManifest = {
		generatedAt: new Date(now()).toISOString(),
		seed: parsed.seed,
		rounds: parsed.rounds,
		assistantModel: parsed.model,
		userModel: parsed.userModel,
		judgeModel,
		runs,
		candidates,
	};
	await writeFile(
		path.join(parsed.outDir, "manifest.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`,
		"utf8",
	);
	const summary = await summarizeFromDisk(parsed.outDir, manifest);
	await writeReports(summary, parsed);
	return { outDir: parsed.outDir, summary };
}

function seedStory(
	store: StoryStore,
	storyId: string,
	card: StCharacterCard,
	config: "opening" | "baseline",
): { readonly characterPrompt: string } {
	store.createStory({
		id: storyId,
		title: card.name.trim().length > 0 ? card.name : storyId,
	});
	const imported = importCardContent(store, storyId, { card });
	store.updateStorySettings(storyId, {
		cardName: imported.cardName,
		characterPrompt: imported.characterPrompt,
		persona: EVAL_PERSONA,
		directorConfig:
			config === "opening"
				? {
						...DEFAULT_DIRECTOR_CONFIG,
						openingFloors: DEFAULT_DIRECTOR_CONFIG.openingFloors,
					}
				: { ...DEFAULT_DIRECTOR_CONFIG, openingFloors: 0 },
	});
	const greeting = card.firstMessage.trim();
	if (greeting.length > 0) {
		store.appendNode({
			storyId,
			parentId: null,
			role: "assistant",
			raw: greeting,
		});
	}
	return { characterPrompt: imported.characterPrompt };
}

async function ensureOpeningPack(
	store: StoryStore,
	storyId: string,
	client: LlmStreamingClient,
): Promise<boolean> {
	const registry = createBackgroundJobRegistry({
		[OPENING_JOB_KIND]: {
			handler: createOpeningHandler(),
			enqueue: "story",
			tier: "deferred",
			needsRun: openingPackNeedsRun,
		},
	});
	enqueueMissingJobs({
		store,
		storyId,
		kinds: [OPENING_JOB_KIND],
		conditions: { [OPENING_JOB_KIND]: "story" },
	});
	let lastError: string | null = null;
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const result = await drainBackgroundJobs({
			store,
			registry,
			client,
			storyId,
			kinds: [OPENING_JOB_KIND],
			sessionEnded: true,
			maxAttempts: 3,
		});
		if (store.getOpeningPack(storyId) !== null) return true;
		const run = result.runs.find(
			(candidate) => candidate.kind === OPENING_JOB_KIND,
		);
		if (run === undefined) break;
		lastError = run.error ?? lastError;
		if (run.status !== "pending") break;
	}
	throw new Error(
		`故事 ${storyId} 的开局包生成失败：${lastError ?? "任务没有执行"}`,
	);
}

async function evaluateCandidates(input: {
	readonly store: StoryStore;
	readonly cardIndex: number;
	readonly card: StCharacterCard;
	readonly storyId: string;
	readonly count: number;
	readonly settlerClient: LlmStreamingClient;
	readonly userClient: LlmStreamingClient;
	readonly userModel: string;
}): Promise<OpeningEvalCandidateMeta> {
	input.store.createStory({
		id: input.storyId,
		title: input.card.name.trim().length > 0 ? input.card.name : input.storyId,
	});
	const imported = importCardContent(input.store, input.storyId, {
		card: input.card,
	});
	input.store.updateStorySettings(input.storyId, {
		cardName: imported.cardName,
		characterPrompt: imported.characterPrompt,
		persona: EVAL_PERSONA,
	});
	try {
		const records = await generateOpeningCandidates({
			store: input.store,
			client: input.settlerClient,
			storyId: input.storyId,
			count: input.count,
		});
		const texts = records.map((record) => record.raw);
		const choice = await chooseOpeningCandidate({
			cardName: input.card.name,
			cardPrompt: imported.characterPrompt,
			persona: EVAL_PERSONA,
			candidates: texts,
			client: input.userClient,
			model: input.userModel,
		});
		return {
			cardIndex: input.cardIndex,
			cardLabel: input.card.name,
			storyId: input.storyId,
			status: choice.error === null ? "done" : "failed",
			candidateCount: texts.length,
			candidates: texts,
			choice: choice.choice,
			reason: choice.reason,
			error: choice.error,
		};
	} catch (error) {
		return {
			cardIndex: input.cardIndex,
			cardLabel: input.card.name,
			storyId: input.storyId,
			status: "failed",
			candidateCount: 0,
			candidates: [],
			choice: null,
			reason: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function summarizeFromDisk(
	outDir: string,
	manifest: OpeningEvalManifest,
): Promise<OpeningEvalSummary> {
	const runs: OpeningEvalRunInput[] = [];
	for (const meta of manifest.runs) {
		const filePath = path.join(outDir, meta.path);
		const records: PlaytestRecord[] = existsSync(filePath)
			? parsePlaytestJsonl(await readFile(filePath, "utf8"))
			: [];
		runs.push({ meta, records });
	}
	const input: OpeningEvalInput = { manifest, runs };
	return summarizeOpeningEval(input);
}

async function writeReports(
	summary: OpeningEvalSummary,
	parsed: OpeningEvalArgs,
): Promise<void> {
	await mkdir(path.dirname(parsed.privateOut), { recursive: true });
	await mkdir(path.dirname(parsed.publicOut), { recursive: true });
	await writeFile(
		parsed.privateOut,
		renderOpeningEvalReport(summary, { privateDetails: true }),
		"utf8",
	);
	await writeFile(
		parsed.publicOut,
		renderOpeningEvalReport(summary, { privateDetails: false }),
		"utf8",
	);
}

async function reportOnly(
	parsed: OpeningEvalArgs,
	dependencies: OpeningEvalCliDependencies,
): Promise<OpeningEvalCliResult> {
	const manifestPath = path.join(parsed.outDir, "manifest.json");
	if (!existsSync(manifestPath)) {
		throw new Error(`没有找到 ${manifestPath}`);
	}
	const manifest = JSON.parse(
		await readFile(manifestPath, "utf8"),
	) as OpeningEvalManifest;
	const summary = await summarizeFromDisk(parsed.outDir, manifest);
	await writeReports(summary, parsed);
	(dependencies.log ?? console.log)(
		`报告已生成：${parsed.privateOut} 与 ${parsed.publicOut}`,
	);
	return { outDir: parsed.outDir, summary };
}

async function removeDatabase(dbPath: string): Promise<void> {
	for (const suffix of ["", "-wal", "-shm"]) {
		const filePath = `${dbPath}${suffix}`;
		if (existsSync(filePath)) {
			rmSync(filePath, { force: true });
		}
	}
}

function parseArgs(args: readonly string[]): OpeningEvalArgs {
	const flags = new Set<string>();
	const values = new Map<string, string>();
	const cardPaths: string[] = [];
	const allowedValues: Readonly<Record<string, true>> = {
		card: true,
		rounds: true,
		seed: true,
		model: true,
		"user-model": true,
		"judge-model": true,
		db: true,
		"out-dir": true,
		"private-out": true,
		"public-out": true,
		"candidate-count": true,
		channels: true,
	};
	const allowedFlags: Readonly<Record<string, true>> = {
		"report-only": true,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (!arg.startsWith("--")) {
			throw new Error(`多余的参数 ${arg}；${USAGE}`);
		}
		const equals = arg.indexOf("=");
		const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
		if (allowedFlags[key] === true) {
			if (equals !== -1) {
				throw new Error(`参数 --${key} 不带值；${USAGE}`);
			}
			flags.add(key);
			continue;
		}
		if (allowedValues[key] !== true) {
			throw new Error(`不认识的参数 --${key}；${USAGE}`);
		}
		let value: string | undefined;
		if (equals !== -1) {
			value = arg.slice(equals + 1);
		} else {
			value = args[index + 1];
			index += 1;
		}
		if (value === undefined) {
			throw new Error(`--${key} 后面必须写值；${USAGE}`);
		}
		if (key === "card") {
			cardPaths.push(value);
			continue;
		}
		if (values.has(key)) {
			throw new Error(`参数 --${key} 重复；${USAGE}`);
		}
		values.set(key, value);
	}
	const outDir =
		values.get("out-dir") ??
		path.join(repoRoot, "eval-private", "reports", "opening-eval");
	const dbPath = values.get("db") ?? path.join(outDir, "eval.db");
	const roundsValue = values.get("rounds");
	const rounds =
		roundsValue === undefined
			? DEFAULT_OPENING_EVAL_ROUNDS
			: parseInteger(roundsValue, "--rounds", 1);
	const seedValue = values.get("seed");
	const seed =
		seedValue === undefined ? 1 : parseInteger(seedValue, "--seed", 0);
	const candidateCountValue = values.get("candidate-count");
	const candidateCount =
		candidateCountValue === undefined
			? 3
			: parseInteger(candidateCountValue, "--candidate-count", 2);
	if (candidateCount > 3) {
		throw new Error("--candidate-count 只接受 2 或 3");
	}
	const channelsValue = values.get("channels");
	return {
		cardPaths,
		rounds,
		seed,
		model: values.get("model") ?? DEFAULT_PLAYTEST_MODEL,
		userModel: values.get("user-model") ?? DEFAULT_PLAYTEST_USER_MODEL,
		judgeModel: values.get("judge-model") ?? null,
		dbPath,
		outDir,
		privateOut:
			values.get("private-out") ??
			path.join(repoRoot, "eval-private", "reports", "O-opening.md"),
		publicOut:
			values.get("public-out") ??
			path.join(repoRoot, "docs", "dev", "reports", "O-opening.md"),
		candidateCount,
		channelsPath:
			channelsValue === undefined
				? null
				: requireText(channelsValue, "--channels"),
		reportOnly: flags.has("report-only"),
	};
}

function parseInteger(value: string, label: string, minimum: number): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < minimum) {
		throw new Error(`${label} 必须是不小于 ${minimum} 的整数；${USAGE}`);
	}
	return parsed;
}

function requireText(value: string, label: string): string {
	if (value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串；${USAGE}`);
	}
	return value;
}

async function main(): Promise<void> {
	await runOpeningEvalCli(process.argv.slice(2));
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
