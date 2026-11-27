import { createHash } from "node:crypto";
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
	createStandardChatSlots,
} from "@dramaticer/core";
import { resolveStoryContextTemplate } from "../chat/session.js";
import {
	type DeepEvalBranchFailureRecord,
	type DeepEvalBranchRecord,
	type DeepEvalJudgement,
	type DeepEvalRecord,
	type DeepEvalSummary,
	type DeepEvalTurnRecord,
	countTrailingTurnFailures,
	runDeepEval,
	summarizeDeepEval,
} from "./deep-eval.js";
import {
	type R6DeepGateInput,
	type R6PairCounts,
	type R6PairOutcome,
	type R6PairSide,
	R6_DEEP_BRANCH_POINTS,
	R6_DEEP_ROUNDS,
	R6_GATE_VERSION,
	type WilsonInterval,
	normalizePairOutcome,
	wilsonInterval,
} from "./gates.js";
import {
	type R6WarmupRecord,
	countClient,
	countStreamingClient,
	prepareR6RunCopy,
	warmupR6Copy,
} from "./r6-compare.js";

export const R6_DEEP_FORMAT = "dramaticer.r6-deep";
export const R6_DEEP_RUN_FORMAT = "dramaticer.r6-deep-run";
export const DEFAULT_R6_DEEP_SEED = 1;
export const R6_DEEP_MAX_CONSECUTIVE_FAILURES = 3;

export interface R6DeepOptions {
	/** 已导入故事与卡的数据库；每个故事复制一份。 */
	readonly sourceDbPath: string;
	readonly stories: readonly string[];
	/** 每个故事的深回合轮数；默认预注册的 20 轮。 */
	readonly rounds?: number;
	/** 每个故事的分支点数；默认预注册的 8 个。 */
	readonly branches?: number;
	readonly dir: string;
	readonly writer: {
		readonly client: LlmStreamingClient;
		readonly model: string;
	};
	readonly user: { readonly client: LlmClient; readonly model: string };
	readonly judge: { readonly client: LlmClient; readonly model: string };
	/** 预热用的后台客户端。 */
	readonly background: { readonly client: LlmClient };
	readonly structuredOutput: StructuredOutputMode;
	readonly budgetTokens: number;
	readonly toolTransport?: LlmToolTransport | null;
	readonly embedder?: EmbeddingClient | null;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly reasoning?: LlmReasoningLevel;
	readonly seed?: number;
	readonly log?: (message: string) => void;
	readonly now?: () => number;
}

export interface R6DeepCost {
	readonly writerRequests: number;
	readonly writerCachedRequests: number;
	readonly userRequests: number;
	readonly judgeRequests: number;
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly totalTokens: number;
}

/** 一个故事一个运行副本；同时是续跑用的 sidecar。 */
export interface R6DeepRunRecord {
	readonly format: typeof R6_DEEP_RUN_FORMAT;
	readonly story: string;
	readonly branchNodeId: string;
	readonly rounds: number;
	readonly branches: number;
	readonly seed: number;
	readonly writerModel: string;
	readonly userModel: string;
	readonly judgeModel: string;
	readonly warmup: R6WarmupRecord;
	readonly status: "running" | "done" | "failed";
	readonly error: string | null;
	readonly startedAt: string;
	readonly finishedAt: string | null;
	readonly records: readonly DeepEvalRecord[];
	readonly cost: R6DeepCost;
}

export interface R6DeepStorySummary {
	readonly story: string;
	readonly status: string;
	readonly error: string | null;
	readonly plannedPairs: number;
	readonly completedPairs: number;
	readonly pairs: R6PairCounts;
	readonly failures: number;
	readonly branchFailures: number;
	readonly missingPairs: number;
	readonly turns: {
		readonly completed: number;
		readonly failed: number;
		/** 完成轮次的工具调用次数合计。 */
		readonly toolCalls: number;
	};
	readonly cost: R6DeepCost;
}

