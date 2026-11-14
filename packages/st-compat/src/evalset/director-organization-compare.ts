import { createHash } from "node:crypto";
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
	type ContextSlotProviders,
	type ContextTemplate,
	DEFAULT_DIRECTOR_CONFIG,
	DIRECTOR_BITS_JOB_KIND,
	DIRECTOR_ORGANIZATION_KINDS,
	type DirectorBit,
	type DirectorDecision,
	type DirectorOrganizationKind,
	type JsonObject,
	type LlmCallOptions,
	type LlmClient,
	type LlmReasoningLevel,
	type LlmRequest,
	type LlmResult,
	type LlmStream,
	type LlmStreamingClient,
	type LlmToolTransport,
	type PlotNote,
	type StoryStore,
	StoryStore as StoryStoreClass,
	type StructuredOutputMode,
	type TurnMode,
	createDirectorBitJudgmentsHandler,
	createDirectorEngine,
	createStandardChatSlots,
	isJsonObject,
	normalizeEntityName,
	runChatTurn,
} from "@dramaticer/core";
import {
	type DirectorConditionSample,
	flattenConditionState,
} from "./condition-samples.js";
import { type PercentileSummary, summarizePercentiles } from "./deep-eval.js";
import { noteMatchesReply } from "./director-eval.js";
import {
	type SimilaritySummary,
	measureBlockRepetition,
	novelRatio,
	rememberGrams,
	summarize as summarizeSimilarity,
} from "./metrics.js";
import {
	type PreferenceComparisonRecord,
	type PreferenceComparisonSummary,
	type PreferenceSample,
	runPreferenceSample,
	summarizePreferenceComparisons,
} from "./pairwise.js";

export const DIRECTOR_COMPARE_FORMAT =
	"dramaticer.director-organization-compare";
export const DEFAULT_REPETITIONS = 3;

export interface DirectorOrganizationCompareOptions {
	/** 已导入故事与卡的数据库；每个候选与重复各复制一份。 */
	readonly sourceDbPath: string;
	readonly story: string;
	readonly rounds: number;
	/** 每个候选与重复都使用同一串玩家消息。 */
	readonly messages: readonly string[];
	readonly repetitions?: number;
	readonly dir: string;
	readonly writer: {
		readonly client: LlmStreamingClient;
		readonly model: string;
	};
	readonly judge: { readonly client: LlmClient; readonly model: string };
	/** 间隙里的条件判断客户端；bits 候选每轮一次批量判断。 */
	readonly background: { readonly client: LlmClient; readonly model: string };
	readonly template: ContextTemplate;
	readonly budgetTokens: number;
	readonly structuredOutput: StructuredOutputMode;
	/** 两个候选都固定使用快回合。 */
	readonly turnMode?: TurnMode;
	readonly toolTransport?: LlmToolTransport | null;
	/** 两个候选共用的小品；不设置时使用源数据库里已有的小品。 */
	readonly bits?: readonly DirectorBit[] | null;
	readonly conditionSamples?: readonly DirectorConditionSample[];
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly reasoning?: LlmReasoningLevel;
	readonly seed?: number;
	readonly log?: (message: string) => void;
	readonly now?: () => number;
}

export interface DirectorCompareRoundRecord {
	readonly round: number;
	readonly userText: string;
	readonly reply: string | null;
	readonly firstTokenMs: number | null;
	readonly durationMs: number | null;
	readonly requests: number;
	readonly cachedRequests: number;
	/** 本条回复里未在前文出现的字符 4-gram 占比；第 1 轮没有基准，记为 null。 */
	readonly progress: number | null;
	readonly notesCreated: number;
	readonly director: {
		readonly directive: string | null;
		readonly mechanism: string | null;
	} | null;
	readonly judgment: {
		readonly conditions: number;
		readonly error: string | null;
	} | null;
	readonly error: string | null;
}

export interface DirectorRunRecord {
	readonly format: string;
	readonly kind: DirectorOrganizationKind;
	readonly repetition: number;
	readonly story: string;
	readonly rounds: number;
	readonly messagesHash: string;
	readonly bitsHash: string;
	readonly seed: number;
	readonly status: "done" | "failed";
	readonly error: string | null;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly records: readonly DirectorCompareRoundRecord[];
	readonly repetitionStats: SimilaritySummary;
	readonly repetitionValues: readonly number[];
	readonly notesCreated: number;
	readonly notesFulfilled: number;
	readonly fulfillAges: readonly number[];
	readonly meanFulfillAge: number | null;
	readonly backgroundRequests: number;
	readonly backgroundErrors: number;
	readonly cost: DirectorRunCost;
}

export interface DirectorRunCost {
	readonly requests: number;
	readonly cachedRequests: number;
	readonly firstTokenMs: PercentileSummary | null;
	readonly durationMs: PercentileSummary | null;
}

export interface DirectorCandidateSamples {
	readonly rounds: number;
	readonly requests: number;
	readonly cachedRequests: number;
	readonly backgroundRequests: number;
	readonly backgroundErrors: number;
	readonly repetitionPairs: number;
	readonly progressSamples: number;
	readonly notesCreated: number;
	readonly notesFulfilled: number;
	readonly blindSamples: number;
	readonly blindJudgements: number;
	readonly blindWins: number;
	readonly blindLosses: number;
	readonly blindTies: number;
}

