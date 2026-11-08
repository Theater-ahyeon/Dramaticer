import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
	type LlmChannelsConfig,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	StoryStore,
	createEventStream,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import { runForgettingReportCli } from "../src/evalset/forgetting-report-cli.js";
import {
	type ForgettingCorpus,
	type ForgettingRunResult,
	parseForgettingRun,
	renderForgettingReport,
	summarizeForgettingRuns,
} from "../src/evalset/forgetting.js";
import { runPlaytestCli } from "../src/evalset/playtest-cli.js";

const STORY_ID = "forgetting-story";
const CARD_PROMPT = "你扮演守塔人，用冷静的旁白叙述。";
const REPLY = "灯室的玻璃上全是水汽。";
/** root + 59 组（玩家、助手）共 119 楼，最后一个节点是助手楼层。 */
const BRANCH_DEPTH = 119;

const USAGE: LlmUsage = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

const createdDirs: string[] = [];

afterEach(() => {
	for (const dir of createdDirs.splice(0)) {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
});

function makeDir(): string {
	return mkdtempSync(path.join(import.meta.dirname, ".tmp-forgetting-"));
}

function makeResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake",
		usage: USAGE,
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: text.length === 0 ? null : { text, reasoning: "" },
	};
}

function lastUserText(request: LlmRequest): string {
	const last = request.messages.at(-1)?.content;
	return typeof last === "string" ? last : "";
}

interface FakeClients {
	readonly writer: LlmStreamingClient;
	readonly user: LlmStreamingClient;
	readonly judge: LlmStreamingClient;
	readonly writerRequests: LlmRequest[];
	readonly judgeRequests: LlmRequest[];
}

function createClients(): FakeClients {
	const writerRequests: LlmRequest[] = [];
	const judgeRequests: LlmRequest[] = [];
	const writer: LlmStreamingClient = {
		async complete(request) {
			writerRequests.push(request);
			const content = lastUserText(request);
			if (content.includes("下面这个问题用来检验")) {
				return makeResult("我记得是厨房门后的铜钉。");
			}
			return makeResult(REPLY);
		},
		stream(request) {
			writerRequests.push(request);
			return createEventStream(async (emit) => {
				emit({ type: "text_delta", delta: REPLY });
				return makeResult(REPLY);
			});
		},
	};
	const user: LlmStreamingClient = {
		async complete() {
			return makeResult(JSON.stringify({ message: "我继续往前看。" }));
		},
		stream() {
			const text = JSON.stringify({ message: "我继续往前看。" });
			return createEventStream(async (emit) => {
				emit({ type: "text_delta", delta: text });
				return makeResult(text);
			});
		},
	};
	const judge: LlmStreamingClient = {
		async complete(request) {
			judgeRequests.push(request);
			const content = lastUserText(request);
			if (content.includes("钥匙原本挂在哪里")) {
				return makeResult('{"consistent":true,"reason":"与证据一致"}');
			}
			if (content.includes("潮汐钟为什么走慢")) {
				return makeResult('{"consistent":false,"reason":"与证据矛盾"}');
			}
			if (content.includes("灯塔里住着几个海妖")) {
				return makeResult('{"consistent":false,"reason":"编造了不存在的事物"}');
			}
			return makeResult('{"consistent":"unknown","reason":"没有依据"}');
		},
		stream() {
			throw new Error("裁判不使用流式");
		},
	};
	return { writer, user, judge, writerRequests, judgeRequests };
}

