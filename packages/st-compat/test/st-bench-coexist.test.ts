import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	type ContextSlotProviders,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	createEventStream,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import { parseCharacterCardFile } from "../src/character-card.js";
import type { ForgettingStaticQuestion } from "../src/evalset/forgetting.js";
import {
	COEXIST_METRICS_FILE,
	COEXIST_REPORT_FILE,
	type CoexistCardSpec,
	type CoexistPluginAdapter,
	type CoexistRunConfig,
	loadCoexistCards,
	loadCoexistConfig,
	runCoexistComparisons,
	writeCoexistOutputs,
} from "../src/st-bench/coexist.js";

const STORY_ID = "coexist-story";
const CARD_PATH = path.join(import.meta.dirname, "fixtures", "chat-card.json");
const CHAT_PATH = path.join(
	import.meta.dirname,
	"fixtures",
	"health-chat.jsonl",
);
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

function makeDir(): string {
	const dir = mkdtempSync(path.join(import.meta.dirname, ".tmp-coexist-"));
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
		continuation: text.length === 0 ? null : { text, reasoning: "" },
	};
}

function joined(request: LlmRequest): string {
	return request.messages.map((message) => message.content).join("\n");
}

function isMemoryQuestion(request: LlmRequest): boolean {
	const last = request.messages.at(-1);
	return last?.content.startsWith("下面这个问题用来检验") === true;
}

const MARKER = "插件已开启";

function fakeWriter(): LlmStreamingClient {
	const answer = (request: LlmRequest): string => {
		const on = joined(request).includes(MARKER);
		if (isMemoryQuestion(request)) {
			return on ? "他确实去过北边的矿镇。" : "没有这样的记录。";
		}
		const lastUser = request.messages.filter((m) => m.role === "user").at(-1);
		return `${on ? "开" : "关"}：${lastUser?.content ?? ""}`;
	};
	return {
		async complete(request) {
			return makeResult(answer(request));
		},
		stream(request) {
			const text = answer(request);
			return createEventStream(async (emit) => {
				emit({ type: "text_delta", delta: text });
				return makeResult(text);
			});
		},
	};
}

function fakeJudge(): LlmClient {
	return {
		async complete(request) {
			const content = joined(request);
			if (content.includes("两个版本")) {
				const first = content.slice(content.indexOf("续写甲："));
				const secondIndex = first.indexOf("续写乙：");
				const firstCandidate = first.slice(0, secondIndex);
				return makeResult(
					JSON.stringify({
						winner: firstCandidate.includes("开：") ? "B" : "A",
						reason: "测试固定偏向关闭侧",
					}),
				);
			}
			const consistent = !content.includes("确实");
			return makeResult(
				JSON.stringify({
					consistent,
					reason: consistent ? "与台账一致" : "捏造了不存在的事实",
				}),
			);
		},
	};
}

const fakePlugin: CoexistPluginAdapter = {
	id: "fake-compat",
	apply(input) {
		const history = input.providers.history;
		if (history === undefined) throw new Error("基础槽位缺少 history");
		const providers: ContextSlotProviders = {
			...input.providers,
			history: {
				provide() {
					return {
						messages: [{ role: "system", content: MARKER }],
						source: "fake-compat",
					};
				},
			},
		};
		return {
			providers,
			notes: ["测试插件只替换历史槽位"],
		};
	},
};

function questions(count: number): ForgettingStaticQuestion[] {
	return Array.from({ length: count }, (_, index) => {
		const fabricated = index < 5;
		return {
			id: `q${index + 1}`,
			story: STORY_ID,
			question: fabricated
				? `测试问题 ${index + 1}：他见过那个人吗？`
				: `测试问题 ${index + 1}：他去了哪里？`,
			answer: fabricated ? "没有见过" : "北边矿镇",
			evidenceNodes: [`${STORY_ID}:m0:s0`],
			kind: "memory",
			category: fabricated ? "abstention" : "extraction",
			fabricated,
		};
	});
}

async function buildCard(): Promise<CoexistCardSpec> {
	return {
		id: "card-1",
		storyId: STORY_ID,
		title: "共存测试",
		card: await parseCharacterCardFile(CARD_PATH),
		preset: null,
		chatPath: CHAT_PATH,
		messages: ["走一步。", "问一句。", "怀疑他。", "做个选择。", "继续往前。"],
		questions: questions(8),
	};
}

function baseConfig(card: CoexistCardSpec): CoexistRunConfig {
	return {
		pluginIds: ["fake-compat"],
		cards: [card],
		rounds: null,
		budgetTokens: 20_000,
		maxTokens: 512,
		temperature: 0.7,
		structuredOutput: "text-tags",
	};
}

