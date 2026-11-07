import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenAiCompatibleClient } from "@dramaticer/core";
import { parseChatJsonlFile } from "../chat-jsonl.js";
import { readSnapshotManifest } from "../health/manifest.js";
import { messageNodeId } from "../node-id.js";
import { loadDotEnv } from "./env.js";
import {
	type EvidenceExcerpt,
	eventSpotcheckPath,
	eventSummaryPath,
	renderSpotcheck,
} from "./event-output.js";
import {
	type EventQuestion,
	buildEventQuestionsFromFile,
	verifyEventQuestionsFromFile,
} from "./event-questions.js";
import {
	sampleDeterministic,
	sanitizeFileName,
	storyIdOf,
} from "./question-files.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const envPath = path.join(repoRoot, ".env");
loadDotEnv(envPath);

const rawRoot = path.join(repoRoot, "eval-private", "raw");
const outputRoot = path.join(repoRoot, "eval-private", "evalset");
const cacheDir = path.join(repoRoot, "eval-private", "llm-cache");

const baseUrl = requireEnv("DRAMATICER_BG_BASE_URL");
const apiKey = process.env.DRAMATICER_BG_API_KEY ?? "";
const model = requireEnv("DRAMATICER_BG_MODEL");
const requestsPerMinute = optionalInt("DRAMATICER_BG_REQUESTS_PER_MINUTE", 20);
const timeoutMs = optionalInt("DRAMATICER_BG_TIMEOUT_MS", 300_000);
const maxRetries = optionalInt("DRAMATICER_BG_MAX_RETRIES", 1);
const reasoningEffort = nonEmpty(process.env.DRAMATICER_BG_REASONING_EFFORT);
const onlyStory = readStoryFilter(process.argv.slice(2));
const questionsPerWindow = optionalInt(
	"DRAMATICER_EVAL_QUESTIONS_PER_WINDOW",
	5,
);
const maxWindows = optionalInt("DRAMATICER_EVAL_MAX_WINDOWS", 24);
const maxWindowChars = optionalInt("DRAMATICER_EVAL_MAX_WINDOW_CHARS", 24_000);
const maxTokens = optionalInt("DRAMATICER_EVAL_MAX_TOKENS", 4_096);

const client = new OpenAiCompatibleClient({
	baseUrl,
	apiKey,
	model,
	requestsPerMinute,
	timeoutMs,
	maxRetries,
	cacheDir,
});

const manifest = await readSnapshotManifest(
	path.join(rawRoot, "manifest.json"),
);
const allChatFiles = manifest.files.filter((file) => file.role === "chat");
const chatFiles =
	onlyStory === undefined
		? allChatFiles
		: allChatFiles.filter((file) => storyIdOf(file) === onlyStory);
if (chatFiles.length === 0) {
	throw new Error(
		onlyStory === undefined
			? "manifest 里没有 chat"
			: `manifest 里没有故事 ${onlyStory}`,
	);
}

interface StorySummary {
	readonly story: string;
	readonly file: string;
	readonly questions: number;
	readonly windows: number;
	readonly availableWindows: number;
	readonly requests: number;
	readonly cachedRequests: number;
	readonly failedWindows: number;
	readonly candidates: number;
	readonly failures: number;
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly reasoningTokens: number;
	readonly verified: number;
}

const summaries: StorySummary[] = [];
const allQuestions: EventQuestion[] = [];
const excerptsByNode = new Map<string, EvidenceExcerpt>();
const seenStories = new Set<string>();

