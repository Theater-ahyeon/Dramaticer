import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type BackgroundJobRegistry,
	type ChatProfile,
	DEFAULT_CHAT_PROFILE,
	DEFAULT_DIRECTOR_CONFIG,
	type LlmChannelsConfig,
	type LlmStreamingClient,
	StoryStore,
	createDefaultBackgroundJobRegistry,
	createEmbeddingClient,
	createLlmClient,
	createNaiveChatSlots,
	createNaiveContextTemplate,
	createStandardChatSlots,
	isChatProfile,
	loadChannelsConfig,
	loadDotEnv,
	resolveDefaultMaxTokens,
	resolveModelForRole,
	resolveStructuredOutputMode,
	resolveToolTransport,
} from "@dramaticer/core";
import { resolveStoryContextTemplate } from "../chat/session.js";
import {
	type ForgettingCorpus,
	type ForgettingRunResult,
	isForgettingCorpus,
	readForgettingQuestionFiles,
	runForgettingQuestions,
	summarizeInRunProbes,
} from "./forgetting.js";
import {
	DEFAULT_PLAYTEST_MODEL,
	DEFAULT_PLAYTEST_ROUNDS,
	DEFAULT_PLAYTEST_USER_MODEL,
	type PlaytestRunResult,
	parsePlaytestJsonl,
	runPlaytest,
	serializePlaytestRecord,
} from "./playtest.js";
import {
	DEFAULT_PROBE_EVERY,
	DEFAULT_PROBE_MIN_AGE_FLOORS,
	type PlaytestProbeOptions,
} from "./probe.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat playtest --db <path> --story <id> [选项]",
	"",
	"用模拟用户连续生成回复，逐轮把私有记录写进 JSONL。",
	"",
	"选项：",
	"  --db <path>       必填，故事所在的数据库",
	"  --story <id>      必填，数据库里已有的故事",
	`  --rounds <n>      总轮数，默认 ${DEFAULT_PLAYTEST_ROUNDS}`,
	"  --profile <p>     对话档位 native 或 naive，默认 native",
	`  --user-model <m>  模拟用户使用的模型别名，默认 ${DEFAULT_PLAYTEST_USER_MODEL}`,
	`  --model <m>       助手模型别名，默认 ${DEFAULT_PLAYTEST_MODEL}`,
	"  --seed <n>        随机种子，默认 1；决定模拟用户的写作提示顺序",
	"  --out <path>      私有 JSONL 路径，默认 eval-private/reports/playtest.jsonl",
	"  --resume          从已有记录的最后轮次之后继续",
	"  --swipe-at <轮次> 在这些轮次之后重新生成回复，逗号分隔",
	"  --edit-at <轮次>  在这些轮次之后编辑玩家输入并重新生成，逗号分隔",
	"  --branch-at <轮次> 在这些轮次之后新建并行分支并切过去，逗号分隔",
	`  --probe-every <n> 每多少轮插入一次一致性探针，默认 ${DEFAULT_PROBE_EVERY}，0 表示关闭`,
	`  --probe-min-age <n> 探针事实至少早于 head 多少楼，默认 ${DEFAULT_PROBE_MIN_AGE_FLOORS}`,
	"  --head <nodeId>   从指定助手楼层继续生成，用于长对话分支点评测",
	"  --judge-model <m> 裁判模型别名，默认按 roles.judge 解析",
	"  --judge-turns     每轮让裁判判断是否重 roll 与是否遵循指令",
	"  --memory-questions <path> 跑完后在最终 head 上提问的记忆题文件",
	"  --probe-questions <path>  跑完后在最终 head 上提问的探针题文件",
	"  --questions-out <path>    把跑后提问结果写成 JSON；汇报用 forgetting-report 读取",
	"  --corpus <c>      跑后提问的来源标签 benchmark 或 legacy，默认 benchmark",
	"  --opening <on|off> 覆盖故事的开局导演开关；off 把 openingFloors 设为 0",
	"  --no-background   不补建也不执行后台任务",
	"  --channels <path> 渠道配置，默认 data/channels.yaml",
	"  --help            显示本说明",
].join("\n");

