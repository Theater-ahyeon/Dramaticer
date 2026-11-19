import { type Entity, normalizeEntityName } from "../entity.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import type { RerankClient } from "../llm/rerank.js";
import { MAX_MEMORY_EVENT_LIMIT, type MemoryEvent } from "../memory/event.js";
import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";
import { normalizeRetrievalText } from "./chunk-index.js";

export type RetrievalKind = "chunk" | "event";

/** 参与排名融合的每一路。 */
export type RetrievalRoute = "bm25" | "vector" | "entity" | "event" | "recent";

/** 每一路在 RRF 融合里的权重；没有写出的路按 1 计算。 */
export type RetrievalRouteWeights = Partial<Record<RetrievalRoute, number>>;

/** 生产默认权重；来自 R1-T04.b 三对话留一交叉验证，见 ADR-0084。 */
export const DEFAULT_ROUTE_WEIGHTS: Readonly<Record<RetrievalRoute, number>> = {
	bm25: 2,
	vector: 1,
	entity: 0.5,
	event: 0.5,
	recent: 1,
};

export interface RetrievalSource {
	readonly route: RetrievalRoute;
	readonly rank: number;
}

export interface RetrievalHit {
	readonly kind: RetrievalKind;
	readonly nodeId: string;
	readonly score: number;
	/** 父段在楼层内的序号；事件与旧分块为 null。 */
	readonly parentOrdinal: number | null;
	/** 命中父段的文本；事件与旧分块为 null。 */
	readonly parentText: string | null;
	/** 命中来自哪些路，以及在该路上的名次（从 1 开始） */
	readonly sources: readonly RetrievalSource[];
}

export interface RetrieveMemoryOptions {
	readonly store: StoryStore;
	/** 没有 embedding 客户端时跳过向量路，其余路照常工作 */
	readonly embedder?: EmbeddingClient | null;
	readonly storyId: string;
	/** 空查询返回重要事件与最近块 */
	readonly query?: string | null;
	/** 只检索该楼层的祖先路径，不含该楼层自身 */
	readonly beforeNodeId?: string | null;
	/** 知情者过滤的视角；为空时返回全知结果 */
	readonly viewpoint?: string | null;
	/** 在场者等不在查询文本里的名字，同样驱动实体这一路。 */
	readonly entityNames?: readonly string[];
	readonly limit?: number;
	/** 融合后的可选重排序；为空时直接用融合顺序。 */
	readonly reranker?: RerankClient | null;
	/** 交给重排序的候选条数，默认 20。 */
	readonly rerankCandidates?: number;
}

/** 知情者过滤的统计，供 Trace 观察过滤量。 */
export interface RetrievalFilterSummary {
	/** null 表示全知视图 */
	readonly viewpoint: string | null;
	/** 知情者过滤前沿路径读取到的事件数 */
	readonly eventsBeforeFilter: number;
	/** 通过知情者过滤的事件数 */
	readonly eventsAfterFilter: number;
	/** 视角存在时原文块一律不注入 */
	readonly chunksExcluded: boolean;
}

export interface RetrievalResult {
	readonly hits: readonly RetrievalHit[];
	readonly filter: RetrievalFilterSummary;
	/** 每一路的原始名次，供 Trace 与排障命令单独观察。 */
	readonly routes: readonly RetrievalRouteRanking[];
}

/** 一路检索的原始名次，供评测与 Trace 单独观察每一路。 */
export interface RetrievalRouteItem {
	readonly kind: RetrievalKind;
	readonly nodeId: string;
	/** 父段的序号与文本；事件、新近度与旧分块为 null。 */
	readonly parentOrdinal?: number | null;
	readonly parentText?: string | null;
}

export interface RetrievalRouteRanking {
	readonly route: RetrievalRoute;
	readonly items: readonly RetrievalRouteItem[];
}

export interface MemoryRouteRankings {
	readonly routes: readonly RetrievalRouteRanking[];
	readonly filter: RetrievalFilterSummary;
}

