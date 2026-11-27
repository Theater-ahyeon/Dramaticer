import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	type ContextSlotProviders,
	type ContextTemplate,
	type EmbeddingClient,
	type LlmClient,
	type LlmReasoningLevel,
	type LlmStreamingClient,
	type LlmToolTransport,
	type StoryStore,
	StoryStore as StoryStoreClass,
	type StructuredOutputMode,
	WRITING_MODE_KEY,
	createStandardChatSlots,
	runChatTurn,
} from "@dramaticer/core";
import { type PercentileSummary, summarizePercentiles } from "./deep-eval.js";
import {
	type R6GateResult,
	type R6InstrumentGateInput,
	R6_GATE_VERSION,
	R6_PROBE_INTERVAL_ROUNDS,
	R6_PROBE_MAX_PER_RUN,
	R6_PROBE_MIN_FACT_AGE,
	evaluateR6InstrumentGate,
} from "./gates.js";
import {
	type PreferenceComparisonRecord,
	type PreferenceComparisonSummary,
	type PreferenceSample,
	runPreferenceSample,
	summarizePreferenceComparisons,
} from "./pairwise.js";
import { type PlaytestProbeRecord, runPlaytestProbe } from "./probe.js";
import {
	type R6BranchPoint,
	countStreamingClient,
	planR6BranchPoints,
	selectR6C1BranchPoints,
} from "./r6-compare.js";

export const TURN_MODE_COMPARE_FORMAT = "dramaticer.turn-mode-compare";
export const TURN_MODE_RUN_FORMAT = "dramaticer.turn-mode-compare-run";
export const TURN_MODE_CANDIDATES = ["fast", "plan", "deep"] as const;
export type TurnModeCandidate = (typeof TURN_MODE_CANDIDATES)[number];
export const DEFAULT_TURN_MODE_REPETITIONS = 1;
export const DEFAULT_TURN_MODE_SEED = 1;

const CANDIDATE_LABELS: Readonly<Record<TurnModeCandidate, string>> = {
	fast: "快速",
	plan: "规划",
	deep: "深度",
};

export interface TurnModeCompareOptions {
	/** 已导入故事与卡的数据库；每个分支点、候选与重复各复制一份。 */
	readonly sourceDbPath: string;
	readonly story: string;
	readonly rounds: number;
	/** 每个候选都使用同一串玩家消息。 */
	readonly messages: readonly string[];
	readonly repetitions?: number;
	readonly dir: string;
	readonly writer: {
		readonly client: LlmStreamingClient;
		readonly model: string;
	};
	readonly judge: { readonly client: LlmClient; readonly model: string };
	readonly template: ContextTemplate;
	readonly budgetTokens: number;
	readonly structuredOutput: StructuredOutputMode;
	/** 裁判先通过 G0；不通过时直接失败，不产出胜率。 */
	readonly instrument: R6InstrumentGateInput;
	/** 只跑指定的分支点楼层，用于缩样冒烟；不设置时取首、中、末三个。 */
	readonly branchFloors?: readonly number[];
	readonly toolTransport?: LlmToolTransport | null;
	readonly embedder?: EmbeddingClient | null;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly reasoning?: LlmReasoningLevel;
	readonly seed?: number;
	readonly log?: (message: string) => void;
	readonly now?: () => number;
}

export interface TurnModeRoundRecord {
	readonly round: number;
	readonly userText: string;
	readonly reply: string | null;
	readonly firstTokenMs: number | null;
	readonly durationMs: number | null;
	/** 这一楼消耗的写作请求数，包含规划准备与深度工具往返。 */
	readonly requests: number;
	readonly cachedRequests: number;
	readonly probe: PlaytestProbeRecord | null;
	readonly error: string | null;
	/** 续跑时用楼层把 head 对齐到记录末尾。 */
	readonly userNodeId: string | null;
	readonly assistantNodeId: string | null;
}

