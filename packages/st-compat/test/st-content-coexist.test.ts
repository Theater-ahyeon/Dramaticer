import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	createEventStream,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import {
	parseCharacterCardFile,
	parseCharacterCardJson,
} from "../src/character-card.js";
import type { ForgettingStaticQuestion } from "../src/evalset/forgetting.js";
import { parsePresetJson } from "../src/preset.js";
import {
	type CoexistCardSpec,
	type CoexistRunConfig,
	ST_BENCH_COEXIST_PLUGINS,
	loadCoexistCards,
	loadCoexistConfig,
	runCoexistComparisons,
	writeCoexistOutputs,
} from "../src/st-bench/coexist.js";

const STORY_ID = "st-content-story";
const CHAT_PATH = path.join(
	import.meta.dirname,
	"fixtures",
	"health-chat.jsonl",
);
const CARD_PATH = path.join(import.meta.dirname, "fixtures", "chat-card.json");
const PRESET_PATH = path.join(
	import.meta.dirname,
	"fixtures",
	"health-preset.json",
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
	const dir = mkdtempSync(path.join(import.meta.dirname, ".tmp-st-content-"));
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

const PRESET_MARKER = "预设主提示正文";

function fakeWriter(): LlmStreamingClient {
	const answer = (request: LlmRequest): string => {
		if (isMemoryQuestion(request)) return "北边矿镇";
		const on = joined(request).includes(PRESET_MARKER);
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
				return makeResult(
					JSON.stringify({ winner: "A", reason: "测试固定选择甲" }),
				);
			}
			return makeResult(
				JSON.stringify({ consistent: true, reason: "与台账一致" }),
			);
		},
	};
}

function questions(count: number): ForgettingStaticQuestion[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `q${index + 1}`,
		story: STORY_ID,
		question:
			index < 5
				? `测试问题 ${index + 1}：他见过那个人吗？`
				: `测试问题 ${index + 1}：他去了哪里？`,
		answer: index < 5 ? "没有见过" : "北边矿镇",
		evidenceNodes: [`${STORY_ID}:m0:s0`],
		kind: "memory",
		category: index < 5 ? "abstention" : "extraction",
		fabricated: index < 5,
	}));
}

function buildPreset() {
	return parsePresetJson(
		JSON.stringify({
			name: "共存预设",
			prompts: [
				{
					identifier: "main",
					name: "主提示",
					content: `${PRESET_MARKER} {{char}}`,
					role: "system",
					enabled: true,
					marker: false,
				},
				{
					identifier: "charDescription",
					name: "角色描述",
					content: "",
					role: "system",
					enabled: true,
					marker: true,
				},
				{
					identifier: "chatHistory",
					name: "历史",
					content: "",
					role: "system",
					enabled: true,
					marker: true,
				},
				{
					identifier: "worldInfoBefore",
					name: "世界书",
					content: "",
					role: "system",
					enabled: true,
					marker: true,
				},
				{
					identifier: "deepNote",
					name: "深度条目",
					content: "深度注入正文",
					role: "system",
					enabled: true,
					marker: false,
					injection_position: 1,
					injection_depth: 0,
				},
				{
					identifier: "summaryNote",
					name: "总结前文",
					content: "总结正文",
					role: "system",
					enabled: true,
					marker: false,
				},
			],
			prompt_order: [
				{
					character_id: 100001,
					order: [
						"main",
						"charDescription",
						"chatHistory",
						"worldInfoBefore",
						"deepNote",
						"summaryNote",
					].map((identifier) => ({ identifier, enabled: true })),
				},
			],
		}),
	);
}

function buildCard() {
	return parseCharacterCardJson(
		JSON.stringify({
			spec: "chara_card_v2",
			spec_version: "2.0",
			data: {
				name: "矿镇向导",
				description: "熟悉矿镇道路的人。",
				personality: "谨慎。",
				scenario: "矿镇入口。",
				first_mes: "跟我来。",
				mes_example: "",
				system_prompt: "",
				post_history_instructions: "",
				extensions: {},
				character_book: {
					entries: [
						{
							id: 1,
							keys: ["矿镇"],
							content: "矿镇设定正文",
							enabled: true,
						},
					],
				},
			},
		}),
	);
}

function buildCardSpec(): CoexistCardSpec {
	return {
		id: "st-content-card",
		storyId: STORY_ID,
		title: "st-content 共存",
		card: buildCard(),
		preset: buildPreset(),
		chatPath: CHAT_PATH,
		messages: ["走一步。", "去矿镇。", "问一句。", "怀疑他。", "继续往前。"],
		questions: questions(8),
	};
}

