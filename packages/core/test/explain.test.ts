import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type ExplainReport,
	type StoryStore,
	type TurnTrace,
	explainNode,
	renderExplainReport,
	runExplainCli,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "排障测试" });
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: null,
		role: "user",
		raw: "卫宫，你今天怎么这么安静？",
	});
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "卫宫把杯子放下，没有回答。",
	});
}

function traceFor(nodeId: string, parentNodeId: string): TurnTrace {
	return {
		storyId: "s1",
		nodeId,
		parentNodeId,
		templateId: "dramaticer-default",
		turnMode: "fast",
		profile: "native",
		createdAt: "2026-11-08T00:00:00.000Z",
		context: {
			budgetTokens: 1_000,
			totalTokens: 30,
			entries: [
				{
					segmentId: "character",
					kind: "slot",
					slot: "character",
					source: "character:12 字符",
					priority: 100,
					tokens: 10,
					status: "included",
				},
				{
					segmentId: "memory",
					kind: "slot",
					slot: "memory",
					source: "memory:1",
					priority: 60,
					tokens: 20,
					status: "included",
					retrieval: {
						routes: [
							{
								route: "bm25",
								items: [{ kind: "chunk", nodeId: "u1" }],
							},
							{ route: "recent", items: [] },
						],
						hits: [
							{
								kind: "chunk",
								nodeId: "u1",
								score: 0.5,
								sources: [{ route: "bm25", rank: 1 }],
							},
						],
						injectedNodeIds: ["u1"],
					},
				},
				{
					segmentId: "director",
					kind: "slot",
					slot: "director",
					source: "director:clue",
					priority: 23,
					tokens: 12,
					status: "included",
					appendedTo: "last-user",
				},
				{
					segmentId: "summary",
					kind: "slot",
					slot: "summary",
					source: "summary:mainline",
					priority: 30,
					tokens: 50,
					status: "budget-dropped",
				},
				{
					segmentId: "scene",
					kind: "slot",
					slot: "scene",
					source: "slot:scene",
					priority: 50,
					tokens: 0,
					status: "missing-slot",
				},
			],
		},
		llm: {
			role: "writer",
			model: "auto/deepseek-v4.1-flash",
			channel: "magpie",
			stopReason: "stop",
			finishReason: "stop",
			truncations: [],
			usage: {
				promptTokens: 1_200,
				completionTokens: 300,
				totalTokens: 1_500,
				reasoningTokens: null,
				cachedTokens: null,
			},
			attempts: 1,
			rounds: 2,
			cached: false,
		},
		tools: {
			transport: "native",
			rounds: 1,
			maxRounds: 3,
			capped: false,
			calls: [{ name: "memory_search", ok: true, error: null }],
			rejected: [],
		},
		structured: {
			mode: "text-tags",
			acceptedStateUpdates: 1,
			acceptedNotes: 0,
			issues: [],
		},
		timing: { firstTokenMs: 1_448, durationMs: 2_666 },
	};
}

