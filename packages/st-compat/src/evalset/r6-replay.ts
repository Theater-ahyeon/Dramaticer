import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	type EmbeddingClient,
	type LlmClient,
	type LlmReasoningLevel,
	type LlmStreamingClient,
	type LlmToolTransport,
	type LlmUsage,
	type StoryStore,
	StoryStore as StoryStoreClass,
	type StructuredOutputMode,
	type TimelineNode,
	createStandardChatSlots,
	generateAssistantTurn,
	modelFamily,
	parseBlocks,
	renderContextView,
} from "@dramaticer/core";
import { resolveStoryContextTemplate } from "../chat/session.js";
import {
	type R6PairCounts,
	type R6PairOutcome,
	type R6PairSide,
	type R6PairingSample,
	type R6ReplayGateInput,
	R6_GATE_VERSION,
	type WilsonInterval,
	normalizePairOutcome,
	wilsonInterval,
} from "./gates.js";
import {
	type B1Order,
	B1_ORDERS,
	type HistoricalReplayRecord,
	judgeHistoricalReplaySample,
	normalizeB1Winner,
} from "./historical-replay.js";
import { formatPairwiseContext } from "./pairwise.js";
import {
	type R6WarmupRecord,
	countStreamingClient,
	prepareR6RunCopy,
	warmupR6Copy,
} from "./r6-compare.js";
import type { R6AaGeneration, R6AaSample } from "./r6-instrument.js";

export const R6_REPLAY_FORMAT = "dramaticer.r6-replay";
export const R6_REPLAY_RUN_FORMAT = "dramaticer.r6-replay-run";
/** G1 与 A/A 的第一次生成；A/A 的第二次生成用种子 2。 */
export const DEFAULT_R6_REPLAY_SEED = 1;
export const R6_REPLAY_AA_SEED = 2;

/** 配对的两组：续写对放弃侧、续写对接受侧。 */
export const R6_REPLAY_GROUPS = ["abandoned", "accepted"] as const;
export type R6ReplayGroup = (typeof R6_REPLAY_GROUPS)[number];

/**
 * 一个重 roll 点：同一玩家楼层下有多条助手兄弟楼层，head 路径上的那条是
 * 玩家保留的回复，下标紧邻其下的是被放弃的回复。
 */
export interface R6ReplayPoint {
	readonly sampleId: string;
	readonly story: string;
	/** 玩家楼层在路径上的序号，从 1 开始。 */
	readonly floor: number;
	readonly parentUserNodeId: string;
	readonly userText: string;
	readonly acceptedNodeId: string;
	readonly acceptedSwipeIndex: number;
	readonly abandonedNodeId: string;
	readonly abandonedSwipeIndex: number;
	/** 同一楼层里更早的被放弃 swipe 条数；只报告，不进入配对。 */
	readonly extraAbandoned: number;
	/** 被接受的回复是不是该楼层下标最大的 swipe。 */
	readonly acceptedIsLastSwipe: boolean;
}

export interface R6ReplayGeneration {
	readonly nodeId: string;
	/** 送进裁判的显示文本；去掉不进入上下文与阅读视图的块。 */
	readonly text: string;
	readonly firstTokenMs: number | null;
	readonly durationMs: number | null;
	readonly promptTokens: number;
	readonly completionTokens: number;
}

export type R6ReplayJudgement = {
	readonly group: R6ReplayGroup;
	readonly order: B1Order;
	readonly attempts: number;
	readonly usage: LlmUsage | null;
	readonly model: string;
	readonly createdAt: string;
} & (
	| {
			readonly status: "done";
			readonly winner: "A" | "B" | "tie";
			readonly reason: string;
			readonly error: null;
			/** 生成失败时占位的判定记录；不调用裁判。 */
			readonly stage: "judge";
	  }
	| {
			readonly status: "failed";
			readonly winner: null;
			readonly reason: null;
			readonly error: string;
			readonly stage: "generation" | "judge";
	  }
);

/** 一个重 roll 点的运行记录；同时是续跑用的 sidecar。 */
export interface R6ReplayRunRecord {
	readonly format: typeof R6_REPLAY_RUN_FORMAT;
	readonly sampleId: string;
	readonly story: string;
	readonly floor: number;
	readonly parentUserNodeId: string;
	readonly acceptedNodeId: string;
	readonly acceptedSwipeIndex: number;
	readonly abandonedNodeId: string;
	readonly abandonedSwipeIndex: number;
	readonly extraAbandoned: number;
	readonly acceptedIsLastSwipe: boolean;
	readonly userText: string;
	readonly writerModel: string;
	readonly judgeModel: string;
	readonly seed1: number;
	readonly seed2: number;
	readonly warmup: R6WarmupRecord;
	readonly status: "running" | "done" | "failed";
	readonly error: string | null;
	readonly seed1Generation: R6ReplayGeneration | null;
	readonly seed2Generation: R6ReplayGeneration | null;
	readonly judgments: readonly R6ReplayJudgement[];
	/** 送进裁判的最近对话；A/A 样本直接用它，续跑后与第一次相同。 */
	readonly context: string;
	readonly outcomes: {
		readonly abandoned: R6PairOutcome | null;
		readonly accepted: R6PairOutcome | null;
	};
	readonly outcomeErrors: {
		readonly abandoned: string | null;
		readonly accepted: string | null;
	};
	readonly startedAt: string;
	readonly finishedAt: string | null;
}

