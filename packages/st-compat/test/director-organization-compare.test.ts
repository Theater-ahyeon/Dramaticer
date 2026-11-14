import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type DirectorBit,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	StoryStore as StoryStoreClass,
	createDefaultContextTemplate,
	createEventStream,
	isJsonObject,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import {
	type DirectorConditionSample,
	readDirectorConditionSampleFile,
} from "../src/evalset/condition-samples.js";
import {
	DIRECTOR_COMPARE_FORMAT,
	formatDirectorOrganizationCompareReport,
	runDirectorOrganizationCompare,
} from "../src/evalset/director-organization-compare.js";

const STORY = "director-compare-test";
const conditionFile = fileURLToPath(
	new URL("./fixtures/director-conditions.json", import.meta.url),
);
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
	const dir = mkdtempSync(path.join(tmpdir(), "director-compare-"));
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
	const match = lastUser(request).match(/第\s*(\d+)\s*轮/);
	return match === null ? 0 : Number(match[1]);
}

function bitsPack(): DirectorBit[] {
	return [
		{
			id: "wound",
			condition: { kind: "text", text: "玩家提到旧伤" },
			instruction: "推进旧伤线索。",
			priority: 10,
			cooldown: 0,
			after: null,
			repeatable: true,
			fallback: false,
		},
		{
			id: "daily",
			condition: null,
			instruction: "推进日常场景。",
			priority: 0,
			cooldown: 0,
			after: null,
			repeatable: true,
			fallback: true,
		},
	];
}

function playReply(request: LlmRequest): string {
	const bits = joined(request).includes("推进旧伤线索");
	const round = roundOf(request);
	if (bits && round === 1) {
		return '小品正文 第 1 轮。<plot_note>{"text":"旧伤复发"}</plot_note>';
	}
	if (bits && round === 2) {
		return "小品正文 第 2 轮。旧伤复发，他按住肩膀。";
	}
	return `机制正文 第 ${round} 轮。`;
}

interface FakeWriter {
	readonly client: LlmStreamingClient;
	readonly stats: { streams: number; completes: number };
}

function fakeWriter(options: { failOnBits?: boolean } = {}): FakeWriter {
	const stats = { streams: 0, completes: 0 };
	return {
		stats,
		client: {
			async complete() {
				stats.completes += 1;
				return makeResult("未使用");
			},
			stream(request) {
				stats.streams += 1;
				if (
					options.failOnBits === true &&
					joined(request).includes("推进旧伤线索") &&
					roundOf(request) === 2
				) {
					throw new Error("模拟小品第 2 轮失败");
				}
				const text = playReply(request);
				return createEventStream(async (emit) => {
					emit({ type: "text_delta", delta: text });
					return makeResult(text);
				});
			},
		},
	};
}

/** 从提示词末尾的“待判断条件”读出 id，并按固定规则给出判断。 */
function parseConditionIds(request: LlmRequest): string[] {
	const content = lastUser(request);
	const marker = content.lastIndexOf("待判断条件：");
	if (marker < 0) throw new Error("提示词里没有待判断条件");
	const parsed: unknown = JSON.parse(
		content.slice(marker + "待判断条件：".length),
	);
	if (!Array.isArray(parsed)) throw new Error("待判断条件不是数组");
	return parsed.map((item, index) => {
		if (!isJsonObject(item) || typeof item.id !== "string") {
			throw new Error(`待判断条件[${index}] 没有 id`);
		}
		return item.id;
	});
}

interface FakeBackground {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
}

function fakeBackground(): FakeBackground {
	const requests: LlmRequest[] = [];
	return {
		requests,
		client: {
			async complete(request) {
				requests.push(request);
				const judgments = parseConditionIds(request).map((id) => ({
					id,
					matched: !id.startsWith("sunny"),
					reason: `固定判断 ${id}`,
				}));
				return makeResult(JSON.stringify({ judgments }));
			},
		},
	};
}