const DEFAULT_RETRIEVAL_LIMIT = 8;
const MAX_RETRIEVAL_LIMIT = 50;
/** 融合后交给重排序的默认候选条数。 */
export const DEFAULT_RERANK_CANDIDATES = 20;
export const MAX_RERANK_CANDIDATES = 200;
const RRF_K = 60;
const VECTOR_CANDIDATE_FACTOR = 4;
const ROUTE_ORDER: readonly RetrievalRoute[] = [
	"bm25",
	"vector",
	"entity",
	"event",
	"recent",
];

interface RouteItem {
	readonly kind: RetrievalKind;
	readonly nodeId: string;
	readonly parentOrdinal?: number | null;
	readonly parentText?: string | null;
}

interface RouteResult {
	readonly route: RetrievalRoute;
	readonly items: readonly RouteItem[];
}

interface EntityMatch {
	readonly entity: Entity;
	/** 查询里命中的最长别名的规范化长度，用于排序 */
	readonly matchedLength: number;
}

/**
 * 多路记忆检索：BM25、向量、实体命中、事件重要度与新近度各取前 K，
 * 再用 RRF 融合。任一路没有候选时只跳过该路。
 */
export async function retrieveMemory(
	options: RetrieveMemoryOptions,
): Promise<RetrievalResult> {
	const rerankCandidates = resolveRerankCandidates(options.rerankCandidates);
	const { routes, filter } = await rankMemoryRoutes(options);
	const limit = options.limit ?? DEFAULT_RETRIEVAL_LIMIT;
	const fused = fuseRoutes(routes, DEFAULT_ROUTE_WEIGHTS);
	const reranker = options.reranker ?? null;
	const query = options.query ?? "";
	if (reranker === null || normalizeRetrievalText(query).length === 0) {
		return { hits: fused.slice(0, limit), filter, routes };
	}
	const hits = await rerankRetrievalHits({
		store: options.store,
		query,
		hits: fused,
		reranker,
		rerankCandidates,
	});
	return { hits: hits.slice(0, limit), filter, routes };
}

export interface RerankRetrievalHitsOptions {
	readonly store: StoryStore;
	readonly query: string;
	readonly hits: readonly RetrievalHit[];
	readonly reranker: RerankClient;
	/** 交给重排序的候选条数，默认 20。 */
	readonly rerankCandidates?: number;
}

/** 只重排前 `rerankCandidates` 条候选，其余保持融合顺序；空查询原样返回。 */
export async function rerankRetrievalHits(
	options: RerankRetrievalHitsOptions,
): Promise<readonly RetrievalHit[]> {
	const rerankCandidates = resolveRerankCandidates(options.rerankCandidates);
	if (
		normalizeRetrievalText(options.query).length === 0 ||
		options.hits.length === 0
	) {
		return options.hits;
	}
	const candidates = options.hits.slice(0, rerankCandidates);
	const documents = candidates.map((hit) => rerankDocument(options.store, hit));
	const scores = await options.reranker.rerank(options.query, documents);
	const scoreByIndex = new Map<number, number>();
	for (const score of scores) {
		if (
			!Number.isInteger(score.index) ||
			score.index < 0 ||
			score.index >= documents.length
		) {
			throw new Error(`重排序客户端返回了越界的下标 ${String(score.index)}`);
		}
		if (scoreByIndex.has(score.index)) {
			throw new Error(`重排序客户端重复返回了下标 ${score.index}`);
		}
		if (!Number.isFinite(score.score)) {
			throw new Error(`重排序客户端在下标 ${score.index} 返回了非有限分数`);
		}
		scoreByIndex.set(score.index, score.score);
	}
	if (scoreByIndex.size !== documents.length) {
		throw new Error(
			`重排序客户端返回了 ${scoreByIndex.size} 条分数，期望 ${documents.length} 条`,
		);
	}
	const ordered = candidates
		.map((hit, index) => ({
			hit,
			index,
			score: scoreByIndex.get(index) as number,
		}))
		.sort((left, right) => right.score - left.score || left.index - right.index)
		.map((entry) => entry.hit);
	return [...ordered, ...options.hits.slice(rerankCandidates)];
}

function resolveRerankCandidates(value: number | undefined): number {
	const rerankCandidates = value ?? DEFAULT_RERANK_CANDIDATES;
	if (
		!Number.isInteger(rerankCandidates) ||
		rerankCandidates < 1 ||
		rerankCandidates > MAX_RERANK_CANDIDATES
	) {
		throw new Error(
			`重排序候选条数必须是 1 到 ${MAX_RERANK_CANDIDATES} 之间的整数`,
		);
	}
	return rerankCandidates;
}

