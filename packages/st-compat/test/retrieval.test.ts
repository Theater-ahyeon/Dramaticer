import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RetrievalQuestion } from "../src/evalset/question-files.js";
import { readQuestionFile } from "../src/evalset/question-files.js";
import {
	collectRetrievalBaseline,
	evaluateRetrieval,
} from "../src/evalset/retrieval.js";

const fixturesPath = fileURLToPath(new URL("./fixtures/", import.meta.url));
const story = "测试故事";

const questions: readonly RetrievalQuestion[] = [
	{
		id: "q1",
		story,
		askAtNode: `${story}:m9:s0`,
		question: "苏禾在哪里练习青铜匕首的招式？",
		answer: "河边",
		evidenceNodes: [`${story}:m4:s0`],
		kind: "state",
	},
	{
		id: "q2",
		story,
		askAtNode: `${story}:m9:s0`,
		question: "商贩说匕首来自哪里？",
		answer: "北边的矿镇",
		evidenceNodes: [`${story}:m2:s0`],
		kind: "state",
	},
	{
		id: "q3",
		story,
		askAtNode: `${story}:m9:s0`,
		question: "客栈老板提到矿镇发生了什么？",
		answer: "塌方",
		evidenceNodes: [`${story}:m8:s0`],
		kind: "event",
	},
	{
		id: "q4",
		story,
		askAtNode: `${story}:m0:s0`,
		question: "苏禾在哪里练习青铜匕首的招式？",
		answer: "河边",
		evidenceNodes: [`${story}:m4:s0`],
		kind: "event",
	},
];

describe("readQuestionFile", () => {
	it("解析题目并校验类型", async () => {
		const parsed = await readQuestionFile(
			`${fixturesPath}retrieval-questions.jsonl`,
			"state",
		);
		expect(parsed).toHaveLength(2);
		expect(parsed[0]?.evidenceNodes).toEqual([`${story}:m4:s0`]);
		expect(parsed[0]?.kind).toBe("state");
		await expect(
			readQuestionFile(`${fixturesPath}retrieval-questions.jsonl`, "event"),
		).rejects.toThrow();
	});
});

describe("evaluateRetrieval", () => {
	it("只在提问楼层之前检索并按题目类型统计命中", async () => {
		const result = await evaluateRetrieval({
			chatPath: `${fixturesPath}retrieval-chat.jsonl`,
			storyId: story,
			corpus: "legacy",
			questions,
		});
		expect(result.floorCount).toBe(10);
		expect(result.chunkCount).toBe(9);
		expect(result.byKind).toEqual([
			{ kind: "state", questionCount: 2, hitAt5: 2, hitAt10: 2, hitAt20: 2 },
			{ kind: "event", questionCount: 2, hitAt5: 0, hitAt10: 0, hitAt20: 0 },
		]);
		expect(result.total).toEqual({
			questionCount: 4,
			hitAt5: 2,
			hitAt10: 2,
			hitAt20: 2,
		});
	});

	it("同一楼层的多个块只占一个位次", async () => {
		const question: RetrievalQuestion = {
			id: "dup",
			story,
			askAtNode: `${story}:m2:s0`,
			question: "青铜匕",
			answer: "青铜匕",
			evidenceNodes: [`${story}:m1:s0`],
			kind: "state",
		};
		const result = await evaluateRetrieval({
			chatPath: `${fixturesPath}retrieval-dup-chat.jsonl`,
			storyId: story,
			corpus: "legacy",
			questions: [question],
			maxChars: 3,
			overlapChars: 0,
		});
		expect(result.floorCount).toBe(3);
		expect(result.chunkCount).toBe(8);
		expect(result.total).toEqual({
			questionCount: 1,
			hitAt5: 1,
			hitAt10: 1,
			hitAt20: 1,
		});
	});

	it("提问楼层超出范围时抛错并指出题目", async () => {
		const question: RetrievalQuestion = {
			id: "越界",
			story,
			askAtNode: `${story}:m9:s0`,
			question: "青铜匕",
			answer: "青铜匕",
			evidenceNodes: [`${story}:m1:s0`],
			kind: "state",
		};
		await expect(
			evaluateRetrieval({
				chatPath: `${fixturesPath}retrieval-dup-chat.jsonl`,
				storyId: story,
				corpus: "legacy",
				questions: [question],
				maxChars: 3,
				overlapChars: 0,
			}),
		).rejects.toThrow(
			`题目 ${question.id} 的提问楼层 ${question.askAtNode} 超出故事 ${story} 的楼层范围`,
		);
	});

	it("拒绝没有题目的故事", async () => {
		await expect(
			evaluateRetrieval({
				chatPath: `${fixturesPath}retrieval-chat.jsonl`,
				storyId: story,
				corpus: "legacy",
				questions: [],
			}),
		).rejects.toThrow();
	});
});

