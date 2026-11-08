import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type LlmUsage,
	StoryStore,
	createDefaultContextTemplate,
	createStandardChatProviders,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import {
	type JudgedMemoryQuestionRecord,
	renderJudgedMemorySection,
	runJudgedMemoryQuestions,
	summarizeJudgedMemoryQuestions,
} from "../src/evalset/memory-judged.js";
import type { MemoryQuestion } from "../src/evalset/memory-questions.js";

const STORY_ID = "memory-judged-story";
const CARD_PROMPT = "你扮演卫宫，用冷静的旁白叙述。";

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
	const dir = mkdtempSync(
		path.join(import.meta.dirname, ".tmp-memory-judged-"),
	);
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

function lastUserText(request: LlmRequest): string {
	const last = request.messages.at(-1)?.content;
	return typeof last === "string" ? last : "";
}

function createAnswerClient(): LlmClient {
	return {
		async complete(request) {
			const text = lastUserText(request);
			if (text.includes("星陨塔里见到了谁")) {
				return makeResult("卫宫在星陨塔见到了白狐。");
			}
			if (text.includes("去过星陨塔吗")) {
				return makeResult("没有，他从没去过星陨塔。");
			}
			if (text.includes("母亲叫什么名字")) {
				return makeResult("没有记录，故事里没提过。");
			}
			if (text.includes("什么时间")) {
				return makeResult("记不清了。");
			}
			if (text.includes("位置与场景氛围")) {
				return makeResult("大殿，夜里起雾。");
			}
			return makeResult("大殿。");
		},
	};
}

interface RecordedJudge {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
}

function createJudge(outputs?: readonly string[]): RecordedJudge {
	const requests: LlmRequest[] = [];
	let call = 0;
	return {
		requests,
		client: {
			async complete(request) {
				requests.push(request);
				if (outputs !== undefined) {
					const text = outputs[call] ?? outputs.at(-1) ?? "{}";
					call += 1;
					return makeResult(text);
				}
				const content = lastUserText(request);
				if (content.includes("见到了白狐")) {
					return makeResult(
						'{"consistent":false,"reason":"编造了从未出现的星陨塔与白狐"}',
					);
				}
				if (content.includes("什么时间")) {
					return makeResult('{"consistent":"unknown","reason":"没有依据"}');
				}
				return makeResult('{"consistent":true,"reason":"与证据一致"}');
			},
		},
	};
}

function openStore(dir: string): StoryStore {
	const store = StoryStore.open(path.join(dir, "story.db"));
	store.createStory({ id: STORY_ID, title: "记忆题测试" });
	store.updateStorySettings(STORY_ID, { characterPrompt: CARD_PROMPT });
	let parentId: string | null = null;
	for (let index = 0; index < 12; index += 1) {
		const node = store.appendNode({
			id: `seed-${index}`,
			storyId: STORY_ID,
			parentId,
			role: index % 2 === 0 ? "assistant" : "user",
			raw: `第 ${index + 1} 楼：${index === 5 ? "夜里起雾" : "沿石阶向前"}`,
		});
		parentId = node.id;
	}
	store.appendStateDiffs([
		{
			storyId: STORY_ID,
			nodeId: "seed-1",
			path: ["character", "卫宫", "location"],
			op: "set",
			value: "山门",
			source: "model",
		},
		{
			storyId: STORY_ID,
			nodeId: "seed-1",
			path: ["time", "current"],
			op: "set",
			value: "第三天清晨",
			source: "model",
		},
		{
			storyId: STORY_ID,
			nodeId: "seed-5",
			path: ["scene", "current", "atmosphere"],
			op: "set",
			value: "夜里起雾",
			source: "model",
		},
		{
			storyId: STORY_ID,
			nodeId: "seed-8",
			path: ["character", "卫宫", "location"],
			op: "set",
			value: "大殿",
			source: "model",
		},
	]);
	return store;
}

function question(
	overrides: Partial<MemoryQuestion> & {
		id: string;
		category: MemoryQuestion["category"];
	},
): MemoryQuestion {
	return {
		id: overrides.id,
		story: STORY_ID,
		askAtNode: "seed-11",
		question: "卫宫在哪里？",
		answer: "大殿。",
		evidenceNodes: ["seed-8"],
		category: overrides.category,
		fabricated: false,
		...overrides,
	};
}

function questions(): MemoryQuestion[] {
	return [
		question({ id: "q-extraction", category: "extraction" }),
		question({
			id: "q-cross",
			category: "cross_segment",
			question: "卫宫的位置与场景氛围分别是什么？",
			answer: "大殿；夜里起雾。",
			evidenceNodes: ["seed-8", "seed-5"],
		}),
		question({
			id: "q-temporal",
			category: "temporal",
			question: "故事现在是什么时间？",
			answer: "第三天清晨。",
			evidenceNodes: ["seed-1"],
		}),
		question({
			id: "q-update",
			category: "update",
			question: "卫宫的位置从山门变成了哪里？",
			answer: "大殿。",
			evidenceNodes: ["seed-1", "seed-8"],
		}),
		question({
			id: "q-abstain",
			category: "abstention",
			question: "卫宫的母亲叫什么名字？",
			answer: "没有记录。",
			evidenceNodes: ["seed-1"],
		}),
		question({
			id: "q-fabricated-affirmative",
			category: "abstention",
			question: "卫宫在星陨塔里见到了谁？",
			answer: "星陨塔从未出现，卫宫没有在星陨塔见过任何人。",
			evidenceNodes: ["seed-1"],
			fabricated: true,
		}),
		question({
			id: "q-fabricated-denial",
			category: "abstention",
			question: "卫宫去过星陨塔吗？",
			answer: "星陨塔从未出现，卫宫没有去过。",
			evidenceNodes: ["seed-1"],
			fabricated: true,
		}),
	];
}