export interface R6ReplayOptions {
	/** 已导入故事与卡的数据库；每个重 roll 点复制一份。 */
	readonly sourceDbPath: string;
	readonly stories: readonly string[];
	readonly dir: string;
	readonly writer: {
		readonly client: LlmStreamingClient;
		readonly model: string;
	};
	readonly judge: { readonly client: LlmClient; readonly model: string };
	/** 预热 settle 与 scene 用。 */
	readonly background: { readonly client: LlmClient };
	readonly structuredOutput: StructuredOutputMode;
	readonly budgetTokens: number;
	readonly toolTransport?: LlmToolTransport | null;
	readonly embedder?: EmbeddingClient | null;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly reasoning?: LlmReasoningLevel;
	readonly seed?: number;
	/** 只跑指定的玩家楼层，用于缩样；不设置时跑全部重 roll 点。 */
	readonly floors?: readonly number[];
	readonly log?: (message: string) => void;
	readonly now?: () => number;
}

export interface R6ReplayStorySummary {
	readonly story: string;
	readonly plannedPairs: number;
	readonly completedPairs: number;
	readonly wins: number;
	readonly losses: number;
	readonly ties: number;
	readonly inconsistent: number;
	readonly failures: number;
}

export interface R6ReplayGroupSummary {
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
	readonly stories: readonly R6ReplayStorySummary[];
}

export interface R6ReplaySummary {
	readonly plannedPairs: number;
	readonly extraAbandoned: number;
	readonly acceptedNotLast: number;
	/** 父楼层是助手楼层、无法回放的重 roll 点数。 */
	readonly skippedAssistantParent: number;
	readonly groups: Readonly<Record<R6ReplayGroup, R6ReplayGroupSummary>>;
	readonly gateInput: R6ReplayGateInput;
}

export interface R6ReplayReport {
	readonly format: typeof R6_REPLAY_FORMAT;
	readonly gateVersion: string;
	readonly generatedAt: string;
	readonly stories: readonly string[];
	readonly seed1: number;
	readonly seed2: number;
	readonly writer: { readonly model: string; readonly family: string };
	readonly judge: { readonly model: string; readonly family: string };
	readonly points: readonly R6ReplayPoint[];
	readonly runs: readonly R6ReplayRunRecord[];
	readonly summary: R6ReplaySummary;
}

type MutableRun = {
	-readonly [K in keyof R6ReplayRunRecord]: R6ReplayRunRecord[K];
};

interface ReplayRunOptions extends R6ReplayOptions {
	readonly story: string;
	readonly point: R6ReplayPoint;
	readonly seed1: number;
	readonly seed2: number;
	readonly log: (message: string) => void;
	readonly now: () => number;
}

export interface R6ReplayPlan {
	readonly points: readonly R6ReplayPoint[];
	/** 兄弟楼层的父楼层是助手楼层、无法回放的点数。 */
	readonly skippedAssistantParent: number;
}

export function r6ReplaySampleId(story: string, floor: number): string {
	return `${story}:${floor}:reroll`;
}

/**
 * 从路径上取重 roll 点：每个助手楼层在其玩家父楼层下有多条助手兄弟楼层时算一个点。
 * 被接受的是路径上的那一楼，放弃侧取 swipe 下标紧邻其下的那条。
 *
 * 父楼层是助手楼层（连续两条助手消息）的兄弟楼层无法回放：生成一条回复
 * 需要玩家楼层作为输入，这类点只计数、不进入配对。
 */
