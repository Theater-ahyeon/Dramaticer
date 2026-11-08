import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type ContextSlotProviders,
	type ContextTemplate,
	type LlmChannelsConfig,
	type LlmStreamingClient,
	type LlmToolTransport,
	type StorySettings,
	StoryStore,
	createLlmClient,
	createNaiveChatProviders,
	createNaiveContextTemplate,
	createStandardChatProviders,
	isJsonObject,
	loadChannelsConfig,
	loadDotEnv,
	parseBlocks,
	renderContextView,
	resolveDefaultMaxTokens,
	resolveModelForRole,
	resolveToolTransport,
	runChatTurn,
} from "@dramaticer/core";
import {
	type StCharacterCard,
	parseCharacterCardFile,
} from "../character-card.js";
import { importChatFileToStore } from "../chat-import.js";
import { parseChatJsonlFile } from "../chat-jsonl.js";
import {
	importCardContent,
	resolveStoryContextTemplate,
} from "../chat/session.js";
import {
	type Snapshot,
	type SnapshotManifestFile,
	isLegacyCorpus,
	openSnapshot,
} from "../health/manifest.js";
import { parseMessageIndex } from "../node-id.js";
import type { StWorldInfo } from "../world-info.js";
import { parseWorldInfoFile } from "../world-info.js";
import {
	type B1Profile,
	B1_ORDERS,
	DEFAULT_B1_INTERVAL,
	DEFAULT_B1_JUDGE_MAX_TOKENS,
	DEFAULT_B1_MAX_BRANCH_POINTS,
	DEFAULT_B1_ROUNDS,
	type HistoricalReplayBranchPoint,
	type HistoricalReplayRecord,
	type HistoricalReplaySample,
	buildHistoricalReplayQualitySample,
	historicalReplaySampleId,
	isSameModel,
	isSameModelFamily,
	judgeHistoricalReplaySample,
	parseHistoricalReplayRecordsJsonl,
	parseHistoricalReplaySamplesJsonl,
	planHistoricalReplaySamples,
	renderHistoricalReplayReport,
	summarizeHistoricalReplay,
} from "./historical-replay.js";
import { formatPairwiseContext } from "./pairwise.js";
import type { PairwiseJudge } from "./pairwise.js";
import {
	type QualityRecord,
	parseQualityRecordsJsonl,
	runQualitySample,
	summarizeQuality,
} from "./quality.js";
import { storyIdOf } from "./question-files.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat replay-eval [选项]",
	"",
	"从 legacy 对话按 ADR-0027 取分支点，用后续真实玩家消息回放，把第一段续写与历史回复做盲测。",
	"",
	"选项：",
	"  --root <dir>            快照目录，默认 eval-private/raw",
	"  --db-dir <dir>          种子数据库目录，默认 eval-private/reports/R2-b1/db",
	"  --out <path>            逐条判定的 JSONL，默认 eval-private/reports/R2-b1/records.jsonl",
	"  --samples-out <path>    样本元数据的 JSONL，默认 eval-private/reports/R2-b1/samples.jsonl",
	"  --quality-out <path>    逐条评分的 JSONL，默认 eval-private/reports/R2-b1/quality.jsonl",
	"  --private-report <p>    私有版报告，默认 eval-private/reports/R2-b1.md",
	"  --public-report <p>     统计版报告，默认 docs/dev/reports/R2-b1.md",
	"  --model <alias>         续写模型别名，默认按 roles.writer 解析",
	"  --judge-model <m>       裁判模型别名，默认按 roles.judge 解析",
	"  --judge-max-tokens <n>  裁判输出上限，默认 2048",
	`  --interval <n>          分支点间隔，默认 ${DEFAULT_B1_INTERVAL}`,
	`  --rounds <n>            每个分支点回放的轮数，默认 ${DEFAULT_B1_ROUNDS}`,
	`  --max-branch-points <n> 每个对话的分支点上限，默认 ${DEFAULT_B1_MAX_BRANCH_POINTS}`,
	"  --profiles <list>       回放档位，逗号分隔，默认 native,naive",
	"  --limit-samples <n>     只处理前 n 个样本",
	"  --resume                复用样本元数据与已有判定，不重复生成与判定",
	"  --report-only           不调用模型，只从已有 JSONL 重新生成报告",
	"  --channels <path>       渠道配置，默认 data/channels.yaml",
	"  --help                  显示本说明",
].join("\n");

