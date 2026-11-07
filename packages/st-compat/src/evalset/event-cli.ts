import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type LlmReasoningLevel,
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
	resolveModelForRole,
} from "@dramaticer/core";
import { parseChatJsonlFile } from "../chat-jsonl.js";
import { isLegacyCorpus, openSnapshot } from "../health/manifest.js";
import { messageNodeId } from "../node-id.js";
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
const channelsPath = path.join(repoRoot, "data", "channels.yaml");
const channels = await loadChannelsConfig(channelsPath);
const modelAlias = resolveModelForRole(channels, "settler");
const model = channels.models.get(modelAlias);
if (model === undefined) {
	throw new Error(`渠道配置里没有模型 ${modelAlias}`);
}
const client = createLlmClient(channels, {
	defaultModel: modelAlias,
	cacheDir,
});
const reasoning = parseReasoning(process.env.DRAMATICER_BG_REASONING_EFFORT);
const onlyStory = readStoryFilter(process.argv.slice(2));
const questionsPerWindow = optionalInt(
	"DRAMATICER_EVAL_QUESTIONS_PER_WINDOW",
	5,
);
const maxWindows = optionalInt("DRAMATICER_EVAL_MAX_WINDOWS", 24);
const maxWindowChars = optionalInt("DRAMATICER_EVAL_MAX_WINDOW_CHARS", 24_000);
const maxTokens = optionalInt("DRAMATICER_EVAL_MAX_TOKENS", 4_096);

const snapshot = await openSnapshot(rawRoot);
const allChatFiles = snapshot.filesByRole("chat").filter(isLegacyCorpus);
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
	const chatPath = await snapshot.resolveFile(file);

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
		...(reasoning === undefined ? {} : { reasoning }),
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
			model: model.id,
			channels: model.channels,
			reasoning: reasoning ?? null,
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

const REASONING_LEVELS: readonly LlmReasoningLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

function parseReasoning(
	value: string | undefined,
): LlmReasoningLevel | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	if (!isReasoningLevel(trimmed)) {
		throw new Error(
			`DRAMATICER_BG_REASONING_EFFORT 只能是 ${REASONING_LEVELS.join("、")}`,
		);
	}
	return trimmed;
}

function isReasoningLevel(value: string): value is LlmReasoningLevel {
	return REASONING_LEVELS.some((level) => level === value);
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
