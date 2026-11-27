import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type DirectorConfig,
	type EmbeddingClient,
	type LlmStreamingClient,
	type PlotNote,
	StoryStore,
	type TimelineNode,
	cosineSimilarity,
	createDefaultContextTemplate,
	meanVector,
	normalizeEntityName,
} from "@dramaticer/core";
import {
	type StCharacterCard,
	parseCharacterCardFile,
} from "../character-card.js";
import { importChatFileToStore } from "../chat-import.js";
import { importCardContent } from "../chat/session.js";
import {
	type Snapshot,
	isLegacyCorpus,
	openSnapshot,
} from "../health/manifest.js";
import { type StWorldInfo, parseWorldInfoFile } from "../world-info.js";
import {
	type ReplayTurn,
	createChatReplayGenerator,
	runDirectorReplay,
} from "./director-replay.js";
import { buildStoryVectors } from "./memory-eval.js";
import {
	type RepetitionMeasurement,
	type SimilaritySummary,
	measureBlockRepetition,
	summarize,
} from "./metrics.js";
import { storyIdOf } from "./question-files.js";

export type ReplayMode = "on" | "off";
export {
	measureBlockRepetition,
	type RepetitionMeasurement,
	type SimilaritySummary,
	summarize,
};

export interface ReplayRunRecord {
	readonly story: string;
	/** 分支点在主路径上的位置，从 1 开始。 */
	readonly branchFloor: number;
	readonly mode: ReplayMode;
	readonly pair: number;
	readonly requestedRounds: number;
	readonly generatedFloors: number;
	readonly blockCount: number;
	readonly jaccard: SimilaritySummary;
	readonly cosine: SimilaritySummary;
	readonly missingVectorFloors: number;
	readonly notesCreated: number;
	readonly notesFulfilled: number;
	readonly meanFulfillAge: number | null;
	readonly directorDecisions: number;
	readonly directorMessages: number;
	readonly mechanismTriggers: Readonly<Record<string, number>>;
	readonly mechanismSelections: Readonly<Record<string, number>>;
}

export interface ReplayFailure {
	readonly story: string;
	readonly branchFloor: number | null;
	readonly mode: ReplayMode | null;
	readonly pair: number | null;
	readonly message: string;
}

export interface ModeAggregate {
	readonly runs: number;
	readonly generatedFloors: number;
	readonly blockCount: number;
	readonly jaccard: SimilaritySummary;
	readonly cosine: SimilaritySummary;
	readonly notesCreated: number;
	readonly notesFulfilled: number;
	readonly fulfillmentRate: number | null;
	readonly meanFulfillAge: number | null;
	readonly directorDecisions: number;
	readonly directorMessages: number;
	readonly mechanismTriggers: Readonly<Record<string, number>>;
	readonly mechanismSelections: Readonly<Record<string, number>>;
}

export interface DirectorEvalComparison {
	readonly label: string;
	readonly on: number | null;
	readonly off: number | null;
	/** `lower` 表示数值越低越好。 */
	readonly better: "lower" | "higher";
	/** 两种模式都有数字且开启模式更好时为 true。 */
	readonly improved: boolean | null;
}

export interface DirectorEvalChecks {
	/** 关闭导演的每个回放都没有决策记录。 */
	readonly offHasNoDecisions: boolean;
	/** 关闭导演的每个回放都没有导演消息。 */
	readonly offHasNoDirectorMessages: boolean;
	/** 开启导演的回放里至少有一个机制触发。 */
	readonly onTriggersMechanism: boolean;
}

export interface DirectorEvalStoryInfo {
	readonly story: string;
	readonly floors: number;
	readonly branchPoints: number;
	readonly chunkCount: number;
	readonly vectorCount: number;
}

export interface DirectorEvalSettings {
	readonly interval: number;
	readonly rounds: number;
	readonly pairs: number;
	readonly maxBranchPointsPerStory: number;
	readonly director: DirectorConfig;
	readonly structuredOutput: string;
}

