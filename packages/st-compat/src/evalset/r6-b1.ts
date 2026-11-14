import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	type EmbeddingClient,
	type LlmClient,
	type LlmReasoningLevel,
	type LlmStreamingClient,
	type LlmToolTransport,
	type StoryStore,
	StoryStore as StoryStoreClass,
	type StructuredOutputMode,
	type TimelineNode,
	createStandardChatSlots,
	modelFamily,
	parseBlocks,
	renderContextView,
	runChatTurn,
} from "@dramaticer/core";
import { resolveStoryContextTemplate } from "../chat/session.js";
import {
	type R6B1GateInput,
	type R6PairCounts,
	type R6PairOutcome,
	type R6PairSide,
	R6_B1_MIN_COMPLETED_PAIRS,
	R6_GATE_VERSION,
	R6_MAX_BRANCH_POINTS,
	R6_STORY_COUNT,
	type WilsonInterval,
	normalizePairOutcome,
	wilsonInterval,
} from "./gates.js";
import {
	B1_ORDERS,
	type HistoricalReplayRecord,
	buildHistoricalReplayQualitySample,
	judgeHistoricalReplaySample,
	normalizeB1Winner,
} from "./historical-replay.js";
import { formatPairwiseContext } from "./pairwise.js";
import {
	type QualityRecord,
	type QualitySummary,
	runQualitySample,
	summarizeQuality,
} from "./quality.js";
import {
	type R6WarmupRecord,
	countStreamingClient,
	planR6BranchPoints,
	prepareR6RunCopy,
	warmupR6Copy,
} from "./r6-compare.js";

export const R6_B1_FORMAT = "dramaticer.r6-b1";
export const R6_B1_RUN_FORMAT = "dramaticer.r6-b1-run";
export const DEFAULT_R6_B1_SEED = 1;

/** 一个配对样本：分支点、其后第一条真实玩家消息与当时的历史回复。 */
export interface R6B1Sample {
	readonly sampleId: string;
	readonly story: string;
	readonly branchNodeId: string;
	readonly branchFloor: number;
	readonly userText: string;
	readonly historicalNodeId: string;
	readonly historicalModel: string | null;
}

export interface R6B1Options {
	/** 已导入故事与卡的数据库；每个分支点复制一份。 */
	readonly sourceDbPath: string;
	readonly stories: readonly string[];
	readonly dir: string;
	readonly writer: {
		readonly client: LlmStreamingClient;
		readonly model: string;
		/** 渠道配置里的完整模型标识；同模型与同家族判定用它。 */
		readonly modelId?: string;
	};
	readonly judge: { readonly client: LlmClient; readonly model: string };
	/** 预热 settle 与 scene 用；B1 不在回合后执行后台任务。 */
	readonly background: { readonly client: LlmClient };
	readonly structuredOutput: StructuredOutputMode;
	readonly budgetTokens: number;
	readonly toolTransport?: LlmToolTransport | null;
	readonly embedder?: EmbeddingClient | null;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly reasoning?: LlmReasoningLevel;
	readonly seed?: number;
	/** 只跑指定的分支点楼层，用于缩样；不设置时按预注册取全部，最多 10 个。 */
	readonly branchFloors?: readonly number[];
	/** 历史回复模型；键可以是节点 id 或 `<故事>:<楼层>`。 */
	readonly historicalModels?: Readonly<Record<string, string>>;
	readonly log?: (message: string) => void;
	readonly now?: () => number;
}

export interface R6B1GenerationRecord {
	readonly firstTokenMs: number | null;
	readonly durationMs: number | null;
	readonly writerRequests: number;
	readonly promptTokens: number;
	readonly completionTokens: number;
}

/** 一个分支点的运行记录；同时是续跑用的 sidecar。 */
export interface R6B1RunRecord {
	readonly format: typeof R6_B1_RUN_FORMAT;
	readonly sampleId: string;
	readonly story: string;
	readonly branchFloor: number;
	readonly branchNodeId: string;
	readonly historicalNodeId: string;
	readonly userText: string;
	readonly writerModel: string;
	readonly judgeModel: string;
	readonly seed: number;
	readonly warmup: R6WarmupRecord;
	readonly status: "running" | "done" | "failed";
	readonly error: string | null;
	readonly generatedNodeId: string | null;
	readonly generatedText: string | null;
	readonly historicalText: string | null;
	readonly generation: R6B1GenerationRecord | null;
	readonly judgments: readonly HistoricalReplayRecord[];
	readonly quality: readonly QualityRecord[];
	/** 生成与两种顺序都完成后的配对结果；失败时为 null。 */
	readonly outcome: R6PairOutcome | null;
	readonly outcomeError: string | null;
	readonly startedAt: string;
	readonly finishedAt: string | null;
}

