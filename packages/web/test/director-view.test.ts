import type { DirectorPlan, TurnTrace } from "@dramaticer/core";
import type {
	DirectorDecisionView,
	NodeDirectorView,
} from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import {
	addDirectorArc,
	addDirectorBeat,
	addDirectorSequence,
	buildTraceView,
	countPlanBeats,
	emptyDirectorPlan,
	findDirectorBeat,
	flattenSignalRows,
	joinPlanLines,
	nextDirectorEntryId,
	removeDirectorArc,
	removeDirectorBeat,
	removeDirectorSequence,
	splitPlanLines,
	summarizeDirectorDecision,
	summarizeDirectorView,
	updateDirectorArc,
	updateDirectorBeat,
	updateDirectorSequence,
} from "../src/chat/director-view";

const CREATED_AT = "2026-11-08T10:00:00.000Z";

function planFixture(): DirectorPlan {
	return {
		arcs: [
			{
				id: "arc-1",
				title: "归乡",
				throughLine: "主角必须面对旧身份",
				difficulty: 0.6,
				redLines: ["不复活死者"],
				sequences: [
					{
						id: "sequence-1",
						title: "旧宅",
						beats: [
							{
								id: "beat-1",
								goal: "让守门人认出主角",
								entrySigns: ["门铃声停了"],
								fitPoints: ["旧钥匙", "守门人的迟疑"],
							},
						],
					},
				],
			},
		],
	};
}

function decisionFixture(
	overrides: Partial<DirectorDecisionView> = {},
): DirectorDecisionView {
	return {
		nodeId: "node-1",
		storyId: "story-1",
		directive: "让守门人先开口。",
		mechanisms: [
			{ name: "beat", triggered: true, reason: "当前拍 beat-1" },
			{ name: "clue", triggered: false, reason: "没有未兑现线索" },
		],
		signals: {
			beat: {
				beatId: "beat-1",
				arcId: "arc-1",
				sequenceId: "sequence-1",
				intensity: "natural",
				difficulty: 0.6,
				floorDepth: 3,
				usedFitPoints: ["旧钥匙"],
			},
			clue: { openClues: 2, oldestAge: 4, countTriggered: true },
		},
		createdAt: CREATED_AT,
		...overrides,
	};
}

function traceFixture(): TurnTrace {
	return {
		storyId: "story-1",
		nodeId: "node-1",
		parentNodeId: "node-0",
		templateId: "dramaticer-default",
		turnMode: "fast",
		profile: "native",
		createdAt: CREATED_AT,
		context: {
			budgetTokens: 12000,
			totalTokens: 3210,
			entries: [
				{
					segmentId: "character",
					kind: "slot",
					slot: "character",
					source: "card:主角",
					priority: 100,
					tokens: 210,
					status: "included",
				},
				{
					segmentId: "history",
					kind: "slot",
					slot: "history",
					source: "path",
					priority: 40,
					tokens: 2000,
					status: "included",
					history: {
						policy: "default",
						recentRawFloors: 1,
						omitted: [
							{ blockType: "选项", characters: 120, tokens: 30 },
							{ blockType: "图片", characters: 40, tokens: 10 },
						],
					},
				},
				{
					segmentId: "director",
					kind: "slot",
					slot: "director",
					source: "director",
					priority: 60,
					tokens: 20,
					status: "included",
					appendedTo: "last-user",
				},
				{
					segmentId: "memory",
					kind: "slot",
					slot: "memory",
					source: "retrieval",
					priority: 50,
					tokens: 0,
					status: "missing-slot",
				},
				{
					segmentId: "lore",
					kind: "slot",
					slot: "lore",
					source: "worldbook",
					priority: 70,
					tokens: 900,
					status: "budget-dropped",
				},
				{
					segmentId: "optional",
					kind: "static",
					slot: null,
					source: "template",
					priority: 1,
					tokens: 0,
					status: "condition-false",
				},
			],
		},
		llm: {
			role: "writer",
			model: "auto/deepseek-v4.1-flash",
			channel: "main-fallback",
			stopReason: "stop",
			finishReason: "stop",
			truncations: [],
			usage: {
				promptTokens: 3000,
				completionTokens: 210,
				totalTokens: 3210,
				reasoningTokens: 90,
				cachedTokens: 0,
			},
			attempts: 1,
			rounds: 2,
			cached: false,
		},
		tools: {
			transport: "text",
			rounds: 1,
			maxRounds: 3,
			capped: false,
			calls: [
				{ name: "search_lore", ok: true, error: null, permission: "read" },
			],
			rejected: [{ name: "write_state", reason: "写入工具不执行" }],
		},
		structured: {
			mode: "text-tags",
			acceptedStateUpdates: 2,
			acceptedNotes: 1,
			issues: [],
		},
		timing: { firstTokenMs: 1448, durationMs: 2666 },
		deep: null,
		run: null,
	};
}

