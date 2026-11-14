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
	type ContextSlotProviders,
	type ContextTemplate,
	type EmbeddingClient,
	type JsonObject,
	type JsonValue,
	type LlmCallOptions,
	type LlmClient,
	type LlmReasoningLevel,
	type LlmRequest,
	type LlmResult,
	type LlmStream,
	type LlmStreamingClient,
	type LlmToolTransport,
	type StoryStore,
	StoryStore as StoryStoreClass,
	type StructuredOutputMode,
	type TurnMode,
	WORLD_MODEL_KINDS,
	type WorldModel,
	type WorldModelKind,
	type WorldModelWrite,
	createStandardChatSlots,
	createTemporalGraphWorldModel,
	createWorldModel,
	isJsonObject,
	readLedger,
	runChatTurn,
} from "@dramaticer/core";
import { type PercentileSummary, summarizePercentiles } from "./deep-eval.js";
import { answerJudgedQuestion } from "./memory-judged.js";
import type { MemoryQuestion } from "./memory-questions.js";
import {
	type PreferenceComparisonRecord,
	type PreferenceComparisonSummary,
	type PreferenceSample,
	runPreferenceSample,
	summarizePreferenceComparisons,
} from "./pairwise.js";
import { type ProbeVerdict, buildProbeQuestion } from "./probe.js";

export const WORLD_MODEL_COMPARE_FORMAT = "dramaticer.world-model-compare";
export const DEFAULT_REPETITIONS = 3;
export const DEFAULT_PROBE_COUNT = 4;
export const DEFAULT_TIME_PROBE_COUNT = 2;

export interface WorldModelCompareOptions {
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
	readonly template: ContextTemplate;
	readonly budgetTokens: number;
	readonly structuredOutput: StructuredOutputMode;
	/** 对比运行固定使用快回合，避免候选之间混入不同模式的开销。 */
	readonly turnMode?: TurnMode;
	readonly toolTransport?: LlmToolTransport | null;
	/** 同一批记忆题；为空时只跑探针。 */
	readonly questions?: readonly MemoryQuestion[];
	readonly embedder?: EmbeddingClient | null;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly reasoning?: LlmReasoningLevel;
	readonly probeCount?: number;
	readonly timeProbeCount?: number;
	readonly seed?: number;
	readonly log?: (message: string) => void;
	readonly now?: () => number;
}

export interface WorldModelCompareRoundRecord {
	readonly round: number;
	readonly userText: string;
	readonly reply: string | null;
	readonly firstTokenMs: number | null;
	readonly durationMs: number | null;
	readonly requests: number;
	readonly cachedRequests: number;
	readonly error: string | null;
}

export interface WorldModelProbeRecord {
	readonly kind: "recall" | "timeline" | "question";
	readonly id: string;
	readonly question: string;
	readonly referenceAnswer: string;
	/** unsupported 表示候选没有这个能力；skipped 表示候选状态里没有这条事实。 */
	readonly status: "done" | "failed" | "unsupported" | "skipped";
	readonly verdict: ProbeVerdict | null;
	readonly fabricatedQuestion: boolean;
	readonly fabricated: boolean;
	readonly answer: string | null;
	readonly reason: string | null;
	readonly error: string | null;
	readonly judgeAttempts: number;
}

export interface WorldModelRunRecord {
	readonly format: string;
	readonly kind: WorldModelKind;
	readonly repetition: number;
	readonly story: string;
	readonly rounds: number;
	readonly messagesHash: string;
	readonly seed: number;
	readonly status: "done" | "failed";
	readonly error: string | null;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly records: readonly WorldModelCompareRoundRecord[];
	readonly probes: readonly WorldModelProbeRecord[];
	readonly questions: readonly WorldModelProbeRecord[];
	readonly timeProbes: readonly WorldModelProbeRecord[];
	readonly profileWrites: number;
	readonly cost: WorldModelCost;
}

export interface WorldModelCost {
	readonly requests: number;
	readonly cachedRequests: number;
	readonly firstTokenMs: PercentileSummary | null;
	readonly durationMs: PercentileSummary | null;
}

export interface WorldModelCandidateSamples {
	readonly rounds: number;
	readonly requests: number;
	readonly cachedRequests: number;
	readonly probes: number;
	readonly probesJudged: number;
	readonly probeContradictions: number;
	readonly questions: number;
	readonly questionsJudged: number;
	readonly questionContradictions: number;
	readonly fabricatedQuestions: number;
	readonly fabricatedJudged: number;
	readonly fabricated: number;
	readonly timeProbes: number;
	readonly timeProbesJudged: number;
	readonly timeProbesUnsupported: number;
	readonly blindSamples: number;
	readonly blindJudgements: number;
	readonly blindWins: number;
	readonly blindLosses: number;
	readonly blindTies: number;
}