export interface HistoricalReplayCliDependencies {
	readonly envPath?: string;
	readonly channelsPath?: string;
	readonly loadEnv?: (filePath: string) => void;
	readonly loadConfig?: (filePath: string) => Promise<LlmChannelsConfig>;
	readonly createClient?: (
		config: LlmChannelsConfig,
		alias: string,
	) => LlmStreamingClient;
	readonly openSnapshot?: (root: string) => Promise<Snapshot>;
	readonly now?: () => Date;
	readonly log?: (message: string) => void;
}

export interface HistoricalReplayCliResult {
	readonly sampleCount: number;
	readonly records: number;
	readonly failures: number;
	readonly qualityScores: number;
	readonly qualityFailures: number;
	readonly recordsPath: string;
	readonly samplesPath: string;
	readonly qualityRecordsPath: string;
	readonly privateReportPath: string;
	readonly publicReportPath: string;
}

interface ParsedArgs {
	readonly root: string;
	readonly dbDir: string;
	readonly outPath: string;
	readonly samplesPath: string;
	readonly qualityOutPath: string;
	readonly privateReportPath: string;
	readonly publicReportPath: string;
	readonly model: string | null;
	readonly judgeModel: string | null;
	readonly judgeMaxTokens: number;
	readonly interval: number;
	readonly rounds: number;
	readonly maxBranchPoints: number;
	readonly profiles: readonly B1Profile[];
	readonly limitSamples: number | null;
	readonly resume: boolean;
	readonly reportOnly: boolean;
	readonly channelsPath: string | null;
}

interface TurnContext {
	readonly store: StoryStore;
	readonly client: LlmStreamingClient;
	readonly storyId: string;
	readonly budgetTokens: number;
	readonly structuredOutput: StorySettings["structuredOutput"];
	readonly toolTransport: LlmToolTransport;
	readonly model: string;
	readonly maxTokens: number;
	readonly temperature: number;
	readonly reasoning: StorySettings["reasoning"];
	readonly viewpoint: string | null;
	readonly native: {
		readonly template: ContextTemplate;
		readonly providers: ContextSlotProviders;
	};
	readonly naive: {
		readonly template: ContextTemplate;
		readonly providers: ContextSlotProviders;
	};
}