async function run(
	store: StoryStore,
	items: readonly MemoryQuestion[],
	judge: LlmClient,
): Promise<JudgedMemoryQuestionRecord[]> {
	return runJudgedMemoryQuestions({
		store,
		storyId: STORY_ID,
		questions: items,
		template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
		providers: createStandardChatProviders({
			store,
			characterPrompt: CARD_PROMPT,
			directorConfig: DEFAULT_DIRECTOR_CONFIG,
		}),
		budgetTokens: 4_000,
		assistant: { client: createAnswerClient(), model: "main" },
		judge: { client: judge, model: "judge" },
		maxTokens: 512,
		temperature: 0.3,
	});
}

describe("五类记忆题判分", () => {
	it("五类都能出题判分，明确否认算通过、肯定描述算编造", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const headBefore = store.getHead(STORY_ID)?.id;
		const nodeCountBefore = store.getPathToHead(STORY_ID).length;
		const judge = createJudge();
		const records = await run(store, questions(), judge.client);

		expect(records).toHaveLength(7);
		expect(store.getHead(STORY_ID)?.id).toBe(headBefore);
		expect(store.getPathToHead(STORY_ID)).toHaveLength(nodeCountBefore);

		const summary = summarizeJudgedMemoryQuestions(records);
		expect(summary.questionCount).toBe(7);
		expect(summary.consistent).toBe(5);
		expect(summary.contradicted).toBe(1);
		expect(summary.unknown).toBe(1);
		expect(summary.failed).toBe(0);
		expect(summary.hitRate).toBeCloseTo(5 / 6);
		expect(summary.fabricatedQuestionCount).toBe(2);
		expect(summary.fabricated).toBe(1);
		expect(summary.fabricatedJudged).toBe(2);
		expect(summary.fabricatedRate).toBeCloseTo(0.5);
		expect(summary.byCategory.map((score) => score.category)).toEqual([
			"extraction",
			"cross_segment",
			"temporal",
			"update",
			"abstention",
		]);
		const abstention = summary.byCategory.find(
			(score) => score.category === "abstention",
		);
		expect(abstention).toMatchObject({
			questionCount: 3,
			consistent: 2,
			contradicted: 1,
			unknown: 0,
			fabricatedQuestionCount: 2,
			fabricated: 1,
			fabricatedJudged: 2,
		});
		expect(abstention?.fabricatedRate).toBeCloseTo(0.5);
		expect(
			records.find((record) => record.question.id === "q-fabricated-denial")
				?.fabricated,
		).toBe(false);
		expect(
			records.find(
				(record) => record.question.id === "q-fabricated-affirmative",
			)?.fabricated,
		).toBe(true);

		const fabricatedJudgeRequest = judge.requests.find((request) =>
			lastUserText(request).includes("星陨塔里见到了谁"),
		);
		if (fabricatedJudgeRequest === undefined) {
			throw new Error("没有编造题的裁判请求");
		}
		const fabricatedPrompt = lastUserText(fabricatedJudgeRequest);
		expect(fabricatedPrompt).toContain("这是编造回忆题");
		expect(fabricatedPrompt).toContain("参考答案：");
		expect(fabricatedPrompt).toContain("证据楼层原文");
		expect(fabricatedPrompt).toContain("楼层 seed-1");
		store.close();
	});

	it("统计版不含题目与原文，私有版含逐题明细", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const records = await run(store, questions(), createJudge().client);
		const summary = summarizeJudgedMemoryQuestions(records);
		const publicReport = renderJudgedMemorySection(summary, {
			privateDetails: false,
		});
		const privateReport = renderJudgedMemorySection(summary, {
			privateDetails: true,
		});
		expect(publicReport).toContain("五类记忆题与编造回忆率");
		expect(publicReport).toContain("跨段推理");
		expect(publicReport).toContain("编造率");
		expect(publicReport).not.toContain("星陨塔");
		expect(publicReport).not.toContain("卫宫");
		expect(publicReport).not.toContain(STORY_ID);
		expect(privateReport).toContain("星陨塔");
		expect(privateReport).toContain(STORY_ID);
		expect(privateReport).toContain("参考答案");
		store.close();
	});

	it("裁判连续输出非法 JSON 时重试三次后记失败", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const judge = createJudge(["不是 JSON", "还不是", "仍然不是"]);
		const records = await run(
			store,
			[question({ id: "q-retry", category: "extraction" })],
			judge.client,
		);
		expect(records).toHaveLength(1);
		expect(records[0]?.status).toBe("failed");
		expect(records[0]?.judgeAttempts).toBe(3);
		expect(records[0]?.error).toContain("连续 3 次");
		const summary = summarizeJudgedMemoryQuestions(records);
		expect(summary.failed).toBe(1);
		expect(summary.hitRate).toBe(0);
		store.close();
	});
});
