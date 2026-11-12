import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type EmbeddingClient,
	type LlmClient,
	type LlmStreamingClient,
	type RerankClient,
	type RetrievalRoute,
	type StoryStore,
	StoryStore as StoryStoreClass,
	createDefaultContextTemplate,
	createEventExtractionHandler,
	createStandardChatSlots,
	fuseRetrievalRoutes,
	rankMemoryRoutes,
	rerankRetrievalHits,
} from "@dramaticer/core";
import {
	type StCharacterCard,
	parseCharacterCardFile,
} from "../character-card.js";
import { importChatFileToStore } from "../chat-import.js";
import { importCharacterCardEntity } from "../entity-import.js";
import {
	type Snapshot,
	isLegacyCorpus,
	openSnapshot,
} from "../health/manifest.js";
import {
	importCharacterBookLore,
	importWorldInfoLore,
} from "../lore-import.js";
import { parseWorldInfoFile } from "../world-info.js";
import {
	type FusionCrossValidation,
	type FusionWeightStory,
	type QuestionRanking,
	crossValidateFusionWeights,
	rankMemoryQuestions,
} from "./fusion-weights.js";
import {
	type JudgedMemoryQuestionRecord,
	type JudgedMemorySummary,
	runJudgedMemoryQuestions,
	summarizeJudgedMemoryQuestions,
} from "./memory-judged.js";
import {
	memoryQuestionFileName,
	readMemoryQuestionFile,
} from "./memory-questions.js";
import {
	type QuestionKind,
	type RetrievalQuestion,
	readQuestionFile,
	sanitizeFileName,
	storyIdOf,
} from "./question-files.js";
import { addCounts, emptyCounts } from "./shared.js";
import { readStateAnswer } from "./state-questions.js";

const DEPTHS = [5, 10, 20] as const;
const MAX_DEPTH = 20;
const KIND_ORDER: readonly QuestionKind[] = ["state", "event"];
const ROUTE_ORDER: readonly RetrievalRoute[] = [
	"bm25",
	"vector",
	"entity",
	"event",
	"recent",
];
export type MemoryEvalRoute = RetrievalRoute | "fused" | "reranked";
const EVAL_ROUTE_ORDER: readonly MemoryEvalRoute[] = [
	...ROUTE_ORDER,
	"fused",
	"reranked",
];
const SCORE_KEYS = ["questionCount", "hitAt5", "hitAt10", "hitAt20"] as const;

type MutableScore = Record<(typeof SCORE_KEYS)[number], number>;

export interface MemoryEvalScore {
	readonly questionCount: number;
	readonly hitAt5: number;
	readonly hitAt10: number;
	readonly hitAt20: number;
}

export interface MemoryEvalKindScore extends MemoryEvalScore {
	readonly kind: QuestionKind;
}

export interface MemoryEvalRouteScore {
	readonly route: MemoryEvalRoute;
	readonly byKind: readonly MemoryEvalKindScore[];
	readonly total: MemoryEvalScore;
}

export interface MemoryEvalFilterSummary {
	readonly viewpoint: string | null;
	readonly eventsBeforeFilter: number;
	readonly eventsAfterFilter: number;
	readonly queriesWithExcludedChunks: number;
}

/** 状态层指标：提问楼层的快照值是否与题目标准答案一致。 */
export interface MemoryEvalStateAccuracy {
	readonly questionCount: number;
	readonly correct: number;
	/** 快照里取不到该路径的题数；这些题不计入正确。 */
	readonly missing: number;
}

/** 事件表覆盖：有事件的已确认助手楼层占全部已确认助手楼层的比例。 */
export interface MemoryEvalEventCoverage {
	readonly assistantFloors: number;
	readonly floorsWithEvents: number;
}