export async function runHistoricalReplayCli(
	args: readonly string[],
	dependencies: HistoricalReplayCliDependencies = {},
): Promise<HistoricalReplayCliResult> {
	const log = dependencies.log ?? console.log;
	if (args.includes("--help") || args.includes("-h")) {
		log(USAGE);
		return {
			sampleCount: 0,
			records: 0,
			failures: 0,
			qualityScores: 0,
			qualityFailures: 0,
			recordsPath: "",
			samplesPath: "",
			qualityRecordsPath: "",
			privateReportPath: "",
			publicReportPath: "",
		};
	}
	const parsed = parseArgs(args);
	const now = dependencies.now ?? (() => new Date());
	const generatedAt = now().toISOString();
	const metadataSamples = await readSamples(parsed.samplesPath);
	const existingSamples =
		parsed.resume || parsed.reportOnly ? metadataSamples : [];
	const existingRecords =
		parsed.resume || parsed.reportOnly ? await readRecords(parsed.outPath) : [];
	const existingQuality =
		parsed.resume || parsed.reportOnly
			? await readQuality(parsed.qualityOutPath)
			: [];
	const sampleById = new Map(
		existingSamples.map((sample) => [sample.sampleId, sample]),
	);
	const recordedOrders = new Set(
		existingRecords.map((record) => `${record.sampleId}\u0000${record.order}`),
	);
	const recordedQuality = new Set(
		existingQuality.map((record) => `${record.sampleId}\u0000${record.side}`),
	);
	const newRecords: HistoricalReplayRecord[] = [];
	const newQuality: QualityRecord[] = [];
	let writerModel = parsed.model ?? "";
	let writerModelId = "";
	let judgeModel = parsed.judgeModel ?? "";
	let sampleCount = 0;

	if (!parsed.reportOnly) {
		const envPath = dependencies.envPath ?? path.join(repoRoot, ".env");
		const channelsPath =
			parsed.channelsPath ??
			dependencies.channelsPath ??
			path.join(repoRoot, "data", "channels.yaml");
		(dependencies.loadEnv ?? loadDotEnv)(envPath);
		const config = await (dependencies.loadConfig ?? loadChannelsConfig)(
			channelsPath,
		);
		const writerAlias = parsed.model ?? resolveModelForRole(config, "writer");
		const writerModelConfig = config.models.get(writerAlias);
		if (writerModelConfig === undefined) {
			throw new Error(
				`没有续写模型 ${writerAlias}；可用模型：${[...config.models.keys()].join("、")}`,
			);
		}
		const judgeAlias =
			parsed.judgeModel ?? resolveModelForRole(config, "judge");
		if (!config.models.has(judgeAlias)) {
			throw new Error(
				`没有裁判模型 ${judgeAlias}；可用模型：${[...config.models.keys()].join("、")}`,
			);
		}
		writerModel = writerAlias;
		writerModelId = writerModelConfig.id;
		judgeModel = judgeAlias;
		const createClient =
			dependencies.createClient ??
			((channels: LlmChannelsConfig, alias: string) =>
				createLlmClient(channels, { defaultModel: alias, cacheDir: null }));
		const writerClient = createClient(config, writerAlias);
		const judge: PairwiseJudge = {
			client: createClient(config, judgeAlias),
			model: judgeAlias,
			maxTokens: parsed.judgeMaxTokens,
		};
		const snapshot = await (dependencies.openSnapshot ?? openSnapshot)(
			parsed.root,
		);
		const chats = snapshot
			.filesByRole("chat")
			.filter(isLegacyCorpus)
			.sort((left, right) => left.target.localeCompare(right.target));
		if (chats.length === 0) throw new Error("manifest 里没有 legacy 对话");
		await mkdir(parsed.dbDir, { recursive: true });
		for (const [index, file] of chats.entries()) {
			if (parsed.limitSamples !== null && sampleCount >= parsed.limitSamples) {
				break;
			}
			const storyId = storyIdOf(file);
			const dbPath = path.join(
				parsed.dbDir,
				`${index}-${sanitizeName(storyId)}.db`,
			);
			const store = StoryStore.open(dbPath);
			try {
				await ensureStory(store, snapshot, file, log);
				const chatPath = await snapshot.resolveFile(file);
				const historicalModels = await readHistoricalModels(chatPath);
				const existingForStory = metadataSamples.filter(
					(sample) => sample.storyId === storyId,
				);
				const originalHeadNodeId =
					existingForStory[0]?.originalHeadNodeId ??
					store.getHead(storyId)?.id ??
					null;
				const pathNodes =
					originalHeadNodeId === null
						? []
						: store.getPathToNode(originalHeadNodeId);
				const branchPoints = planHistoricalReplaySamples(
					pathNodes,
					{
						interval: parsed.interval,
						rounds: parsed.rounds,
						maxBranchPointsPerStory: parsed.maxBranchPoints,
					},
					(nodeId) =>
						historicalModels.get(parseMessageIndex(storyId, nodeId)) ?? null,
				);
				if (branchPoints.length === 0) {
					log(`${storyId}：没有满足条件的分支点，跳过`);
					continue;
				}
				const settings = store.getStorySettings(storyId);
				const characterPrompt = settings.characterPrompt;
				if (characterPrompt === null || characterPrompt.trim().length === 0) {
					throw new Error(`故事 ${storyId} 没有角色提示词`);
				}
				const maxTokens = store.hasStorySettings(storyId)
					? settings.maxTokens
					: resolveDefaultMaxTokens(config, writerAlias);
				const budgetTokens = writerModelConfig.contextWindow - maxTokens;
				if (budgetTokens <= 0) {
					throw new Error(
						`模型的上下文窗口 ${writerModelConfig.contextWindow} 不大于输出上限 ${maxTokens}，没有可用的输入预算`,
					);
				}
				const turnContext = buildTurnContext({
					store,
					storyId,
					settings,
					characterPrompt,
					budgetTokens,
					writerClient,
					writerModel: writerAlias,
					maxTokens,
					toolTransport: resolveToolTransport(writerModelConfig),
				});
				for (const branch of branchPoints) {
					for (const profile of parsed.profiles) {
						if (
							parsed.limitSamples !== null &&
							sampleCount >= parsed.limitSamples
						) {
							break;
						}
						const sampleId = historicalReplaySampleId(
							storyId,
							branch.branchFloor,
							profile,
						);
						let sample = sampleById.get(sampleId);
						if (sample === undefined) {
							const generatedNodeId = await replayBranchPoint({
								store,
								storyId,
								branch,
								profile,
								rounds: parsed.rounds,
								turnContext,
							});
							sample = {
								sampleId,
								storyId,
								profile,
								branchNodeId: branch.branchNodeId,
								branchFloor: branch.branchFloor,
								historicalNodeId: branch.historicalNodeId,
								generatedNodeId,
								writerModel: writerAlias,
								writerModelId,
								judgeModel: judgeAlias,
								historicalModel: branch.historicalModel,
								sameModel: isSameModel(writerModelId, branch.historicalModel),
								sameFamily: isSameModelFamily(
									writerModelId,
									branch.historicalModel,
								),
								prefixFloors: branch.branchFloor,
								rounds: parsed.rounds,
								interval: parsed.interval,
								maxBranchPointsPerStory: parsed.maxBranchPoints,
								originalHeadNodeId: pathNodes[pathNodes.length - 1].id,
								memory: profile === "native",
								director: profile === "native",
								temperature: settings.temperature,
								maxTokens,
								reasoning: settings.reasoning,
								budgetTokens,
								createdAt: now().toISOString(),
							};
							sampleById.set(sampleId, sample);
							await writeSamples(parsed.samplesPath, [...sampleById.values()]);
							log(
								`${storyId} 第 ${branch.branchFloor} 楼 ${profile}：生成续写 ${generatedNodeId}`,
							);
						}
						sampleCount += 1;
						const texts = readSampleTexts(store, sample);
						if (
							B1_ORDERS.some(
								(order) => !recordedOrders.has(`${sampleId}\u0000${order}`),
							)
						) {
							const records = await judgeHistoricalReplaySample(
								{
									sampleId,
									storyId,
									profile,
									context: texts.context,
									generatedText: texts.generatedText,
									historicalText: texts.historicalText,
								},
								judge,
								{ now: () => now().toISOString() },
							);
							for (const record of records) {
								recordedOrders.add(`${record.sampleId}\u0000${record.order}`);
							}
							newRecords.push(...records);
							log(
								`${sampleId}：${records
									.map((record) =>
										record.status === "done"
											? `${record.order} ${record.winner}`
											: `${record.order} 失败`,
									)
									.join("，")}`,
							);
						}
						const qualitySample = buildHistoricalReplayQualitySample({
							sampleId,
							storyId,
							context: texts.context,
							generatedText: texts.generatedText,
							historicalText: texts.historicalText,
						});
						if (
							!recordedQuality.has(`${sampleId}\u0000accepted`) ||
							!recordedQuality.has(`${sampleId}\u0000abandoned`)
						) {
							const records = await runQualitySample(qualitySample, judge, {
								now: () => now().toISOString(),
							});
							for (const record of records) {
								recordedQuality.add(`${record.sampleId}\u0000${record.side}`);
							}
							newQuality.push(...records);
						}
					}
				}
			} finally {
				store.close();
			}
		}
	}

	const samples = [...sampleById.values()].sort((left, right) =>
		left.sampleId < right.sampleId
			? -1
			: left.sampleId > right.sampleId
				? 1
				: 0,
	);
	const mergedRecords = mergeRecords(existingRecords, newRecords);
	const mergedQuality = mergeQuality(existingQuality, newQuality);
	if (parsed.reportOnly) {
		if (mergedRecords.length === 0) {
			throw new Error(`没有可读的判定记录：${parsed.outPath}`);
		}
		if (samples.length === 0) {
			throw new Error(`没有可读的样本元数据：${parsed.samplesPath}`);
		}
		sampleCount = samples.length;
		writerModel = writerModel || samples[0].writerModel;
		writerModelId = writerModelId || samples[0].writerModelId;
		judgeModel = judgeModel || mergedRecords[0].model;
	}
	if (!parsed.reportOnly) {
		await writeSamples(parsed.samplesPath, samples);
		await writeRecords(parsed.outPath, mergedRecords);
		await writeQuality(parsed.qualityOutPath, mergedQuality);
	}
	const summary = summarizeHistoricalReplay(mergedRecords, samples);
	const qualitySummary = summarizeQuality(mergedQuality);
	const reportOptions = {
		generatedAt,
		writerModel,
		writerModelId,
		judgeModel,
		settings: {
			interval: samples[0]?.interval ?? parsed.interval,
			rounds: samples[0]?.rounds ?? parsed.rounds,
			maxBranchPointsPerStory:
				samples[0]?.maxBranchPointsPerStory ?? parsed.maxBranchPoints,
		},
	};
	const privateText = renderHistoricalReplayReport(
		summary,
		samples,
		qualitySummary,
		{
			...reportOptions,
			privateDetails: true,
			sampleSources: [parsed.samplesPath, parsed.outPath],
		},
	);
	const publicText = renderHistoricalReplayReport(
		summary,
		samples,
		qualitySummary,
		{ ...reportOptions, privateDetails: false },
	);
	await writeFileEnsured(parsed.privateReportPath, privateText);
	await writeFileEnsured(parsed.publicReportPath, publicText);
	const qualityScores = mergedQuality.filter(
		(record) => record.status === "done",
	).length;
	log(
		`B1 历史回放：${sampleCount} 个样本，${summary.records} 条判定（失败 ${summary.failures.length}），${qualityScores} 条有效评分（失败 ${qualitySummary.failures.length}）；报告 ${parsed.publicReportPath}`,
	);
	return {
		sampleCount,
		records: summary.records,
		failures: summary.failures.length,
		qualityScores,
		qualityFailures: qualitySummary.failures.length,
		recordsPath: parsed.outPath,
		samplesPath: parsed.samplesPath,
		qualityRecordsPath: parsed.qualityOutPath,
		privateReportPath: parsed.privateReportPath,
		publicReportPath: parsed.publicReportPath,
	};
}

