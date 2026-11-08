import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	type LlmChannelsConfig,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type LlmUsage,
	StoryStore,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import { runPairwiseCli } from "../src/evalset/pairwise-cli.js";
import {
	type PreferenceComparisonRecord,
	buildPairwiseMessages,
	buildPreferenceSample,
	judgePairwise,
	normalizeWinner,
	parseComparisonRecordsJsonl,
	parsePairwiseOutput,
	parsePreferencePairsJsonl,
	renderPairwiseReport,
	runPreferenceSample,
	summarizePreferenceComparisons,
} from "../src/evalset/pairwise.js";
import {
	type QualityRecord,
	judgeQuality,
	parseQualityOutput,
	parseQualityRecordsJsonl,
	renderQualitySection,
	runQualitySample,
	summarizeQuality,
} from "../src/evalset/quality.js";
import { buildPreferencePairs } from "../src/preferences/export.js";
import type { PreferencePair } from "../src/preferences/export.js";

const USAGE: LlmUsage = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

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

function makeDir(prefix: string): string {
	const dir = mkdtempSync(path.join(import.meta.dirname, prefix));
	createdDirs.push(dir);
	return dir;
}

function makeResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-judge",
		channel: "fake",
		usage: USAGE,
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: { text, reasoning: "" },
	};
}

interface FakeJudge {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
}

function createOutputs(outputs: readonly string[]): FakeJudge {
	const requests: LlmRequest[] = [];
	return {
		requests,
		client: {
			async complete(request) {
				requests.push(request);
				return makeResult(outputs.shift() ?? "{}");
			},
		},
	};
}

function alternatingWinners(): FakeJudge {
	const requests: LlmRequest[] = [];
	let calls = 0;
	return {
		requests,
		client: {
			async complete(request) {
				requests.push(request);
				const system = request.messages[0]?.content ?? "";
				if (system.includes("TTCW")) {
					return makeResult(
						JSON.stringify({
							originality: 4,
							character: 3,
							pacing: 4,
							dialogue: 2,
							reason: "按固定评分返回",
						}),
					);
				}
				calls += 1;
				const winner = calls % 2 === 1 ? "A" : "B";
				return makeResult(JSON.stringify({ winner, reason: "按调用顺序返回" }));
			},
		},
	};
}

interface SeededStory {
	readonly store: StoryStore;
	readonly dbPath: string;
	readonly root: string;
}

function openStore(): SeededStory {
	const root = makeDir(".tmp-pairwise-");
	const dbPath = path.join(root, "story.db");
	const store = StoryStore.open(dbPath);
	return { store, dbPath, root };
}

