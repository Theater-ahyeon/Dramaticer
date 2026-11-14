import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
	LlmChannelsConfig,
	LlmClient,
	LlmRequest,
	LlmResult,
	LlmUsage,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import { type R6GateInput, validateR6GateInput } from "../src/evalset/gates.js";
import { runR6InstrumentCli } from "../src/evalset/r6-instrument-cli.js";
import {
	type R6AaSample,
	aaPairOutcome,
	aaSideOf,
	buildAaMessages,
	formatR6InstrumentReport,
	loadR6HumanLabelPairs,
	parseHumanLabelOutput,
	parseR6AaSamplesJsonl,
	r6InstrumentGateInput,
	readHumanLabelPairIds,
	runR6AaInstrument,
	runR6HumanLabelInstrument,
	runR6Instrument,
	summarizeR6Aa,
	summarizeR6HumanLabels,
} from "../src/evalset/r6-instrument.js";

const createdDirs: string[] = [];

afterEach(() => {
	for (const dir of createdDirs.splice(0)) {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 200,
		});
	}
});

function makeDir(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "r6-instrument-"));
	createdDirs.push(dir);
	return dir;
}

const USAGE: LlmUsage = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

function makeResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake",
		usage: USAGE,
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

function userContent(request: LlmRequest): string {
	return request.messages.map((message) => message.content).join("\n");
}

function aaVerdict(request: LlmRequest): string {
	const content = userContent(request);
	const first = content.split("续写甲：\n")[1]?.split("\n\n续写乙：")[0] ?? "";
	const second = content.split("续写乙：\n")[1]?.split("\n\n请判断")[0] ?? "";
	if (first.includes("优选") && !second.includes("优选")) {
		return JSON.stringify({ winner: "A", reason: "甲更贴合" });
	}
	if (second.includes("优选")) {
		return JSON.stringify({ winner: "B", reason: "乙更贴合" });
	}
	return JSON.stringify({ winner: "tie", reason: "无法区分" });
}

interface FakeJudge {
	readonly client: LlmClient;
	readonly calls: { count: number };
}

function fakeJudge(options: { readonly failTimes?: number } = {}): FakeJudge {
	const calls = { count: 0 };
	let remainingFailures = options.failTimes ?? 0;
	return {
		calls,
		client: {
			async complete(request: LlmRequest) {
				calls.count += 1;
				if (remainingFailures > 0) {
					remainingFailures -= 1;
					throw new Error("测试裁判失败");
				}
				const system = request.messages[0]?.content ?? "";
				if (system.includes("只有随机种子不同")) {
					return makeResult(aaVerdict(request));
				}
				return makeResult(JSON.stringify({ choice: "A", confidence: 0.7 }));
			},
		},
	};
}

function writeJsonl(file: string, entries: readonly unknown[]): void {
	writeFileSync(
		file,
		entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
		"utf8",
	);
}

function aaSamples(): R6AaSample[] {
	return [
		{
			sampleId: "s1",
			story: "alpha",
			context: "玩家：拔剑。",
			seed1: { status: "done", text: "优选：剑客劈开场" },
			seed2: { status: "done", text: "普通：剑客退后" },
		},
		{
			sampleId: "s2",
			story: "alpha",
			context: "玩家：退后。",
			seed1: { status: "done", text: "普通：剑客退后" },
			seed2: { status: "done", text: "优选：剑客劈开场" },
		},
		{
			sampleId: "s3",
			story: "beta",
			context: "",
			seed1: { status: "done", text: "完全相同的文本" },
			seed2: { status: "done", text: "完全相同的文本" },
		},
		{
			sampleId: "s4",
			story: "beta",
			context: "玩家：等待。",
			seed1: { status: "failed", error: "上游返回 402" },
			seed2: { status: "done", text: "普通：剑客沉默" },
		},
	];
}

function humanLabelPairs() {
	return [
		{
			id: "p1",
			acceptedNotLast: true,
			context: [{ role: "user", text: "玩家：走。" }],
			acceptedText: "接受一",
			rejectedText: "放弃一",
		},
		{
			id: "p2",
			acceptedNotLast: false,
			context: [],
			acceptedText: "接受二",
			rejectedText: "放弃二",
		},
		{
			id: "p3",
			acceptedNotLast: true,
			context: [{ role: "assistant", text: "角色：停。" }],
			acceptedText: "接受三",
			rejectedText: "放弃三",
		},
	];
}