for (const file of chatFiles) {
	const storyId = storyIdOf(file);
	if (seenStories.has(storyId)) {
		throw new Error(`manifest 里出现了重复的故事名 ${storyId}`);
	}
	seenStories.add(storyId);
	const chatPath = path.resolve(rawRoot, file.target);

	const result = await buildEventQuestionsFromFile(chatPath, client, {
		storyId,
		minQuestions: 50,
		maxQuestions: 50,
		questionsPerWindow,
		maxWindows,
		maxWindowChars,
		maxFloorChars: 3_000,
		overlapFloors: 3,
		minWindowFloors: 4,
		minEvidenceGap: 2,
		temperature: 0.7,
		maxTokens,
		...(reasoningEffort === undefined ? {} : { reasoningEffort }),
	});
	const verification = await verifyEventQuestionsFromFile(
		chatPath,
		result.questions,
		{ storyId, minEvidenceGap: 2 },
	);
	if (verification.failures.length > 0) {
		const detail = verification.failures
			.slice(0, 5)
			.map((failure) => `${failure.askAtNode}：${failure.reason}`)
			.join("；");
		throw new Error(
			`${storyId} 有 ${verification.failures.length} 道题核对失败：${detail}`,
		);
	}

	const fileName = `event-${sanitizeFileName(storyId)}.jsonl`;
	await mkdir(outputRoot, { recursive: true });
	await writeFile(
		path.join(outputRoot, fileName),
		`${result.questions.map((question) => JSON.stringify(question)).join("\n")}\n`,
		"utf8",
	);

	const excerpts = await collectEvidenceExcerpts(
		chatPath,
		result.questions,
		storyId,
	);
	for (const [nodeId, excerpt] of excerpts) excerptsByNode.set(nodeId, excerpt);

	allQuestions.push(...result.questions);
	summaries.push({
		story: storyId,
		file: fileName,
		questions: result.questions.length,
		windows: result.stats.windowCount,
		availableWindows: result.stats.availableWindowCount,
		requests: result.stats.requestCount,
		cachedRequests: result.stats.cachedRequests,
		failedWindows: result.stats.failedWindows,
		candidates: result.stats.candidateCount,
		failures: result.failures.length,
		promptTokens: result.stats.promptTokens,
		completionTokens: result.stats.completionTokens,
		reasoningTokens: result.stats.reasoningTokens,
		verified: verification.checked - verification.failures.length,
	});
	console.log(
		`${storyId}：${result.questions.length} 题（候选 ${result.stats.candidateCount}，窗口 ${result.stats.windowCount}/${result.stats.availableWindowCount}，请求 ${result.stats.requestCount}，缓存命中 ${result.stats.cachedRequests}，思考 token ${result.stats.reasoningTokens}），核对全部一致。`,
	);
}

const generatedAt = new Date().toISOString();
const spotcheckCount = Math.max(1, Math.round(allQuestions.length * 0.2));
const spotcheck = sampleDeterministic(allQuestions, spotcheckCount);
const spotcheckPath = eventSpotcheckPath(outputRoot, onlyStory);
const summaryPath = eventSummaryPath(outputRoot, onlyStory);
await mkdir(outputRoot, { recursive: true });
await writeFile(
	spotcheckPath,
	renderSpotcheck(spotcheck, allQuestions.length, excerptsByNode, generatedAt),
	"utf8",
);
await writeFile(
	summaryPath,
	`${JSON.stringify(
		{
			generatedAt,
			baseUrl,
			model,
			requestsPerMinute,
			reasoningEffort: reasoningEffort ?? null,
			stories: summaries,
			totalQuestions: allQuestions.length,
			spotcheckCount,
		},
		null,
		2,
	)}\n`,
	"utf8",
);
console.log(`事件题已写入 ${outputRoot}`);
console.log(`抽查文件：${spotcheckPath}（${spotcheckCount} 题）`);
console.log(`汇总：${summaryPath}`);

async function collectEvidenceExcerpts(
	chatPath: string,
	questions: readonly EventQuestion[],
	idPrefix: string,
): Promise<Map<string, EvidenceExcerpt>> {
	const wanted = new Set<string>();
	for (const question of questions) {
		for (const nodeId of question.evidenceNodes) wanted.add(nodeId);
	}
	const found = new Map<string, EvidenceExcerpt>();
	if (wanted.size === 0) return found;
	for await (const entry of parseChatJsonlFile(chatPath)) {
		if (entry.kind === "header") continue;
		const nodeId = messageNodeId(idPrefix, entry.message);
		if (!wanted.has(nodeId)) continue;
		found.set(nodeId, {
			nodeId,
			name: entry.message.name,
			text: entry.message.text,
		});
		if (found.size === wanted.size) break;
	}
	return found;
}

/** 支持 `--story <id>` 与 `--story=<id>`，用于只重跑一个对话。 */
function readStoryFilter(args: readonly string[]): string | undefined {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--story") {
			const value = args[index + 1];
			if (!value) throw new Error("--story 后面缺少故事名");
			return value;
		}
		if (arg?.startsWith("--story=")) {
			const value = arg.slice("--story=".length);
			if (!value) throw new Error("--story= 后面缺少故事名");
			return value;
		}
	}
	return undefined;
}

function requireEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(
			`环境变量 ${name} 没有设置；请在仓库根目录的 .env 里填写后台渠道`,
		);
	}
	return value;
}

function optionalInt(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${name} 必须是非负整数`);
	}
	return value;
}

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}
