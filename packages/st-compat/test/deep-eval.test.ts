import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	StoryStore,
	createDefaultContextTemplate,
	createEventStream,
	createStandardChatSlots,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import {
	type DeepEvalBranchRecord,
	type DeepEvalOptions,
	type DeepEvalRecord,
	parseDeepEvalJsonl,
	runDeepEval,
	selectBranchRounds,
	serializeDeepEvalRecord,
	summarizeDeepEval,
} from "../src/evalset/deep-eval.js";

const STORY_ID = "deep-eval-story";
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
	const dir = mkdtempSync(path.join(import.meta.dirname, ".tmp-deep-eval-"));
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

interface FakeWriter {
	readonly client: LlmStreamingClient;
	readonly requests: LlmRequest[];
}

function createWriter(
	reply: (call: number) => string,
	failAt: number | null = null,
): FakeWriter {
	const requests: LlmRequest[] = [];
	let call = 0;
	return {
		requests,
		client: {
			async complete() {
				call += 1;
				if (failAt === call) throw new Error("渠道失败");
				return makeResult(reply(call));
			},
			stream(request) {
				requests.push(request);
				call += 1;
				if (failAt === call) {
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

function createUser(): FakeWriter {
	return createWriter((call) =>
		JSON.stringify({ message: `第 ${call} 轮：我看向海面。` }),
	);
}

function createRecordedJudge(): FakeWriter {
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
	store.createStory({ id: STORY_ID, title: "深回合评测" });
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

async function deepEvalOptions(
	store: StoryStore,
	overrides: Partial<DeepEvalOptions> = {},
): Promise<DeepEvalOptions> {
	return {
		store,
		storyId: STORY_ID,
		turns: 2,
		branches: 2,
		profile: "native",
		seed: 1,
		assistant: {
			client: createWriter((call) => `深版本 ${call}。`).client,
			model: "main",
		},
		user: { client: createUser().client, model: "background" },
		judge: { client: createRecordedJudge().client, model: "judge" },
		turn: {
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: (
				await createStandardChatSlots({
					store,
					characterPrompt: CARD_PROMPT,
					directorConfig: DEFAULT_DIRECTOR_CONFIG,
				})
			).providers,
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			toolTransport: "native",
			maxTokens: 512,
			temperature: 0.8,
		},
		onRecord: () => undefined,
		...overrides,
	};
}

describe("深回合验收评测", () => {
	it("跑深回合、记录漂移并在同一分支点做快/深盲评", async () => {
		const dir = makeDir();
		const store = StoryStore.open(path.join(dir, "story.db"));
		seedStory(store);
		const writer = createWriter((call) =>
			call <= 2 ? `深版本 ${call}：灯塔的门开着。` : `快版本 ${call}：门开着。`,
		);
		const judge = createRecordedJudge();
		const records: DeepEvalRecord[] = [];
		const options = await deepEvalOptions(store, {
			assistant: { client: writer.client, model: "main" },
			judge: { client: judge.client, model: "judge" },
			onRecord: (record) => {
				records.push(record);
			},
		});
		await runDeepEval(options);

		expect(writer.requests).toHaveLength(4);
		expect(judge.requests).toHaveLength(4);
		expect(records.filter((record) => record.kind === "turn")).toHaveLength(2);
		const branches = records.filter(
			(record): record is DeepEvalBranchRecord => record.kind === "branch",
		);
		expect(branches).toHaveLength(2);
		for (const branch of branches) {
			expect(branch.outcome).toBe("deep");
			expect(branch.judgements.map((judgement) => judgement.order)).toEqual([
				"deep-first",
				"fast-first",
			]);
			expect(branch.deepChars).toBeGreaterThan(branch.fastChars);
		}
		const summary = summarizeDeepEval(records);
		expect(summary.turns.completed).toBe(2);
		expect(summary.turns.failed).toBe(0);
		expect(summary.turns.drift).toBe(2);
		expect(summary.turns.commits).toEqual({ auto: 2 });
		expect(summary.turns.toolCalls.total).toBe(0);
		expect(summary.turns.stopReasons).toEqual({ completed: 2 });
		expect(summary.branches.deepWins).toBe(2);
		expect(store.getPathToHead(STORY_ID).at(-1)?.role).toBe("assistant");
		store.close();
	}, 30_000);

	it("渠道失败记入失败轮次，续跑重试该轮", async () => {
		const dir = makeDir();
		const store = StoryStore.open(path.join(dir, "story.db"));
		seedStory(store);
		const failing = createWriter(() => {
			throw new Error("渠道失败");
		});
		const records: DeepEvalRecord[] = [];
		await runDeepEval(
			await deepEvalOptions(store, {
				turns: 1,
				branches: 0,
				assistant: { client: failing.client, model: "main" },
				onRecord: (record) => {
					records.push(record);
				},
			}),
		);
		expect(records).toHaveLength(1);
		const firstRecord = records[0];
		expect(firstRecord?.kind === "turn" && firstRecord.status).toBe("failed");
		expect(summarizeDeepEval(records).turns.failureRate).toBe(1);

		const resumed = await runDeepEval(
			await deepEvalOptions(store, {
				turns: 1,
				branches: 0,
				existing: records,
				assistant: {
					client: createWriter(() => "深版本。").client,
					model: "main",
				},
				onRecord: () => undefined,
			}),
		);
		expect(resumed.records).toHaveLength(2);
		const resumedSummary = summarizeDeepEval(resumed.records);
		expect(resumedSummary.turns.completed).toBe(1);
		expect(resumedSummary.turns.failed).toBe(0);
		store.close();
	}, 30_000);

	it("已有记录全部完成时不发出新的生成请求", async () => {
		const dir = makeDir();
		const store = StoryStore.open(path.join(dir, "story.db"));
		seedStory(store);
		const first = createWriter((call) => `深版本 ${call}。`);
		const records: DeepEvalRecord[] = [];
		await runDeepEval(
			await deepEvalOptions(store, {
				turns: 2,
				branches: 0,
				assistant: { client: first.client, model: "main" },
				onRecord: (record) => {
					records.push(record);
				},
			}),
		);
		const second = createWriter(() => "不该出现。");
		const resumed = await runDeepEval(
			await deepEvalOptions(store, {
				turns: 2,
				branches: 0,
				existing: records,
				assistant: { client: second.client, model: "main" },
				onRecord: () => undefined,
			}),
		);
		expect(second.requests).toHaveLength(0);
		expect(resumed.records).toHaveLength(2);
		store.close();
	}, 30_000);

	it("记录能逐行往返，分支点等距且不重复", () => {
		expect(selectBranchRounds(30, 10)).toEqual([
			1, 4, 7, 11, 14, 17, 20, 24, 27, 30,
		]);
		expect(() => selectBranchRounds(3, 4)).toThrow("不能多于");
		const record = {
			kind: "turn",
			status: "failed",
			storyId: STORY_ID,
			model: "main",
			startedAt: "2026-11-12T00:00:00.000Z",
			round: 1,
			user: "我看向海面。",
			error: "渠道失败",
		} as const;
		const parsed = parseDeepEvalJsonl(serializeDeepEvalRecord(record));
		expect(parsed).toHaveLength(1);
		expect(parsed[0]).toEqual(record);
	});
});