function seedStory(store: StoryStore): { a2: string; a3: string } {
	store.createStory({ id: "story-secret", title: "测试故事" });
	store.appendNode({
		id: "u1",
		storyId: "story-secret",
		parentId: null,
		role: "user",
		raw: "我推开石门。",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	store.appendNode({
		id: "a1",
		storyId: "story-secret",
		parentId: "u1",
		role: "assistant",
		raw: "第一次回复：门后是漆黑的走廊。",
		createdAt: "2026-01-01T00:00:01.000Z",
	});
	const a2 = store.swipeNode("a1", "第二次回复：门后有一盏灯。");
	const a3 = store.swipeNode(
		a2.id,
		"第三次回复：门后是一座石像。\n<选项>点火把\n继续走\n回头</选项>",
	);
	store.recordPreference({
		storyId: "story-secret",
		nodeId: a3.id,
		kind: "choice",
		payload: { choiceText: "点火把" },
		createdAt: "2026-01-01T00:00:04.000Z",
	});
	return { a2: a2.id, a3: a3.id };
}

function preferencePairs(store: StoryStore, storyId: string): PreferencePair[] {
	return buildPreferencePairs(
		store,
		storyId,
		store.listPreferenceEvents(storyId),
	).pairs;
}

describe("两两对比的解析与提示词", () => {
	it("严格解析裁判输出", () => {
		expect(parsePairwiseOutput('{"winner":"A","reason":"更符合人物"}')).toEqual(
			{ winner: "A", reason: "更符合人物" },
		);
		expect(
			parsePairwiseOutput('{"winner":"tie","reason":"两份无法区分"}'),
		).toEqual({ winner: "tie", reason: "两份无法区分" });
		expect(parsePairwiseOutput('{"winner":"C","reason":"x"}')).toBeNull();
		expect(parsePairwiseOutput('{"winner":"A","reason":""}')).toBeNull();
		expect(
			parsePairwiseOutput('{"winner":"A","reason":"x","extra":1}'),
		).toBeNull();
		expect(parsePairwiseOutput("A 更好")).toBeNull();
	});

	it("按任务把两份文本放进甲、乙两个位置", () => {
		const reroll = buildPairwiseMessages({
			task: "reroll",
			context: "玩家：我推开门。",
			first: "门后有一盏灯。",
			second: "门后有一座石像。",
		});
		expect(reroll[0]?.role).toBe("system");
		const user = reroll[1]?.content as string;
		expect(user).toContain("最近的对话：\n玩家：我推开门。");
		expect(user.indexOf("回复甲：\n门后有一盏灯。")).toBeLessThan(
			user.indexOf("回复乙：\n门后有一座石像。"),
		);
		const choice = buildPairwiseMessages({
			task: "choice",
			context: "",
			first: "点火把",
			second: "回头",
		});
		expect(choice[1]?.content).toContain("选项甲：\n点火把");
		expect(choice[1]?.content).toContain("（没有更早的对话）");
	});

	it("交换顺序后把位置结论换回两侧身份", () => {
		expect(normalizeWinner("accepted-first", "A")).toBe("accepted");
		expect(normalizeWinner("accepted-first", "B")).toBe("abandoned");
		expect(normalizeWinner("abandoned-first", "A")).toBe("abandoned");
		expect(normalizeWinner("abandoned-first", "B")).toBe("accepted");
		expect(normalizeWinner("abandoned-first", "tie")).toBe("tie");
	});
});

describe("裁判调用", () => {
	it("两份完全相同的续写不调用模型，两种顺序都是平局", async () => {
		let calls = 0;
		const judge = {
			model: "fake-judge",
			client: {
				async complete(): Promise<LlmResult> {
					calls += 1;
					return makeResult('{"winner":"A","reason":"不该被调用"}');
				},
			},
		};
		const records = await runPreferenceSample(
			{
				sampleId: "s:1",
				storyId: "s",
				kind: "reroll",
				sourceEventId: "1",
				earlierSwipe: false,
				context: "",
				acceptedText: "相同的回复",
				abandonedText: "相同的回复",
			},
			judge,
			{ now: () => "2026-01-01T00:00:00.000Z" },
		);
		expect(calls).toBe(0);
		expect(records.map((record) => record.winner)).toEqual(["tie", "tie"]);
		expect(records.every((record) => record.attempts === 0)).toBe(true);
	});

	it("非法输出重试三次，成功时记录尝试次数", async () => {
		const fake = createOutputs([
			"不是 JSON",
			'{"winner":"A"}',
			'{"winner":"B","reason":"第二份更贴合语境"}',
		]);
		const record = await judgePairwise({
			task: "reroll",
			context: "",
			first: "甲",
			second: "乙",
			judge: { client: fake.client, model: "fake-judge" },
		});
		expect(record.status).toBe("done");
		expect(record.attempts).toBe(3);
		expect(record.winner).toBe("B");
		expect(fake.requests).toHaveLength(3);
		expect(fake.requests[2]?.messages.at(-1)?.content).toContain(
			"上一次输出不是合法的判定 JSON",
		);
	});

	it("连续三次非法输出记为失败", async () => {
		const fake = createOutputs(["x", "y", "z"]);
		const record = await judgePairwise({
			task: "choice",
			context: "",
			first: "甲",
			second: "乙",
			judge: { client: fake.client, model: "fake-judge" },
		});
		expect(record.status).toBe("failed");
		expect(record.error).toContain("连续 3 次");
	});
});

describe("叙事质量评分", () => {
	it("严格解析四项分数", () => {
		const valid =
			'{"originality":4,"character":3,"pacing":4,"dialogue":2,"reason":"细节新鲜，但台词偏说明"}';
		expect(parseQualityOutput(valid)).toEqual({
			scores: { originality: 4, character: 3, pacing: 4, dialogue: 2 },
			reason: "细节新鲜，但台词偏说明",
		});
		expect(
			parseQualityOutput(valid.replace('"dialogue":2', '"dialogue":6')),
		).toBeNull();
		expect(
			parseQualityOutput(valid.replace('"dialogue":2', '"dialogue":2.5')),
		).toBeNull();
		expect(parseQualityOutput(valid.replace('"pacing":4,', ""))).toBeNull();
		expect(parseQualityOutput(`${valid.slice(0, -1)},"extra":1}`)).toBeNull();
		expect(
			parseQualityOutput(
				'{"originality":4,"character":3,"pacing":4,"dialogue":2,"reason":""}',
			),
		).toBeNull();
		expect(parseQualityOutput("原创性 4 分")).toBeNull();
	});

	it("非法输出重试三次，成功时记录尝试次数", async () => {
		const fake = createOutputs([
			"不是 JSON",
			'{"originality":6,"character":3,"pacing":4,"dialogue":2,"reason":"越界"}',
			'{"originality":5,"character":4,"pacing":3,"dialogue":4,"reason":"第三份"}',
		]);
		const result = await judgeQuality({
			task: "reroll",
			context: "",
			text: "门后有一盏灯。",
			judge: { client: fake.client, model: "fake-judge" },
		});
		expect(result.status).toBe("done");
		expect(result.attempts).toBe(3);
		expect(result.scores).toEqual({
			originality: 5,
			character: 4,
			pacing: 3,
			dialogue: 4,
		});
		expect(fake.requests).toHaveLength(3);
		expect(fake.requests[2]?.messages.at(-1)?.content).toContain(
			"上一次输出不是合法的评分 JSON",
		);
	});

	it("连续三次非法输出记为失败", async () => {
		const fake = createOutputs(["x", "y", "z"]);
		const result = await judgeQuality({
			task: "choice",
			context: "",
			text: "点火把",
			judge: { client: fake.client, model: "fake-judge" },
		});
		expect(result.status).toBe("failed");
		expect(result.error).toContain("连续 3 次");
	});

	it("接受侧与放弃侧各评一次", async () => {
		const fake = createOutputs([
			'{"originality":5,"character":4,"pacing":3,"dialogue":4,"reason":"接受侧"}',
			'{"originality":2,"character":3,"pacing":2,"dialogue":3,"reason":"放弃侧"}',
		]);
		const records = await runQualitySample(
			{
				sampleId: "s:1",
				storyId: "s",
				kind: "reroll",
				context: "玩家：我推开门。",
				acceptedText: "门后有一盏灯。",
				abandonedText: "门后是一座石像。",
			},
			{ client: fake.client, model: "fake-judge" },
			{ now: () => "2026-01-01T00:00:00.000Z" },
		);
		expect(fake.requests).toHaveLength(2);
		expect(fake.requests[0]?.messages[1]?.content).toContain("门后有一盏灯。");
		expect(fake.requests[1]?.messages[1]?.content).toContain(
			"门后是一座石像。",
		);
		expect(records.map((record) => record.side)).toEqual([
			"accepted",
			"abandoned",
		]);
		expect(records[0]?.status).toBe("done");
		expect(records[1]?.status).toBe("done");
	});

	it("按故事与侧汇总均值、分布与失败数", () => {
		const records: QualityRecord[] = [
			makeQualityRecord("story-a:1", "accepted", {
				originality: 4,
				character: 3,
				pacing: 4,
				dialogue: 2,
			}),
			makeQualityRecord("story-a:1", "abandoned", {
				originality: 2,
				character: 2,
				pacing: 2,
				dialogue: 2,
			}),
			makeQualityRecord("story-a:2", "accepted", {
				originality: 3,
				character: 5,
				pacing: 4,
				dialogue: 4,
			}),
			makeQualityRecord("story-a:2", "abandoned", null),
		];
		const summary = summarizeQuality(records);
		const accepted = summary.byStory.find(
			(group) => group.storyId === "story-a" && group.side === "accepted",
		);
		const abandoned = summary.byStory.find(
			(group) => group.storyId === "story-a" && group.side === "abandoned",
		);
		expect(accepted?.samples).toBe(2);
		expect(accepted?.scored).toBe(2);
		const originality = accepted?.dimensions.find(
			(entry) => entry.dimension === "originality",
		);
		expect(originality?.mean).toBe(3.5);
		expect(originality?.distribution).toEqual([0, 0, 1, 1, 0]);
		expect(abandoned?.samples).toBe(2);
		expect(abandoned?.scored).toBe(1);
		expect(abandoned?.failures).toBe(1);
		expect(summary.failures).toHaveLength(1);
		expect(summary.failures[0]?.sampleId).toBe("story-a:2");
		expect(summary.records).toBe(4);
	});

	it("统计版报告只含分数与样本数", () => {
		const records: QualityRecord[] = [
			makeQualityRecord("story-secret:1", "accepted", {
				originality: 4,
				character: 3,
				pacing: 4,
				dialogue: 2,
			}),
			makeQualityRecord("story-secret:1", "abandoned", null),
		];
		const summary = summarizeQuality(records);
		const publicText = renderQualitySection(summary, {
			privateDetails: false,
		});
		expect(publicText).toContain("叙事质量评分");
		expect(publicText).toContain("接受侧");
		expect(publicText).toContain("4.00");
		expect(publicText).not.toContain("story-secret");
		expect(publicText).not.toContain("测试理由");
		const privateText = renderQualitySection(summary, {
			privateDetails: true,
		});
		expect(privateText).toContain("story-secret");
		expect(privateText).toContain("共 1 条");
	});

	it("解析评分 JSONL 并拒绝越界分数", () => {
		const record = makeQualityRecord("s:1", "accepted", {
			originality: 4,
			character: 3,
			pacing: 4,
			dialogue: 2,
		});
		expect(
			parseQualityRecordsJsonl(`${JSON.stringify(record)}\n`, "quality.jsonl"),
		).toEqual([record]);
		expect(() =>
			parseQualityRecordsJsonl(
				`${JSON.stringify({
					...record,
					scores: { ...record.scores, pacing: 0 },
				})}\n`,
				"quality.jsonl",
			),
		).toThrow(/1 到 5/);
	});
});

describe("偏好样本与统计", () => {
	it("从导出对构造样本并识别切回较早 swipe", () => {
		const { store } = openStore();
		seedStory(store);
		const pairs = preferencePairs(store, "story-secret");
		const samples = pairs.map((pair) => buildPreferenceSample(store, pair));
		const rerolls = samples.filter((sample) => sample.kind === "reroll");
		expect(rerolls.map((sample) => sample.earlierSwipe)).toEqual([true, false]);
		expect(rerolls[0]?.context).toContain("玩家：我推开石门。");
		expect(rerolls[0]?.context).not.toContain("第二次回复");
		const choices = samples.filter((sample) => sample.kind === "choice");
		expect(choices).toHaveLength(2);
		expect(choices[0]?.context).toContain("<选项>点火把");
		store.close();
	});

	it("位置偏差与偏好一致率按双向完成样本计算", () => {
		const records: PreferenceComparisonRecord[] = [
			makeRecord("a", "accepted-first", "A"),
			makeRecord("a", "abandoned-first", "A"),
			makeRecord("b", "accepted-first", "B"),
			makeRecord("b", "abandoned-first", "A"),
		];
		const summary = summarizePreferenceComparisons(records);
		const overall = summary.groups[0];
		expect(overall?.samples).toBe(2);
		expect(overall?.completed).toBe(2);
		expect(overall?.judgements).toBe(4);
		expect(overall?.acceptedWins).toBe(1);
		expect(overall?.abandonedWins).toBe(3);
		expect(overall?.inconsistent).toBe(1);
		expect(overall?.positionBias).toBe(0.5);
		expect(overall?.preferenceConsistency).toBe(0);
		expect(overall?.consensusAbandoned).toBe(1);
	});

	it("内容偏好一致时两种顺序都选中接受侧", async () => {
		const { store } = openStore();
		seedStory(store);
		const samples = preferencePairs(store, "story-secret").map((pair) =>
			buildPreferenceSample(store, pair),
		);
		const judge = alternatingWinners();
		const records: PreferenceComparisonRecord[][] = [];
		for (const sample of samples) {
			records.push(
				await runPreferenceSample(sample, {
					client: judge.client,
					model: "fake-judge",
				}),
			);
		}
		const summary = summarizePreferenceComparisons(records.flat());
		store.close();
		const overall = summary.groups[0];
		expect(overall?.samples).toBe(3);
		expect(overall?.positionBias).toBe(0);
		expect(overall?.preferenceConsistency).toBe(1);
		expect(overall?.failures).toBe(0);
	});

	it("切回较早 swipe 的子集单列，不进入总体一致率", () => {
		const records: PreferenceComparisonRecord[] = [
			makeRecord("early", "accepted-first", "B", {
				earlierSwipe: true,
			}),
			makeRecord("early", "abandoned-first", "A", {
				earlierSwipe: true,
			}),
			makeRecord("late", "accepted-first", "A"),
			makeRecord("late", "abandoned-first", "B"),
		];
		const summary = summarizePreferenceComparisons(records);
		const overall = summary.groups.find(
			(group) => group.group === "总体（不含切回较早 swipe）",
		);
		const earlier = summary.groups.find(
			(group) => group.group === "重 roll：切回较早 swipe",
		);
		expect(overall?.samples).toBe(1);
		expect(overall?.preferenceConsistency).toBe(1);
		expect(earlier?.samples).toBe(1);
		expect(earlier?.preferenceConsistency).toBe(0);
	});

	it("统计版报告不含故事 id、样本 id 与原文", () => {
		const records: PreferenceComparisonRecord[] = [
			makeRecord("story-secret:event", "accepted-first", "A"),
			makeRecord("story-secret:event", "abandoned-first", "A"),
		];
		const summary = summarizePreferenceComparisons(records);
		const publicText = renderPairwiseReport(summary, {
			privateDetails: false,
			model: "judge-fake",
			generatedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(publicText).toContain("裁判模型：judge-fake");
		expect(publicText).toContain("位置偏差");
		expect(publicText).not.toContain("story-secret");
		expect(publicText).not.toContain("accepted-first");
		const privateText = renderPairwiseReport(summary, {
			privateDetails: true,
			model: "judge-fake",
			generatedAt: "2026-01-01T00:00:00.000Z",
			sampleSources: ["preferences/story-secret.pairs.jsonl"],
		});
		expect(privateText).toContain("story-secret");
		expect(privateText).toContain("样本来源");
	});
});

describe("命令与文件", () => {
	it("解析判定 JSONL 并拒绝非法记录", () => {
		const record = makeRecord("s:1", "accepted-first", "A");
		const text = `${JSON.stringify(record)}\n`;
		expect(parseComparisonRecordsJsonl(text, "records.jsonl")).toEqual([
			record,
		]);
		expect(() =>
			parseComparisonRecordsJsonl('{"sampleId":"x"}\n', "records.jsonl"),
		).toThrow(/字段必须是/);
		expect(() =>
			parseComparisonRecordsJsonl(
				`${JSON.stringify({ ...record, status: "unknown" })}\n`,
				"records.jsonl",
			),
		).toThrow(/status/);
	});

	it("拒绝字段不完整的回复对", () => {
		expect(() =>
			parsePreferencePairsJsonl(
				'{"storyId":"s","kind":"reroll"}\n',
				"pairs.jsonl",
			),
		).toThrow(/字段必须是/);
		const pair = {
			storyId: "s",
			kind: "reroll",
			sourceEventId: "e",
			anchorNodeId: "n",
			createdAt: "2026-01-01T00:00:00.000Z",
			accepted: { nodeId: "a", text: "甲" },
			abandoned: { nodeId: "b", text: "乙" },
		};
		expect(
			parsePreferencePairsJsonl(`${JSON.stringify(pair)}\n`, "pairs.jsonl"),
		).toEqual([pair]);
	});

	it(
		"命令行写出记录与两份报告，续跑不重复判定",
		async () => {
			const { store, dbPath, root } = openStore();
			seedStory(store);
			const pairsDir = path.join(root, "prefs");
			await mkdir(pairsDir, { recursive: true });
			await writeFile(
				path.join(pairsDir, "story-secret.pairs.jsonl"),
				preferencePairs(store, "story-secret")
					.map((pair) => JSON.stringify(pair))
					.join("\n")
					.concat("\n"),
				"utf8",
			);
			store.close();
			const outPath = path.join(root, "records.jsonl");
			const qualityPath = path.join(root, "quality.jsonl");
			const verbosePath = path.join(root, "verbose.md");
			const publicPath = path.join(root, "public.md");
			const config: LlmChannelsConfig = {
				channels: new Map(),
				models: new Map([
					[
						"judge-fake",
						{
							alias: "judge-fake",
							id: "fake",
							contextWindow: 8_192,
							maxTokens: 2_048,
							reasoning: false,
							enabled: true,
							channels: ["fake"],
							tools: null,
							probe: null,
						},
					],
				]),
				roles: new Map([["judge", "judge-fake"]]),
				embeddings: new Map(),
			};
			const judge = alternatingWinners();
			const dependencies = {
				loadEnv: () => undefined,
				loadConfig: async () => config,
				createClient: () => judge.client,
				now: () => new Date("2026-01-01T00:00:00.000Z"),
				log: () => undefined,
			};
			const first = await runPairwiseCli(
				[
					"--db",
					dbPath,
					"--pairs",
					pairsDir,
					"--out",
					outPath,
					"--quality-out",
					qualityPath,
					"--private-report",
					verbosePath,
					"--public-report",
					publicPath,
				],
				dependencies,
			);
			expect(first.sampleCount).toBe(4);
			expect(first.judgedOrders).toBe(8);
			expect(first.failures).toBe(0);
			expect(first.qualityScores).toBe(8);
			expect(first.qualityFailures).toBe(0);
			const records = parseComparisonRecordsJsonl(
				readFileSync(outPath, "utf8"),
				outPath,
			);
			expect(records).toHaveLength(8);
			const qualityRecords = parseQualityRecordsJsonl(
				readFileSync(qualityPath, "utf8"),
				qualityPath,
			);
			expect(qualityRecords).toHaveLength(8);
			expect(new Set(qualityRecords.map((record) => record.side))).toEqual(
				new Set(["accepted", "abandoned"]),
			);
			const summary = summarizePreferenceComparisons(records);
			const overall = summary.groups.find(
				(group) => group.group === "总体（不含切回较早 swipe）",
			);
			expect(overall?.preferenceConsistency).toBe(1);
			const publicText = readFileSync(publicPath, "utf8");
			expect(publicText).not.toContain("story-secret");
			expect(publicText).not.toContain("第二次回复");
			expect(publicText).toContain("judge-fake");
			expect(publicText).toContain("叙事质量评分");
			const verboseText = readFileSync(verbosePath, "utf8");
			expect(verboseText).toContain("story-secret");
			expect(verboseText).toContain("叙事质量评分");

			const second = await runPairwiseCli(
				[
					"--db",
					dbPath,
					"--pairs",
					pairsDir,
					"--out",
					outPath,
					"--quality-out",
					qualityPath,
					"--private-report",
					verbosePath,
					"--public-report",
					publicPath,
					"--resume",
				],
				dependencies,
			);
			expect(second.judgedOrders).toBe(0);
			expect(second.qualityScores).toBe(0);
			expect(
				parseComparisonRecordsJsonl(readFileSync(outPath, "utf8"), outPath),
			).toHaveLength(8);
			expect(
				parseQualityRecordsJsonl(
					readFileSync(qualityPath, "utf8"),
					qualityPath,
				),
			).toHaveLength(8);
		},
		{ timeout: 30_000 },
	);
});

function makeQualityRecord(
	sampleId: string,
	side: "accepted" | "abandoned",
	scores: {
		readonly originality: number;
		readonly character: number;
		readonly pacing: number;
		readonly dialogue: number;
	} | null,
): QualityRecord {
	const base = {
		sampleId,
		storyId: sampleId.split(":")[0] as string,
		kind: "reroll" as const,
		side,
		attempts: 1,
		usage: null,
		model: "judge-fake",
		createdAt: "2026-01-01T00:00:00.000Z",
	};
	if (scores === null) {
		return {
			...base,
			status: "failed",
			scores: null,
			reason: null,
			error: "连续 3 次没有输出合法评分",
		};
	}
	return {
		...base,
		status: "done",
		scores,
		reason: "测试理由",
		error: null,
	};
}

function makeRecord(
	sampleId: string,
	order: "accepted-first" | "abandoned-first",
	winner: "A" | "B" | "tie",
	options: { readonly earlierSwipe?: boolean; readonly kind?: "reroll" } = {},
): PreferenceComparisonRecord {
	return {
		sampleId,
		storyId: sampleId.split(":")[0] as string,
		kind: options.kind ?? "reroll",
		earlierSwipe: options.earlierSwipe ?? false,
		order,
		status: "done",
		winner,
		reason: "测试",
		attempts: 1,
		usage: null,
		error: null,
		model: "judge-fake",
		createdAt: "2026-01-01T00:00:00.000Z",
	};
}
