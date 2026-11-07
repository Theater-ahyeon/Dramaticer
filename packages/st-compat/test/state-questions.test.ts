import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StoryStore } from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import type { JsonObject, JsonValue } from "../src/index.js";
import {
	buildStateQuestions,
	buildStateQuestionsFromFile,
	importChatToStore,
	isJsonObject,
	parseChatJsonl,
	readSnapshot,
	verifyStateQuestions,
	verifyStateQuestionsFromFile,
} from "../src/index.js";
import { mvuSnapshotAt } from "./store-replay.js";

const storyId = "story-state";
const testDir = path.dirname(fileURLToPath(import.meta.url));

function buildLines(): string[] {
	const lines = [JSON.stringify({ character_name: "测试角色" })];
	for (let floor = 0; floor <= 120; floor += 1) {
		let variables: unknown[] = [{}];
		if (floor === 0) {
			variables = [
				{
					stat_data: {
						hp: 100,
						mood: "平静",
						pair: ["初始", "说明"],
						gone: "存在",
					},
					schema: { type: "object" },
				},
			];
		}
		if (floor === 60) {
			variables = [
				{
					stat_data: {
						hp: 80,
						mood: "平静",
						pair: ["变化", "说明"],
					},
					schema: { type: "object" },
				},
			];
		}
		if (floor === 120) {
			variables = [
				{
					stat_data: {
						hp: 70,
						mood: "平静",
						pair: ["最终", "说明"],
					},
					schema: { type: "object" },
				},
			];
		}
		lines.push(
			JSON.stringify({
				name: "角色",
				is_user: false,
				mes: `第 ${floor} 楼`,
				variables,
			}),
		);
	}
	return lines;
}

async function generate(maxPerPath?: number) {
	const lines = buildLines();
	const result = await buildStateQuestions(parseChatJsonl([lines.join("\n")]), {
		storyId,
		minQuestions: 1,
		maxQuestions: 20,
		maxPerPath,
	});
	return { lines, result };
}

describe("readSnapshot", () => {
	it("空对象表示没有 MVU 更新", () => {
		expect(readSnapshot({}, "快照")).toBeNull();
		expect(readSnapshot(null, "快照")).toBeNull();
	});
});