describe("导演决策展示", () => {
	it("透明模式给出当前拍、强度、指令与信号", () => {
		const view: NodeDirectorView = {
			nodeId: "node-1",
			mode: "transparent",
			decision: decisionFixture(),
		};
		const summary = summarizeDirectorView(view, planFixture());
		expect(summary.blind).toBe(false);
		expect(summary.label).toBe("透明");
		expect(summary.decision?.directive).toBe("让守门人先开口。");
		expect(summary.decision?.intensity).toBe("natural");
		expect(summary.decision?.beat).toMatchObject({
			beatId: "beat-1",
			arcTitle: "归乡",
			sequenceTitle: "旧宅",
			goal: "让守门人认出主角",
			floorDepth: 3,
			usedFitPoints: ["旧钥匙"],
		});
		expect(summary.decision?.signalRows).toEqual(
			expect.arrayContaining([
				{ label: "beat.beatId", value: "beat-1" },
				{ label: "beat.usedFitPoints", value: "旧钥匙" },
				{ label: "clue.openClues", value: "2" },
				{ label: "clue.countTriggered", value: "是" },
			]),
		);
		expect(summary.decision?.mechanisms).toEqual([
			{ name: "beat", label: "节拍", triggered: true, reason: "当前拍 beat-1" },
			{
				name: "clue",
				label: "线索",
				triggered: false,
				reason: "没有未兑现线索",
			},
		]);
	});

	it("盲盒模式没有信号，指令由服务端隐去", () => {
		const view: NodeDirectorView = {
			nodeId: "node-1",
			mode: "blind",
			decision: decisionFixture({ directive: null, signals: undefined }),
		};
		const summary = summarizeDirectorView(view, null);
		expect(summary.blind).toBe(true);
		expect(summary.decision?.directive).toBeNull();
		expect(summary.decision?.signalRows).toEqual([]);
		expect(summary.decision?.beat).toBeNull();
		expect(summary.decision?.mechanisms).toHaveLength(2);
	});

	it("没有评估过时决策为 null", () => {
		const view: NodeDirectorView = {
			nodeId: "node-1",
			mode: "off",
			decision: null,
		};
		expect(summarizeDirectorView(view, null)).toEqual({
			mode: "off",
			label: "关闭",
			blind: false,
			decision: null,
		});
	});

	it("信号按叶子展开，空数组与嵌套对象各有说明", () => {
		expect(
			flattenSignalRows({
				openClues: 0,
				ids: [],
				nested: { triggered: false, tags: ["甲", "乙"] },
				empty: {},
			}),
		).toEqual([
			{ label: "openClues", value: "0" },
			{ label: "ids", value: "（空数组）" },
			{ label: "nested.triggered", value: "否" },
			{ label: "nested.tags", value: "甲、乙" },
			{ label: "empty", value: "（空对象）" },
		]);
	});

	it("计划里的拍按 id 查找，没有计划时为 null", () => {
		expect(findDirectorBeat(planFixture(), "beat-1")?.beat.goal).toBe(
			"让守门人认出主角",
		);
		expect(findDirectorBeat(planFixture(), "beat-404")).toBeNull();
		expect(findDirectorBeat(null, "beat-1")).toBeNull();
	});

	it("决策缺少 beat 信号时用开场的强度", () => {
		const summary = summarizeDirectorDecision(
			decisionFixture({
				signals: { opening: { intensity: "detonate", floorDepth: 1 } },
			}),
			null,
		);
		expect(summary.beat).toBeNull();
		expect(summary.intensity).toBe("detonate");
	});
});