export interface TurnModeRunRecord {
	readonly format: typeof TURN_MODE_RUN_FORMAT;
	readonly mode: TurnModeCandidate;
	readonly repetition: number;
	readonly story: string;
	readonly branchFloor: number;
	readonly branchNodeId: string;
	readonly rounds: number;
	readonly messagesHash: string;
	readonly seed: number;
	readonly writerModel: string;
	readonly judgeModel: string;
	readonly status: "running" | "done" | "failed";
	readonly error: string | null;
	readonly startedAt: string;
	readonly finishedAt: string | null;
	readonly records: readonly TurnModeRoundRecord[];
}

export interface TurnModeCandidateReport {
	readonly mode: TurnModeCandidate;
	readonly label: string;
	readonly repetitions: number;
	readonly completedRuns: number;
	readonly failedRuns: readonly {
		readonly branchFloor: number;
		readonly repetition: number;
		readonly error: string;
	}[];
	readonly floors: number;
	readonly requests: number;
	readonly cachedRequests: number;
	readonly requestsPerFloor: number | null;
	readonly probes: {
		readonly attempts: number;
		readonly done: number;
		readonly skipped: number;
		readonly failed: number;
		readonly consistent: number;
		readonly contradicted: number;
		readonly unknown: number;
	};
	/** 矛盾数除以一致与矛盾之和；没有可判定样本时为 null。 */
	readonly contradictionRate: number | null;
	/** 对快速写法的非平局胜率；快速写法自身为 null。 */
	readonly winRate: number | null;
	readonly cost: {
		readonly firstTokenMs: PercentileSummary | null;
		readonly durationMs: PercentileSummary | null;
	};
	readonly pairwise: PreferenceComparisonSummary;
}

export interface TurnModeCompareReport {
	readonly format: typeof TURN_MODE_COMPARE_FORMAT;
	readonly gateVersion: string;
	readonly generatedAt: string;
	readonly story: string;
	readonly rounds: number;
	readonly repetitions: number;
	readonly seed: number;
	readonly messageCount: number;
	readonly branchPoints: readonly R6BranchPoint[];
	/** G0 的判定结果；不通过时运行不会开始。 */
	readonly validity: R6GateResult;
	readonly candidates: readonly TurnModeCandidateReport[];
	readonly runs: readonly TurnModeRunRecord[];
}

export async function runTurnModeCompare(
	options: TurnModeCompareOptions,
): Promise<TurnModeCompareReport> {
	const repetitions = options.repetitions ?? DEFAULT_TURN_MODE_REPETITIONS;
	const seed = options.seed ?? DEFAULT_TURN_MODE_SEED;
	assertCompareOptions(options, repetitions, seed);
	const validity = evaluateR6InstrumentGate(options.instrument);
	if (validity.status !== "pass") {
		throw new Error(`裁判未通过有效性检查：${validity.reason}`);
	}
	const log = options.log ?? (() => undefined);
	const now = options.now ?? Date.now;
	const messagesHash = hashMessages(options.messages);
	await mkdir(options.dir, { recursive: true });
	const branchPoints = await planBranches(options);
	const runs: TurnModeRunRecord[] = [];
	for (const branch of branchPoints) {
		for (const mode of TURN_MODE_CANDIDATES) {
			for (let repetition = 1; repetition <= repetitions; repetition += 1) {
				const run = await runCandidate({
					...options,
					mode,
					branch,
					repetition,
					messagesHash,
					seed,
					log,
					now,
				});
				await saveRun(options.dir, run);
				runs.push(run);
				log(
					`${CANDIDATE_LABELS[mode]} 第 ${branch.floor} 楼第 ${repetition} 次：${run.status}，${run.records.length} 轮`,
				);
			}
		}
	}
	const pairwiseByMode = await judgePairs({
		runs,
		messages: options.messages,
		judge: options.judge,
		log,
	});
	const candidates = TURN_MODE_CANDIDATES.map((mode) =>
		summarizeCandidate({
			mode,
			repetitions,
			runs: runs.filter((run) => run.mode === mode),
			pairwise: pairwiseByMode.get(mode) ?? summarizePreferenceComparisons([]),
		}),
	);
	return {
		format: TURN_MODE_COMPARE_FORMAT,
		gateVersion: R6_GATE_VERSION,
		generatedAt: new Date(now()).toISOString(),
		story: options.story,
		rounds: options.rounds,
		repetitions,
		seed,
		messageCount: options.messages.length,
		branchPoints,
		validity,
		candidates,
		runs,
	};
}