export interface R6DeepSummary {
	readonly plannedPairs: number;
	readonly completedPairs: number;
	readonly pairs: R6PairCounts;
	/** 计划配对里没有完成的全部计入失败。 */
	readonly failures: number;
	readonly branchFailures: number;
	readonly missingPairs: number;
	readonly winRate: number | null;
	readonly wilson: WilsonInterval | null;
	readonly excludedShare: number | null;
	readonly inconsistentShare: number | null;
	readonly turns: {
		readonly completed: number;
		readonly failed: number;
		readonly failureRate: number;
		/** 完成轮次的工具调用次数合计；为 0 时 G5 不可测。 */
		readonly toolCalls: number;
	};
	readonly cost: R6DeepCost & {
		readonly writerRequestsPerTurn: number | null;
		readonly judgeRequestsPerPair: number | null;
		readonly warmupRequests: number;
	};
	readonly stories: readonly R6DeepStorySummary[];
}

export interface R6DeepReport {
	readonly format: typeof R6_DEEP_FORMAT;
	readonly gateVersion: string;
	readonly generatedAt: string;
	readonly stories: readonly string[];
	readonly rounds: number;
	readonly branches: number;
	readonly seed: number;
	readonly writerModel: string;
	readonly userModel: string;
	readonly judgeModel: string;
	readonly runs: readonly R6DeepRunRecord[];
	readonly summary: R6DeepSummary;
}

interface StoryRunOptions extends R6DeepOptions {
	readonly story: string;
	readonly rounds: number;
	readonly branches: number;
	readonly seed: number;
	readonly log: (message: string) => void;
	readonly now: () => number;
}

interface MutableRun {
	format: typeof R6_DEEP_RUN_FORMAT;
	story: string;
	branchNodeId: string;
	rounds: number;
	branches: number;
	seed: number;
	writerModel: string;
	userModel: string;
	judgeModel: string;
	warmup: R6WarmupRecord;
	status: "running" | "done" | "failed";
	error: string | null;
	startedAt: string;
	finishedAt: string | null;
	records: DeepEvalRecord[];
	cost: R6DeepCost;
}

interface ClientCounters {
	readonly writer: number;
	readonly writerCached: number;
	readonly user: number;
	readonly judge: number;
}

/**
 * 每个故事复制一份源数据库，预热分支点之前 12 楼，再跑固定轮数的深回合；
 * 在 `selectBranchRounds(rounds, branches)` 的每个分支点用同一玩家楼层
 * 再生成一次快回合，两种展示顺序各判一次。
 */
export async function runR6Deep(options: R6DeepOptions): Promise<R6DeepReport> {
	const rounds = options.rounds ?? R6_DEEP_ROUNDS;
	const branches = options.branches ?? R6_DEEP_BRANCH_POINTS;
	const seed = options.seed ?? DEFAULT_R6_DEEP_SEED;
	assertOptions(options, rounds, branches, seed);
	const log = options.log ?? (() => undefined);
	const now = options.now ?? Date.now;
	const stories = [...new Set(options.stories)];
	await mkdir(options.dir, { recursive: true });
	const runs: R6DeepRunRecord[] = [];
	for (const story of stories) {
		log(`深回合批次：${story}，${rounds} 轮，${branches} 个分支点`);
		runs.push(
			await runStory({ ...options, story, rounds, branches, seed, log, now }),
		);
	}
	return {
		format: R6_DEEP_FORMAT,
		gateVersion: R6_GATE_VERSION,
		generatedAt: new Date(now()).toISOString(),
		stories,
		rounds,
		branches,
		seed,
		writerModel: options.writer.model,
		userModel: options.user.model,
		judgeModel: options.judge.model,
		runs,
		summary: summarizeR6Deep({ stories, branches, runs }),
	};
}

/** 把批次汇总换成 G5 的判定输入。 */
export function r6DeepGateInput(report: R6DeepReport): R6DeepGateInput {
	return {
		plannedPairs: report.summary.plannedPairs,
		pairs: report.summary.pairs,
		failures: report.summary.failures,
		turns: {
			completed: report.summary.turns.completed,
			failed: report.summary.turns.failed,
		},
		toolCalls: report.summary.turns.toolCalls,
	};
}