/** 重排序只看文本：事件用事件正文，父段块用父段，旧分块用楼层原文。 */
function rerankDocument(store: StoryStore, hit: RetrievalHit): string {
	if (hit.kind === "event") {
		const events = store.getEventsForNode(hit.nodeId);
		if (events.length === 0) {
			throw new Error(
				`检索结果把楼层 ${hit.nodeId} 标为事件，但该楼层没有事件正文`,
			);
		}
		return events.map((event) => event.text).join("；");
	}
	if (hit.parentText !== null) return hit.parentText;
	const node = store.getNode(hit.nodeId);
	if (!node) {
		throw new Error(`检索结果引用了不存在的楼层：${hit.nodeId}`);
	}
	return node.raw;
}

/**
 * 与 `retrieveMemory` 相同的候选收集与过滤，但返回每一路的原始名次，
 * 不做融合。评测和 Trace 用它单独观察每一路。
 */
export async function rankMemoryRoutes(
	options: RetrieveMemoryOptions,
): Promise<MemoryRouteRankings> {
	const { store, storyId } = options;
	if (!store.getStory(storyId)) {
		throw new Error(`故事不存在：${storyId}`);
	}
	const limit = options.limit ?? DEFAULT_RETRIEVAL_LIMIT;
	if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RETRIEVAL_LIMIT) {
		throw new Error(`检索条数必须是 1 到 ${MAX_RETRIEVAL_LIMIT} 之间的整数`);
	}
	const viewpoint = options.viewpoint ?? null;
	if (
		viewpoint !== null &&
		(typeof viewpoint !== "string" || viewpoint.length === 0)
	) {
		throw new Error("视角必须是非空字符串");
	}
	const query = options.query ?? "";
	if (typeof query !== "string") {
		throw new Error("检索语句必须是字符串");
	}
	const entityNames = options.entityNames ?? [];
	if (!Array.isArray(entityNames)) {
		throw new Error("驱动实体一路的名字必须是数组");
	}
	for (const name of entityNames) {
		if (typeof name !== "string" || name.trim().length === 0) {
			throw new Error("驱动实体一路的名字必须是非空字符串");
		}
	}
	const beforeNodeId = options.beforeNodeId ?? null;
	if (beforeNodeId !== null) {
		if (typeof beforeNodeId !== "string" || beforeNodeId.length === 0) {
			throw new Error("楼层节点 id 必须是非空字符串");
		}
		const node = store.getNode(beforeNodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${beforeNodeId}`);
		}
		if (node.storyId !== storyId) {
			throw new Error(
				`楼层节点 ${beforeNodeId} 属于另一个故事 ${node.storyId}`,
			);
		}
	}

	const pathNodes =
		beforeNodeId === null
			? store.getPathToHead(storyId)
			: store.getPathToNode(beforeNodeId).slice(0, -1);
	const lastPathNode = pathNodes[pathNodes.length - 1];
	const pathEvents: MemoryEvent[] = lastPathNode
		? store.getEventsForPath(lastPathNode.id, {
				limit: MAX_MEMORY_EVENT_LIMIT,
			})
		: [];
	const viewpointAliases =
		viewpoint === null
			? null
			: collectViewpointAliases(store, storyId, viewpoint);
	const events =
		viewpointAliases === null
			? pathEvents
			: pathEvents.filter((event) =>
					isVisibleToViewpoint(event, viewpointAliases),
				);
	const chunksExcluded = viewpointAliases !== null;

	const emptyQuery = normalizeRetrievalText(query).length === 0;
	const routes: RouteResult[] = [];
	const branchOptions = beforeNodeId === null ? {} : { beforeNodeId };

	if (!emptyQuery) {
		if (!chunksExcluded) {
			const bm25 = store.searchChunks(query, {
				storyId,
				...branchOptions,
				limit,
			});
			routes.push({
				route: "bm25",
				items: bm25.map((match) => ({
					kind: "chunk",
					nodeId: match.nodeId,
					parentOrdinal: match.parentOrdinal,
					parentText: match.parentText,
				})),
			});

			if (options.embedder) {
				const embedder = options.embedder;
				const [vector] = await embedder.embed([query]);
				if (!vector) {
					throw new Error("embedding 客户端没有返回查询向量");
				}
				const matches = store.searchVectors(vector, {
					storyId,
					...branchOptions,
					limit: Math.min(limit * VECTOR_CANDIDATE_FACTOR, 1_000),
				});
				routes.push({
					route: "vector",
					items: dedupeChunkItems(
						matches.map((match) => ({
							kind: "chunk" as const,
							nodeId: match.nodeId,
							parentOrdinal: match.parentOrdinal,
							parentText: match.parentText,
						})),
						limit,
					),
				});
			}
		}

		const entityMatches = matchEntities(store, storyId, query, entityNames);
		if (entityMatches.length > 0) {
			routes.push({
				route: "entity",
				items: entityRouteItems({
					store,
					storyId,
					beforeNodeId,
					limit,
					matches: entityMatches,
					events,
					pathNodes,
					includeChunks: !chunksExcluded,
				}),
			});
		}
	}

	if (events.length > 0) {
		const ordered = orderEvents(events, pathNodes);
		routes.push({
			route: "event",
			items: dedupeNodes(
				ordered.map((event) => ({
					kind: "event" as const,
					nodeId: event.sourceNodeId,
				})),
				limit,
			),
		});
	}

	if (emptyQuery && !chunksExcluded) {
		const recent = dedupeNodes(
			recentChunkItems(store, pathNodes, limit),
			limit,
		);
		if (recent.length > 0) {
			routes.push({ route: "recent", items: recent });
		}
	}

	return {
		routes,
		filter: {
			viewpoint,
			eventsBeforeFilter: pathEvents.length,
			eventsAfterFilter: events.length,
			chunksExcluded,
		},
	};
}

/** 视角能识别出的全部名称：视角本身的规范化形式，加上解析到的实体的名称与别名。 */
function collectViewpointAliases(
	store: StoryStore,
	storyId: string,
	viewpoint: string,
): Set<string> {
	const aliases = new Set<string>();
	const normalized = normalizeEntityName(viewpoint);
	if (normalized.length === 0) return aliases;
	aliases.add(normalized);
	for (const entity of store.resolveEntities(viewpoint, { storyId })) {
		for (const alias of normalizedAliases(entity)) aliases.add(alias);
	}
	return aliases;
}

function isVisibleToViewpoint(
	event: MemoryEvent,
	viewpointAliases: ReadonlySet<string>,
): boolean {
	if (event.knowers.length === 0) return true;
	for (const knower of event.knowers) {
		if (knower.trim() === "*") return true;
		if (viewpointAliases.has(normalizeEntityName(knower))) return true;
	}
	return false;
}

function matchEntities(
	store: StoryStore,
	storyId: string,
	query: string,
	entityNames: readonly string[],
): EntityMatch[] {
	const normalizedQuery = normalizeEntityName(query);
	const namedAliases = new Set(
		entityNames
			.map((name) => normalizeEntityName(name))
			.filter((name) => name.length > 0),
	);
	if (normalizedQuery.length === 0 && namedAliases.size === 0) return [];
	const matches: EntityMatch[] = [];
	for (const entity of store.listEntities(storyId)) {
		let matchedLength = 0;
		for (const normalized of normalizedAliases(entity)) {
			if (
				normalized.length > matchedLength &&
				normalizedQuery.includes(normalized)
			) {
				matchedLength = normalized.length;
			}
			if (normalized.length > matchedLength && namedAliases.has(normalized)) {
				matchedLength = normalized.length;
			}
		}
		if (matchedLength > 0) matches.push({ entity, matchedLength });
	}
	matches.sort(
		(left, right) =>
			right.matchedLength - left.matchedLength ||
			compareText(
				normalizeEntityName(left.entity.name),
				normalizeEntityName(right.entity.name),
			),
	);
	return matches;
}

function entityRouteItems(input: {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly beforeNodeId: string | null;
	readonly limit: number;
	readonly matches: readonly EntityMatch[];
	readonly events: readonly MemoryEvent[];
	readonly pathNodes: readonly TimelineNode[];
	/** 视角存在时为 false：原文块一律不注入 */
	readonly includeChunks: boolean;
}): RouteItem[] {
	const aliasSets = input.matches.map(
		(match) => new Set(normalizedAliases(match.entity)),
	);
	const recalled = orderEventsByStoryTime(
		input.events.filter((event) =>
			event.participants.some((participant) => {
				const normalized = normalizeEntityName(participant);
				return aliasSets.some((aliases) => aliases.has(normalized));
			}),
		),
		input.pathNodes,
	);
	const items: RouteItem[] = [];
	const seen = new Set<string>();
	for (const event of recalled) {
		const key = `event\u0000${event.sourceNodeId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		items.push({ kind: "event", nodeId: event.sourceNodeId });
		if (items.length === input.limit) break;
	}
	if (!input.includeChunks) return items;
	const branchOptions =
		input.beforeNodeId === null ? {} : { beforeNodeId: input.beforeNodeId };
	outer: for (const match of input.matches) {
		for (const alias of entityAliases(match.entity)) {
			const matches = input.store.searchChunks(alias, {
				storyId: input.storyId,
				...branchOptions,
				limit: input.limit,
			});
			for (const chunk of matches) {
				const key = `chunk\u0000${chunk.nodeId}`;
				if (seen.has(key)) continue;
				seen.add(key);
				items.push({
					kind: "chunk",
					nodeId: chunk.nodeId,
					parentOrdinal: chunk.parentOrdinal,
					parentText: chunk.parentText,
				});
				if (items.length === input.limit) break outer;
			}
		}
	}
	return items;
}

function normalizedAliases(entity: Entity): string[] {
	const seen = new Set<string>();
	for (const alias of [entity.name, ...entity.aliases]) {
		const normalized = normalizeEntityName(alias);
		if (normalized.length > 0) seen.add(normalized);
	}
	return [...seen];
}

function entityAliases(entity: Entity): string[] {
	const seen = new Set<string>();
	const aliases: string[] = [];
	for (const alias of [entity.name, ...entity.aliases]) {
		const normalized = normalizeEntityName(alias);
		if (normalized.length === 0 || seen.has(normalized)) continue;
		seen.add(normalized);
		aliases.push(alias);
	}
	return aliases;
}

function orderEvents(
	events: readonly MemoryEvent[],
	pathNodes: readonly TimelineNode[],
): MemoryEvent[] {
	const positions = new Map<string, number>();
	pathNodes.forEach((node, index) => positions.set(node.id, index));
	return [...events].sort((left, right) => {
		if (left.importance !== right.importance) {
			return right.importance - left.importance;
		}
		const leftPosition = positions.get(left.sourceNodeId) ?? -1;
		const rightPosition = positions.get(right.sourceNodeId) ?? -1;
		if (leftPosition !== rightPosition) return rightPosition - leftPosition;
		if (left.ordinal !== right.ordinal) return right.ordinal - left.ordinal;
		return compareText(left.id, right.id);
	});
}

/** 故事时间在前，没有写明故事时间的按楼层先后；同一件事的新旧由这个顺序解决。 */
function orderEventsByStoryTime(
	events: readonly MemoryEvent[],
	pathNodes: readonly TimelineNode[],
): MemoryEvent[] {
	const positions = new Map<string, number>();
	pathNodes.forEach((node, index) => positions.set(node.id, index));
	return [...events].sort((left, right) => {
		const leftTime = left.storyTime?.trim() ?? "";
		const rightTime = right.storyTime?.trim() ?? "";
		if (leftTime !== rightTime) {
			if (leftTime.length === 0) return 1;
			if (rightTime.length === 0) return -1;
			return compareText(leftTime, rightTime);
		}
		const leftPosition = positions.get(left.sourceNodeId) ?? -1;
		const rightPosition = positions.get(right.sourceNodeId) ?? -1;
		if (leftPosition !== rightPosition) return leftPosition - rightPosition;
		if (left.ordinal !== right.ordinal) return left.ordinal - right.ordinal;
		return compareText(left.id, right.id);
	});
}

function recentChunkItems(
	store: StoryStore,
	pathNodes: readonly TimelineNode[],
	limit: number,
): RouteItem[] {
	const items: RouteItem[] = [];
	for (let index = pathNodes.length - 1; index >= 0; index -= 1) {
		const node = pathNodes[index];
		if (!node) continue;
		if (store.countChunksForNode(node.id) === 0) continue;
		items.push({ kind: "chunk", nodeId: node.id });
		if (items.length === limit) break;
	}
	return items;
}

function dedupeNodes(items: readonly RouteItem[], limit: number): RouteItem[] {
	const seen = new Set<string>();
	const deduped: RouteItem[] = [];
	for (const item of items) {
		const key = `${item.kind}\u0000${item.nodeId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(item);
		if (deduped.length === limit) break;
	}
	return deduped;
}

/**
 * 同一父段的多个小块只保留名次最前的一个；没有父段时退化为按楼层去重。
 */
function dedupeChunkItems(
	items: readonly RouteItem[],
	limit: number,
): RouteItem[] {
	const seen = new Set<string>();
	const deduped: RouteItem[] = [];
	for (const item of items) {
		const parent = item.parentOrdinal ?? null;
		const key =
			parent === null ? `${item.nodeId}` : `${item.nodeId}\u0000${parent}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(item);
		if (deduped.length === limit) break;
	}
	return deduped;
}

/** 按 RRF 融合每一路的名次；同一楼层重复出现只保留一条。 */
export function fuseRetrievalRoutes(
	routes: readonly RetrievalRouteRanking[],
	weights: RetrievalRouteWeights = DEFAULT_ROUTE_WEIGHTS,
): RetrievalHit[] {
	assertRouteWeights(weights);
	return fuseRoutes(routes, weights);
}

function assertRouteWeights(weights: RetrievalRouteWeights): void {
	for (const [route, weight] of Object.entries(weights)) {
		if (!ROUTE_ORDER.includes(route as RetrievalRoute)) {
			throw new Error(`未知的检索路权重：${route}`);
		}
		if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
			throw new Error(`检索路 ${route} 的权重必须是大于 0 的有限数`);
		}
	}
}

