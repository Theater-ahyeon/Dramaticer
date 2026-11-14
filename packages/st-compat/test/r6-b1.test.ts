import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	StoryStore as StoryStoreClass,
	createEventStream,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import {
	type R6B1RunRecord,
	R6_B1_FORMAT,
	formatR6B1Report,
	planR6B1Samples,
	r6B1SampleId,
	runR6B1,
} from "../src/evalset/r6-b1.js";

const STORY = "r6-b1-test";
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
	const dir = mkdtempSync(path.join(tmpdir(), "r6-b1-"));
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

function joined(request: LlmRequest): string {
	return request.messages.map((message) => message.content).join("\n");
}

interface FakeWriter {
	readonly client: LlmStreamingClient;
	readonly stats: { streams: number };
}

function fakeWriter(
	options: { readonly failFirst?: boolean } = {},
): FakeWriter {
	const stats = { streams: 0 };
	return {
		stats,
		client: {
			async complete() {
				return makeResult("主调用不走 complete");
			},
			stream() {
				stats.streams += 1;
				if (options.failFirst === true && stats.streams === 1) {
					throw new Error("测试写作失败");
				}
				const text = "原生续写：剑客抬头看向门口，手指按在刀柄上。";
				return createEventStream(async (emit) => {
					emit({ type: "text_delta", delta: text });
					return makeResult(text);
				});
			},
		},
	};
}

interface FakeJudge {
	readonly client: LlmClient;
	readonly stats: { calls: number };
}

function fakeJudge(): FakeJudge {
	const stats = { calls: 0 };
	return {
		stats,
		client: {
			async complete(request) {
				stats.calls += 1;
				const content = joined(request);
				if (content.includes("TTCW")) {
					return makeResult(
						JSON.stringify({
							originality: 4,
							character: 3,
							pacing: 4,
							dialogue: 2,
							reason: "测试评分",
						}),
					);
				}
				const firstLabel = content.indexOf("续写甲：");
				const secondLabel = content.indexOf("续写乙：");
				const first =
					firstLabel === -1
						? ""
						: content.slice(
								firstLabel,
								secondLabel === -1 ? undefined : secondLabel,
							);
				const second = secondLabel === -1 ? "" : content.slice(secondLabel);
				const winner = first.includes("原生续写")
					? "A"
					: second.includes("原生续写")
						? "B"
						: "tie";
				return makeResult(JSON.stringify({ winner, reason: "测试判定" }));
			},
		},
	};
}

function fakeBackground(): LlmClient {
	return {
		async complete(request) {
			const content = joined(request);
			if (content.includes("现场分析师")) return makeResult("现场分析。");
			return makeResult("[]");
		},
	};
}

function buildSourceDb(dir: string, assistantFloors = 30): string {
	const dbPath = path.join(dir, "source.db");
	const store = StoryStoreClass.open(dbPath);
	try {
		store.createStory({ id: STORY, title: "R6 B1" });
		store.updateStorySettings(STORY, {
			characterPrompt: "你是测试角色。",
			maxTokens: 256,
			temperature: 0,
		});
		let parentId: string | null = null;
		for (let index = 1; index <= assistantFloors; index += 1) {
			const user = store.appendNode({
				storyId: STORY,
				parentId,
				role: "user",
				raw: `历史第 ${index} 轮：玩家发言。`,
			});
			const reply = store.appendNode({
				storyId: STORY,
				parentId: user.id,
				role: "assistant",
				raw: `历史回复 ${index}：剑客在客栈里。`,
			});
			parentId = reply.id;
		}
		store.setHead(STORY, parentId as string);
	} finally {
		store.close();
	}
	return dbPath;
}

function b1Options(input: {
	readonly dir: string;
	readonly dbPath: string;
	readonly writer: FakeWriter;
	readonly judge: FakeJudge;
	readonly branchFloors: readonly number[];
	readonly seed?: number;
	readonly historicalModels?: Readonly<Record<string, string>>;
}) {
	return {
		sourceDbPath: input.dbPath,
		stories: [STORY],
		dir: input.dir,
		writer: { client: input.writer.client, model: "fake-writer" },
		judge: { client: input.judge.client, model: "fake-judge" },
		background: { client: fakeBackground() },
		structuredOutput: "text-tags" as const,
		budgetTokens: 4_000,
		maxTokens: 256,
		temperature: 0,
		seed: input.seed ?? 1,
		branchFloors: input.branchFloors,
		historicalModels: input.historicalModels,
	};
}

function sidecar(dir: string, floor: number): R6B1RunRecord {
	const file = path.join(dir, "runs", STORY, String(floor), "b1.json");
	return JSON.parse(readFileSync(file, "utf8")) as R6B1RunRecord;
}