describe("导演计划的编辑操作", () => {
	it("新增弧线、序列与拍使用递增且不重复的 id", () => {
		let plan = addDirectorArc(emptyDirectorPlan());
		plan = addDirectorSequence(plan, 0);
		plan = addDirectorBeat(plan, 0, 0);
		plan = addDirectorBeat(plan, 0, 0);
		expect(plan.arcs[0]?.id).toBe("arc-1");
		expect(plan.arcs[0]?.sequences[0]?.id).toBe("sequence-1");
		expect(plan.arcs[0]?.sequences[0]?.beats.map((beat) => beat.id)).toEqual([
			"beat-1",
			"beat-2",
		]);
		expect(countPlanBeats(plan)).toBe(2);
		expect(nextDirectorEntryId("beat", plan)).toBe("beat-3");
	});

	it("字段更新保持其它条目不变", () => {
		const original = planFixture();
		const updated = updateDirectorBeat(
			updateDirectorSequence(
				updateDirectorArc(original, 0, { title: "新标题", redLines: ["乙"] }),
				0,
				0,
				{ title: "新序列" },
			),
			0,
			0,
			0,
			{ goal: "新目标", entrySigns: ["甲"], fitPoints: ["乙", "丙"] },
		);
		expect(updated.arcs[0]?.title).toBe("新标题");
		expect(updated.arcs[0]?.redLines).toEqual(["乙"]);
		expect(updated.arcs[0]?.sequences[0]?.title).toBe("新序列");
		expect(updated.arcs[0]?.sequences[0]?.beats[0]).toEqual({
			id: "beat-1",
			goal: "新目标",
			entrySigns: ["甲"],
			fitPoints: ["乙", "丙"],
		});
		expect(original.arcs[0]?.title).toBe("归乡");
	});

	it("删除弧线、序列与拍不影响其它层级", () => {
		let plan = planFixture();
		plan = addDirectorSequence(plan, 0);
		plan = addDirectorBeat(plan, 0, 0);
		plan = removeDirectorBeat(plan, 0, 0, 1);
		expect(plan.arcs[0]?.sequences[0]?.beats).toHaveLength(1);
		plan = removeDirectorSequence(plan, 0, 1);
		expect(plan.arcs[0]?.sequences).toHaveLength(1);
		plan = removeDirectorArc(plan, 0);
		expect(plan.arcs).toHaveLength(0);
	});

	it("多行文本按行去空，空行不进入数组", () => {
		expect(splitPlanLines(" 甲 \n\n乙\r\n  ")).toEqual(["甲", "乙"]);
		expect(joinPlanLines(["甲", "乙"])).toBe("甲\n乙");
	});
});

describe("Trace 展示", () => {
	it("给出模型、渠道、用量、工具轮次与回合模式", () => {
		const view = buildTraceView(traceFixture());
		expect(view.turnRows).toEqual(
			expect.arrayContaining([
				{ label: "回合模式", value: "快回合" },
				{ label: "模板", value: "dramaticer-default" },
			]),
		);
		expect(view.llmRows).toEqual(
			expect.arrayContaining([
				{ label: "模型", value: "auto/deepseek-v4.1-flash" },
				{ label: "渠道", value: "main-fallback" },
				{ label: "角色", value: "正文" },
				{ label: "输入 token", value: "3000 token" },
				{ label: "结束原因", value: "正常结束" },
			]),
		);
		expect(view.toolsRows).toEqual(
			expect.arrayContaining([
				{ label: "传输", value: "文本协议" },
				{ label: "读取轮次", value: "1 / 软上限 3" },
				{ label: "达到软上限", value: "否" },
				{ label: "调用", value: "search_lore 成功" },
				{ label: "被拒绝", value: "write_state（写入工具不执行）" },
			]),
		);
		expect(view.timingRows).toEqual([
			{ label: "首字", value: "1448 毫秒" },
			{ label: "总耗时", value: "2666 毫秒" },
		]);
	});

	it("上下文分段带状态、拼接口与按块类型的省略量", () => {
		const view = buildTraceView(traceFixture());
		const history = view.context.entries.find(
			(entry) => entry.segmentId === "history",
		);
		expect(history?.tokens).toBe(2000);
		expect(history?.statusLabel).toBe("已注入");
		expect(history?.history?.policy).toBe("默认（省略显示类块）");
		expect(history?.history?.omitted).toEqual([
			{ blockType: "选项", characters: 120, tokens: 30 },
			{ blockType: "图片", characters: 40, tokens: 10 },
		]);
		const director = view.context.entries.find(
			(entry) => entry.segmentId === "director",
		);
		expect(director?.appendedTo).toBe("最后一条 user 消息");
		expect(view.context.dropped).toEqual(["lore"]);
		expect(view.context.missingSlots).toEqual(["memory"]);
		expect(view.context.conditionFalse).toEqual(["optional"]);
		expect(view.context.totalTokens).toBe(3210);
		expect(view.context.budgetTokens).toBe(12000);
	});
});