function assertCompareOptions(
	options: TurnModeCompareOptions,
	repetitions: number,
	seed: number,
): void {
	if (options.story.trim().length === 0) {
		throw new Error("故事 id 不能为空");
	}
	if (!Number.isInteger(options.rounds) || options.rounds < 1) {
		throw new Error(`对比运行的轮数必须是正整数，收到 ${options.rounds}`);
	}
	if (!Number.isInteger(repetitions) || repetitions < 1) {
		throw new Error(`每种写法的重复次数必须是正整数，收到 ${repetitions}`);
	}
	if (!Number.isInteger(seed) || seed < 0) {
		throw new Error(`随机种子必须是非负整数，收到 ${seed}`);
	}
	if (options.messages.length < options.rounds) {
		throw new Error(
			`玩家消息只有 ${options.messages.length} 条，不足 ${options.rounds} 轮`,
		);
	}
	options.messages.slice(0, options.rounds).forEach((message, index) => {
		if (message.trim().length === 0) {
			throw new Error(`第 ${index + 1} 条玩家消息不能为空`);
		}
	});
	if (!Number.isInteger(options.budgetTokens) || options.budgetTokens < 1) {
		throw new Error(`token 预算必须是正整数，收到 ${options.budgetTokens}`);
	}
	if (options.sourceDbPath.trim().length === 0) {
		throw new Error("源数据库路径不能为空");
	}
}

async function planBranches(
	options: TurnModeCompareOptions,
): Promise<R6BranchPoint[]> {
	const store = StoryStoreClass.open(options.sourceDbPath);
	try {
		const story = store.getStory(options.story);
		if (story === null) {
			throw new Error(
				`数据库 ${options.sourceDbPath} 里没有故事 ${options.story}`,
			);
		}
		const planned = planR6BranchPoints(store.getPathToHead(options.story));
		if (planned.length === 0) {
			throw new Error(`故事 ${options.story} 的主路径上没有可用的分支点`);
		}
		if (options.branchFloors === undefined) {
			return selectR6C1BranchPoints(planned);
		}
		if (options.branchFloors.length === 0) {
			throw new Error("分支点列表不能为空");
		}
		const byFloor = new Map(planned.map((point) => [point.floor, point]));
		return options.branchFloors.map((floor) => {
			const point = byFloor.get(floor);
			if (point === undefined) {
				throw new Error(
					`故事 ${options.story} 没有楼层 ${floor} 的分支点；可用楼层：${[...byFloor.keys()].join("、")}`,
				);
			}
			return point;
		});
	} finally {
		store.close();
	}
}

interface MutableRun
	extends Omit<
		TurnModeRunRecord,
		"records" | "status" | "error" | "finishedAt"
	> {
	records: TurnModeRoundRecord[];
	status: TurnModeRunRecord["status"];
	error: string | null;
	finishedAt: string | null;
}

interface CandidateRunOptions extends TurnModeCompareOptions {
	readonly mode: TurnModeCandidate;
	readonly branch: R6BranchPoint;
	readonly repetition: number;
	readonly messagesHash: string;
	readonly seed: number;
}

