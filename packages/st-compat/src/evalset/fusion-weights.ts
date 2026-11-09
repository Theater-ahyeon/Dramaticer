import {
	DEFAULT_ROUTE_WEIGHTS,
	type EmbeddingClient,
	type RetrievalRoute,
	type RetrievalRouteRanking,
	type RetrievalRouteWeights,
	type StoryStore,
	fuseRetrievalRoutes,
	rankMemoryRoutes,
} from "@dramaticer/core";
import type { QuestionKind, RetrievalQuestion } from "./question-files.js";

/** 交叉验证时每一路的候选权重。 */
export const FUSION_WEIGHT_CANDIDATES = [0.5, 1, 2] as const;

/** 参与融合的五路，顺序固定，用于枚举与报告。 */
export const FUSION_ROUTES: readonly RetrievalRoute[] = [
	"bm25",
	"vector",
	"entity",
	"event",
	"recent",
];

const DEPTHS = [5, 10, 20] as const;

export interface FusionWeightScore {
	readonly questionCount: number;
	readonly hitAt5: number;
	readonly hitAt10: number;
	readonly hitAt20: number;
}

/** 一道题在每一路上的原始名次，用于离线试不同融合权重。 */
export interface QuestionRanking {
	readonly questionId: string;
	readonly kind: QuestionKind;
	readonly evidenceNodes: readonly string[];
	readonly routes: readonly RetrievalRouteRanking[];
}

export interface RankMemoryQuestionsOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly questions: readonly RetrievalQuestion[];
	readonly embedder?: EmbeddingClient | null;
	readonly viewpoint?: string | null;
}

export interface FusionWeightStory {
	readonly story: string;
	readonly rankings: readonly QuestionRanking[];
}

export interface FusionWeightSelection {
	readonly weights: RetrievalRouteWeights;
	readonly score: FusionWeightScore;
}

export interface FusionCrossValidationFold {
	readonly heldOutStory: string;
	readonly selectedWeights: RetrievalRouteWeights;
	readonly trainingScore: FusionWeightScore;
	readonly heldOutScore: FusionWeightScore;
	readonly defaultHeldOutScore: FusionWeightScore;
}

export interface FusionCrossValidation {
	readonly candidates: readonly number[];
	readonly folds: readonly FusionCrossValidationFold[];
	/** 全量数据上选出的权重；交叉验证没有提升时等于默认权重。 */
	readonly selectedWeights: RetrievalRouteWeights;
	readonly selectedScore: FusionWeightScore;
	readonly defaultScore: FusionWeightScore;
	/** 留出集的合计得分，用于判断调权重是否有帮助。 */
	readonly heldOutSelectedScore: FusionWeightScore;
	readonly heldOutDefaultScore: FusionWeightScore;
	readonly improved: boolean;
}

/**
 * 与 `evaluateMemoryQuestions` 相同的候选收集，但只保留每一路的名次，
 * 不计算融合成绩。权重搜索在内存里复用这些名次，不再查询数据库。
 */
export async function rankMemoryQuestions(
	options: RankMemoryQuestionsOptions,
): Promise<QuestionRanking[]> {
	const { store, storyId, questions } = options;
	if (questions.length === 0) {
		throw new Error(`故事 ${storyId} 没有题目`);
	}
	const viewpoint = options.viewpoint ?? null;
	if (options.embedder) {
		await options.embedder.embed(
			questions.map((question) => question.question),
		);
	}
	const rankings: QuestionRanking[] = [];
	for (const question of questions) {
		if (question.story !== storyId) {
			throw new Error(
				`题目 ${question.id} 属于故事 ${question.story}，与 ${storyId} 不一致`,
			);
		}
		const ranked = await rankMemoryRoutes({
			store,
			embedder: options.embedder ?? null,
			storyId,
			query: question.question,
			beforeNodeId: question.askAtNode,
			viewpoint,
			limit: 20,
		});
		rankings.push({
			questionId: question.id,
			kind: question.kind,
			evidenceNodes: question.evidenceNodes,
			routes: ranked.routes,
		});
	}
	return rankings;
}

/** 枚举每一路取候选权重时的全部组合。 */
export function enumerateFusionWeightVectors(
	routes: readonly RetrievalRoute[] = FUSION_ROUTES,
	candidates: readonly number[] = FUSION_WEIGHT_CANDIDATES,
): RetrievalRouteWeights[] {
	let vectors: RetrievalRouteWeights[] = [{}];
	for (const route of routes) {
		vectors = vectors.flatMap((base) =>
			candidates.map((weight) => ({ ...base, [route]: weight })),
		);
	}
	return vectors;
}