export interface R6B1StorySummary {
	readonly story: string;
	readonly plannedPairs: number;
	readonly completedPairs: number;
	readonly wins: number;
	readonly losses: number;
	readonly ties: number;
	readonly inconsistent: number;
	readonly failures: number;
}

export interface R6B1ModelFamily {
	readonly model: string;
	readonly family: string;
	readonly samples: number;
}

export interface R6B1Summary {
	readonly plannedPairs: number;
	readonly completedPairs: number;
	readonly pairs: R6PairCounts;
	readonly failures: number;
	readonly judgementsCompleted: number;
	readonly judgementsFailed: number;
	readonly winRate: number | null;
	readonly wilson: WilsonInterval | null;
	readonly excludedShare: number | null;
	readonly inconsistentShare: number | null;
	readonly judgeFailureShare: number | null;
	readonly insufficient: boolean;
	readonly insufficientReason: string | null;
	readonly stories: readonly R6B1StorySummary[];
	readonly modelFamilies: {
		readonly writer: R6B1ModelFamily;
		readonly judge: R6B1ModelFamily;
		readonly historical: readonly R6B1ModelFamily[];
	};
	readonly quality: QualitySummary;
}

export interface R6B1Report {
	readonly format: typeof R6_B1_FORMAT;
	readonly gateVersion: string;
	readonly generatedAt: string;
	readonly stories: readonly string[];
	readonly seed: number;
	readonly plannedPairs: number;
	readonly samples: readonly R6B1Sample[];
	readonly runs: readonly R6B1RunRecord[];
	readonly summary: R6B1Summary;
}

type MutableRun = { -readonly [K in keyof R6B1RunRecord]: R6B1RunRecord[K] };

interface B1RunOptions extends R6B1Options {
	readonly story: string;
	readonly sample: R6B1Sample;
	readonly seed: number;
	readonly log: (message: string) => void;
	readonly now: () => number;
}

/**
 * 按路径深度取分支点，再定位其后的第一条非空玩家消息与历史回复。
 * 分支点上限与 C1 相同：每故事最多 10 个。
 */
export function planR6B1Samples(
	story: string,
	path: readonly TimelineNode[],
	options: {
		readonly maxBranchPoints?: number;
		readonly historicalModelOf?: (
			nodeId: string,
			branchFloor: number,
		) => string | null;
	} = {},
): R6B1Sample[] {
	const maxBranchPoints = options.maxBranchPoints ?? R6_MAX_BRANCH_POINTS;
	const points = planR6BranchPoints(path, maxBranchPoints);
	const indexById = new Map(path.map((node, index) => [node.id, index]));
	return points.map((point) => {
		const index = indexById.get(point.nodeId);
		if (index === undefined) {
			throw new Error(`分支点 ${point.nodeId} 不在主路径上`);
		}
		let userIndex = -1;
		for (let next = index + 1; next < path.length; next += 1) {
			const node = path[next];
			if (node === undefined) break;
			if (node.role !== "user" || node.raw.trim().length === 0) continue;
			userIndex = next;
			break;
		}
		if (userIndex < 0) {
			throw new Error(`分支点 ${point.nodeId} 之后没有玩家消息`);
		}
		const userNode = path[userIndex] as TimelineNode;
		let historical: TimelineNode | null = null;
		for (let next = userIndex + 1; next < path.length; next += 1) {
			const node = path[next];
			if (node === undefined) break;
			if (node.role !== "assistant" || node.raw.trim().length === 0) continue;
			historical = node;
			break;
		}
		if (historical === null) {
			throw new Error(`分支点 ${point.nodeId} 之后没有历史回复`);
		}
		return {
			sampleId: r6B1SampleId(story, point.floor),
			story,
			branchNodeId: point.nodeId,
			branchFloor: point.floor,
			userText: userNode.raw,
			historicalNodeId: historical.id,
			historicalModel:
				options.historicalModelOf?.(historical.id, point.floor) ?? null,
		};
	});
}