export interface PlaytestCliDependencies {
	readonly envPath?: string;
	readonly channelsPath?: string;
	readonly loadEnv?: (filePath: string) => void;
	readonly loadConfig?: (filePath: string) => Promise<LlmChannelsConfig>;
	readonly createClient?: (
		config: LlmChannelsConfig,
		modelAlias: string,
	) => LlmStreamingClient;
	readonly registry?: BackgroundJobRegistry;
	readonly now?: () => number;
	readonly log?: (message: string) => void;
}

export async function runPlaytestCli(
	args: readonly string[],
	dependencies: PlaytestCliDependencies = {},
): Promise<PlaytestRunResult> {
	const log = dependencies.log ?? console.log;
	if (args.includes("--help") || args.includes("-h")) {
		log(USAGE);
		return { records: [], failures: 0, lastRound: 0 };
	}
	const parsed = parsePlaytestArgs(args);
	if (!existsSync(parsed.dbPath)) {
		throw new Error(`数据库不存在：${parsed.dbPath}`);
	}
	const envPath = dependencies.envPath ?? path.join(repoRoot, ".env");
	const channelsPath =
		dependencies.channelsPath ?? path.join(repoRoot, "data", "channels.yaml");
	(dependencies.loadEnv ?? loadDotEnv)(envPath);
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
	const createClient =
		dependencies.createClient ??
		((channels: LlmChannelsConfig, alias: string) =>
			createLlmClient(channels, { defaultModel: alias, cacheDir: null }));
	const mode = resolveStructuredOutputMode(assistantModel.probe);
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
			throw new Error(`故事不存在：${parsed.storyId}`);
		}
		if (parsed.headNodeId !== null) {
			const head = store.getNode(parsed.headNodeId);
			if (head === null) {
				throw new Error(`--head 指向的楼层不存在：${parsed.headNodeId}`);
			}
			if (head.storyId !== parsed.storyId) {
				throw new Error(
					`--head 楼层 ${head.id} 属于故事 ${head.storyId}，不是 ${parsed.storyId}`,
				);
			}
			if (head.role !== "assistant") {
				throw new Error(`--head 必须是助手楼层，${head.id} 是 ${head.role}`);
			}
			store.setHead(parsed.storyId, head.id);
			log(`从分支点继续：${head.id}`);
		}
		const startDepth = store.getPathToHead(parsed.storyId).length;
		const startNodeId = store.getHead(parsed.storyId)?.id ?? null;
		const settings = store.getStorySettings(parsed.storyId);
		const characterPrompt = settings.characterPrompt;
		if (characterPrompt === null || characterPrompt.trim().length === 0) {
			throw new Error(
				`故事 ${parsed.storyId} 没有保存角色提示词，先导入角色卡或用 dramaticer chat 生成一轮`,
			);
		}
		const maxTokens = store.hasStorySettings(parsed.storyId)
			? settings.maxTokens
			: resolveDefaultMaxTokens(config, parsed.model);
		const budgetTokens = assistantModel.contextWindow - maxTokens;
		if (budgetTokens <= 0) {
			throw new Error(
				`模型的上下文窗口 ${assistantModel.contextWindow} 不大于输出上限 ${maxTokens}，没有可用的输入预算`,
			);
		}
		const template =
			parsed.profile === "naive"
				? createNaiveContextTemplate()
				: resolveStoryContextTemplate(
						store,
						settings.templateId,
						mode,
						settings.contextLayout,
					);
		const directorConfig =
			parsed.opening === "off"
				? { ...settings.directorConfig, openingFloors: 0 }
				: parsed.opening === "on"
					? {
							...settings.directorConfig,
							openingFloors: DEFAULT_DIRECTOR_CONFIG.openingFloors,
						}
					: settings.directorConfig;
		const providers =
			parsed.profile === "naive"
				? (
						await createNaiveChatSlots({
							store,
							characterPrompt,
							persona: settings.persona,
						})
					).providers
				: (
						await createStandardChatSlots({
							store,
							characterPrompt,
							embedder,
							directorConfig,
							historyBlockPolicy: settings.historyBlockPolicy,
							worldModel: settings.worldModel,
							directorOrganization: settings.directorOrganization,
						})
					).providers;
		await mkdir(path.dirname(parsed.outPath), { recursive: true });
		const startRound = parsed.resume
			? await readResumeStart(parsed.outPath)
			: await resetOutput(parsed.outPath);
		if (startRound > parsed.rounds) {
			log(
				`已有记录到第 ${startRound - 1} 轮，没有需要继续的轮次（总轮数 ${parsed.rounds}）`,
			);
			return { records: [], failures: 0, lastRound: startRound - 1 };
		}
		const assistantClient = createClient(config, parsed.model);
		const userClient = createClient(config, parsed.userModel);
		const background =
			parsed.profile === "naive" || parsed.noBackground
				? null
				: {
						client: createClient(
							config,
							resolveModelForRole(config, "settler"),
						),
						registry:
							dependencies.registry ??
							createDefaultBackgroundJobRegistry({ embedder }),
					};
		const judgeModel =
			parsed.judgeModel ?? resolveModelForRole(config, "judge");
		const needsJudge =
			parsed.probeEvery > 0 ||
			parsed.judgeTurns ||
			parsed.questionsOutPath !== null;
		let judge: {
			readonly client: LlmStreamingClient;
			readonly model: string;
		} | null = null;
		if (needsJudge) {
			if (!config.models.has(judgeModel)) {
				throw new Error(
					`没有裁判模型 ${judgeModel}；可用模型：${[...config.models.keys()].join("、")}`,
				);
			}
			judge = { client: createClient(config, judgeModel), model: judgeModel };
		}
		let probes: PlaytestProbeOptions | null = null;
		let turnJudge: {
			readonly client: LlmStreamingClient;
			readonly model: string;
		} | null = null;
		if (judge !== null) {
			if (parsed.judgeTurns) {
				turnJudge = { client: judge.client, model: judge.model };
			}
			if (parsed.probeEvery > 0) {
				probes = {
					every: parsed.probeEvery,
					minAgeFloors: parsed.probeMinAge,
					judge: { client: judge.client, model: judge.model },
				};
			}
		}
		log(
			`试玩：故事 ${parsed.storyId}，档位 ${parsed.profile}，第 ${startRound} 到 ${parsed.rounds} 轮，助手模型 ${parsed.model}，模拟用户模型 ${parsed.userModel}，开局 ${parsed.opening}，后台任务 ${background === null ? "关闭" : "开启"}，每轮裁判 ${turnJudge === null ? "关闭" : "开启"}`,
		);
		const result = await runPlaytest({
			store,
			storyId: parsed.storyId,
			rounds: parsed.rounds,
			startRound,
			profile: parsed.profile,
			seed: parsed.seed,
			assistant: { client: assistantClient, model: parsed.model },
			user: { client: userClient, model: parsed.userModel },
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
			background,
			probes,
			turnJudge,
			operations: parsed.operations,
			onRecord: async (record) => {
				await appendFile(
					parsed.outPath,
					serializePlaytestRecord(record),
					"utf8",
				);
			},
			log,
			now: dependencies.now,
		});
		log(
			`试玩完成：${result.records.length} 轮，失败 ${result.failures} 轮，记录 ${parsed.outPath}`,
		);
		if (parsed.questionsOutPath !== null) {
			if (judge === null) {
				throw new Error("跑后提问没有裁判客户端");
			}
			const questions = await readForgettingQuestionFiles({
				storyId: parsed.storyId,
				memoryPath: parsed.memoryQuestionsPath,
				probePath: parsed.probeQuestionsPath,
			});
			const finalHead = store.getHead(parsed.storyId);
			if (finalHead === null) {
				throw new Error("试玩结束后故事没有 head，无法提问");
			}
			const answers = await runForgettingQuestions({
				store,
				storyId: parsed.storyId,
				askAtNode: finalHead.id,
				questions,
				template,
				providers,
				budgetTokens,
				assistant: { client: assistantClient, model: parsed.model },
				judge: { client: judge.client, model: judge.model },
			});
			const run: ForgettingRunResult = {
				story: parsed.storyId,
				corpus: parsed.corpus,
				headNodeId: startNodeId ?? finalHead.id,
				profile: parsed.profile,
				model: parsed.model,
				userModel: parsed.userModel,
				judgeModel: judge.model,
				seed: parsed.seed,
				startDepth,
				endDepth: store.getPathToHead(parsed.storyId).length,
				rounds: parsed.rounds,
				completedRounds: result.records.length,
				failedRounds: result.failures,
				generatedAt: new Date(dependencies.now?.() ?? Date.now()).toISOString(),
				playtestPath: parsed.outPath,
				inRunProbes: summarizeInRunProbes(result.records),
				questions: answers,
			};
			await mkdir(path.dirname(parsed.questionsOutPath), {
				recursive: true,
			});
			await writeFile(
				parsed.questionsOutPath,
				`${JSON.stringify(run, null, 2)}\n`,
				"utf8",
			);
			const judged = answers.filter(
				(answer) =>
					answer.verdict === "consistent" || answer.verdict === "contradicted",
			);
			const contradicted = judged.filter(
				(answer) => answer.verdict === "contradicted",
			);
			log(
				`跑后提问：${answers.length} 题，可判定 ${judged.length}，矛盾 ${contradicted.length}，结果 ${parsed.questionsOutPath}`,
			);
		}
		return result;
	} finally {
		store.close();
	}
}

