import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	StoryStore,
	createEventStream,
	readLedger,
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

const STORY_ID = "st-ejs-coexist";
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
		path.join(import.meta.dirname, ".tmp-st-ejs-coexist-"),
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

/** 只有 EJS 执行之后才会出现的标记；模板原文里被拆成两个字符串。 */
const RENDERED_MARKER = "EJS渲染成功";

function fakeWriter(): LlmStreamingClient {
	const answer = (request: LlmRequest): string => {
		if (isMemoryQuestion(request)) return "北边矿镇";
		const on = joined(request).includes(RENDERED_MARKER);
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
						winner: firstCandidate.includes("开：") ? "A" : "B",
						reason: "EJS 渲染后的一侧更贴合上下文",
					}),
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
			name: "EJS 共存预设",
			prompts: [
				{
					identifier: "main",
					name: "主提示",
					content:
						"<%= 'EJS' + '渲染成功' %>：{{char}}\n" +
						"<% const hp = Number(getvar('stat_data.hp') ?? 0); setvar('stat_data.hp', hp + 1); %>" +
						"预设主提示正文",
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
					content: "深度<%= '注入' %>正文",
					role: "system",
					enabled: true,
					marker: false,
					injection_position: 1,
					injection_depth: 0,
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
							keys: [],
							content: "矿镇 <%= '设定' %>正文",
							enabled: true,
							constant: true,
						},
						{
							id: 2,
							keys: [],
							comment: "[initvar]",
							content: '{"stat_data":{"hp":0}}',
							enabled: true,
							constant: true,
						},
					],
				},
			},
		}),
	);
}

function buildCardSpec(): CoexistCardSpec {
	return {
		id: "st-ejs-card",
		storyId: STORY_ID,
		title: "st-ejs 共存",
		card: buildCard(),
		preset: buildPreset(),
		chatPath: null,
		messages: ["走一步。", "去矿镇。", "问一句。", "怀疑他。", "继续往前。"],
		questions: questions(8),
	};
}

function baseConfig(card: CoexistCardSpec): CoexistRunConfig {
	return {
		pluginIds: ["st-ejs"],
		cards: [card],
		rounds: null,
		budgetTokens: 20_000,
		maxTokens: 512,
		temperature: 0.7,
		structuredOutput: "text-tags",
	};
}

describe("st-ejs 共存评测", () => {
	it("关闭组保留同一份 ST 内容的模板原文，开启组执行 EJS 并报告四项指标", async () => {
		const dir = makeDir();
		const card = buildCardSpec();
		expect(ST_BENCH_COEXIST_PLUGINS.map((plugin) => plugin.id)).toContain(
			"st-ejs",
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
		expect(comparison.pluginId).toBe("st-ejs");
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
		expect(on.notes.join("\n")).toContain("st-ejs：");
		expect(on.notes.join("\n")).toContain("段预设静态模板");
		expect(on.notes.join("\n")).not.toContain("<%");

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
		expect(byMetric.get("contradiction")?.off).toBe(0);
		expect(byMetric.get("contradiction")?.on).toBe(0);
		expect(byMetric.get("fabricated")?.off).toBe(0);
		expect(byMetric.get("blindWin")?.on).toBe(1);
		expect(byMetric.get("blindWin")?.verdict).toBe("better");
		expect(byMetric.get("contradiction")?.verdict).toBe("same");
		expect(comparison.degraded).toEqual([]);

		const runDir = path.join(dir, "runs");
		const onStore = StoryStore.open(
			path.join(runDir, "st-ejs", "on", "st-ejs-card.db"),
		);
		const offStore = StoryStore.open(
			path.join(runDir, "st-ejs", "off", "st-ejs-card.db"),
		);
		try {
			const onPath = onStore.getPathToHead(STORY_ID);
			const offPath = offStore.getPathToHead(STORY_ID);
			const onLastUser = onPath.filter((node) => node.role === "user").at(-1);
			const offLastUser = offPath.filter((node) => node.role === "user").at(-1);
			if (onLastUser === undefined || offLastUser === undefined) {
				throw new Error("缺少玩家楼层");
			}
			expect(readLedger(onStore, onLastUser.id, ["mvu"])).toEqual({
				stat_data: { hp: 4 },
			});
			expect(readLedger(offStore, offLastUser.id, ["mvu"])).toBeUndefined();
			for (const node of onPath) {
				expect(node.raw).not.toContain(RENDERED_MARKER);
			}
		} finally {
			onStore.close();
			offStore.close();
		}

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
			"预设主提示正文",
			"深度注入正文",
			"矿镇 设定正文",
			RENDERED_MARKER,
			"开：走一步。",
		]) {
			expect(report).not.toContain(body);
		}
	});
});