export function planR6Replay(
	story: string,
	path: readonly TimelineNode[],
	siblingsByParent: ReadonlyMap<string, readonly TimelineNode[]>,
): R6ReplayPlan {
	const points: R6ReplayPoint[] = [];
	let skippedAssistantParent = 0;
	path.forEach((node, index) => {
		if (node.role !== "assistant") return;
		if (node.parentId === null) return;
		const siblings = siblingsByParent.get(node.parentId) ?? [];
		if (siblings.length < 2) return;
		const parent = path[index - 1];
		if (parent === undefined || parent.id !== node.parentId) {
			throw new Error(`故事 ${story} 第 ${index + 1} 个楼层的父楼层不在路径上`);
		}
		if (parent.role !== "user") {
			skippedAssistantParent += 1;
			return;
		}
		const acceptedSwipe = swipeIndexOf(node.id);
		const byIndex = new Map<number, TimelineNode>();
		for (const sibling of siblings) {
			byIndex.set(swipeIndexOf(sibling.id), sibling);
		}
		const abandoned = byIndex.get(acceptedSwipe - 1);
		if (abandoned === undefined) {
			throw new Error(
				`故事 ${story} 第 ${index + 1} 个楼层的被接受 swipe 是 ${acceptedSwipe}，没有下标紧邻其下的兄弟楼层`,
			);
		}
		const maxIndex = Math.max(...byIndex.keys());
		points.push({
			sampleId: r6ReplaySampleId(story, index + 1),
			story,
			floor: index + 1,
			parentUserNodeId: parent.id,
			userText: parent.raw,
			acceptedNodeId: node.id,
			acceptedSwipeIndex: acceptedSwipe,
			abandonedNodeId: abandoned.id,
			abandonedSwipeIndex: acceptedSwipe - 1,
			extraAbandoned: siblings.length - 2,
			acceptedIsLastSwipe: acceptedSwipe === maxIndex,
		});
	});
	return { points, skippedAssistantParent };
}

/** 兄弟楼层的 swipe 下标只从节点 id 后缀 `:s<N>` 读。 */
export function swipeIndexOf(nodeId: string): number {
	const match = /:s(\d+)$/.exec(nodeId);
	if (match === null) {
		throw new Error(`楼层 id ${nodeId} 缺少 swipe 下标`);
	}
	return Number(match[1]);
}

/** 每个重 roll 点复制一份源数据库，预热 12 楼，按两个种子各生成一次续写并配对。 */
export async function runR6Replay(
	options: R6ReplayOptions,
): Promise<R6ReplayReport> {
	const seed1 = options.seed ?? DEFAULT_R6_REPLAY_SEED;
	const seed2 = R6_REPLAY_AA_SEED;
	assertOptions(options, seed1, seed2);
	const log = options.log ?? (() => undefined);
	const now = options.now ?? Date.now;
	const stories = [...new Set(options.stories)];
	await mkdir(options.dir, { recursive: true });
	const planned = await planStories(options, stories);
	const runs: R6ReplayRunRecord[] = [];
	for (const story of stories) {
		for (const point of planned.planned.get(story) ?? []) {
			log(
				`${story} 第 ${point.floor} 楼：重 roll 点（接受 swipe ${point.acceptedSwipeIndex}，放弃 swipe ${point.abandonedSwipeIndex}，另有 ${point.extraAbandoned} 条更早的放弃 swipe）`,
			);
			runs.push(
				await runPoint({
					...options,
					story,
					point,
					seed1,
					seed2,
					log,
					now,
				}),
			);
		}
	}
	const points = stories.flatMap((story) => planned.planned.get(story) ?? []);
	await writeAaSamples(
		path.join(options.dir, "aa-samples.jsonl"),
		points,
		runs,
	);
	return {
		format: R6_REPLAY_FORMAT,
		gateVersion: R6_GATE_VERSION,
		generatedAt: new Date(now()).toISOString(),
		stories,
		seed1,
		seed2,
		writer: {
			model: options.writer.model,
			family: modelFamily(options.writer.model),
		},
		judge: {
			model: options.judge.model,
			family: modelFamily(options.judge.model),
		},
		points,
		runs,
		summary: summarizeR6Replay({
			points,
			runs,
			skippedAssistantParent: planned.skippedAssistantParent,
		}),
	};
}

async function planStories(
	options: R6ReplayOptions,
	stories: readonly string[],
): Promise<{
	readonly planned: Map<string, R6ReplayPoint[]>;
	readonly skippedAssistantParent: number;
}> {
	if (options.floors !== undefined && stories.length !== 1) {
		throw new Error("玩家楼层只能和单个故事一起使用");
	}
	const store = StoryStoreClass.open(options.sourceDbPath);
	try {
		const planned = new Map<string, R6ReplayPoint[]>();
		let skippedAssistantParent = 0;
		for (const story of stories) {
			if (store.getStory(story) === null) {
				throw new Error(`数据库 ${options.sourceDbPath} 里没有故事 ${story}`);
			}
			const path = store.getPathToHead(story);
			const siblingsByParent = new Map<string, TimelineNode[]>();
			for (const node of store.listStoryNodes(story)) {
				if (node.role !== "assistant" || node.parentId === null) continue;
				const list = siblingsByParent.get(node.parentId);
				if (list === undefined) siblingsByParent.set(node.parentId, [node]);
				else list.push(node);
			}
			const plan = planR6Replay(story, path, siblingsByParent);
			skippedAssistantParent += plan.skippedAssistantParent;
			if (plan.points.length === 0) {
				throw new Error(`故事 ${story} 的主路径上没有可回放的重 roll 点`);
			}
			planned.set(
				story,
				options.floors === undefined
					? [...plan.points]
					: pickUserFloors(plan.points, options.floors, story),
			);
		}
		return { planned, skippedAssistantParent };
	} finally {
		store.close();
	}
}

