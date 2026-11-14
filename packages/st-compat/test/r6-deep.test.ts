import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import {
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	StoryStore,
	createEventStream,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import type {
	DeepEvalBranchFailureRecord,
	DeepEvalBranchRecord,
	DeepEvalJudgement,
} from "../src/evalset/deep-eval.js";
import { R6_GATE_VERSION, evaluateR6Gates } from "../src/evalset/gates.js";
import {
	type R6DeepRunRecord,
	R6_DEEP_RUN_FORMAT,
	r6DeepGateInput,
	runR6Deep,
	summarizeR6Deep,
} from "../src/evalset/r6-deep.js";

const STORY_ID = "deep-batch-story";
const CARD_PROMPT = "你扮演守塔人，用冷静的旁观者口吻叙述。";

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
	const dir = mkdtempSync(path.join(import.meta.dirname, ".tmp-r6-deep-"));
	createdDirs.push(dir);
	return dir;
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

function createWriter(
	reply: (call: number) => string,
	failAt: (call: number) => boolean = () => false,
): { readonly client: LlmStreamingClient; readonly requests: LlmRequest[] } {
	const requests: LlmRequest[] = [];
	let call = 0;
	return {
		requests,
		client: {
			async complete(request) {
				requests.push(request);
				call += 1;
				if (failAt(call)) throw new Error("渠道失败");
				return makeResult(reply(call));
			},
			stream(request) {
				requests.push(request);
				call += 1;
				if (failAt(call)) {
					return createEventStream(async () => {
						throw new Error("渠道失败");
					});
				}
				const text = reply(call);
				return createEventStream(async (emit) => {
					for (const char of text) emit({ type: "text_delta", delta: char });
					return makeResult(text);
				});
			},
		},
	};
}

function createUser(): {
	readonly client: LlmStreamingClient;
	readonly requests: LlmRequest[];
} {
	return createWriter((call) =>
		JSON.stringify({ message: `第 ${call} 轮：我看向海面。` }),
	);
}

function createJudge(): {
	readonly client: LlmStreamingClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	return {
		requests,
		client: {
			async complete(request) {
				requests.push(request);
				const text = request.messages
					.map((message) => message.content)
					.join("\n");
				const first = text.indexOf("续写甲：");
				const second = text.indexOf("续写乙：");
				const firstText = text.slice(first, second);
				return makeResult(
					JSON.stringify({
						winner: firstText.includes("深版本") ? "A" : "B",
						reason: "深版本更完整",
					}),
				);
			},
			stream(request) {
				requests.push(request);
				return createEventStream(async () => makeResult("{}"));
			},
		},
	};
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: STORY_ID, title: "深回合批次" });
	store.updateStorySettings(STORY_ID, {
		characterPrompt: CARD_PROMPT,
		persona: "你是刚登上灯塔的记录员。",
	});
	store.appendNode({
		id: `${STORY_ID}-greeting`,
		storyId: STORY_ID,
		parentId: null,
		role: "assistant",
		raw: "灯室的玻璃上全是水汽。",
	});
}

