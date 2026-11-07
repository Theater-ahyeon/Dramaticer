import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	readQuestionFile,
	sampleDeterministic,
	sanitizeFileName,
	storyIdOf,
} from "../src/evalset/question-files.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));

const stateQuestion = JSON.stringify({
	id: "q1",
	story: "故事",
	askAtNode: "故事:m1:s0",
	question: "问题？",
	answer: "答案",
	evidenceNodes: ["故事:m0:s0"],
	kind: "state",
	path: ["stat_data", "地点"],
});

describe("sanitizeFileName", () => {
	it("把路径与文件名的非法字符替换成下划线", () => {
		expect(sanitizeFileName('a\\b/c:d*e?f"g<h>i|j')).toBe(
			"a_b_c_d_e_f_g_h_i_j",
		);
	});

	it("合法字符保持不变", () => {
		expect(sanitizeFileName("仙侠-雌竞_01")).toBe("仙侠-雌竞_01");
	});
});

describe("storyIdOf", () => {
	it("优先使用角色名", () => {
		expect(storyIdOf({ character: "角色甲", target: "chats/别的.jsonl" })).toBe(
			"角色甲",
		);
	});

	it("没有角色名时取文件名并去掉扩展名", () => {
		expect(storyIdOf({ target: "chats/仙侠雌竞.jsonl" })).toBe("仙侠雌竞");
		expect(storyIdOf({ target: "chats/大写.JSONL" })).toBe("大写");
	});
});

describe("readQuestionFile", () => {
	it("重复 id 抛错并给出行号", async () => {
		const dir = await mkdtemp(path.join(testDir, ".tmp-question-"));
		try {
			const file = path.join(dir, "duplicate.jsonl");
			await writeFile(file, `${stateQuestion}\n${stateQuestion}\n`, "utf8");
			await expect(readQuestionFile(file, "state")).rejects.toThrow(
				`${file}:2 的 id q1 与 ${file}:1 重复`,
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("sampleDeterministic", () => {
	const items = Array.from({ length: 20 }, (_, index) => ({
		id: `q${index}`,
		index,
	}));

	it("同一份题目连续抽取得到相同的样本", () => {
		expect(sampleDeterministic(items, 5)).toEqual(
			sampleDeterministic(items, 5),
		);
	});

	it("样本数量固定，输入乱序后选中的 id 集合不变", () => {
		const first = sampleDeterministic(items, 5);
		const reversed = sampleDeterministic([...items].reverse(), 5);
		expect(first).toHaveLength(5);
		expect(first.map((item) => item.id).sort()).toEqual(
			reversed.map((item) => item.id).sort(),
		);
	});

	it("数量为 0 或超过题目总数时按边界处理", () => {
		expect(sampleDeterministic(items, 0)).toEqual([]);
		expect(sampleDeterministic(items, 100)).toEqual(items);
	});
});