function fuseRoutes(
	routes: readonly RouteResult[],
	weights: RetrievalRouteWeights,
): RetrievalHit[] {
	const candidates = new Map<
		string,
		{
			kind: RetrievalKind;
			nodeId: string;
			parentOrdinal: number | null;
			parentText: string | null;
			sources: RetrievalSource[];
		}
	>();
	for (const route of routes) {
		const seen = new Set<string>();
		route.items.forEach((item, index) => {
			const key = `${item.kind}\u0000${item.nodeId}`;
			if (seen.has(key)) return;
			seen.add(key);
			const candidate = candidates.get(key) ?? {
				kind: item.kind,
				nodeId: item.nodeId,
				parentOrdinal: item.parentOrdinal ?? null,
				parentText: item.parentText ?? null,
				sources: [],
			};
			if (
				candidate.parentText === null &&
				item.parentText !== undefined &&
				item.parentText !== null
			) {
				candidate.parentOrdinal = item.parentOrdinal ?? null;
				candidate.parentText = item.parentText;
			}
			candidate.sources.push({ route: route.route, rank: index + 1 });
			candidates.set(key, candidate);
		});
	}
	const hits = [...candidates.values()].map((candidate) => ({
		kind: candidate.kind,
		nodeId: candidate.nodeId,
		score: candidate.sources.reduce(
			(total, source) =>
				total + (weights[source.route] ?? 1) / (RRF_K + source.rank),
			0,
		),
		parentOrdinal: candidate.parentOrdinal,
		parentText: candidate.parentText,
		sources: [...candidate.sources].sort(
			(left, right) =>
				ROUTE_ORDER.indexOf(left.route) - ROUTE_ORDER.indexOf(right.route),
		),
	}));
	hits.sort((left, right) => {
		if (left.score !== right.score) return right.score - left.score;
		const leftRank = Math.min(...left.sources.map((source) => source.rank));
		const rightRank = Math.min(...right.sources.map((source) => source.rank));
		if (leftRank !== rightRank) return leftRank - rightRank;
		const leftKind = left.kind === "event" ? 0 : 1;
		const rightKind = right.kind === "event" ? 0 : 1;
		if (leftKind !== rightKind) return leftKind - rightKind;
		return compareText(left.nodeId, right.nodeId);
	});
	return hits;
}

function compareText(left: string, right: string): number {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}