function fakeJudge(): LlmClient {
	return {
		async complete(request) {
			const content = joined(request);
			if (content.includes("两个版本")) {
				const firstStart = content.indexOf("续写甲：");
				const secondStart = content.indexOf("续写乙：");
				const first = content.slice(firstStart, secondStart);
				const second = content.slice(secondStart);
				const firstBits = first.includes("小品正文");
				const secondBits = second.includes("小品正文");
				let winner: "A" | "B" | "tie" = "tie";
				if (firstBits && !secondBits) winner = "A";
				else if (secondBits && !firstBits) winner = "B";
				return makeResult(JSON.stringify({ winner, reason: "测试偏向小品" }));
			}
			return makeResult(
				JSON.stringify({ consistent: true, reason: "测试裁判" }),
			);
		},
	};
}

function buildSourceDb(dir: string): string {
	const dbPath = path.join(dir, "source.db");
	const store = StoryStoreClass.open(dbPath);
	try {
		store.createStory({ id: STORY, title: "导演对比" });
		store.updateStorySettings(STORY, {
			characterPrompt: "你是测试角色。",
			maxTokens: 256,
			temperature: 0,
		});
		const first = store.appendNode({
			storyId: STORY,
			parentId: null,
			role: "user",
			raw: "开场",
		});
		const reply = store.appendNode({
			storyId: STORY,
			parentId: first.id,
			role: "assistant",
			raw: "开场正文",
		});
		store.setHead(STORY, reply.id);
	} finally {
		store.close();
	}
	return dbPath;
}

function compareOptions(input: {
	readonly dir: string;
	readonly dbPath: string;
	readonly writer: FakeWriter;
	readonly background?: FakeBackground;
	readonly conditions?: readonly DirectorConditionSample[];
}) {
	return {
		sourceDbPath: input.dbPath,
		story: STORY,
		rounds: 2,
		messages: ["第 1 轮：我问他肩上的旧伤。", "第 2 轮：他怎么说？"],
		repetitions: 1,
		dir: input.dir,
		writer: { client: input.writer.client, model: "fake-writer" },
		judge: { client: fakeJudge(), model: "fake-judge" },
		background: {
			client: (input.background ?? fakeBackground()).client,
			model: "fake-background",
		},
		template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
		budgetTokens: 4_000,
		structuredOutput: "text-tags" as const,
		bits: bitsPack(),
		conditionSamples: input.conditions ?? [],
		seed: 1,
		maxTokens: 256,
		temperature: 0,
	};
}

