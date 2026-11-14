import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type BackgroundJobRegistry,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	StoryStore as StoryStoreClass,
	createDefaultBackgroundJobRegistry,
	createEventStream,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import {
	type R6CompareRunRecord,
	R6_COMPARE_FORMAT,
	formatR6CompareReport,
	planR6BranchPoints,
	runR6Compare,
	selectR6C1BranchPoints,
} from "../src/evalset/r6-compare.js";

const STORY = "r6-compare-test";
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
	const dir = mkdtempSync(path.join(tmpdir(), "r6-compare-"));
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

function lastUser(request: LlmRequest): string {
	return (
		request.messages.filter((message) => message.role === "user").at(-1)
			?.content ?? ""
	);
}

function roundOf(request: LlmRequest): number {
	const match = lastUser(request).match(/玩家第\s*(\d+)\s*轮/);
	return match === null ? 0 : Number(match[1]);
}

interface FakeWriter {
	readonly client: LlmStreamingClient;
	readonly stats: { streams: number; completes: number };
}

function fakeWriter(): FakeWriter {
	const stats = { streams: 0, completes: 0 };
	return {
		stats,
		client: {
			async complete(request) {
				stats.completes += 1;
				if (joined(request).includes("请回忆")) return makeResult("他是游侠。");
				return makeResult("未使用");
			},
			stream(request) {
				stats.streams += 1;
				const round = roundOf(request);
				const text = `第 ${round} 轮回复：剑客走进客栈，桌上放着一壶酒。他看了看窗外。`;
				return createEventStream(async (emit) => {
					emit({ type: "text_delta", delta: text });
					return makeResult(text);
				});
			},
		},
	};
}

interface FakeUser {
	readonly client: LlmClient;
	readonly stats: { calls: number };
}

function fakeUser(): FakeUser {
	const stats = { calls: 0 };
	return {
		stats,
		client: {
			async complete() {
				stats.calls += 1;
				return makeResult(
					JSON.stringify({ message: `玩家第 ${stats.calls} 轮` }),
				);
			},
		},
	};
}

interface FakeBackground {
	readonly client: LlmClient;
	readonly registry: BackgroundJobRegistry;
	readonly stats: { calls: number };
}

function fakeBackground(): FakeBackground {
	const stats = { calls: 0 };
	return {
		stats,
		registry: createDefaultBackgroundJobRegistry(),
		client: {
			async complete(request) {
				stats.calls += 1;
				const content = joined(request);
				if (content.includes("现场分析师")) return makeResult("现场分析。");
				return makeResult("[]");
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
			async complete() {
				stats.calls += 1;
				return makeResult(
					JSON.stringify({ consistent: true, reason: "测试裁判" }),
				);
			},
		},
	};
}

function buildSourceDb(dir: string, assistantFloors = 30): string {
	const dbPath = path.join(dir, "source.db");
	const store = StoryStoreClass.open(dbPath);
	try {
		store.createStory({ id: STORY, title: "R6 对比" });
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
			if (index === 1) {
				store.appendStateDiff({
					storyId: STORY,
					nodeId: reply.id,
					path: ["character", "剑客", "identity"],
					op: "set",
					value: "游侠",
					source: "import",
				});
			}
			parentId = reply.id;
		}
		store.setHead(STORY, parentId as string);
	} finally {
		store.close();
	}
	return dbPath;
}

function compareOptions(input: {
	readonly dir: string;
	readonly dbPath: string;
	readonly writer: FakeWriter;
	readonly user: FakeUser;
	readonly judge: FakeJudge;
	readonly background: FakeBackground;
	readonly rounds: number;
	readonly branchFloors: readonly number[];
	readonly seed?: number;
}) {
	return {
		sourceDbPath: input.dbPath,
		stories: [STORY],
		rounds: input.rounds,
		dir: input.dir,
		writer: { client: input.writer.client, model: "fake-writer" },
		user: { client: input.user.client, model: "fake-user" },
		judge: { client: input.judge.client, model: "fake-judge" },
		background: {
			client: input.background.client,
			registry: input.background.registry,
		},
		structuredOutput: "text-tags" as const,
		budgetTokens: 4_000,
		maxTokens: 256,
		temperature: 0,
		seed: input.seed ?? 1,
		branchFloors: input.branchFloors,
	};
}

function sidecar(
	dir: string,
	floor: number,
	profile: "native" | "naive",
): R6CompareRunRecord {
	const file = path.join(dir, "runs", STORY, String(floor), `${profile}.json`);
	return JSON.parse(readFileSync(file, "utf8")) as R6CompareRunRecord;
}