async function ensureStory(
	store: StoryStore,
	snapshot: Snapshot,
	file: SnapshotManifestFile,
	log: (message: string) => void,
): Promise<void> {
	const storyId = storyIdOf(file);
	if (store.getStory(storyId) !== null) {
		log(`${storyId}：已存在，跳过导入`);
		return;
	}
	const chatPath = await snapshot.resolveFile(file);
	const imported = await importChatFileToStore(store, chatPath, { storyId });
	const { card, worlds } = await loadCardAndWorlds(
		snapshot,
		file.character ?? storyId,
	);
	const content = importCardContent(store, storyId, { card, worlds });
	store.updateStorySettings(storyId, {
		cardName: content.cardName,
		characterPrompt: content.characterPrompt,
	});
	log(
		`${storyId}：导入 ${imported.nodeCount} 个节点、${imported.mainPathNodeIds.length} 楼主路径`,
	);
}

async function loadCardAndWorlds(
	snapshot: Snapshot,
	character: string,
): Promise<{ card: StCharacterCard; worlds: StWorldInfo[] }> {
	const cardFile = snapshot
		.filesByRole("card")
		.find((candidate) => (candidate.character ?? "") === character);
	if (cardFile === undefined) {
		throw new Error(`找不到 ${character} 的角色卡`);
	}
	const card = await parseCharacterCardFile(
		await snapshot.resolveFile(cardFile),
	);
	const worlds: StWorldInfo[] = [];
	for (const file of snapshot
		.filesByRole("worldbook")
		.filter((candidate) => (candidate.character ?? "") === character)) {
		worlds.push(await parseWorldInfoFile(await snapshot.resolveFile(file)));
	}
	return { card, worlds };
}

