import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
	copyFile,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
	type BackgroundJob,
	type BackgroundJobRegistry,
	type ChatProfile,
	type EmbeddingClient,
	type FloorProposals,
	type LlmCallOptions,
	type LlmClient,
	type LlmReasoningLevel,
	type LlmRequest,
	type LlmResult,
	type LlmStream,
	type LlmStreamingClient,
	type LlmToolTransport,
	MAX_BACKGROUND_JOB_ATTEMPTS,
	NO_CONTINUATION,
	SCENE_JOB_KIND,
	SETTLE_WINDOW_FLOORS,
	type SettlementWindow,
	type StoryStore,
	StoryStore as StoryStoreClass,
	type StructuredOutputMode,
	type TimelineNode,
	applySettlementProposals,
	buildSettlementMessages,
	createNaiveChatSlots,
	createNaiveContextTemplate,
	createSceneHandler,
	createStandardChatSlots,
	drainBackgroundJobs,
	parseSettleResponse,
	prepareSettlementForNodes,
	resolveStoryBackgroundKinds,
	runChatTurn,
} from "@dramaticer/core";
import { resolveStoryContextTemplate } from "../chat/session.js";
import { type PercentileSummary, summarizePercentiles } from "./deep-eval.js";
import {
	R6_BRANCH_DEPTHS,
	R6_C1_BRANCH_POINTS,
	R6_C1_ROUNDS,
	R6_GATE_VERSION,
	R6_MAX_BRANCH_POINTS,
	R6_PROBE_INTERVAL_ROUNDS,
	R6_PROBE_MAX_PER_RUN,
	R6_PROBE_MIN_FACT_AGE,
	R6_WARMUP_FLOORS,
} from "./gates.js";
import { measureProgression, measureReplyRepetition } from "./metrics.js";
import { PLAYTEST_USER_HINTS, generateUserMessage } from "./playtest.js";
import {
	DEFAULT_PROBE_MAX_TOKENS,
	DEFAULT_PROBE_TEMPERATURE,
	type PlaytestProbeRecord,
	runPlaytestProbe,
} from "./probe.js";

export const R6_COMPARE_FORMAT = "dramaticer.r6-compare";
export const R6_RUN_FORMAT = "dramaticer.r6-compare-run";
export const DEFAULT_R6_COMPARE_SEED = 1;

/** 分支点：楼层号从 1 开始，指主路径上的助手楼层。 */
export interface R6BranchPoint {
	readonly nodeId: string;
	readonly floor: number;
}

export interface R6CompareOptions {
	/** 已导入故事与卡的数据库；每个分支点与档位各复制一份。 */
	readonly sourceDbPath: string;
	readonly stories: readonly string[];
	/** 每个分支点每个档位的轮数；默认预注册的 30 轮。 */
	readonly rounds?: number;
	readonly dir: string;
	readonly writer: {
		readonly client: LlmStreamingClient;
		readonly model: string;
	};
	/** 模拟用户；朴素档重放时不调用。 */
	readonly user: { readonly client: LlmClient; readonly model: string };
	readonly judge: { readonly client: LlmClient; readonly model: string };
	readonly background: {
		readonly client: LlmClient;
		readonly registry: BackgroundJobRegistry;
	};
	readonly structuredOutput: StructuredOutputMode;
	readonly budgetTokens: number;
	readonly toolTransport?: LlmToolTransport | null;
	readonly embedder?: EmbeddingClient | null;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly reasoning?: LlmReasoningLevel;
	readonly seed?: number;
	/**
	 * 只跑指定的分支点楼层，用于缩样冒烟；不设置时按预注册取首、中、末三个。
	 */
	readonly branchFloors?: readonly number[];
	readonly log?: (message: string) => void;
	readonly now?: () => number;
}

export interface R6WarmupRecord {
	readonly floorNodeIds: readonly string[];
	readonly settleRequests: number;
	readonly sceneRequests: number;
	readonly cachedRequests: number;
}

export interface R6ProbeSummary {
	/** 排期次数；每次运行最多 5 次。 */
	readonly attempts: number;
	readonly done: number;
	readonly skipped: number;
	readonly failed: number;
	readonly consistent: number;
	readonly contradicted: number;
	readonly unknown: number;
}

export interface R6CompareRoundRecord {
	readonly round: number;
	readonly user: string;
	/** 失败轮次没有回复。 */
	readonly reply: string | null;
	readonly firstTokenMs: number | null;
	readonly durationMs: number | null;
	readonly writerRequests: number;
	readonly writerCachedRequests: number;
	readonly backgroundRequests: number;
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly probe: PlaytestProbeRecord | null;
	readonly error: string | null;
	/** 本轮写入的楼层；失败轮次为 null。续跑用它把 head 对齐到记录末尾。 */
	readonly userNodeId: string | null;
	readonly assistantNodeId: string | null;
}

export interface R6CompareCost {
	readonly writerRequests: number;
	readonly writerCachedRequests: number;
	readonly backgroundRequests: number;
	readonly probeRequests: number;
}

export interface R6CompareMetrics {
	readonly repetitionPairs: number;
	readonly repetitionMean: number | null;
	readonly repetitionValues: readonly number[];
	readonly progressSamples: number;
	readonly progressMean: number | null;
	readonly progressValues: readonly number[];
}