export interface DirectorEvalReport {
	readonly generatedAt: string;
	readonly modelAlias: string;
	readonly embeddingLabel: string | null;
	readonly settings: DirectorEvalSettings;
	readonly stories: readonly DirectorEvalStoryInfo[];
	readonly runs: readonly ReplayRunRecord[];
	readonly failures: readonly ReplayFailure[];
	readonly aggregate: Readonly<Record<ReplayMode, ModeAggregate>>;
	readonly comparisons: readonly DirectorEvalComparison[];
	readonly checks: DirectorEvalChecks;
}

export interface CollectDirectorEvalOptions {
	readonly rawRoot: string;
	/** 种子数据库、回放数据库与临时文件的存放目录；结束时删除。 */
	readonly workDir: string;
	readonly embedder: EmbeddingClient;
	readonly embeddingLabel: string;
	readonly client: LlmStreamingClient;
	readonly modelAlias: string;
	readonly structuredOutput: "text-tags" | "function-call";
	readonly budgetTokens: number;
	readonly interval?: number;
	readonly rounds?: number;
	readonly pairs?: number;
	readonly maxBranchPointsPerStory?: number;
	readonly directorConfig?: DirectorConfig;
	readonly generatedAt?: string;
	readonly log?: (message: string) => void;
}

interface MeasuredRun extends ReplayRunRecord {
	readonly jaccardValues: readonly number[];
	readonly cosineValues: readonly number[];
	readonly fulfillAges: readonly number[];
}

interface BranchPoint {
	readonly nodeId: string;
	readonly floor: number;
	readonly userTexts: readonly string[];
}

interface ReplaySettings {
	readonly interval: number;
	readonly rounds: number;
	readonly pairs: number;
	readonly maxBranchPointsPerStory: number;
}

const MODES: readonly ReplayMode[] = ["on", "off"];

/** 线索兑现的文本匹配长度：笔记里连续这么多字符出现在后续回复里即视为兑现。 */
export const CLUE_FULFILL_NGRAM = 4;