function seedStory(dir: string): { dbPath: string; branchNodeId: string } {
	const dbPath = path.join(dir, "story.db");
	const store = StoryStore.open(dbPath);
	store.createStory({ id: STORY_ID, title: "遗忘测试" });
	store.updateStorySettings(STORY_ID, {
		characterPrompt: CARD_PROMPT,
		persona: "你是随船来的记录员。",
	});
	let parentId: string | null = null;
	store.appendNode({
		id: "floor-0",
		storyId: STORY_ID,
		parentId: null,
		role: "assistant",
		raw: "灯塔的门开着。",
	});
	parentId = "floor-0";
	for (let index = 1; index <= 59; index += 1) {
		const user = store.appendNode({
			id: `user-${index}`,
			storyId: STORY_ID,
			parentId,
			role: "user",
			raw: `第 ${index} 次询问。`,
		});
		const assistant = store.appendNode({
			id: `assistant-${index}`,
			storyId: STORY_ID,
			parentId: user.id,
			role: "assistant",
			raw: `第 ${index} 次回答。`,
		});
		parentId = assistant.id;
	}
	const branchNodeId = parentId;
	store.appendNode({
		id: "future-user",
		storyId: STORY_ID,
		parentId: branchNodeId,
		role: "user",
		raw: "旁支的提问。",
	});
	store.appendNode({
		id: "future-assistant",
		storyId: STORY_ID,
		parentId: "future-user",
		role: "assistant",
		raw: "旁支的回答。",
	});
	store.close();
	return { dbPath, branchNodeId };
}

function writeQuestionFile(dir: string): string {
	const questions = [
		{
			id: "q-consistent",
			story: STORY_ID,
			askAtNode: "floor-0",
			question: "厨房的备用钥匙原本挂在哪里？",
			answer: "厨房门后的第三枚铜钉上。",
			evidenceNodes: ["floor-0"],
			category: "extraction",
			kind: "memory",
			fabricated: false,
		},
		{
			id: "q-contradicted",
			story: STORY_ID,
			askAtNode: "floor-0",
			question: "潮汐钟为什么走慢？",
			answer: "它的摆锤被盐雾锈住。",
			evidenceNodes: ["assistant-1"],
			category: "cross_segment",
			kind: "memory",
			fabricated: false,
		},
		{
			id: "q-fabricated",
			story: STORY_ID,
			askAtNode: "floor-0",
			question: "灯塔里住着几个海妖？",
			answer: "灯塔里没有海妖。",
			evidenceNodes: ["floor-0"],
			category: "abstention",
			kind: "memory",
			fabricated: true,
		},
		{
			id: "q-off-path",
			story: STORY_ID,
			askAtNode: "floor-0",
			question: "旁支楼层里出现了什么？",
			answer: "没有记录。",
			evidenceNodes: ["future-assistant"],
			category: "abstention",
			kind: "memory",
			fabricated: false,
		},
	];
	const filePath = path.join(dir, "questions.jsonl");
	writeFileSync(
		filePath,
		`${questions.map((question) => JSON.stringify(question)).join("\n")}\n`,
		"utf8",
	);
	return filePath;
}

function fakeConfig(): LlmChannelsConfig {
	const channel = (id: string) => ({
		id,
		api: "openai-completions" as const,
		baseUrl: "http://127.0.0.1:1234",
		apiKey: "",
		requestsPerMinute: 0,
		maxRetries: 0,
		retryBaseDelayMs: 0,
		timeoutMs: 1_000,
	});
	const model = (alias: string) => ({
		alias,
		id: "fake-model",
		channels: [alias],
		contextWindow: 8_192,
		maxTokens: 1_024,
		reasoning: true,
		enabled: true,
		tools: null,
		probe: null,
	});
	return {
		channels: new Map([
			["main", channel("main")],
			["background", channel("background")],
			["judge", channel("judge")],
		]),
		models: new Map([
			["main", model("main")],
			["background", model("background")],
			["judge", model("judge")],
		]),
		roles: new Map(),
		embeddings: new Map(),
	};
}

