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
import { parseCharacterCardFile } from "../src/character-card.js";
import type { ForgettingStaticQuestion } from "../src/evalset/forgetting.js";
import {
	COEXIST_REPORT_FILE,
	type CoexistCardSpec,
	type CoexistRunConfig,
	ST_BENCH_COEXIST_PLUGINS,
	runCoexistComparisons,
	writeCoexistOutputs,
} from "../src/st-bench/coexist.js";

const STORY_ID = "mvu-coexist";
const CARD_PATH = path.join(
	import.meta.dirname,
	"fixtures",
	"coexist-mvu-card.json",
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
	const dir = mkdtempSync(path.join(import.meta.dirname, ".tmp-mvu-coexist-"));
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

const UPDATE_BLOCK =
	'<UpdateVariable>\n<JSONPatch>[{"op":"delta","path":"/角色/好感度","value":1}]</JSONPatch>\n</UpdateVariable>';

function fakeWriter(requests: LlmRequest[]): LlmStreamingClient {
	const answer = (request: LlmRequest): string => {
		requests.push(request);
		if (isMemoryQuestion(request)) return "向导一直在原地。";
		const lastUser = request.messages.filter((m) => m.role === "user").at(-1);
		const marker = joined(request).includes('"mvu"') ? "开" : "关";
		return `${marker}：向导往前走了几步：${lastUser?.content ?? ""}。\n${UPDATE_BLOCK}`;
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
						reason: "带变量的一侧更贴合上下文",
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
	return Array.from({ length: count }, (_, index) => {
		const fabricated = index < 4;
		return {
			id: `q${index + 1}`,
			story: STORY_ID,
			question: fabricated
				? `测试问题 ${index + 1}：向导离开过小道吗？`
				: `测试问题 ${index + 1}：向导在做什么？`,
			answer: fabricated ? "没有离开" : "一直在原地",
			evidenceNodes: [],
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
		title: "MVU 共存测试",
		card: await parseCharacterCardFile(CARD_PATH),
		preset: null,
		chatPath: null,
		messages: ["走一步。", "问一句。", "怀疑他。", "做个选择。", "继续往前。"],
		questions: questions(8),
	};
}

function baseConfig(card: CoexistCardSpec): CoexistRunConfig {
	return {
		pluginIds: ["st-mvu"],
		cards: [card],
		rounds: null,
		budgetTokens: 20_000,
		maxTokens: 512,
		temperature: 0.7,
		structuredOutput: "text-tags",
	};
}

describe("st-mvu 共存评测", () => {
	it("注册在兼容插件列表里，并对每轮回复写台账、不改原文", async () => {
		expect(ST_BENCH_COEXIST_PLUGINS.map((plugin) => plugin.id)).toContain(
			"st-mvu",
		);
		const dir = makeDir();
		const card = await buildCard();
		const requests: LlmRequest[] = [];
		const config = baseConfig(card);
		const comparisons = await runCoexistComparisons({
			config,
			plugins: ST_BENCH_COEXIST_PLUGINS,
			writer: { client: fakeWriter(requests), model: "fake-writer" },
			judge: { client: fakeJudge(), model: "fake-judge" },
			runDir: path.join(dir, "runs"),
		});
		const comparison = comparisons[0];
		if (comparison === undefined) throw new Error("没有对比结果");
		expect(comparison.roundsOff).toBe(5);
		expect(comparison.roundsOn).toBe(5);
		expect(comparison.failedRoundsOff + comparison.failedRoundsOn).toBe(0);

		const off = comparison.variantsOff[0];
		const on = comparison.variantsOn[0];
		if (off === undefined || on === undefined) throw new Error("缺少变体结果");
		expect(on.notes.join("\n")).toContain("初始变量来自 2 处");
		expect(on.notes.filter((note) => note.includes("变量事实"))).toHaveLength(
			5,
		);
		expect(
			on.notes.filter((note) => note.includes("写入 1 条变量事实")),
		).toHaveLength(4);

		const byMetric = new Map(
			comparison.metrics.map((metric) => [metric.metric, metric]),
		);
		expect(
			[...byMetric.values()].map((metric) => metric.metric).sort(),
		).toEqual(["blindWin", "contradiction", "fabricated", "firstToken"]);
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
		expect(byMetric.get("fabricated")?.on).toBe(0);
		expect(byMetric.get("blindWin")?.on).toBe(1);
		expect(byMetric.get("blindWin")?.detail).toContain("平局 2 次");
		expect(byMetric.get("contradiction")?.verdict).toBe("same");
		expect(byMetric.get("fabricated")?.verdict).toBe("insufficient");
		expect(byMetric.get("blindWin")?.verdict).toBe("better");
		expect(byMetric.get("firstToken")?.verdict).toBe("same");
		expect(comparison.degraded).toEqual([]);

		const runDir = path.join(dir, "runs");
		const onStore = StoryStore.open(
			path.join(runDir, "st-mvu", "on", "card-1.db"),
		);
		const offStore = StoryStore.open(
			path.join(runDir, "baseline", "off", "card-1.db"),
		);
		try {
			const onHead = onStore.getHead(STORY_ID);
			const offHead = offStore.getHead(STORY_ID);
			if (onHead === null || offHead === null) throw new Error("缺少楼层");
			expect(readLedger(onStore, onHead.id, ["mvu"])).toEqual({
				角色: { 好感度: 15, 名字: "向导" },
				世界: { 天气: "雨后", 时间: "早晨" },
			});
			expect(offStore.getStateDiffs(offHead.id)).toEqual([]);
			expect(onHead.raw).toContain(UPDATE_BLOCK);
			expect(onHead.raw).toContain("向导往前走了几步：继续往前。");
			expect(onStore.getPathToHead(STORY_ID)).toHaveLength(10);
		} finally {
			onStore.close();
			offStore.close();
		}

		const files = await writeCoexistOutputs(
			path.join(dir, "out"),
			comparison,
			config,
		);
		expect(files.reportFile.endsWith(COEXIST_REPORT_FILE)).toBe(true);
		const report = readFileSync(files.reportFile, "utf8");
		expect(report).toContain("样本量（关/开）");
		expect(report).toContain("矛盾率");
		expect(report).toContain("编造回忆率");
		expect(report).toContain("盲测胜率");
		expect(report).toContain("首字延迟");
		expect(report).toContain("st-mvu：初始变量来自 2 处");
		expect(report).not.toContain("向导往前走了几步");
	});

	it("插件开启时第二轮的上下文包含台账里的 MVU 变量", async () => {
		const dir = makeDir();
		const card = await buildCard();
		const requests: LlmRequest[] = [];
		await runCoexistComparisons({
			config: baseConfig(card),
			plugins: ST_BENCH_COEXIST_PLUGINS,
			writer: { client: fakeWriter(requests), model: "fake-writer" },
			judge: { client: fakeJudge(), model: "fake-judge" },
			runDir: path.join(dir, "runs"),
		});
		const prompts = requests.filter((request) => !isMemoryQuestion(request));
		const withVariables = prompts.filter((request) =>
			joined(request).includes('"mvu"'),
		);
		const withoutVariables = prompts.filter(
			(request) => !joined(request).includes('"mvu"'),
		);
		expect(withVariables).toHaveLength(4);
		expect(withoutVariables).toHaveLength(6);
	});
});