function pickUserFloors(
	points: readonly R6ReplayPoint[],
	floors: readonly number[],
	story: string,
): R6ReplayPoint[] {
	if (floors.length === 0) {
		throw new Error("玩家楼层列表不能为空");
	}
	const available = new Map(points.map((point) => [point.floor, point]));
	return floors.map((floor) => {
		const point = available.get(floor);
		if (point === undefined) {
			throw new Error(
				`故事 ${story} 没有楼层 ${floor} 的重 roll 点；可用楼层：${[...available.keys()].join("、")}`,
			);
		}
		return point;
	});
}

function assertOptions(
	options: R6ReplayOptions,
	seed1: number,
	seed2: number,
): void {
	for (const [label, seed] of [
		["种子 1", seed1],
		["种子 2", seed2],
	] as const) {
		if (!Number.isInteger(seed) || seed < 0) {
			throw new Error(`${label}必须是非负整数，收到 ${seed}`);
		}
	}
	if (seed1 === seed2) {
		throw new Error(`两个种子必须不同，都是 ${seed1}`);
	}
	if (options.stories.length === 0) throw new Error("至少需要一个故事");
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

async function runPoint(options: ReplayRunOptions): Promise<R6ReplayRunRecord> {
	const file = sidecarFile(options);
	const existing = await loadSidecar(file);
	if (existing !== null) {
		validateSidecar(existing, file, options);
		if (existing.status !== "running") {
			options.log(`${options.point.sampleId}：复用已完成的样本`);
			return existing;
		}
		options.log(`${options.point.sampleId}：从 sidecar 续跑`);
	}
	const runDir = path.dirname(file);
	const dbPath = path.join(runDir, "native.db");
	await mkdir(runDir, { recursive: true });
	let store: StoryStore;
	try {
		store = await openRunStore(existing, dbPath, options);
	} catch (error) {
		return await failWithoutStore(file, existing, options, error);
	}
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
			directorConfig: settings.directorConfig,
			historyBlockPolicy: settings.historyBlockPolicy,
			worldModel: settings.worldModel,
			directorOrganization: settings.directorOrganization,
		});
		const run: MutableRun =
			existing === null
				? newRun(options)
				: {
						...existing,
						judgments: [...existing.judgments],
					};
		if (existing === null) {
			run.warmup = await warmupR6Copy({
				store,
				storyId: options.story,
				branchNodeId: options.point.parentUserNodeId,
				client: options.background.client,
				now: options.now,
			});
			options.log(
				`${options.point.sampleId}：预热 ${run.warmup.floorNodeIds.length} 楼，请求 ${run.warmup.settleRequests + run.warmup.sceneRequests}`,
			);
			await saveSidecar(file, run);
		}
		for (const [label, field, seed] of [
			["种子 1", "seed1Generation", options.seed1],
			["种子 2", "seed2Generation", options.seed2],
		] as const) {
			if (run[field] !== null) continue;
			const writer = countStreamingClient(options.writer.client);
			store.setHead(options.story, options.point.parentUserNodeId);
			try {
				const result = await generateAssistantTurn({
					store,
					client: writer.client,
					storyId: options.story,
					userNodeId: options.point.parentUserNodeId,
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
					seed,
					now: options.now,
				});
				run[field] = {
					nodeId: result.node.id,
					text: displayText(result.node.raw),
					firstTokenMs: result.trace.timing.firstTokenMs,
					durationMs: result.trace.timing.durationMs,
					promptTokens: result.trace.llm.usage.promptTokens ?? 0,
					completionTokens: result.trace.llm.usage.completionTokens ?? 0,
				};
			} catch (caught) {
				run.status = "failed";
				run.error = `${label}生成失败：${
					caught instanceof Error ? caught.message : String(caught)
				}`;
				run.finishedAt = new Date(options.now()).toISOString();
				fillGenerationFailures(run, options, run.error);
				await saveSidecar(file, run);
				options.log(`${options.point.sampleId}：${run.error}`);
				return run;
			}
			await saveSidecar(file, run);
			options.log(
				`${options.point.sampleId}：${label}生成 ${run[field]?.nodeId}，首字 ${run[field]?.firstTokenMs ?? "—"} 毫秒`,
			);
		}
		const seed1Generation = run.seed1Generation;
		if (seed1Generation === null) {
			throw new Error(`${options.point.sampleId} 的种子 1 生成记录缺失`);
		}
		const accepted = store.getNode(options.point.acceptedNodeId);
		const abandoned = store.getNode(options.point.abandonedNodeId);
		if (accepted === null || abandoned === null) {
			throw new Error(`${options.point.sampleId} 的兄弟楼层不在运行副本里`);
		}
		const context = formatPairwiseContext(
			store.getPathToNode(options.point.parentUserNodeId),
		);
		if (run.context !== context) {
			run.context = context;
			await saveSidecar(file, run);
		}
		for (const group of R6_REPLAY_GROUPS) {
			const baselineText = displayText(
				(group === "accepted" ? accepted : abandoned).raw,
			);
			const known = new Set(
				run.judgments
					.filter((record) => record.group === group)
					.map((record) => record.order),
			);
			if (B1_ORDERS.every((order) => known.has(order))) continue;
			const records = await judgeHistoricalReplaySample(
				{
					sampleId: `${options.point.sampleId}:${group}`,
					storyId: options.story,
					profile: "native",
					context,
					generatedText: seed1Generation.text,
					historicalText: baselineText,
				},
				options.judge,
				{ now: () => new Date(options.now()).toISOString() },
			);
			run.judgments = mergeJudgments(run.judgments, group, records);
			await saveSidecar(file, run);
			options.log(
				`${options.point.sampleId}（${group === "abandoned" ? "对放弃侧" : "对接受侧"}）：${run.judgments
					.filter((record) => record.group === group)
					.map((record) =>
						record.status === "done"
							? `${record.order} ${record.winner}`
							: `${record.order} 失败`,
					)
					.join("，")}`,
			);
		}
		const abandonedOutcome = computeOutcome(run.judgments, "abandoned");
		const acceptedOutcome = computeOutcome(run.judgments, "accepted");
		run.outcomes = {
			abandoned: abandonedOutcome.outcome,
			accepted: acceptedOutcome.outcome,
		};
		run.outcomeErrors = {
			abandoned: abandonedOutcome.error,
			accepted: acceptedOutcome.error,
		};
		run.status = "done";
		run.error = null;
		run.finishedAt = new Date(options.now()).toISOString();
		await saveSidecar(file, run);
		return run;
	} finally {
		store.close();
	}
}