interface BuildTurnContextOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly settings: StorySettings;
	readonly characterPrompt: string;
	readonly budgetTokens: number;
	readonly writerClient: LlmStreamingClient;
	readonly writerModel: string;
	readonly maxTokens: number;
	readonly toolTransport: LlmToolTransport;
}

function buildTurnContext(options: BuildTurnContextOptions): TurnContext {
	const { store, storyId, settings } = options;
	return {
		store,
		client: options.writerClient,
		storyId,
		budgetTokens: options.budgetTokens,
		structuredOutput: settings.structuredOutput,
		toolTransport: options.toolTransport,
		model: options.writerModel,
		maxTokens: options.maxTokens,
		temperature: settings.temperature,
		reasoning: settings.reasoning,
		viewpoint: settings.viewpoint,
		native: {
			template: resolveStoryContextTemplate(
				store,
				settings.templateId,
				settings.structuredOutput,
			),
			providers: createStandardChatProviders({
				store,
				characterPrompt: options.characterPrompt,
				embedder: null,
				directorConfig: settings.directorConfig,
				historyBlockPolicy: settings.historyBlockPolicy,
			}),
		},
		naive: {
			template: createNaiveContextTemplate(),
			providers: createNaiveChatProviders({
				store,
				characterPrompt: options.characterPrompt,
				persona: settings.persona,
			}),
		},
	};
}