describe("director-organization-compare", () => {
	it("两个候选产出同一格式的指标表，并记录重复次数与样本数", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const conditions = await readDirectorConditionSampleFile(conditionFile);
		const background = fakeBackground();
		const runDir = path.join(dir, "run");
		const report = await runDirectorOrganizationCompare(
			compareOptions({
				dir: runDir,
				dbPath: source,
				writer: fakeWriter(),
				background,
				conditions,
			}),
		);

		expect(report.format).toBe(DIRECTOR_COMPARE_FORMAT);
		expect(report.story).toBe(STORY);
		expect(report.rounds).toBe(2);
		expect(report.repetitions).toBe(1);
		expect(report.messageCount).toBe(2);
		expect(report.candidates.map((candidate) => candidate.kind)).toEqual([
			"mechanisms",
			"bits",
		]);
		for (const candidate of report.candidates) {
			expect(candidate.completedRuns).toBe(1);
			expect(candidate.failedRuns).toEqual([]);
			expect(candidate.repetitions).toBe(1);
			expect(candidate.samples.rounds).toBe(2);
			expect(candidate.samples.requests).toBe(2);
			expect(candidate.cost.writerRequestsPerRound).toBe(1);
			expect(candidate.cost.firstTokenMs?.count).toBe(2);
		}
		const mechanisms = report.candidates[0];
		const bits = report.candidates[1];
		expect(mechanisms?.samples.backgroundRequests).toBe(0);
		expect(bits?.samples.backgroundRequests).toBeGreaterThan(0);
		expect(bits?.samples.progressSamples).toBe(1);
		expect(bits?.progress).not.toBeNull();
		expect(bits?.samples.notesCreated).toBe(1);
		expect(bits?.samples.notesFulfilled).toBe(1);
		expect(bits?.clueFulfillmentRate).toBe(1);
		expect(mechanisms?.clueFulfillmentRate).toBeNull();
		expect(mechanisms?.blindWinRate).toBeNull();
		expect(bits?.blindWinRate).toBe(1);
		expect(bits?.samples.blindWins).toBe(4);
		expect(bits?.samples.blindLosses).toBe(0);
		expect(report.conditions.total).toBe(conditions.length);
		expect(report.conditions.correct).toBe(conditions.length);
		expect(report.conditions.accuracy).toBe(1);
		expect(
			report.conditions.checks.some(
				(check) => check.id === "sunny-text" && check.matched === false,
			),
		).toBe(true);
		for (const kind of ["mechanisms", "bits"]) {
			expect(existsSync(path.join(runDir, "runs", kind, "1.json"))).toBe(true);
		}
		const markdown = formatDirectorOrganizationCompareReport(report);
		expect(markdown).toContain("|mechanisms|1/0|2|");
		expect(markdown).toContain("|bits|1/0|2|");
		expect(markdown).toContain("条件判断");
		expect(markdown).toContain("|sunny-text|text|false|false|correct|");
	});

	it("重跑时复用 sidecar，不再调用写作、判断或裁判模型", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const runDir = path.join(dir, "run");
		const firstWriter = fakeWriter();
		const firstBackground = fakeBackground();
		const options = compareOptions({
			dir: runDir,
			dbPath: source,
			writer: firstWriter,
			background: firstBackground,
		});
		await runDirectorOrganizationCompare(options);
		expect(firstWriter.stats.streams).toBe(4);
		expect(firstBackground.requests.length).toBeGreaterThan(0);

		const secondWriter = fakeWriter();
		const secondBackground = fakeBackground();
		await runDirectorOrganizationCompare({
			...options,
			writer: { client: secondWriter.client, model: "fake-writer" },
			background: {
				client: secondBackground.client,
				model: "fake-background",
			},
		});
		expect(secondWriter.stats.streams).toBe(0);
		expect(secondWriter.stats.completes).toBe(0);
		expect(secondBackground.requests).toEqual([]);
	});

	it("单个候选失败不影响另一个候选的结果", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const report = await runDirectorOrganizationCompare(
			compareOptions({
				dir: path.join(dir, "run"),
				dbPath: source,
				writer: fakeWriter({ failOnBits: true }),
			}),
		);
		const mechanisms = report.candidates[0];
		const bits = report.candidates[1];
		expect(mechanisms?.completedRuns).toBe(1);
		expect(mechanisms?.failedRuns).toEqual([]);
		expect(bits?.completedRuns).toBe(0);
		expect(bits?.failedRuns).toHaveLength(1);
		expect(bits?.failedRuns[0]?.error).toContain("第 2 轮失败");
		const markdown = formatDirectorOrganizationCompareReport(report);
		expect(markdown).toContain("bits 第 1 次失败");
	});

	it("条件样本按人工标注逐条核对，错误与缺失不会被算成正确", async () => {
		const dir = makeDir();
		const source = buildSourceDb(dir);
		const sample: DirectorConditionSample = {
			id: "will-miss",
			bit: bitsPack()[0] as DirectorBit,
			floors: [{ role: "user", raw: "我问他肩上的旧伤。" }],
			state: {},
			expected: false,
		};
		const broken: LlmClient = {
			async complete() {
				throw new Error("判断模型不可用");
			},
		};
		const report = await runDirectorOrganizationCompare({
			...compareOptions({
				dir: path.join(dir, "run"),
				dbPath: source,
				writer: fakeWriter(),
			}),
			background: { client: broken, model: "broken" },
			conditionSamples: [sample],
		});
		expect(report.conditions.total).toBe(1);
		expect(report.conditions.failed).toBe(1);
		expect(report.conditions.correct).toBe(0);
		expect(report.conditions.accuracy).toBe(0);
		expect(report.conditions.checks[0]?.status).toBe("failed");
		expect(report.conditions.checks[0]?.error).toContain("判断模型不可用");
	});
});
