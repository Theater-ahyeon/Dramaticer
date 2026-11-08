import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	MEMORY_QUESTION_CATEGORIES,
	memoryQuestionCategoryLabel,
	memoryQuestionFileName,
	parseMemoryQuestion,
	readMemoryQuestionFile,
} from "../src/evalset/memory-questions.js";

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
	const dir = mkdtempSync(path.join(import.meta.dirname, ".tmp-memory-q-"));
	createdDirs.push(dir);
	return dir;
}

function line(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		id: "memory:story:1",
		story: "story",
		askAtNode: "story:m5:s0",
		question: "卫宫在哪里？",
		answer: "山门。",
		evidenceNodes: ["story:m1:s0"],
		kind: "memory",
		category: "extraction",
		...overrides,
	});
}

function writeQuestions(dir: string, lines: readonly string[]): string {
	const filePath = path.join(dir, "memory-story.jsonl");
	writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
	return filePath;
}

describe("五类记忆题文件", () => {
	it("五类与编造标注都能解析", async () => {
		const dir = makeDir();
		const lines = MEMORY_QUESTION_CATEGORIES.map((category, index) =>
			line({
				id: `memory:story:${index}`,
				category,
				fabricated: category === "abstention",
			}),
		);
		const questions = await readMemoryQuestionFile(writeQuestions(dir, lines));
		expect(questions.map((question) => question.category)).toEqual([
			"extraction",
			"cross_segment",
			"temporal",
			"update",
			"abstention",
		]);
		expect(questions.map((question) => question.fabricated)).toEqual([
			false,
			false,
			false,
			false,
			true,
		]);
		expect(memoryQuestionCategoryLabel("cross_segment")).toBe("跨段推理");
		expect(memoryQuestionFileName("a/b:c")).toBe("memory-a_b_c.jsonl");
	});

	it("未知类别、重复 id 与非法字段都直接失败", async () => {
		const dir = makeDir();
		expect(() =>
			parseMemoryQuestion(
				JSON.parse(line({ category: "vibes" })),
				"memory-story.jsonl:1",
			),
		).toThrow(/category/);
		await expect(
			readMemoryQuestionFile(
				writeQuestions(dir, [
					line({ id: "same" }),
					line({ id: "same", category: "update" }),
				]),
			),
		).rejects.toThrow(/重复/);
		expect(() =>
			parseMemoryQuestion(
				JSON.parse(line({ fabricated: "yes" })),
				"memory-story.jsonl:1",
			),
		).toThrow(/fabricated/);
		expect(() =>
			parseMemoryQuestion(
				JSON.parse(line({ evidenceNodes: [] })),
				"memory-story.jsonl:1",
			),
		).toThrow(/evidenceNodes/);
		expect(() =>
			parseMemoryQuestion(
				JSON.parse(line({ extra: 1 })),
				"memory-story.jsonl:1",
			),
		).toThrow(/未知字段/);
	});

	it("空文件与错误 kind 直接失败", async () => {
		const dir = makeDir();
		await expect(
			readMemoryQuestionFile(writeQuestions(dir, [])),
		).rejects.toThrow(/没有任何记忆题/);
		expect(() =>
			parseMemoryQuestion(
				JSON.parse(line({ kind: "event" })),
				"memory-story.jsonl:1",
			),
		).toThrow(/kind/);
	});
});
