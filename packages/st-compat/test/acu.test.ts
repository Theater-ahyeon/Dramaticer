import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	collectAcuBaseline,
	evaluateAcuCoverage,
	normalizeForTableMatch,
} from "../src/evalset/acu.js";
import type { RetrievalQuestion } from "../src/evalset/question-files.js";
import { readQuestionFile } from "../src/evalset/question-files.js";

const fixturesPath = fileURLToPath(new URL("./fixtures/acu/", import.meta.url));

describe("readQuestionFile", () => {
	it("把数字和布尔答案转成文本", async () => {
		const parsed = await readQuestionFile(
			`${fixturesPath}typed-answers.jsonl`,
			"state",
		);
		expect(parsed.map((question) => question.answer)).toEqual(["42", "true"]);
	});
});

describe("normalizeForTableMatch", () => {
	it("统一全角字符并去掉空白、标点和符号", () => {
		expect(normalizeForTableMatch(" １２：００，下 雨！ ")).toBe("1200下雨");
		expect(normalizeForTableMatch("ＡＢ-Ｃ")).toBe("abc");
	});
});

describe("evaluateAcuCoverage", () => {
	it("按提问楼层之前的单元格快照判断答案是否出现", async () => {
		const story = "表格故事";
		const questions: readonly RetrievalQuestion[] = [
			{
				id: "early",
				story,
				askAtNode: `${story}:m1:s0`,
				question: "地点是什么？",
				answer: "集市",
				evidenceNodes: [],
				kind: "state",
			},
			{
				id: "mid",
				story,
				askAtNode: `${story}:m2:s0`,
				question: "时间是什么？",
				answer: "１２：００",
				evidenceNodes: [],
				kind: "state",
			},
			{
				id: "new",
				story,
				askAtNode: `${story}:m4:s0`,
				question: "地点是什么？",
				answer: "矿镇",
				evidenceNodes: [],
				kind: "state",
			},
			{
				id: "stale",
				story,
				askAtNode: `${story}:m4:s0`,
				question: "地点是什么？",
				answer: "集市",
				evidenceNodes: [],
				kind: "state",
			},
		];
		const result = await evaluateAcuCoverage({
			chatPath: `${fixturesPath}cells/chat.jsonl`,
			storyId: story,
			questions,
		});
		expect(result.applicable).toBe(true);
		expect(result.snapshotFloorCount).toBe(2);
		expect(result.questionCount).toBe(4);
		expect(result.coveredCount).toBe(2);
		expect(result.byKind).toEqual([
			{ kind: "state", questionCount: 4, coveredCount: 2 },
		]);
		expect(result.byAnswerLength).toEqual([
			{ label: "2–3 字符", questionCount: 3, coveredCount: 1 },
			{ label: "4–9 字符", questionCount: 1, coveredCount: 1 },
		]);
	});

	it("重放 SQL 更新，旧值被覆盖后不再算命中", async () => {
		const story = "数据库故事";
		const questions: readonly RetrievalQuestion[] = [
			{
				id: "before",
				story,
				askAtNode: `${story}:m0:s0`,
				question: "地点是什么？",
				answer: "集市",
				evidenceNodes: [],
				kind: "state",
			},
			{
				id: "after-insert",
				story,
				askAtNode: `${story}:m1:s0`,
				question: "地点是什么？",
				answer: "集市",
				evidenceNodes: [],
				kind: "state",
			},
			{
				id: "after-param-update",
				story,
				askAtNode: `${story}:m3:s0`,
				question: "地点是什么？",
				answer: "矿镇",
				evidenceNodes: [],
				kind: "state",
			},
			{
				id: "stale",
				story,
				askAtNode: `${story}:m3:s0`,
				question: "地点是什么？",
				answer: "集市",
				evidenceNodes: [],
				kind: "state",
			},
			{
				id: "journal",
				story,
				askAtNode: `${story}:m5:s0`,
				question: "发生了什么？",
				answer: "夜里下了雨",
				evidenceNodes: [],
				kind: "event",
			},
		];
		const result = await evaluateAcuCoverage({
			chatPath: `${fixturesPath}sql/chat.jsonl`,
			storyId: story,
			questions,
		});
		expect(result.applicable).toBe(true);
		expect(result.snapshotFloorCount).toBe(3);
		expect(result.questionCount).toBe(5);
		expect(result.coveredCount).toBe(3);
		expect(result.byKind).toEqual([
			{ kind: "state", questionCount: 4, coveredCount: 2 },
			{ kind: "event", questionCount: 1, coveredCount: 1 },
		]);
	});

	it("相邻单元格不会被拼成一段文本再匹配", async () => {
		const story = "相邻单元格";
		const question = (id: string, answer: string): RetrievalQuestion => ({
			id,
			story,
			askAtNode: `${story}:m2:s0`,
			question: "地点与时间是什么？",
			answer,
			evidenceNodes: [],
			kind: "state",
		});
		const result = await evaluateAcuCoverage({
			chatPath: `${fixturesPath}adjacent/chat.jsonl`,
			storyId: story,
			questions: [question("merged", "集市时间"), question("single", "集市")],
		});
		expect(result.applicable).toBe(true);
		expect(result.snapshotFloorCount).toBe(1);
		expect(result.questionCount).toBe(2);
		expect(result.coveredCount).toBe(1);
		expect(result.byAnswerLength).toEqual([
			{ label: "2–3 字符", questionCount: 1, coveredCount: 1 },
			{ label: "4–9 字符", questionCount: 1, coveredCount: 0 },
		]);
	});

	it("提问楼层在对话里不存在时抛出并列出题目 id", async () => {
		const story = "表格故事";
		await expect(
			evaluateAcuCoverage({
				chatPath: `${fixturesPath}cells/chat.jsonl`,
				storyId: story,
				questions: [
					{
						id: "missing",
						story,
						askAtNode: `${story}:m9:s0`,
						question: "地点是什么？",
						answer: "集市",
						evidenceNodes: [],
						kind: "state",
					},
				],
			}),
		).rejects.toThrow(
			`故事 ${story} 缺少提问楼层：${story}:m9:s0（题目 missing）`,
		);
	});

	it("没有表格数据时记不适用", async () => {
		const story = "无表格故事";
		const result = await evaluateAcuCoverage({
			chatPath: `${fixturesPath}none/chat.jsonl`,
			storyId: story,
			questions: [
				{
					id: "none",
					story,
					askAtNode: `${story}:m1:s0`,
					question: "地点是什么？",
					answer: "集市",
					evidenceNodes: [],
					kind: "state",
				},
			],
		});
		expect(result.applicable).toBe(false);
		expect(result.snapshotFloorCount).toBe(0);
		expect(result.questionCount).toBe(1);
		expect(result.coveredCount).toBe(0);
	});
});

describe("collectAcuBaseline", () => {
	it("按 manifest 和题目文件汇总，不适用对话不进入合计", async () => {
		const baseline = await collectAcuBaseline({
			rawRoot: `${fixturesPath}cells`,
			evalsetRoot: `${fixturesPath}cells/evalset`,
			generatedAt: "2026-01-04T00:00:00.000Z",
		});
		expect(baseline.generatedAt).toBe("2026-01-04T00:00:00.000Z");
		expect(baseline.stories).toHaveLength(1);
		expect(baseline.stories[0]?.story).toBe("表格故事");
		expect(baseline.total).toEqual({ questionCount: 1, coveredCount: 1 });
		expect(baseline.byKind).toEqual([
			{ kind: "state", questionCount: 1, coveredCount: 1 },
		]);
	});

	it("缺少状态题文件时直接报错", async () => {
		await expect(
			collectAcuBaseline({
				rawRoot: `${fixturesPath}cells`,
				evalsetRoot: `${fixturesPath}不存在`,
			}),
		).rejects.toThrow();
	});
});
