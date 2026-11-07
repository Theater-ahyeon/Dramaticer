import { describe, expect, it } from "vitest";
import {
	JUDGE_ORDERS,
	buildFiller,
	buildJudgeMessages,
	chooseBranchPoint,
	judgePicksFull,
	parseJudgeOutput,
	renderFulltextSection,
	renderTranscript,
	summarizeBranches,
} from "./f0-fulltext-lib.mjs";

const estimate = (text) => Math.ceil([...text].length / 1.5);

function node(role, tokens, assistantBefore) {
	return { role, rawTokens: tokens, assistantBefore };
}

describe("chooseBranchPoint", () => {
	it("取满足门槛的最后一个用户楼层", () => {
		const nodes = [
			node("assistant", 100, 0),
			node("user", 900, 1),
			node("assistant", 200, 1),
			node("user", 5000, 2),
			node("assistant", 300, 2),
			node("user", 4000, 3),
		];
		const chosen = chooseBranchPoint(nodes, {
			maxRawTokens: 6000,
			minAssistantFloors: 2,
		});
		expect(chosen.index).toBe(5);
	});

	it("助手楼层不足时跳过分支点", () => {
		const nodes = [node("user", 10, 0), node("user", 20, 1)];
		expect(() =>
			chooseBranchPoint(nodes, { maxRawTokens: 100, minAssistantFloors: 2 }),
		).toThrow("没有满足条件的分支点");
	});

	it("超过原文上限的分支点不选", () => {
		const nodes = [
			node("user", 200, 3),
			node("user", 900, 3),
		];
		const chosen = chooseBranchPoint(nodes, {
			maxRawTokens: 500,
			minAssistantFloors: 3,
		});
		expect(chosen.index).toBe(0);
	});
});

describe("buildJudgeMessages", () => {
	const input = {
		transcript: "故事正文",
		fullText: "全文组的续写",
		memoryText: "记忆引擎组的续写",
	};

	it("full-first 把全文组放在位置甲", () => {
		const built = buildJudgeMessages({ ...input, order: "full-first" });
		expect(built.positionAArm).toBe("full");
		expect(built.messages[1].content).toContain("续写甲：\n全文组的续写");
		expect(built.messages[1].content).toContain("续写乙：\n记忆引擎组的续写");
	});

	it("memory-first 把记忆引擎组放在位置甲", () => {
		const built = buildJudgeMessages({ ...input, order: "memory-first" });
		expect(built.positionAArm).toBe("memory");
		expect(built.messages[1].content).toContain(
			"续写甲：\n记忆引擎组的续写",
		);
	});

	it("缺少正文时拒绝组装", () => {
		expect(() =>
			buildJudgeMessages({ ...input, transcript: "", order: "full-first" }),
		).toThrow("缺少故事正文");
	});
});

describe("parseJudgeOutput", () => {
	it("接受裸 JSON", () => {
		expect(parseJudgeOutput('{"choice":"B","confidence":0.7}')).toEqual({
			choice: "B",
			confidence: 0.7,
		});
	});

	it("接受代码围栏", () => {
		expect(
			parseJudgeOutput('```json\n{"choice":"A","confidence":1}\n```'),
		).toEqual({ choice: "A", confidence: 1 });
	});

	it("拒绝非法 choice", () => {
		expect(() => parseJudgeOutput('{"choice":"C","confidence":0.5}')).toThrow(
			"choice 不合法",
		);
	});

	it("拒绝超出范围的置信度", () => {
		expect(() => parseJudgeOutput('{"choice":"A","confidence":1.5}')).toThrow(
			"confidence",
		);
	});
});

describe("judgePicksFull", () => {
	it("按顺序把位置换算成组", () => {
		expect(judgePicksFull("full-first", "A")).toBe(true);
		expect(judgePicksFull("full-first", "B")).toBe(false);
		expect(judgePicksFull("memory-first", "A")).toBe(false);
		expect(judgePicksFull("memory-first", "B")).toBe(true);
	});
});