async function resetOutput(outPath: string): Promise<number> {
	await writeFile(outPath, "", "utf8");
	return 1;
}

async function readResumeStart(outPath: string): Promise<number> {
	if (!existsSync(outPath)) return 1;
	const text = await readFile(outPath, "utf8");
	const records = parsePlaytestJsonl(text);
	const last = records.reduce(
		(max, record) => (record.round > max ? record.round : max),
		0,
	);
	return last + 1;
}

interface PlaytestArgs {
	readonly dbPath: string;
	readonly storyId: string;
	readonly rounds: number;
	readonly profile: ChatProfile;
	readonly userModel: string;
	readonly model: string;
	readonly seed: number;
	readonly probeEvery: number;
	readonly probeMinAge: number;
	readonly judgeModel: string | null;
	readonly judgeTurns: boolean;
	readonly headNodeId: string | null;
	readonly memoryQuestionsPath: string | null;
	readonly probeQuestionsPath: string | null;
	readonly questionsOutPath: string | null;
	readonly corpus: ForgettingCorpus;
	readonly opening: "on" | "off" | "settings";
	readonly noBackground: boolean;
	readonly outPath: string;
	readonly resume: boolean;
	readonly operations: {
		readonly swipeAt: readonly number[];
		readonly editAt: readonly number[];
		readonly branchAt: readonly number[];
	};
}