/** 一个分支点在一个档位上的运行记录；同时是续跑用的 sidecar。 */
export interface R6CompareRunRecord {
	readonly format: typeof R6_RUN_FORMAT;
	readonly story: string;
	readonly branchFloor: number;
	readonly branchNodeId: string;
	readonly profile: ChatProfile;
	readonly rounds: number;
	readonly seed: number;
	readonly writerModel: string;
	readonly userModel: string;
	readonly judgeModel: string;
	readonly warmup: R6WarmupRecord;
	readonly status: "running" | "done" | "failed";
	readonly error: string | null;
	readonly startedAt: string;
	readonly finishedAt: string | null;
	readonly messages: readonly string[];
	readonly records: readonly R6CompareRoundRecord[];
	readonly metrics: R6CompareMetrics;
	readonly probes: R6ProbeSummary;
	readonly cost: R6CompareCost;
}

export interface R6ProfileReport {
	readonly story: string;
	readonly profile: ChatProfile;
	readonly branches: number;
	readonly completedRuns: number;
	readonly failedRuns: readonly {
		readonly branchFloor: number;
		readonly error: string;
	}[];
	readonly rounds: number;
	readonly failures: number;
	readonly repetition: {
		readonly pairs: number;
		readonly mean: number | null;
	};
	readonly progression: {
		readonly samples: number;
		readonly mean: number | null;
	};
	readonly probes: R6ProbeSummary;
	readonly cost: {
		readonly writerRequestsPerRound: number | null;
		readonly backgroundRequestsPerRound: number | null;
		readonly promptTokensPerRound: number | null;
		readonly completionTokensPerRound: number | null;
		readonly writerRequests: number;
		readonly backgroundRequests: number;
		readonly probeRequests: number;
		readonly warmupRequests: number;
		readonly firstTokenMs: PercentileSummary | null;
		readonly durationMs: PercentileSummary | null;
	};
}

export interface R6CompareReport {
	readonly format: typeof R6_COMPARE_FORMAT;
	readonly gateVersion: string;
	readonly generatedAt: string;
	readonly stories: readonly string[];
	readonly rounds: number;
	readonly seed: number;
	readonly branchPoints: readonly (R6BranchPoint & {
		readonly story: string;
	})[];
	readonly profiles: readonly R6ProfileReport[];
	readonly runs: readonly R6CompareRunRecord[];
}

export interface RequestStats {
	requests: number;
	cachedRequests: number;
}

export interface CountedClient {
	readonly client: LlmClient;
	readonly stats: RequestStats;
}

export interface CountedStreamingClient {
	readonly client: LlmStreamingClient;
	readonly stats: RequestStats;
}

interface MutableRun {
	format: typeof R6_RUN_FORMAT;
	story: string;
	branchFloor: number;
	branchNodeId: string;
	profile: ChatProfile;
	rounds: number;
	seed: number;
	writerModel: string;
	userModel: string;
	judgeModel: string;
	warmup: R6WarmupRecord;
	status: "running" | "done" | "failed";
	error: string | null;
	startedAt: string;
	finishedAt: string | null;
	messages: string[];
	records: R6CompareRoundRecord[];
	metrics: R6CompareMetrics;
	probes: R6ProbeSummary;
	cost: R6CompareCost;
}

/**
 * 按路径深度 10% 到 100% 取最近的助手楼层，保留其后有非空玩家消息与
 * 历史回复的点，去重后按楼层排序并截到上限。
 */
export function planR6BranchPoints(
	path: readonly TimelineNode[],
	maxBranchPoints: number = R6_MAX_BRANCH_POINTS,
): R6BranchPoint[] {
	if (!Number.isInteger(maxBranchPoints) || maxBranchPoints < 1) {
		throw new Error(`分支点上限必须是正整数，收到 ${maxBranchPoints}`);
	}
	const assistantIndices: number[] = [];
	path.forEach((node, index) => {
		if (node.role !== "assistant") return;
		if (node.raw.trim().length === 0) return;
		assistantIndices.push(index);
	});
	const chosen = new Set<number>();
	for (const depth of R6_BRANCH_DEPTHS) {
		const target = Math.round(path.length * depth) - 1;
		let best: number | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const index of assistantIndices) {
			const distance = Math.abs(index - target);
			if (
				distance < bestDistance ||
				(distance === bestDistance && best !== null && index < best)
			) {
				best = index;
				bestDistance = distance;
			}
		}
		if (best !== null) chosen.add(best);
	}
	return [...chosen]
		.sort((left, right) => left - right)
		.filter((index) => hasFollowingExchange(path, index))
		.slice(0, maxBranchPoints)
		.map((index) => ({
			nodeId: (path[index] as TimelineNode).id,
			floor: index + 1,
		}));
}

function hasFollowingExchange(
	path: readonly TimelineNode[],
	index: number,
): boolean {
	let userIndex = -1;
	for (let next = index + 1; next < path.length; next += 1) {
		const node = path[next];
		if (node === undefined) break;
		if (node.role !== "user" || node.raw.trim().length === 0) continue;
		userIndex = next;
		break;
	}
	if (userIndex < 0) return false;
	for (let next = userIndex + 1; next < path.length; next += 1) {
		const node = path[next];
		if (node === undefined) break;
		if (node.role === "assistant" && node.raw.trim().length > 0) return true;
	}
	return false;
}

/** 预注册的 C1：首、中、末三个分支点。 */
export function selectR6C1BranchPoints(
	points: readonly R6BranchPoint[],
	count: number = R6_C1_BRANCH_POINTS,
): R6BranchPoint[] {
	if (points.length <= count) return [...points];
	const indices = new Set<number>([
		0,
		Math.floor((points.length - 1) / 2),
		points.length - 1,
	]);
	if (count > 3) {
		for (let index = 1; index < points.length - 1; index += 1) {
			if (indices.size >= count) break;
			indices.add(index);
		}
	}
	return [...indices]
		.sort((left, right) => left - right)
		.slice(0, count)
		.map((index) => points[index] as R6BranchPoint);
}