export interface MemoryEvalStoryScore {
	readonly story: string;
	readonly floorCount: number;
	readonly chunkCount: number;
	readonly vectorCount: number;
	readonly entityCount: number;
	readonly eventCount: number;
	readonly eventCoverage: MemoryEvalEventCoverage;
	readonly byKind: readonly MemoryEvalKindScore[];
	readonly routes: readonly MemoryEvalRouteScore[];
	readonly total: MemoryEvalScore;
	readonly filter: MemoryEvalFilterSummary;
	readonly stateAccuracy: MemoryEvalStateAccuracy;
}

export interface MemoryEvalThreshold {
	readonly label: string;
	/** 分对话门槛指向的故事；合计门槛为 null */
	readonly story: string | null;
	readonly questionCount: number;
	readonly hits: number;
	readonly baselineHits: number | null;
	readonly targetRatio: number;
	readonly passed: boolean;
}

export interface MemoryEvalReport {
	readonly generatedAt: string;
	readonly embeddingLabel: string | null;
	readonly eventsBuilt: boolean;
	readonly stories: readonly MemoryEvalStoryScore[];
	readonly byKind: readonly MemoryEvalKindScore[];
	readonly routes: readonly MemoryEvalRouteScore[];
	readonly total: MemoryEvalScore;
	readonly filter: MemoryEvalFilterSummary;
	readonly stateAccuracy: MemoryEvalStateAccuracy;
	readonly thresholds: readonly MemoryEvalThreshold[];
	/** 没有运行五类记忆题时为 null。 */
	readonly judged: JudgedMemorySummary | null;
	/** 少于两个对话时不做留一交叉验证。 */
	readonly fusionWeights: FusionCrossValidation | null;
}

export interface EvaluateMemoryQuestionsOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly questions: readonly RetrievalQuestion[];
	readonly embedder?: EmbeddingClient | null;
	readonly viewpoint?: string | null;
	/** 设置后把融合候选交给它重排，并单独记一路 `reranked`。 */
	readonly reranker?: RerankClient | null;
}

export interface BuildVectorsOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly embedder: EmbeddingClient;
	/** 每批写入的块数；缓存客户端还会再按自己的分块落盘 */
	readonly batchSize?: number;
	readonly onProgress?: (progress: {
		readonly done: number;
		readonly total: number;
	}) => void;
}

export interface BuildEventsOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly client: LlmStreamingClient;
	readonly onProgress?: (progress: {
		readonly done: number;
		readonly total: number;
		readonly events: number;
	}) => void;
}

export interface JudgedMemoryEvalOptions {
	readonly answer: { readonly client: LlmClient; readonly model: string };
	readonly judge: {
		readonly client: LlmClient;
		readonly model: string;
		readonly maxTokens?: number;
	};
	readonly budgetTokens?: number;
	readonly maxTokens?: number;
	readonly temperature?: number;
}

export interface CollectMemoryEvalOptions {
	readonly rawRoot: string;
	readonly evalsetRoot: string;
	readonly dbPath: string;
	readonly embedder?: EmbeddingClient | null;
	readonly embeddingLabel?: string | null;
	/** 设置后为已确认的主路径楼层抽取事件；不设置时事件路为空 */
	readonly eventClient?: LlmStreamingClient | null;
	/** 设置后读取 `memory-<故事>.jsonl`，用裁判判分五类记忆题 */
	readonly judged?: JudgedMemoryEvalOptions | null;
	/** 设置后额外评测融合结果的重排序。 */
	readonly reranker?: RerankClient | null;
	readonly viewpoint?: string | null;
	readonly generatedAt?: string;
	readonly log?: (message: string) => void;
}

interface MutableStory {
	readonly total: MutableScore;
	readonly byKind: Map<QuestionKind, MutableScore>;
	readonly routes: Map<
		MemoryEvalRoute,
		{ total: MutableScore; byKind: Map<QuestionKind, MutableScore> }
	>;
	eventsBeforeFilter: number;
	eventsAfterFilter: number;
	queriesWithExcludedChunks: number;
}

/**
 * 对一组题目运行多路记忆检索。每一路按自己的原始名次计命中，
 * 融合结果按 RRF 名次计命中；路缺失时该路记 0 命中，题数保持一致。
 */