export interface WorldModelCandidateReport {
	readonly kind: WorldModelKind;
	readonly repetitions: number;
	readonly completedRuns: number;
	readonly failedRuns: readonly {
		readonly repetition: number;
		readonly error: string;
	}[];
	readonly samples: WorldModelCandidateSamples;
	/** 矛盾题数除以可判定题数；没有可判定样本时为 null。 */
	readonly contradictionRate: number | null;
	/** 编造题判矛盾数除以可判定的编造题数；没有样本时为 null。 */
	readonly fabricatedRecallRate: number | null;
	/** 候选胜出的非平局判定占比；对照候选或全部平局时为 null。 */
	readonly blindWinRate: number | null;
	readonly cost: {
		readonly requestsPerRound: number | null;
		readonly firstTokenMs: PercentileSummary | null;
		readonly durationMs: PercentileSummary | null;
		readonly requests: number;
		readonly cachedRequests: number;
	};
	readonly pairwise: PreferenceComparisonSummary;
}

export interface WorldModelCompareReport {
	readonly format: string;
	readonly story: string;
	readonly rounds: number;
	readonly repetitions: number;
	readonly seed: number;
	readonly messageCount: number;
	readonly questionCount: number;
	readonly probeCount: number;
	readonly timeProbeCount: number;
	readonly generatedAt: string;
	readonly candidates: readonly WorldModelCandidateReport[];
	readonly runs: readonly WorldModelRunRecord[];
}

interface RecallProbeSpec {
	readonly id: string;
	readonly path: readonly string[];
	readonly question: string;
}

interface TimeProbeSpec extends RecallProbeSpec {
	readonly label: string;
}

interface RequestStats {
	requests: number;
	cachedRequests: number;
}

interface CountedStreamingClient {
	readonly client: LlmStreamingClient;
	readonly stats: RequestStats;
}

/**
 * 三种候选在同一份数据库副本、同一串玩家消息、同一批记忆题与探针上
 * 各跑固定轮数，再用统一口径比较矛盾率、编造回忆率、盲测胜率与
 * 每轮成本。每个候选与每次重复各写一份 sidecar，重跑时直接复用。
 */
export async function runWorldModelCompare(
	options: WorldModelCompareOptions,
): Promise<WorldModelCompareReport> {
	const repetitions = options.repetitions ?? DEFAULT_REPETITIONS;
	const probeCount = options.probeCount ?? DEFAULT_PROBE_COUNT;
	const timeProbeCount = options.timeProbeCount ?? DEFAULT_TIME_PROBE_COUNT;
	const seed = options.seed ?? 1;
	assertCompareOptions(options, repetitions, probeCount, timeProbeCount, seed);
	const log = options.log ?? (() => undefined);
	const now = options.now ?? Date.now;
	const messagesHash = hashMessages(options.messages);
	const pairwisePlan = await readPairwisePlan(
		options.sourceDbPath,
		options.story,
		probeCount,
		timeProbeCount,
	);
	const recallProbes = pairwisePlan.recallProbes;
	const timeProbes = pairwisePlan.timeProbes;
	const questions = options.questions ?? [];
	await mkdir(options.dir, { recursive: true });
	const runs: WorldModelRunRecord[] = [];
	for (const kind of WORLD_MODEL_KINDS) {
		for (let repetition = 1; repetition <= repetitions; repetition += 1) {
			const loaded = await loadRun({
				dir: options.dir,
				kind,
				repetition,
				story: options.story,
				rounds: options.rounds,
				messagesHash,
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
					log,
					now,
					kind,
					repetition,
					messagesHash,
					recallProbes,
					timeProbes,
					questions,
				});
				await saveRun(options.dir, run);
				runs.push(run);
				log(
					`${kind} 第 ${repetition} 次：完成 ${run.records.length} 轮，请求 ${run.cost.requests}`,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const failed = failedRun({
					kind,
					repetition,
					story: options.story,
					rounds: options.rounds,
					messagesHash,
					seed,
					error: message,
					now,
				});
				runs.push(failed);
				log(`${kind} 第 ${repetition} 次失败：${message}`);
			}
		}
	}
	const pairwiseByKind = await judgePairs({
		runs,
		repetitions,
		messages: options.messages,
		judge: options.judge,
		log,
	});
	const candidates = WORLD_MODEL_KINDS.map((kind) =>
		summarizeCandidate({
			kind,
			repetitions,
			runs: runs.filter((run) => run.kind === kind),
			pairwise: pairwiseByKind.get(kind) ?? summarizePreferenceComparisons([]),
		}),
	);
	return {
		format: WORLD_MODEL_COMPARE_FORMAT,
		story: options.story,
		rounds: options.rounds,
		repetitions,
		seed,
		messageCount: options.messages.length,
		questionCount: questions.length,
		probeCount,
		timeProbeCount,
		generatedAt: new Date(now()).toISOString(),
		candidates,
		runs,
	};
}