interface ReplayBranchPointOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly branch: HistoricalReplayBranchPoint;
	readonly profile: B1Profile;
	readonly rounds: number;
	readonly turnContext: TurnContext;
}

async function replayBranchPoint(
	options: ReplayBranchPointOptions,
): Promise<string> {
	const { store, storyId, branch, profile, turnContext } = options;
	store.setHead(storyId, branch.branchNodeId);
	const head = store.getHead(storyId);
	if (head?.id !== branch.branchNodeId) {
		throw new Error(`无法把 head 移到分支点 ${branch.branchNodeId}`);
	}
	const segment = profile === "native" ? turnContext.native : turnContext.naive;
	let firstNodeId: string | null = null;
	for (const userText of branch.userTexts.slice(0, options.rounds)) {
		const result = await runChatTurn({
			store,
			client: turnContext.client,
			storyId,
			userText,
			template: segment.template,
			providers: segment.providers,
			budgetTokens: turnContext.budgetTokens,
			structuredOutput: turnContext.structuredOutput,
			toolTransport: turnContext.toolTransport,
			model: turnContext.model,
			maxTokens: turnContext.maxTokens,
			temperature: turnContext.temperature,
			reasoning: turnContext.reasoning,
			viewpoint: turnContext.viewpoint,
			profile,
		});
		firstNodeId ??= result.node.id;
	}
	if (firstNodeId === null) {
		throw new Error(`分支点 ${branch.branchNodeId} 没有可回放的玩家消息`);
	}
	return firstNodeId;
}

function readSampleTexts(
	store: StoryStore,
	sample: HistoricalReplaySample,
): {
	readonly context: string;
	readonly generatedText: string;
	readonly historicalText: string;
} {
	const generated = store.getNode(sample.generatedNodeId);
	const historical = store.getNode(sample.historicalNodeId);
	if (generated === null) {
		throw new Error(`样本 ${sample.sampleId} 的续写楼层不存在`);
	}
	if (historical === null) {
		throw new Error(`样本 ${sample.sampleId} 的历史回复楼层不存在`);
	}
	return {
		context: formatPairwiseContext(store.getPathToNode(sample.branchNodeId)),
		generatedText: displayText(generated.raw),
		historicalText: displayText(historical.raw),
	};
}

/** 去掉不入上下文与阅读视图的块；渲染结果为空时退回原文。 */
function displayText(raw: string): string {
	const rendered = renderContextView(parseBlocks(raw)).trim();
	return rendered.length > 0 ? rendered : raw;
}

