import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDotEnv } from "../src/evalset/env.js";
import {
	eventSpotcheckPath,
	eventSummaryPath,
	renderSpotcheck,
} from "../src/evalset/event-output.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));

describe("loadDotEnv", () => {
	it("文件缺失时抛错并包含文件路径", () => {
		const missing = path.join(testDir, "不存在的目录", ".env");
		expect(() => loadDotEnv(missing)).toThrow(missing);
	});
});

describe("事件产物路径", () => {
	it("全量运行写全局文件", () => {
		expect(eventSpotcheckPath("输出")).toBe(path.join("输出", "spotcheck.md"));
		expect(eventSummaryPath("输出")).toBe(
			path.join("输出", "event-summary.json"),
		);
	});

	it("--story 运行写故事专属文件", () => {
		expect(eventSpotcheckPath("输出", "仙侠/雌竞")).toBe(
			path.join("输出", "spotcheck-仙侠_雌竞.md"),
		);
		expect(eventSummaryPath("输出", "仙侠/雌竞")).toBe(
			path.join("输出", "event-summary-仙侠_雌竞.json"),
		);
	});
});

describe("renderSpotcheck", () => {
	it("包含题目的问题、答案与证据原文", () => {
		const text = renderSpotcheck(
			[
				{
					id: "event:故事:2:1",
					story: "故事",
					askAtNode: "故事:m1:s0",
					question: "发生了什么？",
					answer: "角色完成了任务",
					evidenceNodes: ["故事:m0:s0"],
					kind: "event",
				},
			],
			5,
			new Map([
				["故事:m0:s0", { nodeId: "故事:m0:s0", name: "角色", text: "原文" }],
			]),
			"2026-01-08T00:00:00.000Z",
		);
		expect(text).toContain("生成时间：2026-01-08T00:00:00.000Z");
		expect(text).toContain("从 5 道事件题里抽取 1 道（20%）");
		expect(text).toContain("发生了什么？");
		expect(text).toContain("角色完成了任务");
		expect(text).toContain("原文");
	});
});