describe("summarizeBranches", () => {
	it("统计胜负、位置偏差与顺序一致性", () => {
		const branches = [{ label: "1" }, { label: "2" }];
		const judgements = [
			{ branch: "1", order: JUDGE_ORDERS[0], choice: "A", confidence: 0.8, ok: true },
			{ branch: "1", order: JUDGE_ORDERS[1], choice: "B", confidence: 0.6, ok: true },
			{ branch: "2", order: JUDGE_ORDERS[0], choice: "B", confidence: 0.9, ok: true },
			{ branch: "2", order: JUDGE_ORDERS[1], choice: "A", confidence: 0.7, ok: true },
		];
		const summary = summarizeBranches(branches, judgements);
		expect(summary.judgements).toBe(4);
		expect(summary.fullWins).toBe(2);
		expect(summary.memoryWins).toBe(2);
		expect(summary.positionAShare).toBe(0.5);
		expect(summary.consistentBranches).toBe(2);
		expect(summary.branchesWithBothOrders).toBe(2);
		expect(summary.perOrder[0].fullWins).toBe(1);
		expect(summary.perOrder[1].fullWins).toBe(1);
		expect(summary.confidenceMean).toBeCloseTo(0.75);
	});

	it("接受 label 字段的结果", () => {
		const summary = summarizeBranches(
			[{ label: "7" }],
			[
				{ label: "7", order: "full-first", choice: "A", confidence: 0.8, ok: true },
			],
		);
		expect(summary.fullWins).toBe(1);
	});

	it("缺少分支标签时抛错", () => {
		expect(() =>
			summarizeBranches(
				[{ label: "1" }],
				[{ order: "full-first", choice: "A", confidence: 0.5, ok: true }],
			),
		).toThrow("缺少分支标签");
	});

	it("忽略失败判断并按最后一行覆盖", () => {
		const branches = [{ label: "1" }];
		const judgements = [
			{ branch: "1", order: "full-first", choice: "B", confidence: 0.5, ok: true },
			{ branch: "1", order: "full-first", choice: "A", confidence: 0.9, ok: true },
			{ branch: "1", order: "memory-first", choice: "A", confidence: 0.2, ok: false },
		];
		const summary = summarizeBranches(branches, judgements);
		expect(summary.judgements).toBe(1);
		expect(summary.fullWins).toBe(1);
		expect(summary.consistentBranches).toBe(0);
	});
});

describe("buildFiller", () => {
	it("生成的填充文本接近目标 token", () => {
		const text = buildFiller(3000, estimate);
		const tokens = estimate(text);
		expect(tokens).toBeGreaterThanOrEqual(2700);
		expect(tokens).toBeLessThanOrEqual(3000);
	});

	it("拒绝非正整数的目标", () => {
		expect(() => buildFiller(0, estimate)).toThrow("正整数");
	});
});

describe("renderTranscript", () => {
	it("按角色标注楼层", () => {
		const text = renderTranscript([
			{ role: "user", text: "第一句" },
			{ role: "assistant", text: "第二句" },
		]);
		expect(text).toContain('角色="用户"');
		expect(text).toContain("第一句");
		expect(text).toContain('角色="助手"');
	});
});

describe("renderFulltextSection", () => {
	it("渲染探测、分支与裁判表格", () => {
		const section = renderFulltextSection({
			generatedAt: "2026-11-07T00:00:00.000Z",
			probe: {
				modelAlias: "main-fallback",
				entries: [
					{
						level: 32768,
						estimatedTokens: 32400,
						modelAlias: "main-fallback",
						ok: true,
						promptTokens: 32100,
						firstTokenMs: 900,
						durationMs: 1100,
						note: "—",
					},
				],
				conclusion: "最大被接受的级别是 32768",
			},
			branches: [
				{
					label: "95",
					priorFloors: 42,
					assistantFloors: 21,
					rawTokens: 53673,
					viewTokens: 53673,
					summaryCount: 1,
					stateDiffCount: 972,
				},
			],
			generations: [
				{
					label: "95",
					arm: "full",
					promptTokens: 54000,
					firstTokenMs: 1200,
					completionTokens: 900,
					stopReason: "stop",
				},
				{
					label: "95",
					arm: "memory",
					promptTokens: 13000,
					firstTokenMs: 1100,
					completionTokens: 950,
					stopReason: "stop",
				},
			],
			judgements: [
				{ branch: "95", order: "full-first", choice: "A", confidence: 0.8, ok: true },
				{ branch: "95", order: "memory-first", choice: "B", confidence: 0.7, ok: true },
			],
			callCounts: { main: 3, judge: 2 },
		});
		expect(section.startsWith("<!-- F0-T04:begin -->")).toBe(true);
		expect(section.endsWith("<!-- F0-T04:end -->")).toBe(true);
		expect(section).toContain("| 32768 |");
		expect(section).toContain("| 对话 95 | 42 | 21 | 53673 |");
		expect(section).toContain("合计 2 次判断：全文组胜 2 次");
	});
});
