import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	type LlmChannelsConfig,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	StoryStore,
	createEventStream,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import { runHistoricalReplayCli } from "../src/evalset/historical-replay-cli.js";
import {
	type HistoricalReplayRecord,
	type HistoricalReplaySample,
	judgeHistoricalReplaySample,
	normalizeB1Winner,
	parseHistoricalReplayRecordsJsonl,
	parseHistoricalReplaySamplesJsonl,
	planHistoricalReplaySamples,
	summarizeHistoricalReplay,
} from "../src/evalset/historical-replay.js";
import { formatPairwiseContext } from "../src/evalset/pairwise.js";
import type { Snapshot, SnapshotManifestFile } from "../src/health/manifest.js";

const STORY_ID = "b1-story";
const HISTORICAL_MODEL = "fake-historical-model";
const GENERATED_TEXT = "山门缓缓打开，石阶上留着新鲜的水痕。";
const HISTORICAL_TEXT = "山门紧闭，门缝里透出一点光。";

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
		model: "fake",
		channel: "fake",
		usage: USAGE,
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: text.length === 0 ? null : { text, reasoning: "" },
	};
}

interface FakeClients {
	readonly writer: LlmStreamingClient;
	readonly judge: LlmStreamingClient;
	readonly writerRequests: LlmRequest[];
}

function createClients(): FakeClients {
	const writerRequests: LlmRequest[] = [];
	let judgeCalls = 0;
	const writer: LlmStreamingClient = {
		async complete() {
			return makeResult(GENERATED_TEXT);
		},
		stream(request) {
			writerRequests.push(request);
			return createEventStream(async (emit) => {
				emit({ type: "text_delta", delta: GENERATED_TEXT });
				return makeResult(GENERATED_TEXT);
			});
		},
	};
	const judge: LlmStreamingClient = {
		async complete(request) {
			judgeCalls += 1;
			const system = request.messages[0]?.content ?? "";
			if (system.includes("TTCW")) {
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
			return makeResult(
				JSON.stringify({
					winner: judgeCalls % 2 === 1 ? "A" : "B",
					reason: "测试判定",
				}),
			);
		},
		stream() {
			return createEventStream(async () => makeResult("{}"));
		},
	};
	return { writer, judge, writerRequests };
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: STORY_ID, title: "测试故事" });
	store.updateStorySettings(STORY_ID, {
		characterPrompt: "你扮演守门人，用克制的口吻叙述。",
	});
	const nodes = [
		{ id: "m0", role: "user" as const, raw: "我走到山门前。" },
		{ id: "m1", role: "assistant" as const, raw: HISTORICAL_TEXT },
		{ id: "m2", role: "user" as const, raw: "我敲了敲门。" },
		{ id: "m3", role: "assistant" as const, raw: "门里传来脚步声。" },
	];
	let parentId: string | null = null;
	for (const node of nodes) {
		const created = store.appendNode({
			id: `${STORY_ID}:${node.id}:s0`,
			storyId: STORY_ID,
			parentId,
			role: node.role,
			raw: node.raw,
			createdAt: `2026-01-01T00:00:0${node.id.slice(1)}.000Z`,
		});
		parentId = created.id;
	}
}