async function readHistoricalModels(
	chatPath: string,
): Promise<Map<number, string | null>> {
	const models = new Map<number, string | null>();
	for await (const entry of parseChatJsonlFile(chatPath)) {
		if (entry.kind !== "message") continue;
		const message = entry.message;
		if (message.isUser || message.isSystem) continue;
		const extra = message.raw.extra;
		const model =
			isJsonObject(extra) &&
			typeof extra.model === "string" &&
			extra.model.trim().length > 0
				? extra.model
				: null;
		models.set(message.index, model);
	}
	return models;
}

function sanitizeName(value: string): string {
	return value.replace(/[\\/:*?"<>|]/g, "_");
}

async function readSamples(
	filePath: string,
): Promise<HistoricalReplaySample[]> {
	if (!existsSync(filePath)) return [];
	return parseHistoricalReplaySamplesJsonl(
		await readFile(filePath, "utf8"),
		filePath,
	);
}

async function readRecords(
	filePath: string,
): Promise<HistoricalReplayRecord[]> {
	if (!existsSync(filePath)) return [];
	return parseHistoricalReplayRecordsJsonl(
		await readFile(filePath, "utf8"),
		filePath,
	);
}

async function readQuality(filePath: string): Promise<QualityRecord[]> {
	if (!existsSync(filePath)) return [];
	return parseQualityRecordsJsonl(await readFile(filePath, "utf8"), filePath);
}

function mergeRecords(
	existing: readonly HistoricalReplayRecord[],
	fresh: readonly HistoricalReplayRecord[],
): HistoricalReplayRecord[] {
	const merged = new Map<string, HistoricalReplayRecord>();
	for (const record of [...existing, ...fresh]) {
		merged.set(`${record.sampleId}\u0000${record.order}`, record);
	}
	return [...merged.values()].sort((left, right) => {
		if (left.sampleId !== right.sampleId) {
			return left.sampleId < right.sampleId ? -1 : 1;
		}
		return B1_ORDERS.indexOf(left.order) - B1_ORDERS.indexOf(right.order);
	});
}

function mergeQuality(
	existing: readonly QualityRecord[],
	fresh: readonly QualityRecord[],
): QualityRecord[] {
	const merged = new Map<string, QualityRecord>();
	for (const record of [...existing, ...fresh]) {
		merged.set(`${record.sampleId}\u0000${record.side}`, record);
	}
	return [...merged.values()].sort((left, right) => {
		if (left.sampleId !== right.sampleId) {
			return left.sampleId < right.sampleId ? -1 : 1;
		}
		return left.side === "accepted" ? -1 : 1;
	});
}

async function writeSamples(
	filePath: string,
	samples: readonly HistoricalReplaySample[],
): Promise<void> {
	const sorted = [...samples].sort((left, right) =>
		left.sampleId < right.sampleId
			? -1
			: left.sampleId > right.sampleId
				? 1
				: 0,
	);
	await writeFileEnsured(
		filePath,
		sorted.map((sample) => `${JSON.stringify(sample)}\n`).join(""),
	);
}

async function writeRecords(
	filePath: string,
	records: readonly HistoricalReplayRecord[],
): Promise<void> {
	await writeFileEnsured(
		filePath,
		records.map((record) => `${JSON.stringify(record)}\n`).join(""),
	);
}

async function writeQuality(
	filePath: string,
	records: readonly QualityRecord[],
): Promise<void> {
	await writeFileEnsured(
		filePath,
		records.map((record) => `${JSON.stringify(record)}\n`).join(""),
	);
}

async function writeFileEnsured(filePath: string, text: string): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, text, "utf8");
}

const ACCEPTED_ARG_KEYS: Readonly<Record<string, true>> = {
	root: true,
	"db-dir": true,
	out: true,
	"samples-out": true,
	"quality-out": true,
	"private-report": true,
	"public-report": true,
	model: true,
	"judge-model": true,
	"judge-max-tokens": true,
	interval: true,
	rounds: true,
	"max-branch-points": true,
	profiles: true,
	"limit-samples": true,
	channels: true,
};

