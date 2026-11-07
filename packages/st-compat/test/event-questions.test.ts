import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LlmClient, LlmRequest, LlmResult } from "@dramaticer/core";
import { describe, expect, it } from "vitest";
import {
	buildEventQuestions,
	buildEventQuestionsFromFile,
	parseChatJsonl,
	planEventQuestions,
	verifyEventQuestions,
	verifyEventQuestionsFromFile,
} from "../src/index.js";

const storyId = "story-event";
const testDir = path.dirname(fileURLToPath(import.meta.url));

function buildLines(count = 64): string[] {
	const lines = [JSON.stringify({ character_name: "测试角色" })];
	for (let index = 0; index < count; index += 1) {
		lines.push(
			JSON.stringify({
				name: index % 2 === 0 ? "用户" : "角色",
				is_user: index % 2 === 0,
				mes: `第 ${index + 1} 楼：角色完成了第 ${index + 1} 件事。`,
			}),
		);
	}
	return lines;
}

function fakeResult(text: string, cached = false): LlmResult {
	return {
		text,
		reasoning: "",
		finishReason: "stop",
		stopReason: "stop",
		model: "fake",
		channel: "fake",
		usage: {
			promptTokens: 10,
			completionTokens: 5,
			totalTokens: 15,
			reasoningTokens: 2,
			cachedTokens: null,
		},
		raw: {},
		cached,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

function fakeClient(
	respond: (request: LlmRequest, call: number) => string,
): LlmClient & { requests: LlmRequest[] } {
	const requests: LlmRequest[] = [];
	return {
		requests,
		complete: async (request) => {
			requests.push(request);
			return fakeResult(respond(request, requests.length));
		},
	};
}

function userPrompt(request: LlmRequest): string {
	const message = request.messages.find((item) => item.role === "user");
	if (!message) throw new Error("请求里没有 user 消息");
	return message.content;
}

function promptFloorIds(prompt: string): string[] {
	return [...prompt.matchAll(/^\[([^\]]+)\]/gm)].map(
		(match) => match[1] as string,
	);
}

function promptAskId(prompt: string): string {
	const match = prompt.match(/窗口最后一楼（所有问题的提问楼层）：(\S+)/);
	if (!match?.[1]) throw new Error("提示词里没有提问楼层");
	return match[1];
}

function promptCount(prompt: string): number {
	const match = prompt.match(/请生成 (\d+) 道题/);
	return match?.[1] ? Number(match[1]) : 1;
}

function questionId(index: string): number {
	const match = index.match(/:m(\d+):s\d+$/);
	if (!match?.[1]) throw new Error(`无法解析楼层 id ${index}`);
	return Number(match[1]);
}

function options(overrides: Record<string, unknown> = {}) {
	return {
		storyId,
		minQuestions: 1,
		maxQuestions: 8,
		questionsPerWindow: 2,
		maxWindows: 6,
		maxWindowChars: 320,
		maxFloorChars: 200,
		overlapFloors: 1,
		minWindowFloors: 3,
		minEvidenceGap: 1,
		temperature: 0.2,
		maxTokens: 500,
		...overrides,
	};
}

async function build(respond: (request: LlmRequest, call: number) => string) {
	const client = fakeClient(respond);
	const result = await buildEventQuestions(
		parseChatJsonl([buildLines().join("\n")]),
		client,
		options(),
	);
	return { client, result };
}

describe("buildEventQuestions", () => {
	it("按窗口出题，提问楼层是窗口最后一楼，证据更早", async () => {
		const { client, result } = await build((request, call) => {
			const prompt = userPrompt(request);
			const askId = promptAskId(prompt);
			const evidenceId = promptFloorIds(prompt)[0];
			return JSON.stringify(
				Array.from({ length: promptCount(prompt) }, (_, index) => ({
					question: `第 ${call} 次提问的第 ${index + 1} 题是什么？`,
					answer: `第 ${call} 次事件的答案`,
					evidenceNodes: [evidenceId],
				})),
			);
		});

		expect(client.requests).toHaveLength(6);
		expect(result.questions).toHaveLength(8);
		expect(result.stats.candidateCount).toBe(12);
		expect(result.stats.requestCount).toBe(6);
		expect(result.stats.failedWindows).toBe(0);
		expect(result.stats.promptTokens).toBe(60);
		expect(result.stats.reasoningTokens).toBe(12);

		for (const question of result.questions) {
			expect(question.kind).toBe("event");
			expect(question.story).toBe(storyId);
			expect(question.evidenceNodes.length).toBeGreaterThan(0);
			for (const evidenceId of question.evidenceNodes) {
				expect(questionId(evidenceId)).toBeLessThan(
					questionId(question.askAtNode),
				);
			}
		}
		expect(new Set(result.questions.map((question) => question.id)).size).toBe(
			8,
		);
	});

	it("提示词包含窗口内每一楼的 id、故事名和证据间隔", async () => {
		const { client } = await build((request) => {
			const prompt = userPrompt(request);
			return JSON.stringify([
				{
					question: "发生了什么？",
					answer: "发生了事件",
					evidenceNodes: [promptFloorIds(prompt)[0]],
				},
			]);
		});
		const firstPrompt = userPrompt(client.requests[0] as LlmRequest);
		const ids = promptFloorIds(firstPrompt);
		expect(ids.length).toBeGreaterThanOrEqual(3);
		expect(firstPrompt).toContain(`故事：${storyId}`);
		expect(firstPrompt).toContain("证据楼层必须比提问楼层至少早 1 楼");
		expect(firstPrompt).toContain(`[${ids[0]}]`);
	});

	it("过滤越界证据、提问楼层当证据和重复题目", async () => {
		const { result } = await build((request, call) => {
			const prompt = userPrompt(request);
			const ids = promptFloorIds(prompt);
			const askId = promptAskId(prompt);
			if (call === 1) {
				return JSON.stringify([
					{
						question: "合法的问题？",
						answer: "合法答案",
						evidenceNodes: [ids[0]],
					},
					{
						question: "合法的问题？",
						answer: "重复答案",
						evidenceNodes: [ids[0]],
					},
					{
						question: "证据越界的问题？",
						answer: "答案",
						evidenceNodes: ["story-event:m999:s0"],
					},
					{
						question: "证据是提问楼层的问题？",
						answer: "答案",
						evidenceNodes: [askId],
					},
				]);
			}
			return JSON.stringify([
				{
					question: `第 ${call} 次的问题？`,
					answer: "答案",
					evidenceNodes: [ids[0]],
				},
			]);
		});

		expect(result.questions).toHaveLength(6);
		expect(
			result.questions.filter(
				(question) => question.question === "合法的问题？",
			),
		).toHaveLength(1);
		expect(
			result.failures.filter((failure) => failure.reason.includes("重复")),
		).toHaveLength(1);
		expect(
			result.failures.filter((failure) => failure.reason.includes("结构校验")),
		).toHaveLength(2);
	});

	it("接受代码块包裹的 JSON，也接受 questions 对象", async () => {
		const { result } = await build((request, call) => {
			const prompt = userPrompt(request);
			return `\`\`\`json\n${JSON.stringify({
				questions: Array.from({ length: promptCount(prompt) }, (_, index) => ({
					question: `第 ${call} 次对象包装的问题 ${index + 1}？`,
					answer: "对象包装的答案",
					evidenceNodes: [promptFloorIds(prompt)[0]],
				})),
			})}\n\`\`\``;
		});
		expect(result.questions).toHaveLength(8);
		expect(result.questions[0]?.question).toBe("第 1 次对象包装的问题 1？");
	});

	it("模型输出无法解析时计入失败窗口，题量不足直接报错", async () => {
		const client = fakeClient(() => "抱歉，我无法完成。");
		await expect(
			buildEventQuestions(
				parseChatJsonl([buildLines().join("\n")]),
				client,
				options(),
			),
		).rejects.toThrow(/只生成了 0 道有效事件题/);
	});

	it("模型输出里缺字段的条目计入失败记录", async () => {
		const { result } = await build((request, call) => {
			const ids = promptFloorIds(userPrompt(request));
			if (call === 1) {
				return JSON.stringify([
					{
						question: "合法问题？",
						answer: "合法答案",
						evidenceNodes: [ids[0]],
					},
					{ question: "缺少答案", evidenceNodes: [ids[0]] },
					"不是对象",
				]);
			}
			return JSON.stringify([
				{
					question: `第 ${call} 次的问题？`,
					answer: "答案",
					evidenceNodes: [ids[0]],
				},
			]);
		});
		const reasons = result.failures.map((failure) => failure.reason);
		expect(reasons).toContain(
			"模型输出的第 2 条题目缺少 question、answer 或 evidenceNodes",
		);
		expect(reasons).toContain("模型输出的第 3 条题目不是对象");
	});

	it("模型返回空数组时每个窗口都记一条失败", async () => {
		const client = fakeClient(() => "[]");
		await expect(
			buildEventQuestions(
				parseChatJsonl([buildLines().join("\n")]),
				client,
				options(),
			),
		).rejects.toThrow(/模型输出里没有题目/);
	});

	it("FromFile 包装与内存版本结果一致", async () => {
		const lines = buildLines();
		const dir = await mkdtemp(path.join(testDir, ".tmp-event-"));
		try {
			const filePath = path.join(dir, "chat.jsonl");
			await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
			const client = fakeClient((request) => {
				const ids = promptFloorIds(userPrompt(request));
				return JSON.stringify([
					{
						question: `第 ${ids[0]} 楼发生了什么？`,
						answer: "发生了事件",
						evidenceNodes: [ids[0]],
					},
				]);
			});
			const fromFile = await buildEventQuestionsFromFile(
				filePath,
				client,
				options(),
			);
			const fromMemory = await buildEventQuestions(
				parseChatJsonl([lines.join("\n")]),
				client,
				options(),
			);
			expect(fromFile.questions).toEqual(fromMemory.questions);
			const verification = await verifyEventQuestionsFromFile(
				filePath,
				fromFile.questions,
				{ storyId, minEvidenceGap: 1 },
			);
			expect(verification.checked).toBe(fromFile.questions.length);
			expect(verification.failures).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("没有足够窗口时直接报错", async () => {
		const client = fakeClient(() => "[]");
		await expect(
			buildEventQuestions(
				parseChatJsonl([buildLines(4).join("\n")]),
				client,
				options({ minWindowFloors: 10 }),
			),
		).rejects.toThrow(/构造不出窗口/);
	});
});

describe("planEventQuestions", () => {
	it("不调用模型，按窗口数给出请求估算", async () => {
		const plan = await planEventQuestions(
			parseChatJsonl([buildLines().join("\n")]),
			options(),
		);
		expect(plan.story).toBe(storyId);
		expect(plan.floorCount).toBe(64);
		expect(plan.availableWindowCount).toBeGreaterThan(0);
		expect(plan.windowCount).toBe(Math.min(plan.availableWindowCount, 6));
		expect(plan.requestCount).toBe(plan.windowCount);
	});

	it("楼层不足时返回零个窗口", async () => {
		const plan = await planEventQuestions(
			parseChatJsonl([buildLines(2).join("\n")]),
			options(),
		);
		expect(plan.floorCount).toBe(2);
		expect(plan.windowCount).toBe(0);
		expect(plan.requestCount).toBe(0);
	});
});

describe("verifyEventQuestions", () => {
	it("正常题目全部通过核对", async () => {
		const { result } = await build((request, call) => {
			const prompt = userPrompt(request);
			return JSON.stringify(
				Array.from({ length: promptCount(prompt) }, (_, index) => ({
					question: `第 ${call} 次核对问题 ${index + 1}？`,
					answer: "发生了事件",
					evidenceNodes: [promptFloorIds(prompt)[0]],
				})),
			);
		});
		const verification = await verifyEventQuestions(
			parseChatJsonl([buildLines().join("\n")]),
			result.questions,
			{ storyId, minEvidenceGap: 1 },
		);
		expect(verification.checked).toBe(8);
		expect(verification.failures).toEqual([]);
	});

	it("证据楼层取成提问楼层时核对失败", async () => {
		const { result } = await build((request, call) => {
			const prompt = userPrompt(request);
			return JSON.stringify(
				Array.from({ length: promptCount(prompt) }, (_, index) => ({
					question: `第 ${call} 次核对问题 ${index + 1}？`,
					answer: "发生了事件",
					evidenceNodes: [promptFloorIds(prompt)[0]],
				})),
			);
		});
		const tampered = result.questions.map((question) => ({
			...question,
			evidenceNodes: [question.askAtNode],
		}));
		const verification = await verifyEventQuestions(
			parseChatJsonl([buildLines().join("\n")]),
			tampered,
			{ storyId, minEvidenceGap: 1 },
		);
		expect(verification.failures).toHaveLength(8);
		expect(verification.failures[0]?.reason).toContain("间隔不足");
	});
});