function newRun(options: ReplayRunOptions): MutableRun {
	return {
		format: R6_REPLAY_RUN_FORMAT,
		sampleId: options.point.sampleId,
		story: options.story,
		floor: options.point.floor,
		parentUserNodeId: options.point.parentUserNodeId,
		acceptedNodeId: options.point.acceptedNodeId,
		acceptedSwipeIndex: options.point.acceptedSwipeIndex,
		abandonedNodeId: options.point.abandonedNodeId,
		abandonedSwipeIndex: options.point.abandonedSwipeIndex,
		extraAbandoned: options.point.extraAbandoned,
		acceptedIsLastSwipe: options.point.acceptedIsLastSwipe,
		userText: options.point.userText,
		writerModel: options.writer.model,
		judgeModel: options.judge.model,
		seed1: options.seed1,
		seed2: options.seed2,
		warmup: {
			floorNodeIds: [],
			settleRequests: 0,
			sceneRequests: 0,
			cachedRequests: 0,
		},
		status: "running",
		error: null,
		seed1Generation: null,
		seed2Generation: null,
		judgments: [],
		context: "",
		outcomes: { abandoned: null, accepted: null },
		outcomeErrors: { abandoned: null, accepted: null },
		startedAt: new Date(options.now()).toISOString(),
		finishedAt: null,
	};
}

/** 复制数据库或预热失败时写一条失败记录；样本之间互不影响。 */
async function failWithoutStore(
	file: string,
	existing: R6ReplayRunRecord | null,
	options: ReplayRunOptions,
	error: unknown,
): Promise<R6ReplayRunRecord> {
	const run: MutableRun =
		existing === null
			? newRun(options)
			: {
					...existing,
					judgments: [...existing.judgments],
				};
	const message = error instanceof Error ? error.message : String(error);
	run.status = "failed";
	run.error = `准备运行副本失败：${message}`;
	run.finishedAt = new Date(options.now()).toISOString();
	fillGenerationFailures(run, options, run.error);
	await saveSidecar(file, run);
	options.log(`${options.point.sampleId}：${run.error}`);
	return run;
}

/** 生成失败时两组配对各占两个失败槽位，避免失败样本被算成未完成。 */
function fillGenerationFailures(
	run: MutableRun,
	options: ReplayRunOptions,
	error: string,
): void {
	const createdAt = new Date(options.now()).toISOString();
	const records: R6ReplayJudgement[] = [];
	for (const group of R6_REPLAY_GROUPS) {
		for (const order of B1_ORDERS) {
			records.push({
				group,
				order,
				attempts: 0,
				usage: null,
				model: options.judge.model,
				createdAt,
				status: "failed",
				winner: null,
				reason: null,
				error,
				stage: "generation",
			});
		}
	}
	run.judgments = records;
}