function parseArgs(args: readonly string[]): ParsedArgs {
	const values = new Map<string, string>();
	const flags = new Set<string>();
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (!arg.startsWith("--")) {
			throw new Error(`多余的参数 ${arg}；${USAGE}`);
		}
		const equals = arg.indexOf("=");
		const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
		if (key === "resume" || key === "report-only") {
			if (equals !== -1) {
				throw new Error(`--${key} 不接受值；${USAGE}`);
			}
			if (flags.has(key)) {
				throw new Error(`参数 --${key} 重复；${USAGE}`);
			}
			flags.add(key);
			continue;
		}
		if (ACCEPTED_ARG_KEYS[key] !== true) {
			throw new Error(`不认识的参数 --${key}；${USAGE}`);
		}
		if (values.has(key)) {
			throw new Error(`参数 --${key} 重复；${USAGE}`);
		}
		const value = equals === -1 ? args[index + 1] : arg.slice(equals + 1);
		if (equals === -1) index += 1;
		if (value === undefined || value.trim().length === 0) {
			throw new Error(`--${key} 后面必须写值；${USAGE}`);
		}
		values.set(key, value);
	}
	const reportDir = path.join(repoRoot, "eval-private", "reports", "R2-b1");
	return {
		root: values.get("root") ?? path.join(repoRoot, "eval-private", "raw"),
		dbDir: values.get("db-dir") ?? path.join(reportDir, "db"),
		outPath: values.get("out") ?? path.join(reportDir, "records.jsonl"),
		samplesPath:
			values.get("samples-out") ?? path.join(reportDir, "samples.jsonl"),
		qualityOutPath:
			values.get("quality-out") ?? path.join(reportDir, "quality.jsonl"),
		privateReportPath:
			values.get("private-report") ??
			path.join(repoRoot, "eval-private", "reports", "R2-b1.md"),
		publicReportPath:
			values.get("public-report") ??
			path.join(repoRoot, "docs", "dev", "reports", "R2-b1.md"),
		model: values.get("model") ?? null,
		judgeModel: values.get("judge-model") ?? null,
		judgeMaxTokens:
			values.get("judge-max-tokens") === undefined
				? DEFAULT_B1_JUDGE_MAX_TOKENS
				: parsePositiveInt(
						values.get("judge-max-tokens") as string,
						"--judge-max-tokens",
					),
		interval:
			values.get("interval") === undefined
				? DEFAULT_B1_INTERVAL
				: parsePositiveInt(values.get("interval") as string, "--interval"),
		rounds:
			values.get("rounds") === undefined
				? DEFAULT_B1_ROUNDS
				: parsePositiveInt(values.get("rounds") as string, "--rounds"),
		maxBranchPoints:
			values.get("max-branch-points") === undefined
				? DEFAULT_B1_MAX_BRANCH_POINTS
				: parsePositiveInt(
						values.get("max-branch-points") as string,
						"--max-branch-points",
					),
		profiles: parseProfiles(values.get("profiles")),
		limitSamples:
			values.get("limit-samples") === undefined
				? null
				: parsePositiveInt(
						values.get("limit-samples") as string,
						"--limit-samples",
					),
		resume: flags.has("resume"),
		reportOnly: flags.has("report-only"),
		channelsPath: values.get("channels") ?? null,
	};
}

function parseProfiles(value: string | undefined): readonly B1Profile[] {
	if (value === undefined) return ["native", "naive"];
	const profiles = value.split(",").map((entry) => entry.trim());
	if (profiles.length === 0) {
		throw new Error(`--profiles 至少写一个档位；${USAGE}`);
	}
	for (const profile of profiles) {
		if (profile !== "native" && profile !== "naive") {
			throw new Error(`--profiles 只接受 native 与 naive，收到 ${profile}`);
		}
	}
	return [...new Set(profiles)] as B1Profile[];
}

function parsePositiveInt(value: string, name: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} 必须是正整数：${value}`);
	}
	return parsed;
}

async function main(): Promise<void> {
	await runHistoricalReplayCli(process.argv.slice(2));
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
