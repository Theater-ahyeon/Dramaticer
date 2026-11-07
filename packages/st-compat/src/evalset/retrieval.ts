import { existsSync } from "node:fs";
import path from "node:path";
import { ChunkIndex, type ChunkInput, chunkText } from "@dramaticer/core";
import { parseChatJsonlFile } from "../chat-jsonl.js";
import { readSnapshotManifest } from "../health/manifest.js";
import { messageNodeId, parseMessageIndex } from "../node-id.js";
import type { QuestionKind, RetrievalQuestion } from "./question-files.js";
import {
	readQuestionFile,
	sanitizeFileName,
	storyIdOf,
} from "./question-files.js";

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
	readonly floorCount: number;
	readonly chunkCount: number;
	readonly byKind: readonly RetrievalKindScore[];
	readonly total: RetrievalScore;
}

export interface RetrievalBaseline {
	readonly generatedAt: string;
	readonly maxChars: number;
	readonly overlapChars: number;
	readonly stories: readonly RetrievalStoryScore[];
	readonly byKind: readonly RetrievalKindScore[];
	readonly total: RetrievalScore;
}

export interface EvaluateRetrievalOptions {
	readonly chatPath: string;
	readonly storyId: string;
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

interface MutableScore {
	questionCount: number;
	hitAt5: number;
	hitAt10: number;
	hitAt20: number;
}

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

		const total = createScore();
		const byKind = new Map<QuestionKind, MutableScore>();
		for (const question of options.questions) {
			if (question.story !== storyId) {
				throw new Error(
					`题目 ${question.id} 属于故事 ${question.story}，与 ${storyId} 不一致`,
				);
			}
			const askIndex = parseMessageIndex(storyId, question.askAtNode);
			const allowed = nodeIdByIndex.slice(0, askIndex);
			const matches = index.search(question.question, {
				storyId,
				nodeIds: allowed,
				limit: MAX_DEPTH,
			});
			const hits = [5, 10, 20].map((depth) =>
				matches
					.slice(0, depth)
					.some((match) => question.evidenceNodes.includes(match.nodeId)),
			);
			let score = byKind.get(question.kind);
			if (!score) {
				score = createScore();
				byKind.set(question.kind, score);
			}
			recordHits(score, hits);
			recordHits(total, hits);
		}

		const kindScores: RetrievalKindScore[] = [];
		for (const kind of KIND_ORDER) {
			const score = byKind.get(kind);
			if (score) kindScores.push({ kind, ...toScore(score) });
		}
		return {
			story: storyId,
			floorCount,
			chunkCount: index.count(),
			byKind: kindScores,
			total: toScore(total),
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
	const rawRoot = path.resolve(options.rawRoot);
	const manifest = await readSnapshotManifest(
		path.join(rawRoot, "manifest.json"),
	);
	const chatFiles = manifest.files.filter((file) => file.role === "chat");
	if (chatFiles.length === 0) {
		throw new Error("manifest 里没有 chat");
	}

	const stories: RetrievalStoryScore[] = [];
	for (const file of chatFiles) {
		const story = storyIdOf(file);
		const baseName = sanitizeFileName(story);
		const questions: RetrievalQuestion[] = [];
		for (const kind of KIND_ORDER) {
			const questionPath = path.join(
				options.evalsetRoot,
				`${kind}-${baseName}.jsonl`,
			);
			if (!existsSync(questionPath)) {
				if (kind === "state") {
					throw new Error(`缺少状态题文件：${questionPath}`);
				}
				continue;
			}
			questions.push(...(await readQuestionFile(questionPath, kind)));
		}
		stories.push(
			await evaluateRetrieval({
				chatPath: path.join(rawRoot, file.target),
				storyId: story,
				questions,
				maxChars,
				overlapChars,
			}),
		);
	}

	const total = createScore();
	const byKind = new Map<QuestionKind, MutableScore>();
	for (const story of stories) {
		addScore(total, story.total);
		for (const score of story.byKind) {
			let target = byKind.get(score.kind);
			if (!target) {
				target = createScore();
				byKind.set(score.kind, target);
			}
			addScore(target, score);
		}
	}
	const kindScores: RetrievalKindScore[] = [];
	for (const kind of KIND_ORDER) {
		const score = byKind.get(kind);
		if (score) kindScores.push({ kind, ...toScore(score) });
	}

	return {
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		maxChars,
		overlapChars,
		stories,
		byKind: kindScores,
		total: toScore(total),
	};
}

function createScore(): MutableScore {
	return { questionCount: 0, hitAt5: 0, hitAt10: 0, hitAt20: 0 };
}

function recordHits(score: MutableScore, hits: readonly boolean[]): void {
	score.questionCount += 1;
	if (hits[0]) score.hitAt5 += 1;
	if (hits[1]) score.hitAt10 += 1;
	if (hits[2]) score.hitAt20 += 1;
}

function addScore(target: MutableScore, source: RetrievalScore): void {
	target.questionCount += source.questionCount;
	target.hitAt5 += source.hitAt5;
	target.hitAt10 += source.hitAt10;
	target.hitAt20 += source.hitAt20;
}

function toScore(score: MutableScore): RetrievalScore {
	return {
		questionCount: score.questionCount,
		hitAt5: score.hitAt5,
		hitAt10: score.hitAt10,
		hitAt20: score.hitAt20,
	};
}

function requireNonEmpty(value: string, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value;
}