describe("explainNode", () => {
	it("按固定顺序给出 Trace、分段、检索、台账与导演决策", () => {
		const { store } = openTempStore();
		seed(store);
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "a1",
				path: ["character", "卫宫", "mood"],
				op: "set",
				value: "沉默",
				source: "model",
			},
		]);
		store.saveTurnTrace(traceFor("a1", "u1"));
		store.saveDirectorDecision({
			nodeId: "u1",
			storyId: "s1",
			directive: "让卫宫说出一个具体理由",
			mechanisms: [
				{
					name: "opening",
					triggered: true,
					reason: "楼层深度 1，在开场范围内",
				},
				{ name: "clue", triggered: false, reason: "没有未兑现线索" },
			],
			signals: { openingFloors: 1 },
			createdAt: "2026-11-08T00:00:00.000Z",
		});

		const report = explainNode(store, "a1");

		expect(report.trace?.llm.model).toBe("auto/deepseek-v4.1-flash");
		expect(report.context?.entries.map((entry) => entry.segmentId)).toEqual([
			"character",
			"memory",
			"director",
			"summary",
			"scene",
		]);
		expect(report.context?.dropped.map((entry) => entry.segmentId)).toEqual([
			"summary",
		]);
		expect(
			report.context?.missingSlots.map((entry) => entry.segmentId),
		).toEqual(["scene"]);
		expect(report.retrieval).toHaveLength(1);
		expect(report.retrieval[0]?.segmentId).toBe("memory");
		expect(report.retrieval[0]?.routes.map((route) => route.route)).toEqual([
			"bm25",
			"recent",
		]);
		expect(report.retrieval[0]?.hits[0]?.nodeId).toBe("u1");
		expect(report.retrieval[0]?.injectedNodeIds).toEqual(["u1"]);
		expect(report.ledger.facts.map((fact) => fact.path)).toEqual([
			["character", "卫宫", "mood"],
		]);
		expect(report.ledger.diffs).toHaveLength(1);
		expect(report.director?.nodeId).toBe("u1");
		expect(report.director?.decision.directive).toBe("让卫宫说出一个具体理由");
		expect(report.notes).toEqual([]);
		expect(
			report.suggestions.some((suggestion) =>
				suggestion.advice.includes("预算裁剪"),
			),
		).toBe(true);
		expect(
			report.suggestions.some((suggestion) =>
				suggestion.advice.includes("槽位 scene"),
			),
		).toBe(true);

		const text = renderExplainReport(report);
		const order = [
			"1. 这一轮用的模型与结果",
			"2. 上下文分段与 token",
			"3. 被裁剪的段落与缺失槽位",
			"4. 记忆检索的每一路名次与融合结果",
			"5. 台账快照与本楼写入",
			"6. 导演决策",
			"7. 当前拍与落拍记录",
			"8. 修正建议",
		].map((heading) => text.indexOf(heading));
		expect(order.every((index) => index >= 0)).toBe(true);
		expect([...order].sort((left, right) => left - right)).toEqual(order);
		expect(text).toContain("路 bm25：u1（chunk，第 1）");
		expect(text).toContain("分数 0.5000");
		expect(text).toContain("拼接到最后一条 user 消息（appendedTo: last-user）");
		expect(text).toContain("character.卫宫.mood");
		expect(text).toContain("让卫宫说出一个具体理由");
	});

	it("盲盒模式下 explain 仍显示完整导演决策", () => {
		const { store } = openTempStore();
		seed(store);
		store.updateStorySettings("s1", {
			directorConfig: { ...DEFAULT_DIRECTOR_CONFIG, mode: "blind" },
		});
		store.saveDirectorDecision({
			nodeId: "u1",
			storyId: "s1",
			directive: "让卫宫说出一个具体理由",
			mechanisms: [{ name: "clue", triggered: true, reason: "线索过老" }],
			signals: { openClues: 1 },
		});

		const report = explainNode(store, "a1");

		expect(report.director?.decision.directive).toBe("让卫宫说出一个具体理由");
		expect(renderExplainReport(report)).toContain("让卫宫说出一个具体理由");
	});

	it("打印运行日志摘要与按序号排列的事件", () => {
		const { store } = openTempStore();
		seed(store);
		store.saveTurnTrace({
			...traceFor("a1", "u1"),
			turnMode: "deep",
			deep: {
				maxToolCalls: 40,
				maxDurationMs: 600_000,
				toolCallCount: 0,
				durationMs: 500,
				stopReason: "completed",
				commit: "auto",
				drift: "missing_commit",
			},
			run: { runId: "r1", status: "completed", eventCount: 1 },
		});
		store.startTurnRun({
			runId: "r1",
			storyId: "s1",
			userNodeId: "u1",
			mode: "deep",
			startedAt: "2026-11-12T00:00:00.000Z",
		});
		store.appendTurnRunEvent({
			runId: "r1",
			kind: "model.request",
			payload: { round: 1, messages: 3 },
			createdAt: "2026-11-12T00:00:01.000Z",
		});
		store.finishTurnRun({
			runId: "r1",
			status: "completed",
			nodeId: "a1",
			finishedAt: "2026-11-12T00:00:02.000Z",
		});

		const report = explainNode(store, "a1");

		expect(report.run?.run.runId).toBe("r1");
		expect(report.run?.events.map((event) => event.kind)).toEqual([
			"model.request",
		]);
		const text = renderExplainReport(report);
		expect(text).toContain("运行：r1（completed，事件 1 条）");
		expect(text).toContain("9. 运行时间线");
		expect(text).toContain("#1 model.request");
		expect(text).toContain('"messages":3');
	});

	it("没有 Trace 的楼层明确写没有记录，仍然读出台账与导演决策", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "排障测试" });
		store.appendNode({
			id: "imported",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "导入的历史楼层。",
		});

		const report = explainNode(store, "imported");

		expect(report.trace).toBeNull();
		expect(report.context).toBeNull();
		expect(report.retrieval).toEqual([]);
		expect(report.ledger).toEqual({ facts: [], diffs: [] });
		expect(report.director).toBeNull();
		expect(report.notes).toHaveLength(2);
		expect(report.notes[0]).toContain("没有 Trace");
		expect(report.notes[1]).toContain("没有导演决策记录");
		expect(report.suggestions[0]?.evidence).toContain("没有 traces 记录");
		const text = renderExplainReport(report);
		expect(text).toContain("没有记录（该楼层没有 Trace）");
		expect(text).toContain("4. 记忆检索的每一路名次与融合结果");
		expect(text).toContain("没有记录（本轮没有记忆检索");
	});

	it("消息楼层的 Trace 不存在时提示改看助手楼层", () => {
		const { store } = openTempStore();
		seed(store);

		const report = explainNode(store, "u1");

		expect(report.role).toBe("user");
		expect(report.trace).toBeNull();
		expect(report.notes[0]).toContain("是消息楼层");
	});

	it("不写楼层、不改变 head、不产生新记录", () => {
		const { store } = openTempStore();
		seed(store);
		store.saveTurnTrace(traceFor("a1", "u1"));
		const beforeHead = store.getHead("s1")?.id ?? null;
		const beforeCount = store.listStoryNodes("s1").length;

		const report: ExplainReport = explainNode(store, "a1");

		expect(report.nodeId).toBe("a1");
		expect(store.getHead("s1")?.id ?? null).toBe(beforeHead);
		expect(store.listStoryNodes("s1").length).toBe(beforeCount);
		expect(store.getNode("a1")?.raw).toBe("卫宫把杯子放下，没有回答。");
	});

	it("节点不存在时抛出错误", () => {
		const { store } = openTempStore();
		seed(store);
		expect(() => explainNode(store, "missing")).toThrow(
			"楼层节点不存在：missing",
		);
	});
});