export function summarizeR6Deep(input: {
	readonly stories: readonly string[];
	readonly branches: number;
	readonly runs: readonly R6DeepRunRecord[];
}): R6DeepSummary {
	const byStory = new Map(input.runs.map((run) => [run.story, run]));
	const stories = input.stories.map((story) =>
		summarizeStory(story, input.branches, byStory.get(story)),
	);
	const pairs = sumPairs(stories.map((story) => story.pairs));
	const plannedPairs = stories.length * input.branches;
	const completedPairs =
		pairs.wins + pairs.losses + pairs.ties + pairs.inconsistent;
	const failures = plannedPairs - completedPairs;
	const branchFailures = sum(stories, (story) => story.branchFailures);
	const missingPairs = sum(stories, (story) => story.missingPairs);
	const decided = pairs.wins + pairs.losses;
	const turnCompleted = sum(stories, (story) => story.turns.completed);
	const turnFailed = sum(stories, (story) => story.turns.failed);
	const turnToolCalls = sum(stories, (story) => story.turns.toolCalls);
	const turnTotal = turnCompleted + turnFailed;
	const cost = sumCosts(stories.map((story) => story.cost));
	const warmupRequests = sum(
		input.runs,
		(run) => run.warmup.settleRequests + run.warmup.sceneRequests,
	);
	return {
		plannedPairs,
		completedPairs,
		pairs,
		failures,
		branchFailures,
		missingPairs,
		winRate: decided === 0 ? null : pairs.wins / decided,
		wilson: wilsonInterval(pairs.wins, decided),
		excludedShare:
			plannedPairs === 0
				? null
				: (pairs.ties + pairs.inconsistent + failures) / plannedPairs,
		inconsistentShare:
			completedPairs === 0 ? null : pairs.inconsistent / completedPairs,
		turns: {
			completed: turnCompleted,
			failed: turnFailed,
			failureRate: turnTotal === 0 ? 0 : turnFailed / turnTotal,
			toolCalls: turnToolCalls,
		},
		cost: {
			...cost,
			writerRequestsPerTurn:
				turnCompleted === 0 ? null : cost.writerRequests / turnCompleted,
			judgeRequestsPerPair:
				completedPairs === 0 ? null : cost.judgeRequests / completedPairs,
			warmupRequests,
		},
		stories,
	};
}

function summarizeStory(
	story: string,
	branches: number,
	run: R6DeepRunRecord | undefined,
): R6DeepStorySummary {
	if (run === undefined) {
		return {
			story,
			status: "missing",
			error: "没有运行记录",
			plannedPairs: branches,
			completedPairs: 0,
			pairs: emptyPairs(),
			failures: branches,
			branchFailures: 0,
			missingPairs: branches,
			turns: { completed: 0, failed: 0, toolCalls: 0 },
			cost: emptyCost(),
		};
	}
	const summary: DeepEvalSummary = summarizeDeepEval(run.records);
	const latest = latestBranchRecords(run.records);
	const pairs = emptyPairs();
	let branchFailures = 0;
	for (const record of latest.values()) {
		if ("status" in record) {
			branchFailures += 1;
			continue;
		}
		const outcome = branchOutcome(record);
		if (outcome === null) {
			branchFailures += 1;
			continue;
		}
		countOutcome(pairs, outcome);
	}
	const completedPairs =
		pairs.wins + pairs.losses + pairs.ties + pairs.inconsistent;
	const missingPairs = Math.max(0, branches - completedPairs - branchFailures);
	return {
		story,
		status: run.status,
		error: run.error,
		plannedPairs: branches,
		completedPairs,
		pairs,
		failures: branches - completedPairs,
		branchFailures,
		missingPairs,
		turns: {
			completed: summary.turns.completed,
			failed: summary.turns.failed,
			toolCalls: summary.turns.toolCalls.total,
		},
		cost: run.cost,
	};
}

/** 每个样本取最后一条分支记录；重复运行以最新为准。 */
function latestBranchRecords(
	records: readonly DeepEvalRecord[],
): Map<string, DeepEvalBranchRecord | DeepEvalBranchFailureRecord> {
	const latest = new Map<
		string,
		DeepEvalBranchRecord | DeepEvalBranchFailureRecord
	>();
	for (const record of records) {
		if (record.kind === "branch") latest.set(record.sampleId, record);
	}
	return latest;
}