/** 用给定权重融合每一道题，按证据楼层是否进入前 K 计命中。 */
export function scoreQuestionRankings(
	rankings: readonly QuestionRanking[],
	weights: RetrievalRouteWeights,
): FusionWeightScore {
	let questionCount = 0;
	let hitAt5 = 0;
	let hitAt10 = 0;
	let hitAt20 = 0;
	for (const ranking of rankings) {
		const hits = fuseRetrievalRoutes(ranking.routes, weights).map(
			(hit) => hit.nodeId,
		);
		const evidence = new Set(ranking.evidenceNodes);
		const matches = DEPTHS.map((depth) =>
			hits.slice(0, depth).some((nodeId) => evidence.has(nodeId)),
		);
		questionCount += 1;
		if (matches[0]) hitAt5 += 1;
		if (matches[1]) hitAt10 += 1;
		if (matches[2]) hitAt20 += 1;
	}
	return { questionCount, hitAt5, hitAt10, hitAt20 };
}

/**
 * 在给定名次上选权重：依次比较命中@5、@10、@20；
 * 平局先取改动路数更少的一组，再取离默认权重更近的一组。
 */
export function selectFusionWeights(
	rankings: readonly QuestionRanking[],
	candidates: readonly number[] = FUSION_WEIGHT_CANDIDATES,
): FusionWeightSelection {
	let best: FusionWeightSelection | null = null;
	for (const weights of enumerateFusionWeightVectors(
		FUSION_ROUTES,
		candidates,
	)) {
		const score = scoreQuestionRankings(rankings, weights);
		if (
			best === null ||
			compareCandidates(weights, score, best.weights, best.score) > 0
		) {
			best = { weights, score };
		}
	}
	if (best === null) {
		throw new Error("融合权重候选集不能为空");
	}
	return best;
}

/**
 * 留一对话交叉验证：每次在两个对话上选权重，在第三个对话上报告。
 * 只有留出集的合计命中高于默认权重时才建议更新默认值。
 */
export function crossValidateFusionWeights(
	stories: readonly FusionWeightStory[],
): FusionCrossValidation | null {
	if (stories.length < 2) return null;
	const folds: FusionCrossValidationFold[] = stories.map((heldOut) => {
		const training = stories
			.filter((story) => story !== heldOut)
			.flatMap((story) => story.rankings);
		const selection = selectFusionWeights(training);
		return {
			heldOutStory: heldOut.story,
			selectedWeights: selection.weights,
			trainingScore: selection.score,
			heldOutScore: scoreQuestionRankings(heldOut.rankings, selection.weights),
			defaultHeldOutScore: scoreQuestionRankings(
				heldOut.rankings,
				DEFAULT_ROUTE_WEIGHTS,
			),
		};
	});
	const heldOutSelectedScore = sumScores(
		folds.map((fold) => fold.heldOutScore),
	);
	const heldOutDefaultScore = sumScores(
		folds.map((fold) => fold.defaultHeldOutScore),
	);
	const improved = compareScores(heldOutSelectedScore, heldOutDefaultScore) > 0;
	const all = stories.flatMap((story) => story.rankings);
	const selectedWeights = improved
		? selectFusionWeights(all).weights
		: DEFAULT_ROUTE_WEIGHTS;
	return {
		candidates: FUSION_WEIGHT_CANDIDATES,
		folds,
		selectedWeights,
		selectedScore: scoreQuestionRankings(all, selectedWeights),
		defaultScore: scoreQuestionRankings(all, DEFAULT_ROUTE_WEIGHTS),
		heldOutSelectedScore,
		heldOutDefaultScore,
		improved,
	};
}

function compareCandidates(
	leftWeights: RetrievalRouteWeights,
	leftScore: FusionWeightScore,
	rightWeights: RetrievalRouteWeights,
	rightScore: FusionWeightScore,
): number {
	const byScore = compareScores(leftScore, rightScore);
	if (byScore !== 0) return byScore;
	const byChangedRoutes =
		changedRouteCount(rightWeights) - changedRouteCount(leftWeights);
	if (byChangedRoutes !== 0) return byChangedRoutes;
	return weightsDistance(rightWeights) - weightsDistance(leftWeights);
}

function compareScores(
	left: FusionWeightScore,
	right: FusionWeightScore,
): number {
	for (const key of ["hitAt5", "hitAt10", "hitAt20"] as const) {
		if (left[key] !== right[key]) return left[key] - right[key];
	}
	return 0;
}

function changedRouteCount(weights: RetrievalRouteWeights): number {
	let total = 0;
	for (const route of FUSION_ROUTES) {
		if ((weights[route] ?? 1) !== 1) total += 1;
	}
	return total;
}

function weightsDistance(weights: RetrievalRouteWeights): number {
	let total = 0;
	for (const route of FUSION_ROUTES) {
		total += Math.abs((weights[route] ?? 1) - 1);
	}
	return total;
}

function sumScores(scores: readonly FusionWeightScore[]): FusionWeightScore {
	let questionCount = 0;
	let hitAt5 = 0;
	let hitAt10 = 0;
	let hitAt20 = 0;
	for (const score of scores) {
		questionCount += score.questionCount;
		hitAt5 += score.hitAt5;
		hitAt10 += score.hitAt10;
		hitAt20 += score.hitAt20;
	}
	return { questionCount, hitAt5, hitAt10, hitAt20 };
}