describe("R6 深回合批次", () => {
	it("2 轮 × 2 个分支点跑通并给出配对结果", async () => {
		const dir = makeDir();
		const sourceDbPath = path.join(dir, "source.db");
		const source = StoryStore.open(sourceDbPath);
		seedStory(source);
		source.close();

		const writer = createWriter((call) =>
			call <= 2 ? `深版本 ${call}：灯塔的门开着。` : `快版本 ${call}：门开着。`,
		);
		const user = createUser();
		const judge = createJudge();
		const report = await runR6Deep({
			sourceDbPath,
			stories: [STORY_ID],
			rounds: 2,
			branches: 2,
			dir: path.join(dir, "runs"),
			writer: { client: writer.client, model: "main" },
			user: { client: user.client, model: "background" },
			judge: { client: judge.client, model: "judge" },
			background: { client: writer.client },
			structuredOutput: "text-tags",
			budgetTokens: 4_000,
			toolTransport: "native",
			maxTokens: 512,
			temperature: 0.8,
			seed: 1,
		});

		expect(writer.requests).toHaveLength(4);
		expect(judge.requests).toHaveLength(4);
		expect(report.gateVersion).toBe(R6_GATE_VERSION);
		expect(report.summary.plannedPairs).toBe(2);
		expect(report.summary.completedPairs).toBe(2);
		expect(report.summary.pairs).toEqual({
			wins: 2,
			losses: 0,
			ties: 0,
			inconsistent: 0,
		});
		expect(report.summary.failures).toBe(0);
		expect(report.summary.turns).toEqual({
			completed: 2,
			failed: 0,
			failureRate: 0,
			toolCalls: 0,
		});
		expect(report.runs[0]?.status).toBe("done");
		expect(report.runs[0]?.records).toHaveLength(4);
		expect(
			report.runs[0]?.records.filter((record) => record.kind === "branch"),
		).toHaveLength(2);

		const gate = evaluateR6Gates({
			instrument: {
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
			},
			replay: {
				abandoned: {
					plannedPairs: 0,
					pairs: { wins: 0, losses: 0, ties: 0, inconsistent: 0 },
					failures: 0,
					stories: [{ story: "placeholder", completedPairs: 0 }],
					judgments: { completed: 0, failed: 0 },
				},
				accepted: {
					plannedPairs: 0,
					pairs: { wins: 0, losses: 0, ties: 0, inconsistent: 0 },
					failures: 0,
					stories: [{ story: "placeholder", completedPairs: 0 }],
					judgments: { completed: 0, failed: 0 },
				},
			},
			repetition: {
				stories: [
					{
						story: "placeholder",
						native: { mean: null, samples: 0 },
						naive: { mean: null, samples: 0 },
					},
				],
			},
			progression: {
				stories: [
					{
						story: "placeholder",
						native: { mean: null, samples: 0 },
						naive: { mean: null, samples: 0 },
					},
				],
			},
			contradiction: {
				consistent: 0,
				contradictory: 0,
				undecidable: 0,
				failed: 0,
			},
			deep: r6DeepGateInput(report),
			preference: {
				accepted: 0,
				abandoned: 0,
				ties: 0,
				inconsistent: 0,
				failures: 0,
			},
		});
		const g5 = gate.gates.find((entry) => entry.id === "G5");
		// G0 没有样本，仪器无效优先于 G5 自身的计数。
		expect(g5?.status).toBe("invalid");
		expect(g5?.counts.completed).toBe(2);
		expect(gate.invalid).toEqual(["G1", "G5"]);
	}, 30_000);

	it("已完成的运行复用 sidecar，不发出新的生成请求", async () => {
		const dir = makeDir();
		const sourceDbPath = path.join(dir, "source.db");
		const source = StoryStore.open(sourceDbPath);
		seedStory(source);
		source.close();
		const first = createWriter((call) =>
			call <= 2 ? `深版本 ${call}。` : `快版本 ${call}。`,
		);
		const options = {
			sourceDbPath,
			stories: [STORY_ID],
			rounds: 2,
			branches: 2,
			dir: path.join(dir, "runs"),
			structuredOutput: "text-tags" as const,
			budgetTokens: 4_000,
			toolTransport: "native" as const,
			maxTokens: 512,
			temperature: 0.8,
			seed: 1,
		};
		await runR6Deep({
			...options,
			writer: { client: first.client, model: "main" },
			user: { client: createUser().client, model: "background" },
			judge: { client: createJudge().client, model: "judge" },
			background: { client: first.client },
		});
		const second = createWriter(() => {
			throw new Error("不应调用写作模型");
		});
		const report = await runR6Deep({
			...options,
			writer: { client: second.client, model: "main" },
			user: { client: createUser().client, model: "background" },
			judge: { client: createJudge().client, model: "judge" },
			background: { client: second.client },
		});
		expect(second.requests).toHaveLength(0);
		expect(report.summary.completedPairs).toBe(2);
	}, 30_000);

	it("连续 3 轮失败时终止并计入失败", async () => {
		const dir = makeDir();
		const sourceDbPath = path.join(dir, "source.db");
		const source = StoryStore.open(sourceDbPath);
		seedStory(source);
		source.close();
		const writer = createWriter(
			() => "不应出现",
			() => true,
		);
		const report = await runR6Deep({
			sourceDbPath,
			stories: [STORY_ID],
			rounds: 4,
			branches: 1,
			dir: path.join(dir, "runs"),
			writer: { client: writer.client, model: "main" },
			user: { client: createUser().client, model: "background" },
			judge: { client: createJudge().client, model: "judge" },
			background: { client: writer.client },
			structuredOutput: "text-tags",
			budgetTokens: 4_000,
			toolTransport: "native",
			maxTokens: 512,
			temperature: 0.8,
			seed: 1,
		});
		expect(writer.requests).toHaveLength(3);
		expect(report.runs[0]?.status).toBe("failed");
		expect(report.runs[0]?.error).toContain("连续 3 轮失败");
		expect(report.summary.turns).toEqual({
			completed: 0,
			failed: 3,
			failureRate: 1,
			toolCalls: 0,
		});
		expect(report.summary.plannedPairs).toBe(1);
		expect(report.summary.failures).toBe(1);
		expect(report.summary.missingPairs).toBe(1);

		const retry = createWriter((call) =>
			call <= 4 ? `深版本 ${call}：门开着。` : `快版本 ${call}：门开着。`,
		);
		const resumed = await runR6Deep({
			sourceDbPath,
			stories: [STORY_ID],
			rounds: 4,
			branches: 1,
			dir: path.join(dir, "runs"),
			writer: { client: retry.client, model: "main" },
			user: { client: createUser().client, model: "background" },
			judge: { client: createJudge().client, model: "judge" },
			background: { client: retry.client },
			structuredOutput: "text-tags",
			budgetTokens: 4_000,
			toolTransport: "native",
			maxTokens: 512,
			temperature: 0.8,
			seed: 1,
		});
		expect(resumed.runs[0]?.status).toBe("done");
		expect(resumed.runs[0]?.error).toBeNull();
		expect(retry.requests).toHaveLength(5);
		expect(resumed.summary.turns).toEqual({
			completed: 4,
			failed: 0,
			failureRate: 0,
			toolCalls: 0,
		});
		expect(resumed.summary.completedPairs).toBe(1);
	}, 30_000);

	it("分支失败与换序不一致分别计数，缺失配对计入失败", () => {
		const summary = summarizeR6Deep({
			stories: ["story-a", "story-b"],
			branches: 3,
			runs: [
				makeRun("story-a", [
					makeBranch("story-a", 1, "deep-first", "A", "fast-first", "A"),
					makeBranch("story-a", 4, "deep-first", "A", "fast-first", "B"),
					makeBranchFailure("story-a", 6),
				]),
			],
		});

		expect(summary.plannedPairs).toBe(6);
		expect(summary.completedPairs).toBe(2);
		expect(summary.pairs).toEqual({
			wins: 1,
			losses: 0,
			ties: 0,
			inconsistent: 1,
		});
		expect(summary.branchFailures).toBe(1);
		expect(summary.missingPairs).toBe(3);
		expect(summary.failures).toBe(4);
		expect(summary.inconsistentShare).toBe(0.5);
		expect(
			summary.stories.find((story) => story.story === "story-b"),
		).toMatchObject({
			status: "missing",
			completedPairs: 0,
			failures: 3,
		});
	});
});

