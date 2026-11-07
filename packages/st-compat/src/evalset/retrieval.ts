import { existsSync } from "node:fs";
import path from "node:path";
import {
	ChunkIndex,
	type ChunkInput,
	type ChunkMatch,
	chunkText,
} from "@dramaticer/core";
import { parseChatJsonlFile } from "../chat-jsonl.js";
import {
	STORY_CORPORA,
	type StoryCorpus,
	openSnapshot,
	storyCorpus,
} from "../health/manifest.js";
import { messageNodeId, parseMessageIndex } from "../node-id.js";
import { planEventQuestionsFromFile } from "./event-questions.js";
import type { QuestionKind, RetrievalQuestion } from "./question-files.js";
import {
	readQuestionFile,
	sanitizeFileName,
	storyIdOf,
} from "./question-files.js";
import { addCounts, emptyCounts, requireNonEmpty } from "./shared.js";
import type { SkippedStory } from "./shared.js";

const DEFAULT_MAX_CHARS = 400;
const DEFAULT_OVERLAP_CHARS = 80;
const MAX_DEPTH = 20;
const KIND_ORDER: readonly QuestionKind[] = ["state", "event"];

export interface RetrievalScore {
	readonly questionCount: number;
	readonly hitAt5: number;
	readonly hitAt10: number;
	readonly hitAt20: number;
}

export interface RetrievalKindScore extends RetrievalScore {
	readonly kind: QuestionKind;
}

export interface RetrievalStoryScore {
	readonly story: string;
	readonly corpus: StoryCorpus;
	readonly floorCount: number;
	readonly chunkCount: number;
	readonly byKind: readonly RetrievalKindScore[];
	readonly total: RetrievalScore;
}

export interface RetrievalCorpusScore {
	readonly corpus: StoryCorpus;
	readonly chatCount: number;
	readonly skippedStoryCount: number;
	/** 尚未生成事件题时，按默认窗口估算的请求数。 */
	readonly eventQuestionRequestEstimate: number;
	readonly byKind: readonly RetrievalKindScore[];
	readonly total: RetrievalScore;
}

export interface RetrievalBaseline {
	readonly generatedAt: string;
	readonly maxChars: number;
	readonly overlapChars: number;
	readonly stories: readonly RetrievalStoryScore[];
	readonly corpora: readonly RetrievalCorpusScore[];
	readonly skippedStories: readonly SkippedStory[];
	readonly byKind: readonly RetrievalKindScore[];
	readonly total: RetrievalScore;
}

export interface EvaluateRetrievalOptions {
	readonly chatPath: string;
	readonly storyId: string;
	readonly corpus: StoryCorpus;
	readonly questions: readonly RetrievalQuestion[];
	readonly maxChars?: number;
	readonly overlapChars?: number;
}

export interface CollectRetrievalBaselineOptions {
	readonly rawRoot: string;
	readonly evalsetRoot: string;
	readonly maxChars?: number;
	readonly overlapChars?: number;
	readonly generatedAt?: string;
}

const SCORE_KEYS = ["questionCount", "hitAt5", "hitAt10", "hitAt20"] as const;

type MutableScore = Record<(typeof SCORE_KEYS)[number], number>;

/**
 * 朴素 BM25 基线：把每个楼层按固定窗口切块写入 FTS5，题目只在提问楼层之前的楼层里检索。
 * 证据楼层出现在前 K 个检索结果里算命中。
 */
export async function evaluateRetrieval(
	options: EvaluateRetrievalOptions,
): Promise<RetrievalStoryScore> {
	const storyId = requireNonEmpty(options.storyId, "故事 id");
	if (options.questions.length === 0) {
		throw new Error(`故事 ${storyId} 没有题目`);
	}
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
	const index = ChunkIndex.open();
	try {
		const nodeIdByIndex: string[] = [];
		const chunks: ChunkInput[] = [];
		let floorCount = 0;
		for await (const entry of parseChatJsonlFile(options.chatPath)) {
			if (entry.kind === "header") continue;
			const message = entry.message;
			floorCount += 1;
			const nodeId = messageNodeId(storyId, message);
			nodeIdByIndex[message.index] = nodeId;
			if (message.isSystem) continue;
			for (const text of chunkText(message.text, {
				maxChars,
				overlapChars,
			})) {
				chunks.push({ storyId, nodeId, text });
			}
		}
		index.add(chunks);

		const total = emptyCounts(SCORE_KEYS);
		const byKind = new Map<QuestionKind, MutableScore>();
		for (const question of options.questions) {
			if (question.story !== storyId) {
				throw new Error(
					`题目 ${question.id} 属于故事 ${question.story}，与 ${storyId} 不一致`,
				);
			}
			const askIndex = parseMessageIndex(storyId, question.askAtNode);
			if (nodeIdByIndex[askIndex] === undefined) {
				throw new Error(
					`题目 ${question.id} 的提问楼层 ${question.askAtNode} 超出故事 ${storyId} 的楼层范围`,
				);
			}
			const allowed = nodeIdByIndex.slice(0, askIndex);
			const matches = dedupeByNodeId(
				index.search(question.question, {
					storyId,
					nodeIds: allowed,
					limit: MAX_DEPTH,
				}),
			);
			const hits = [5, 10, 20].map((depth) =>
				matches
					.slice(0, depth)
					.some((match) => question.evidenceNodes.includes(match.nodeId)),
			);
			let score = byKind.get(question.kind);
			if (!score) {
				score = emptyCounts(SCORE_KEYS);
				byKind.set(question.kind, score);
			}
			recordHits(score, hits);
			recordHits(total, hits);
		}

		const kindScores: RetrievalKindScore[] = [];
		for (const kind of KIND_ORDER) {
			const score = byKind.get(kind);
			if (score) kindScores.push({ kind, ...score });
		}
		return {
			story: storyId,
			corpus: options.corpus,
			floorCount,
			chunkCount: index.count(),
			byKind: kindScores,
			total,
		};
	} finally {
		index.close();
	}
}

