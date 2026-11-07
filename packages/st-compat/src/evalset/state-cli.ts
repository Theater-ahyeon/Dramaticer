import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	STORY_CORPORA,
	type StoryCorpus,
	openSnapshot,
	storyCorpus,
} from "../health/manifest.js";
import {
	sampleDeterministic,
	sanitizeFileName,
	storyIdOf,
} from "./question-files.js";
import {
	type StateQuestionOptions,
	buildStateQuestionsFromFile,
	verifyStateQuestionsFromFile,
} from "./state-questions.js";

export const STATE_QUESTION_MIN = 50;
export const STATE_QUESTION_MAX = 100;
const VERIFICATION_SAMPLE_SIZE = 10;

/** 旧语料的题目区间与间隔；新语料楼层短，用更小的间隔和题量。 */
const CORPUS_OPTIONS: Readonly<
	Record<StoryCorpus, Omit<StateQuestionOptions, "storyId">>
> = {
	legacy: {},
	latest: {
		minGap: 3,
		minQuestions: 1,
		maxQuestions: 50,
		maxPerPath: 3,
		allowEmpty: true,
	},
};

export interface StateStorySummary {
	readonly story: string;
	readonly corpus: StoryCorpus;
	readonly file: string | null;
	readonly questions: number;
	readonly candidates: number;
	readonly messages: number;
	readonly updates: number;
	readonly paths: number;
	readonly verified: number;
	readonly sampled: readonly string[];
	readonly skipped: string | null;
}

export interface RunStateQuestionsOptions {
	readonly rawRoot: string;
	readonly outputRoot: string;
	readonly generatedAt?: string;
	readonly log?: (message: string) => void;
}

export function assertStateQuestionCount(storyId: string, count: number): void {
	if (count < STATE_QUESTION_MIN || count > STATE_QUESTION_MAX) {
		throw new Error(
			`${storyId} 生成了 ${count} 道题，超出 ${STATE_QUESTION_MIN} 到 ${STATE_QUESTION_MAX} 的范围`,
		);
	}
}

export async function writeStateSummary(
	outputRoot: string,
	summaries: readonly StateStorySummary[],
	generatedAt: string,
): Promise<string> {
	await mkdir(outputRoot, { recursive: true });
	const summaryPath = path.join(outputRoot, "summary.json");
	await writeFile(
		summaryPath,
		`${JSON.stringify(
			{
				generatedAt,
				stories: summaries,
				totalQuestions: summaries.reduce(
					(total, story) => total + story.questions,
					0,
				),
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	return summaryPath;
}

export async function runStateQuestionsCli(
	options: RunStateQuestionsOptions,
): Promise<{ summaries: readonly StateStorySummary[]; summaryPath: string }> {
	const log = options.log ?? ((message: string) => console.log(message));
	const snapshot = await openSnapshot(options.rawRoot);
	const chatFiles = snapshot.filesByRole("chat");
	if (chatFiles.length === 0) {
		throw new Error("manifest 里没有 chat");
	}

	const summaries: StateStorySummary[] = [];
	const seenStories = new Set<string>();
	for (const file of chatFiles) {
		const storyId = storyIdOf(file);
		if (seenStories.has(storyId)) {
			throw new Error(`manifest 里出现了重复的故事名 ${storyId}`);
		}
		seenStories.add(storyId);
		const corpus = storyCorpus(file);
		const chatPath = await snapshot.resolveFile(file);
		const result = await buildStateQuestionsFromFile(chatPath, {
			storyId,
			...CORPUS_OPTIONS[corpus],
		});
		if (corpus === "legacy") {
			assertStateQuestionCount(storyId, result.questions.length);
		}
		if (result.questions.length === 0) {
			const skipped = "没有满足间隔要求的状态题候选";
			summaries.push({
				story: storyId,
				corpus,
				file: null,
				questions: 0,
				candidates: result.stats.candidateCount,
				messages: result.stats.messageCount,
				updates: result.stats.updateCount,
				paths: result.stats.pathCount,
				verified: 0,
				sampled: [],
				skipped,
			});
			log(
				`${storyId}：跳过（${skipped}，楼层 ${result.stats.messageCount}，变量路径 ${result.stats.pathCount}）。`,
			);
			continue;
		}
		const verification = await verifyStateQuestionsFromFile(
			chatPath,
			result.questions,
			{ storyId },
		);
		if (verification.failures.length > 0) {
			const detail = verification.failures
				.slice(0, 5)
				.map((failure) => `${failure.id}：${failure.reason}`)
				.join("；");
			throw new Error(
				`${storyId} 有 ${verification.failures.length} 道题核对失败：${detail}`,
			);
		}

		const sampled = sampleDeterministic(
			result.questions,
			Math.min(VERIFICATION_SAMPLE_SIZE, result.questions.length),
		);
		const fileName = `state-${sanitizeFileName(storyId)}.jsonl`;
		await mkdir(options.outputRoot, { recursive: true });
		await writeFile(
			path.join(options.outputRoot, fileName),
			`${result.questions.map((question) => JSON.stringify(question)).join("\n")}\n`,
			"utf8",
		);

		summaries.push({
			story: storyId,
			corpus,
			file: fileName,
			questions: result.stats.questionCount,
			candidates: result.stats.candidateCount,
			messages: result.stats.messageCount,
			updates: result.stats.updateCount,
			paths: result.stats.pathCount,
			verified: verification.checked - verification.failures.length,
			sampled: sampled.map((question) => question.id),
			skipped: null,
		});
		log(
			`${storyId}（${corpus}）：${result.stats.questionCount} 题（候选 ${result.stats.candidateCount}，楼层 ${result.stats.messageCount}，变量路径 ${result.stats.pathCount}），核对抽样 ${sampled.length} 题全部一致。`,
		);
	}

	const summaryPath = await writeStateSummary(
		options.outputRoot,
		summaries,
		options.generatedAt ?? new Date().toISOString(),
	);
	log(`状态题已写入 ${options.outputRoot}`);
	log(`汇总：${summaryPath}`);
	return { summaries, summaryPath };
}
