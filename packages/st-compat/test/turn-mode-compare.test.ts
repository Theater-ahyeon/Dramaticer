import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type LlmCallOptions,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmToolCall,
	type LlmUsage,
	StoryStore as StoryStoreClass,
	createDefaultContextTemplate,
	createEventStream,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import type { R6InstrumentGateInput } from "../src/evalset/gates.js";
import {
	TURN_MODE_COMPARE_FORMAT,
	formatTurnModeCompareReport,
	runTurnModeCompare,
} from "../src/evalset/turn-mode-compare.js";

const STORY = "turn-mode-compare-test";
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
	const dir = mkdtempSync(path.join(tmpdir(), "turn-mode-compare-"));
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

function makeResult(text: string, toolCalls: readonly LlmToolCall[] = []) {
	return {
		text,
		reasoning: "",
		toolCalls,
		finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
		stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
		model: "fake-model",
		channel: "fake",
		usage: USAGE,
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: text.length > 0 ? { text, reasoning: "" } : null,
	} satisfies LlmResult;
}

function joined(request: LlmRequest): string {
	return request.messages.map((message) => message.content).join("\n");
}

function roundOf(request: LlmRequest): number {
	const match = joined(request).match(/第\s*(\d+)\s*轮/);
	return match === null ? 0 : Number(match[1]);
}

interface FakeWriter {
	readonly client: LlmStreamingClient;
	readonly stats: {
		streams: number;
		completes: number;
		requests: LlmRequest[];
	};
}

function fakeWriter(): FakeWriter {
	const stats = { streams: 0, completes: 0, requests: [] as LlmRequest[] };
	return {
		stats,
		client: {
			async complete(request) {
				stats.completes += 1;
				stats.requests.push(request);
				const content = joined(request);
				if (content.includes("请回忆")) return makeResult("他站在门口。");
				if (content.includes("挑出这一轮最可能用到的条目")) {
					return makeResult("[]");
				}
				if (content.includes("一个人此刻想做什么")) {
					return makeResult("凛：想把门推开。");
				}
				if (content.includes("写出下一楼的计划")) {
					return makeResult(`计划 第 ${roundOf(request)} 轮。`);
				}
				return makeResult("补充材料。");
			},
			stream(request, _options?: LlmCallOptions) {
				stats.streams += 1;
				stats.requests.push(request);
				const content = joined(request);
				const round = roundOf(request);
				if (content.includes("交稿前自查")) {
					const toolMessages = request.messages.filter(
						(message) => message.role === "tool",
					).length;
					if (toolMessages === 0) {
						const call: LlmToolCall = {
							id: `w${round}`,
							name: "file_write",
							arguments: {
								path: "草稿.md",
								text: `深度正文 第 ${round} 轮。`,
							},
						};
						return createEventStream(async () => makeResult("", [call]));
					}
					const call: LlmToolCall = {
						id: `c${round}`,
						name: "commit_draft",
						arguments: {},
					};
					return createEventStream(async () => makeResult("", [call]));
				}
				const text = content.includes("【本轮准备】")
					? `规划正文 第 ${round} 轮。`
					: `快速正文 第 ${round} 轮。`;
				return createEventStream(async (emit) => {
					emit({ type: "text_delta", delta: text });
					return makeResult(text);
				});
			},
		},
	};
}

function fakeJudge(): LlmClient & { calls: number } {
	const client = {
		calls: 0,
		async complete(request: LlmRequest) {
			client.calls += 1;
			const content = joined(request);
			const firstStart = content.indexOf("续写甲：");
			const secondStart = content.indexOf("续写乙：");
			if (firstStart >= 0 && secondStart > firstStart) {
				const first = content.slice(firstStart, secondStart);
				const second = content.slice(secondStart);
				const firstFast = first.includes("快速正文");
				const secondFast = second.includes("快速正文");
				if (firstFast && !secondFast) {
					return makeResult(
						JSON.stringify({ winner: "B", reason: "乙不是快速写法" }),
					);
				}
				if (!firstFast && secondFast) {
					return makeResult(
						JSON.stringify({ winner: "A", reason: "甲不是快速写法" }),
					);
				}
				return makeResult(
					JSON.stringify({ winner: "tie", reason: "两份无法区分" }),
				);
			}
			return makeResult(
				JSON.stringify({ consistent: true, reason: "与台账一致" }),
			);
		},
	};
	return client;
}

function validInstrument(): R6InstrumentGateInput {
	return {
		sameConfig: {
			plannedPairs: 44,
			pairs: { wins: 18, losses: 18, ties: 4, inconsistent: 2 },
			failures: 0,
			judgments: { completed: 88, failed: 0 },
		},
		humanLabels: {
			plannedPairs: 200,
			completedPairs: 170,
			acceptedChoices: 300,
			judgments: 340,
			positionA: 170,
			failures: 0,
		},
	};
}

function invalidInstrument(): R6InstrumentGateInput {
	return {
		sameConfig: {
			plannedPairs: 0,
			pairs: { wins: 0, losses: 0, ties: 0, inconsistent: 0 },
			failures: 0,
			judgments: { completed: 0, failed: 0 },
		},
		humanLabels: {
			plannedPairs: 0,
			completedPairs: 0,
			acceptedChoices: 0,
			judgments: 0,
			positionA: 0,
			failures: 0,
		},
	};
}

