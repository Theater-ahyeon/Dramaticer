import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	StoryStore,
} from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { runSceneLogCompareCli } from "../src/evalset/scene-log-compare-cli.js";
import {
	type SceneLogSampleStory,
	formatSceneLogCompareBatchReport,
	readSceneLogSamples,
	runSceneLogCompareBatch,
} from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-scene-log-cli-"));
	onTestFinished(() => {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	});
	return dir;
}

function llmResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: {
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cachedTokens: null,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

interface ScriptedClient {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
}

function scriptedClient(replies: readonly string[]): ScriptedClient {
	const requests: LlmRequest[] = [];
	return {
		requests,
		client: {
			async complete(request) {
				requests.push(request);
				const reply = replies[requests.length - 1];
				if (reply === undefined) {
					throw new Error("假客户端没有更多回复");
				}
				return llmResult(reply);
			},
		},
	};
}

interface SeededStory {
	readonly story: string;
	readonly first: string;
	readonly second: string;
}

function seedStory(
	store: StoryStore,
	storyId: string,
	prefix: string,
): SeededStory {
	store.createStory({ id: storyId, title: storyId });
	const a1 = `${prefix}a1`;
	const u1 = `${prefix}u1`;
	const a2 = `${prefix}a2`;
	const u2 = `${prefix}u2`;
	const a4 = `${prefix}a4`;
	store.appendNode({
		id: a1,
		storyId,
		parentId: null,
		role: "assistant",
		raw: "开场。凛站在教室门口。",
	});
	store.appendNode({
		id: u1,
		storyId,
		parentId: a1,
		role: "user",
		raw: "别动不动就让角色死掉。",
	});
	store.appendNode({
		id: a2,
		storyId,
		parentId: u1,
		role: "assistant",
		raw: "凛笑了一下，把书合上。",
	});
	store.appendNode({
		id: u2,
		storyId,
		parentId: a2,
		role: "user",
		raw: "我们去找老师。",
	});
	store.appendNode({
		id: a4,
		storyId,
		parentId: u2,
		role: "assistant",
		raw: "凛把书放进抽屉，转身离开。",
	});
	return { story: storyId, first: a2, second: a4 };
}

const FIRST_PATH = ["scene", "current", "place"];
const SECOND_PATH = ["time", "current"];
const SCENE_TEXT = "凛在等你的回答。";

function settleReply(
	nodeId: string,
	path: readonly string[],
	value: unknown,
): string {
	return JSON.stringify([
		{
			nodeId,
			diffs: [{ path, op: "set", value, confidence: 0.9 }],
			conflicts: [],
		},
	]);
}

function sceneLogReply(
	path: readonly string[],
	value: unknown,
	quote: string,
): string {
	return JSON.stringify({
		beat: "试探",
		states: [{ path, op: "set", value, confidence: 0.9, sourceQuote: quote }],
		present: ["凛"],
		sceneEnds: false,
	});
}

/** 独立档每个楼层依次请求结算、现场分析与用户意志；没有小品条件。 */
function independentReplies(seeded: readonly SeededStory[]): string[] {
	return seeded.flatMap((story) => [
		settleReply(story.first, FIRST_PATH, "教室"),
		SCENE_TEXT,
		"[]",
		settleReply(story.second, SECOND_PATH, "傍晚"),
		SCENE_TEXT,
		"[]",
	]);
}

function mergedReplies(seeded: readonly SeededStory[]): string[] {
	return seeded.flatMap((story) => [
		sceneLogReply(FIRST_PATH, "教室", "把书合上"),
		sceneLogReply(SECOND_PATH, "傍晚", "转身离开"),
	]);
}

async function seedSourceDb(
	target: string,
	seeded: readonly SeededStory[],
): Promise<void> {
	await mkdir(dirname(target), { recursive: true });
	const store = StoryStore.open(target);
	try {
		for (const [index, story] of seeded.entries()) {
			seedStory(store, story.story, `s${index}`);
		}
	} finally {
		store.close();
	}
}

describe("场记对照批次", () => {
	it("两个故事各复制两份源库，汇总一致率并给出逐楼层成本", async () => {
		const dir = tempDir();
		const sourceDb = join(dir, "source.db");
		const stories: SeededStory[] = [
			{ story: "s1", first: "s0a2", second: "s0a4" },
			{ story: "s2", first: "s1a2", second: "s1a4" },
		];
		await seedSourceDb(sourceDb, stories);
		const independent = scriptedClient(independentReplies(stories));
		const merged = scriptedClient(mergedReplies(stories));
		const runRoot = join(dir, "batch");

		const result = await runSceneLogCompareBatch({
			stories: stories.map((story) => ({
				story: story.story,
				sourceDbPath: sourceDb,
				nodeIds: [story.first, story.second],
			})),
			dir: runRoot,
			independentClient: independent.client,
			mergedClient: merged.client,
			minimumFloors: 2,
		});

		expect(result.samples.requestedFloors).toBe(4);
		expect(result.samples.completedFloors).toBe(4);
		expect(result.samples.insufficient).toBe(false);
		expect(result.agreement.pathAgreement).toBe(1);
		expect(result.agreement.factAgreement).toBe(1);
		expect(result.quotes).toEqual({
			submitted: 4,
			verified: 4,
			rejected: 0,
			hitRate: 1,
		});
		expect(result.independent.requests).toBe(12);
		expect(result.merged.requests).toBe(4);
		expect(result.stories.map((story) => story.story)).toEqual(["s1", "s2"]);
		expect(result.perFloor).toHaveLength(4);
		const firstFloor = result.perFloor[0];
		expect(firstFloor?.nodeId).toBe("s0a2");
		expect(firstFloor?.independentRequests).toBe(3);
		expect(firstFloor?.mergedRequests).toBe(1);
		expect(firstFloor?.independentDiffs).toHaveLength(1);
		expect(firstFloor?.mergedDiffs).toHaveLength(1);

		const source = StoryStore.open(sourceDb);
		try {
			expect(source.getLedgerSettlement("s0a2")).toBeNull();
			expect(source.getSceneLog("s0a2")).toBeNull();
		} finally {
			source.close();
		}
		const runsDir = join(runRoot, "runs");
		const runNames = await readdir(runsDir);
		expect(runNames).toHaveLength(2);
		const mergedCopyPath = join(
			runsDir,
			runNames.find((name) => name.startsWith("s1-")) ?? "",
			"merged.db",
		);
		const copy = StoryStore.open(mergedCopyPath);
		try {
			expect(copy.getSceneLog("s0a2")).not.toBeNull();
		} finally {
			copy.close();
		}
	});

	it("中文故事 id 的副本目录互不覆盖", async () => {
		const dir = tempDir();
		const sourceDb = join(dir, "source.db");
		const stories: SeededStory[] = [
			{ story: "仙女", first: "s0a2", second: "s0a4" },
			{ story: "银麒", first: "s1a2", second: "s1a4" },
		];
		await seedSourceDb(sourceDb, stories);
		const independent = scriptedClient([
			settleReply(stories[0]?.first ?? "", FIRST_PATH, "教室"),
			SCENE_TEXT,
			"[]",
			settleReply(stories[1]?.first ?? "", FIRST_PATH, "教室"),
			SCENE_TEXT,
			"[]",
		]);
		const merged = scriptedClient([
			sceneLogReply(FIRST_PATH, "教室", "把书合上"),
			sceneLogReply(FIRST_PATH, "教室", "把书合上"),
		]);
		const runRoot = join(dir, "batch");

		const result = await runSceneLogCompareBatch({
			stories: stories.map((story) => ({
				story: story.story,
				sourceDbPath: sourceDb,
				nodeIds: [story.first],
			})),
			dir: runRoot,
			independentClient: independent.client,
			mergedClient: merged.client,
			minimumFloors: 2,
		});

		expect(result.perFloor).toHaveLength(2);
		const runNames = await readdir(join(runRoot, "runs"));
		expect(new Set(runNames).size).toBe(2);
		const targets: string[] = [];
		for (const name of runNames) {
			const copy = StoryStore.open(join(runRoot, "runs", name, "merged.db"));
			try {
				const target = stories.find(
					(item) => copy.getSceneLog(item.first) !== null,
				);
				expect(target).toBeDefined();
				if (target === undefined) continue;
				targets.push(target.story);
				for (const other of stories) {
					if (other.story === target.story) continue;
					expect(copy.getSceneLog(other.first)).toBeNull();
				}
			} finally {
				copy.close();
			}
		}
		expect(new Set(targets).size).toBe(2);
	});

	it("单条引文对不上只拒绝该条，并留下拒绝原因", async () => {
		const dir = tempDir();
		const sourceDb = join(dir, "source.db");
		const story: SeededStory = { story: "s1", first: "s0a2", second: "s0a4" };
		await seedSourceDb(sourceDb, [story]);
		const independent = scriptedClient([
			JSON.stringify([
				{
					nodeId: story.first,
					diffs: [
						{
							path: FIRST_PATH,
							op: "set",
							value: "教室",
							confidence: 0.9,
						},
						{
							path: SECOND_PATH,
							op: "set",
							value: "傍晚",
							confidence: 0.8,
						},
					],
					conflicts: [],
				},
			]),
			SCENE_TEXT,
			"[]",
		]);
		const merged = scriptedClient([
			JSON.stringify({
				beat: "试探",
				states: [
					{
						path: FIRST_PATH,
						op: "set",
						value: "教室",
						confidence: 0.9,
						sourceQuote: "把书合上",
					},
					{
						path: SECOND_PATH,
						op: "set",
						value: "傍晚",
						confidence: 0.8,
						sourceQuote: "她走出教学楼",
					},
				],
				present: ["凛"],
				sceneEnds: false,
			}),
		]);

		const result = await runSceneLogCompareBatch({
			stories: [
				{ story: "s1", sourceDbPath: sourceDb, nodeIds: [story.first] },
			],
			dir: join(dir, "runs"),
			independentClient: independent.client,
			mergedClient: merged.client,
			minimumFloors: 1,
		});

		expect(result.merged.diffs).toBe(1);
		expect(result.quotes.submitted).toBe(2);
		expect(result.quotes.verified).toBe(1);
		expect(result.quotes.rejected).toBe(1);
		expect(result.agreement.pathIntersection).toBe(1);
		expect(result.agreement.pathUnion).toBe(2);
		const floor = result.perFloor[0];
		expect(floor?.quotes.rejected).toBe(1);
		expect(floor?.mergedRepairs.length).toBeGreaterThanOrEqual(1);
		const report = formatSceneLogCompareBatchReport(result);
		expect(report).toContain("## 拒绝原因");
		expect(report).toContain(story.first);
	});

	it("样本低于下限时标注不足并说明原因", async () => {
		const dir = tempDir();
		const sourceDb = join(dir, "source.db");
		const story: SeededStory = { story: "s1", first: "s0a2", second: "s0a4" };
		await seedSourceDb(sourceDb, [story]);
		const independent = scriptedClient([
			settleReply(story.first, FIRST_PATH, "教室"),
			SCENE_TEXT,
			"[]",
		]);
		const merged = scriptedClient([
			sceneLogReply(FIRST_PATH, "教室", "把书合上"),
		]);

		const result = await runSceneLogCompareBatch({
			stories: [
				{ story: "s1", sourceDbPath: sourceDb, nodeIds: [story.first] },
			],
			dir: join(dir, "runs"),
			independentClient: independent.client,
			mergedClient: merged.client,
			minimumFloors: 3,
		});

		expect(result.samples.insufficient).toBe(true);
		expect(result.samples.reason).toContain("低于下限 3");
		expect(result.samples.completedFloors).toBe(1);
		const report = formatSceneLogCompareBatchReport(result);
		expect(report).toContain("样本判定：不足");
	});

	it("CLI 写出结果与报告，最低楼层数按样本文件读取", async () => {
		const dir = tempDir();
		const sourceDb = join(dir, "source.db");
		const story: SeededStory = { story: "s1", first: "s0a2", second: "s0a4" };
		await seedSourceDb(sourceDb, [story]);
		const samplesPath = join(dir, "samples.json");
		await writeFile(
			samplesPath,
			`${JSON.stringify({
				minimumFloors: 2,
				stories: [{ story: "s1", sourceDb: "source.db", nodeIds: ["s0a2"] }],
			})}\n`,
			"utf8",
		);
		const runDir = join(dir, "run");
		const jsonPath = join(runDir, "result.json");
		const reportPath = join(runDir, "report.md");
		const scripts = new Map<"independent" | "merged", ScriptedClient>([
			[
				"independent",
				scriptedClient([
					settleReply(story.first, FIRST_PATH, "教室"),
					SCENE_TEXT,
					"[]",
				]),
			],
			[
				"merged",
				scriptedClient([sceneLogReply(FIRST_PATH, "教室", "把书合上")]),
			],
		]);

		const result = await runSceneLogCompareCli({
			samplesPath,
			dir: runDir,
			jsonPath,
			reportPath,
			cacheDir: join(runDir, "cache"),
			createClient: (side) => {
				const script = scripts.get(side);
				if (script === undefined) throw new Error(`没有 ${side} 的脚本`);
				return script.client;
			},
			log: () => undefined,
		});

		expect(result.samples.insufficient).toBe(true);
		expect(result.samples.minimumFloors).toBe(2);
		expect(result.samples.path).toBe(samplesPath);
		const saved = JSON.parse(await readFile(jsonPath, "utf8")) as {
			format: string;
			perFloor: { nodeId: string }[];
		};
		expect(saved.format).toBe("scene-log-compare/v1");
		expect(saved.perFloor[0]?.nodeId).toBe("s0a2");
		const report = await readFile(reportPath, "utf8");
		expect(report).toContain("# 场记对照");
		expect(report).toContain("样本判定：不足");
	});

	it("样本文件里的楼层不存在时直接失败", async () => {
		const dir = tempDir();
		const sourceDb = join(dir, "source.db");
		await seedSourceDb(sourceDb, [
			{ story: "s1", first: "s0a2", second: "s0a4" },
		]);
		const story: SceneLogSampleStory = {
			story: "s1",
			sourceDbPath: sourceDb,
			nodeIds: ["missing-node"],
		};
		const independent = scriptedClient([]);
		const merged = scriptedClient([]);
		await expect(
			runSceneLogCompareBatch({
				stories: [story],
				dir: join(dir, "runs"),
				independentClient: independent.client,
				mergedClient: merged.client,
			}),
		).rejects.toThrow("没有楼层 missing-node");
	});

	it("样本文件拒绝重复楼层", async () => {
		const dir = tempDir();
		const samplesPath = join(dir, "samples.json");
		await writeFile(
			samplesPath,
			JSON.stringify({
				stories: [{ story: "s1", sourceDb: "a.db", nodeIds: ["n1", "n1"] }],
			}),
			"utf8",
		);
		await expect(readSceneLogSamples(samplesPath)).rejects.toThrow(
			"出现了多次",
		);
	});
});