describe("st-bench coexist", () => {
	it("runs the same cards with the plugin off and on and reports all four metrics", async () => {
		const dir = makeDir();
		const card = await buildCard();
		const comparisons = await runCoexistComparisons({
			config: baseConfig(card),
			plugins: [fakePlugin],
			writer: { client: fakeWriter(), model: "fake-writer" },
			judge: { client: fakeJudge(), model: "fake-judge" },
			runDir: path.join(dir, "runs"),
		});
		expect(comparisons).toHaveLength(1);
		const comparison = comparisons[0];
		if (comparison === undefined) throw new Error("没有对比结果");
		expect(comparison.cards).toBe(1);
		expect(comparison.roundsOff).toBe(5);
		expect(comparison.roundsOn).toBe(5);
		expect(comparison.failedRoundsOff).toBe(0);
		expect(comparison.failedRoundsOn).toBe(0);

		const off = comparison.variantsOff[0];
		const on = comparison.variantsOn[0];
		if (off === undefined || on === undefined) throw new Error("缺少变体结果");
		expect(off.rounds.every((round) => round.reply?.startsWith("关："))).toBe(
			true,
		);
		expect(on.rounds.every((round) => round.reply?.startsWith("开："))).toBe(
			true,
		);

		expect(
			off.questions.filter((q) => q.verdict === "consistent"),
		).toHaveLength(8);
		expect(
			on.questions.filter((q) => q.verdict === "contradicted"),
		).toHaveLength(8);

		const byMetric = new Map(
			comparison.metrics.map((metric) => [metric.metric, metric]),
		);
		expect(byMetric.get("contradiction")?.verdict).toBe("worse");
		expect(byMetric.get("contradiction")?.samplesOff).toBe(8);
		expect(byMetric.get("contradiction")?.samplesOn).toBe(8);
		expect(byMetric.get("fabricated")?.verdict).toBe("worse");
		expect(byMetric.get("fabricated")?.samplesOff).toBe(5);
		expect(byMetric.get("fabricated")?.on).toBe(1);
		expect(byMetric.get("blindWin")?.verdict).toBe("worse");
		expect(byMetric.get("blindWin")?.samplesOn).toBe(10);
		expect(byMetric.get("firstToken")?.verdict).toBe("same");
		expect(comparison.degraded.map((metric) => metric.metric).sort()).toEqual([
			"blindWin",
			"contradiction",
			"fabricated",
		]);

		const files = await writeCoexistOutputs(
			path.join(dir, "out"),
			comparison,
			baseConfig(card),
		);
		const report = readFileSync(files.reportFile, "utf8");
		expect(report).toContain("明显变差");
		expect(report).toContain("矛盾率");
		expect(report).toContain("样本量 8/8");
		expect(report).not.toContain("开：走一步。");
		const metrics = JSON.parse(readFileSync(files.metricsFile, "utf8")) as {
			readonly degraded: readonly string[];
		};
		expect(metrics.degraded).toEqual([
			"contradiction",
			"fabricated",
			"blindWin",
		]);
		expect(files.reportFile.endsWith(COEXIST_REPORT_FILE)).toBe(true);
		expect(files.metricsFile.endsWith(COEXIST_METRICS_FILE)).toBe(true);
	});

	it("rejects a plugin id that is not registered", async () => {
		const card = await buildCard();
		await expect(
			runCoexistComparisons({
				config: baseConfig(card),
				plugins: [],
				writer: { client: fakeWriter(), model: "fake-writer" },
				judge: { client: fakeJudge(), model: "fake-judge" },
				runDir: path.join(makeDir(), "runs"),
			}),
		).rejects.toThrow("没有注册兼容插件 fake-compat");
	});

	it("loads cards and questions from a config file", async () => {
		const dir = makeDir();
		const questionsPath = path.join(dir, "memory.jsonl");
		writeFileSync(
			questionsPath,
			`${questions(3)
				.map((question) =>
					JSON.stringify({
						id: question.id,
						story: question.story,
						askAtNode: `${STORY_ID}:m0:s0`,
						question: question.question,
						answer: question.answer,
						evidenceNodes: question.evidenceNodes,
						kind: "memory",
						category: question.category,
						fabricated: question.fabricated,
					}),
				)
				.join("\n")}\n`,
			"utf8",
		);
		writeFileSync(
			path.join(dir, "cards.json"),
			JSON.stringify({
				format: "dramaticer.st-bench-coexist",
				version: 1,
				writerModel: "fake-writer",
				judgeModel: "fake-judge",
				budgetTokens: 20_000,
				structuredOutput: "text-tags",
				plugins: ["fake-compat"],
				cards: [
					{
						id: "card-1",
						storyId: STORY_ID,
						title: "共存测试",
						card: CARD_PATH,
						chat: CHAT_PATH,
						messages: ["走一步。"],
						questions: questionsPath,
					},
				],
			}),
			"utf8",
		);
		writeFileSync(
			path.join(dir, "relative.json"),
			JSON.stringify({
				format: "dramaticer.st-bench-coexist",
				version: 1,
				writerModel: "fake-writer",
				structuredOutput: "text-tags",
				plugins: ["fake-compat"],
				cards: [
					{
						id: "card-1",
						storyId: STORY_ID,
						title: "共存测试",
						card: path.basename(CARD_PATH),
						chat: path.basename(CHAT_PATH),
						messages: ["走一步。"],
					},
				],
			}),
			"utf8",
		);
		const loaded = await loadCoexistConfig(path.join(dir, "cards.json"));
		expect(loaded.cards[0]?.cardPath).toBe(path.resolve(CARD_PATH));
		expect(loaded.cards[0]?.questionsPath).toBe(path.resolve(questionsPath));
		const cards = await loadCoexistCards(loaded);
		expect(cards[0]?.questions).toHaveLength(3);
		expect(cards[0]?.card.name).toBe("山神");
		expect(cards[0]?.messages).toEqual(["走一步。"]);

		const relative = await loadCoexistConfig(path.join(dir, "relative.json"));
		expect(relative.cards[0]?.cardPath).toBe(
			path.join(dir, path.basename(CARD_PATH)),
		);
	});
});