export function r6B1SampleId(story: string, branchFloor: number): string {
	return `${story}:${branchFloor}:b1`;
}

/** 每个分支点复制一份源数据库、预热 12 楼、生成一次续写，再与历史回复配对。 */
export async function runR6B1(options: R6B1Options): Promise<R6B1Report> {
	const seed = options.seed ?? DEFAULT_R6_B1_SEED;
	assertOptions(options, seed);
	const log = options.log ?? (() => undefined);
	const now = options.now ?? Date.now;
	const stories = [...new Set(options.stories)];
	const planned = await planStories(options, stories);
	const runs: R6B1RunRecord[] = [];
	for (const story of stories) {
		for (const sample of planned.get(story) ?? []) {
			log(
				`${story} 第 ${sample.branchFloor} 楼：生成续写并配对（玩家消息「${truncate(sample.userText, 24)}」）`,
			);
			runs.push(
				await runSample({
					...options,
					story,
					sample,
					seed,
					log,
					now,
				}),
			);
		}
	}
	const samples = stories.flatMap((story) => planned.get(story) ?? []);
	return {
		format: R6_B1_FORMAT,
		gateVersion: R6_GATE_VERSION,
		generatedAt: new Date(now()).toISOString(),
		stories,
		seed,
		plannedPairs: samples.length,
		samples,
		runs,
		summary: summarizeR6B1({
			samples,
			runs,
			writerModel: options.writer.model,
			judgeModel: options.judge.model,
		}),
	};
}

/** 配对与模型家族汇总；改动前面板门槛只用 G1 的输入字段。 */
export function summarizeR6B1(input: {
	readonly samples: readonly R6B1Sample[];
	readonly runs: readonly R6B1RunRecord[];
	readonly writerModel: string;
	readonly judgeModel: string;
}): R6B1Summary {
	const runById = new Map(input.runs.map((run) => [run.sampleId, run]));
	const storyIds = [...new Set(input.samples.map((sample) => sample.story))];
	const stories: R6B1StorySummary[] = storyIds.map((story) =>
		summarizeStory(
			story,
			input.samples.filter((sample) => sample.story === story),
			runById,
		),
	);
	const pairs = {
		wins: sum(stories, (story) => story.wins),
		losses: sum(stories, (story) => story.losses),
		ties: sum(stories, (story) => story.ties),
		inconsistent: sum(stories, (story) => story.inconsistent),
	};
	const failures = sum(stories, (story) => story.failures);
	const plannedPairs = input.samples.length;
	const completedPairs =
		pairs.wins + pairs.losses + pairs.ties + pairs.inconsistent;
	const decided = pairs.wins + pairs.losses;
	const judgements = input.runs.flatMap((run) => run.judgments);
	const judgementsCompleted = judgements.filter(
		(record) => record.status === "done",
	).length;
	const judgementsFailed = judgements.filter(
		(record) => record.status === "failed",
	).length;
	const judgeTotal = judgementsCompleted + judgementsFailed;
	const wilson = wilsonInterval(pairs.wins, decided);
	const excluded = pairs.ties + pairs.inconsistent + failures;
	const coveredStories = stories.filter(
		(story) => story.completedPairs > 0,
	).length;
	let insufficientReason: string | null = null;
	if (
		completedPairs < R6_B1_MIN_COMPLETED_PAIRS ||
		coveredStories < R6_STORY_COUNT
	) {
		insufficientReason = `完成配对 ${completedPairs}（至少 ${R6_B1_MIN_COMPLETED_PAIRS}）、覆盖故事 ${coveredStories}（至少 ${R6_STORY_COUNT}），样本不足`;
	}
	return {
		plannedPairs,
		completedPairs,
		pairs,
		failures,
		judgementsCompleted,
		judgementsFailed,
		winRate: decided === 0 ? null : pairs.wins / decided,
		wilson,
		excludedShare: plannedPairs === 0 ? null : excluded / plannedPairs,
		inconsistentShare:
			completedPairs === 0 ? null : pairs.inconsistent / completedPairs,
		judgeFailureShare: judgeTotal === 0 ? null : judgementsFailed / judgeTotal,
		insufficient: insufficientReason !== null,
		insufficientReason,
		stories,
		modelFamilies: {
			writer: {
				model: input.writerModel,
				family: modelFamily(input.writerModel),
				samples: plannedPairs,
			},
			judge: {
				model: input.judgeModel,
				family: modelFamily(input.judgeModel),
				samples: plannedPairs,
			},
			historical: summarizeHistoricalFamilies(input.samples),
		},
		quality: summarizeQuality(input.runs.flatMap((run) => run.quality)),
	};
}