export async function evaluateMemoryQuestions(
	options: EvaluateMemoryQuestionsOptions,
): Promise<MemoryEvalStoryScore> {
	const { store, storyId } = options;
	if (!store.getStory(storyId)) {
		throw new Error(`故事不存在：${storyId}`);
	}
	if (options.questions.length === 0) {
		throw new Error(`故事 ${storyId} 没有题目`);
	}
	const viewpoint = options.viewpoint ?? null;
	if (options.embedder) {
		// 先一次性嵌入全部题目，让缓存客户端按批量请求渠道；
		// 单题检索时同一段文本直接命中缓存。
		await options.embedder.embed(
			options.questions.map((question) => question.question),
		);
	}
	const story: MutableStory = {
		total: emptyCounts(SCORE_KEYS),
		byKind: new Map(),
		routes: new Map(),
		eventsBeforeFilter: 0,
		eventsAfterFilter: 0,
		queriesWithExcludedChunks: 0,
	};

	for (const question of options.questions) {
		if (question.story !== storyId) {
			throw new Error(
				`题目 ${question.id} 属于故事 ${question.story}，与 ${storyId} 不一致`,
			);
		}
		for (const evidence of question.evidenceNodes) {
			if (!store.getNode(evidence)) {
				throw new Error(`题目 ${question.id} 的证据楼层不存在：${evidence}`);
			}
		}
		const rankings = await rankMemoryRoutes({
			store,
			embedder: options.embedder ?? null,
			storyId,
			query: question.question,
			beforeNodeId: question.askAtNode,
			viewpoint,
			limit: MAX_DEPTH,
		});
		const evidence = new Set(question.evidenceNodes);
		const routeItems = new Map(
			rankings.routes.map((ranking) => [ranking.route, ranking.items]),
		);
		for (const route of ROUTE_ORDER) {
			const items = routeItems.get(route) ?? [];
			recordHits(
				routeScore(story, route).total,
				kindScore(routeScore(story, route).byKind, question.kind),
				hitVector(
					items.map((item) => item.nodeId),
					evidence,
				),
			);
		}
		const fused = fuseRetrievalRoutes(rankings.routes);
		const fusedNodeIds = fused.slice(0, MAX_DEPTH).map((hit) => hit.nodeId);
		recordHits(
			routeScore(story, "fused").total,
			kindScore(routeScore(story, "fused").byKind, question.kind),
			hitVector(fusedNodeIds, evidence),
		);
		recordHits(
			story.total,
			kindScore(story.byKind, question.kind),
			hitVector(fusedNodeIds, evidence),
		);
		if (options.reranker) {
			const reranked = (
				await rerankRetrievalHits({
					store,
					query: question.question,
					hits: fused,
					reranker: options.reranker,
				})
			)
				.slice(0, MAX_DEPTH)
				.map((hit) => hit.nodeId);
			recordHits(
				routeScore(story, "reranked").total,
				kindScore(routeScore(story, "reranked").byKind, question.kind),
				hitVector(reranked, evidence),
			);
		}
		story.eventsBeforeFilter += rankings.filter.eventsBeforeFilter;
		story.eventsAfterFilter += rankings.filter.eventsAfterFilter;
		if (rankings.filter.chunksExcluded) {
			story.queriesWithExcludedChunks += 1;
		}
	}

	const pathRoutes: MemoryEvalRouteScore[] = ROUTE_ORDER.map((route) => {
		const score = routeScore(story, route);
		return {
			route,
			byKind: renderKindScores(score.byKind),
			total: { ...score.total },
		};
	});
	pathRoutes.push({
		route: "fused",
		byKind: renderKindScores(routeScore(story, "fused").byKind),
		total: { ...routeScore(story, "fused").total },
	});
	if (story.routes.has("reranked")) {
		pathRoutes.push({
			route: "reranked",
			byKind: renderKindScores(routeScore(story, "reranked").byKind),
			total: { ...routeScore(story, "reranked").total },
		});
	}
	return {
		story: storyId,
		floorCount: store.getPathToHead(storyId).length,
		chunkCount: countStoryChunks(store, storyId),
		vectorCount: countStoryVectors(store, storyId),
		entityCount: store.listEntities(storyId).length,
		eventCount: countStoryEvents(store, storyId),
		eventCoverage: measureEventCoverage(store, storyId),
		byKind: renderKindScores(story.byKind),
		routes: pathRoutes,
		total: { ...story.total },
		filter: {
			viewpoint,
			eventsBeforeFilter: story.eventsBeforeFilter,
			eventsAfterFilter: story.eventsAfterFilter,
			queriesWithExcludedChunks: story.queriesWithExcludedChunks,
		},
		stateAccuracy: measureStateAccuracy(store, options.questions),
	};
}