async function runCandidate(
	options: CandidateRunOptions,
): Promise<TurnModeRunRecord> {
	const log = options.log ?? (() => undefined);
	const now = options.now ?? Date.now;
	const file = runFile(options);
	const existing = await loadRun(file, options);
	if (existing !== null && existing.status !== "running") {
		log(
			`${CANDIDATE_LABELS[options.mode]} 第 ${options.branch.floor} 楼第 ${options.repetition} 次：复用已完成的样本`,
		);
		return existing;
	}
	const runDir = path.dirname(file);
	const dbPath = path.join(
		runDir,
		`${options.branch.floor}-${options.repetition}.db`,
	);
	await mkdir(runDir, { recursive: true });
	if (existing === null) {
		for (const target of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
			await rm(target, { force: true });
		}
		await copyFile(options.sourceDbPath, dbPath);
	}
	const store = StoryStoreClass.open(dbPath);
	let run: MutableRun | null = null;
	try {
		const node = store.getNode(options.branch.nodeId);
		if (node === null || node.storyId !== options.story) {
			throw new Error(`分支点 ${options.branch.nodeId} 不在故事里`);
		}
		const records = existing?.records ?? [];
		const last = [...records]
			.reverse()
			.find((record) => record.assistantNodeId !== null);
		store.setHead(
			options.story,
			last?.assistantNodeId ?? options.branch.nodeId,
		);
		store.updateStorySettings(options.story, {
			turnMode: options.mode === "deep" ? "deep" : "fast",
		});
		store.setStoryValue(
			options.story,
			WRITING_MODE_KEY,
			options.mode === "plan" ? "plan" : null,
		);
		const settings = store.getStorySettings(options.story);
		const slots = await createStandardChatSlots({
			store,
			characterPrompt: settings.characterPrompt,
			embedder: options.embedder,
			historyBlockPolicy: settings.historyBlockPolicy,
			worldModel: settings.worldModel,
		});
		run = {
			format: TURN_MODE_RUN_FORMAT,
			mode: options.mode,
			repetition: options.repetition,
			story: options.story,
			branchFloor: options.branch.floor,
			branchNodeId: options.branch.nodeId,
			rounds: options.rounds,
			messagesHash: options.messagesHash,
			seed: options.seed,
			writerModel: options.writer.model,
			judgeModel: options.judge.model,
			status: "running",
			error: null,
			startedAt: existing?.startedAt ?? new Date(now()).toISOString(),
			finishedAt: null,
			records: [...records],
		};
		await saveRun(options.dir, run);
		const writer = countStreamingClient(options.writer.client);
		let probes = run.records.filter((record) => record.probe !== null).length;
		for (
			let round = run.records.length + 1;
			round <= options.rounds;
			round += 1
		) {
			const userText = options.messages[round - 1] as string;
			const headBefore = store.getHead(options.story);
			const writerStart = writer.stats.requests;
			const cachedStart = writer.stats.cachedRequests;
			let record: TurnModeRoundRecord;
			try {
				const result = await runChatTurn({
					store,
					client: writer.client,
					storyId: options.story,
					userText,
					template: options.template,
					providers: slots.providers,
					budgetTokens: options.budgetTokens,
					structuredOutput: options.structuredOutput,
					turnMode: options.mode === "deep" ? "deep" : "fast",
					toolTransport: options.toolTransport,
					embedder: options.embedder,
					viewpoint: settings.viewpoint,
					model: options.writer.model,
					maxTokens: options.maxTokens ?? settings.maxTokens,
					temperature: options.temperature ?? settings.temperature,
					reasoning: options.reasoning ?? settings.reasoning,
					now: options.now,
				});
				// 探针请求不是这一楼的写作开销，先记账再出题。
				const requests = writer.stats.requests - writerStart;
				const cachedRequests = writer.stats.cachedRequests - cachedStart;
				const probe = await maybeProbe({
					store,
					story: options.story,
					round,
					rounds: options.rounds,
					headNodeId: result.node.id,
					attempts: probes,
					template: options.template,
					providers: slots.providers,
					budgetTokens: options.budgetTokens,
					assistant: options.writer,
					judge: options.judge,
					seed: options.seed + options.branch.floor + round,
				});
				if (probe !== null) probes += 1;
				record = {
					round,
					userText,
					reply: result.node.raw,
					firstTokenMs: result.trace.timing.firstTokenMs,
					durationMs: result.trace.timing.durationMs,
					requests,
					cachedRequests,
					probe,
					error: null,
					userNodeId: result.userNode.id,
					assistantNodeId: result.node.id,
				};
			} catch (error) {
				if (
					headBefore !== null &&
					store.getHead(options.story)?.id !== headBefore.id
				) {
					store.setHead(options.story, headBefore.id);
				}
				record = {
					round,
					userText,
					reply: null,
					firstTokenMs: null,
					durationMs: null,
					requests: writer.stats.requests - writerStart,
					cachedRequests: writer.stats.cachedRequests - cachedStart,
					probe: null,
					error: error instanceof Error ? error.message : String(error),
					userNodeId: store.getHead(options.story)?.id ?? null,
					assistantNodeId: null,
				};
			}
			run.records = [...run.records, record];
			if (record.error !== null) {
				run.status = "failed";
				run.error = `第 ${round} 轮失败：${record.error}`;
				run.finishedAt = new Date(now()).toISOString();
				await saveRun(options.dir, run);
				return run;
			}
			await saveRun(options.dir, run);
			log(
				`${CANDIDATE_LABELS[options.mode]} 第 ${options.branch.floor} 楼第 ${options.repetition} 次第 ${round} 轮：请求 ${record.requests}，首字 ${record.firstTokenMs ?? "—"} 毫秒，用时 ${record.durationMs ?? "—"} 毫秒`,
			);
		}
		run.status = "done";
		run.finishedAt = new Date(now()).toISOString();
		await saveRun(options.dir, run);
		return run;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const failed: TurnModeRunRecord = {
			format: TURN_MODE_RUN_FORMAT,
			mode: options.mode,
			repetition: options.repetition,
			story: options.story,
			branchFloor: options.branch.floor,
			branchNodeId: options.branch.nodeId,
			rounds: options.rounds,
			messagesHash: options.messagesHash,
			seed: options.seed,
			writerModel: options.writer.model,
			judgeModel: options.judge.model,
			status: "failed",
			error: message,
			startedAt: run?.startedAt ?? new Date(now()).toISOString(),
			finishedAt: new Date(now()).toISOString(),
			records: run?.records ?? existing?.records ?? [],
		};
		await saveRun(options.dir, failed);
		return failed;
	} finally {
		store.close();
	}
}