/** 两种展示顺序都完成时才能归入胜、负、平或换序不一致。 */
function computeOutcome(
	records: readonly R6ReplayJudgement[],
	group: R6ReplayGroup,
): { readonly outcome: R6PairOutcome | null; readonly error: string | null } {
	const latest = new Map<B1Order, R6ReplayJudgement>();
	for (const record of records) {
		if (record.group === group) latest.set(record.order, record);
	}
	const missing = B1_ORDERS.filter((order) => !latest.has(order));
	if (missing.length > 0) {
		return { outcome: null, error: `缺少判定顺序：${missing.join("、")}` };
	}
	const sides: R6PairSide[] = [];
	const errors: string[] = [];
	for (const order of B1_ORDERS) {
		const record = latest.get(order) as R6ReplayJudgement;
		if (record.status !== "done") {
			errors.push(`${order}：${record.error}`);
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
	existing: readonly R6ReplayJudgement[],
	group: R6ReplayGroup,
	fresh: readonly HistoricalReplayRecord[],
): R6ReplayJudgement[] {
	const merged = new Map<B1Order, R6ReplayJudgement>();
	for (const record of existing) {
		if (record.group === group) merged.set(record.order, record);
	}
	for (const record of fresh) {
		merged.set(record.order, {
			group,
			order: record.order,
			attempts: record.attempts,
			usage: record.usage,
			model: record.model,
			createdAt: record.createdAt,
			...(record.status === "done"
				? {
						status: "done" as const,
						winner: record.winner,
						reason: record.reason,
						error: null,
						stage: "judge" as const,
					}
				: {
						status: "failed" as const,
						winner: null,
						reason: null,
						error: record.error,
						stage: "judge" as const,
					}),
		});
	}
	return [
		...existing.filter((record) => record.group !== group),
		...B1_ORDERS.flatMap((order) => {
			const record = merged.get(order);
			return record === undefined ? [] : [record];
		}),
	];
}

/** 汇总两组配对并直接给出 G1 的判定输入。 */
export function summarizeR6Replay(input: {
	readonly points: readonly R6ReplayPoint[];
	readonly runs: readonly R6ReplayRunRecord[];
	readonly skippedAssistantParent: number;
}): R6ReplaySummary {
	const runById = new Map(input.runs.map((run) => [run.sampleId, run]));
	const storyIds = [...new Set(input.points.map((point) => point.story))];
	const groups = {
		abandoned: summarizeGroup("abandoned", input, storyIds, runById),
		accepted: summarizeGroup("accepted", input, storyIds, runById),
	};
	return {
		plannedPairs: input.points.length,
		extraAbandoned: input.points.reduce(
			(total, point) => total + point.extraAbandoned,
			0,
		),
		acceptedNotLast: input.points.filter((point) => !point.acceptedIsLastSwipe)
			.length,
		skippedAssistantParent: input.skippedAssistantParent,
		groups,
		gateInput: {
			abandoned: pairingSample(groups.abandoned),
			accepted: pairingSample(groups.accepted),
		},
	};
}

function summarizeGroup(
	group: R6ReplayGroup,
	input: {
		readonly points: readonly R6ReplayPoint[];
		readonly runs: readonly R6ReplayRunRecord[];
	},
	storyIds: readonly string[],
	runById: ReadonlyMap<string, R6ReplayRunRecord>,
): R6ReplayGroupSummary {
	const stories: R6ReplayStorySummary[] = storyIds.map((story) => {
		let wins = 0;
		let losses = 0;
		let ties = 0;
		let inconsistent = 0;
		let failures = 0;
		const points = input.points.filter((point) => point.story === story);
		for (const point of points) {
			const run = runById.get(point.sampleId);
			const outcome = run?.outcomes[group] ?? null;
			if (outcome === "win") wins += 1;
			else if (outcome === "loss") losses += 1;
			else if (outcome === "tie") ties += 1;
			else if (outcome === "inconsistent") inconsistent += 1;
			else failures += 1;
		}
		return {
			story,
			plannedPairs: points.length,
			completedPairs: wins + losses + ties + inconsistent,
			wins,
			losses,
			ties,
			inconsistent,
			failures,
		};
	});
	const pairs: R6PairCounts = {
		wins: sum(stories, (story) => story.wins),
		losses: sum(stories, (story) => story.losses),
		ties: sum(stories, (story) => story.ties),
		inconsistent: sum(stories, (story) => story.inconsistent),
	};
	const failures = sum(stories, (story) => story.failures);
	const plannedPairs = input.points.length;
	const completedPairs =
		pairs.wins + pairs.losses + pairs.ties + pairs.inconsistent;
	const decided = pairs.wins + pairs.losses;
	const judgements = input.runs.flatMap((run) =>
		run.judgments.filter((record) => record.group === group),
	);
	const judgementsCompleted = judgements.filter(
		(record) => record.status === "done",
	).length;
	const judgementsFailed = judgements.filter(
		(record) => record.status === "failed",
	).length;
	const judgeTotal = judgementsCompleted + judgementsFailed;
	const excluded = pairs.ties + pairs.inconsistent + failures;
	return {
		plannedPairs,
		completedPairs,
		pairs,
		failures,
		judgementsCompleted,
		judgementsFailed,
		winRate: decided === 0 ? null : pairs.wins / decided,
		wilson: wilsonInterval(pairs.wins, decided),
		excludedShare: plannedPairs === 0 ? null : excluded / plannedPairs,
		inconsistentShare:
			completedPairs === 0 ? null : pairs.inconsistent / completedPairs,
		judgeFailureShare: judgeTotal === 0 ? null : judgementsFailed / judgeTotal,
		stories,
	};
}

function pairingSample(summary: R6ReplayGroupSummary): R6PairingSample {
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

/** A/A 样本：种子 1 与种子 2 的两次生成，供 `r6-instrument` 使用。 */
export async function writeAaSamples(
	file: string,
	points: readonly R6ReplayPoint[],
	runs: readonly R6ReplayRunRecord[],
): Promise<void> {
	const runById = new Map(runs.map((run) => [run.sampleId, run]));
	const samples: R6AaSample[] = [];
	for (const point of points) {
		const run = runById.get(point.sampleId);
		if (run === undefined) continue;
		samples.push({
			sampleId: point.sampleId,
			story: point.story,
			context: run.context,
			seed1: aaGeneration(run.seed1Generation, run.error),
			seed2: aaGeneration(run.seed2Generation, run.error),
		});
	}
	await mkdir(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp`;
	await writeFile(
		temporary,
		samples.map((sample) => `${JSON.stringify(sample)}\n`).join(""),
		"utf8",
	);
	await rename(temporary, file);
}

function aaGeneration(
	generation: R6ReplayGeneration | null,
	error: string | null,
): R6AaGeneration {
	return generation === null
		? { status: "failed", error: error ?? "生成记录缺失" }
		: { status: "done", text: generation.text };
}

async function openRunStore(
	existing: R6ReplayRunRecord | null,
	dbPath: string,
	options: ReplayRunOptions,
): Promise<StoryStore> {
	if (existing === null) {
		const store = await prepareR6RunCopy({
			sourceDbPath: options.sourceDbPath,
			story: options.story,
			branchNodeId: options.point.acceptedNodeId,
			dbPath,
		});
		try {
			store.setHead(options.story, options.point.parentUserNodeId);
			return store;
		} catch (error) {
			store.close();
			throw error;
		}
	}
	if (!existsSync(dbPath)) {
		throw new Error(
			`续跑需要的运行数据库不存在：${dbPath}；删除 ${sidecarFile(options)} 后重跑`,
		);
	}
	return StoryStoreClass.open(dbPath);
}

/** 去掉不入上下文与阅读视图的块；渲染结果为空时退回原文。 */
function displayText(raw: string): string {
	const rendered = renderContextView(parseBlocks(raw)).trim();
	return rendered.length > 0 ? rendered : raw;
}

function sidecarFile(options: {
	readonly dir: string;
	readonly story: string;
	readonly point: R6ReplayPoint;
}): string {
	return path.join(
		options.dir,
		"runs",
		safeSegment(options.story),
		String(options.point.floor),
		"replay.json",
	);
}

function safeSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

async function saveSidecar(
	file: string,
	run: R6ReplayRunRecord,
): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp`;
	await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, "utf8");
	await rename(temporary, file);
}

async function loadSidecar(file: string): Promise<R6ReplayRunRecord | null> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const value: unknown = JSON.parse(raw);
	if (!isRunRecord(value)) {
		throw new Error(`${file} 不是有效的重 roll 回放结果文件`);
	}
	return value;
}

function isRunRecord(value: unknown): value is R6ReplayRunRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		record.format === R6_REPLAY_RUN_FORMAT &&
		typeof record.sampleId === "string" &&
		typeof record.story === "string" &&
		typeof record.floor === "number" &&
		typeof record.parentUserNodeId === "string" &&
		typeof record.acceptedNodeId === "string" &&
		typeof record.abandonedNodeId === "string" &&
		(record.status === "running" ||
			record.status === "done" ||
			record.status === "failed") &&
		typeof record.warmup === "object" &&
		record.warmup !== null &&
		Array.isArray(record.judgments) &&
		typeof record.context === "string"
	);
}