export async function collectRetrievalBaseline(
	options: CollectRetrievalBaselineOptions,
): Promise<RetrievalBaseline> {
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
	const snapshot = await openSnapshot(options.rawRoot);
	const chatFiles = snapshot.filesByRole("chat");
	if (chatFiles.length === 0) {
		throw new Error("manifest 里没有 chat");
	}

	const stories: RetrievalStoryScore[] = [];
	const skippedStories: SkippedStory[] = [];
	const eventRequests = new Map<StoryCorpus, number>();
	for (const file of chatFiles) {
		const story = storyIdOf(file);
		const corpus = storyCorpus(file);
		const baseName = sanitizeFileName(story);
		const chatPath = await snapshot.resolveFile(file);
		const questions: RetrievalQuestion[] = [];
		let skipReason: string | null = null;
		let hasEventQuestions = false;
		for (const kind of KIND_ORDER) {
			const questionPath = path.join(
				options.evalsetRoot,
				`${kind}-${baseName}.jsonl`,
			);
			if (!existsSync(questionPath)) {
				if (kind === "state") {
					if (corpus === "legacy") {
						throw new Error(`缺少状态题文件：${questionPath}`);
					}
					skipReason = "缺少状态题文件";
					break;
				}
				continue;
			}
			if (kind === "event") hasEventQuestions = true;
			questions.push(...(await readQuestionFile(questionPath, kind)));
		}
		if (!hasEventQuestions) {
			const plan = await planEventQuestionsFromFile(chatPath, {
				storyId: story,
			});
			eventRequests.set(
				corpus,
				(eventRequests.get(corpus) ?? 0) + plan.requestCount,
			);
		}
		if (skipReason !== null) {
			skippedStories.push({ story, corpus, reason: skipReason });
			continue;
		}
		stories.push(
			await evaluateRetrieval({
				chatPath,
				storyId: story,
				corpus,
				questions,
				maxChars,
				overlapChars,
			}),
		);
	}

	const total = emptyCounts(SCORE_KEYS);
	const byKind = new Map<QuestionKind, MutableScore>();
	for (const story of stories) {
		addCounts(total, story.total);
		for (const score of story.byKind) {
			recordKindScore(byKind, score);
		}
	}

	const corpora: RetrievalCorpusScore[] = [];
	for (const corpus of STORY_CORPORA) {
		const corpusStories = stories.filter((story) => story.corpus === corpus);
		const skipped = skippedStories.filter((story) => story.corpus === corpus);
		if (corpusStories.length === 0 && skipped.length === 0) continue;
		const corpusTotal = emptyCounts(SCORE_KEYS);
		const corpusByKind = new Map<QuestionKind, MutableScore>();
		for (const story of corpusStories) {
			addCounts(corpusTotal, story.total);
			for (const score of story.byKind) {
				recordKindScore(corpusByKind, score);
			}
		}
		corpora.push({
			corpus,
			chatCount: corpusStories.length + skipped.length,
			skippedStoryCount: skipped.length,
			eventQuestionRequestEstimate: eventRequests.get(corpus) ?? 0,
			byKind: collectKindScores(corpusByKind),
			total: corpusTotal,
		});
	}

	return {
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		maxChars,
		overlapChars,
		stories,
		corpora,
		skippedStories,
		byKind: collectKindScores(byKind),
		total,
	};
}

function recordKindScore(
	byKind: Map<QuestionKind, MutableScore>,
	score: RetrievalKindScore,
): void {
	let target = byKind.get(score.kind);
	if (!target) {
		target = emptyCounts(SCORE_KEYS);
		byKind.set(score.kind, target);
	}
	addCounts<(typeof SCORE_KEYS)[number]>(target, score);
}

function collectKindScores(
	byKind: Map<QuestionKind, MutableScore>,
): RetrievalKindScore[] {
	const scores: RetrievalKindScore[] = [];
	for (const kind of KIND_ORDER) {
		const score = byKind.get(kind);
		if (score) scores.push({ kind, ...score });
	}
	return scores;
}

function dedupeByNodeId(matches: readonly ChunkMatch[]): ChunkMatch[] {
	const seen = new Set<string>();
	const unique: ChunkMatch[] = [];
	for (const match of matches) {
		if (seen.has(match.nodeId)) continue;
		seen.add(match.nodeId);
		unique.push(match);
	}
	return unique;
}

function recordHits(score: MutableScore, hits: readonly boolean[]): void {
	score.questionCount += 1;
	if (hits[0]) score.hitAt5 += 1;
	if (hits[1]) score.hitAt10 += 1;
	if (hits[2]) score.hitAt20 += 1;
}