function buildSourceDb(dir: string): string {
	const dbPath = path.join(dir, "source.db");
	const store = StoryStoreClass.open(dbPath);
	try {
		store.createStory({ id: STORY, title: "写法对照" });
		store.updateStorySettings(STORY, {
			characterPrompt: "你是测试角色。",
			maxTokens: 256,
			temperature: 0,
		});
		let parentId: string | null = null;
		const nodes: string[] = [];
		for (let index = 1; index <= 23; index += 1) {
			const role = index % 2 === 1 ? "assistant" : "user";
			const node = store.appendNode({
				storyId: STORY,
				parentId,
				role,
				raw: `${role === "assistant" ? "正文" : "玩家"} 第 ${index} 楼`,
			});
			nodes.push(node.id);
			parentId = node.id;
		}
		store.appendStateDiffs([
			{
				storyId: STORY,
				nodeId: nodes[2] as string,
				path: ["character", "凛", "status"],
				op: "set",
				value: "站在门口",
				source: "import",
			},
		]);
		store.saveSceneLog({
			nodeId: nodes[16] as string,
			storyId: STORY,
			beat: "试探",
			present: ["凛"],
			sceneEnds: false,
			sceneCard: null,
			bits: [],
			conditions: [],
			states: [],
			quotes: { submitted: 0, verified: 0 },
			repairs: [],
		});
		store.setHead(STORY, nodes[22] as string);
	} finally {
		store.close();
	}
	return dbPath;
}

function compareOptions(input: {
	readonly dir: string;
	readonly dbPath: string;
	readonly writer: FakeWriter;
	readonly judge: LlmClient;
	readonly instrument?: R6InstrumentGateInput;
}) {
	return {
		sourceDbPath: input.dbPath,
		story: STORY,
		rounds: 2,
		messages: ["第 1 轮：我推开门。", "第 2 轮：我问他为什么。"],
		repetitions: 1,
		dir: input.dir,
		writer: { client: input.writer.client, model: "fake-writer" },
		judge: { client: input.judge, model: "fake-judge" },
		template: createDefaultContextTemplate({
			structuredOutput: "function-call",
		}),
		budgetTokens: 4_000,
		structuredOutput: "function-call" as const,
		instrument: input.instrument ?? validInstrument(),
		branchFloors: [17],
		seed: 1,
		maxTokens: 256,
		temperature: 0,
	};
}

describe("turn-mode-compare", () => {
	it("三种写法给出胜率、矛盾率、每楼调用数与等待时间", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const writer = fakeWriter();
		const judge = fakeJudge();
		const report = await runTurnModeCompare(
			compareOptions({
				dir: path.join(dir, "run"),
				dbPath: source,
				writer,
				judge,
			}),
		);

		expect(report.format).toBe(TURN_MODE_COMPARE_FORMAT);
		expect(report.validity.status).toBe("pass");
		expect(report.branchPoints).toEqual([
			{ nodeId: expect.any(String), floor: 17 },
		]);
		expect(report.candidates.map((candidate) => candidate.mode)).toEqual([
			"fast",
			"plan",
			"deep",
		]);
		const fast = report.candidates[0];
		const plan = report.candidates[1];
		const deep = report.candidates[2];
		for (const candidate of report.candidates) {
			expect(candidate.completedRuns).toBe(1);
			expect(candidate.failedRuns).toEqual([]);
			expect(candidate.floors).toBe(2);
			expect(candidate.contradictionRate).toBe(0);
			expect(candidate.probes.done).toBe(1);
			expect(candidate.cost.durationMs?.count).toBe(2);
		}
		expect(fast?.winRate).toBeNull();
		expect(fast?.requestsPerFloor).toBe(1);
		expect(plan?.winRate).toBe(1);
		expect(plan?.requestsPerFloor).toBeGreaterThan(fast?.requestsPerFloor ?? 0);
		expect(deep?.winRate).toBe(1);
		expect(deep?.requestsPerFloor).toBe(2);
		expect(plan?.pairwise.records).toBe(4);
		expect(deep?.pairwise.records).toBe(4);
		const markdown = formatTurnModeCompareReport(report);
		expect(markdown).toContain("| 快速 | 1/0 | 2 | — |");
		expect(markdown).toContain("胜率");
		expect(markdown).toContain("矛盾率");
	});

	it("裁判未通过 G0 时直接失败，不调用写作或裁判", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const writer = fakeWriter();
		const judge = fakeJudge();
		await expect(
			runTurnModeCompare(
				compareOptions({
					dir: path.join(dir, "run"),
					dbPath: source,
					writer,
					judge,
					instrument: invalidInstrument(),
				}),
			),
		).rejects.toThrow("裁判未通过有效性检查");
		expect(writer.stats.streams).toBe(0);
		expect(writer.stats.completes).toBe(0);
		expect(judge.calls).toBe(0);
	});

	it("重跑复用已完成样本，不再调用写作模型", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const runDir = path.join(dir, "run");
		const options = compareOptions({
			dir: runDir,
			dbPath: source,
			writer: fakeWriter(),
			judge: fakeJudge(),
		});
		await runTurnModeCompare(options);
		const secondWriter = fakeWriter();
		await runTurnModeCompare({
			...options,
			writer: { client: secondWriter.client, model: "fake-writer" },
			judge: { client: fakeJudge(), model: "fake-judge" },
		});
		expect(secondWriter.stats.streams).toBe(0);
		expect(secondWriter.stats.completes).toBe(0);
	});
});