/**
 * 两条判定各自落到候选侧（深回合）、基准侧（快回合）或平；
 * 再按预注册的配对归一换算成胜、负、平或换序不一致。
 */
function branchOutcome(record: DeepEvalBranchRecord): R6PairOutcome | null {
	const latest = new Map<string, DeepEvalJudgement>();
	for (const judgement of record.judgements) {
		latest.set(judgement.order, judgement);
	}
	const first = latest.get("deep-first");
	const second = latest.get("fast-first");
	if (first === undefined || second === undefined) return null;
	return normalizePairOutcome(
		judgementSide(first.order, first.winner),
		judgementSide(second.order, second.winner),
	);
}

function judgementSide(
	order: DeepEvalJudgement["order"],
	winner: DeepEvalJudgement["winner"],
): R6PairSide {
	if (winner === "tie") return "tie";
	const deepIsA = order === "deep-first";
	const aIsDeep = winner === "A" ? deepIsA : !deepIsA;
	return aIsDeep ? "candidate" : "baseline";
}

function countOutcome(
	pairs: {
		wins: number;
		losses: number;
		ties: number;
		inconsistent: number;
	},
	outcome: R6PairOutcome,
): void {
	if (outcome === "win") pairs.wins += 1;
	else if (outcome === "loss") pairs.losses += 1;
	else if (outcome === "tie") pairs.ties += 1;
	else pairs.inconsistent += 1;
}

function emptyPairs(): {
	wins: number;
	losses: number;
	ties: number;
	inconsistent: number;
} {
	return { wins: 0, losses: 0, ties: 0, inconsistent: 0 };
}

function sumPairs(items: readonly R6PairCounts[]): R6PairCounts {
	return {
		wins: sum(items, (item) => item.wins),
		losses: sum(items, (item) => item.losses),
		ties: sum(items, (item) => item.ties),
		inconsistent: sum(items, (item) => item.inconsistent),
	};
}

function emptyCost(): R6DeepCost {
	return {
		writerRequests: 0,
		writerCachedRequests: 0,
		userRequests: 0,
		judgeRequests: 0,
		promptTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
	};
}

function sumCosts(items: readonly R6DeepCost[]): R6DeepCost {
	return {
		writerRequests: sum(items, (item) => item.writerRequests),
		writerCachedRequests: sum(items, (item) => item.writerCachedRequests),
		userRequests: sum(items, (item) => item.userRequests),
		judgeRequests: sum(items, (item) => item.judgeRequests),
		promptTokens: sum(items, (item) => item.promptTokens),
		completionTokens: sum(items, (item) => item.completionTokens),
		totalTokens: sum(items, (item) => item.totalTokens),
	};
}