export async function collectDirectorEval(
	options: CollectDirectorEvalOptions,
): Promise<DirectorEvalReport> {
	const log = options.log ?? (() => undefined);
	const settings = resolveSettings(options);
	const directorConfig = options.directorConfig ?? DEFAULT_DIRECTOR_CONFIG;
	const generatedAt = options.generatedAt ?? new Date().toISOString();
	await mkdir(options.workDir, { recursive: true });
	try {
		const snapshot = await openSnapshot(options.rawRoot);
		const chatFiles = snapshot.filesByRole("chat").filter(isLegacyCorpus);
		if (chatFiles.length === 0) throw new Error("manifest 里没有 chat");
		const runs: MeasuredRun[] = [];
		const failures: ReplayFailure[] = [];
		const stories: DirectorEvalStoryInfo[] = [];

		for (const [index, file] of chatFiles.entries()) {
			const storyId = storyIdOf(file);
			const storyLabel = `对话 ${index + 1}`;
			const seedPath = path.join(options.workDir, `seed-${index + 1}.db`);
			let seedStore: StoryStore | null = null;
			try {
				const chatPath = await snapshot.resolveFile(file);
				const card = await loadStoryCard(snapshot, file.character ?? storyId);
				const worlds = await loadStoryWorlds(
					snapshot,
					file.character ?? storyId,
				);
				seedStore = StoryStore.open(seedPath, {
					embeddingDimensions: options.embedder.dimensions,
				});
				log(`${storyLabel}：导入对话`);
				const imported = await importChatFileToStore(seedStore, chatPath, {
					storyId,
				});
				importCardContent(seedStore, storyId, { card, worlds });
				log(`${storyLabel}：生成前缀块向量`);
				await buildStoryVectors({
					store: seedStore,
					storyId,
					embedder: options.embedder,
					onProgress: (progress) => {
						if (
							progress.done % 2048 === 0 ||
							progress.done === progress.total
						) {
							log(`${storyLabel} 向量 ${progress.done}/${progress.total}`);
						}
					},
				});
				const pathNodes = seededPath(seedStore, imported.mainPathNodeIds);
				const branchPoints = selectBranchPoints(pathNodes, settings);
				stories.push({
					story: storyLabel,
					floors: pathNodes.length,
					branchPoints: branchPoints.length,
					chunkCount: countStoryChunks(seedStore, pathNodes),
					vectorCount: countStoryVectors(seedStore, pathNodes),
				});
				seedStore.close();
				seedStore = null;

				for (const branch of branchPoints) {
					for (const mode of MODES) {
						for (let pair = 1; pair <= settings.pairs; pair += 1) {
							const runLabel = `${storyLabel} 第 ${branch.floor} 楼 ${mode} 第 ${pair} 次`;
							const runPath = path.join(
								options.workDir,
								`run-${index + 1}-${branch.floor}-${mode}-${pair}.db`,
							);
							try {
								await copyFile(seedPath, runPath);
								const run = await runOneReplay({
									storePath: runPath,
									storyId,
									storyLabel,
									card,
									branch,
									mode,
									pair,
									settings,
									directorConfig,
									options,
								});
								runs.push(run);
								log(
									`${runLabel}：${run.generatedFloors} 楼，笔记 ${run.notesCreated}/${run.notesFulfilled}，导演消息 ${run.directorMessages}`,
								);
							} catch (error) {
								failures.push({
									story: storyLabel,
									branchFloor: branch.floor,
									mode,
									pair,
									message: errorMessage(error),
								});
								log(`${runLabel}：失败 ${errorMessage(error)}`);
							} finally {
								await removeDatabase(runPath);
							}
						}
					}
				}
			} catch (error) {
				failures.push({
					story: storyLabel,
					branchFloor: null,
					mode: null,
					pair: null,
					message: errorMessage(error),
				});
				log(`${storyLabel}：失败 ${errorMessage(error)}`);
			} finally {
				seedStore?.close();
				await removeDatabase(seedPath);
			}
		}

		return buildReport({
			runs,
			failures,
			stories,
			settings,
			directorConfig,
			modelAlias: options.modelAlias,
			embeddingLabel: options.embeddingLabel,
			structuredOutput: options.structuredOutput,
			generatedAt,
		});
	} finally {
		await rm(options.workDir, { recursive: true, force: true });
	}
}

interface RunOneReplayOptions {
	readonly storePath: string;
	readonly storyId: string;
	readonly storyLabel: string;
	readonly card: StCharacterCard;
	readonly branch: BranchPoint;
	readonly mode: ReplayMode;
	readonly pair: number;
	readonly settings: ReplaySettings;
	readonly directorConfig: DirectorConfig;
	readonly options: CollectDirectorEvalOptions;
}