/** 分支点之前最近若干个已生成完成的助手楼层，从旧到新。 */
export function selectR6WarmupFloors(
	store: StoryStore,
	branchNodeId: string,
	limit: number = R6_WARMUP_FLOORS,
): string[] {
	if (!Number.isInteger(limit) || limit < 1) {
		throw new Error(`预热楼层数必须是正整数，收到 ${limit}`);
	}
	const path = store.getPathToNode(branchNodeId);
	const floors: string[] = [];
	for (let index = path.length - 2; index >= 0; index -= 1) {
		if (floors.length >= limit) break;
		const node = path[index];
		if (node === undefined || node.role !== "assistant") continue;
		if (node.raw.trim().length === 0) continue;
		const trace = store.getTurnTrace(node.id);
		if (trace !== null && trace.llm.stopReason === "aborted") continue;
		floors.push(node.id);
	}
	return floors.reverse();
}

/** 复制源数据库并把 head 指向分支点；调用方负责关闭返回的 store。 */
export async function prepareR6RunCopy(options: {
	readonly sourceDbPath: string;
	readonly story: string;
	readonly branchNodeId: string;
	readonly dbPath: string;
}): Promise<StoryStore> {
	await mkdir(path.dirname(options.dbPath), { recursive: true });
	for (const file of [
		options.dbPath,
		`${options.dbPath}-wal`,
		`${options.dbPath}-shm`,
	]) {
		await rm(file, { force: true });
	}
	await copyFile(options.sourceDbPath, options.dbPath);
	const store = StoryStoreClass.open(options.dbPath);
	try {
		if (store.getStory(options.story) === null) {
			throw new Error(`数据库里没有故事 ${options.story}`);
		}
		const node = store.getNode(options.branchNodeId);
		if (node === null || node.storyId !== options.story) {
			throw new Error(
				`分支点 ${options.branchNodeId} 不在故事 ${options.story} 里`,
			);
		}
		if (node.role !== "assistant") {
			throw new Error(`分支点必须是助手楼层，${node.id} 是 ${node.role}`);
		}
		store.setHead(options.story, options.branchNodeId);
		return store;
	} catch (error) {
		store.close();
		throw error;
	}
}

export interface R6WarmupOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly branchNodeId: string;
	readonly client: LlmClient;
	readonly limit?: number;
	readonly now?: () => number;
}

/** 与后台任务的执行上限一致：结算输出不合规时最多请求 3 次。 */
const SETTLE_ATTEMPTS = MAX_BACKGROUND_JOB_ATTEMPTS;

/**
 * 请求一次结算并解析。重试请求附带上一次的错误与可写楼层 id：同一条请求体
 * 会命中响应缓存，原样重发只会拿回同一份坏输出。
 */