describe("r6-instrument", () => {
	it("顺序与选择换回种子侧并归一成四种结果", () => {
		expect(aaSideOf("seed1-first", "A")).toBe("seed1");
		expect(aaSideOf("seed1-first", "B")).toBe("seed2");
		expect(aaSideOf("seed2-first", "A")).toBe("seed2");
		expect(aaSideOf("seed2-first", "B")).toBe("seed1");
		expect(aaPairOutcome("seed1", "seed1")).toBe("win");
		expect(aaPairOutcome("seed2", "seed2")).toBe("loss");
		expect(aaPairOutcome("tie", "tie")).toBe("tie");
		expect(aaPairOutcome("tie", "seed1")).toBe("inconsistent");
		expect(aaPairOutcome("seed2", "seed1")).toBe("inconsistent");
	});

	it("A/A 样本解析拒绝重复 id 与非法生成状态", () => {
		const text = `${JSON.stringify(aaSamples()[0])}\n`;
		expect(parseR6AaSamplesJsonl(text, "samples.jsonl")).toHaveLength(1);
		expect(() =>
			parseR6AaSamplesJsonl(`${text}${text}`, "samples.jsonl"),
		).toThrow(/样本 id 重复/);
		expect(() =>
			parseR6AaSamplesJsonl(
				`${JSON.stringify({
					sampleId: "s1",
					story: "alpha",
					context: "",
					seed1: { status: "done" },
					seed2: { status: "done", text: "x" },
				})}\n`,
				"samples.jsonl",
			),
		).toThrow(/seed1\.text/);
	});

	it("A/A 把两次文本相同与生成失败记为配对失败，且不调用裁判", async () => {
		const dir = makeDir();
		const samplesPath = path.join(dir, "aa-samples.jsonl");
		writeJsonl(samplesPath, aaSamples());
		const judge = fakeJudge();
		const result = await runR6AaInstrument({
			samplesPath,
			dir,
			judge: { client: judge.client, model: "fake-judge" },
			now: () => new Date("2026-01-01T00:00:00.000Z"),
		});
		expect(judge.calls.count).toBe(4);
		expect(result.summary.plannedPairs).toBe(4);
		expect(result.summary.completedPairs).toBe(2);
		expect(result.summary.wins).toBe(1);
		expect(result.summary.losses).toBe(1);
		expect(result.summary.ties).toBe(0);
		expect(result.summary.inconsistent).toBe(0);
		expect(result.summary.failures).toBe(2);
		expect(result.summary.identicalPairs).toBe(1);
		expect(result.summary.generationFailures).toBe(1);
		expect(result.summary.judgementsCompleted).toBe(4);
		expect(result.summary.judgementsFailed).toBe(4);
		expect(result.summary.winRate).toBe(0.5);
		expect(result.summary.identicalShare).toBe(0.25);
		expect(result.summary.judgeFailureShare).toBe(0.5);
		expect(result.summary.stories.map((story) => story.story)).toEqual([
			"alpha",
			"beta",
		]);
		const records = result.records;
		expect(records).toHaveLength(8);
		expect(
			records.filter(
				(record) => record.sampleId === "s3" && record.status === "failed",
			),
		).toHaveLength(2);
		expect(
			records.every(
				(record) => record.status === "done" || record.attempts === 0,
			),
		).toBe(true);
	});

	it("A/A 续跑复用已完成的判定，不重复调用裁判", async () => {
		const dir = makeDir();
		const samplesPath = path.join(dir, "aa-samples.jsonl");
		writeJsonl(samplesPath, aaSamples());
		const first = fakeJudge();
		await runR6AaInstrument({
			samplesPath,
			dir,
			judge: { client: first.client, model: "fake-judge" },
		});
		const file = path.join(dir, "aa.jsonl");
		const before = readFileSync(file, "utf8");
		const second = fakeJudge();
		const result = await runR6AaInstrument({
			samplesPath,
			dir,
			judge: { client: second.client, model: "fake-judge" },
		});
		expect(second.calls.count).toBe(0);
		expect(readFileSync(file, "utf8")).toBe(before);
		expect(result.summary.completedPairs).toBe(2);
	});

	it("A/A 续跑重试裁判失败的槽位，完成后计入胜率", async () => {
		const dir = makeDir();
		const samplesPath = path.join(dir, "aa-samples.jsonl");
		writeJsonl(samplesPath, [aaSamples()[0]]);
		const failing = fakeJudge({ failTimes: 3 });
		const first = await runR6AaInstrument({
			samplesPath,
			dir,
			judge: { client: failing.client, model: "fake-judge" },
		});
		expect(first.summary.failures).toBe(1);
		expect(first.records[0]?.status).toBe("failed");
		expect(
			first.records.some(
				(record) => record.status === "failed" && record.stage === "judge",
			),
		).toBe(true);
		const working = fakeJudge();
		const second = await runR6AaInstrument({
			samplesPath,
			dir,
			judge: { client: working.client, model: "fake-judge" },
		});
		expect(working.calls.count).toBe(2);
		expect(second.summary.completedPairs).toBe(1);
		expect(second.summary.wins).toBe(1);
		expect(second.summary.failures).toBe(0);
	});

	it("A/A 样本文本变化时拒绝复用旧判定", async () => {
		const dir = makeDir();
		const samplesPath = path.join(dir, "aa-samples.jsonl");
		writeJsonl(samplesPath, [aaSamples()[0]]);
		const judge = fakeJudge();
		await runR6AaInstrument({
			samplesPath,
			dir,
			judge: { client: judge.client, model: "fake-judge" },
		});
		const changed = { ...aaSamples()[0] };
		writeJsonl(samplesPath, [
			{
				...changed,
				seed1: { status: "done", text: "换了一段文本" },
			},
		]);
		await expect(
			runR6AaInstrument({
				samplesPath,
				dir,
				judge: { client: judge.client, model: "fake-judge" },
			}),
		).rejects.toThrow(/生成文本已变化/);
	});

	it("真人标注两种顺序都记录，一致率与位置偏差按成功判断计数", async () => {
		const dir = makeDir();
		const pairsPath = path.join(dir, "pairs.jsonl");
		writeJsonl(pairsPath, humanLabelPairs());
		const labelRecordsPath = path.join(dir, "judge.jsonl");
		writeJsonl(labelRecordsPath, [
			{ pair: "p3" },
			{ pair: "p1" },
			{ pair: "p2" },
		]);
		const judge = fakeJudge();
		const result = await runR6HumanLabelInstrument({
			pairsPath,
			labelRecordsPath,
			dir,
			judge: { client: judge.client, model: "fake-judge" },
		});
		expect(judge.calls.count).toBe(6);
		expect(result.pairs.map((pair) => pair.pairId)).toEqual(["p1", "p2", "p3"]);
		const summary = result.summary;
		expect(summary.plannedPairs).toBe(3);
		expect(summary.completedPairs).toBe(3);
		expect(summary.judgements).toBe(6);
		expect(summary.acceptedChoices).toBe(3);
		expect(summary.positionA).toBe(6);
		expect(summary.agreement).toBe(0.5);
		expect(summary.positionBias).toBe(0.5);
		expect(summary.failures).toBe(0);
		expect(summary.earlierSwipe).toMatchObject({
			plannedPairs: 2,
			completedPairs: 2,
			judgements: 4,
			acceptedChoices: 2,
			agreement: 0.5,
		});
		expect(result.records.map((record) => record.order)).toEqual([
			"rejected-first",
			"accepted-first",
			"rejected-first",
			"accepted-first",
			"rejected-first",
			"accepted-first",
		]);
	});

	it("真人标注续跑复用判定，缺少配对文本时失败", async () => {
		const dir = makeDir();
		const pairsPath = path.join(dir, "pairs.jsonl");
		writeJsonl(pairsPath, humanLabelPairs());
		const labelRecordsPath = path.join(dir, "judge.jsonl");
		writeJsonl(labelRecordsPath, [{ pair: "p1" }, { pair: "p2" }]);
		const first = fakeJudge();
		await runR6HumanLabelInstrument({
			pairsPath,
			labelRecordsPath,
			dir,
			judge: { client: first.client, model: "fake-judge" },
		});
		const second = fakeJudge();
		const result = await runR6HumanLabelInstrument({
			pairsPath,
			labelRecordsPath,
			dir,
			judge: { client: second.client, model: "fake-judge" },
		});
		expect(second.calls.count).toBe(0);
		expect(result.summary.completedPairs).toBe(2);
		writeJsonl(labelRecordsPath, [{ pair: "p1" }, { pair: "missing" }]);
		await expect(
			runR6HumanLabelInstrument({
				pairsPath,
				labelRecordsPath,
				dir: path.join(dir, "fresh"),
				judge: { client: second.client, model: "fake-judge" },
			}),
		).rejects.toThrow(/缺少 1 个判定记录引用的配对/);
	});

	it("真人标注解析接受代码块与多余文字，拒绝越界置信度", () => {
		expect(parseHumanLabelOutput('{"choice":"B","confidence":0.4}')).toEqual({
			choice: "B",
			confidence: 0.4,
		});
		expect(
			parseHumanLabelOutput('```json\n{"choice":"A","confidence":1}\n```'),
		).toEqual({ choice: "A", confidence: 1 });
		expect(
			parseHumanLabelOutput('说明：{"choice":"A","confidence":0.5} 完毕'),
		).toEqual({ choice: "A", confidence: 0.5 });
		expect(parseHumanLabelOutput('{"choice":"A","confidence":1.5}')).toBeNull();
		expect(parseHumanLabelOutput('{"choice":"C","confidence":0.5}')).toBeNull();
	});

	it("汇总函数要求记录完整覆盖计划配对", () => {
		const samples = aaSamples();
		const summary = summarizeR6Aa({ samples, records: [] });
		expect(summary.completedPairs).toBe(0);
		expect(summary.failures).toBe(4);
		expect(summary.winRate).toBeNull();
		const dir = makeDir();
		const file = path.join(dir, "pairs.jsonl");
		writeJsonl(file, humanLabelPairs());
		const pairs = loadR6HumanLabelPairs(
			file,
			readHumanLabelPairIds(
				'{"pair":"p1"}\n{"pair":"p2"}\n{"pair":"p3"}\n',
				"judge.jsonl",
			),
		);
		expect(summarizeR6HumanLabels({ pairs, records: [] })).toMatchObject({
			plannedPairs: 3,
			completedPairs: 0,
			judgements: 0,
			agreement: null,
			positionBias: null,
		});
	});

	it("两条分支合起来直接产出 G0 判定输入，报告不含正文", async () => {
		const dir = makeDir();
		const samplesPath = path.join(dir, "aa-samples.jsonl");
		writeJsonl(samplesPath, aaSamples());
		const pairsPath = path.join(dir, "pairs.jsonl");
		writeJsonl(pairsPath, humanLabelPairs());
		const labelRecordsPath = path.join(dir, "judge.jsonl");
		writeJsonl(labelRecordsPath, [
			{ pair: "p1" },
			{ pair: "p2" },
			{ pair: "p3" },
		]);
		const judge = fakeJudge();
		const report = await runR6Instrument({
			aaSamplesPath: samplesPath,
			pairsPath,
			labelRecordsPath,
			dir,
			judge: { client: judge.client, model: "fake-judge" },
			now: () => new Date("2026-01-01T00:00:00.000Z"),
		});
		expect(report.gateInput).toEqual(
			r6InstrumentGateInput({
				aa: report.aa,
				humanLabels: report.humanLabels,
			}),
		);
		expect(report.gateInput.sameConfig).toEqual({
			plannedPairs: 4,
			pairs: { wins: 1, losses: 1, ties: 0, inconsistent: 0 },
			failures: 2,
			judgments: { completed: 4, failed: 4 },
		});
		expect(report.gateInput.humanLabels).toEqual({
			plannedPairs: 3,
			completedPairs: 3,
			acceptedChoices: 3,
			judgments: 6,
			positionA: 6,
			failures: 0,
		});
		expect(report.gateVersion).toBe("v2");
		const markdown = formatR6InstrumentReport(report);
		expect(markdown).toContain("A/A 检验");
		expect(markdown).toContain("真人标注配对");
		expect(markdown).not.toContain("优选");
		expect(markdown).not.toContain("接受一");
		expect(markdown).not.toContain("s1");
		const fullInput: R6GateInput = {
			instrument: report.gateInput,
			replay: {
				abandoned: {
					plannedPairs: 1,
					pairs: { wins: 1, losses: 0, ties: 0, inconsistent: 0 },
					failures: 0,
					stories: [{ story: "alpha", completedPairs: 1 }],
					judgments: { completed: 2, failed: 0 },
				},
				accepted: {
					plannedPairs: 1,
					pairs: { wins: 1, losses: 0, ties: 0, inconsistent: 0 },
					failures: 0,
					stories: [{ story: "alpha", completedPairs: 1 }],
					judgments: { completed: 2, failed: 0 },
				},
			},
			repetition: {
				stories: [
					{
						story: "alpha",
						native: { mean: 0.1, samples: 10 },
						naive: { mean: 0.2, samples: 10 },
					},
				],
			},
			progression: {
				stories: [
					{
						story: "alpha",
						native: { mean: 0.3, samples: 10 },
						naive: { mean: 0.2, samples: 10 },
					},
				],
			},
			contradiction: {
				consistent: 10,
				contradictory: 0,
				undecidable: 0,
				failed: 0,
			},
			deep: {
				plannedPairs: 1,
				pairs: { wins: 1, losses: 0, ties: 0, inconsistent: 0 },
				failures: 0,
				turns: { completed: 1, failed: 0 },
				toolCalls: 1,
			},
			preference: {
				accepted: 1,
				abandoned: 0,
				ties: 0,
				inconsistent: 0,
				failures: 0,
			},
		};
		expect(() => validateR6GateInput(fullInput)).not.toThrow();
		expect(
			buildAaMessages({ context: "", first: "甲", second: "乙" }),
		).toHaveLength(2);
	});

	it("CLI 写出结果 JSON 与不含正文的报告", async () => {
		const dir = makeDir();
		const samplesPath = path.join(dir, "aa-samples.jsonl");
		writeJsonl(samplesPath, aaSamples());
		const pairsPath = path.join(dir, "pairs.jsonl");
		writeJsonl(pairsPath, humanLabelPairs());
		const labelRecordsPath = path.join(dir, "judge.jsonl");
		writeJsonl(labelRecordsPath, [
			{ pair: "p1" },
			{ pair: "p2" },
			{ pair: "p3" },
		]);
		const judge = fakeJudge();
		const channels: LlmChannelsConfig = {
			channels: new Map([
				[
					"judge",
					{
						id: "judge",
						api: "openai-completions" as const,
						baseUrl: "http://localhost:1234",
						apiKey: "",
						requestsPerMinute: 0,
						maxRetries: 0,
						retryBaseDelayMs: 0,
						timeoutMs: 1_000,
					},
				],
			]),
			models: new Map([
				[
					"fake-judge",
					{
						alias: "fake-judge",
						id: "fake-model",
						channels: ["judge"],
						contextWindow: 8_192,
						maxTokens: 1_024,
						reasoning: false,
						enabled: true,
						tools: null,
						probe: null,
					},
				],
			]),
			roles: new Map([["judge", "fake-judge"]]),
			embeddings: new Map(),
			reranker: null,
		};
		const jsonPath = path.join(dir, "out.json");
		const reportPath = path.join(dir, "out.md");
		const report = await runR6InstrumentCli({
			aaSamplesPath: samplesPath,
			pairsPath,
			labelRecordsPath,
			dir: path.join(dir, "run"),
			jsonPath,
			reportPath,
			channelsPath: path.join(dir, "channels.yaml"),
			envPath: path.join(dir, ".env"),
			cacheDir: path.join(dir, "cache"),
			judgeModel: null,
			maxTokens: null,
			log: () => undefined,
			loadEnv: () => undefined,
			loadConfig: async () => channels,
			createClient: () => judge.client,
		});
		expect(report.gateInput.sameConfig.plannedPairs).toBe(4);
		const written = JSON.parse(readFileSync(jsonPath, "utf8")) as {
			readonly format: string;
			readonly gateInput: unknown;
		};
		expect(written.format).toBe("dramaticer.r6-instrument");
		expect(written.gateInput).toEqual(report.gateInput);
		const markdown = readFileSync(reportPath, "utf8");
		expect(markdown).toContain("G0 判定输入");
		expect(markdown).not.toContain("优选");
	});
});