async function runOneReplay(input: RunOneReplayOptions): Promise<MeasuredRun> {
	const dimensions = input.options.embedder.dimensions;
	const store = StoryStore.open(input.storePath, {
		embeddingDimensions: dimensions,
	});
	try {
		store.setHead(input.storyId, input.branch.nodeId);
		const generator = createChatReplayGenerator({
			card: input.card,
			client: input.options.client,
			template: createDefaultContextTemplate({
				structuredOutput: input.options.structuredOutput,
			}),
			structuredOutput: input.options.structuredOutput,
			budgetTokens: input.options.budgetTokens,
			embedder: input.options.embedder,
			model: input.options.modelAlias,
			reasoning: "low",
		});
		const openNotes = new Map<string, PlotNote>();
		const fulfillAges: number[] = [];
		let notesCreated = 0;
		const afterTurn = async (turn: ReplayTurn): Promise<void> => {
			await embedFloorVectors(
				store,
				turn.assistantNodeId,
				input.options.embedder,
			);
			fulfillMatchingNotes({
				store,
				turn,
				openNotes,
				fulfillAges,
			});
			for (const note of turn.notes) {
				notesCreated += 1;
				openNotes.set(note.id, note);
			}
		};
		const outcome = await runDirectorReplay({
			store,
			storyId: input.storyId,
			userTexts: input.branch.userTexts,
			generate: generator,
			afterTurn,
		});
		const decisions = outcome.turns.map((turn) =>
			store.getDirectorDecision(turn.userNodeId),
		);
		const mechanismTriggers = countMechanisms(
			decisions.flatMap((decision) =>
				decision === null
					? []
					: decision.mechanisms
							.filter((record) => record.triggered)
							.map((record) => record.name),
			),
		);
		const mechanismSelections = countMechanisms(
			outcome.turns.flatMap((turn) =>
				turn.directorSelected === null ? [] : [turn.directorSelected],
			),
		);
		const directorMessages = outcome.turns.filter((turn) =>
			hasIncludedDirectorMessage(turn),
		).length;
		const repetition = measureBlockRepetition(
			outcome.turns.map((turn) => turn.reply),
		);
		const cosine = measureBeatCosine(
			store,
			outcome.turns.map((turn) => turn.assistantNodeId),
		);
		return {
			story: input.storyLabel,
			branchFloor: input.branch.floor,
			mode: input.mode,
			pair: input.pair,
			requestedRounds: input.settings.rounds,
			generatedFloors: outcome.turns.length,
			blockCount: repetition.blockCount,
			jaccard: repetition.summary,
			cosine: cosine.summary,
			missingVectorFloors: cosine.missingVectorFloors,
			notesCreated,
			notesFulfilled: fulfillAges.length,
			meanFulfillAge: meanOrNull(fulfillAges),
			directorDecisions: decisions.filter((decision) => decision !== null)
				.length,
			directorMessages,
			mechanismTriggers,
			mechanismSelections,
			jaccardValues: repetition.values,
			cosineValues: cosine.values,
			fulfillAges,
		};
	} finally {
		store.close();
	}
}

interface FulfillMatchingNotesOptions {
	readonly store: StoryStore;
	readonly turn: ReplayTurn;
	readonly openNotes: Map<string, PlotNote>;
	readonly fulfillAges: number[];
}

/**
 * 判定线索兑现：后续助手回复的显示视图里出现笔记正文的连续字符。
 * 同一轮生成的笔记不参与本轮判定。
 */
function fulfillMatchingNotes(options: FulfillMatchingNotesOptions): void {
	const { store, turn, openNotes, fulfillAges } = options;
	if (openNotes.size === 0) return;
	const reply = normalizeEntityName(turn.reply);
	if (reply.length === 0) return;
	const path = store.getPathToNode(turn.assistantNodeId);
	const positions = new Map(
		path.map((node, index) => [node.id, index] as const),
	);
	const currentPosition = path.length - 1;
	const fulfilled: string[] = [];
	for (const note of openNotes.values()) {
		const sourcePosition = positions.get(note.sourceNodeId);
		if (sourcePosition === undefined) continue;
		const age = currentPosition - sourcePosition;
		if (age < 1) continue;
		if (!noteMatchesReply(note.text, reply)) continue;
		store.fulfillPlotNote(note.id, new Date().toISOString());
		fulfillAges.push(age);
		fulfilled.push(note.id);
	}
	for (const noteId of fulfilled) openNotes.delete(noteId);
}

export function noteMatchesReply(
	noteText: string,
	normalizedReply: string,
): boolean {
	const chars = Array.from(normalizeEntityName(noteText));
	if (chars.length < 2) return false;
	if (chars.length < CLUE_FULFILL_NGRAM) {
		return normalizedReply.includes(chars.join(""));
	}
	for (let index = 0; index + CLUE_FULFILL_NGRAM <= chars.length; index += 1) {
		if (
			normalizedReply.includes(
				chars.slice(index, index + CLUE_FULFILL_NGRAM).join(""),
			)
		) {
			return true;
		}
	}
	return false;
}

