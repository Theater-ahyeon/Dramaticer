import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	STATE_QUESTION_MAX,
	STATE_QUESTION_MIN,
	assertStateQuestionCount,
	writeStateSummary,
} from "../src/evalset/state-cli.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));

describe("assertStateQuestionCount", () => {
	it("区间内通过", () => {
		expect(() =>
			assertStateQuestionCount("故事", STATE_QUESTION_MIN),
		).not.toThrow();
		expect(() =>
			assertStateQuestionCount("故事", STATE_QUESTION_MAX),
		).not.toThrow();
	});

	it("低于下限或高于上限时抛错并带出题量", () => {
		expect(() =>
			assertStateQuestionCount("故事", STATE_QUESTION_MIN - 1),
		).toThrow(`${STATE_QUESTION_MIN - 1} 道题`);
		expect(() =>
			assertStateQuestionCount("故事", STATE_QUESTION_MAX + 1),
		).toThrow(`${STATE_QUESTION_MAX + 1} 道题`);
	});
});

describe("writeStateSummary", () => {
	it("写出生成时间、故事汇总与总题量", async () => {
		const dir = await mkdtemp(path.join(testDir, ".tmp-state-cli-"));
		try {
			const stories = [
				{
					story: "故事甲",
					file: "state-故事甲.jsonl",
					questions: 60,
					candidates: 80,
					messages: 120,
					updates: 100,
					paths: 20,
					verified: 60,
					sampled: ["q1", "q2"],
				},
			];
			const summaryPath = await writeStateSummary(
				path.join(dir, "evalset"),
				stories,
				"2026-01-08T00:00:00.000Z",
			);
			const value = JSON.parse(await readFile(summaryPath, "utf8"));
			expect(value).toEqual({
				generatedAt: "2026-01-08T00:00:00.000Z",
				stories,
				totalQuestions: 60,
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