describe("r6-b1", () => {
	it("每个分支点带出其后的真实玩家消息与历史回复", () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const store = StoryStoreClass.open(source);
		const path = store.getPathToHead(STORY);
		store.close();
		const samples = planR6B1Samples(STORY, path, {
			historicalModelOf: (_nodeId, floor) =>
				floor === 6 ? "auto/deepseek-v4.1-flash" : null,
		});
		expect(samples.map((sample) => sample.branchFloor)).toEqual([
			6, 12, 18, 24, 30, 36, 42, 48, 54,
		]);
		expect(samples[0]?.sampleId).toBe(r6B1SampleId(STORY, 6));
		expect(samples[0]?.userText).toBe("历史第 4 轮：玩家发言。");
		expect(samples[0]?.historicalModel).toBe("auto/deepseek-v4.1-flash");
		expect(samples[1]?.userText).toBe("历史第 7 轮：玩家发言。");
		expect(samples[1]?.historicalModel).toBeNull();
	});

	it("生成一次续写并与历史回复按两种顺序配对，同时给出质量评分", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const before = createHash("sha256")
			.update(readFileSync(source))
			.digest("hex");
		const writer = fakeWriter();
		const judge = fakeJudge();
		const runDir = path.join(dir, "run");
		const report = await runR6B1(
			b1Options({
				dir: runDir,
				dbPath: source,
				writer,
				judge,
				branchFloors: [6, 12],
				historicalModels: { [`${STORY}:6`]: "auto/deepseek-v4.1-flash" },
			}),
		);

		expect(report.format).toBe(R6_B1_FORMAT);
		expect(report.plannedPairs).toBe(2);
		expect(report.runs).toHaveLength(2);
		for (const run of report.runs) {
			expect(run.status).toBe("done");
			expect(run.outcome).toBe("win");
			expect(run.generation?.writerRequests).toBe(1);
			expect(run.judgments.map((record) => record.status)).toEqual([
				"done",
				"done",
			]);
			expect(run.quality.map((record) => record.side)).toEqual([
				"accepted",
				"abandoned",
			]);
			expect(run.quality.every((record) => record.status === "done")).toBe(
				true,
			);
		}
		expect(writer.stats.streams).toBe(2);
		expect(report.summary.completedPairs).toBe(2);
		expect(report.summary.pairs).toEqual({
			wins: 2,
			losses: 0,
			ties: 0,
			inconsistent: 0,
		});
		expect(report.summary.failures).toBe(0);
		expect(report.summary.winRate).toBe(1);
		expect(report.summary.insufficient).toBe(true);
		expect(report.summary.insufficientReason).toContain("样本不足");
		expect(report.summary.modelFamilies.historical).toHaveLength(1);
		expect(report.summary.quality.bySide.map((group) => group.scored)).toEqual([
			2, 2,
		]);
		for (const group of report.summary.quality.bySide) {
			const originality = group.dimensions.find(
				(dimension) => dimension.dimension === "originality",
			);
			expect(originality?.mean).toBe(4);
		}

		const stored = sidecar(runDir, 6);
		expect(stored.generatedNodeId).not.toBeNull();
		expect(stored.historicalText).toContain("历史回复 4");
		expect(stored.warmup.floorNodeIds).toHaveLength(2);

		const markdown = formatR6B1Report(report);
		expect(markdown).toContain("R6 B1 配对批次");
		expect(markdown).toContain("|胜|负|平|换序不一致|失败|");
		expect(markdown).toContain("Wilson 95%");
		expect(markdown).toContain("叙事质量");

		const after = createHash("sha256")
			.update(readFileSync(source))
			.digest("hex");
		expect(after).toBe(before);
	});

	it("单个样本生成失败不影响其他样本", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const report = await runR6B1(
			b1Options({
				dir: path.join(dir, "run"),
				dbPath: source,
				writer: fakeWriter({ failFirst: true }),
				judge: fakeJudge(),
				branchFloors: [6, 12],
			}),
		);
		expect(report.runs).toHaveLength(2);
		const [failed, done] = report.runs;
		expect(failed?.status).toBe("failed");
		expect(failed?.error).toContain("测试写作失败");
		expect(failed?.outcome).toBeNull();
		expect(done?.status).toBe("done");
		expect(done?.outcome).toBe("win");
		expect(report.summary.failures).toBe(1);
		expect(report.summary.completedPairs).toBe(1);
		const markdown = formatR6B1Report(report);
		expect(markdown).toContain("生成失败");
	});

	it("续跑复用已完成的 sidecar，不再调用模型", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const runDir = path.join(dir, "run");
		const first = await runR6B1(
			b1Options({
				dir: runDir,
				dbPath: source,
				writer: fakeWriter(),
				judge: fakeJudge(),
				branchFloors: [6, 12],
			}),
		);
		const writer = fakeWriter();
		const judge = fakeJudge();
		const second = await runR6B1(
			b1Options({
				dir: runDir,
				dbPath: source,
				writer,
				judge,
				branchFloors: [6, 12],
			}),
		);
		expect(writer.stats.streams).toBe(0);
		expect(judge.stats.calls).toBe(0);
		expect(second.runs).toEqual(first.runs);
		expect(second.summary).toEqual(first.summary);
	});

	it("sidecar 与本次输入不一致时提示删除", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const runDir = path.join(dir, "run");
		await runR6B1(
			b1Options({
				dir: runDir,
				dbPath: source,
				writer: fakeWriter(),
				judge: fakeJudge(),
				branchFloors: [6],
			}),
		);
		await expect(
			runR6B1(
				b1Options({
					dir: runDir,
					dbPath: source,
					writer: fakeWriter(),
					judge: fakeJudge(),
					branchFloors: [6],
					seed: 2,
				}),
			),
		).rejects.toThrow(/删除该文件后重跑/);
	});
});