async function embedFloorVectors(
	store: StoryStore,
	nodeId: string,
	embedder: EmbeddingClient,
): Promise<void> {
	const missing = store.listChunksMissingVectors(nodeId);
	if (missing.length === 0) return;
	const vectors = await embedder.embed(missing.map((chunk) => chunk.text));
	if (vectors.length !== missing.length) {
		throw new Error(
			`embedding 返回 ${vectors.length} 条向量，期望 ${missing.length} 条`,
		);
	}
	store.insertChunkVectors(
		missing.map((chunk, index) => ({
			chunkId: chunk.chunkId,
			embedding: vectors[index] as number[],
		})),
	);
}

function seededPath(
	store: StoryStore,
	mainPathNodeIds: readonly string[],
): TimelineNode[] {
	const nodes: TimelineNode[] = [];
	for (const nodeId of mainPathNodeIds) {
		const node = store.getNode(nodeId);
		if (!node) throw new Error(`主路径楼层不存在：${nodeId}`);
		nodes.push(node);
	}
	return nodes;
}

export interface SelectBranchPointsOptions {
	readonly interval: number;
	readonly rounds: number;
	readonly maxBranchPointsPerStory: number;
}

export function selectBranchPoints(
	path: readonly TimelineNode[],
	options: SelectBranchPointsOptions,
): BranchPoint[] {
	assertPositiveInteger(options.interval, "分支点间隔");
	assertPositiveInteger(options.rounds, "回放轮数");
	assertPositiveInteger(
		options.maxBranchPointsPerStory,
		"每个对话的分支点上限",
	);
	const points: BranchPoint[] = [];
	for (
		let index = options.interval;
		index < path.length && points.length < options.maxBranchPointsPerStory;
		index += options.interval
	) {
		const node = path[index];
		if (node === undefined || node.role !== "assistant") continue;
		const userTexts: string[] = [];
		for (let next = index + 1; next < path.length; next += 1) {
			const candidate = path[next];
			if (candidate === undefined) break;
			if (candidate.role !== "user") continue;
			if (candidate.raw.trim().length === 0) continue;
			userTexts.push(candidate.raw);
			if (userTexts.length >= options.rounds) break;
		}
		if (userTexts.length < options.rounds) continue;
		points.push({
			nodeId: node.id,
			floor: index + 1,
			userTexts,
		});
	}
	return points;
}

export interface BeatCosineMeasurement {
	readonly missingVectorFloors: number;
	readonly values: readonly number[];
	readonly summary: SimilaritySummary;
}

/** 相邻生成楼层的节拍余弦，与 M3-T06 使用同一个楼层向量口径。 */
export function measureBeatCosine(
	store: StoryStore,
	nodeIds: readonly string[],
): BeatCosineMeasurement {
	const vectors: number[][] = [];
	let missingVectorFloors = 0;
	for (const nodeId of nodeIds) {
		const chunks = store.listChunkVectorsForNode(nodeId);
		if (chunks.length === 0) {
			missingVectorFloors += 1;
			continue;
		}
		vectors.push(
			meanVector(
				chunks.map((chunk) => chunk.vector),
				`楼层 ${nodeId}`,
			),
		);
	}
	const values: number[] = [];
	for (let index = 1; index < vectors.length; index += 1) {
		const previous = vectors[index - 1];
		const current = vectors[index];
		if (previous === undefined || current === undefined) {
			throw new Error("节拍向量索引越界");
		}
		values.push(cosineSimilarity(previous, current));
	}
	return { missingVectorFloors, values, summary: summarize(values) };
}