async function writeChatFile(filePath: string): Promise<void> {
	const messages = [
		{ index: 0, isUser: true, text: "我走到山门前。" },
		{ index: 1, isUser: false, text: HISTORICAL_TEXT },
		{ index: 2, isUser: true, text: "我敲了敲门。" },
		{ index: 3, isUser: false, text: "门里传来脚步声。" },
	];
	const lines = [
		JSON.stringify({
			chat_metadata: {},
			user_name: "玩家",
			character_name: "守门人",
		}),
		...messages.map((message) =>
			JSON.stringify({
				name: message.isUser ? "玩家" : "守门人",
				is_user: message.isUser,
				is_system: false,
				send_date: "2026-01-01T00:00:00.000Z",
				mes: message.text,
				extra: message.index === 3 ? { model: HISTORICAL_MODEL } : {},
				swipes: [],
				swipe_id: 0,
			}),
		),
	];
	await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

function makeSnapshot(chatPath: string): Snapshot {
	const file: SnapshotManifestFile = {
		role: "chat",
		character: STORY_ID,
		target: "chats/b1.jsonl",
		size: 1,
		sha256: "0".repeat(64),
	};
	return {
		manifest: { generatedAt: null, files: [file] },
		filesByRole(role) {
			return role === "chat" ? [file] : [];
		},
		async resolveFile() {
			return chatPath;
		},
	};
}

function makeConfig(): LlmChannelsConfig {
	return {
		channels: new Map(),
		models: new Map([
			[
				"writer-fake",
				{
					alias: "writer-fake",
					id: "fake-writer",
					contextWindow: 8_192,
					maxTokens: 2_048,
					reasoning: false,
					enabled: true,
					channels: ["fake"],
					tools: null,
					probe: null,
				},
			],
			[
				"judge-fake",
				{
					alias: "judge-fake",
					id: "fake-judge",
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
		roles: new Map([
			["writer", "writer-fake"],
			["judge", "judge-fake"],
		]),
		embeddings: new Map(),
	};
}

function makeSample(
	sampleId: string,
	overrides: Partial<HistoricalReplaySample> = {},
): HistoricalReplaySample {
	const [storyId, floor, profile] = sampleId.split(":");
	return {
		sampleId,
		storyId: storyId as string,
		profile: profile === "naive" ? "naive" : "native",
		branchNodeId: `${storyId}:b`,
		branchFloor: Number(floor),
		historicalNodeId: `${storyId}:h`,
		generatedNodeId: `${storyId}:g`,
		writerModel: "writer-fake",
		writerModelId: "fake-writer",
		judgeModel: "judge-fake",
		historicalModel: HISTORICAL_MODEL,
		sameModel: false,
		sameFamily: false,
		prefixFloors: Number(floor),
		rounds: 1,
		interval: 1,
		maxBranchPointsPerStory: 1,
		originalHeadNodeId: `${storyId}:h`,
		memory: true,
		director: true,
		temperature: 0.8,
		maxTokens: 2_048,
		reasoning: "low",
		budgetTokens: 6_144,
		createdAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

function makeRecord(
	sample: HistoricalReplaySample,
	order: "generated-first" | "historical-first",
	winner: "A" | "B" | "tie",
): HistoricalReplayRecord {
	return {
		sampleId: sample.sampleId,
		storyId: sample.storyId,
		profile: sample.profile,
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

describe("B1 分支点与记录口径", () => {
	it("按 ADR-0027 每隔 interval 取一个助手楼层并定位历史回复", () => {
		const path = Array.from({ length: 310 }, (_, index) => ({
			id: `n${index}`,
			storyId: "s",
			parentId: index === 0 ? null : `n${index - 1}`,
			role: (index % 2 === 0 ? "assistant" : "user") as const,
			raw: `第 ${index} 楼`,
			createdAt: "2026-01-01T00:00:00.000Z",
		}));
		const points = planHistoricalReplaySamples(
			path,
			{ interval: 100, rounds: 1, maxBranchPointsPerStory: 2 },
			(nodeId) => (nodeId === "n102" ? HISTORICAL_MODEL : null),
		);
		expect(points).toHaveLength(2);
		expect(points[0]).toMatchObject({
			branchNodeId: "n100",
			branchFloor: 101,
			historicalNodeId: "n102",
			historicalModel: HISTORICAL_MODEL,
		});
		expect(points[0]?.userTexts).toEqual(["第 101 楼"]);
		expect(points[1]).toMatchObject({
			branchNodeId: "n200",
			branchFloor: 201,
			historicalNodeId: "n202",
		});
	});

	it("后续玩家消息不足时不取点", () => {
		const path = Array.from({ length: 102 }, (_, index) => ({
			id: `n${index}`,
			storyId: "s",
			parentId: index === 0 ? null : `n${index - 1}`,
			role: (index % 2 === 0 ? "assistant" : "user") as const,
			raw: `第 ${index} 楼`,
			createdAt: "2026-01-01T00:00:00.000Z",
		}));
		expect(
			planHistoricalReplaySamples(
				path,
				{ interval: 100, rounds: 2, maxBranchPointsPerStory: 2 },
				() => null,
			),
		).toHaveLength(0);
	});

	it("换序后把胜负归回续写与历史回复", () => {
		expect(normalizeB1Winner("generated-first", "A")).toBe("generated");
		expect(normalizeB1Winner("generated-first", "B")).toBe("historical");
		expect(normalizeB1Winner("historical-first", "B")).toBe("generated");
		expect(normalizeB1Winner("historical-first", "A")).toBe("historical");
		expect(normalizeB1Winner("historical-first", "tie")).toBe("tie");
	});

	it("判定与评分分别记录两种顺序", async () => {
		const judge = createClients().judge;
		const records = await judgeHistoricalReplaySample(
			{
				sampleId: "s:101:native",
				storyId: "s",
				profile: "native",
				context: "最近的对话",
				generatedText: GENERATED_TEXT,
				historicalText: HISTORICAL_TEXT,
			},
			{ client: judge, model: "judge-fake" },
			{ now: () => "2026-01-01T00:00:00.000Z" },
		);
		expect(records).toHaveLength(2);
		expect(records.map((record) => record.order)).toEqual([
			"generated-first",
			"historical-first",
		]);
		expect(records[0]).toMatchObject({ status: "done", winner: "A" });
		expect(records[1]).toMatchObject({ status: "done", winner: "B" });
		expect(
			records.map((record) =>
				record.status === "done" ? record.winner : null,
			),
		).toEqual(["A", "B"]);
	});

	it("统计位置偏差与同模型子集", () => {
		const a = makeSample("story-a:101:native", { sameModel: true });
		const b = makeSample("story-a:101:naive");
		const records = [
			makeRecord(a, "generated-first", "A"),
			makeRecord(a, "historical-first", "A"),
			makeRecord(b, "generated-first", "B"),
			makeRecord(b, "historical-first", "B"),
		];
		const summary = summarizeHistoricalReplay(records, [a, b]);
		expect(summary.hasSameModelSamples).toBe(true);
		expect(
			summary.overall.find((group) => group.profile === "native"),
		).toMatchObject({
			samples: 1,
			judgements: 2,
			completed: 1,
			generatedWins: 1,
			historicalWins: 1,
			positionBias: 1,
		});
		expect(
			summary.sameModel.find((group) => group.profile === "native"),
		).toMatchObject({ samples: 1, judgements: 2 });
		expect(
			summary.sameModel.find((group) => group.profile === "naive"),
		).toMatchObject({ samples: 0, judgements: 0, generatedShare: null });
		expect(summary.byStory.map((group) => group.storyId)).toEqual([
			"story-a",
			"story-a",
		]);
	});

	it("样本与判定 JSONL 可以读回并拒绝非法字段", () => {
		const sample = makeSample("s:101:native");
		const text = `${JSON.stringify(sample)}\n`;
		expect(parseHistoricalReplaySamplesJsonl(text, "samples.jsonl")).toEqual([
			sample,
		]);
		expect(() =>
			parseHistoricalReplaySamplesJsonl('{"sampleId":"x"}\n', "samples.jsonl"),
		).toThrow(/字段必须是/);
		const record = makeRecord(sample, "generated-first", "A");
		expect(
			parseHistoricalReplayRecordsJsonl(
				`${JSON.stringify(record)}\n`,
				"records.jsonl",
			),
		).toEqual([record]);
		expect(() =>
			parseHistoricalReplayRecordsJsonl(
				`${JSON.stringify({ ...record, order: "unknown" })}\n`,
				"records.jsonl",
			),
		).toThrow(/order/);
	});
});

describe("B1 命令行", () => {
	it(
		"回放两个档位、写出判定与报告，续跑不重复生成",
		async () => {
			const root = makeDir(".tmp-b1-");
			const dbDir = path.join(root, "db");
			await mkdir(dbDir, { recursive: true });
			const dbPath = path.join(dbDir, "0-b1-story.db");
			const store = StoryStore.open(dbPath);
			seedStory(store);
			store.close();
			const chatPath = path.join(root, "chat.jsonl");
			await writeChatFile(chatPath);
			const clients = createClients();
			const outPath = path.join(root, "records.jsonl");
			const samplesPath = path.join(root, "samples.jsonl");
			const qualityPath = path.join(root, "quality.jsonl");
			const privateReportPath = path.join(root, "private.md");
			const publicPath = path.join(root, "public.md");
			const args = [
				"--db-dir",
				dbDir,
				"--out",
				outPath,
				"--samples-out",
				samplesPath,
				"--quality-out",
				qualityPath,
				"--private-report",
				privateReportPath,
				"--public-report",
				publicPath,
				"--model",
				"writer-fake",
				"--judge-model",
				"judge-fake",
				"--interval",
				"1",
				"--rounds",
				"1",
				"--max-branch-points",
				"1",
				"--profiles",
				"native,naive",
			];
			const dependencies = {
				loadEnv: () => undefined,
				loadConfig: async () => makeConfig(),
				createClient: (_config: LlmChannelsConfig, alias: string) =>
					alias === "judge-fake" ? clients.judge : clients.writer,
				openSnapshot: async () => makeSnapshot(chatPath),
				now: () => new Date("2026-01-01T00:00:00.000Z"),
				log: () => undefined,
			};
			const first = await runHistoricalReplayCli(args, dependencies);
			expect(first.sampleCount).toBe(2);
			expect(first.records).toBe(4);
			expect(first.failures).toBe(0);
			expect(first.qualityScores).toBe(4);
			const samples = parseHistoricalReplaySamplesJsonl(
				readFileSync(samplesPath, "utf8"),
				samplesPath,
			);
			expect(samples.map((sample) => sample.profile).sort()).toEqual([
				"naive",
				"native",
			]);
			expect(samples[0]).toMatchObject({
				historicalModel: HISTORICAL_MODEL,
				sameModel: false,
				sameFamily: false,
				prefixFloors: 2,
			});
			const native = samples.find((sample) => sample.profile === "native");
			const naive = samples.find((sample) => sample.profile === "naive");
			expect(native).toMatchObject({ memory: true, director: true });
			expect(naive).toMatchObject({ memory: false, director: false });
			const records = parseHistoricalReplayRecordsJsonl(
				readFileSync(outPath, "utf8"),
				outPath,
			);
			expect(records).toHaveLength(4);
			const publicText = readFileSync(publicPath, "utf8");
			expect(publicText).not.toContain(STORY_ID);
			expect(publicText).not.toContain(GENERATED_TEXT);
			expect(publicText).not.toContain(HISTORICAL_TEXT);
			expect(publicText).toContain("writer-fake");
			expect(publicText).toContain(HISTORICAL_MODEL);
			expect(publicText).toContain("B1 只作参考");
			expect(publicText).toContain("对话 1");
			const privateText = readFileSync(privateReportPath, "utf8");
			expect(privateText).toContain(STORY_ID);
			expect(privateText).toContain("叙事质量评分");
			expect(privateText).toContain("上下文差异");

			const requestsBefore = clients.writerRequests.length;
			const second = await runHistoricalReplayCli(
				[...args, "--resume"],
				dependencies,
			);
			expect(second.sampleCount).toBe(2);
			expect(second.records).toBe(4);
			expect(clients.writerRequests.length).toBe(requestsBefore);
			expect(
				parseHistoricalReplayRecordsJsonl(
					readFileSync(outPath, "utf8"),
					outPath,
				),
			).toHaveLength(4);

			const third = await runHistoricalReplayCli(args, dependencies);
			expect(third.sampleCount).toBe(2);
			expect(clients.writerRequests.length).toBeGreaterThan(requestsBefore);

			const freshArgs = args.map((value) => {
				if (value === outPath) return path.join(root, "records-2.jsonl");
				if (value === samplesPath) return path.join(root, "samples-2.jsonl");
				if (value === qualityPath) return path.join(root, "quality-2.jsonl");
				return value;
			});
			const fourth = await runHistoricalReplayCli(freshArgs, dependencies);
			expect(fourth.sampleCount).toBe(2);
			const freshSamples = parseHistoricalReplaySamplesJsonl(
				readFileSync(path.join(root, "samples-2.jsonl"), "utf8"),
				"samples-2.jsonl",
			);
			expect(
				freshSamples.every(
					(sample) => sample.originalHeadNodeId === `${STORY_ID}:m3:s0`,
				),
			).toBe(true);
			expect(freshSamples.map((sample) => sample.branchFloor).sort()).toEqual([
				2, 2,
			]);
		},
		{ timeout: 60_000 },
	);

	it("只读报告从已有 JSONL 生成", async () => {
		const root = makeDir(".tmp-b1-report-");
		const a = makeSample("story-secret:101:native");
		const b = makeSample("story-secret:101:naive", { sameModel: true });
		const samplesPath = path.join(root, "samples.jsonl");
		const outPath = path.join(root, "records.jsonl");
		const qualityPath = path.join(root, "quality.jsonl");
		const privateReportPath = path.join(root, "private.md");
		const publicPath = path.join(root, "public.md");
		await writeFile(
			samplesPath,
			[a, b].map((sample) => `${JSON.stringify(sample)}\n`).join(""),
			"utf8",
		);
		await writeFile(
			outPath,
			[
				makeRecord(a, "generated-first", "A"),
				makeRecord(a, "historical-first", "A"),
				makeRecord(b, "generated-first", "B"),
				makeRecord(b, "historical-first", "B"),
			]
				.map((record) => `${JSON.stringify(record)}\n`)
				.join(""),
			"utf8",
		);
		await writeFile(qualityPath, "", "utf8");
		const result = await runHistoricalReplayCli(
			[
				"--report-only",
				"--out",
				outPath,
				"--samples-out",
				samplesPath,
				"--quality-out",
				qualityPath,
				"--private-report",
				privateReportPath,
				"--public-report",
				publicPath,
			],
			{ log: () => undefined },
		);
		expect(result.sampleCount).toBe(2);
		expect(result.records).toBe(4);
		const publicText = readFileSync(publicPath, "utf8");
		expect(publicText).not.toContain("story-secret");
		expect(publicText).toContain("同模型子集");
		const privateText = readFileSync(privateReportPath, "utf8");
		expect(privateText).toContain("story-secret");
	});
});

describe("B1 语境格式", () => {
	it("与两两对比共用最近对话格式", () => {
		const text = formatPairwiseContext([
			{
				id: "u",
				storyId: "s",
				parentId: null,
				role: "user",
				raw: "我推门。",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "a",
				storyId: "s",
				parentId: "u",
				role: "assistant",
				raw: "门开了。",
				createdAt: "2026-01-01T00:00:01.000Z",
			},
		]);
		expect(text).toBe("玩家：我推门。\n\n角色：门开了。");
	});
});