describe("长对话遗忘评测", () => {
	it("从指定分支点生成，并在最终 head 上提问、跳过路径外证据", async () => {
		const dir = makeDir();
		createdDirs.push(dir);
		const { dbPath, branchNodeId } = seedStory(dir);
		const questionPath = writeQuestionFile(dir);
		const clients = createClients();
		const outPath = path.join(dir, "playtest.jsonl");
		const questionsOut = path.join(dir, "forgetting.json");
		await runPlaytestCli(
			[
				"--db",
				dbPath,
				"--story",
				STORY_ID,
				"--head",
				branchNodeId,
				"--rounds",
				"2",
				"--model",
				"main",
				"--user-model",
				"background",
				"--judge-model",
				"judge",
				"--probe-every",
				"0",
				"--no-background",
				"--out",
				outPath,
				"--memory-questions",
				questionPath,
				"--questions-out",
				questionsOut,
			],
			{
				loadEnv: () => undefined,
				loadConfig: async () => fakeConfig(),
				createClient: (_config, alias) =>
					alias === "judge"
						? clients.judge
						: alias === "background"
							? clients.user
							: clients.writer,
				log: () => undefined,
			},
		);
		const run = parseForgettingRun(
			JSON.parse(readFileSync(questionsOut, "utf8")),
		);
		expect(run.story).toBe(STORY_ID);
		expect(run.headNodeId).toBe(branchNodeId);
		expect(run.profile).toBe("native");
		expect(run.startDepth).toBe(BRANCH_DEPTH);
		expect(run.endDepth).toBe(BRANCH_DEPTH + 4);
		expect(run.completedRounds).toBe(2);
		expect(run.failedRounds).toBe(0);
		const byId = new Map(run.questions.map((record) => [record.id, record]));
		expect(byId.get("q-consistent")).toMatchObject({
			status: "done",
			verdict: "consistent",
			askedAtNode: expect.any(String),
		});
		expect(byId.get("q-contradicted")?.verdict).toBe("contradicted");
		expect(byId.get("q-fabricated")).toMatchObject({
			verdict: "contradicted",
			fabricatedQuestion: true,
			fabricated: true,
		});
		expect(byId.get("q-off-path")).toMatchObject({
			status: "skipped",
			verdict: null,
		});
		expect(clients.judgeRequests).toHaveLength(3);
		const store = StoryStore.open(dbPath);
		const head = store.getHead(STORY_ID);
		expect(head?.id).not.toBe(branchNodeId);
		expect(store.getPathToNode(branchNodeId)).toHaveLength(BRANCH_DEPTH);
		const askedNodes = new Set(
			run.questions
				.filter((record) => record.status === "done")
				.map((record) => record.askedAtNode),
		);
		expect(askedNodes.size).toBe(1);
		expect([...askedNodes][0]).toBe(head?.id);
		store.close();
	}, 30_000);

	it("分层聚合给出矛盾率、编造率与同题遗忘趋势", () => {
		const shallow = syntheticRun({
			story: "shallow-story",
			startDepth: 150,
			records: [
				questionRecord("q1", "consistent"),
				questionRecord("q2", "contradicted"),
			],
		});
		const deep = syntheticRun({
			story: "deep-story",
			startDepth: 350,
			records: [
				questionRecord("q1", "contradicted"),
				questionRecord("q2", "contradicted"),
				questionRecord("q3", "contradicted", { fabricatedQuestion: true }),
			],
		});
		const summary = summarizeForgettingRuns([shallow, deep]);
		expect(summary.layers.map((layer) => layer.depthLayer)).toEqual([
			"100-199",
			"300+",
		]);
		const shallowLayer = summary.layers[0];
		const deepLayer = summary.layers[1];
		if (shallowLayer === undefined || deepLayer === undefined) {
			throw new Error("缺少分层");
		}
		expect(shallowLayer.contradictionRate).toBeCloseTo(0.5);
		expect(deepLayer.contradictionRate).toBe(1);
		expect(shallowLayer.fabricatedRate).toBe(0);
		expect(deepLayer.fabricatedRate).toBe(1);
		const trend = summary.trends[0];
		expect(trend?.profile).toBe("native");
		expect(trend?.layers.map((layer) => layer.depthLayer)).toEqual([
			"100-199",
			"300+",
		]);
		expect(trend?.rising).toBe(true);
		expect(trend?.margin).toBeCloseTo(0.5);
		const publicReport = renderForgettingReport(summary, {
			privateDetails: false,
		});
		expect(publicReport).toContain("100-199");
		expect(publicReport).toContain("上升");
		expect(publicReport).not.toContain("shallow-story");
		expect(publicReport).not.toContain("deep-story");
		expect(publicReport).not.toContain("q1");
		const privateReport = renderForgettingReport(summary, {
			privateDetails: true,
			runs: [shallow, deep],
		});
		expect(privateReport).toContain("shallow-story");
		expect(privateReport).toContain("q1");
	});

	it("两种来源在报告里分开成行，统计版只出现来源标签", () => {
		const benchmark = syntheticRun({
			story: "benchmark-story",
			startDepth: 150,
			records: [questionRecord("q1", "contradicted")],
			corpus: "benchmark",
		});
		const legacy = syntheticRun({
			story: "private-legacy-story",
			startDepth: 250,
			records: [questionRecord("q1", "consistent")],
			corpus: "legacy",
		});
		const summary = summarizeForgettingRuns([benchmark, legacy]);
		expect(
			summary.layers.map((layer) => `${layer.corpus}|${layer.depthLayer}`),
		).toEqual(["benchmark|100-199", "legacy|200-299"]);
		const publicReport = renderForgettingReport(summary, {
			privateDetails: false,
		});
		expect(publicReport).toContain("公开基准");
		expect(publicReport).toContain("legacy 对话");
		expect(publicReport).not.toContain("benchmark-story");
		expect(publicReport).not.toContain("private-legacy-story");
		const legacyJson = Object.fromEntries(
			Object.entries(legacy).filter(([key]) => key !== "corpus"),
		);
		expect(parseForgettingRun(legacyJson).corpus).toBe("benchmark");
	});

	it("报告命令行读取运行目录并分别写出私有版与统计版", async () => {
		const dir = makeDir();
		createdDirs.push(dir);
		const runs = [
			syntheticRun({
				story: "private-story-a",
				startDepth: 120,
				records: [questionRecord("q1", "contradicted")],
			}),
			syntheticRun({
				story: "private-story-b",
				startDepth: 320,
				records: [questionRecord("q1", "contradicted")],
			}),
		];
		const inputDir = path.join(dir, "runs");
		await mkdir(inputDir, { recursive: true });
		for (const [index, run] of runs.entries()) {
			writeFileSync(
				path.join(inputDir, `run-${index}.json`),
				`${JSON.stringify(run, null, 2)}\n`,
				"utf8",
			);
		}
		const privateReportPath = path.join(dir, "private.md");
		const publicReportPath = path.join(dir, "public.md");
		const result = await runForgettingReportCli(
			[
				"--input",
				inputDir,
				"--private-out",
				privateReportPath,
				"--public-out",
				publicReportPath,
			],
			{ log: () => undefined },
		);
		expect(result.runCount).toBe(2);
		const publicText = readFileSync(publicReportPath, "utf8");
		const privateText = readFileSync(privateReportPath, "utf8");
		expect(publicText).toContain("## 分层结果");
		expect(publicText).not.toContain("private-story");
		expect(privateText).toContain("private-story-a");
		expect(privateText).toContain("private-story-b");
	});
});