export interface DirectorCandidateReport {
	readonly kind: DirectorOrganizationKind;
	readonly repetitions: number;
	readonly completedRuns: number;
	readonly failedRuns: readonly {
		readonly repetition: number;
		readonly error: string;
	}[];
	readonly samples: DirectorCandidateSamples;
	readonly repetition: SimilaritySummary;
	/** 推进度：每条回复的新字符 4-gram 占比均值；没有样本时为 null。 */
	readonly progress: number | null;
	/** 线索兑现率 = 运行内兑现的笔记数 / 运行内新建的笔记数。 */
	readonly clueFulfillmentRate: number | null;
	readonly meanFulfillAge: number | null;
	/** 候选胜出的非平局判定占比；对照候选或全部平局时为 null。 */
	readonly blindWinRate: number | null;
	readonly cost: {
		readonly writerRequestsPerRound: number | null;
		readonly backgroundRequestsPerRound: number | null;
		readonly totalRequestsPerRound: number | null;
		readonly firstTokenMs: PercentileSummary | null;
		readonly durationMs: PercentileSummary | null;
		readonly requests: number;
		readonly cachedRequests: number;
		readonly backgroundRequests: number;
	};
	readonly pairwise: PreferenceComparisonSummary;
}

export const DIRECTOR_CONDITION_STATUSES = [
	"correct",
	"incorrect",
	"missing",
	"failed",
] as const;

export type DirectorConditionStatus =
	(typeof DIRECTOR_CONDITION_STATUSES)[number];

export interface DirectorConditionCheck {
	readonly id: string;
	readonly kind: "text" | "ledger" | "fallback";
	readonly expected: boolean;
	readonly matched: boolean | null;
	readonly status: DirectorConditionStatus;
	readonly reason: string | null;
	readonly error: string | null;
	readonly judgmentRequests: number;
}

export interface DirectorConditionReport {
	readonly total: number;
	readonly correct: number;
	readonly incorrect: number;
	readonly missing: number;
	readonly failed: number;
	/** 正确数除以样本总数；没有样本时为 null。 */
	readonly accuracy: number | null;
	readonly checks: readonly DirectorConditionCheck[];
}

export interface DirectorOrganizationCompareReport {
	readonly format: string;
	readonly story: string;
	readonly rounds: number;
	readonly repetitions: number;
	readonly seed: number;
	readonly messageCount: number;
	readonly bitsHash: string;
	readonly generatedAt: string;
	readonly candidates: readonly DirectorCandidateReport[];
	readonly runs: readonly DirectorRunRecord[];
	readonly conditions: DirectorConditionReport;
}

interface RequestStats {
	requests: number;
	cachedRequests: number;
}

interface CountedStreamingClient {
	readonly client: LlmStreamingClient;
	readonly stats: RequestStats;
}

interface CountedClient {
	readonly client: LlmClient;
	readonly stats: RequestStats;
}

interface CandidateOptions extends DirectorOrganizationCompareOptions {
	readonly kind: DirectorOrganizationKind;
	readonly repetition: number;
	readonly messagesHash: string;
	readonly bitsHash: string;
	readonly bits: readonly DirectorBit[];
	readonly log: (message: string) => void;
	readonly now: () => number;
}

/**
 * 两个导演组织方式在同一份数据库副本、同一串玩家消息上各跑固定轮数，
 * 用重复度、推进度、线索兑现率、盲测胜率与每轮成本比较；条件判断用
 * 仓库内的固定样本逐条核对。每个候选与每次重复各写一份 sidecar。
 */