function buildReport(input: {
	readonly runs: readonly MeasuredRun[];
	readonly failures: readonly ReplayFailure[];
	readonly stories: readonly DirectorEvalStoryInfo[];
	readonly settings: ReplaySettings;
	readonly directorConfig: DirectorConfig;
	readonly modelAlias: string;
	readonly embeddingLabel: string;
	readonly structuredOutput: string;
	readonly generatedAt: string;
}): DirectorEvalReport {
	const on = aggregateMode(input.runs, "on");
	const off = aggregateMode(input.runs, "off");
	return {
		generatedAt: input.generatedAt,
		modelAlias: input.modelAlias,
		embeddingLabel: input.embeddingLabel,
		settings: {
			...input.settings,
			director: input.directorConfig,
			structuredOutput: input.structuredOutput,
		},
		stories: input.stories,
		runs: input.runs.map((run) => ({
			story: run.story,
			branchFloor: run.branchFloor,
			mode: run.mode,
			pair: run.pair,
			requestedRounds: run.requestedRounds,
			generatedFloors: run.generatedFloors,
			blockCount: run.blockCount,
			jaccard: run.jaccard,
			cosine: run.cosine,
			missingVectorFloors: run.missingVectorFloors,
			notesCreated: run.notesCreated,
			notesFulfilled: run.notesFulfilled,
			meanFulfillAge: run.meanFulfillAge,
			directorDecisions: run.directorDecisions,
			directorMessages: run.directorMessages,
			mechanismTriggers: run.mechanismTriggers,
			mechanismSelections: run.mechanismSelections,
		})),
		failures: input.failures,
		aggregate: { on, off },
		comparisons: buildComparisons(on, off),
		checks: {
			offHasNoDecisions:
				input.runs.filter((run) => run.mode === "off").length > 0 &&
				input.runs
					.filter((run) => run.mode === "off")
					.every((run) => run.directorDecisions === 0),
			offHasNoDirectorMessages:
				input.runs.filter((run) => run.mode === "off").length > 0 &&
				input.runs
					.filter((run) => run.mode === "off")
					.every((run) => run.directorMessages === 0),
			onTriggersMechanism: input.runs.some(
				(run) =>
					run.mode === "on" &&
					Object.values(run.mechanismTriggers).some((count) => count > 0),
			),
		},
	};
}

function aggregateMode(
	runs: readonly MeasuredRun[],
	mode: ReplayMode,
): ModeAggregate {
	const selected = runs.filter((run) => run.mode === mode);
	const jaccardValues = selected.flatMap((run) => run.jaccardValues);
	const cosineValues = selected.flatMap((run) => run.cosineValues);
	const fulfillAges = selected.flatMap((run) => run.fulfillAges);
	const notesCreated = sum(selected.map((run) => run.notesCreated));
	const notesFulfilled = sum(selected.map((run) => run.notesFulfilled));
	return {
		runs: selected.length,
		generatedFloors: sum(selected.map((run) => run.generatedFloors)),
		blockCount: sum(selected.map((run) => run.blockCount)),
		jaccard: summarize(jaccardValues),
		cosine: summarize(cosineValues),
		notesCreated,
		notesFulfilled,
		fulfillmentRate: notesCreated === 0 ? null : notesFulfilled / notesCreated,
		meanFulfillAge: meanOrNull(fulfillAges),
		directorDecisions: sum(selected.map((run) => run.directorDecisions)),
		directorMessages: sum(selected.map((run) => run.directorMessages)),
		mechanismTriggers: sumRecords(selected.map((run) => run.mechanismTriggers)),
		mechanismSelections: sumRecords(
			selected.map((run) => run.mechanismSelections),
		),
	};
}