async function requestSettlement(
	client: LlmClient,
	window: SettlementWindow,
): Promise<Map<string, FloorProposals>> {
	const base = buildSettlementMessages(window);
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= SETTLE_ATTEMPTS; attempt += 1) {
		const messages =
			lastError === null
				? base
				: [
						...base,
						{
							role: "user" as const,
							content: `上一次输出没有通过校验（${lastError instanceof Error ? lastError.message : String(lastError)}）。这是第 ${attempt} 次尝试，只输出一个 JSON 数组，nodeId 只能是结算窗口里的楼层 id：${window.nodeIds.join("、")}。`,
						},
					];
		try {
			const result = await client.complete(
				{ messages, temperature: 0 },
				NO_CONTINUATION,
			);
			return parseSettleResponse(result.text, window.nodeIds);
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError;
}

/**
 * 对分支点之前最近 12 个已生成完成的助手楼层执行 settle 与 scene；
 * 结算记录与现场分析已经存在时跳过，保证续跑不重复调用模型。
 */
export async function warmupR6Copy(
	options: R6WarmupOptions,
): Promise<R6WarmupRecord> {
	const floors = selectR6WarmupFloors(
		options.store,
		options.branchNodeId,
		options.limit ?? R6_WARMUP_FLOORS,
	);
	const counted = countClient(options.client);
	const scene = createSceneHandler();
	const now = options.now ?? Date.now;
	// 结算窗口以 head 为终点；逐楼把 head 移到预热楼层，避免把窗口外的
	// 更早楼层一起结算。预热楼层可能远在历史之后，按明确楼层建窗口，
	// 不走后台任务的“最早未结算优先”。
	const originalHead = options.store.getHead(options.storyId);
	const settleStart = counted.stats.requests;
	for (let start = 0; start < floors.length; start += SETTLE_WINDOW_FLOORS) {
		const batch = floors
			.slice(start, start + SETTLE_WINDOW_FLOORS)
			.filter((nodeId) => options.store.getLedgerSettlement(nodeId) === null);
		if (batch.length === 0) continue;
		options.store.setHead(options.storyId, batch[batch.length - 1] as string);
		const window = prepareSettlementForNodes(
			options.store,
			options.storyId,
			batch,
		);
		if (window === null) continue;
		applySettlementProposals(
			options.store,
			window,
			await requestSettlement(counted.client, window),
		);
	}
	if (originalHead !== null) {
		options.store.setHead(options.storyId, originalHead.id);
	}
	const settleRequests = counted.stats.requests - settleStart;
	const sceneStart = counted.stats.requests;
	for (const nodeId of floors) {
		if (options.store.getSceneAnalysis(nodeId) !== null) continue;
		await scene({
			store: options.store,
			client: counted.client,
			job: jobOf(options.storyId, nodeId, SCENE_JOB_KIND, now),
		});
	}
	const sceneRequests = counted.stats.requests - sceneStart;
	return {
		floorNodeIds: floors,
		settleRequests,
		sceneRequests,
		cachedRequests: counted.stats.cachedRequests,
	};
}

interface ProfileRunOptions extends R6CompareOptions {
	readonly story: string;
	readonly branch: R6BranchPoint;
	readonly profile: ChatProfile;
	readonly rounds: number;
	readonly seed: number;
	/** 朴素档逐字重放的玩家消息；原生档为 null。 */
	readonly replayMessages: readonly string[] | null;
	readonly nativeStatus: "done" | "failed" | null;
	readonly log: (message: string) => void;
	readonly now: () => number;
}

/**
 * 每个故事取 C1 的三个分支点，各复制两份数据库：原生先跑固定轮数并把
 * 模拟用户消息写进 sidecar，朴素档逐字重放同一串消息。
 */
export async function runR6Compare(
	options: R6CompareOptions,
): Promise<R6CompareReport> {
	const rounds = options.rounds ?? R6_C1_ROUNDS;
	const seed = options.seed ?? DEFAULT_R6_COMPARE_SEED;
	assertCompareOptions(options, rounds, seed);
	const log = options.log ?? (() => undefined);
	const now = options.now ?? Date.now;
	const stories = [...new Set(options.stories)];
	await mkdir(options.dir, { recursive: true });
	const planned = await planStories(options, stories);
	const runs: R6CompareRunRecord[] = [];
	for (const story of stories) {
		for (const branch of planned.get(story) ?? []) {
			const native = await runProfile({
				...options,
				story,
				branch,
				profile: "native",
				rounds,
				seed,
				replayMessages: null,
				nativeStatus: null,
				log,
				now,
			});
			runs.push(native);
			const naive = await runProfile({
				...options,
				story,
				branch,
				profile: "naive",
				rounds,
				seed,
				replayMessages: native.messages,
				nativeStatus: native.status === "done" ? "done" : "failed",
				log,
				now,
			});
			runs.push(naive);
		}
	}
	const branchPoints = stories.flatMap((story) =>
		(planned.get(story) ?? []).map((point) => ({ ...point, story })),
	);
	return {
		format: R6_COMPARE_FORMAT,
		gateVersion: R6_GATE_VERSION,
		generatedAt: new Date(now()).toISOString(),
		stories,
		rounds,
		seed,
		branchPoints,
		profiles: summarizeProfiles({ stories, runs }),
		runs,
	};
}

async function planStories(
	options: R6CompareOptions,
	stories: readonly string[],
): Promise<Map<string, R6BranchPoint[]>> {
	if (options.branchFloors !== undefined && stories.length !== 1) {
		throw new Error("分支点楼层只能和单个故事一起使用");
	}
	const store = StoryStoreClass.open(options.sourceDbPath);
	try {
		const planned = new Map<string, R6BranchPoint[]>();
		for (const story of stories) {
			if (store.getStory(story) === null) {
				throw new Error(`数据库 ${options.sourceDbPath} 里没有故事 ${story}`);
			}
			const all = planR6BranchPoints(store.getPathToHead(story));
			if (all.length === 0) {
				throw new Error(`故事 ${story} 的主路径上没有可用的分支点`);
			}
			const selected =
				options.branchFloors === undefined
					? selectR6C1BranchPoints(all)
					: pickBranchFloors(all, options.branchFloors, story);
			planned.set(story, selected);
		}
		return planned;
	} finally {
		store.close();
	}
}

function pickBranchFloors(
	planned: readonly R6BranchPoint[],
	floors: readonly number[],
	story: string,
): R6BranchPoint[] {
	if (floors.length === 0) {
		throw new Error("分支点列表不能为空");
	}
	const available = new Map(planned.map((point) => [point.floor, point]));
	return floors.map((floor) => {
		const point = available.get(floor);
		if (point === undefined) {
			throw new Error(
				`故事 ${story} 没有楼层 ${floor} 的分支点；可用楼层：${[...available.keys()].join("、")}`,
			);
		}
		return point;
	});
}

function assertCompareOptions(
	options: R6CompareOptions,
	rounds: number,
	seed: number,
): void {
	if (!Number.isInteger(rounds) || rounds < 1) {
		throw new Error(`对比运行的轮数必须是正整数，收到 ${rounds}`);
	}
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

function newRun(
	options: ProfileRunOptions,
	warmup: R6WarmupRecord,
): MutableRun {
	return {
		format: R6_RUN_FORMAT,
		story: options.story,
		branchFloor: options.branch.floor,
		branchNodeId: options.branch.nodeId,
		profile: options.profile,
		rounds: options.rounds,
		seed: options.seed,
		writerModel: options.writer.model,
		userModel: options.user.model,
		judgeModel: options.judge.model,
		warmup,
		status: "running",
		error: null,
		startedAt: new Date(options.now()).toISOString(),
		finishedAt: null,
		messages:
			options.replayMessages === null ? [] : [...options.replayMessages],
		records: [],
		metrics: summarizeMetrics([]),
		probes: summarizeProbes([]),
		cost: summarizeCost([], 0),
	};
}

function failedNaiveRun(options: ProfileRunOptions): R6CompareRunRecord {
	const at = new Date(options.now()).toISOString();
	return {
		format: R6_RUN_FORMAT,
		story: options.story,
		branchFloor: options.branch.floor,
		branchNodeId: options.branch.nodeId,
		profile: "naive",
		rounds: options.rounds,
		seed: options.seed,
		writerModel: options.writer.model,
		userModel: options.user.model,
		judgeModel: options.judge.model,
		warmup: {
			floorNodeIds: [],
			settleRequests: 0,
			sceneRequests: 0,
			cachedRequests: 0,
		},
		status: "failed",
		error: "原生档没有完成，朴素档不重放",
		startedAt: at,
		finishedAt: at,
		messages: [],
		records: [],
		metrics: summarizeMetrics([]),
		probes: summarizeProbes([]),
		cost: summarizeCost([], 0),
	};
}

async function runProfile(
	options: ProfileRunOptions,
): Promise<R6CompareRunRecord> {
	const file = sidecarFile(options);
	const existing = await loadSidecar(file);
	if (existing !== null) {
		validateSidecar(existing, file, options);
		if (existing.status !== "running") {
			options.log(
				`${options.story} 第 ${options.branch.floor} 楼 ${options.profile}：复用已完成的样本`,
			);
			return existing;
		}
		options.log(
			`${options.story} 第 ${options.branch.floor} 楼 ${options.profile}：从第 ${existing.records.length + 1} 轮续跑`,
		);
	}
	if (
		existing === null &&
		options.profile === "naive" &&
		options.nativeStatus !== "done"
	) {
		return failedNaiveRun(options);
	}
	const runDir = path.dirname(file);
	const dbPath = path.join(runDir, `${options.profile}.db`);
	await mkdir(runDir, { recursive: true });
	const store = await openRunStore(existing, dbPath, options);
	try {
		const settings = store.getStorySettings(options.story);
		const template =
			options.profile === "naive"
				? createNaiveContextTemplate()
				: resolveStoryContextTemplate(
						store,
						settings.templateId,
						options.structuredOutput,
					);
		const slots =
			options.profile === "naive"
				? await createNaiveChatSlots({
						store,
						characterPrompt: settings.characterPrompt,
						persona: settings.persona,
					})
				: await createStandardChatSlots({
						store,
						characterPrompt: settings.characterPrompt,
						embedder: options.embedder,
						directorConfig: settings.directorConfig,
						historyBlockPolicy: settings.historyBlockPolicy,
						worldModel: settings.worldModel,
						directorOrganization: settings.directorOrganization,
					});
		const warmup =
			existing === null
				? await warmupR6Copy({
						store,
						storyId: options.story,
						branchNodeId: options.branch.nodeId,
						client: options.background.client,
						now: options.now,
					})
				: existing.warmup;
		if (existing === null) {
			options.log(
				`${options.story} 第 ${options.branch.floor} 楼 ${options.profile}：预热 ${warmup.floorNodeIds.length} 楼，请求 ${warmup.settleRequests + warmup.sceneRequests}`,
			);
		}
		const run: MutableRun =
			existing === null
				? newRun(options, warmup)
				: {
						...existing,
						messages: [...existing.messages],
						records: [...existing.records],
						warmup,
					};
		await saveSidecar(file, run);
		const lastRecord = [...run.records]
			.reverse()
			.find((record) => record.assistantNodeId !== null);
		if (
			lastRecord?.assistantNodeId !== undefined &&
			lastRecord.assistantNodeId !== null
		) {
			store.setHead(options.story, lastRecord.assistantNodeId);
		}
		const writer = countStreamingClient(options.writer.client);
		const background = countClient(options.background.client);
		const judge = countClient(options.judge.client);
		let probeRequests = run.cost.probeRequests;
		let consecutiveFailures = trailingFailures(run.records);
		for (
			let round = run.records.length + 1;
			round <= options.rounds;
			round += 1
		) {
			const userText =
				run.messages[round - 1] ??
				(await generateUserMessage({
					store,
					storyId: options.story,
					client: options.user.client,
					model: options.user.model,
					hint:
						PLAYTEST_USER_HINTS[
							(options.seed + round) % PLAYTEST_USER_HINTS.length
						] ?? PLAYTEST_USER_HINTS[0],
					now: options.now,
				}));
			if (run.messages[round - 1] === undefined) {
				run.messages = [...run.messages, userText];
			}
			const headBefore = store.getHead(options.story);
			const writerStart = writer.stats.requests;
			const writerCachedStart = writer.stats.cachedRequests;
			const backgroundStart = background.stats.requests;
			const probeWriterStart = writer.stats.requests;
			const probeJudgeStart = judge.stats.requests;
			let reply: string | null = null;
			let firstTokenMs: number | null = null;
			let durationMs: number | null = null;
			let promptTokens = 0;
			let completionTokens = 0;
			let error: string | null = null;
			let userNodeId: string | null = null;
			let assistantNodeId: string | null = null;
			try {
				const result = await runChatTurn({
					store,
					client: writer.client,
					storyId: options.story,
					userText,
					template,
					providers: slots.providers,
					budgetTokens: options.budgetTokens,
					structuredOutput: options.structuredOutput,
					turnMode: "fast",
					profile: options.profile,
					toolTransport: options.toolTransport,
					embedder: options.embedder,
					viewpoint: settings.viewpoint,
					model: options.writer.model,
					maxTokens: options.maxTokens ?? settings.maxTokens,
					temperature: options.temperature ?? settings.temperature,
					reasoning: options.reasoning ?? settings.reasoning,
					now: options.now,
				});
				reply = result.node.raw;
				userNodeId = result.userNode.id;
				assistantNodeId = result.node.id;
				firstTokenMs = result.trace.timing.firstTokenMs;
				durationMs = result.trace.timing.durationMs;
				promptTokens = result.trace.llm.usage.promptTokens ?? 0;
				completionTokens = result.trace.llm.usage.completionTokens ?? 0;
				consecutiveFailures = 0;
			} catch (caught) {
				error = caught instanceof Error ? caught.message : String(caught);
				consecutiveFailures += 1;
				if (headBefore !== null) {
					const current = store.getHead(options.story);
					if (current !== null && current.id !== headBefore.id) {
						store.setHead(options.story, headBefore.id);
					}
				}
			}
			const writerRequests = writer.stats.requests - writerStart;
			const writerCachedRequests =
				writer.stats.cachedRequests - writerCachedStart;
			let backgroundRequests = 0;
			if (options.profile === "native" && error === null) {
				const kinds = resolveStoryBackgroundKinds(options.background.registry, {
					gapPassEnabled: settings.gapPassEnabled,
				});
				await drainBackgroundJobs({
					store,
					registry: options.background.registry,
					client: background.client,
					storyId: options.story,
					kinds,
					gapSeconds: 0,
					sessionEnded: false,
					now: options.now,
				});
				backgroundRequests = background.stats.requests - backgroundStart;
			}
			let probe: PlaytestProbeRecord | null = null;
			if (
				options.profile === "native" &&
				error === null &&
				round % R6_PROBE_INTERVAL_ROUNDS === 0 &&
				run.probes.attempts < R6_PROBE_MAX_PER_RUN
			) {
				const head = store.getHead(options.story);
				if (head !== null) {
					probe = await runPlaytestProbe({
						store,
						storyId: options.story,
						round,
						headNodeId: head.id,
						minAgeFloors: R6_PROBE_MIN_FACT_AGE,
						random: createSeededRandom(options.seed + round),
						template,
						providers: slots.providers,
						budgetTokens: options.budgetTokens,
						assistant: {
							client: writer.client,
							model: options.writer.model,
						},
						judge: { client: judge.client, model: options.judge.model },
						maxTokens: DEFAULT_PROBE_MAX_TOKENS,
						temperature: DEFAULT_PROBE_TEMPERATURE,
					});
					options.log(
						`第 ${round} 轮探针：${probe.status === "done" ? (probe.verdict ?? "未知") : probe.status}`,
					);
				}
			}
			probeRequests +=
				writer.stats.requests -
				probeWriterStart +
				(judge.stats.requests - probeJudgeStart);
			run.records = [
				...run.records,
				{
					round,
					user: userText,
					reply,
					firstTokenMs,
					durationMs,
					writerRequests,
					writerCachedRequests,
					backgroundRequests,
					promptTokens,
					completionTokens,
					probe,
					error,
					userNodeId,
					assistantNodeId,
				},
			];
			run.metrics = summarizeMetrics(run.records);
			run.probes = summarizeProbes(run.records);
			run.cost = summarizeCost(run.records, probeRequests);
			await saveSidecar(file, run);
			if (error !== null) {
				options.log(`第 ${round} 轮失败：${error}`);
			} else {
				options.log(
					`第 ${round} 轮：首字 ${firstTokenMs === null ? "—" : `${firstTokenMs} 毫秒`}，写作请求 ${writerRequests}，后台请求 ${backgroundRequests}`,
				);
			}
			if (consecutiveFailures >= 3) {
				run.status = "failed";
				run.error = `连续 ${consecutiveFailures} 轮失败，终止该次运行`;
				break;
			}
		}
		if (run.status === "running") run.status = "done";
		run.finishedAt = new Date(options.now()).toISOString();
		await saveSidecar(file, run);
		return run;
	} finally {
		store.close();
	}
}

async function openRunStore(
	existing: R6CompareRunRecord | null,
	dbPath: string,
	options: ProfileRunOptions,
): Promise<StoryStore> {
	if (existing === null) {
		return prepareR6RunCopy({
			sourceDbPath: options.sourceDbPath,
			story: options.story,
			branchNodeId: options.branch.nodeId,
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

/** 末尾连续失败轮次；续跑时用它恢复“连续 3 轮失败终止”的计数。 */
function trailingFailures(records: readonly R6CompareRoundRecord[]): number {
	let count = 0;
	for (let index = records.length - 1; index >= 0; index -= 1) {
		if (records[index]?.error === null) break;
		count += 1;
	}
	return count;
}

function summarizeMetrics(
	records: readonly R6CompareRoundRecord[],
): R6CompareMetrics {
	const replies = records
		.map((record) => record.reply)
		.filter((reply): reply is string => reply !== null);
	const repetition = measureReplyRepetition(replies);
	const progression = measureProgression(replies);
	return {
		repetitionPairs: repetition.pairCount,
		repetitionMean: repetition.pairCount === 0 ? null : repetition.summary.mean,
		repetitionValues: repetition.values,
		progressSamples: progression.samples,
		progressMean: progression.mean,
		progressValues: progression.values,
	};
}

function summarizeProbes(
	records: readonly R6CompareRoundRecord[],
): R6ProbeSummary {
	const probes = records
		.map((record) => record.probe)
		.filter((probe): probe is PlaytestProbeRecord => probe !== null);
	return {
		attempts: probes.length,
		done: probes.filter((probe) => probe.status === "done").length,
		skipped: probes.filter((probe) => probe.status === "skipped").length,
		failed: probes.filter((probe) => probe.status === "failed").length,
		consistent: probes.filter((probe) => probe.verdict === "consistent").length,
		contradicted: probes.filter((probe) => probe.verdict === "contradicted")
			.length,
		unknown: probes.filter((probe) => probe.verdict === "unknown").length,
	};
}

function summarizeCost(
	records: readonly R6CompareRoundRecord[],
	probeRequests: number,
): R6CompareCost {
	let writerRequests = 0;
	let writerCachedRequests = 0;
	let backgroundRequests = 0;
	for (const record of records) {
		writerRequests += record.writerRequests;
		writerCachedRequests += record.writerCachedRequests;
		backgroundRequests += record.backgroundRequests;
	}
	return {
		writerRequests,
		writerCachedRequests,
		backgroundRequests,
		probeRequests,
	};
}

function summarizeProfiles(input: {
	readonly stories: readonly string[];
	readonly runs: readonly R6CompareRunRecord[];
}): R6ProfileReport[] {
	const reports: R6ProfileReport[] = [];
	for (const story of input.stories) {
		for (const profile of ["native", "naive"] as const) {
			const runs = input.runs.filter(
				(run) => run.story === story && run.profile === profile,
			);
			const completed = runs.filter((run) => run.status === "done");
			const failed = runs.filter((run) => run.status !== "done");
			const repetitions = completed.flatMap(
				(run) => run.metrics.repetitionValues,
			);
			const progressions = completed.flatMap(
				(run) => run.metrics.progressValues,
			);
			const rounds = completed.reduce(
				(total, run) =>
					total + run.records.filter((record) => record.reply !== null).length,
				0,
			);
			const failures = completed.reduce(
				(total, run) =>
					total + run.records.filter((record) => record.error !== null).length,
				0,
			);
			const firstTokens = completed.flatMap((run) =>
				run.records
					.map((record) => record.firstTokenMs)
					.filter((value): value is number => value !== null),
			);
			const durations = completed.flatMap((run) =>
				run.records
					.map((record) => record.durationMs)
					.filter((value): value is number => value !== null),
			);
			const writerRequests = sum(completed, (run) => run.cost.writerRequests);
			const backgroundRequests = sum(
				completed,
				(run) => run.cost.backgroundRequests,
			);
			const probeRequests = sum(completed, (run) => run.cost.probeRequests);
			const warmupRequests = sum(
				completed,
				(run) => run.warmup.settleRequests + run.warmup.sceneRequests,
			);
			const promptTokens = sum(completed, (run) =>
				run.records.reduce((total, record) => total + record.promptTokens, 0),
			);
			const completionTokens = sum(completed, (run) =>
				run.records.reduce(
					(total, record) => total + record.completionTokens,
					0,
				),
			);
			reports.push({
				story,
				profile,
				branches: runs.length,
				completedRuns: completed.length,
				failedRuns: failed.map((run) => ({
					branchFloor: run.branchFloor,
					error: run.error ?? "未知错误",
				})),
				rounds,
				failures,
				repetition: {
					pairs: sum(completed, (run) => run.metrics.repetitionPairs),
					mean: mean(repetitions),
				},
				progression: {
					samples: sum(completed, (run) => run.metrics.progressSamples),
					mean: mean(progressions),
				},
				probes: combineProbes(completed.map((run) => run.probes)),
				cost: {
					writerRequestsPerRound: rounds === 0 ? null : writerRequests / rounds,
					backgroundRequestsPerRound:
						rounds === 0 ? null : backgroundRequests / rounds,
					promptTokensPerRound: rounds === 0 ? null : promptTokens / rounds,
					completionTokensPerRound:
						rounds === 0 ? null : completionTokens / rounds,
					writerRequests,
					backgroundRequests,
					probeRequests,
					warmupRequests,
					firstTokenMs: summarizePercentiles(firstTokens),
					durationMs: summarizePercentiles(durations),
				},
			});
		}
	}
	return reports;
}

function combineProbes(probes: readonly R6ProbeSummary[]): R6ProbeSummary {
	return {
		attempts: sum(probes, (item) => item.attempts),
		done: sum(probes, (item) => item.done),
		skipped: sum(probes, (item) => item.skipped),
		failed: sum(probes, (item) => item.failed),
		consistent: sum(probes, (item) => item.consistent),
		contradicted: sum(probes, (item) => item.contradicted),
		unknown: sum(probes, (item) => item.unknown),
	};
}

function sum<T>(items: readonly T[], value: (item: T) => number): number {
	let total = 0;
	for (const item of items) total += value(item);
	return total;
}

function mean(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((total, value) => total + value, 0) / values.length;
}

export function countClient(inner: LlmClient): CountedClient {
	const stats: RequestStats = { requests: 0, cachedRequests: 0 };
	return {
		stats,
		client: {
			async complete(
				request: LlmRequest,
				options?: LlmCallOptions,
			): Promise<LlmResult> {
				const result = await inner.complete(request, options);
				if (result.cached) stats.cachedRequests += 1;
				else stats.requests += 1;
				return result;
			},
		},
	};
}

export function countStreamingClient(
	inner: LlmStreamingClient,
): CountedStreamingClient {
	const stats: RequestStats = { requests: 0, cachedRequests: 0 };
	return {
		stats,
		client: {
			async complete(
				request: LlmRequest,
				options?: LlmCallOptions,
			): Promise<LlmResult> {
				const result = await inner.complete(request, options);
				if (result.cached) stats.cachedRequests += 1;
				else stats.requests += 1;
				return result;
			},
			stream(request: LlmRequest, options?: LlmCallOptions): LlmStream {
				const stream = inner.stream(request, options);
				return {
					[Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
					async result(): Promise<LlmResult> {
						const result = await stream.result();
						if (result.cached) stats.cachedRequests += 1;
						else stats.requests += 1;
						return result;
					},
				};
			},
		},
	};
}

function jobOf(
	storyId: string,
	nodeId: string,
	kind: string,
	now: () => number,
): BackgroundJob {
	const at = new Date(now()).toISOString();
	return {
		id: 0,
		storyId,
		nodeId,
		kind,
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: at,
		startedAt: at,
		finishedAt: null,
	};
}

function sidecarFile(options: {
	readonly dir: string;
	readonly story: string;
	readonly branch: R6BranchPoint;
	readonly profile: ChatProfile;
}): string {
	return path.join(
		options.dir,
		"runs",
		safeSegment(options.story),
		String(options.branch.floor),
		`${options.profile}.json`,
	);
}

function safeSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

async function saveSidecar(
	file: string,
	run: R6CompareRunRecord,
): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp`;
	await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, "utf8");
	await rename(temporary, file);
}

async function loadSidecar(file: string): Promise<R6CompareRunRecord | null> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const value: unknown = JSON.parse(raw);
	if (!isRunRecord(value)) {
		throw new Error(`${file} 不是有效的结果文件`);
	}
	return value;
}

function isRunRecord(value: unknown): value is R6CompareRunRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		record.format === R6_RUN_FORMAT &&
		typeof record.story === "string" &&
		typeof record.branchNodeId === "string" &&
		typeof record.branchFloor === "number" &&
		(record.profile === "native" || record.profile === "naive") &&
		typeof record.rounds === "number" &&
		typeof record.seed === "number" &&
		(record.status === "running" ||
			record.status === "done" ||
			record.status === "failed") &&
		typeof record.warmup === "object" &&
		record.warmup !== null &&
		Array.isArray(record.messages) &&
		Array.isArray(record.records)
	);
}

function validateSidecar(
	run: R6CompareRunRecord,
	file: string,
	options: ProfileRunOptions,
): void {
	const mismatches: string[] = [];
	if (run.story !== options.story) mismatches.push("故事");
	if (run.branchNodeId !== options.branch.nodeId) mismatches.push("分支点");
	if (run.branchFloor !== options.branch.floor) mismatches.push("分支楼层");
	if (run.profile !== options.profile) mismatches.push("档位");
	if (run.rounds !== options.rounds) mismatches.push("轮数");
	if (run.seed !== options.seed) mismatches.push("随机种子");
	if (run.writerModel !== options.writer.model) mismatches.push("写作模型");
	if (run.userModel !== options.user.model) mismatches.push("模拟用户模型");
	if (run.judgeModel !== options.judge.model) mismatches.push("裁判模型");
	if (
		options.profile === "naive" &&
		options.replayMessages !== null &&
		hashMessages(run.messages) !== hashMessages(options.replayMessages)
	) {
		mismatches.push("玩家消息");
	}
	if (mismatches.length > 0) {
		throw new Error(
			`${file} 与本次运行不一致：${mismatches.join("、")}；删除该文件后重跑`,
		);
	}
}

function hashMessages(messages: readonly string[]): string {
	return createHash("sha256").update(JSON.stringify(messages)).digest("hex");
}

function createSeededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

export function formatR6CompareReport(report: R6CompareReport): string {
	const lines: string[] = [];
	lines.push("# R6 原生与朴素对比（C1）");
	lines.push("");
	lines.push(
		`- 故事：${report.stories.join("、")}；轮数：${report.rounds}；种子：${report.seed}；门槛版本：${report.gateVersion}`,
	);
	lines.push(
		`- 分支点：${report.branchPoints.map((point) => `${point.story}@${point.floor}`).join("、") || "无"}`,
	);
	lines.push(
		"- 口径：重复度 = 同一运行内相邻生成回复的字符 4-gram Jaccard 均值；推进度 = 第 2 轮起新字符 4-gram 占比均值；成本分写作请求、后台请求与探针请求；预热请求单列。",
	);
	lines.push(
		"- 隔离：每个分支点与档位各复制一份源数据库；原生档先跑并写 sidecar，朴素档逐字重放同一串玩家消息；预热对最近 12 个已生成完成的助手楼层执行 settle 与 scene。",
	);
	lines.push("");
	lines.push(
		"|故事|档位|完成/失败|轮数|重复度（对数）|推进度（样本）|探针（可判定/跳过/失败）|写作请求/轮|后台请求/轮|预热请求|首字 P50/P90|时延 P50/P90|",
	);
	lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
	for (const profile of report.profiles) {
		lines.push(
			`|${profile.story}|${profile.profile}|${profile.completedRuns}/${profile.failedRuns.length}|${profile.rounds}|${formatMean(profile.repetition.mean)}（${profile.repetition.pairs}）|${formatMean(profile.progression.mean)}（${profile.progression.samples}）|${profile.probes.consistent + profile.probes.contradicted}/${profile.probes.skipped}/${profile.probes.failed}|${formatNumber(profile.cost.writerRequestsPerRound)}|${formatNumber(profile.cost.backgroundRequestsPerRound)}|${profile.cost.warmupRequests}|${formatPercentile(profile.cost.firstTokenMs)}|${formatPercentile(profile.cost.durationMs)}|`,
		);
	}
	lines.push("");
	lines.push("## 失败");
	lines.push("");
	for (const profile of report.profiles) {
		for (const failure of profile.failedRuns) {
			lines.push(
				`- ${profile.story} ${profile.profile} 第 ${failure.branchFloor} 楼：${failure.error}`,
			);
		}
		if (profile.failures > 0) {
			lines.push(
				`- ${profile.story} ${profile.profile}：失败轮次 ${profile.failures}`,
			);
		}
	}
	return lines.join("\n");
}

function formatMean(value: number | null): string {
	return value === null ? "—" : value.toFixed(4);
}

function formatNumber(value: number | null): string {
	return value === null ? "—" : value.toFixed(2);
}

function formatPercentile(summary: PercentileSummary | null): string {
	return summary === null ? "—" : `${summary.p50}/${summary.p90}`;
}