function summarizeStory(
	story: string,
	samples: readonly R6B1Sample[],
	runById: ReadonlyMap<string, R6B1RunRecord>,
): R6B1StorySummary {
	let wins = 0;
	let losses = 0;
	let ties = 0;
	let inconsistent = 0;
	let failures = 0;
	for (const sample of samples) {
		const run = runById.get(sample.sampleId);
		if (run === undefined || run.outcome === null) {
			failures += 1;
			continue;
		}
		if (run.outcome === "win") wins += 1;
		else if (run.outcome === "loss") losses += 1;
		else if (run.outcome === "tie") ties += 1;
		else if (run.outcome === "inconsistent") inconsistent += 1;
		else failures += 1;
	}
	return {
		story,
		plannedPairs: samples.length,
		completedPairs: wins + losses + ties + inconsistent,
		wins,
		losses,
		ties,
		inconsistent,
		failures,
	};
}

function summarizeHistoricalFamilies(
	samples: readonly R6B1Sample[],
): R6B1ModelFamily[] {
	const counts = new Map<string, number>();
	for (const sample of samples) {
		if (sample.historicalModel === null) continue;
		counts.set(
			sample.historicalModel,
			(counts.get(sample.historicalModel) ?? 0) + 1,
		);
	}
	return [...counts.entries()]
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([model, count]) => ({
			model,
			family: modelFamily(model),
			samples: count,
		}));
}

/** 把批次汇总换成 G1 的判定输入；其余门槛由 C1 与 C3 提供。 */
export function r6B1GateInput(summary: R6B1Summary): R6B1GateInput {
	return {
		plannedPairs: summary.plannedPairs,
		pairs: summary.pairs,
		failures: summary.failures,
		stories: summary.stories.map((story) => ({
			story: story.story,
			completedPairs: story.completedPairs,
		})),
		judgments: {
			completed: summary.judgementsCompleted,
			failed: summary.judgementsFailed,
		},
	};
}

async function planStories(
	options: R6B1Options,
	stories: readonly string[],
): Promise<Map<string, R6B1Sample[]>> {
	if (options.branchFloors !== undefined && stories.length !== 1) {
		throw new Error("分支点楼层只能和单个故事一起使用");
	}
	const store = StoryStoreClass.open(options.sourceDbPath);
	try {
		const planned = new Map<string, R6B1Sample[]>();
		for (const story of stories) {
			if (store.getStory(story) === null) {
				throw new Error(`数据库 ${options.sourceDbPath} 里没有故事 ${story}`);
			}
			const samples = planR6B1Samples(story, store.getPathToHead(story), {
				historicalModelOf: (nodeId, branchFloor) =>
					lookupHistoricalModel(options, story, nodeId, branchFloor),
			});
			if (samples.length === 0) {
				throw new Error(`故事 ${story} 的主路径上没有可用的分支点`);
			}
			planned.set(
				story,
				options.branchFloors === undefined
					? samples
					: pickBranchFloors(samples, options.branchFloors, story),
			);
		}
		return planned;
	} finally {
		store.close();
	}
}

function lookupHistoricalModel(
	options: R6B1Options,
	story: string,
	nodeId: string,
	branchFloor: number,
): string | null {
	const models = options.historicalModels;
	if (models === undefined) return null;
	return models[nodeId] ?? models[`${story}:${branchFloor}`] ?? null;
}

function pickBranchFloors(
	samples: readonly R6B1Sample[],
	floors: readonly number[],
	story: string,
): R6B1Sample[] {
	if (floors.length === 0) {
		throw new Error("分支点列表不能为空");
	}
	const available = new Map(
		samples.map((sample) => [sample.branchFloor, sample]),
	);
	return floors.map((floor) => {
		const sample = available.get(floor);
		if (sample === undefined) {
			throw new Error(
				`故事 ${story} 没有楼层 ${floor} 的分支点；可用楼层：${[...available.keys()].join("、")}`,
			);
		}
		return sample;
	});
}

