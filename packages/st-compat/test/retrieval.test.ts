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

	it("拒绝没有题目的故事", async () => {
		await expect(
			evaluateRetrieval({
				chatPath: `${fixturesPath}retrieval-chat.jsonl`,
				storyId: story,
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
});
