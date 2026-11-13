import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import { parseCharacterCardJson } from "../src/character-card.js";
import type { ForgettingStaticQuestion } from "../src/evalset/forgetting.js";
import { parsePresetJson } from "../src/preset.js";
import {
	COEXIST_REPORT_FILE,
	type CoexistCardSpec,
	type CoexistRunConfig,
	ST_BENCH_COEXIST_PLUGINS,
	runCoexistComparisons,
	writeCoexistOutputs,
} from "../src/st-bench/coexist.js";

const STORY_ID = "st-helper-coexist";
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
	const dir = mkdtempSync(
		path.join(import.meta.dirname, ".tmp-st-helper-coexist-"),
	);
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

const STATUS_BAR = "```html\n<div>状态栏</div>\n```";
const SCRIPT_MARKER = "调试脚本正文";

/**
 * 正文客户端同时记录每次请求的完整提示词，用来证明开启本插件后
 * 上下文逐字节不变。假客户端的正文由楼层里的 HTML 状态栏与固定前缀组成。
 */
function fakeWriter(prompts: string[]): LlmStreamingClient {
	const answer = (request: LlmRequest): string => {
		if (isMemoryQuestion(request)) return "北边矿镇";
		const lastUser = request.messages.filter((m) => m.role === "user").at(-1);
		return `回复：${lastUser?.content ?? ""}\n${STATUS_BAR}`;
	};
	return {
		async complete(request) {
			prompts.push(joined(request));
			return makeResult(answer(request));
		},
		stream(request) {
			prompts.push(joined(request));
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
			if (joined(request).includes("两个版本")) {
				return makeResult(
					JSON.stringify({ winner: "A", reason: "固定选择甲" }),
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
			index < 4
				? `测试问题 ${index + 1}：向导离开过矿镇吗？`
				: `测试问题 ${index + 1}：向导去了哪里？`,
		answer: index < 4 ? "没有离开" : "北边矿镇",
		evidenceNodes: [],
		kind: "memory",
		category: index < 4 ? "abstention" : "extraction",
		fabricated: index < 4,
	}));
}

function buildPreset() {
	return parsePresetJson(
		JSON.stringify({
			name: "助手共存预设",
			prompts: [
				{
					identifier: "main",
					name: "主提示",
					content: "{{char}} 的主提示正文",
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
			],
			prompt_order: [
				{
					character_id: 100001,
					order: ["main", "charDescription", "chatHistory"].map(
						(identifier) => ({ identifier, enabled: true }),
					),
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
				extensions: {
					tavern_helper: {
						scripts: [
							{
								id: "status-bar",
								name: "状态栏",
								content: SCRIPT_MARKER,
								enabled: true,
								type: "script",
							},
							{
								id: "disabled",
								name: "禁用脚本",
								content: "禁用脚本正文",
								enabled: false,
								type: "script",
							},
						],
					},
				},
			},
		}),
	);
}

function buildCardSpec(): CoexistCardSpec {
	return {
		id: "st-helper-card",
		storyId: STORY_ID,
		title: "st-helper-host 共存",
		card: buildCard(),
		preset: buildPreset(),
		chatPath: null,
		messages: ["走一步。", "去矿镇。", "问一句。", "怀疑他。", "继续往前。"],
		questions: questions(8),
	};
}

function baseConfig(card: CoexistCardSpec): CoexistRunConfig {
	return {
		pluginIds: ["st-helper-host"],
		cards: [card],
		rounds: null,
		budgetTokens: 20_000,
		maxTokens: 512,
		temperature: 0.7,
		structuredOutput: "text-tags",
	};
}

describe("st-helper-host 共存评测", () => {
	it("关闭与开启两组的提示词逐字节相同，四项指标有数字与样本量", async () => {
		const dir = makeDir();
		const card = buildCardSpec();
		expect(ST_BENCH_COEXIST_PLUGINS.map((plugin) => plugin.id)).toContain(
			"st-helper-host",
		);
		const prompts: string[] = [];
		const comparisons = await runCoexistComparisons({
			config: baseConfig(card),
			plugins: ST_BENCH_COEXIST_PLUGINS,
			writer: { client: fakeWriter(prompts), model: "fake-writer" },
			judge: { client: fakeJudge(), model: "fake-judge" },
			runDir: path.join(dir, "runs"),
		});
		expect(comparisons).toHaveLength(1);
		const comparison = comparisons[0];
		if (comparison === undefined) throw new Error("没有对比结果");
		expect(comparison.pluginId).toBe("st-helper-host");
		expect(comparison.cards).toBe(1);
		expect(comparison.roundsOff).toBe(5);
		expect(comparison.roundsOn).toBe(5);
		expect(comparison.failedRoundsOff).toBe(0);
		expect(comparison.failedRoundsOn).toBe(0);

		const off = comparison.variantsOff[0];
		const on = comparison.variantsOn[0];
		if (off === undefined || on === undefined) throw new Error("缺少变体结果");
		expect(off.rounds.map((round) => round.reply)).toEqual(
			on.rounds.map((round) => round.reply),
		);
		expect(off.notes.join("\n")).not.toContain("st-helper-host");
		expect(on.notes.join("\n")).toContain(
			"st-helper-host：脚本库 2 条（启用 1 条），状态栏渲染请求 1 次",
		);

		expect(prompts).toHaveLength(26);
		expect(prompts.slice(0, 13)).toEqual(prompts.slice(13));

		const byMetric = new Map(
			comparison.metrics.map((metric) => [metric.metric, metric]),
		);
		expect([...byMetric.keys()].sort()).toEqual([
			"blindWin",
			"contradiction",
			"fabricated",
			"firstToken",
		]);
		expect(byMetric.get("contradiction")?.samplesOff).toBe(8);
		expect(byMetric.get("contradiction")?.samplesOn).toBe(8);
		expect(byMetric.get("fabricated")?.samplesOff).toBe(4);
		expect(byMetric.get("fabricated")?.samplesOn).toBe(4);
		expect(byMetric.get("blindWin")?.samplesOn).toBe(10);
		expect(byMetric.get("firstToken")?.samplesOff).toBe(5);
		expect(byMetric.get("firstToken")?.samplesOn).toBe(5);
		expect(byMetric.get("contradiction")?.verdict).toBe("same");
		expect(byMetric.get("blindWin")?.verdict).toBe("same");
		expect(comparison.degraded).toEqual([]);

		const files = await writeCoexistOutputs(
			path.join(dir, "out"),
			comparison,
			baseConfig(card),
		);
		expect(files.reportFile.endsWith(COEXIST_REPORT_FILE)).toBe(true);
		const report = readFileSync(files.reportFile, "utf8");
		for (const heading of [
			"矛盾率",
			"编造回忆率",
			"盲测胜率",
			"首字延迟",
			"样本量（关/开）",
		]) {
			expect(report).toContain(heading);
		}
		for (const body of [
			STATUS_BAR,
			"状态栏</div>",
			SCRIPT_MARKER,
			"禁用脚本正文",
			"回复：走一步。",
			"主提示正文",
		]) {
			expect(report).not.toContain(body);
		}
	});
});