/**
 * 状态层指标独立于文本检索：读取提问楼层的累计状态快照，
 * 按题目路径取值并与标准答案比较。快照由状态层直接注入，
 * 因此这个数字反映状态链路的正确性，不是检索成绩。
 */
function measureStateAccuracy(
	store: StoryStore,
	questions: readonly RetrievalQuestion[],
): MemoryEvalStateAccuracy {
	let questionCount = 0;
	let correct = 0;
	let missing = 0;
	for (const question of questions) {
		if (question.kind !== "state") continue;
		const parts = question.path;
		if (parts === undefined) {
			throw new Error(`状态题 ${question.id} 缺少 path`);
		}
		questionCount += 1;
		const snapshot = store.getStateSnapshot(question.askAtNode);
		const answer = readStateAnswer(snapshot.state, parts);
		if (answer === undefined) {
			missing += 1;
			continue;
		}
		if (String(answer) === question.answer) correct += 1;
	}
	return { questionCount, correct, missing };
}

/** 为祖先路径上的块生成向量；已经写入向量的块不会重复调用。 */
export async function buildStoryVectors(
	options: BuildVectorsOptions,
): Promise<{ readonly chunkCount: number; readonly vectorCount: number }> {
	const { store, storyId, embedder } = options;
	const batchSize = options.batchSize ?? 128;
	if (batchSize < 1) throw new Error("向量写入批量必须是不小于 1 的整数");
	const missing: { chunkId: number; text: string }[] = [];
	for (const node of store.getPathToHead(storyId)) {
		missing.push(...store.listChunksMissingVectors(node.id));
	}
	let done = 0;
	for (let start = 0; start < missing.length; start += batchSize) {
		const batch = missing.slice(start, start + batchSize);
		const vectors = await embedder.embed(batch.map((chunk) => chunk.text));
		if (vectors.length !== batch.length) {
			throw new Error(
				`embedding 返回 ${vectors.length} 条向量，期望 ${batch.length} 条`,
			);
		}
		store.insertChunkVectors(
			batch.map((chunk, index) => ({
				chunkId: chunk.chunkId,
				embedding: vectors[index] as number[],
			})),
		);
		done += batch.length;
		options.onProgress?.({ done, total: missing.length });
	}
	return {
		chunkCount: countStoryChunks(store, storyId),
		vectorCount: countStoryVectors(store, storyId),
	};
}

/**
 * 用生产的事件抽取处理器给主路径上的已确认助手楼层建事件。
 * 模型调用的磁盘缓存由注入的客户端负责，重复运行不会重复请求。
 */