function assertOptions(options: R6B1Options, seed: number): void {
	if (!Number.isInteger(seed) || seed < 0) {
		throw new Error(`随机种子必须是非负整数，收到 ${seed}`);
	}
	if (options.stories.length === 0) {
		throw new Error("至少需要一个故事");
	}
	for (const story of options.stories) {
		if (story.trim().length === 0) throw new Error("故事 id 不能为空");
	}
	if (!Number.isInteger(options.budgetTokens) || options.budgetTokens < 1) {
		throw new Error(`token 预算必须是正整数，收到 ${options.budgetTokens}`);
	}
	if (options.sourceDbPath.trim().length === 0) {
		throw new Error("源数据库路径不能为空");
	}
}

async function runSample(options: B1RunOptions): Promise<R6B1RunRecord> {
	const file = sidecarFile(options);
	const existing = await loadSidecar(file);
	if (existing !== null) {
		validateSidecar(existing, file, options);
		if (existing.status !== "running") {
			options.log(`${options.sample.sampleId}：复用已完成的样本`);
			return existing;
		}
		options.log(`${options.sample.sampleId}：从 sidecar 续跑`);
	}
	const runDir = path.dirname(file);
	const dbPath = path.join(runDir, "native.db");
	await mkdir(runDir, { recursive: true });
	const store = await openRunStore(existing, dbPath, options);
	try {
		const settings = store.getStorySettings(options.story);
		const template = resolveStoryContextTemplate(
			store,
			settings.templateId,
			options.structuredOutput,
		);
		const slots = await createStandardChatSlots({
			store,
			characterPrompt: settings.characterPrompt,
			embedder: options.embedder,
			directorConfig: settings.directorConfig,
			historyBlockPolicy: settings.historyBlockPolicy,
			worldModel: settings.worldModel,
			directorOrganization: settings.directorOrganization,
		});
		const run: MutableRun =
			existing === null
				? {
						format: R6_B1_RUN_FORMAT,
						sampleId: options.sample.sampleId,
						story: options.story,
						branchFloor: options.sample.branchFloor,
						branchNodeId: options.sample.branchNodeId,
						historicalNodeId: options.sample.historicalNodeId,
						userText: options.sample.userText,
						writerModel: options.writer.model,
						judgeModel: options.judge.model,
						seed: options.seed,
						warmup: {
							floorNodeIds: [],
							settleRequests: 0,
							sceneRequests: 0,
							cachedRequests: 0,
						},
						status: "running",
						error: null,
						generatedNodeId: null,
						generatedText: null,
						historicalText: null,
						generation: null,
						judgments: [],
						quality: [],
						outcome: null,
						outcomeError: null,
						startedAt: new Date(options.now()).toISOString(),
						finishedAt: null,
					}
				: {
						...existing,
						judgments: [...existing.judgments],
						quality: [...existing.quality],
					};
		if (existing === null) {
			run.warmup = await warmupR6Copy({
				store,
				storyId: options.story,
				branchNodeId: options.sample.branchNodeId,
				client: options.background.client,
				now: options.now,
			});
			options.log(
				`${options.sample.sampleId}：预热 ${run.warmup.floorNodeIds.length} 楼，请求 ${run.warmup.settleRequests + run.warmup.sceneRequests}`,
			);
			await saveSidecar(file, run);
		}
		if (run.generatedNodeId === null) {
			store.setHead(options.story, options.sample.branchNodeId);
			const writer = countStreamingClient(options.writer.client);
			try {
				const result = await runChatTurn({
					store,
					client: writer.client,
					storyId: options.story,
					userText: options.sample.userText,
					template,
					providers: slots.providers,
					budgetTokens: options.budgetTokens,
					structuredOutput: options.structuredOutput,
					turnMode: "fast",
					profile: "native",
					toolTransport: options.toolTransport,
					embedder: options.embedder,
					viewpoint: settings.viewpoint,
					model: options.writer.model,
					maxTokens: options.maxTokens ?? settings.maxTokens,
					temperature: options.temperature ?? settings.temperature,
					reasoning: options.reasoning ?? settings.reasoning,
					now: options.now,
				});
				run.generatedNodeId = result.node.id;
				run.generatedText = result.node.raw;
				run.generation = {
					firstTokenMs: result.trace.timing.firstTokenMs,
					durationMs: result.trace.timing.durationMs,
					writerRequests: writer.stats.requests,
					promptTokens: result.trace.llm.usage.promptTokens ?? 0,
					completionTokens: result.trace.llm.usage.completionTokens ?? 0,
				};
			} catch (caught) {
				run.status = "failed";
				run.error = caught instanceof Error ? caught.message : String(caught);
				run.finishedAt = new Date(options.now()).toISOString();
				await saveSidecar(file, run);
				options.log(`${options.sample.sampleId}：生成失败：${run.error}`);
				return run;
			}
			await saveSidecar(file, run);
			options.log(
				`${options.sample.sampleId}：生成 ${run.generatedNodeId}，首字 ${run.generation.firstTokenMs ?? "—"} 毫秒`,
			);
		} else {
			store.setHead(options.story, run.generatedNodeId);
		}
		const generated = store.getNode(run.generatedNodeId);
		const historical = store.getNode(options.sample.historicalNodeId);
		if (generated === null) {
			throw new Error(`续写楼层 ${run.generatedNodeId} 不在运行副本里`);
		}
		if (historical === null) {
			throw new Error(
				`历史回复楼层 ${options.sample.historicalNodeId} 不在运行副本里`,
			);
		}
		run.generatedText = generated.raw;
		run.historicalText = historical.raw;
		const context = formatPairwiseContext(
			store.getPathToNode(options.sample.branchNodeId),
		);
		const knownOrders = new Set(run.judgments.map((record) => record.order));
		if (B1_ORDERS.some((order) => !knownOrders.has(order))) {
			const records = await judgeHistoricalReplaySample(
				{
					sampleId: options.sample.sampleId,
					storyId: options.story,
					profile: "native",
					context,
					generatedText: displayText(generated.raw),
					historicalText: displayText(historical.raw),
				},
				options.judge,
				{ now: () => new Date(options.now()).toISOString() },
			);
			run.judgments = mergeJudgments(run.judgments, records);
			await saveSidecar(file, run);
			options.log(
				`${options.sample.sampleId}：${records
					.map((record) =>
						record.status === "done"
							? `${record.order} ${record.winner}`
							: `${record.order} 失败`,
					)
					.join("，")}`,
			);
		}
		const knownSides = new Set(run.quality.map((record) => record.side));
		if (!knownSides.has("accepted") || !knownSides.has("abandoned")) {
			const quality = await runQualitySample(
				buildHistoricalReplayQualitySample({
					sampleId: options.sample.sampleId,
					storyId: options.story,
					context,
					generatedText: displayText(generated.raw),
					historicalText: displayText(historical.raw),
				}),
				options.judge,
				{ now: () => new Date(options.now()).toISOString() },
			);
			run.quality = mergeQuality(run.quality, quality);
			await saveSidecar(file, run);
		}
		const verdict = computeOutcome(run.judgments);
		run.outcome = verdict.outcome;
		run.outcomeError = verdict.error;
		run.status = "done";
		run.finishedAt = new Date(options.now()).toISOString();
		await saveSidecar(file, run);
		return run;
	} finally {
		store.close();
	}
}