async function maybeProbe(input: {
	readonly store: StoryStore;
	readonly story: string;
	readonly round: number;
	readonly rounds: number;
	readonly headNodeId: string;
	readonly attempts: number;
	readonly template: ContextTemplate;
	readonly providers: ContextSlotProviders;
	readonly budgetTokens: number;
	readonly assistant: {
		readonly client: LlmStreamingClient;
		readonly model: string;
	};
	readonly judge: { readonly client: LlmClient; readonly model: string };
	readonly seed: number;
}): Promise<PlaytestProbeRecord | null> {
	const scheduled =
		input.round % R6_PROBE_INTERVAL_ROUNDS === 0 ||
		input.round === input.rounds;
	if (!scheduled || input.attempts >= R6_PROBE_MAX_PER_RUN) return null;
	return runPlaytestProbe({
		store: input.store,
		storyId: input.story,
		round: input.round,
		headNodeId: input.headNodeId,
		minAgeFloors: R6_PROBE_MIN_FACT_AGE,
		random: createSeededRandom(input.seed),
		template: input.template,
		providers: input.providers,
		budgetTokens: input.budgetTokens,
		assistant: {
			client: input.assistant.client,
			model: input.assistant.model,
		},
		judge: input.judge,
		maxTokens: 512,
		temperature: 0,
	});
}

async function judgePairs(input: {
	readonly runs: readonly TurnModeRunRecord[];
	readonly messages: readonly string[];
	readonly judge: { readonly client: LlmClient; readonly model: string };
	readonly log: (message: string) => void;
}): Promise<Map<TurnModeCandidate, PreferenceComparisonSummary>> {
	const result = new Map<TurnModeCandidate, PreferenceComparisonSummary>();
	const baseline = new Map<string, TurnModeRunRecord>();
	for (const run of input.runs) {
		if (run.mode === "fast") {
			baseline.set(`${run.branchFloor}:${run.repetition}`, run);
		}
	}
	for (const mode of TURN_MODE_CANDIDATES) {
		if (mode === "fast") {
			result.set(mode, summarizePreferenceComparisons([]));
			continue;
		}
		const records: PreferenceComparisonRecord[] = [];
		for (const run of input.runs) {
			if (run.mode !== mode || run.status !== "done") continue;
			const base = baseline.get(`${run.branchFloor}:${run.repetition}`);
			if (base === undefined || base.status !== "done") continue;
			for (const round of run.records) {
				if (round.reply === null) continue;
				const baseRound = base.records.find(
					(entry) => entry.round === round.round,
				);
				if (baseRound === undefined || baseRound.reply === null) continue;
				const context = input.messages
					.slice(0, round.round - 1)
					.map((message) => `玩家：${message}`)
					.join("\n\n");
				const sample: PreferenceSample = {
					sampleId: `${mode}:${run.branchFloor}:${run.repetition}:${round.round}`,
					storyId: run.story,
					kind: "historical",
					sourceEventId: `${mode}:${run.branchFloor}:${run.repetition}:${round.round}`,
					earlierSwipe: false,
					context,
					acceptedText: round.reply,
					abandonedText: baseRound.reply,
				};
				records.push(...(await runPreferenceSample(sample, input.judge)));
			}
		}
		const summary = summarizePreferenceComparisons(records);
		result.set(mode, summary);
		input.log(
			`${CANDIDATE_LABELS[mode]}：盲测 ${summary.records} 条记录，失败 ${summary.failures.length}`,
		);
	}
	return result;
}