describe("collectRetrievalBaseline", () => {
	it("按 manifest 和题目文件汇总", async () => {
		const baseline = await collectRetrievalBaseline({
			rawRoot: fixturesPath,
			evalsetRoot: `${fixturesPath}evalset`,
			generatedAt: "2026-01-03T00:00:00.000Z",
		});
		expect(baseline.generatedAt).toBe("2026-01-03T00:00:00.000Z");
		expect(baseline.stories).toHaveLength(1);
		expect(baseline.stories[0]?.story).toBe("测试角色");
		expect(baseline.stories[0]?.total).toEqual({
			questionCount: 1,
			hitAt5: 1,
			hitAt10: 1,
			hitAt20: 1,
		});
		expect(baseline.total.questionCount).toBe(1);
		expect(baseline.byKind).toEqual([
			{ kind: "state", questionCount: 1, hitAt5: 1, hitAt10: 1, hitAt20: 1 },
		]);
	});

	it("缺少状态题文件时直接报错", async () => {
		await expect(
			collectRetrievalBaseline({
				rawRoot: fixturesPath,
				evalsetRoot: `${fixturesPath}不存在的目录`,
			}),
		).rejects.toThrow();
	});

	it("新增语料缺少状态题时跳过并估算事件题请求", async () => {
		const dir = await mkdtemp(
			path.join(
				path.dirname(fileURLToPath(import.meta.url)),
				".tmp-retrieval-",
			),
		);
		try {
			const content = await readFile(
				path.join(fixturesPath, "retrieval-chat.jsonl"),
				"utf8",
			);
			const size = Buffer.byteLength(content);
			const sha256 = createHash("sha256").update(content).digest("hex");
			await writeFile(path.join(dir, "chat.jsonl"), content, "utf8");
			await writeFile(
				path.join(dir, "state-旧故事.jsonl"),
				`${JSON.stringify({
					id: "state:旧故事:m4",
					story: "旧故事",
					askAtNode: "旧故事:m4:s0",
					question: "青铜匕",
					answer: "青铜匕",
					evidenceNodes: ["旧故事:m3:s0"],
					kind: "state",
				})}\n`,
				"utf8",
			);
			await writeFile(
				path.join(dir, "event-旧故事.jsonl"),
				`${JSON.stringify({
					id: "event:旧故事:m8",
					story: "旧故事",
					askAtNode: "旧故事:m8:s0",
					question: "发生了什么？",
					answer: "练习",
					evidenceNodes: ["旧故事:m2:s0"],
					kind: "event",
				})}\n`,
				"utf8",
			);
			await writeFile(
				path.join(dir, "manifest.json"),
				JSON.stringify({
					files: [
						{
							role: "chat",
							character: "旧故事",
							corpus: "legacy",
							target: "chat.jsonl",
							size,
							sha256,
						},
						{
							role: "chat",
							character: "新故事",
							corpus: "latest",
							target: "chat.jsonl",
							size,
							sha256,
						},
					],
				}),
				"utf8",
			);
			const baseline = await collectRetrievalBaseline({
				rawRoot: dir,
				evalsetRoot: dir,
				generatedAt: "2026-01-05T00:00:00.000Z",
			});
			expect(
				baseline.stories.map((item) => ({
					story: item.story,
					corpus: item.corpus,
				})),
			).toEqual([{ story: "旧故事", corpus: "legacy" }]);
			expect(baseline.skippedStories).toEqual([
				{ story: "新故事", corpus: "latest", reason: "缺少状态题文件" },
			]);
			expect(
				baseline.corpora.map((item) => [
					item.corpus,
					item.chatCount,
					item.skippedStoryCount,
				]),
			).toEqual([
				["legacy", 1, 0],
				["latest", 1, 1],
			]);
			expect(baseline.corpora[1]?.eventQuestionRequestEstimate).toBe(1);
			expect(baseline.corpora[1]?.total.questionCount).toBe(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