/** 两种展示顺序都完成时才能归入胜、负、平或换序不一致。 */
function computeOutcome(records: readonly HistoricalReplayRecord[]): {
	readonly outcome: R6PairOutcome | null;
	readonly error: string | null;
} {
	const latest = new Map<string, HistoricalReplayRecord>();
	for (const record of records) latest.set(record.order, record);
	const missing = B1_ORDERS.filter((order) => !latest.has(order));
	if (missing.length > 0) {
		return { outcome: null, error: `缺少判定顺序：${missing.join("、")}` };
	}
	const sides: R6PairSide[] = [];
	const errors: string[] = [];
	for (const order of B1_ORDERS) {
		const record = latest.get(order) as HistoricalReplayRecord;
		if (record.status !== "done") {
			errors.push(`${order}：${record.error ?? "未知错误"}`);
			continue;
		}
		const normalized = normalizeB1Winner(order, record.winner);
		sides.push(
			normalized === "generated"
				? "candidate"
				: normalized === "historical"
					? "baseline"
					: "tie",
		);
	}
	if (errors.length > 0 || sides.length !== B1_ORDERS.length) {
		return {
			outcome: null,
			error: errors.length > 0 ? errors.join("；") : "判定不完整",
		};
	}
	return {
		outcome: normalizePairOutcome(
			sides[0] as R6PairSide,
			sides[1] as R6PairSide,
		),
		error: null,
	};
}