function summarizeCandidate(input: {
	readonly mode: TurnModeCandidate;
	readonly repetitions: number;
	readonly runs: readonly TurnModeRunRecord[];
	readonly pairwise: PreferenceComparisonSummary;
}): TurnModeCandidateReport {
	const completed = input.runs.filter((run) => run.status === "done");
	const failedRuns = input.runs
		.filter((run) => run.status === "failed")
		.map((run) => ({
			branchFloor: run.branchFloor,
			repetition: run.repetition,
			error: run.error ?? "未知错误",
		}));
	const rounds = completed.flatMap((run) => run.records);
	const probes = rounds
		.map((record) => record.probe)
		.filter((probe): probe is PlaytestProbeRecord => probe !== null);
	const consistent = probes.filter(
		(probe) => probe.verdict === "consistent",
	).length;
	const contradicted = probes.filter(
		(probe) => probe.verdict === "contradicted",
	).length;
	const decidable = consistent + contradicted;
	const requests = completed.reduce(
		(total, run) =>
			total + run.records.reduce((sum, record) => sum + record.requests, 0),
		0,
	);
	const cachedRequests = completed.reduce(
		(total, run) =>
			total +
			run.records.reduce((sum, record) => sum + record.cachedRequests, 0),
		0,
	);
	const overall = input.pairwise.groups[0];
	const decisive =
		overall === undefined ? 0 : overall.acceptedWins + overall.abandonedWins;
	return {
		mode: input.mode,
		label: CANDIDATE_LABELS[input.mode],
		repetitions: input.repetitions,
		completedRuns: completed.length,
		failedRuns,
		floors: rounds.length,
		requests,
		cachedRequests,
		requestsPerFloor: rounds.length === 0 ? null : requests / rounds.length,
		probes: {
			attempts: probes.length,
			done: probes.filter((probe) => probe.status === "done").length,
			skipped: probes.filter((probe) => probe.status === "skipped").length,
			failed: probes.filter((probe) => probe.status === "failed").length,
			consistent,
			contradicted,
			unknown: probes.filter((probe) => probe.verdict === "unknown").length,
		},
		contradictionRate: decidable === 0 ? null : contradicted / decidable,
		winRate:
			input.mode === "fast" || decisive === 0
				? null
				: (overall?.acceptedWins ?? 0) / decisive,
		cost: {
			firstTokenMs: summarizePercentiles(
				rounds
					.map((record) => record.firstTokenMs)
					.filter((value): value is number => value !== null),
			),
			durationMs: summarizePercentiles(
				rounds
					.map((record) => record.durationMs)
					.filter((value): value is number => value !== null),
			),
		},
		pairwise: input.pairwise,
	};
}