describe("r6-compare", () => {
	it("分支点按路径深度取最近的助手楼层并保留首、中、末三个", () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const store = StoryStoreClass.open(source);
		const path = store.getPathToHead(STORY);
		store.close();
		const planned = planR6BranchPoints(path);
		expect(planned.map((point) => point.floor)).toEqual([
			6, 12, 18, 24, 30, 36, 42, 48, 54,
		]);
		expect(selectR6C1BranchPoints(planned).map((point) => point.floor)).toEqual(
			[6, 30, 54],
		);
	});

	it("两档逐字重放同一串消息，朴素档不写台账也不建后台任务", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const before = createHash("sha256")
			.update(readFileSync(source))
			.digest("hex");
		const sourceStore = StoryStoreClass.open(source);
		const sourceHead = sourceStore.getHead(STORY)?.id;
		sourceStore.close();
		const background = fakeBackground();
		const runDir = path.join(dir, "run");
		const report = await runR6Compare(
			compareOptions({
				dir: runDir,
				dbPath: source,
				writer: fakeWriter(),
				user: fakeUser(),
				judge: fakeJudge(),
				background,
				rounds: 3,
				branchFloors: [30],
			}),
		);

		expect(report.format).toBe(R6_COMPARE_FORMAT);
		expect(report.stories).toEqual([STORY]);
		expect(report.rounds).toBe(3);
		expect(report.branchPoints).toEqual([
			{ story: STORY, nodeId: expect.any(String), floor: 30 },
		]);
		expect(report.runs).toHaveLength(2);
		const native = report.runs[0] as R6CompareRunRecord;
		const naive = report.runs[1] as R6CompareRunRecord;
		expect(native.profile).toBe("native");
		expect(naive.profile).toBe("naive");
		expect(native.status).toBe("done");
		expect(naive.status).toBe("done");
		expect(naive.messages).toEqual(native.messages);
		expect(native.messages).toEqual([
			"玩家第 1 轮",
			"玩家第 2 轮",
			"玩家第 3 轮",
		]);
		expect(native.records.map((record) => record.user)).toEqual(
			naive.records.map((record) => record.user),
		);

		const natives = report.profiles.filter(
			(profile) => profile.profile === "native",
		);
		const naives = report.profiles.filter(
			(profile) => profile.profile === "naive",
		);
		expect(natives).toHaveLength(1);
		expect(naives).toHaveLength(1);
		for (const profile of report.profiles) {
			expect(profile.completedRuns).toBe(1);
			expect(profile.failedRuns).toEqual([]);
			expect(profile.rounds).toBe(3);
			expect(profile.failures).toBe(0);
			expect(profile.repetition.pairs).toBe(2);
			expect(profile.repetition.mean).not.toBeNull();
			expect(profile.progression.samples).toBe(2);
			expect(profile.progression.mean).not.toBeNull();
			expect(profile.cost.writerRequests).toBe(3);
			expect(profile.cost.writerRequestsPerRound).toBe(1);
			expect(profile.cost.firstTokenMs?.count).toBe(3);
		}
		expect(natives[0]?.cost.backgroundRequests).toBeGreaterThan(0);
		expect(naives[0]?.cost.backgroundRequests).toBe(0);

		const nativeStore = StoryStoreClass.open(
			path.join(runDir, "runs", STORY, "30", "native.db"),
		);
		const naiveStore = StoryStoreClass.open(
			path.join(runDir, "runs", STORY, "30", "naive.db"),
		);
		try {
			const nativeHead = nativeStore.getHead(STORY);
			const naiveHead = naiveStore.getHead(STORY);
			expect(nativeHead).not.toBeNull();
			expect(naiveHead).not.toBeNull();
			expect(
				nativeStore.getLedgerSettlement(nativeHead?.id as string),
			).not.toBeNull();
			expect(
				naiveStore.getLedgerSettlement(naiveHead?.id as string),
			).toBeNull();
			expect(naiveStore.getStateDiffs(naiveHead?.id as string)).toEqual([]);
			expect(naiveStore.countBackgroundJobs({ storyId: STORY }).pending).toBe(
				0,
			);
			expect(naiveStore.listBackgroundJobs({ storyId: STORY })).toEqual([]);
			expect(
				nativeStore.listBackgroundJobs({ storyId: STORY }).length,
			).toBeGreaterThan(0);
		} finally {
			nativeStore.close();
			naiveStore.close();
		}

		const markdown = formatR6CompareReport(report);
		expect(markdown).toContain("|native|");
		expect(markdown).toContain("|naive|");
		expect(markdown).toContain("预热请求");

		const after = createHash("sha256")
			.update(readFileSync(source))
			.digest("hex");
		expect(after).toBe(before);
		const afterStore = StoryStoreClass.open(source);
		try {
			expect(afterStore.getHead(STORY)?.id).toBe(sourceHead);
		} finally {
			afterStore.close();
		}
	});

	it("预热只覆盖分支点之前最近 12 个已生成完成的助手楼层，并把请求单独计数", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const background = fakeBackground();
		const report = await runR6Compare(
			compareOptions({
				dir: path.join(dir, "run"),
				dbPath: source,
				writer: fakeWriter(),
				user: fakeUser(),
				judge: fakeJudge(),
				background,
				rounds: 1,
				branchFloors: [30],
			}),
		);
		const native = report.runs[0] as R6CompareRunRecord;
		expect(native.warmup.floorNodeIds).toHaveLength(12);
		expect(native.warmup.settleRequests).toBe(12);
		expect(native.warmup.sceneRequests).toBe(12);
		const stored = sidecar(path.join(dir, "run"), 30, "native");
		expect(stored.warmup).toEqual(native.warmup);
	});

	it("探针只对原生档排期，每 6 轮一次、事实至少 10 楼", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const report = await runR6Compare(
			compareOptions({
				dir: path.join(dir, "run"),
				dbPath: source,
				writer: fakeWriter(),
				user: fakeUser(),
				judge: fakeJudge(),
				background: fakeBackground(),
				rounds: 12,
				branchFloors: [54],
			}),
		);
		const native = report.runs.find((run) => run.profile === "native");
		const naive = report.runs.find((run) => run.profile === "naive");
		expect(native?.probes.attempts).toBe(2);
		expect(native?.probes.done).toBe(2);
		expect(native?.probes.consistent).toBe(2);
		expect(naive?.probes.attempts).toBe(0);
		const probeRounds = native?.records
			.filter((record) => record.probe !== null)
			.map((record) => record.round);
		expect(probeRounds).toEqual([6, 12]);
		for (const record of native?.records ?? []) {
			if (record.probe === null) continue;
			expect(record.probe.fact?.ageFloors).toBeGreaterThanOrEqual(10);
			expect(record.probe.question).toContain("剑客");
		}
		expect(native?.cost.writerRequests).toBe(12);
		expect(native?.cost.probeRequests).toBeGreaterThan(0);
		const naiveReport = report.profiles.find(
			(profile) => profile.profile === "naive",
		);
		expect(naiveReport?.probes.attempts).toBe(0);
	});

	it("续跑复用 sidecar，不再调用写作、用户、后台或裁判模型", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const runDir = path.join(dir, "run");
		const writer = fakeWriter();
		const user = fakeUser();
		const judge = fakeJudge();
		const background = fakeBackground();
		const options = compareOptions({
			dir: runDir,
			dbPath: source,
			writer,
			user,
			judge,
			background,
			rounds: 3,
			branchFloors: [30],
		});
		await runR6Compare(options);
		expect(writer.stats.streams).toBe(6);
		expect(user.stats.calls).toBe(3);
		expect(judge.stats.calls).toBe(0);

		const secondWriter = fakeWriter();
		const secondUser = fakeUser();
		const secondJudge = fakeJudge();
		const secondBackground = fakeBackground();
		const report = await runR6Compare({
			...options,
			writer: { client: secondWriter.client, model: "fake-writer" },
			user: { client: secondUser.client, model: "fake-user" },
			judge: { client: secondJudge.client, model: "fake-judge" },
			background: {
				client: secondBackground.client,
				registry: secondBackground.registry,
			},
		});
		expect(secondWriter.stats.streams).toBe(0);
		expect(secondWriter.stats.completes).toBe(0);
		expect(secondUser.stats.calls).toBe(0);
		expect(secondJudge.stats.calls).toBe(0);
		expect(secondBackground.stats.calls).toBe(0);
		expect(report.runs.map((run) => run.profile)).toEqual(["native", "naive"]);
		expect(
			existsSync(path.join(runDir, "runs", STORY, "30", "native.json")),
		).toBe(true);
	});

	it("输入变化时 sidecar 校验失败并提示删除", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const options = compareOptions({
			dir: path.join(dir, "run"),
			dbPath: source,
			writer: fakeWriter(),
			user: fakeUser(),
			judge: fakeJudge(),
			background: fakeBackground(),
			rounds: 3,
			branchFloors: [30],
		});
		await runR6Compare(options);
		await expect(
			runR6Compare({
				...options,
				writer: { client: fakeWriter().client, model: "fake-writer" },
				user: { client: fakeUser().client, model: "fake-user" },
				judge: { client: fakeJudge().client, model: "fake-judge" },
				background: {
					client: fakeBackground().client,
					registry: fakeBackground().registry,
				},
				seed: 2,
			}),
		).rejects.toThrow(/删除该文件后重跑/);
	});
});