function mergeJudgments(
	existing: readonly HistoricalReplayRecord[],
	fresh: readonly HistoricalReplayRecord[],
): HistoricalReplayRecord[] {
	const merged = new Map<string, HistoricalReplayRecord>();
	for (const record of [...existing, ...fresh]) {
		merged.set(record.order, record);
	}
	return B1_ORDERS.flatMap((order) => {
		const record = merged.get(order);
		return record === undefined ? [] : [record];
	});
}

function mergeQuality(
	existing: readonly QualityRecord[],
	fresh: readonly QualityRecord[],
): QualityRecord[] {
	const merged = new Map<string, QualityRecord>();
	for (const record of [...existing, ...fresh]) {
		merged.set(record.side, record);
	}
	return ["accepted", "abandoned"].flatMap((side) => {
		const record = merged.get(side);
		return record === undefined ? [] : [record];
	});
}

/** 去掉不入上下文与阅读视图的块；渲染结果为空时退回原文。 */
function displayText(raw: string): string {
	const rendered = renderContextView(parseBlocks(raw)).trim();
	return rendered.length > 0 ? rendered : raw;
}

async function openRunStore(
	existing: R6B1RunRecord | null,
	dbPath: string,
	options: B1RunOptions,
): Promise<StoryStore> {
	if (existing === null) {
		return prepareR6RunCopy({
			sourceDbPath: options.sourceDbPath,
			story: options.story,
			branchNodeId: options.sample.branchNodeId,
			dbPath,
		});
	}
	if (!existsSync(dbPath)) {
		throw new Error(
			`续跑需要的运行数据库不存在：${dbPath}；删除 ${sidecarFile(options)} 后重跑`,
		);
	}
	return StoryStoreClass.open(dbPath);
}

function sidecarFile(options: {
	readonly dir: string;
	readonly story: string;
	readonly sample: R6B1Sample;
}): string {
	return path.join(
		options.dir,
		"runs",
		safeSegment(options.story),
		String(options.sample.branchFloor),
		"b1.json",
	);
}

function safeSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