export async function buildStoryEvents(
	options: BuildEventsOptions,
): Promise<{ readonly nodeCount: number; readonly eventCount: number }> {
	const { store, storyId, client } = options;
	const handler = createEventExtractionHandler();
	const targets = store
		.getPathToHead(storyId)
		.filter(
			(node) => node.role === "assistant" && store.isNodeConfirmed(node.id),
		);
	let done = 0;
	let events = 0;
	for (const node of targets) {
		const extracted = new Set(store.listExtractedEventNodeIds(storyId));
		if (!extracted.has(node.id)) {
			let lastError: unknown = null;
			for (let attempt = 1; attempt <= 3; attempt += 1) {
				try {
					await handler({
						store,
						client,
						job: {
							id: 0,
							storyId,
							nodeId: node.id,
							kind: "events",
							status: "running",
							attempts: attempt,
							lastError: null,
							createdAt: node.createdAt,
							startedAt: null,
							finishedAt: null,
						},
					});
					lastError = null;
					break;
				} catch (error) {
					lastError = error;
				}
			}
			if (lastError !== null) {
				throw new Error(`楼层 ${node.id} 的事件抽取连续失败 3 次`, {
					cause: lastError,
				});
			}
		}
		events += store.countEventsForNode(node.id);
		done += 1;
		options.onProgress?.({ done, total: targets.length, events });
	}
	return { nodeCount: targets.length, eventCount: events };
}

/**
 * 导入 3 个对话、实体、向量（可选事件），然后用 `retrieveMemory`
 * 的候选收集与融合逻辑对题目打分。
 */
export async function collectMemoryEval(
	options: CollectMemoryEvalOptions,
): Promise<MemoryEvalReport> {
	const log = options.log ?? (() => undefined);
	if (existsSync(options.dbPath)) {
		await rm(options.dbPath, { force: true });
	}
	await mkdir(path.dirname(options.dbPath), { recursive: true });
	const snapshot = await openSnapshot(options.rawRoot);
	const chatFiles = snapshot.filesByRole("chat").filter(isLegacyCorpus);
	if (chatFiles.length === 0) throw new Error("manifest 里没有 chat");
	const storyFiles = chatFiles.map((file) => ({
		file,
		story: storyIdOf(file),
	}));
	const dimensions = options.embedder?.dimensions;
	const store = StoryStoreClass.open(
		options.dbPath,
		dimensions === undefined ? {} : { embeddingDimensions: dimensions },
	);
	try {
		const stories: MemoryEvalStoryScore[] = [];
		const judgedRecords: JudgedMemoryQuestionRecord[] = [];
		const fusionStories: FusionWeightStory[] = [];
		for (const entry of storyFiles) {
			log(`导入 ${entry.story}`);
			const chatPath = await snapshot.resolveFile(entry.file);
			await importChatFileToStore(store, chatPath, {
				storyId: entry.story,
			});
			await importStoryEntities(
				store,
				entry.story,
				snapshot,
				entry.file.character ?? entry.story,
			);
			if (options.embedder) {
				log(`生成 ${entry.story} 的块向量`);
				await buildStoryVectors({
					store,
					storyId: entry.story,
					embedder: options.embedder,
					onProgress: (progress) => {
						if (
							progress.done % 1024 === 0 ||
							progress.done === progress.total
						) {
							log(`${entry.story} 向量 ${progress.done}/${progress.total}`);
						}
					},
				});
			}
			if (options.eventClient) {
				log(`抽取 ${entry.story} 的事件`);
				await buildStoryEvents({
					store,
					storyId: entry.story,
					client: options.eventClient,
					onProgress: (progress) => {
						if (progress.done % 50 === 0 || progress.done === progress.total) {
							log(
								`${entry.story} 事件 ${progress.done}/${progress.total}，累计 ${progress.events} 条`,
							);
						}
					},
				});
			}
			const questions = await readStoryQuestions(
				options.evalsetRoot,
				entry.story,
			);
			log(`评测 ${entry.story}：${questions.length} 道题`);
			const rankings = await rankMemoryQuestions({
				store,
				storyId: entry.story,
				questions,
				embedder: options.embedder ?? null,
				viewpoint: options.viewpoint ?? null,
			});
			fusionStories.push({ story: entry.story, rankings });
			stories.push(
				await evaluateMemoryQuestions({
					store,
					storyId: entry.story,
					questions,
					embedder: options.embedder ?? null,
					viewpoint: options.viewpoint ?? null,
					reranker: options.reranker ?? null,
				}),
			);
			if (options.judged) {
				const memoryPath = path.join(
					options.evalsetRoot,
					memoryQuestionFileName(entry.story),
				);
				if (!existsSync(memoryPath)) {
					log(`五类记忆题：${entry.story} 没有 ${memoryPath}，跳过`);
					continue;
				}
				const memoryQuestions = await readMemoryQuestionFile(memoryPath);
				log(
					`五类记忆题 ${entry.story}：${memoryQuestions.length} 道，开始判分`,
				);
				const settings = store.getStorySettings(entry.story);
				const template = createDefaultContextTemplate({
					structuredOutput: "text-tags",
				});
				const providers = (
					await createStandardChatSlots({
						store,
						characterPrompt: settings.characterPrompt,
						directorConfig: DEFAULT_DIRECTOR_CONFIG,
					})
				).providers;
				judgedRecords.push(
					...(await runJudgedMemoryQuestions({
						store,
						storyId: entry.story,
						questions: memoryQuestions,
						template,
						providers,
						budgetTokens: options.judged.budgetTokens ?? 12_000,
						assistant: options.judged.answer,
						judge: options.judged.judge,
						maxTokens: options.judged.maxTokens,
						temperature: options.judged.temperature,
					})),
				);
			}
		}
		return buildReport({
			stories,
			embeddingLabel: options.embeddingLabel ?? null,
			eventsBuilt:
				options.eventClient !== null && options.eventClient !== undefined,
			generatedAt: options.generatedAt ?? new Date().toISOString(),
			judged:
				judgedRecords.length === 0
					? null
					: summarizeJudgedMemoryQuestions(judgedRecords),
			fusionWeights: crossValidateFusionWeights(fusionStories),
		});
	} finally {
		store.close();
	}
}