function validateSidecar(
	run: R6ReplayRunRecord,
	file: string,
	options: ReplayRunOptions,
): void {
	const mismatches: string[] = [];
	if (run.sampleId !== options.point.sampleId) mismatches.push("样本");
	if (run.story !== options.story) mismatches.push("故事");
	if (run.floor !== options.point.floor) mismatches.push("玩家楼层");
	if (run.parentUserNodeId !== options.point.parentUserNodeId) {
		mismatches.push("玩家楼层节点");
	}
	if (run.acceptedNodeId !== options.point.acceptedNodeId) {
		mismatches.push("被接受的回复");
	}
	if (run.abandonedNodeId !== options.point.abandonedNodeId) {
		mismatches.push("被放弃的回复");
	}
	if (run.acceptedSwipeIndex !== options.point.acceptedSwipeIndex) {
		mismatches.push("接受侧 swipe 下标");
	}
	if (run.abandonedSwipeIndex !== options.point.abandonedSwipeIndex) {
		mismatches.push("放弃侧 swipe 下标");
	}
	if (run.userText !== options.point.userText) mismatches.push("玩家消息");
	if (run.writerModel !== options.writer.model) mismatches.push("写作模型");
	if (run.judgeModel !== options.judge.model) mismatches.push("裁判模型");
	if (run.seed1 !== options.seed1) mismatches.push("种子 1");
	if (run.seed2 !== options.seed2) mismatches.push("种子 2");
	if (mismatches.length > 0) {
		throw new Error(
			`${file} 与本次运行不一致：${mismatches.join("、")}；删除该文件后重跑`,
		);
	}
}

