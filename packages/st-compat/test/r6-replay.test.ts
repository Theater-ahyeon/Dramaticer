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
	type TimelineNode,
	createEventStream,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import { validateR6GateInput } from "../src/evalset/gates.js";
import { parseR6AaSamplesJsonl } from "../src/evalset/r6-instrument.js";
import {
	type R6ReplayRunRecord,
	R6_REPLAY_FORMAT,
	formatR6ReplayReport,
	planR6Replay,
	runR6Replay,
	summarizeR6Replay,
	swipeIndexOf,
} from "../src/evalset/r6-replay.js";

const STORY = "r6-replay-test";
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
	const dir = mkdtempSync(path.join(tmpdir(), "r6-replay-"));
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
	readonly stats: { streams: number; seeds: number[] };
}

/** 两个种子写出不同文本，续写里带种子，裁判据此判断。 */
function fakeWriter(options: { readonly failSeed?: number } = {}): FakeWriter {
	const stats: { streams: number; seeds: number[] } = { streams: 0, seeds: [] };
	return {
		stats,
		client: {
			async complete() {
				return makeResult("主调用不走 complete");
			},
			stream(request) {
				stats.streams += 1;
				const seed = request.seed ?? 0;
				stats.seeds.push(seed);
				if (options.failSeed !== undefined && seed === options.failSeed) {
					throw new Error("测试写作失败");
				}
				const text =
					seed === 2
						? "种子二续写：剑客退后一步，抬手按住门框。"
						: "种子一续写：剑客抬头看向门口，手指按在刀柄上。";
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

/**
 * `seed1Wins` 为真时选含「种子一续写」的一侧；为假时固定选甲位，
 * 用来制造换序不一致。
 */
function fakeJudge(options: { readonly seed1Wins?: boolean } = {}): FakeJudge {
	const stats = { calls: 0 };
	return {
		stats,
		client: {
			async complete(request) {
				stats.calls += 1;
				const content = joined(request);
				if (options.seed1Wins === false) {
					return makeResult(
						JSON.stringify({ winner: "A", reason: "固定选甲" }),
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
				const winner = first.includes("种子一续写")
					? "A"
					: second.includes("种子一续写")
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

/**
 * 三个玩家楼层，每层 2 到 3 条助手兄弟楼层；第 1 个点有更早的放弃 swipe，
 * 第 3 个点的被接受楼层不是最后一条 swipe。`assistantParent` 为真时再追加
 * 一组父楼层是助手楼层的兄弟楼层，用来验证这类点只计数、不回放。
 */
function buildSourceDb(
	dir: string,
	options: { readonly assistantParent?: boolean } = {},
): string {
	const dbPath = path.join(dir, "source.db");
	const store = StoryStoreClass.open(dbPath);
	try {
		store.createStory({ id: STORY, title: "R6 replay" });
		store.updateStorySettings(STORY, {
			characterPrompt: "你是测试角色。",
			maxTokens: 256,
			temperature: 0.8,
		});
		let parentId: string | null = null;
		const floors = [
			{ swipes: 3, accepted: 2 },
			{ swipes: 2, accepted: 1 },
			{ swipes: 3, accepted: 1 },
		];
		floors.forEach((floor, index) => {
			const message = index + 1;
			const user = store.appendNode({
				storyId: STORY,
				parentId,
				role: "user",
				raw: `历史第 ${message} 轮：玩家发言。`,
			});
			let acceptedId: string | null = null;
			for (let swipe = 0; swipe < floor.swipes; swipe += 1) {
				const reply = store.appendNode({
					storyId: STORY,
					id: `${STORY}:m${message}:s${swipe}`,
					parentId: user.id,
					role: "assistant",
					raw: `历史回复 ${message}-${swipe}：剑客在客栈里。`,
				});
				if (swipe === floor.accepted) acceptedId = reply.id;
			}
			store.setHead(STORY, acceptedId as string);
			parentId = acceptedId;
		});
		if (options.assistantParent === true) {
			store.appendNode({
				storyId: STORY,
				id: `${STORY}:m4:s0`,
				parentId,
				role: "assistant",
				raw: "连续助手消息 4-0。",
			});
			store.appendNode({
				storyId: STORY,
				id: `${STORY}:m4:s1`,
				parentId,
				role: "assistant",
				raw: "连续助手消息 4-1。",
			});
		}
	} finally {
		store.close();
	}
	return dbPath;
}

function replayOptions(input: {
	readonly dir: string;
	readonly dbPath: string;
	readonly writer: FakeWriter;
	readonly judge: FakeJudge;
	readonly floors: readonly number[];
	readonly seed?: number;
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
		temperature: 0.8,
		seed: input.seed ?? 1,
		floors: input.floors,
	};
}

function sidecar(dir: string, floor: number): R6ReplayRunRecord {
	const file = path.join(dir, "runs", STORY, String(floor), "replay.json");
	return JSON.parse(readFileSync(file, "utf8")) as R6ReplayRunRecord;
}

describe("r6-replay", () => {
	it("从源数据库规划重 roll 点，放弃侧取紧邻的 swipe 并单列更早的条数", () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const store = StoryStoreClass.open(source);
		try {
			const path = store.getPathToHead(STORY);
			const siblings = new Map<string, TimelineNode[]>();
			for (const node of store.listStoryNodes(STORY)) {
				if (node.role !== "assistant" || node.parentId === null) continue;
				siblings.set(node.parentId, [
					...(siblings.get(node.parentId) ?? []),
					node,
				]);
			}
			const plan = planR6Replay(STORY, path, siblings);
			const points = plan.points;
			expect(points).toHaveLength(3);
			expect(plan.skippedAssistantParent).toBe(0);
			const first = points[0];
			expect(first?.floor).toBe(2);
			expect(first?.acceptedSwipeIndex).toBe(2);
			expect(first?.abandonedSwipeIndex).toBe(1);
			expect(first?.extraAbandoned).toBe(1);
			expect(first?.acceptedIsLastSwipe).toBe(true);
			const third = points[2];
			expect(third?.acceptedSwipeIndex).toBe(1);
			expect(third?.abandonedSwipeIndex).toBe(0);
			expect(third?.extraAbandoned).toBe(1);
			expect(third?.acceptedIsLastSwipe).toBe(false);
		} finally {
			store.close();
		}
	});

	it("父楼层是助手楼层的兄弟楼层只计数、不回放", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir, { assistantParent: true });
		const report = await runR6Replay(
			replayOptions({
				dir: path.join(dir, "run"),
				dbPath: source,
				writer: fakeWriter(),
				judge: fakeJudge(),
				floors: [2],
			}),
		);
		expect(report.summary.plannedPairs).toBe(1);
		expect(report.summary.skippedAssistantParent).toBe(1);
		expect(report.points.map((point) => point.floor)).toEqual([2]);
		expect(formatR6ReplayReport(report)).toContain("无法回放的点 1 个");
	});

	it("swipe 下标只从楼层 id 后缀读取", () => {
		expect(swipeIndexOf("故事:m12:s3")).toBe(3);
		expect(() => swipeIndexOf("普通-id")).toThrow(/缺少 swipe 下标/);
	});

	it("每个点按两个种子各生成一次，两组配对都产出判定与 A/A 样本", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const before = createHash("sha256")
			.update(readFileSync(source))
			.digest("hex");
		const writer = fakeWriter();
		const judge = fakeJudge();
		const runDir = path.join(dir, "run");
		const report = await runR6Replay(
			replayOptions({
				dir: runDir,
				dbPath: source,
				writer,
				judge,
				floors: [2, 4],
			}),
		);

		expect(report.format).toBe(R6_REPLAY_FORMAT);
		expect(report.seed1).toBe(1);
		expect(report.seed2).toBe(2);
		expect(report.runs).toHaveLength(2);
		expect(writer.stats.seeds).toEqual([1, 2, 1, 2]);
		for (const run of report.runs) {
			expect(run.status).toBe("done");
			expect(run.seed1Generation?.text).toContain("种子一续写");
			expect(run.seed2Generation?.text).toContain("种子二续写");
			expect(run.outcomes.abandoned).toBe("win");
			expect(run.outcomes.accepted).toBe("win");
			expect(run.judgments).toHaveLength(4);
			expect(run.context).toContain("玩家：历史第");
		}
		expect(report.summary.plannedPairs).toBe(2);
		expect(report.summary.extraAbandoned).toBe(1);
		expect(report.summary.acceptedNotLast).toBe(0);
		expect(report.summary.groups.abandoned.pairs).toEqual({
			wins: 2,
			losses: 0,
			ties: 0,
			inconsistent: 0,
		});
		expect(report.summary.groups.accepted.completedPairs).toBe(2);
		expect(() =>
			validateR6GateInput({
				instrument: {
					sameConfig: {
						plannedPairs: 2,
						pairs: { wins: 1, losses: 1, ties: 0, inconsistent: 0 },
						failures: 0,
						judgments: { completed: 4, failed: 0 },
					},
					humanLabels: {
						plannedPairs: 1,
						completedPairs: 1,
						acceptedChoices: 2,
						judgments: 2,
						positionA: 1,
						failures: 0,
					},
				},
				replay: report.summary.gateInput,
				repetition: {
					stories: [
						{
							story: "a",
							native: { mean: 0.1, samples: 240 },
							naive: { mean: 0.1, samples: 240 },
						},
					],
				},
				progression: {
					stories: [
						{
							story: "a",
							native: { mean: 0.5, samples: 240 },
							naive: { mean: 0.5, samples: 240 },
						},
					],
				},
				contradiction: {
					consistent: 0,
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
					accepted: 0,
					abandoned: 0,
					ties: 0,
					inconsistent: 0,
					failures: 0,
				},
			}),
		).not.toThrow();

		const aaSamples = parseR6AaSamplesJsonl(
			readFileSync(path.join(runDir, "aa-samples.jsonl"), "utf8"),
			"aa-samples.jsonl",
		);
		expect(aaSamples).toHaveLength(2);
		for (const sample of aaSamples) {
			expect(sample.seed1).toEqual({
				status: "done",
				text: expect.stringContaining("种子一续写"),
			});
			expect(sample.seed2).toEqual({
				status: "done",
				text: expect.stringContaining("种子二续写"),
			});
			expect(sample.context).toContain("玩家：历史第");
		}

		const stored = sidecar(runDir, 2);
		expect(stored.acceptedSwipeIndex).toBe(2);
		expect(stored.abandonedSwipeIndex).toBe(1);
		const later = sidecar(runDir, 4);
		expect(later.warmup.floorNodeIds).toHaveLength(1);

		const markdown = formatR6ReplayReport(report);
		expect(markdown).toContain("R6 重 roll 点回放");
		expect(markdown).toContain("|胜|负|平|换序不一致|失败|");
		expect(markdown).toContain("G1 判定输入");

		const after = createHash("sha256")
			.update(readFileSync(source))
			.digest("hex");
		expect(after).toBe(before);
	});

	it("固定选甲位时两种顺序归为换序不一致", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const report = await runR6Replay(
			replayOptions({
				dir: path.join(dir, "run"),
				dbPath: source,
				writer: fakeWriter(),
				judge: fakeJudge({ seed1Wins: false }),
				floors: [2],
			}),
		);
		expect(report.runs[0]?.outcomes.abandoned).toBe("inconsistent");
		expect(report.summary.groups.abandoned.pairs.inconsistent).toBe(1);
		expect(report.summary.groups.abandoned.completedPairs).toBe(1);
		expect(report.summary.groups.abandoned.winRate).toBeNull();
	});

	it("一个点生成失败时两组各占两个失败槽位，其他点不受影响", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const writer = fakeWriter({ failSeed: 2 });
		const report = await runR6Replay(
			replayOptions({
				dir: path.join(dir, "run"),
				dbPath: source,
				writer,
				judge: fakeJudge(),
				floors: [2, 4],
			}),
		);
		expect(report.runs).toHaveLength(2);
		for (const run of report.runs) {
			expect(run.status).toBe("failed");
			expect(run.error).toContain("种子 2生成失败");
			expect(run.judgments).toHaveLength(4);
			expect(
				run.judgments.every((record) => record.stage === "generation"),
			).toBe(true);
		}
		expect(report.summary.groups.abandoned.failures).toBe(2);
		expect(report.summary.groups.abandoned.completedPairs).toBe(0);
		expect(report.summary.groups.abandoned.judgementsCompleted).toBe(0);
		expect(report.summary.groups.abandoned.judgementsFailed).toBe(4);
		const markdown = formatR6ReplayReport(report);
		expect(markdown).toContain("生成失败");
	});

	it("续跑复用已完成的 sidecar，不再调用模型", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const runDir = path.join(dir, "run");
		const first = await runR6Replay(
			replayOptions({
				dir: runDir,
				dbPath: source,
				writer: fakeWriter(),
				judge: fakeJudge(),
				floors: [2, 4],
			}),
		);
		const writer = fakeWriter();
		const judge = fakeJudge();
		const second = await runR6Replay(
			replayOptions({
				dir: runDir,
				dbPath: source,
				writer,
				judge,
				floors: [2, 4],
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
		await runR6Replay(
			replayOptions({
				dir: runDir,
				dbPath: source,
				writer: fakeWriter(),
				judge: fakeJudge(),
				floors: [2],
			}),
		);
		await expect(
			runR6Replay(
				replayOptions({
					dir: runDir,
					dbPath: source,
					writer: fakeWriter(),
					judge: fakeJudge(),
					floors: [2],
					seed: 3,
				}),
			),
		).rejects.toThrow(/删除该文件后重跑/);
	});

	it("汇总按故事给出两组配对与 G1 判定输入", () => {
		const summary = summarizeR6Replay({
			points: [
				{
					sampleId: "a:1:reroll",
					story: "a",
					floor: 2,
					parentUserNodeId: "p1",
					userText: "玩家",
					acceptedNodeId: "x:s1",
					acceptedSwipeIndex: 1,
					abandonedNodeId: "x:s0",
					abandonedSwipeIndex: 0,
					extraAbandoned: 0,
					acceptedIsLastSwipe: true,
				},
			],
			runs: [],
			skippedAssistantParent: 1,
		});
		expect(summary.skippedAssistantParent).toBe(1);
		expect(summary.groups.abandoned.failures).toBe(1);
		expect(summary.groups.abandoned.stories[0]?.completedPairs).toBe(0);
		expect(summary.gateInput.abandoned.plannedPairs).toBe(1);
		expect(summary.gateInput.accepted.judgments).toEqual({
			completed: 0,
			failed: 0,
		});
	});
});