async function readStoryQuestions(
	evalsetRoot: string,
	story: string,
): Promise<RetrievalQuestion[]> {
	const baseName = sanitizeFileName(story);
	const questions: RetrievalQuestion[] = [];
	for (const kind of KIND_ORDER) {
		const filePath = path.join(evalsetRoot, `${kind}-${baseName}.jsonl`);
		if (!existsSync(filePath)) {
			if (kind === "state") {
				throw new Error(`缺少状态题文件：${filePath}`);
			}
			continue;
		}
		questions.push(...(await readQuestionFile(filePath, kind)));
	}
	return questions;
}

/** 导入对话对应的角色卡实体、角色书 lore 与世界书 lore；没有对应文件时跳过。 */
export async function importStoryEntities(
	store: StoryStore,
	storyId: string,
	snapshot: Snapshot,
	character: string,
): Promise<void> {
	const cardFile = snapshot
		.filesByRole("card")
		.find((file) => (file.character ?? "") === character);
	if (cardFile) {
		const card: StCharacterCard = await parseCharacterCardFile(
			await snapshot.resolveFile(cardFile),
		);
		importCharacterCardEntity(store, storyId, card);
		if (card.characterBook !== null) {
			importCharacterBookLore(store, storyId, card.characterBook, card.name);
		}
	}
	const worldFile = snapshot
		.filesByRole("worldbook")
		.find((file) => (file.character ?? "") === character);
	if (worldFile) {
		const worldInfo = await parseWorldInfoFile(
			await snapshot.resolveFile(worldFile),
		);
		importWorldInfoLore(store, storyId, worldInfo);
	}
}