async function saveSidecar(file: string, run: R6B1RunRecord): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp`;
	await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, "utf8");
	await rename(temporary, file);
}

async function loadSidecar(file: string): Promise<R6B1RunRecord | null> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const value: unknown = JSON.parse(raw);
	if (!isRunRecord(value)) {
		throw new Error(`${file} 不是有效的 B1 结果文件`);
	}
	return value;
}

function isRunRecord(value: unknown): value is R6B1RunRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		record.format === R6_B1_RUN_FORMAT &&
		typeof record.sampleId === "string" &&
		typeof record.story === "string" &&
		typeof record.branchNodeId === "string" &&
		typeof record.branchFloor === "number" &&
		typeof record.historicalNodeId === "string" &&
		typeof record.userText === "string" &&
		(record.status === "running" ||
			record.status === "done" ||
			record.status === "failed") &&
		typeof record.warmup === "object" &&
		record.warmup !== null &&
		Array.isArray(record.judgments) &&
		Array.isArray(record.quality)
	);
}

function validateSidecar(
	run: R6B1RunRecord,
	file: string,
	options: B1RunOptions,
): void {
	const mismatches: string[] = [];
	if (run.sampleId !== options.sample.sampleId) mismatches.push("样本");
	if (run.story !== options.story) mismatches.push("故事");
	if (run.branchNodeId !== options.sample.branchNodeId)
		mismatches.push("分支点");
	if (run.branchFloor !== options.sample.branchFloor)
		mismatches.push("分支楼层");
	if (run.historicalNodeId !== options.sample.historicalNodeId) {
		mismatches.push("历史回复");
	}
	if (run.userText !== options.sample.userText) mismatches.push("玩家消息");
	if (run.writerModel !== options.writer.model) mismatches.push("写作模型");
	if (run.judgeModel !== options.judge.model) mismatches.push("裁判模型");
	if (run.seed !== options.seed) mismatches.push("随机种子");
	if (mismatches.length > 0) {
		throw new Error(
			`${file} 与本次运行不一致：${mismatches.join("、")}；删除该文件后重跑`,
		);
	}
}

export function formatR6B1Report(report: R6B1Report): string {
	const summary = report.summary;
	const lines: string[] = [];
	lines.push("# R6 B1 配对批次");
	lines.push("");
	lines.push(
		`- 故事：${report.stories.join("、")}；种子：${report.seed}；门槛版本：${report.gateVersion}`,
	);
	lines.push(
		`- 模型：写作 ${summary.modelFamilies.writer.model}（${summary.modelFamilies.writer.family}）、裁判 ${summary.modelFamilies.judge.model}（${summary.modelFamilies.judge.family}）`,
	);
	lines.push(
		`- 历史回复模型：${
			summary.modelFamilies.historical.length === 0
				? "未记录"
				: summary.modelFamilies.historical
						.map((item) => `${item.model}（${item.family}，${item.samples}）`)
						.join("、")
		}`,
	);
	lines.push(
		`- 配对：计划 ${summary.plannedPairs}，完成 ${summary.completedPairs}，胜 ${summary.pairs.wins}、负 ${summary.pairs.losses}、平 ${summary.pairs.ties}、换序不一致 ${summary.pairs.inconsistent}、失败 ${summary.failures}`,
	);
	lines.push(
		`- 胜率：${formatPercent(summary.winRate)}（Wilson 95% ${formatInterval(summary.wilson)}）；换序不一致比例 ${formatPercent(summary.inconsistentShare)}；排除比例 ${formatPercent(summary.excludedShare)}；裁判失败比例 ${formatPercent(summary.judgeFailureShare)}`,
	);
	lines.push(
		`- 样本判定：${summary.insufficient ? `样本不足——${summary.insufficientReason}` : "达到预注册下限"}`,
	);
	lines.push(
		"- 口径：每个分支点复制源数据库并预热 12 楼，用其后第一条真实玩家消息生成一次原生续写；两种展示顺序各判一次，胜率分母只含胜与负。",
	);
	lines.push("");
	lines.push("|故事|计划|完成|胜|负|平|换序不一致|失败|");
	lines.push("|---|---|---|---|---|---|---|---|");
	for (const story of summary.stories) {
		lines.push(
			`|${story.story}|${story.plannedPairs}|${story.completedPairs}|${story.wins}|${story.losses}|${story.ties}|${story.inconsistent}|${story.failures}|`,
		);
	}
	lines.push("");
	lines.push("## 叙事质量");
	lines.push("");
	lines.push("|侧|评分数|失败|原创性|人物|节奏|对话|");
	lines.push("|---|---|---|---|---|---|---|");
	for (const group of summary.quality.bySide) {
		const means = new Map(
			group.dimensions.map((dimension) => [
				dimension.dimension,
				dimension.mean,
			]),
		);
		lines.push(
			`|${group.side}|${group.scored}|${group.failures}|${formatScore(means.get("originality") ?? null)}|${formatScore(means.get("character") ?? null)}|${formatScore(means.get("pacing") ?? null)}|${formatScore(means.get("dialogue") ?? null)}|`,
		);
	}
	lines.push("");
	lines.push("## 失败");
	lines.push("");
	let failureLines = 0;
	for (const run of report.runs) {
		if (run.status === "failed") {
			failureLines += 1;
			lines.push(
				`- ${run.story} 第 ${run.branchFloor} 楼：生成失败——${run.error ?? "未知错误"}`,
			);
			continue;
		}
		if (run.outcome === null) {
			failureLines += 1;
			lines.push(
				`- ${run.story} 第 ${run.branchFloor} 楼：判定失败——${run.outcomeError ?? "未知错误"}`,
			);
		}
	}
	for (const failure of summary.quality.failures) {
		failureLines += 1;
		lines.push(
			`- ${failure.storyId} 样本 ${failure.sampleId} ${failure.side}：评分失败——${failure.error}`,
		);
	}
	if (failureLines === 0) lines.push("- 无");
	return lines.join("\n");
}

function formatPercent(value: number | null): string {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatInterval(value: WilsonInterval | null): string {
	return value === null
		? "—"
		: `${(value.lower * 100).toFixed(1)}%–${(value.upper * 100).toFixed(1)}%`;
}

function formatScore(value: number | null): string {
	return value === null ? "—" : value.toFixed(2);
}

function sum<T>(items: readonly T[], value: (item: T) => number): number {
	let total = 0;
	for (const item of items) total += value(item);
	return total;
}

function truncate(value: string, limit: number): string {
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}