describe("runExplainCli", () => {
	it("默认输出中文文本，--json 输出结构化字段", async () => {
		const { store, path } = openTempStore();
		seed(store);
		store.saveTurnTrace(traceFor("a1", "u1"));

		const textLines: string[] = [];
		const text = await runExplainCli(
			["explain", "--node", "a1", "--db", path],
			{ log: (message) => textLines.push(message) },
		);
		expect(text.nodeId).toBe("a1");
		expect(textLines.join("\n")).toContain("1. 这一轮用的模型与结果");

		const jsonLines: string[] = [];
		await runExplainCli(["explain", "--node=a1", `--db=${path}`, "--json"], {
			log: (message) => jsonLines.push(message),
		});
		const parsed = JSON.parse(jsonLines[0] as string) as ExplainReport;
		expect(parsed.nodeId).toBe("a1");
		expect(parsed.trace?.turnMode).toBe("fast");
		expect(parsed.ledger.diffs).toEqual([]);
	});

	it("缺少 --node 或 --db 时直接失败", async () => {
		const { path } = openTempStore();
		await expect(
			runExplainCli(["explain", "--db", path], { log: () => {} }),
		).rejects.toThrow("--node");
		await expect(
			runExplainCli(["explain", "--node", "a1"], { log: () => {} }),
		).rejects.toThrow("--db");
		await expect(
			runExplainCli(["explain", "--node", "a1", "--db", path, "--yaml"], {
				log: () => {},
			}),
		).rejects.toThrow("不认识的参数 --yaml");
	});
});