function buildReport(input: {
	readonly stories: readonly MemoryEvalStoryScore[];
	readonly embeddingLabel: string | null;
	readonly eventsBuilt: boolean;
	readonly generatedAt: string;
	readonly judged: JudgedMemorySummary | null;
	readonly fusionWeights: FusionCrossValidation | null;
}): MemoryEvalReport {
	const total = emptyCounts(SCORE_KEYS);
	const byKind = new Map<QuestionKind, MutableScore>();
	const routes = new Map<
		MemoryEvalRoute,
		{ total: MutableScore; byKind: Map<QuestionKind, MutableScore> }
	>();
	for (const story of input.stories) {
		addCounts(total, story.total);
		for (const score of story.byKind) {
			addCounts<keyof MemoryEvalScore>(kindScore(byKind, score.kind), score);
		}
		for (const route of story.routes) {
			let score = routes.get(route.route);
			if (!score) {
				score = { total: emptyCounts(SCORE_KEYS), byKind: new Map() };
				routes.set(route.route, score);
			}
			addCounts(score.total, route.total);
			for (const kind of route.byKind) {
				addCounts<keyof MemoryEvalScore>(
					kindScore(score.byKind, kind.kind),
					kind,
				);
			}
		}
	}
	const filter = input.stories.reduce(
		(accumulator, story) => ({
			viewpoint: story.filter.viewpoint,
			eventsBeforeFilter:
				accumulator.eventsBeforeFilter + story.filter.eventsBeforeFilter,
			eventsAfterFilter:
				accumulator.eventsAfterFilter + story.filter.eventsAfterFilter,
			queriesWithExcludedChunks:
				accumulator.queriesWithExcludedChunks +
				story.filter.queriesWithExcludedChunks,
		}),
		{
			viewpoint: null as string | null,
			eventsBeforeFilter: 0,
			eventsAfterFilter: 0,
			queriesWithExcludedChunks: 0,
		},
	);
	const stateAccuracy = input.stories.reduce<MemoryEvalStateAccuracy>(
		(accumulator, story) => ({
			questionCount:
				accumulator.questionCount + story.stateAccuracy.questionCount,
			correct: accumulator.correct + story.stateAccuracy.correct,
			missing: accumulator.missing + story.stateAccuracy.missing,
		}),
		{ questionCount: 0, correct: 0, missing: 0 },
	);
	const routeScores: MemoryEvalRouteScore[] = [];
	for (const route of EVAL_ROUTE_ORDER) {
		const score = routes.get(route);
		if (!score) continue;
		routeScores.push({
			route,
			byKind: renderKindScores(score.byKind),
			total: { ...score.total },
		});
	}
	return {
		generatedAt: input.generatedAt,
		embeddingLabel: input.embeddingLabel,
		eventsBuilt: input.eventsBuilt,
		stories: input.stories,
		byKind: renderKindScores(byKind),
		routes: routeScores,
		total: { ...total },
		filter,
		stateAccuracy,
		thresholds: checkThresholds(input.stories),
		judged: input.judged,
		fusionWeights: input.fusionWeights,
	};
}

function checkThresholds(
	stories: readonly MemoryEvalStoryScore[],
): MemoryEvalThreshold[] {
	const thresholds: MemoryEvalThreshold[] = [];
	for (const [kind, depthKey, target] of [
		["state", "hitAt20", 0.45],
		["event", "hitAt5", 0.88],
		["event", "hitAt20", 0.97],
	] as const) {
		let hits = 0;
		let count = 0;
		let baselineHits = 0;
		for (const story of stories) {
			const fused = story.routes
				.find((route) => route.route === "fused")
				?.byKind.find((entry) => entry.kind === kind);
			const bm25 = story.routes
				.find((route) => route.route === "bm25")
				?.byKind.find((entry) => entry.kind === kind);
			if (!fused || !bm25) continue;
			hits += fused[depthKey];
			baselineHits += bm25[depthKey];
			count += fused.questionCount;
		}
		thresholds.push({
			label: `${kindLabel(kind)} 融合${depthLabel(depthKey)}`,
			story: null,
			questionCount: count,
			hits,
			baselineHits,
			targetRatio: target,
			passed: count > 0 && hits / count >= target,
		});
	}
	for (const story of stories) {
		for (const [kind, depthKey] of [
			["state", "hitAt20"],
			["event", "hitAt5"],
			["event", "hitAt20"],
		] as const) {
			const fused = story.routes
				.find((route) => route.route === "fused")
				?.byKind.find((entry) => entry.kind === kind);
			const bm25 = story.routes
				.find((route) => route.route === "bm25")
				?.byKind.find((entry) => entry.kind === kind);
			if (!fused || !bm25 || fused.questionCount === 0) continue;
			thresholds.push({
				label: `${kindLabel(kind)} 融合${depthLabel(depthKey)} 不低于 BM25 基线减 2 个百分点`,
				story: story.story,
				questionCount: fused.questionCount,
				hits: fused[depthKey],
				baselineHits: bm25[depthKey],
				targetRatio: bm25[depthKey] / fused.questionCount - 0.02,
				passed:
					fused[depthKey] / fused.questionCount >=
					bm25[depthKey] / fused.questionCount - 0.02,
			});
		}
	}
	return thresholds;
}

