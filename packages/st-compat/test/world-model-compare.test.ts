import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	StoryStore as StoryStoreClass,
	createDefaultContextTemplate,
	createEventStream,
	createWorldModel,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryQuestion } from "../src/evalset/memory-questions.js";
import {
	WORLD_MODEL_COMPARE_FORMAT,
	formatWorldModelCompareReport,
	runWorldModelCompare,
} from "../src/evalset/world-model-compare.js";

const STORY = "world-model-compare-test";
const createdDirs: string[] = [];

afterEach(() => {
	for (const dir of createdDirs.splice(0)) {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 200,
		});
	}
});

function makeDir(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "world-model-compare-"));
	createdDirs.push(dir);
	return dir;
}

const USAGE: LlmUsage = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

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
		continuation: null,
	};
}

function joined(request: LlmRequest): string {
	return request.messages.map((message) => message.content).join("\n");
}

function lastUser(request: LlmRequest): string {
	return (
		request.messages.filter((message) => message.role === "user").at(-1)
			?.content ?? ""
	);
}

function roundOf(request: LlmRequest): string {
	const match = lastUser(request).match(/第\s*(\d+)\s*轮/);
	return match?.[1] ?? "0";
}

function candidateMarker(request: LlmRequest): string {
	const text = joined(request);
	if (text.includes("档案：")) return "档案版";
	if (text.includes("已失效事实")) return "时序版";
	return "台账版";
}

function playReply(request: LlmRequest): string {
	const round = roundOf(request);
	return `${candidateMarker(request)}：<state_update>{"path":["character","凛","status"],"op":"set","value":"状态 ${round}"}</state_update>\n第 ${round} 轮正文`;
}

function questionReply(request: LlmRequest): string {
	if (lastUser(request).includes("从未发生")) return "是的，他见过这个人。";
	return "他是剑客。";
}

interface FakeWriter {
	readonly client: LlmStreamingClient;
	readonly stats: { streams: number; completes: number };
}

function fakeWriter(options: { failOnProfile?: boolean } = {}): FakeWriter {
	const stats = { streams: 0, completes: 0 };
	return {
		stats,
		client: {
			async complete(request) {
				stats.completes += 1;
				return makeResult(questionReply(request));
			},
			stream(request) {
				stats.streams += 1;
				if (
					options.failOnProfile === true &&
					joined(request).includes("档案：")
				) {
					throw new Error("模拟第 2 轮失败");
				}
				const text = playReply(request);
				return createEventStream(async (emit) => {
					emit({ type: "text_delta", delta: text });
					return makeResult(text);
				});
			},
		},
	};
}

function fakeJudge(): LlmClient {
	return {
		async complete(request) {
			const content = request.messages.map((m) => m.content).join("\n");
			if (content.includes("两个版本")) {
				const firstStart = content.indexOf("续写甲：");
				const secondStart = content.indexOf("续写乙：");
				const first = content.slice(firstStart, secondStart);
				const second = content.slice(secondStart);
				const firstProfile = first.includes("档案版");
				const secondProfile = second.includes("档案版");
				let winner: "A" | "B" | "tie" = "tie";
				if (firstProfile && !secondProfile) winner = "A";
				else if (secondProfile && !firstProfile) winner = "B";
				return makeResult(
					JSON.stringify({ winner, reason: "测试固定偏向档案版" }),
				);
			}
			const consistent = !content.includes("从未发生");
			return makeResult(
				JSON.stringify({
					consistent,
					reason: consistent ? "与台账一致" : "捏造了不存在的事实",
				}),
			);
		},
	};
}

function buildSourceDb(dir: string): {
	readonly dbPath: string;
	readonly nodeId: string;
} {
	const dbPath = path.join(dir, "source.db");
	const store = StoryStoreClass.open(dbPath);
	store.createStory({ id: STORY, title: "世界模型对比" });
	store.updateStorySettings(STORY, {
		cardName: "凛",
		characterPrompt: "你是凛，一名剑客。",
		maxTokens: 256,
		temperature: 0,
	});
	const root = store.appendNode({
		storyId: STORY,
		parentId: null,
		role: "user",
		raw: "开场",
	});
	const assistant = store.appendNode({
		storyId: STORY,
		parentId: root.id,
		role: "assistant",
		raw: "开场正文",
	});
	store.setHead(STORY, assistant.id);
	createWorldModel(store, "ledger").write(assistant.id, [
		{
			path: ["character", "凛", "identity"],
			op: "set",
			value: "剑客",
			source: "import",
			storyTime: { start: "第一天", end: null },
		},
		{
			path: ["character", "凛", "status"],
			op: "set",
			value: "平静",
			source: "import",
		},
		{
			path: ["relation", "凛", "我", "stage"],
			op: "set",
			value: "初识",
			source: "import",
		},
	]);
	store.close();
	return { dbPath, nodeId: assistant.id };
}

function questions(nodeId: string): MemoryQuestion[] {
	return [
		{
			id: "q-identity",
			story: STORY,
			askAtNode: nodeId,
			question: "凛的身份是什么？",
			answer: "剑客",
			evidenceNodes: [nodeId],
			category: "extraction",
			fabricated: false,
		},
		{
			id: "q-fabricated",
			story: STORY,
			askAtNode: nodeId,
			question: "凛是否见过从未发生的人物？",
			answer: "没有记录",
			evidenceNodes: [nodeId],
			category: "abstention",
			fabricated: true,
		},
	];
}