function assertOptions(
	options: R6DeepOptions,
	rounds: number,
	branches: number,
	seed: number,
): void {
	if (!Number.isInteger(rounds) || rounds < 1) {
		throw new Error(`深回合轮数必须是正整数，收到 ${rounds}`);
	}
	if (!Number.isInteger(branches) || branches < 1) {
		throw new Error(`分支点数必须是正整数，收到 ${branches}`);
	}
	if (branches > rounds) {
		throw new Error(`分支点数 ${branches} 不能多于轮数 ${rounds}`);
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

async function runStory(options: StoryRunOptions): Promise<R6DeepRunRecord> {
	const file = sidecarFile(options);
	const existing = await loadSidecar(file);
	if (existing !== null) {
		validateSidecar(existing, file, options);
		if (existing.status === "done") {
			options.log(`${options.story}：复用已完成的深回合运行`);
			return existing;
		}
		options.log(
			`${options.story}：从 sidecar 续跑（上次 ${existing.status}），已有 ${existing.records.length} 条记录`,
		);
	}
	const runDir = path.dirname(file);
	const dbPath = path.join(runDir, "deep.db");
	await mkdir(runDir, { recursive: true });
	const store = await openRunStore(existing, dbPath, options);
	try {
		const settings = store.getStorySettings(options.story);
		const template = resolveStoryContextTemplate(
			store,
			settings.templateId,
			options.structuredOutput,
			settings.contextLayout,
		);
		const slots = await createStandardChatSlots({
			store,
			characterPrompt: settings.characterPrompt,
			embedder: options.embedder,
			historyBlockPolicy: settings.historyBlockPolicy,
			worldModel: settings.worldModel,
		});
		let run: MutableRun;
		if (existing === null) {
			const head = store.getHead(options.story);
			if (head === null) throw new Error(`故事 ${options.story} 没有 head`);
			const warmup = await warmupR6Copy({
				store,
				storyId: options.story,
				branchNodeId: head.id,
				client: options.background.client,
				now: options.now,
			});
			options.log(
				`${options.story}：预热 ${warmup.floorNodeIds.length} 楼，请求 ${warmup.settleRequests + warmup.sceneRequests}`,
			);
			run = {
				format: R6_DEEP_RUN_FORMAT,
				story: options.story,
				branchNodeId: head.id,
				rounds: options.rounds,
				branches: options.branches,
				seed: options.seed,
				writerModel: options.writer.model,
				userModel: options.user.model,
				judgeModel: options.judge.model,
				warmup,
				status: "running",
				error: null,
				startedAt: new Date(options.now()).toISOString(),
				finishedAt: null,
				records: [],
				cost: emptyCost(),
			};
			await saveSidecar(file, run);
		} else {
			run = {
				...existing,
				records: [...existing.records],
				status: "running",
				error: null,
				finishedAt: null,
			};
			await saveSidecar(file, run);
		}
		alignHead(store, run);
		const writer = countStreamingClient(options.writer.client);
		const user = countClient(options.user.client);
		const judge = countClient(options.judge.client);
		let counters = snapshotCounters(writer, user, judge);
		try {
			await runDeepEval({
				store,
				storyId: options.story,
				turns: options.rounds,
				branches: options.branches,
				profile: "native",
				seed: options.seed,
				assistant: {
					client: writer.client,
					model: options.writer.model,
				},
				user: { client: user.client, model: options.user.model },
				judge: { client: judge.client, model: options.judge.model },
				turn: {
					template,
					providers: slots.providers,
					budgetTokens: options.budgetTokens,
					structuredOutput: options.structuredOutput,
					toolTransport: options.toolTransport,
					embedder: options.embedder,
					viewpoint: settings.viewpoint,
					maxTokens: options.maxTokens ?? settings.maxTokens,
					temperature: options.temperature ?? settings.temperature,
					reasoning: options.reasoning ?? settings.reasoning,
				},
				existing: run.records,
				maxConsecutiveFailures: R6_DEEP_MAX_CONSECUTIVE_FAILURES,
				onRecord: async (record) => {
					run.records.push(record);
					const next = snapshotCounters(writer, user, judge);
					accumulateCost(run, counters, next);
					counters = next;
					await saveSidecar(file, run);
				},
				log: options.log,
				now: options.now,
			});
		} catch (error) {
			run.status = "failed";
			run.error = error instanceof Error ? error.message : String(error);
			run.finishedAt = new Date(options.now()).toISOString();
			await saveSidecar(file, run);
			options.log(`${options.story}：运行失败：${run.error}`);
			return run;
		}
		const trailing = countTrailingTurnFailures(run.records);
		if (trailing >= R6_DEEP_MAX_CONSECUTIVE_FAILURES) {
			run.status = "failed";
			run.error = `连续 ${trailing} 轮失败，终止该次运行`;
		} else {
			run.status = "done";
		}
		run.finishedAt = new Date(options.now()).toISOString();
		await saveSidecar(file, run);
		options.log(
			`${options.story}：${run.status}，${run.records.filter((record) => record.kind === "turn").length} 条深回合记录`,
		);
		return run;
	} finally {
		store.close();
	}
}

function alignHead(store: StoryStore, run: R6DeepRunRecord): void {
	const done = run.records.filter(
		(record): record is DeepEvalTurnRecord =>
			record.kind === "turn" && record.status === "done",
	);
	const last = done.reduce<DeepEvalTurnRecord | null>(
		(latest, record) =>
			latest === null || record.round > latest.round ? record : latest,
		null,
	);
	store.setHead(run.story, last?.nodeId ?? run.branchNodeId);
}

function snapshotCounters(
	writer: {
		readonly stats: {
			readonly requests: number;
			readonly cachedRequests: number;
		};
	},
	user: { readonly stats: { readonly requests: number } },
	judge: { readonly stats: { readonly requests: number } },
): ClientCounters {
	return {
		writer: writer.stats.requests,
		writerCached: writer.stats.cachedRequests,
		user: user.stats.requests,
		judge: judge.stats.requests,
	};
}

function accumulateCost(
	run: MutableRun,
	previous: ClientCounters,
	next: ClientCounters,
): void {
	run.cost = {
		...run.cost,
		writerRequests: run.cost.writerRequests + (next.writer - previous.writer),
		writerCachedRequests:
			run.cost.writerCachedRequests +
			(next.writerCached - previous.writerCached),
		userRequests: run.cost.userRequests + (next.user - previous.user),
		judgeRequests: run.cost.judgeRequests + (next.judge - previous.judge),
		promptTokens: sumTurnUsage(run.records, "promptTokens"),
		completionTokens: sumTurnUsage(run.records, "completionTokens"),
		totalTokens: sumTurnUsage(run.records, "totalTokens"),
	};
}

function sumTurnUsage(
	records: readonly DeepEvalRecord[],
	key: "promptTokens" | "completionTokens" | "totalTokens",
): number {
	const latest = new Map<number, DeepEvalTurnRecord>();
	for (const record of records) {
		if (record.kind === "turn" && record.status === "done") {
			latest.set(record.round, record);
		}
	}
	let total = 0;
	for (const record of latest.values()) total += record.usage[key] ?? 0;
	return total;
}

async function openRunStore(
	existing: R6DeepRunRecord | null,
	dbPath: string,
	options: StoryRunOptions,
): Promise<StoryStore> {
	if (existing === null) {
		return prepareR6RunCopy({
			sourceDbPath: options.sourceDbPath,
			story: options.story,
			branchNodeId: await sourceHead(options),
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

async function sourceHead(options: StoryRunOptions): Promise<string> {
	const store = StoryStoreClass.open(options.sourceDbPath);
	try {
		if (store.getStory(options.story) === null) {
			throw new Error(
				`数据库 ${options.sourceDbPath} 里没有故事 ${options.story}`,
			);
		}
		const head = store.getHead(options.story);
		if (head === null) {
			throw new Error(`故事 ${options.story} 没有 head`);
		}
		if (head.role !== "assistant") {
			throw new Error(
				`故事 ${options.story} 的 head 是 ${head.role}，深回合批次需要助手楼层`,
			);
		}
		return head.id;
	} finally {
		store.close();
	}
}

function sidecarFile(options: {
	readonly dir: string;
	readonly story: string;
}): string {
	return path.join(
		options.dir,
		"runs",
		storyDirectory(options.story),
		"deep.json",
	);
}

function storyDirectory(story: string): string {
	const safe = story.replace(/[^A-Za-z0-9._-]+/g, "_");
	const digest = createHash("sha256").update(story).digest("hex").slice(0, 8);
	return `${safe}-${digest}`;
}

async function saveSidecar(file: string, run: R6DeepRunRecord): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp`;
	await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, "utf8");
	await rename(temporary, file);
}

async function loadSidecar(file: string): Promise<R6DeepRunRecord | null> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const value: unknown = JSON.parse(raw);
	if (!isRunRecord(value)) {
		throw new Error(`${file} 不是有效的深回合批次结果文件`);
	}
	return value;
}

function isRunRecord(value: unknown): value is R6DeepRunRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		record.format === R6_DEEP_RUN_FORMAT &&
		typeof record.story === "string" &&
		typeof record.branchNodeId === "string" &&
		typeof record.rounds === "number" &&
		typeof record.branches === "number" &&
		typeof record.seed === "number" &&
		typeof record.writerModel === "string" &&
		typeof record.userModel === "string" &&
		typeof record.judgeModel === "string" &&
		typeof record.status === "string" &&
		Array.isArray(record.records)
	);
}

function validateSidecar(
	run: R6DeepRunRecord,
	file: string,
	options: StoryRunOptions,
): void {
	const mismatches: string[] = [];
	if (run.story !== options.story) mismatches.push("故事");
	if (run.rounds !== options.rounds) mismatches.push("轮数");
	if (run.branches !== options.branches) mismatches.push("分支点");
	if (run.seed !== options.seed) mismatches.push("随机种子");
	if (run.writerModel !== options.writer.model) mismatches.push("写作模型");
	if (run.userModel !== options.user.model) mismatches.push("用户模型");
	if (run.judgeModel !== options.judge.model) mismatches.push("裁判模型");
	if (mismatches.length > 0) {
		throw new Error(
			`${file} 与本次运行不一致：${mismatches.join("、")}；删除该文件后重跑`,
		);
	}
}

export function formatR6DeepReport(report: R6DeepReport): string {
	const summary = report.summary;
	const lines: string[] = [];
	lines.push("# R6 深回合增益批次");
	lines.push("");
	lines.push(
		`- 故事：${report.stories.join("、")}；轮数 ${report.rounds}；分支点 ${report.branches}；种子 ${report.seed}；门槛版本 ${report.gateVersion}`,
	);
	lines.push(
		`- 模型：写作 ${report.writerModel}、用户 ${report.userModel}、裁判 ${report.judgeModel}`,
	);
	lines.push(
		`- 配对：计划 ${summary.plannedPairs}，完成 ${summary.completedPairs}，胜 ${summary.pairs.wins}、负 ${summary.pairs.losses}、平 ${summary.pairs.ties}、换序不一致 ${summary.pairs.inconsistent}、失败 ${summary.failures}（分支失败 ${summary.branchFailures}，缺失 ${summary.missingPairs}）`,
	);
	lines.push(
		`- 胜率：${formatPercent(summary.winRate)}（Wilson 95% ${formatInterval(summary.wilson)}）；换序不一致比例 ${formatPercent(summary.inconsistentShare)}；排除比例 ${formatPercent(summary.excludedShare)}`,
	);
	lines.push(
		`- 深回合：完成 ${summary.turns.completed}，失败 ${summary.turns.failed}，失败率 ${formatPercent(summary.turns.failureRate)}；工具调用合计 ${summary.turns.toolCalls}`,
	);
	lines.push(
		`- 成本：写作请求 ${summary.cost.writerRequests}（缓存 ${summary.cost.writerCachedRequests}）、用户请求 ${summary.cost.userRequests}、裁判请求 ${summary.cost.judgeRequests}、预热请求 ${summary.cost.warmupRequests}；输入 token ${summary.cost.promptTokens}、输出 token ${summary.cost.completionTokens}、合计 ${summary.cost.totalTokens}`,
	);
	lines.push(
		"- 口径：每个故事复制源数据库并对 head 之前 12 楼预热；20 轮深回合中按等距轮次取 8 个分支点，在同一玩家楼层再生成一次快回合；两种展示顺序各判一次，胜率分母只含胜与负。",
	);
	lines.push("");
	lines.push(
		"|故事|状态|计划|完成|胜|负|平|换序不一致|失败|深回合完成|深回合失败|",
	);
	lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
	for (const story of summary.stories) {
		lines.push(
			`|${story.story}|${story.status}|${story.plannedPairs}|${story.completedPairs}|${story.pairs.wins}|${story.pairs.losses}|${story.pairs.ties}|${story.pairs.inconsistent}|${story.failures}|${story.turns.completed}|${story.turns.failed}|`,
		);
	}
	lines.push("");
	lines.push("## 失败");
	lines.push("");
	let failureLines = 0;
	for (const run of report.runs) {
		if (run.status === "failed") {
			failureLines += 1;
			lines.push(`- ${run.story}：${run.error ?? "未知错误"}`);
		}
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

function sum<T>(items: readonly T[], value: (item: T) => number): number {
	let total = 0;
	for (const item of items) total += value(item);
	return total;
}