function hitVector(
	nodeIds: readonly string[],
	evidence: ReadonlySet<string>,
): boolean[] {
	return DEPTHS.map((depth) =>
		nodeIds.slice(0, depth).some((nodeId) => evidence.has(nodeId)),
	);
}

function recordHits(
	total: MutableScore,
	kind: MutableScore,
	hits: readonly boolean[],
): void {
	for (const score of [total, kind]) {
		score.questionCount += 1;
		if (hits[0]) score.hitAt5 += 1;
		if (hits[1]) score.hitAt10 += 1;
		if (hits[2]) score.hitAt20 += 1;
	}
}

function kindScore(
	byKind: Map<QuestionKind, MutableScore>,
	kind: QuestionKind,
): MutableScore {
	let score = byKind.get(kind);
	if (!score) {
		score = emptyCounts(SCORE_KEYS);
		byKind.set(kind, score);
	}
	return score;
}

function routeScore(
	story: MutableStory,
	route: MemoryEvalRoute,
): { total: MutableScore; byKind: Map<QuestionKind, MutableScore> } {
	let score = story.routes.get(route);
	if (!score) {
		score = { total: emptyCounts(SCORE_KEYS), byKind: new Map() };
		story.routes.set(route, score);
	}
	return score;
}

function renderKindScores(
	byKind: Map<QuestionKind, MutableScore>,
): MemoryEvalKindScore[] {
	const scores: MemoryEvalKindScore[] = [];
	for (const kind of KIND_ORDER) {
		const score = byKind.get(kind);
		if (score) scores.push({ kind, ...score });
	}
	return scores;
}

/** 故事主路径上的块数（含没有向量的块）。 */
export function countStoryChunks(store: StoryStore, storyId: string): number {
	let count = 0;
	for (const node of store.getPathToHead(storyId)) {
		count += store.countChunksForNode(node.id);
	}
	return count;
}

/** 故事主路径上已写入向量的块数。 */
export function countStoryVectors(store: StoryStore, storyId: string): number {
	let count = 0;
	for (const node of store.getPathToHead(storyId)) {
		count += store.countChunkVectorsForNode(node.id);
	}
	return count;
}

/** 主路径上已确认助手楼层里有多少个至少有一条事件。 */
export function measureEventCoverage(
	store: StoryStore,
	storyId: string,
): MemoryEvalEventCoverage {
	const assistantFloors = store
		.getPathToHead(storyId)
		.filter(
			(node) => node.role === "assistant" && store.isNodeConfirmed(node.id),
		);
	return {
		assistantFloors: assistantFloors.length,
		floorsWithEvents: assistantFloors.filter(
			(node) => store.countEventsForNode(node.id) > 0,
		).length,
	};
}

/** 故事主路径上的事件数。 */
export function countStoryEvents(store: StoryStore, storyId: string): number {
	const head = store.getHead(storyId);
	if (!head) return 0;
	let count = 0;
	for (;;) {
		const page = store.getEventsForPath(head.id, {
			limit: 1_000,
			offset: count,
		});
		count += page.length;
		if (page.length < 1_000) return count;
	}
}

export function kindLabel(kind: QuestionKind): string {
	return kind === "state" ? "状态题" : "事件题";
}

/** `hitAt20` → `@20` */
export function depthLabel(key: (typeof SCORE_KEYS)[number]): string {
	return key === "hitAt5" ? "@5" : key === "hitAt10" ? "@10" : "@20";
}