function baseConfig(card: CoexistCardSpec): CoexistRunConfig {
	return {
		pluginIds: ["st-content"],
		cards: [card],
		rounds: null,
		budgetTokens: 20_000,
		maxTokens: 512,
		temperature: 0.7,
		structuredOutput: "text-tags",
	};
}

describe("st-content 共存评测", () => {
	it("注册 st-content 适配器，开启与关闭两组各跑完并报告四项指标与样本量", async () => {
		const dir = makeDir();
		const card = buildCardSpec();
		expect(ST_BENCH_COEXIST_PLUGINS.map((plugin) => plugin.id)).toContain(
			"st-content",
		);
		const comparisons = await runCoexistComparisons({
			config: baseConfig(card),
			plugins: ST_BENCH_COEXIST_PLUGINS,
			writer: { client: fakeWriter(), model: "fake-writer" },
			judge: { client: fakeJudge(), model: "fake-judge" },
			runDir: path.join(dir, "runs"),
		});
		expect(comparisons).toHaveLength(1);
		const comparison = comparisons[0];
		if (comparison === undefined) throw new Error("没有对比结果");
		expect(comparison.pluginId).toBe("st-content");
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
		expect(off.notes).toEqual([]);
		expect(on.notes[0]).toContain("st-content：启用条目");
		expect(on.notes[0]).toContain("总结类 1 条");

		const byMetric = new Map(
			comparison.metrics.map((metric) => [metric.metric, metric]),
		);
		expect(byMetric.size).toBe(4);
		for (const metric of comparison.metrics) {
			expect(metric.samplesOff).toBeGreaterThanOrEqual(5);
			expect(metric.samplesOn).toBeGreaterThanOrEqual(5);
		}
		expect(byMetric.get("contradiction")?.off).toBe(0);
		expect(byMetric.get("contradiction")?.on).toBe(0);
		expect(byMetric.get("fabricated")?.off).toBe(0);
		expect(byMetric.get("blindWin")?.on).toBe(0.5);
		expect(byMetric.get("firstToken")?.off).not.toBeNull();

		const files = await writeCoexistOutputs(
			path.join(dir, "out"),
			comparison,
			baseConfig(card),
		);
		const report = readFileSync(files.reportFile, "utf8");
		expect(report).toContain("插件说明");
		expect(report).toContain("st-content：启用条目");
		for (const body of [
			PRESET_MARKER,
			"深度注入正文",
			"总结正文",
			"矿镇设定正文",
			"开：走一步。",
		]) {
			expect(report).not.toContain(body);
		}
		const metrics = JSON.parse(readFileSync(files.metricsFile, "utf8")) as {
			readonly plugin: string;
			readonly degraded: readonly string[];
		};
		expect(metrics.plugin).toBe("st-content");
		expect(Array.isArray(metrics.degraded)).toBe(true);
	});

	it("配置里的 preset 会被读成预设对象", async () => {
		const dir = makeDir();
		writeFileSync(
			path.join(dir, "config.json"),
			JSON.stringify({
				format: "dramaticer.st-bench-coexist",
				version: 1,
				writerModel: "fake-writer",
				structuredOutput: "text-tags",
				plugins: ["st-content"],
				cards: [
					{
						id: "card-1",
						storyId: STORY_ID,
						title: "共存测试",
						card: CARD_PATH,
						preset: PRESET_PATH,
						chat: CHAT_PATH,
						messages: ["走一步。"],
					},
				],
			}),
			"utf8",
		);
		const loaded = await loadCoexistConfig(path.join(dir, "config.json"));
		expect(loaded.cards[0]?.presetPath).toBe(path.resolve(PRESET_PATH));
		const cards = await loadCoexistCards(loaded);
		expect(cards[0]?.preset?.name).toBe("测试预设");
		expect(cards[0]?.preset?.prompts).toHaveLength(2);
	});

	it("st-content 适配器缺少预设时直接报错", async () => {
		const card = buildCardSpec();
		await expect(
			runCoexistComparisons({
				config: baseConfig({ ...card, preset: null }),
				plugins: ST_BENCH_COEXIST_PLUGINS,
				writer: { client: fakeWriter(), model: "fake-writer" },
				judge: { client: fakeJudge(), model: "fake-judge" },
				runDir: path.join(makeDir(), "runs"),
			}),
		).rejects.toThrow("st-content 共存评测需要为卡 矿镇向导 配置预设文件");
	});
});