export function formatTurnModeCompareReport(
	report: TurnModeCompareReport,
): string {
	const lines = [
		"# 写法对照",
		"",
		`- 故事：${report.story}；轮数：${report.rounds}；重复：${report.repetitions}；玩家消息：${report.messageCount} 条；分支点：${report.branchPoints.map((point) => point.floor).join("、")}；种子：${report.seed}`,
		`- 门槛版本：${report.gateVersion}；裁判有效性：${report.validity.status}（${report.validity.reason}）`,
		"- 胜率是对快速写法的非平局盲测胜率，两种展示顺序各判一次；矛盾率的分母只含一致与矛盾两类，跳过、无法判断与失败不进分母。",
		"",
		"| 写法 | 完成/失败 | 楼层 | 胜率 | 矛盾率（可判定） | 每楼调用 | 首字 P50/P90 | 用时 P50/P90 |",
		"|---|---|---|---|---|---|---|---|",
	];
	for (const candidate of report.candidates) {
		lines.push(
			`| ${candidate.label} | ${candidate.completedRuns}/${candidate.failedRuns.length} | ${candidate.floors} | ${formatRate(candidate.winRate)} | ${formatRate(candidate.contradictionRate)}（${candidate.probes.consistent + candidate.probes.contradicted}） | ${formatNumber(candidate.requestsPerFloor)} | ${formatPercentile(candidate.cost.firstTokenMs)} | ${formatPercentile(candidate.cost.durationMs)} |`,
		);
	}
	lines.push("", "## 样本", "");
	for (const candidate of report.candidates) {
		lines.push(
			`- ${candidate.label}：请求 ${candidate.requests}（缓存 ${candidate.cachedRequests}）；探针 ${candidate.probes.attempts}（一致 ${candidate.probes.consistent}、矛盾 ${candidate.probes.contradicted}、无法判断 ${candidate.probes.unknown}、跳过 ${candidate.probes.skipped}、失败 ${candidate.probes.failed}）；盲测判定 ${candidate.pairwise.records} 条，失败 ${candidate.pairwise.failures.length}`,
		);
	}
	for (const candidate of report.candidates) {
		for (const failure of candidate.failedRuns) {
			lines.push(
				`- ${candidate.label} 第 ${failure.branchFloor} 楼第 ${failure.repetition} 次失败：${failure.error}`,
			);
		}
	}
	lines.push("");
	return lines.join("\n");
}

function runFile(options: CandidateRunOptions): string {
	return path.join(
		options.dir,
		"runs",
		options.mode,
		`${options.branch.floor}-${options.repetition}.json`,
	);
}

async function saveRun(dir: string, run: TurnModeRunRecord): Promise<void> {
	await mkdir(dir, { recursive: true });
	const file = path.join(
		dir,
		"runs",
		run.mode,
		`${run.branchFloor}-${run.repetition}.json`,
	);
	await writeFile(file, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

async function loadRun(
	file: string,
	options: CandidateRunOptions,
): Promise<TurnModeRunRecord | null> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch {
		return null;
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new Error(`${file} 不是合法的 JSON`);
	}
	const run = value as TurnModeRunRecord;
	if (run.format !== TURN_MODE_RUN_FORMAT) {
		throw new Error(`${file} 的 format 不是 ${TURN_MODE_RUN_FORMAT}`);
	}
	const mismatches: string[] = [];
	if (run.mode !== options.mode) mismatches.push("写法");
	if (run.story !== options.story) mismatches.push("故事");
	if (run.branchFloor !== options.branch.floor) mismatches.push("分支点");
	if (run.branchNodeId !== options.branch.nodeId) mismatches.push("分支点 id");
	if (run.rounds !== options.rounds) mismatches.push("轮数");
	if (run.messagesHash !== options.messagesHash) mismatches.push("玩家消息");
	if (run.writerModel !== options.writer.model) mismatches.push("写作模型");
	if (run.judgeModel !== options.judge.model) mismatches.push("裁判模型");
	if (run.seed !== options.seed) mismatches.push("种子");
	if (mismatches.length > 0) {
		throw new Error(
			`${file} 与本次运行不一致（${mismatches.join("、")}），删除该文件后重跑`,
		);
	}
	return run;
}

function hashMessages(messages: readonly string[]): string {
	return createHash("sha256")
		.update(JSON.stringify(messages))
		.digest("hex")
		.slice(0, 16);
}

function createSeededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

function formatRate(value: number | null): string {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
	return value === null ? "—" : value.toFixed(2);
}

function formatPercentile(summary: PercentileSummary | null): string {
	if (summary === null) return "—";
	return `${Math.round(summary.p50)}/${Math.round(summary.p90)}`;
}