function parsePlaytestArgs(args: readonly string[]): PlaytestArgs {
	const flags = new Set<string>();
	const values = new Map<string, string>();
	const allowedValues: Readonly<Record<string, true>> = {
		db: true,
		story: true,
		rounds: true,
		profile: true,
		"user-model": true,
		model: true,
		seed: true,
		out: true,
		"swipe-at": true,
		"edit-at": true,
		"branch-at": true,
		"probe-every": true,
		"probe-min-age": true,
		"judge-model": true,
		head: true,
		"memory-questions": true,
		"probe-questions": true,
		"questions-out": true,
		corpus: true,
		opening: true,
		channels: true,
	};
	const allowedFlags: Readonly<Record<string, true>> = {
		resume: true,
		"judge-turns": true,
		"no-background": true,
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
		if (values.has(key)) {
			throw new Error(`参数 --${key} 重复；${USAGE}`);
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
		values.set(key, value);
	}
	const dbPath = requireText(values.get("db"), "--db");
	const storyId = requireText(values.get("story"), "--story");
	const roundsValue = values.get("rounds");
	const rounds =
		roundsValue === undefined
			? DEFAULT_PLAYTEST_ROUNDS
			: parseInteger(roundsValue, "--rounds", 1);
	const profileValue = values.get("profile");
	const profile =
		profileValue === undefined ? DEFAULT_CHAT_PROFILE : profileValue;
	if (!isChatProfile(profile)) {
		throw new Error(`--profile 只接受 native 或 naive，收到 ${profile}`);
	}
	const userModel = values.get("user-model") ?? DEFAULT_PLAYTEST_USER_MODEL;
	const model = values.get("model") ?? DEFAULT_PLAYTEST_MODEL;
	if (model.trim().length === 0) {
		throw new Error("--model 不能为空字符串");
	}
	const seedValue = values.get("seed");
	const seed =
		seedValue === undefined ? 1 : parseInteger(seedValue, "--seed", 0);
	const probeEveryValue = values.get("probe-every");
	const probeEvery =
		probeEveryValue === undefined
			? DEFAULT_PROBE_EVERY
			: parseInteger(probeEveryValue, "--probe-every", 0);
	const probeMinAgeValue = values.get("probe-min-age");
	const probeMinAge =
		probeMinAgeValue === undefined
			? DEFAULT_PROBE_MIN_AGE_FLOORS
			: parseInteger(probeMinAgeValue, "--probe-min-age", 1);
	const judgeModelValue = values.get("judge-model");
	const judgeModel =
		judgeModelValue === undefined
			? null
			: requireText(judgeModelValue, "--judge-model");
	const openingValue = values.get("opening");
	if (
		openingValue !== undefined &&
		openingValue !== "on" &&
		openingValue !== "off"
	) {
		throw new Error(`--opening 只接受 on 或 off，收到 ${openingValue}`);
	}
	const opening = openingValue ?? "settings";
	const outPath =
		values.get("out") ??
		path.join(repoRoot, "eval-private", "reports", "playtest.jsonl");
	const headNodeId = optionalText(values.get("head"), "--head");
	const memoryQuestionsPath = optionalText(
		values.get("memory-questions"),
		"--memory-questions",
	);
	const probeQuestionsPath = optionalText(
		values.get("probe-questions"),
		"--probe-questions",
	);
	const questionsOutPath = optionalText(
		values.get("questions-out"),
		"--questions-out",
	);
	const corpusValue = values.get("corpus") ?? "benchmark";
	if (!isForgettingCorpus(corpusValue)) {
		throw new Error(`--corpus 只接受 benchmark 或 legacy，收到 ${corpusValue}`);
	}
	const corpus: ForgettingCorpus = corpusValue;
	const resume = flags.has("resume");
	if (headNodeId !== null && resume) {
		throw new Error(`--head 不能与 --resume 同时使用；${USAGE}`);
	}
	if (
		(memoryQuestionsPath !== null || probeQuestionsPath !== null) &&
		questionsOutPath === null
	) {
		throw new Error(
			`给了 --memory-questions 或 --probe-questions 就必须给 --questions-out；${USAGE}`,
		);
	}
	if (
		questionsOutPath !== null &&
		memoryQuestionsPath === null &&
		probeQuestionsPath === null
	) {
		throw new Error(
			`--questions-out 至少需要 --memory-questions 或 --probe-questions 之一；${USAGE}`,
		);
	}
	return {
		dbPath,
		storyId,
		rounds,
		profile,
		userModel,
		model,
		seed,
		probeEvery,
		probeMinAge,
		judgeModel,
		judgeTurns: flags.has("judge-turns"),
		headNodeId,
		memoryQuestionsPath,
		probeQuestionsPath,
		questionsOutPath,
		corpus,
		opening,
		noBackground: flags.has("no-background"),
		outPath,
		resume,
		operations: {
			swipeAt: parseRoundList(values.get("swipe-at"), "--swipe-at"),
			editAt: parseRoundList(values.get("edit-at"), "--edit-at"),
			branchAt: parseRoundList(values.get("branch-at"), "--branch-at"),
		},
	};
}

function parseRoundList(
	value: string | undefined,
	label: string,
): readonly number[] {
	if (value === undefined) return [];
	return value
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.map((part) => parseInteger(part, label, 1));
}

function parseInteger(value: string, label: string, minimum: number): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < minimum) {
		throw new Error(`${label} 必须是不小于 ${minimum} 的整数；${USAGE}`);
	}
	return parsed;
}

function requireText(value: string | undefined, label: string): string {
	if (value === undefined || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串；${USAGE}`);
	}
	return value;
}

function optionalText(value: string | undefined, label: string): string | null {
	if (value === undefined) return null;
	if (value.trim().length === 0) {
		throw new Error(`${label} 不能为空字符串；${USAGE}`);
	}
	return value;
}

async function main(): Promise<void> {
	await runPlaytestCli(process.argv.slice(2));
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