function buildComparisons(
	on: ModeAggregate,
	off: ModeAggregate,
): DirectorEvalComparison[] {
	return [
		comparison(
			"相邻块 Jaccard 均值",
			on.jaccard.mean,
			off.jaccard.mean,
			"lower",
		),
		comparison("节拍余弦均值", on.cosine.mean, off.cosine.mean, "lower"),
		comparison("线索兑现率", on.fulfillmentRate, off.fulfillmentRate, "higher"),
		comparison(
			"兑现时平均年龄",
			on.meanFulfillAge,
			off.meanFulfillAge,
			"lower",
		),
	];
}

function comparison(
	label: string,
	on: number | null,
	off: number | null,
	better: "lower" | "higher",
): DirectorEvalComparison {
	if (on === null || off === null) {
		return { label, on, off, better, improved: null };
	}
	return {
		label,
		on,
		off,
		better,
		improved: better === "lower" ? on < off : on > off,
	};
}

function countMechanisms(names: readonly string[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const name of names) counts[name] = (counts[name] ?? 0) + 1;
	return counts;
}

function sumRecords(
	records: readonly Readonly<Record<string, number>>[],
): Record<string, number> {
	const total: Record<string, number> = {};
	for (const record of records) {
		for (const [name, count] of Object.entries(record)) {
			total[name] = (total[name] ?? 0) + count;
		}
	}
	return total;
}

function hasIncludedDirectorMessage(turn: ReplayTurn): boolean {
	const entry = turn.trace.context.entries.find(
		(candidate) => candidate.segmentId === "director",
	);
	return (
		entry !== undefined &&
		entry.status === "included" &&
		entry.source.startsWith("director:")
	);
}

function resolveSettings(options: CollectDirectorEvalOptions): ReplaySettings {
	const interval = options.interval ?? 100;
	const rounds = options.rounds ?? 5;
	const pairs = options.pairs ?? 3;
	const maxBranchPointsPerStory = options.maxBranchPointsPerStory ?? 2;
	assertPositiveInteger(interval, "分支点间隔");
	assertPositiveInteger(rounds, "回放轮数");
	assertPositiveInteger(pairs, "每档运行次数");
	assertPositiveInteger(maxBranchPointsPerStory, "每个对话的分支点上限");
	if (!Number.isInteger(options.budgetTokens) || options.budgetTokens < 1) {
		throw new Error("token 预算必须是正整数");
	}
	return { interval, rounds, pairs, maxBranchPointsPerStory };
}

function assertPositiveInteger(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${label} 必须是正整数`);
	}
}

async function loadStoryCard(
	snapshot: Snapshot,
	character: string,
): Promise<StCharacterCard> {
	const file = snapshot
		.filesByRole("card")
		.find((candidate) => (candidate.character ?? "") === character);
	if (file === undefined) {
		throw new Error(`快照里找不到角色 ${character} 的角色卡`);
	}
	return parseCharacterCardFile(await snapshot.resolveFile(file));
}

async function loadStoryWorlds(
	snapshot: Snapshot,
	character: string,
): Promise<readonly StWorldInfo[]> {
	const files = snapshot
		.filesByRole("worldbook")
		.filter((candidate) => (candidate.character ?? "") === character);
	const worlds: StWorldInfo[] = [];
	for (const file of files) {
		worlds.push(await parseWorldInfoFile(await snapshot.resolveFile(file)));
	}
	return worlds;
}

function countStoryChunks(
	store: StoryStore,
	pathNodes: readonly TimelineNode[],
): number {
	let count = 0;
	for (const node of pathNodes) count += store.countChunksForNode(node.id);
	return count;
}

function countStoryVectors(
	store: StoryStore,
	pathNodes: readonly TimelineNode[],
): number {
	let count = 0;
	for (const node of pathNodes)
		count += store.countChunkVectorsForNode(node.id);
	return count;
}

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function meanOrNull(values: readonly number[]): number | null {
	return values.length === 0 ? null : sum(values) / values.length;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function removeDatabase(filePath: string): Promise<void> {
	await rm(filePath, { force: true });
	await rm(`${filePath}-wal`, { force: true });
	await rm(`${filePath}-shm`, { force: true });
}