describe("buildStateQuestions", () => {
	it("allowEmpty 时没有候选返回空结果", async () => {
		const lines = [
			JSON.stringify({ character_name: "测试角色" }),
			JSON.stringify({
				name: "角色",
				is_user: false,
				mes: "只有一楼",
				variables: [{ stat_data: { hp: 100 } }],
			}),
		];
		const result = await buildStateQuestions(
			parseChatJsonl([lines.join("\n")]),
			{
				storyId,
				allowEmpty: true,
			},
		);
		expect(result.questions).toEqual([]);
		expect(result.stats.questionCount).toBe(0);
		expect(result.stats.candidateCount).toBe(0);
		await expect(
			buildStateQuestions(parseChatJsonl([lines.join("\n")]), { storyId }),
		).rejects.toThrow("没有满足间隔要求的状态题候选");
	});

	it("按稳定区间出题，答案取快照，证据是变化楼层", async () => {
		const { result } = await generate();
		expect(result.questions).toHaveLength(6);
		expect(result.stats.candidateCount).toBe(6);
		expect(result.stats.minGap).toBeGreaterThanOrEqual(30);

		const hpFirst = result.questions.find(
			(question) =>
				question.path.join(".") === "stat_data.hp" && question.answer === 100,
		);
		expect(hpFirst).toBeDefined();
		expect(hpFirst?.askAtNode).toBe("story-state:m59:s0");
		expect(hpFirst?.evidenceNodes).toEqual(["story-state:m0:s0"]);
		expect(hpFirst?.question).toBe("在第 1 楼之后，「hp」的值是什么？");
		expect(hpFirst?.kind).toBe("state");
		expect(hpFirst?.story).toBe(storyId);
	});

	it("空对象楼层不覆盖状态，三元组按值和说明拆开", async () => {
		const { result } = await generate();
		const pair = result.questions.find(
			(question) =>
				question.path.join(".") === "stat_data.pair" &&
				question.answer === "初始",
		);
		expect(pair?.askAtNode).toBe("story-state:m59:s0");
		const mood = result.questions.find(
			(question) => question.path.join(".") === "stat_data.mood",
		);
		expect(mood?.answer).toBe("平静");
		expect(mood?.askAtNode).toBe("story-state:m120:s0");
	});

	it("被删除的变量只保留删除前的稳定区间", async () => {
		const { result } = await generate();
		const gone = result.questions.filter(
			(question) => question.path.join(".") === "stat_data.gone",
		);
		expect(gone).toHaveLength(1);
		expect(gone[0]?.answer).toBe("存在");
		expect(gone[0]?.askAtNode).toBe("story-state:m59:s0");
	});

	it("maxPerPath 限制同一条路径的题目数量", async () => {
		const { result } = await generate(1);
		const keys = result.questions.map((question) => question.path.join("."));
		expect(new Set(keys).size).toBe(keys.length);
		expect(result.questions).toHaveLength(4);
	});

	it("FromFile 包装与内存版本结果一致", async () => {
		const lines = buildLines();
		const dir = await mkdtemp(path.join(testDir, ".tmp-state-"));
		try {
			const filePath = path.join(dir, "chat.jsonl");
			await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
			const options = {
				storyId,
				minQuestions: 1,
				maxQuestions: 20,
			};
			const fromFile = await buildStateQuestionsFromFile(filePath, options);
			const fromMemory = await buildStateQuestions(
				parseChatJsonl([lines.join("\n")]),
				options,
			);
			expect(fromFile.questions).toEqual(fromMemory.questions);
			const verification = await verifyStateQuestionsFromFile(
				filePath,
				fromFile.questions,
				{ storyId },
			);
			expect(verification.checked).toBe(fromFile.questions.length);
			expect(verification.failures).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("verifyStateQuestions", () => {
	it("全部题目在提问楼层与证据楼层都与快照一致", async () => {
		const { lines, result } = await generate();
		const verification = await verifyStateQuestions(
			parseChatJsonl([lines.join("\n")]),
			result.questions,
			{ storyId },
		);
		expect(verification.checked).toBe(6);
		expect(verification.failures).toEqual([]);
	});

	it("答案被篡改时核对失败", async () => {
		const { lines, result } = await generate();
		const target = result.questions.find((question) => question.answer === 100);
		expect(target).toBeDefined();
		const tampered = result.questions.map((question) =>
			question.id === target?.id ? { ...question, answer: 101 } : question,
		);
		const verification = await verifyStateQuestions(
			parseChatJsonl([lines.join("\n")]),
			tampered,
			{ storyId },
		);
		expect(verification.failures.map((failure) => failure.id)).toContain(
			target?.id,
		);
	});

	it("证据楼层取错时核对失败", async () => {
		const { lines, result } = await generate();
		const target = result.questions.find((question) => question.answer === 100);
		expect(target).toBeDefined();
		if (!target) return;
		const shifted = result.questions.map((question) =>
			question.id === target.id
				? { ...question, evidenceNodes: ["story-state:m60:s0"] }
				: question,
		);
		const verification = await verifyStateQuestions(
			parseChatJsonl([lines.join("\n")]),
			shifted,
			{ storyId },
		);
		expect(verification.failures[0]?.reason).toContain("证据楼层");
	});
});

describe("状态题与导入后的状态一致", () => {
	it("每道题的答案与 store 回放出的快照一致", async () => {
		const { lines, result } = await generate();
		const store = StoryStore.open(":memory:");
		onTestFinished(() => store.close());
		await importChatToStore(store, parseChatJsonl([lines.join("\n")]), {
			storyId,
		});

		for (const question of result.questions) {
			const snapshot = mvuSnapshotAt(store, question.askAtNode);
			const actual = answerOf(resolvePath(snapshot, question.path));
			expect(actual, question.id).toEqual(question.answer);
		}
	});
});

function resolvePath(
	root: JsonObject,
	path: readonly string[],
): JsonValue | undefined {
	let current: JsonValue = root;
	for (const part of path) {
		if (!isJsonObject(current) || !Object.hasOwn(current, part)) {
			return undefined;
		}
		current = current[part];
	}
	return current;
}

/** MVU 的 `["值", "说明"]` 只比较值本身，与出题的答案口径一致。 */
function answerOf(value: JsonValue | undefined): JsonValue | undefined {
	if (
		Array.isArray(value) &&
		value.length === 2 &&
		typeof value[1] === "string"
	) {
		return value[0];
	}
	return value;
}