export async function runDirectorOrganizationCompare(
	options: DirectorOrganizationCompareOptions,
): Promise<DirectorOrganizationCompareReport> {
	const repetitions = options.repetitions ?? DEFAULT_REPETITIONS;
	const seed = options.seed ?? 1;
	assertCompareOptions(options, repetitions, seed);
	const log = options.log ?? (() => undefined);
	const now = options.now ?? Date.now;
	const messagesHash = hashMessages(options.messages);
	const bits = await readSourceBits(options);
	const bitsHash = hashBits(bits);
	await mkdir(options.dir, { recursive: true });
	const conditionSamples = options.conditionSamples ?? [];
	const runs: DirectorRunRecord[] = [];
	for (const kind of DIRECTOR_ORGANIZATION_KINDS) {
		for (let repetition = 1; repetition <= repetitions; repetition += 1) {
			const loaded = await loadRun({
				dir: options.dir,
				kind,
				repetition,
				story: options.story,
				rounds: options.rounds,
				messagesHash,
				bitsHash,
				seed,
			});
			if (loaded !== null) {
				log(`${kind} 第 ${repetition} 次：复用已完成的样本`);
				runs.push(loaded);
				continue;
			}
			try {
				const run = await runCandidate({
					...options,
					kind,
					repetition,
					messagesHash,
					bitsHash,
					bits,
					log,
					now,
				});
				await saveRun(options.dir, run);
				runs.push(run);
				log(
					`${kind} 第 ${repetition} 次：完成 ${run.records.length} 轮，写作请求 ${run.cost.requests}，判断请求 ${run.backgroundRequests}`,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				runs.push(
					failedRun({
						kind,
						repetition,
						story: options.story,
						rounds: options.rounds,
						messagesHash,
						bitsHash,
						seed,
						error: message,
						now,
					}),
				);
				log(`${kind} 第 ${repetition} 次失败：${message}`);
			}
		}
	}
	const pairwiseByKind = await judgePairs({
		runs,
		messages: options.messages,
		judge: options.judge,
		log,
	});
	const candidates = DIRECTOR_ORGANIZATION_KINDS.map((kind) =>
		summarizeCandidate({
			kind,
			repetitions,
			runs: runs.filter((run) => run.kind === kind),
			pairwise: pairwiseByKind.get(kind) ?? summarizePreferenceComparisons([]),
		}),
	);
	const conditions = await checkConditionSamples({
		dir: options.dir,
		samples: conditionSamples,
		background: options.background,
		now,
		log,
	});
	return {
		format: DIRECTOR_COMPARE_FORMAT,
		story: options.story,
		rounds: options.rounds,
		repetitions,
		seed,
		messageCount: options.messages.length,
		bitsHash,
		generatedAt: new Date(now()).toISOString(),
		candidates,
		runs,
		conditions,
	};
}

function assertCompareOptions(
	options: DirectorOrganizationCompareOptions,
	repetitions: number,
	seed: number,
): void {
	if (!Number.isInteger(options.rounds) || options.rounds < 1) {
		throw new Error(`对比运行的轮数必须是正整数，收到 ${options.rounds}`);
	}
	if (!Number.isInteger(repetitions) || repetitions < 1) {
		throw new Error(`每种候选的重复次数必须是正整数，收到 ${repetitions}`);
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

async function readSourceBits(
	options: DirectorOrganizationCompareOptions,
): Promise<readonly DirectorBit[]> {
	if (options.bits !== undefined && options.bits !== null) {
		return options.bits;
	}
	const store = StoryStoreClass.open(options.sourceDbPath);
	try {
		if (store.getStory(options.story) === null) {
			throw new Error(
				`数据库 ${options.sourceDbPath} 里没有故事 ${options.story}`,
			);
		}
		return store.listDirectorBits(options.story);
	} finally {
		store.close();
	}
}

async function runCandidate(
	options: CandidateOptions,
): Promise<DirectorRunRecord> {
	const startedAt = new Date(options.now()).toISOString();
	const runDir = path.join(options.dir, "runs", options.kind);
	const dbPath = path.join(runDir, `${options.repetition}.db`);
	await mkdir(runDir, { recursive: true });
	for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
		await rm(file, { force: true });
	}
	await copyFile(options.sourceDbPath, dbPath);
	const store = StoryStoreClass.open(dbPath);
	try {
		const story = store.getStory(options.story);
		if (story === null) {
			throw new Error(
				`数据库 ${options.sourceDbPath} 里没有故事 ${options.story}`,
			);
		}
		store.updateStorySettings(options.story, {
			directorOrganization: options.kind,
		});
		if (options.bits !== undefined) {
			store.replaceDirectorBits({
				storyId: options.story,
				bits: options.bits,
				source: "eval",
			});
		}
		const settings = store.getStorySettings(options.story);
		const slots = await createStandardChatSlots({
			store,
			characterPrompt: settings.characterPrompt,
			directorConfig: settings.directorConfig,
			directorOrganization: options.kind,
			historyBlockPolicy: settings.historyBlockPolicy,
			worldModel: settings.worldModel,
		});
		const records: DirectorCompareRoundRecord[] = [];
		const openNotes = new Map<string, PlotNote>();
		const fulfillAges: number[] = [];
		let notesCreated = 0;
		const seenGrams = new Set<string>();
		const countedWriter = countStreamingClient(options.writer.client);
		const countedBackground = countClient(options.background.client);
		let backgroundRequests = 0;
		let backgroundErrors = 0;
		const head = store.getHead(options.story);
		if (head !== null && options.kind === "bits") {
			const setup = await judgeBits({
				store,
				storyId: options.story,
				nodeId: head.id,
				client: countedBackground.client,
				model: options.background.model,
				now: options.now,
			});
			backgroundRequests += countedBackground.stats.requests;
			if (setup.error !== null) {
				backgroundErrors += 1;
				options.log(
					`${options.kind} 第 ${options.repetition} 次：起始楼层条件判断失败：${setup.error}`,
				);
			}
			countedBackground.stats.requests = 0;
		}
		for (let round = 1; round <= options.rounds; round += 1) {
			const userText = options.messages[round - 1];
			if (userText === undefined) {
				throw new Error(`缺少第 ${round} 条玩家消息`);
			}
			const headBefore = store.getHead(options.story);
			try {
				const result = await runChatTurn({
					store,
					client: countedWriter.client,
					storyId: options.story,
					userText,
					template: options.template,
					providers: slots.providers,
					budgetTokens: options.budgetTokens,
					structuredOutput: options.structuredOutput,
					turnMode: options.turnMode ?? "fast",
					toolTransport: options.toolTransport,
					model: options.writer.model,
					viewpoint: settings.viewpoint,
					maxTokens: options.maxTokens,
					temperature: options.temperature,
					reasoning: options.reasoning,
					now: options.now,
				});
				const decision = store.getDirectorDecision(result.userNode.id);
				const progress =
					round === 1 ? null : novelRatio(seenGrams, result.node.raw);
				rememberGrams(seenGrams, result.node.raw);
				fulfillNotes({
					store,
					nodeId: result.node.id,
					reply: result.node.raw,
					openNotes,
					fulfillAges,
					now: options.now,
				});
				for (const note of result.plotNotes) {
					notesCreated += 1;
					openNotes.set(note.id, note);
				}
				const judgment =
					options.kind === "bits"
						? await judgeBits({
								store,
								storyId: options.story,
								nodeId: result.node.id,
								client: countedBackground.client,
								model: options.background.model,
								now: options.now,
							})
						: null;
				if (judgment !== null) {
					backgroundRequests += countedBackground.stats.requests;
					countedBackground.stats.requests = 0;
					if (judgment.error !== null) {
						backgroundErrors += 1;
					}
				}
				records.push({
					round,
					userText,
					reply: result.node.raw,
					firstTokenMs: result.trace.timing.firstTokenMs,
					durationMs: result.trace.timing.durationMs,
					requests: countedWriter.stats.requests,
					cachedRequests: countedWriter.stats.cachedRequests,
					progress,
					notesCreated: result.plotNotes.length,
					director: summarizeDecision(decision),
					judgment,
					error: null,
				});
				countedWriter.stats.requests = 0;
				countedWriter.stats.cachedRequests = 0;
			} catch (error) {
				if (
					headBefore !== null &&
					store.getHead(options.story)?.id !== headBefore.id
				) {
					store.setHead(options.story, headBefore.id);
				}
				records.push({
					round,
					userText,
					reply: null,
					firstTokenMs: null,
					durationMs: null,
					requests: countedWriter.stats.requests,
					cachedRequests: countedWriter.stats.cachedRequests,
					progress: null,
					notesCreated: 0,
					director: null,
					judgment: null,
					error: error instanceof Error ? error.message : String(error),
				});
				throw new Error(
					`第 ${round} 轮失败：${error instanceof Error ? error.message : String(error)}`,
				);
			}
			options.log(
				`${options.kind} 第 ${options.repetition} 次第 ${round} 轮完成`,
			);
		}
		const repetition = measureBlockRepetition(
			records
				.map((record) => record.reply)
				.filter((reply): reply is string => reply !== null),
		);
		return {
			format: DIRECTOR_COMPARE_FORMAT,
			kind: options.kind,
			repetition: options.repetition,
			story: options.story,
			rounds: options.rounds,
			messagesHash: options.messagesHash,
			bitsHash: options.bitsHash,
			seed: options.seed ?? 1,
			status: "done",
			error: null,
			startedAt,
			finishedAt: new Date(options.now()).toISOString(),
			records,
			repetitionStats: repetition.summary,
			repetitionValues: repetition.values,
			notesCreated,
			notesFulfilled: fulfillAges.length,
			fulfillAges,
			meanFulfillAge:
				fulfillAges.length === 0
					? null
					: fulfillAges.reduce((total, value) => total + value, 0) /
						fulfillAges.length,
			backgroundRequests,
			backgroundErrors,
			cost: summarizeCost(records),
		};
	} finally {
		store.close();
	}
}

function failedRun(input: {
	readonly kind: DirectorOrganizationKind;
	readonly repetition: number;
	readonly story: string;
	readonly rounds: number;
	readonly messagesHash: string;
	readonly bitsHash: string;
	readonly seed: number;
	readonly error: string;
	readonly now: () => number;
}): DirectorRunRecord {
	return {
		format: DIRECTOR_COMPARE_FORMAT,
		kind: input.kind,
		repetition: input.repetition,
		story: input.story,
		rounds: input.rounds,
		messagesHash: input.messagesHash,
		bitsHash: input.bitsHash,
		seed: input.seed,
		status: "failed",
		error: input.error,
		startedAt: new Date(input.now()).toISOString(),
		finishedAt: new Date(input.now()).toISOString(),
		records: [],
		repetitionStats: summarizeSimilarity([]),
		repetitionValues: [],
		notesCreated: 0,
		notesFulfilled: 0,
		fulfillAges: [],
		meanFulfillAge: null,
		backgroundRequests: 0,
		backgroundErrors: 0,
		cost: summarizeCost([]),
	};
}

function summarizeDecision(
	decision: DirectorDecision | null,
): DirectorCompareRoundRecord["director"] {
	if (decision === null) return null;
	const triggered = decision.mechanisms.find((record) => record.triggered);
	return {
		directive: decision.directive,
		mechanism: triggered?.name ?? null,
	};
}

async function judgeBits(input: {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly nodeId: string;
	readonly client: LlmClient;
	readonly model: string;
	readonly now: () => number;
}): Promise<{ readonly conditions: number; readonly error: string | null }> {
	const conditions = input.store
		.listDirectorBits(input.storyId)
		.filter((bit) => bit.condition?.kind === "text").length;
	if (conditions === 0) return { conditions: 0, error: null };
	try {
		const handler = createDirectorBitJudgmentsHandler({
			client: input.client,
			model: input.model,
		});
		await handler({
			store: input.store,
			client: input.client,
			job: fakeJob(input.storyId, input.nodeId, input.now),
		});
		return { conditions, error: null };
	} catch (error) {
		return {
			conditions,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function fakeJob(
	storyId: string,
	nodeId: string,
	now: () => number,
): BackgroundJob {
	const at = new Date(now()).toISOString();
	return {
		id: 0,
		storyId,
		nodeId,
		kind: DIRECTOR_BITS_JOB_KIND,
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: at,
		startedAt: at,
		finishedAt: null,
	};
}

function fulfillNotes(input: {
	readonly store: StoryStore;
	readonly nodeId: string;
	readonly reply: string;
	readonly openNotes: Map<string, PlotNote>;
	readonly fulfillAges: number[];
	readonly now: () => number;
}): void {
	if (input.openNotes.size === 0) return;
	const reply = normalizeEntityName(input.reply);
	if (reply.length === 0) return;
	const positions = new Map(
		input.store
			.getPathToNode(input.nodeId)
			.map((node, index) => [node.id, index] as const),
	);
	const currentPosition = positions.size - 1;
	const fulfilled: string[] = [];
	for (const note of input.openNotes.values()) {
		const sourcePosition = positions.get(note.sourceNodeId);
		if (sourcePosition === undefined) continue;
		const age = currentPosition - sourcePosition;
		if (age < 1) continue;
		if (!noteMatchesReply(note.text, reply)) continue;
		input.store.fulfillPlotNote(note.id, new Date(input.now()).toISOString());
		input.fulfillAges.push(age);
		fulfilled.push(note.id);
	}
	for (const noteId of fulfilled) input.openNotes.delete(noteId);
}

async function judgePairs(input: {
	readonly runs: readonly DirectorRunRecord[];
	readonly messages: readonly string[];
	readonly judge: { readonly client: LlmClient; readonly model: string };
	readonly log: (message: string) => void;
}): Promise<Map<DirectorOrganizationKind, PreferenceComparisonSummary>> {
	const result = new Map<
		DirectorOrganizationKind,
		PreferenceComparisonSummary
	>();
	const baselineByRepetition = new Map<number, DirectorRunRecord>();
	for (const run of input.runs) {
		if (run.kind === "mechanisms" && run.status === "done") {
			baselineByRepetition.set(run.repetition, run);
		}
	}
	for (const kind of DIRECTOR_ORGANIZATION_KINDS) {
		if (kind === "mechanisms") {
			result.set(kind, summarizePreferenceComparisons([]));
			continue;
		}
		const records: PreferenceComparisonRecord[] = [];
		for (const run of input.runs) {
			if (run.kind !== kind || run.status !== "done") continue;
			const baseline = baselineByRepetition.get(run.repetition);
			if (baseline === undefined) continue;
			for (const round of run.records) {
				if (round.reply === null) continue;
				const baseRound = baseline.records.find(
					(entry) => entry.round === round.round,
				);
				if (baseRound === undefined || baseRound.reply === null) continue;
				const context = input.messages
					.slice(0, round.round - 1)
					.map((message) => `玩家：${message}`)
					.join("\n\n");
				const sample: PreferenceSample = {
					sampleId: `${kind}:${run.repetition}:${round.round}`,
					storyId: run.story,
					kind: "historical",
					sourceEventId: `${kind}:${run.repetition}:${round.round}`,
					earlierSwipe: false,
					context,
					acceptedText: round.reply,
					abandonedText: baseRound.reply,
				};
				records.push(...(await runPreferenceSample(sample, input.judge)));
			}
		}
		const summary = summarizePreferenceComparisons(records);
		result.set(kind, summary);
		input.log(
			`${kind}：盲测样本 ${summary.records} 条记录，失败 ${summary.failures.length}`,
		);
	}
	return result;
}

function summarizeCandidate(input: {
	readonly kind: DirectorOrganizationKind;
	readonly repetitions: number;
	readonly runs: readonly DirectorRunRecord[];
	readonly pairwise: PreferenceComparisonSummary;
}): DirectorCandidateReport {
	const completed = input.runs.filter((run) => run.status === "done");
	const failedRuns = input.runs
		.filter((run) => run.status === "failed")
		.map((run) => ({
			repetition: run.repetition,
			error: run.error ?? "未知错误",
		}));
	const repetitionValues = completed.flatMap((run) => run.repetitionValues);
	const progressValues = completed.flatMap((run) =>
		run.records
			.map((record) => record.progress)
			.filter((value): value is number => value !== null),
	);
	const notesCreated = completed.reduce(
		(total, run) => total + run.notesCreated,
		0,
	);
	const notesFulfilled = completed.reduce(
		(total, run) => total + run.notesFulfilled,
		0,
	);
	const fulfillAges = completed.flatMap((run) => run.fulfillAges);
	const requests = completed.reduce(
		(total, run) => total + run.cost.requests,
		0,
	);
	const cachedRequests = completed.reduce(
		(total, run) => total + run.cost.cachedRequests,
		0,
	);
	const backgroundRequests = completed.reduce(
		(total, run) => total + run.backgroundRequests,
		0,
	);
	const backgroundErrors = completed.reduce(
		(total, run) => total + run.backgroundErrors,
		0,
	);
	const roundCount = completed.reduce(
		(total, run) => total + run.records.length,
		0,
	);
	const allRounds = completed.flatMap((run) => run.records);
	const overall = input.pairwise.groups[0];
	const decisive =
		overall === undefined ? 0 : overall.acceptedWins + overall.abandonedWins;
	const blindWinRate =
		overall === undefined || decisive === 0
			? null
			: overall.acceptedWins / decisive;
	return {
		kind: input.kind,
		repetitions: input.repetitions,
		completedRuns: completed.length,
		failedRuns,
		samples: {
			rounds: roundCount,
			requests,
			cachedRequests,
			backgroundRequests,
			backgroundErrors,
			repetitionPairs: repetitionValues.length,
			progressSamples: progressValues.length,
			notesCreated,
			notesFulfilled,
			blindSamples: overall?.samples ?? 0,
			blindJudgements: overall?.judgements ?? 0,
			blindWins: overall?.acceptedWins ?? 0,
			blindLosses: overall?.abandonedWins ?? 0,
			blindTies: overall?.ties ?? 0,
		},
		repetition: summarizeSimilarity(repetitionValues),
		progress:
			progressValues.length === 0
				? null
				: progressValues.reduce((total, value) => total + value, 0) /
					progressValues.length,
		clueFulfillmentRate:
			notesCreated === 0 ? null : notesFulfilled / notesCreated,
		meanFulfillAge:
			fulfillAges.length === 0
				? null
				: fulfillAges.reduce((total, value) => total + value, 0) /
					fulfillAges.length,
		blindWinRate,
		cost: {
			writerRequestsPerRound: roundCount === 0 ? null : requests / roundCount,
			backgroundRequestsPerRound:
				roundCount === 0 ? null : backgroundRequests / roundCount,
			totalRequestsPerRound:
				roundCount === 0 ? null : (requests + backgroundRequests) / roundCount,
			firstTokenMs: summarizePercentiles(
				allRounds
					.map((record) => record.firstTokenMs)
					.filter((value): value is number => value !== null),
			),
			durationMs: summarizePercentiles(
				allRounds
					.map((record) => record.durationMs)
					.filter((value): value is number => value !== null),
			),
			requests,
			cachedRequests,
			backgroundRequests,
		},
		pairwise: input.pairwise,
	};
}

async function checkConditionSamples(input: {
	readonly dir: string;
	readonly samples: readonly DirectorConditionSample[];
	readonly background: { readonly client: LlmClient; readonly model: string };
	readonly now: () => number;
	readonly log: (message: string) => void;
}): Promise<DirectorConditionReport> {
	const checks: DirectorConditionCheck[] = [];
	const root = path.join(input.dir, "conditions");
	if (input.samples.length > 0) await mkdir(root, { recursive: true });
	for (const [index, sample] of input.samples.entries()) {
		const dbPath = path.join(root, `sample-${index + 1}.db`);
		for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
			await rm(file, { force: true });
		}
		const storyId = `condition-${index + 1}`;
		const kind: DirectorConditionCheck["kind"] =
			sample.bit.condition === null ? "fallback" : sample.bit.condition.kind;
		const store = StoryStoreClass.open(dbPath);
		const counted = countClient(input.background.client);
		let judgmentError: string | null = null;
		try {
			store.createStory({ id: storyId, title: `条件样本 ${sample.id}` });
			let parentId: string | null = null;
			let lastNodeId: string | null = null;
			for (const floor of sample.floors) {
				const node = store.appendNode({
					storyId,
					parentId,
					role: floor.role,
					raw: floor.raw,
				});
				parentId = node.id;
				lastNodeId = node.id;
			}
			if (lastNodeId === null) {
				throw new Error(`条件样本 ${sample.id} 没有楼层`);
			}
			const targetNodeId = lastNodeId;
			const flattened: { path: string[]; value: unknown }[] = [];
			flattenConditionState(sample.state, [], flattened);
			if (flattened.length > 0) {
				store.appendStateDiffs(
					flattened.map((entry) => ({
						storyId,
						nodeId: targetNodeId,
						path: entry.path,
						op: "set" as const,
						value: entry.value,
						source: "import",
					})),
				);
			}
			store.setHead(storyId, targetNodeId);
			store.replaceDirectorBits({
				storyId,
				bits: [sample.bit],
				source: "eval",
			});
			if (sample.bit.condition?.kind === "text") {
				try {
					const handler = createDirectorBitJudgmentsHandler({
						client: counted.client,
						model: input.background.model,
					});
					await handler({
						store,
						client: counted.client,
						job: fakeJob(storyId, targetNodeId, input.now),
					});
				} catch (error) {
					judgmentError =
						error instanceof Error ? error.message : String(error);
				}
			}
			createDirectorEngine("bits").evaluate({
				store,
				storyId,
				nodeId: targetNodeId,
				config: DEFAULT_DIRECTOR_CONFIG,
			});
			const decision = store.getDirectorDecision(targetNodeId);
			const detail = readConditionDetail(decision, sample.id);
			const matched = detail?.matched ?? null;
			const status: DirectorConditionStatus =
				judgmentError !== null
					? "failed"
					: matched === null
						? "missing"
						: matched === sample.expected
							? "correct"
							: "incorrect";
			checks.push({
				id: sample.id,
				kind,
				expected: sample.expected,
				matched,
				status,
				reason: detail?.reason ?? null,
				error: judgmentError,
				judgmentRequests: counted.stats.requests,
			});
			if (status !== "correct") {
				input.log(
					`条件样本 ${sample.id} ${status}：期望 ${sample.expected}，引擎 ${matched === null ? "缺失" : matched}`,
				);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			checks.push({
				id: sample.id,
				kind,
				expected: sample.expected,
				matched: null,
				status: "failed",
				reason: null,
				error: message,
				judgmentRequests: counted.stats.requests,
			});
			input.log(`条件样本 ${sample.id} 失败：${message}`);
		} finally {
			store.close();
		}
	}
	const correct = checks.filter((check) => check.status === "correct").length;
	const incorrect = checks.filter(
		(check) => check.status === "incorrect",
	).length;
	const missing = checks.filter((check) => check.status === "missing").length;
	const failed = checks.filter((check) => check.status === "failed").length;
	return {
		total: checks.length,
		correct,
		incorrect,
		missing,
		failed,
		accuracy: checks.length === 0 ? null : correct / checks.length,
		checks,
	};
}

function readConditionDetail(
	decision: DirectorDecision | null,
	bitId: string,
): { readonly matched: boolean | null; readonly reason: string | null } | null {
	if (decision === null) return null;
	const evaluated = decision.signals.evaluated;
	if (!Array.isArray(evaluated)) return null;
	for (const item of evaluated) {
		if (!isJsonObject(item) || item.id !== bitId) continue;
		return {
			matched: typeof item.matched === "boolean" ? item.matched : null,
			reason: typeof item.reason === "string" ? item.reason : null,
		};
	}
	return null;
}

function summarizeCost(
	records: readonly DirectorCompareRoundRecord[],
): DirectorRunCost {
	let requests = 0;
	let cachedRequests = 0;
	const firstToken: number[] = [];
	const duration: number[] = [];
	for (const record of records) {
		requests += record.requests;
		cachedRequests += record.cachedRequests;
		if (record.firstTokenMs !== null) firstToken.push(record.firstTokenMs);
		if (record.durationMs !== null) duration.push(record.durationMs);
	}
	return {
		requests,
		cachedRequests,
		firstTokenMs: summarizePercentiles(firstToken),
		durationMs: summarizePercentiles(duration),
	};
}

function countStreamingClient(
	inner: LlmStreamingClient,
): CountedStreamingClient {
	const stats: RequestStats = { requests: 0, cachedRequests: 0 };
	const client: LlmStreamingClient = {
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
	};
	return { client, stats };
}

function countClient(inner: LlmClient): CountedClient {
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

async function saveRun(dir: string, run: DirectorRunRecord): Promise<void> {
	const file = runFile(dir, run.kind, run.repetition);
	await mkdir(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp`;
	await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, "utf8");
	await rename(temporary, file);
}

async function loadRun(input: {
	readonly dir: string;
	readonly kind: DirectorOrganizationKind;
	readonly repetition: number;
	readonly story: string;
	readonly rounds: number;
	readonly messagesHash: string;
	readonly bitsHash: string;
	readonly seed: number;
}): Promise<DirectorRunRecord | null> {
	const file = runFile(input.dir, input.kind, input.repetition);
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const value: unknown = JSON.parse(raw);
	if (!isDirectorRunRecord(value)) {
		throw new Error(`${file} 不是有效的结果文件`);
	}
	const mismatches: string[] = [];
	if (value.format !== DIRECTOR_COMPARE_FORMAT) mismatches.push("格式");
	if (value.story !== input.story) mismatches.push("故事");
	if (value.kind !== input.kind) mismatches.push("候选");
	if (value.repetition !== input.repetition) mismatches.push("重复序号");
	if (value.rounds !== input.rounds) mismatches.push("轮数");
	if (value.messagesHash !== input.messagesHash) mismatches.push("玩家消息");
	if (value.bitsHash !== input.bitsHash) mismatches.push("剧情小品");
	if (value.seed !== input.seed) mismatches.push("随机种子");
	if (mismatches.length > 0) {
		throw new Error(
			`${file} 与本次运行不一致：${mismatches.join("、")}；删除该文件后重跑`,
		);
	}
	return value;
}

function isDirectorRunRecord(value: unknown): value is DirectorRunRecord {
	return (
		isJsonObject(value) &&
		value.format === DIRECTOR_COMPARE_FORMAT &&
		typeof value.story === "string" &&
		typeof value.kind === "string" &&
		(DIRECTOR_ORGANIZATION_KINDS as readonly string[]).includes(value.kind) &&
		typeof value.repetition === "number" &&
		typeof value.rounds === "number" &&
		typeof value.messagesHash === "string" &&
		typeof value.bitsHash === "string" &&
		typeof value.seed === "number" &&
		(value.status === "done" || value.status === "failed") &&
		Array.isArray(value.records) &&
		Array.isArray(value.repetitionValues)
	);
}

function runFile(
	dir: string,
	kind: DirectorOrganizationKind,
	repetition: number,
): string {
	return path.join(dir, "runs", kind, `${repetition}.json`);
}

function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function hashMessages(messages: readonly string[]): string {
	return createHash("sha256").update(JSON.stringify(messages)).digest("hex");
}

function hashBits(bits: readonly DirectorBit[]): string {
	return hashText(JSON.stringify(bits));
}

export function formatDirectorOrganizationCompareReport(
	report: DirectorOrganizationCompareReport,
): string {
	const lines: string[] = [];
	lines.push("# 导演组织方式对比");
	lines.push("");
	lines.push(
		`- 故事：${report.story}；轮数：${report.rounds}；重复：${report.repetitions}；玩家消息：${report.messageCount} 条；种子：${report.seed}`,
	);
	lines.push(
		"- 口径：重复度 = 相邻回复的字符 4-gram Jaccard 均值；推进度 = 每条回复里未在前文出现的字符 4-gram 占比的均值（从第 2 轮起）；线索兑现率 = 运行内兑现的剧情笔记数 / 运行内新建的剧情笔记数；每轮成本分写作请求与条件判断请求。",
	);
	lines.push(
		"- 隔离：每个候选与每次重复复制同一份源数据库，使用同一串玩家消息、同一批剧情小品与同一个种子；固定快回合；条件判断只由间隙里的后台调用产生。",
	);
	lines.push("");
	lines.push(
		"|候选|完成/失败|轮数|重复度|推进度|线索兑现率（兑现/新建）|盲测胜率（非平局）|写作请求/轮|判断请求/轮|首字 P50/P90（毫秒）|时延 P50/P90（毫秒）|",
	);
	lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
	for (const candidate of report.candidates) {
		const samples = candidate.samples;
		lines.push(
			`|${candidate.kind}|${candidate.completedRuns}/${candidate.failedRuns.length}|${samples.rounds}|${candidate.repetition.count === 0 ? "—" : candidate.repetition.mean.toFixed(4)}|${formatRate(candidate.progress)}|${formatRate(candidate.clueFulfillmentRate)}（${samples.notesFulfilled}/${samples.notesCreated}）|${formatBlindWin(candidate)}（${samples.blindWins + samples.blindLosses}）|${formatNumber(candidate.cost.writerRequestsPerRound)}|${formatNumber(candidate.cost.backgroundRequestsPerRound)}|${formatPercentile(candidate.cost.firstTokenMs)}|${formatPercentile(candidate.cost.durationMs)}|`,
		);
	}
	lines.push("");
	lines.push("## 条件判断");
	lines.push("");
	lines.push(
		`- 样本 ${report.conditions.total} 条；正确 ${report.conditions.correct}、错误 ${report.conditions.incorrect}、缺失 ${report.conditions.missing}、失败 ${report.conditions.failed}；准确率 ${formatRate(report.conditions.accuracy)}，分母是样本总数。`,
	);
	if (report.conditions.checks.length > 0) {
		lines.push("");
		lines.push("|样本|条件种类|人工标注|引擎结果|判定|依据|");
		lines.push("|---|---|---|---|---|---|");
		for (const check of report.conditions.checks) {
			lines.push(
				`|${check.id}|${check.kind}|${check.expected}|${check.matched === null ? "—" : check.matched}|${check.status}|${check.error ?? check.reason ?? "—"}|`,
			);
		}
	}
	lines.push("");
	lines.push("## 样本与失败");
	lines.push("");
	for (const candidate of report.candidates) {
		const samples = candidate.samples;
		lines.push(
			`- ${candidate.kind}：重复度对数 ${samples.repetitionPairs}；推进度样本 ${samples.progressSamples}；兑现平均年龄 ${candidate.meanFulfillAge === null ? "—" : candidate.meanFulfillAge.toFixed(1)}；判断失败 ${samples.backgroundErrors}；盲测样本 ${samples.blindSamples}，判定 ${samples.blindJudgements}，胜 ${samples.blindWins}、负 ${samples.blindLosses}、平 ${samples.blindTies}`,
		);
		for (const failure of candidate.failedRuns) {
			lines.push(
				`- ${candidate.kind} 第 ${failure.repetition} 次失败：${failure.error}`,
			);
		}
	}
	return lines.join("\n");
}

function formatRate(value: number | null): string {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
	return value === null ? "—" : value.toFixed(2);
}

function formatBlindWin(candidate: DirectorCandidateReport): string {
	if (candidate.kind === "mechanisms") return "对照";
	if (candidate.blindWinRate === null) return "—";
	return `${(candidate.blindWinRate * 100).toFixed(1)}%`;
}

function formatPercentile(summary: PercentileSummary | null): string {
	return summary === null ? "—" : `${summary.p50}/${summary.p90}`;
}