function questionRecord(
	id: string,
	verdict: "consistent" | "contradicted",
	overrides: Partial<ForgettingRunResult["questions"][number]> = {},
): ForgettingRunResult["questions"][number] {
	return {
		kind: "memory",
		id,
		category: "extraction",
		status: "done",
		askedAtNode: "node-head",
		answer: "回答",
		verdict,
		fabricatedQuestion: false,
		fabricated: false,
		reason: "理由",
		judgeAttempts: 1,
		error: null,
		answerUsage: USAGE,
		judgeUsage: USAGE,
		...overrides,
	};
}

function syntheticRun(options: {
	readonly story: string;
	readonly startDepth: number;
	readonly records: ForgettingRunResult["questions"];
	readonly corpus?: ForgettingCorpus;
}): ForgettingRunResult {
	return {
		story: options.story,
		corpus: options.corpus ?? "benchmark",
		headNodeId: `${options.story}:head`,
		profile: "native",
		model: "rp",
		userModel: "background",
		judgeModel: "judge",
		seed: 1,
		startDepth: options.startDepth,
		endDepth: options.startDepth + 40,
		rounds: 20,
		completedRounds: 20,
		failedRounds: 0,
		generatedAt: "2026-11-07T00:00:00.000Z",
		playtestPath: null,
		inRunProbes: {
			done: 0,
			consistent: 0,
			contradicted: 0,
			unknown: 0,
			failed: 0,
			skipped: 0,
		},
		questions: options.records,
	};
}