export function formatR6ReplayReport(report: R6ReplayReport): string {
	const summary = report.summary;
	const lines: string[] = [];
	lines.push("# R6 重 roll 点回放（G1）");
	lines.push("");
	lines.push(
		`- 故事：${report.stories.join("、")}；种子：${report.seed1} 与 ${report.seed2}；门槛版本：${report.gateVersion}`,
	);
	lines.push(
		`- 模型：写作 ${report.writer.model}（${report.writer.family}）、裁判 ${report.judge.model}（${report.judge.family}）`,
	);
	lines.push(
		`- 重 roll 点：计划 ${summary.plannedPairs}，另有更早的被放弃 swipe ${summary.extraAbandoned} 条（不进入配对），被接受不是最后一条 swipe 的点 ${summary.acceptedNotLast} 个，父楼层不是玩家楼层而无法回放的点 ${summary.skippedAssistantParent} 个`,
	);
	lines.push(
		"- 口径：每个点复制源数据库、预热 12 楼，按种子 1 与种子 2 各生成一次续写；种子 1 的续写分别与被放弃侧、被接受侧配对，两种展示顺序各判一次，胜率分母只含胜与负。",
	);
	lines.push("");
	for (const group of R6_REPLAY_GROUPS) {
		const entry = summary.groups[group];
		lines.push(`## ${group === "abandoned" ? "对放弃侧" : "对接受侧"}`);
		lines.push("");
		lines.push(
			`- 配对：计划 ${entry.plannedPairs}，完成 ${entry.completedPairs}，胜 ${entry.pairs.wins}、负 ${entry.pairs.losses}、平 ${entry.pairs.ties}、换序不一致 ${entry.pairs.inconsistent}、失败 ${entry.failures}`,
		);
		lines.push(
			`- 胜率：${formatPercent(entry.winRate)}（Wilson 95% ${formatInterval(entry.wilson)}）；换序不一致比例 ${formatPercent(entry.inconsistentShare)}；排除比例 ${formatPercent(entry.excludedShare)}；裁判失败比例 ${formatPercent(entry.judgeFailureShare)}`,
		);
		lines.push("");
		lines.push("|故事|计划|完成|胜|负|平|换序不一致|失败|");
		lines.push("|---|---|---|---|---|---|---|---|");
		for (const story of entry.stories) {
			lines.push(
				`|${story.story}|${story.plannedPairs}|${story.completedPairs}|${story.wins}|${story.losses}|${story.ties}|${story.inconsistent}|${story.failures}|`,
			);
		}
		lines.push("");
	}
	lines.push("## 失败");
	lines.push("");
	let failureLines = 0;
	for (const run of report.runs) {
		if (run.status === "failed") {
			failureLines += 1;
			lines.push(
				`- ${run.story} 第 ${run.floor} 楼：${run.error ?? "未知错误"}`,
			);
			continue;
		}
		for (const group of R6_REPLAY_GROUPS) {
			if (run.outcomes[group] !== null) continue;
			failureLines += 1;
			lines.push(
				`- ${run.story} 第 ${run.floor} 楼（${group === "abandoned" ? "对放弃侧" : "对接受侧"}）：${run.outcomeErrors[group] ?? "未知错误"}`,
			);
		}
	}
	if (failureLines === 0) lines.push("- 无");
	lines.push("");
	lines.push("## G1 判定输入");
	lines.push("");
	lines.push("```json");
	lines.push(JSON.stringify(summary.gateInput, null, 2));
	lines.push("```");
	lines.push("");
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