function assertCompareOptions(
	options: WorldModelCompareOptions,
	repetitions: number,
	probeCount: number,
	timeProbeCount: number,
	seed: number,
): void {
	if (!Number.isInteger(options.rounds) || options.rounds < 1) {
		throw new Error(`对比运行的轮数必须是正整数，收到 ${options.rounds}`);
	}
	if (!Number.isInteger(repetitions) || repetitions < 1) {
		throw new Error(`每种候选的重复次数必须是正整数，收到 ${repetitions}`);
	}
	for (const [label, value] of [
		["探针数", probeCount],
		["时间点探针数", timeProbeCount],
	] as const) {
		if (!Number.isInteger(value) || value < 0) {
			throw new Error(`${label}必须是非负整数，收到 ${value}`);
		}
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

async function readPairwisePlan(
	sourceDbPath: string,
	story: string,
	probeLimit: number,
	timeProbeLimit: number,
): Promise<{
	readonly recallProbes: readonly RecallProbeSpec[];
	readonly timeProbes: readonly TimeProbeSpec[];
}> {
	const store = StoryStoreClass.open(sourceDbPath);
	try {
		const node = store.getHead(story);
		if (node === null) {
			return { recallProbes: [], timeProbes: [] };
		}
		const state = readLedger(store, node.id);
		const facts: { path: string[]; value: string }[] = [];
		flattenState(state, [], facts);
		const questions: RecallProbeSpec[] = [];
		for (const fact of facts) {
			const question = buildProbeQuestion({
				path: fact.path,
				nodeId: node.id,
				ageFloors: 0,
				value: fact.value,
			});
			if (question === null) continue;
			questions.push({
				id: fact.path.join("."),
				path: fact.path,
				question,
			});
		}
		const recallProbes = selectDeterministic(
			questions.sort((left, right) => left.id.localeCompare(right.id)),
			probeLimit,
			1,
		);
		const versions = createTemporalGraphWorldModel(store).versions(node.id);
		const timeCandidates: TimeProbeSpec[] = [];
		for (const version of versions) {
			if (version.storyTime === null) continue;
			const label = version.storyTime.start ?? version.storyTime.end ?? null;
			if (label === null) continue;
			if (typeof version.value !== "string") continue;
			const fact = {
				path: [...version.path],
				nodeId: node.id,
				ageFloors: 0,
				value: version.value,
			};
			const base = buildProbeQuestion(fact);
			if (base === null) continue;
			timeCandidates.push({
				id: `${label}:${version.path.join(".")}`,
				label,
				path: [...version.path],
				question: base.replace(
					"请回忆：",
					`请回忆：在故事时间「${label}」时，`,
				),
			});
		}
		const timeProbes = selectDeterministic(
			timeCandidates.sort((left, right) => left.id.localeCompare(right.id)),
			timeProbeLimit,
			2,
		);
		return { recallProbes, timeProbes };
	} finally {
		store.close();
	}
}

function flattenState(
	value: unknown,
	prefix: string[],
	out: { path: string[]; value: string }[],
): void {
	if (isJsonObject(value)) {
		for (const [key, child] of Object.entries(value)) {
			flattenState(child, [...prefix, key], out);
		}
		return;
	}
	if (
		typeof value === "string" &&
		value.trim().length > 0 &&
		value.length <= 300
	) {
		out.push({ path: [...prefix], value });
	}
}

function selectDeterministic<T extends { readonly id: string }>(
	items: readonly T[],
	count: number,
	salt: number,
): T[] {
	if (count <= 0 || items.length === 0) return [];
	const ordered = [...items].sort((left, right) => {
		const leftHash = hashText(`${salt}:${left.id}`);
		const rightHash = hashText(`${salt}:${right.id}`);
		return leftHash.localeCompare(rightHash);
	});
	return ordered.slice(0, count);
}

function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function hashMessages(messages: readonly string[]): string {
	return createHash("sha256").update(JSON.stringify(messages)).digest("hex");
}

interface CandidateOptions extends WorldModelCompareOptions {
	readonly kind: WorldModelKind;
	readonly repetition: number;
	readonly messagesHash: string;
	readonly recallProbes: readonly RecallProbeSpec[];
	readonly timeProbes: readonly TimeProbeSpec[];
	readonly questions: readonly MemoryQuestion[];
	readonly log: (message: string) => void;
	readonly now: () => number;
}

async function runCandidate(
	options: CandidateOptions,
): Promise<WorldModelRunRecord> {
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
		store.updateStorySettings(options.story, { worldModel: options.kind });
		const settings = store.getStorySettings(options.story);
		const slots = await createStandardChatSlots({
			store,
			characterPrompt: settings.characterPrompt,
			embedder: options.embedder ?? null,
			directorConfig: settings.directorConfig,
			historyBlockPolicy: settings.historyBlockPolicy,
			worldModel: options.kind,
		});
		const worldModel = createWorldModel(store, options.kind);
		const records: WorldModelCompareRoundRecord[] = [];
		let profileWrites = 0;
		for (let round = 1; round <= options.rounds; round += 1) {
			const userText = options.messages[round - 1];
			if (userText === undefined) {
				throw new Error(`缺少第 ${round} 条玩家消息`);
			}
			const headBefore = store.getHead(options.story);
			const counted = countStreamingClient(options.writer.client);
			try {
				const result = await runChatTurn({
					store,
					client: counted.client,
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
				records.push({
					round,
					userText,
					reply: result.node.raw,
					firstTokenMs: result.trace.timing.firstTokenMs,
					durationMs: result.trace.timing.durationMs,
					requests: counted.stats.requests,
					cachedRequests: counted.stats.cachedRequests,
					error: null,
				});
				profileWrites += await mirrorRepresentationWrites({
					kind: options.kind,
					worldModel,
					nodeId: result.node.id,
					diffs: result.stateDiffs,
					round,
				});
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
					requests: counted.stats.requests,
					cachedRequests: counted.stats.cachedRequests,
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
		const head = store.getHead(options.story);
		if (head === null) {
			throw new Error(`候选 ${options.kind} 运行结束后故事没有 head`);
		}
		const probes = await askProbes({
			store,
			story: options.story,
			headNodeId: head.id,
			worldModel,
			slots,
			recallProbes: options.recallProbes,
			timeProbes: options.timeProbes,
			template: options.template,
			budgetTokens: options.budgetTokens,
			assistant: options.writer,
			judge: options.judge,
			kind: options.kind,
		});
		const questionRecords = await askQuestions({
			store,
			story: options.story,
			headNodeId: head.id,
			questions: options.questions,
			providers: slots.providers,
			template: options.template,
			budgetTokens: options.budgetTokens,
			assistant: options.writer,
			judge: options.judge,
		});
		const finishedAt = new Date(options.now()).toISOString();
		return {
			format: WORLD_MODEL_COMPARE_FORMAT,
			kind: options.kind,
			repetition: options.repetition,
			story: options.story,
			rounds: options.rounds,
			messagesHash: options.messagesHash,
			seed: options.seed ?? 1,
			status: "done",
			error: null,
			startedAt,
			finishedAt,
			records,
			probes: probes.recall,
			questions: questionRecords,
			timeProbes: probes.timeline,
			profileWrites,
			cost: summarizeCost(records),
		};
	} finally {
		store.close();
	}
}

function failedRun(input: {
	readonly kind: WorldModelKind;
	readonly repetition: number;
	readonly story: string;
	readonly rounds: number;
	readonly messagesHash: string;
	readonly seed: number;
	readonly error: string;
	readonly now: () => number;
}): WorldModelRunRecord {
	return {
		format: WORLD_MODEL_COMPARE_FORMAT,
		kind: input.kind,
		repetition: input.repetition,
		story: input.story,
		rounds: input.rounds,
		messagesHash: input.messagesHash,
		seed: input.seed,
		status: "failed",
		error: input.error,
		startedAt: new Date(input.now()).toISOString(),
		finishedAt: new Date(input.now()).toISOString(),
		records: [],
		probes: [],
		questions: [],
		timeProbes: [],
		profileWrites: 0,
		cost: summarizeCost([]),
	};
}

/**
 * 模型写入的台账事实由回合直接落库；候选自己的表示在这里补写。
 * 实体档案候选把本轮涉及的人物写成一条档案修订，其余候选不需要额外写入。
 */
async function mirrorRepresentationWrites(input: {
	readonly kind: WorldModelKind;
	readonly worldModel: WorldModel;
	readonly nodeId: string;
	readonly diffs: readonly {
		readonly path: readonly string[];
		readonly op: "set" | "delete";
	}[];
	readonly round: number;
}): Promise<number> {
	if (input.kind !== "wiki") return 0;
	const entities = new Set<string>();
	for (const diff of input.diffs) {
		if (diff.path[0] !== "character" || diff.path.length < 2) continue;
		const entity = diff.path[1];
		if (entity !== undefined && entity.length > 0) entities.add(entity);
	}
	if (entities.size === 0) return 0;
	const view = input.worldModel.read(input.nodeId);
	const characters = isJsonObject(view.state)
		? view.state.character
		: undefined;
	const writes: WorldModelWrite[] = [];
	for (const entity of [...entities].sort()) {
		const value = isJsonObject(characters) ? characters[entity] : undefined;
		if (value === undefined) continue;
		writes.push({
			path: ["profile", entity],
			op: "set",
			value: renderProfileText(input.round, entity, value),
			source: "settler",
		});
	}
	input.worldModel.write(input.nodeId, writes);
	return writes.length;
}

const PROFILE_FIELDS: readonly [string, string][] = [
	["tier", "层级"],
	["identity", "身份"],
	["appearance", "外貌"],
	["outfit", "衣着"],
	["status", "状态"],
	["location", "位置"],
];

function renderProfileText(
	round: number,
	entity: string,
	value: unknown,
): string {
	if (!isJsonObject(value)) {
		return `第 ${round} 楼：人物 ${entity} 已从台账移除。`;
	}
	const parts: string[] = [];
	for (const [key, label] of PROFILE_FIELDS) {
		const field = value[key];
		if (field === undefined || field === null) continue;
		parts.push(`${label}：${formatProfileValue(field)}`);
	}
	if (parts.length === 0) {
		return `第 ${round} 楼：人物 ${entity} 没有可读字段。`;
	}
	return `第 ${round} 楼：${parts.join("；")}`;
}

function formatProfileValue(value: JsonValue): string {
	if (typeof value === "string") return value;
	return JSON.stringify(value);
}

async function askProbes(input: {
	readonly store: StoryStore;
	readonly story: string;
	readonly headNodeId: string;
	readonly worldModel: WorldModel;
	readonly slots: { readonly providers: ContextSlotProviders };
	readonly recallProbes: readonly RecallProbeSpec[];
	readonly timeProbes: readonly TimeProbeSpec[];
	readonly template: ContextTemplate;
	readonly budgetTokens: number;
	readonly assistant: {
		readonly client: LlmStreamingClient;
		readonly model: string;
	};
	readonly judge: { readonly client: LlmClient; readonly model: string };
	readonly kind: WorldModelKind;
}): Promise<{
	readonly recall: readonly WorldModelProbeRecord[];
	readonly timeline: readonly WorldModelProbeRecord[];
}> {
	const recall: WorldModelProbeRecord[] = [];
	for (const probe of input.recallProbes) {
		recall.push(
			await askOneProbe({
				...input,
				kind: "recall",
				probe,
				reference: readReference(input, probe.path),
			}),
		);
	}
	const timeline: WorldModelProbeRecord[] = [];
	for (const probe of input.timeProbes) {
		if (input.kind !== "temporal_graph") {
			timeline.push({
				kind: "timeline",
				id: probe.id,
				question: probe.question,
				referenceAnswer: "",
				status: "unsupported",
				verdict: null,
				fabricatedQuestion: false,
				fabricated: false,
				answer: null,
				reason: null,
				error: `世界模型 ${input.kind} 不支持按故事时间点查询`,
				judgeAttempts: 0,
			});
			continue;
		}
		const atTime = input.worldModel.read(input.headNodeId, {
			atStoryTime: probe.label,
		});
		const value = getPathValue(atTime.state, probe.path);
		timeline.push(
			await askOneProbe({
				...input,
				kind: "timeline",
				probe,
				reference: value === undefined ? undefined : String(value),
			}),
		);
	}
	return { recall, timeline };
}

function readReference(
	input: {
		readonly worldModel: WorldModel;
		readonly headNodeId: string;
	},
	path: readonly string[],
): string | undefined {
	const state = input.worldModel.read(input.headNodeId).state;
	const value = getPathValue(state, path);
	return value === undefined ? undefined : String(value);
}

async function askOneProbe(input: {
	readonly kind: "recall" | "timeline";
	readonly probe: RecallProbeSpec;
	readonly reference: string | undefined;
	readonly store: StoryStore;
	readonly story: string;
	readonly headNodeId: string;
	readonly slots: { readonly providers: ContextSlotProviders };
	readonly template: ContextTemplate;
	readonly budgetTokens: number;
	readonly assistant: {
		readonly client: LlmStreamingClient;
		readonly model: string;
	};
	readonly judge: { readonly client: LlmClient; readonly model: string };
}): Promise<WorldModelProbeRecord> {
	if (input.reference === undefined) {
		return {
			kind: input.kind,
			id: input.probe.id,
			question: input.probe.question,
			referenceAnswer: "",
			status: "skipped",
			verdict: null,
			fabricatedQuestion: false,
			fabricated: false,
			answer: null,
			reason: null,
			error: "候选的当前状态里没有这条事实",
			judgeAttempts: 0,
		};
	}
	try {
		const answer = await answerJudgedQuestion({
			store: input.store,
			storyId: input.story,
			askAtNode: input.headNodeId,
			spec: {
				id: input.probe.id,
				question: input.probe.question,
				answer: input.reference,
				evidenceNodes: [],
				fabricated: false,
			},
			template: input.template,
			providers: input.slots.providers,
			budgetTokens: input.budgetTokens,
			assistant: input.assistant,
			judge: input.judge,
			temperature: 0.3,
			maxTokens: 1_024,
		});
		return {
			kind: input.kind,
			id: input.probe.id,
			question: input.probe.question,
			referenceAnswer: input.reference,
			status: answer.status,
			verdict: answer.verdict,
			fabricatedQuestion: false,
			fabricated: answer.fabricated,
			answer: answer.answer,
			reason: answer.reason,
			error: answer.error,
			judgeAttempts: answer.judgeAttempts,
		};
	} catch (error) {
		return {
			kind: input.kind,
			id: input.probe.id,
			question: input.probe.question,
			referenceAnswer: input.reference,
			status: "failed",
			verdict: null,
			fabricatedQuestion: false,
			fabricated: false,
			answer: null,
			reason: null,
			error: error instanceof Error ? error.message : String(error),
			judgeAttempts: 0,
		};
	}
}

async function askQuestions(input: {
	readonly store: StoryStore;
	readonly story: string;
	readonly headNodeId: string;
	readonly questions: readonly MemoryQuestion[];
	readonly providers: ContextSlotProviders;
	readonly template: ContextTemplate;
	readonly budgetTokens: number;
	readonly assistant: {
		readonly client: LlmStreamingClient;
		readonly model: string;
	};
	readonly judge: { readonly client: LlmClient; readonly model: string };
}): Promise<WorldModelProbeRecord[]> {
	const records: WorldModelProbeRecord[] = [];
	for (const question of input.questions) {
		if (question.story !== input.story) {
			throw new Error(
				`题目 ${question.id} 属于故事 ${question.story}，与 ${input.story} 不一致`,
			);
		}
		try {
			const answer = await answerJudgedQuestion({
				store: input.store,
				storyId: input.story,
				askAtNode: input.headNodeId,
				spec: {
					id: question.id,
					question: question.question,
					answer: question.answer,
					evidenceNodes: question.evidenceNodes,
					fabricated: question.fabricated,
				},
				template: input.template,
				providers: input.providers,
				budgetTokens: input.budgetTokens,
				assistant: input.assistant,
				judge: input.judge,
				temperature: 0.3,
				maxTokens: 1_024,
			});
			records.push({
				kind: "question",
				id: question.id,
				question: question.question,
				referenceAnswer: question.answer,
				status: answer.status,
				verdict: answer.verdict,
				fabricatedQuestion: question.fabricated,
				fabricated: answer.fabricated,
				answer: answer.answer,
				reason: answer.reason,
				error: answer.error,
				judgeAttempts: answer.judgeAttempts,
			});
		} catch (error) {
			records.push({
				kind: "question",
				id: question.id,
				question: question.question,
				referenceAnswer: question.answer,
				status: "failed",
				verdict: null,
				fabricatedQuestion: question.fabricated,
				fabricated: false,
				answer: null,
				reason: null,
				error: error instanceof Error ? error.message : String(error),
				judgeAttempts: 0,
			});
		}
	}
	return records;
}

function getPathValue(root: JsonObject, path: readonly string[]): unknown {
	let current: unknown = root;
	for (const segment of path) {
		if (!isJsonObject(current)) return undefined;
		current = current[segment];
	}
	return current;
}

function summarizeCost(
	records: readonly WorldModelCompareRoundRecord[],
): WorldModelCost {
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

async function judgePairs(input: {
	readonly runs: readonly WorldModelRunRecord[];
	readonly repetitions: number;
	readonly messages: readonly string[];
	readonly judge: { readonly client: LlmClient; readonly model: string };
	readonly log: (message: string) => void;
}): Promise<Map<WorldModelKind, PreferenceComparisonSummary>> {
	const result = new Map<WorldModelKind, PreferenceComparisonSummary>();
	const baselineByRepetition = new Map<number, WorldModelRunRecord>();
	for (const run of input.runs) {
		if (run.kind === "ledger" && run.status === "done") {
			baselineByRepetition.set(run.repetition, run);
		}
	}
	for (const kind of WORLD_MODEL_KINDS) {
		if (kind === "ledger") {
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
	readonly kind: WorldModelKind;
	readonly repetitions: number;
	readonly runs: readonly WorldModelRunRecord[];
	readonly pairwise: PreferenceComparisonSummary;
}): WorldModelCandidateReport {
	const completed = input.runs.filter((run) => run.status === "done");
	const failedRuns = input.runs
		.filter((run) => run.status === "failed")
		.map((run) => ({
			repetition: run.repetition,
			error: run.error ?? "未知错误",
		}));
	const probes = completed.flatMap((run) => run.probes);
	const questions = completed.flatMap((run) => run.questions);
	const timeProbes = completed.flatMap((run) => run.timeProbes);
	const all = [...probes, ...questions];
	const judged = all.filter(
		(record) =>
			record.status === "done" &&
			(record.verdict === "consistent" || record.verdict === "contradicted"),
	);
	const contradicted = judged.filter(
		(record) => record.verdict === "contradicted",
	).length;
	const fabricatedJudged = questions.filter(
		(record) =>
			record.fabricatedQuestion &&
			record.status === "done" &&
			(record.verdict === "consistent" || record.verdict === "contradicted"),
	);
	const fabricated = fabricatedJudged.filter(
		(record) => record.verdict === "contradicted",
	).length;
	const timeJudged = timeProbes.filter(
		(record) =>
			record.status === "done" &&
			(record.verdict === "consistent" || record.verdict === "contradicted"),
	);
	const requests = completed.reduce(
		(total, run) => total + run.cost.requests,
		0,
	);
	const cachedRequests = completed.reduce(
		(total, run) => total + run.cost.cachedRequests,
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
			probes: probes.length,
			probesJudged: probes.filter(
				(record) =>
					record.status === "done" &&
					(record.verdict === "consistent" ||
						record.verdict === "contradicted"),
			).length,
			probeContradictions: probes.filter(
				(record) =>
					record.status === "done" && record.verdict === "contradicted",
			).length,
			questions: questions.length,
			questionsJudged: questions.filter(
				(record) =>
					record.status === "done" &&
					(record.verdict === "consistent" ||
						record.verdict === "contradicted"),
			).length,
			questionContradictions: questions.filter(
				(record) =>
					record.status === "done" && record.verdict === "contradicted",
			).length,
			fabricatedQuestions: questions.filter(
				(record) => record.fabricatedQuestion,
			).length,
			fabricatedJudged: fabricatedJudged.length,
			fabricated,
			timeProbes: timeProbes.length,
			timeProbesJudged: timeJudged.length,
			timeProbesUnsupported: timeProbes.filter(
				(record) => record.status === "unsupported",
			).length,
			blindSamples: overall?.samples ?? 0,
			blindJudgements: overall?.judgements ?? 0,
			blindWins: overall?.acceptedWins ?? 0,
			blindLosses: overall?.abandonedWins ?? 0,
			blindTies: overall?.ties ?? 0,
		},
		contradictionRate:
			judged.length === 0 ? null : contradicted / judged.length,
		fabricatedRecallRate:
			fabricatedJudged.length === 0
				? null
				: fabricated / fabricatedJudged.length,
		blindWinRate,
		cost: {
			requestsPerRound: roundCount === 0 ? null : requests / roundCount,
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
		},
		pairwise: input.pairwise,
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

async function saveRun(dir: string, run: WorldModelRunRecord): Promise<void> {
	const file = runFile(dir, run.kind, run.repetition);
	await mkdir(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp`;
	await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, "utf8");
	await rename(temporary, file);
}

async function loadRun(input: {
	readonly dir: string;
	readonly kind: WorldModelKind;
	readonly repetition: number;
	readonly story: string;
	readonly rounds: number;
	readonly messagesHash: string;
	readonly seed: number;
}): Promise<WorldModelRunRecord | null> {
	const file = runFile(input.dir, input.kind, input.repetition);
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const value: unknown = JSON.parse(raw);
	if (!isWorldModelRunRecord(value)) {
		throw new Error(`${file} 不是有效的结果文件`);
	}
	const mismatches: string[] = [];
	if (value.format !== WORLD_MODEL_COMPARE_FORMAT) mismatches.push("格式");
	if (value.story !== input.story) mismatches.push("故事");
	if (value.kind !== input.kind) mismatches.push("候选");
	if (value.repetition !== input.repetition) mismatches.push("重复序号");
	if (value.rounds !== input.rounds) mismatches.push("轮数");
	if (value.messagesHash !== input.messagesHash) mismatches.push("玩家消息");
	if (value.seed !== input.seed) mismatches.push("随机种子");
	if (mismatches.length > 0) {
		throw new Error(
			`${file} 与本次运行不一致：${mismatches.join("、")}；删除该文件后重跑`,
		);
	}
	return value;
}

function isWorldModelRunRecord(value: unknown): value is WorldModelRunRecord {
	return (
		isJsonObject(value) &&
		value.format === WORLD_MODEL_COMPARE_FORMAT &&
		typeof value.story === "string" &&
		typeof value.kind === "string" &&
		(WORLD_MODEL_KINDS as readonly string[]).includes(value.kind) &&
		typeof value.repetition === "number" &&
		typeof value.rounds === "number" &&
		typeof value.messagesHash === "string" &&
		typeof value.seed === "number" &&
		(value.status === "done" || value.status === "failed") &&
		Array.isArray(value.records) &&
		Array.isArray(value.probes) &&
		Array.isArray(value.questions) &&
		Array.isArray(value.timeProbes) &&
		isJsonObject(value.cost)
	);
}

function runFile(
	dir: string,
	kind: WorldModelKind,
	repetition: number,
): string {
	return path.join(dir, "runs", kind, `${repetition}.json`);
}

export function formatWorldModelCompareReport(
	report: WorldModelCompareReport,
): string {
	const lines: string[] = [];
	lines.push("# 世界模型表示方式对比");
	lines.push("");
	lines.push(
		`- 故事：${report.story}；轮数：${report.rounds}；重复：${report.repetitions}；玩家消息：${report.messageCount} 条；记忆题：${report.questionCount}；探针：${report.probeCount}；时间点探针：${report.timeProbeCount}；种子：${report.seed}`,
	);
	lines.push(
		"- 口径：矛盾率 = 矛盾题数 /（一致 + 矛盾）；编造回忆率 = 编造题判矛盾数 / 被判定的编造题数；盲测胜率 = 候选胜出的非平局判定占比；每轮成本只统计自动试玩的写作请求与 Trace 耗时。",
	);
	lines.push(
		"- 隔离：每个候选与每次重复复制同一份源数据库，使用同一串玩家消息、同一批记忆题与探针；台账与 wiki 的时间点探针记为不适用，不伪造结果。",
	);
	lines.push("");
	lines.push(
		"|候选|完成/失败|轮数|矛盾率（判定）|编造回忆率（判定）|盲测胜率（非平局）|每轮请求|首字 P50/P90（毫秒）|时延 P50/P90（毫秒）|",
	);
	lines.push("|---|---|---|---|---|---|---|---|---|");
	for (const candidate of report.candidates) {
		const samples = candidate.samples;
		lines.push(
			`|${candidate.kind}|${candidate.completedRuns}/${candidate.failedRuns.length}|${samples.rounds}|${formatRate(candidate.contradictionRate)}（${samples.probesJudged + samples.questionsJudged}）|${formatRate(candidate.fabricatedRecallRate)}（${samples.fabricatedJudged}）|${formatBlindWin(candidate)}（${samples.blindWins + samples.blindLosses}）|${candidate.cost.requestsPerRound === null ? "—" : candidate.cost.requestsPerRound.toFixed(2)}|${formatPercentile(candidate.cost.firstTokenMs)}|${formatPercentile(candidate.cost.durationMs)}|`,
		);
	}
	lines.push("");
	lines.push("## 探针与失败");
	lines.push("");
	for (const candidate of report.candidates) {
		const samples = candidate.samples;
		lines.push(
			`- ${candidate.kind}：召回探针 ${samples.probes}（可判定 ${samples.probesJudged}）；记忆题 ${samples.questions}（可判定 ${samples.questionsJudged}）；编造题 ${samples.fabricatedQuestions}（可判定 ${samples.fabricatedJudged}）；时间点探针 ${samples.timeProbes}（可判定 ${samples.timeProbesJudged}，不适用 ${samples.timeProbesUnsupported}）；盲测样本 ${samples.blindSamples}，判定 ${samples.blindJudgements}，胜 ${samples.blindWins}、负 ${samples.blindLosses}、平 ${samples.blindTies}`,
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

function formatBlindWin(candidate: WorldModelCandidateReport): string {
	if (candidate.kind === "ledger") return "对照";
	if (candidate.blindWinRate === null) return "—";
	return `${(candidate.blindWinRate * 100).toFixed(1)}%`;
}

function formatPercentile(summary: PercentileSummary | null): string {
	return summary === null ? "—" : `${summary.p50}/${summary.p90}`;
}
