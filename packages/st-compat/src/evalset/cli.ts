import { randomInt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSnapshotManifest } from "../health/manifest.js";
import { sanitizeFileName, storyIdOf } from "./question-files.js";
import {
	buildStateQuestionsFromFile,
	verifyStateQuestionsFromFile,
} from "./state-questions.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const rawRoot = path.join(repoRoot, "eval-private", "raw");
const outputRoot = path.join(repoRoot, "eval-private", "evalset");

const manifest = await readSnapshotManifest(
	path.join(rawRoot, "manifest.json"),
);
const chatFiles = manifest.files.filter((file) => file.role === "chat");
if (chatFiles.length === 0) {
	throw new Error("manifest 里没有 chat");
}

interface StorySummary {
	readonly story: string;
	readonly file: string;
	readonly questions: number;
	readonly candidates: number;
	readonly messages: number;
	readonly updates: number;
	readonly paths: number;
	readonly verified: number;
	readonly sampled: readonly string[];
}

const summaries: StorySummary[] = [];
const seenStories = new Set<string>();

for (const file of chatFiles) {
	const storyId = storyIdOf(file);
	if (seenStories.has(storyId)) {
		throw new Error(`manifest 里出现了重复的故事名 ${storyId}`);
	}
	seenStories.add(storyId);
	const chatPath = path.join(rawRoot, file.target);
	const result = await buildStateQuestionsFromFile(chatPath, { storyId });
	if (result.questions.length < 50 || result.questions.length > 100) {
		throw new Error(
			`${storyId} 生成了 ${result.questions.length} 道题，超出 50 到 100 的范围`,
		);
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

	const sampled = sampleQuestions(result.questions);
	const fileName = `state-${sanitizeFileName(storyId)}.jsonl`;
	await mkdir(outputRoot, { recursive: true });
	await writeFile(
		path.join(outputRoot, fileName),
		`${result.questions.map((question) => JSON.stringify(question)).join("\n")}\n`,
		"utf8",
	);

	summaries.push({
		story: storyId,
		file: fileName,
		questions: result.stats.questionCount,
		candidates: result.stats.candidateCount,
		messages: result.stats.messageCount,
		updates: result.stats.updateCount,
		paths: result.stats.pathCount,
		verified: verification.checked - verification.failures.length,
		sampled: sampled.map((question) => question.id),
	});
	console.log(
		`${storyId}：${result.stats.questionCount} 题（候选 ${result.stats.candidateCount}，楼层 ${result.stats.messageCount}，变量路径 ${result.stats.pathCount}），核对抽样 ${sampled.length} 题全部一致。`,
	);
}

const summaryPath = path.join(outputRoot, "summary.json");
await writeFile(
	summaryPath,
	`${JSON.stringify(
		{
			generatedAt: new Date().toISOString(),
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
console.log(`状态题已写入 ${outputRoot}`);
console.log(`汇总：${summaryPath}`);

function sampleQuestions<T>(questions: readonly T[]): T[] {
	const count = Math.min(10, questions.length);
	const indices = new Set<number>();
	while (indices.size < count) {
		indices.add(randomInt(questions.length));
	}
	return [...indices].map((index) => {
		const question = questions[index];
		if (question === undefined) {
			throw new Error(`抽样下标 ${index} 越界`);
		}
		return question;
	});
}