function compareOptions(input: {
	readonly dir: string;
	readonly dbPath: string;
	readonly nodeId: string;
	readonly writer: FakeWriter;
}) {
	return {
		sourceDbPath: input.dbPath,
		story: STORY,
		rounds: 2,
		messages: ["第 1 轮：我走进客栈。", "第 2 轮：我问他叫什么名字。"],
		repetitions: 1,
		dir: input.dir,
		writer: { client: input.writer.client, model: "fake-writer" },
		judge: { client: fakeJudge(), model: "fake-judge" },
		template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
		budgetTokens: 4_000,
		structuredOutput: "text-tags" as const,
		questions: questions(input.nodeId),
		probeCount: 1,
		timeProbeCount: 1,
		seed: 1,
		maxTokens: 256,
		temperature: 0,
	};
}

describe("world-model-compare", () => {
	it("三种候选产出同一格式的指标表，并记录重复次数与时间点探针能力", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const runDir = path.join(dir, "run");
		const writer = fakeWriter();
		const report = await runWorldModelCompare(
			compareOptions({
				dir: runDir,
				dbPath: source.dbPath,
				nodeId: source.nodeId,
				writer,
			}),
		);

		expect(report.format).toBe(WORLD_MODEL_COMPARE_FORMAT);
		expect(report.story).toBe(STORY);
		expect(report.rounds).toBe(2);
		expect(report.repetitions).toBe(1);
		expect(report.candidates.map((candidate) => candidate.kind)).toEqual([
			"ledger",
			"wiki",
			"temporal_graph",
		]);
		for (const candidate of report.candidates) {
			expect(candidate.completedRuns).toBe(1);
			expect(candidate.failedRuns).toEqual([]);
			expect(candidate.repetitions).toBe(1);
			expect(candidate.samples.rounds).toBe(2);
			expect(candidate.samples.requests).toBe(2);
			expect(candidate.samples.probes).toBe(1);
			expect(candidate.samples.questions).toBe(2);
			expect(candidate.cost.requestsPerRound).toBe(1);
			expect(candidate.cost.firstTokenMs?.count).toBe(2);
		}
		const ledger = report.candidates[0];
		const wiki = report.candidates[1];
		const temporal = report.candidates[2];
		expect(ledger?.samples.timeProbesUnsupported).toBe(1);
		expect(wiki?.samples.timeProbesUnsupported).toBe(1);
		expect(temporal?.samples.timeProbesUnsupported).toBe(0);
		expect(temporal?.samples.timeProbesJudged).toBe(1);
		expect(ledger?.blindWinRate).toBeNull();
		expect(wiki?.blindWinRate).toBe(1);
		expect(wiki?.samples.blindWins).toBe(2);
		expect(wiki?.samples.blindLosses).toBe(0);
		expect(wiki?.fabricatedRecallRate).toBe(1);
		for (const run of report.runs) {
			expect(run.status).toBe("done");
		}
		expect(existsSync(path.join(runDir, "runs", "ledger", "1.json"))).toBe(
			true,
		);
		expect(existsSync(path.join(runDir, "runs", "wiki", "1.json"))).toBe(true);
		expect(
			existsSync(path.join(runDir, "runs", "temporal_graph", "1.json")),
		).toBe(true);
		const markdown = formatWorldModelCompareReport(report);
		expect(markdown).toContain("|ledger|1/0|2|");
		expect(markdown).toContain("时间点探针");
	});

	it("重跑时复用 sidecar，不再调用写作模型", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const runDir = path.join(dir, "run");
		const first = fakeWriter();
		const options = compareOptions({
			dir: runDir,
			dbPath: source.dbPath,
			nodeId: source.nodeId,
			writer: first,
		});
		await runWorldModelCompare(options);
		expect(first.stats.streams).toBe(6);
		expect(first.stats.completes).toBeGreaterThan(0);

		const second = fakeWriter();
		await runWorldModelCompare({
			...options,
			writer: { client: second.client, model: "fake-writer" },
		});
		expect(second.stats.streams).toBe(0);
		expect(second.stats.completes).toBe(0);
	});

	it("单个候选失败不影响其他候选的结果", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const writer = fakeWriter({ failOnProfile: true });
		const report = await runWorldModelCompare(
			compareOptions({
				dir: path.join(dir, "run"),
				dbPath: source.dbPath,
				nodeId: source.nodeId,
				writer,
			}),
		);
		const ledger = report.candidates[0];
		const wiki = report.candidates[1];
		const temporal = report.candidates[2];
		expect(ledger?.completedRuns).toBe(1);
		expect(ledger?.failedRuns).toEqual([]);
		expect(temporal?.completedRuns).toBe(1);
		expect(temporal?.failedRuns).toEqual([]);
		expect(wiki?.completedRuns).toBe(0);
		expect(wiki?.failedRuns).toHaveLength(1);
		expect(wiki?.failedRuns[0]?.error).toContain("第 2 轮失败");
		expect(ledger?.samples.rounds).toBe(2);
		expect(temporal?.samples.timeProbesJudged).toBe(1);
		const markdown = formatWorldModelCompareReport(report);
		expect(markdown).toContain("wiki 第 1 次失败");
	});
});