function makeRun(
	story: string,
	records: readonly (DeepEvalBranchRecord | DeepEvalBranchFailureRecord)[],
): R6DeepRunRecord {
	return {
		format: R6_DEEP_RUN_FORMAT,
		story,
		branchNodeId: `${story}-branch`,
		rounds: 4,
		branches: 3,
		seed: 1,
		writerModel: "main",
		userModel: "background",
		judgeModel: "judge",
		warmup: {
			floorNodeIds: [],
			settleRequests: 0,
			sceneRequests: 0,
			cachedRequests: 0,
		},
		status: "done",
		error: null,
		startedAt: "2026-11-14T00:00:00.000Z",
		finishedAt: "2026-11-14T00:00:01.000Z",
		records,
		cost: {
			writerRequests: 0,
			writerCachedRequests: 0,
			userRequests: 0,
			judgeRequests: 0,
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
		},
	};
}

function judgement(
	order: DeepEvalJudgement["order"],
	winner: DeepEvalJudgement["winner"],
): DeepEvalJudgement {
	return { order, winner, reason: "测试", attempts: 1 };
}

function makeBranch(
	story: string,
	round: number,
	firstOrder: DeepEvalJudgement["order"],
	firstWinner: DeepEvalJudgement["winner"],
	secondOrder: DeepEvalJudgement["order"],
	secondWinner: DeepEvalJudgement["winner"],
): DeepEvalBranchRecord {
	return {
		kind: "branch",
		storyId: story,
		model: "main",
		startedAt: "2026-11-14T00:00:00.000Z",
		sampleId: `${story}#round-${round}`,
		round,
		userNodeId: `${story}-user-${round}`,
		deepNodeId: `${story}-deep-${round}`,
		fastNodeId: `${story}-fast-${round}`,
		deepChars: 120,
		fastChars: 80,
		judgeModel: "judge",
		outcome: "deep",
		judgements: [
			judgement(firstOrder, firstWinner),
			judgement(secondOrder, secondWinner),
		],
	};
}

function makeBranchFailure(
	story: string,
	round: number,
): DeepEvalBranchFailureRecord {
	return {
		kind: "branch",
		status: "failed",
		storyId: story,
		model: "main",
		startedAt: "2026-11-14T00:00:00.000Z",
		sampleId: `${story}#round-${round}`,
		round,
		userNodeId: `${story}-user-${round}`,
		judgeModel: "judge",
		error: "判定失败",
	};
}
