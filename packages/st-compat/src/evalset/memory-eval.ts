import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
	type EmbeddingClient,
	type LlmStreamingClient,
	type RetrievalRoute,
	type StoryStore,
	StoryStore as StoryStoreClass,
	createEventExtractionHandler,
	fuseRetrievalRoutes,
	rankMemoryRoutes,
} from "@dramaticer/core";
import {
	type StCharacterCard,
	parseCharacterCardFile,
} from "../character-card.js";
import { importChatFileToStore } from "../chat-import.js";
import { importCharacterCardEntity } from "../entity-import.js";
import { type Snapshot, openSnapshot } from "../health/manifest.js";
import {
	importCharacterBookLore,
	importWorldInfoLore,
} from "../lore-import.js";
import { parseWorldInfoFile } from "../world-info.js";
import {
	type QuestionKind,
	type RetrievalQuestion,
	readQuestionFile,
	sanitizeFileName,
	storyIdOf,
} from "./question-files.js";
import { addCounts, emptyCounts } from "./shared.js";

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
export type MemoryEvalRoute = RetrievalRoute | "fused";
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

export interface MemoryEvalStoryScore {
	readonly story: string;
	readonly floorCount: number;
	readonly chunkCount: number;
	readonly vectorCount: number;
	readonly entityCount: number;
	readonly eventCount: number;
	readonly byKind: readonly MemoryEvalKindScore[];
	readonly routes: readonly MemoryEvalRouteScore[];
	readonly total: MemoryEvalScore;
	readonly filter: MemoryEvalFilterSummary;
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
	readonly thresholds: readonly MemoryEvalThreshold[];
}

export interface EvaluateMemoryQuestionsOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly questions: readonly RetrievalQuestion[];
	readonly embedder?: EmbeddingClient | null;
	readonly viewpoint?: string | null;
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

export interface CollectMemoryEvalOptions {
	readonly rawRoot: string;
	readonly evalsetRoot: string;
	readonly dbPath: string;
	readonly embedder?: EmbeddingClient | null;
	readonly embeddingLabel?: string | null;
	/** 设置后为已确认的主路径楼层抽取事件；不设置时事件路为空 */
	readonly eventClient?: LlmStreamingClient | null;
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
		const fused = fuseRetrievalRoutes(rankings.routes).slice(0, MAX_DEPTH);
		recordHits(
			routeScore(story, "fused").total,
			kindScore(routeScore(story, "fused").byKind, question.kind),
			hitVector(
				fused.map((hit) => hit.nodeId),
				evidence,
			),
		);
		recordHits(
			story.total,
			kindScore(story.byKind, question.kind),
			hitVector(
				fused.map((hit) => hit.nodeId),
				evidence,
			),
		);
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
	return {
		story: storyId,
		floorCount: store.getPathToHead(storyId).length,
		chunkCount: countStoryChunks(store, storyId),
		vectorCount: countStoryVectors(store, storyId),
		entityCount: store.listEntities(storyId).length,
		eventCount: countStoryEvents(store, storyId),
		byKind: renderKindScores(story.byKind),
		routes: pathRoutes,
		total: { ...story.total },
		filter: {
			viewpoint,
			eventsBeforeFilter: story.eventsBeforeFilter,
			eventsAfterFilter: story.eventsAfterFilter,
			queriesWithExcludedChunks: story.queriesWithExcludedChunks,
		},
	};
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
 * 用生产的事件抽取处理器给主路径上的已确认楼层建事件。
 * 模型调用的磁盘缓存由注入的客户端负责，重复运行不会重复请求。
 */
export async function buildStoryEvents(
	options: BuildEventsOptions,
): Promise<{ readonly nodeCount: number; readonly eventCount: number }> {
	const { store, storyId, client } = options;
	const handler = createEventExtractionHandler();
	const pathNodes = store.getPathToHead(storyId);
	const targets = pathNodes.slice(0, Math.max(0, pathNodes.length - 1));
	let done = 0;
	let events = 0;
	for (const node of targets) {
		if (store.countEventsForNode(node.id) === 0) {
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
	const chatFiles = snapshot.filesByRole("chat");
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
			stories.push(
				await evaluateMemoryQuestions({
					store,
					storyId: entry.story,
					questions,
					embedder: options.embedder ?? null,
					viewpoint: options.viewpoint ?? null,
				}),
			);
		}
		return buildReport({
			stories,
			embeddingLabel: options.embeddingLabel ?? null,
			eventsBuilt:
				options.eventClient !== null && options.eventClient !== undefined,
			generatedAt: options.generatedAt ?? new Date().toISOString(),
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

async function importStoryEntities(
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
	const routeScores: MemoryEvalRouteScore[] = [];
	for (const route of [...ROUTE_ORDER, "fused"] as MemoryEvalRoute[]) {
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
		thresholds: checkThresholds(input.stories),
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

function countStoryChunks(store: StoryStore, storyId: string): number {
	let count = 0;
	for (const node of store.getPathToHead(storyId)) {
		count += store.countChunksForNode(node.id);
	}
	return count;
}

function countStoryVectors(store: StoryStore, storyId: string): number {
	let count = 0;
	for (const node of store.getPathToHead(storyId)) {
		count += store.countChunkVectorsForNode(node.id);
	}
	return count;
}

function countStoryEvents(store: StoryStore, storyId: string): number {
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
