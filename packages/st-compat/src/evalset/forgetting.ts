import {
	type ChatProfile,
	type ContextSlotProviders,
	type ContextTemplate,
	type LlmClient,
	type LlmUsage,
	type StoryStore,
	isChatProfile,
	isJsonObject,
} from "@dramaticer/core";
import { readProbeQuestionFile } from "./benchmark.js";
import type {
	JudgedQuestionAnswer,
	JudgedQuestionSpec,
} from "./memory-judged.js";
import { answerJudgedQuestion } from "./memory-judged.js";
import {
	MEMORY_QUESTION_CATEGORIES,
	type MemoryQuestionCategory,
	memoryQuestionCategoryLabel,
	readMemoryQuestionFile,
} from "./memory-questions.js";
import type { PlaytestRecord } from "./playtest.js";
import type { ProbeVerdict } from "./probe.js";

/** 最深一层比最浅一层高出这么多才判为“遗忘上升”。 */
export const FORGETTING_RISE_MARGIN = 0.05;

export const FORGETTING_DEPTH_LAYERS = ["100-199", "200-299", "300+"] as const;

export type ForgettingDepthLayer =
	| (typeof FORGETTING_DEPTH_LAYERS)[number]
	| "<100";

/** 跑后提问的题目；记忆题来自 question 文件，探针题来自 benchmark 的 probe 文件。 */
export interface ForgettingStaticQuestion extends JudgedQuestionSpec {
	readonly story: string;
	readonly kind: "memory" | "probe";
	readonly category: MemoryQuestionCategory | null;
}

export interface ForgettingQuestionRecord {
	readonly kind: "memory" | "probe";
	readonly id: string;
	readonly category: MemoryQuestionCategory | null;
	readonly status: "done" | "skipped" | "failed";
	readonly askedAtNode: string;
	readonly answer: string | null;
	readonly verdict: ProbeVerdict | null;
	/** 题目本身是编造题。 */
	readonly fabricatedQuestion: boolean;
	/** 编造题被判为矛盾，计一次编造。 */
	readonly fabricated: boolean;
	readonly reason: string | null;
	readonly judgeAttempts: number;
	readonly error: string | null;
	readonly answerUsage: LlmUsage | null;
	readonly judgeUsage: LlmUsage | null;
}

export interface ForgettingInRunProbes {
	readonly done: number;
	readonly consistent: number;
	readonly contradicted: number;
	readonly unknown: number;
	readonly failed: number;
	readonly skipped: number;
}

/** 一次运行写成的 JSON；事实来源是最终 head 与逐题判定。 */
export interface ForgettingRunResult {
	readonly story: string;
	readonly headNodeId: string;
	readonly profile: ChatProfile;
	readonly model: string;
	readonly userModel: string;
	readonly judgeModel: string;
	readonly seed: number;
	readonly startDepth: number;
	readonly endDepth: number;
	readonly rounds: number;
	readonly completedRounds: number;
	readonly failedRounds: number;
	readonly generatedAt: string;
	readonly playtestPath: string | null;
	readonly inRunProbes: ForgettingInRunProbes;
	readonly questions: readonly ForgettingQuestionRecord[];
}

export interface RunForgettingQuestionsInput {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly askAtNode: string;
	readonly questions: readonly ForgettingStaticQuestion[];
	readonly template: ContextTemplate;
	readonly providers: ContextSlotProviders;
	readonly budgetTokens: number;
	readonly assistant: { readonly client: LlmClient; readonly model: string };
	readonly judge: {
		readonly client: LlmClient;
		readonly model: string;
		readonly maxTokens?: number;
	};
	readonly maxTokens?: number;
	readonly temperature?: number;
}

/**
 * 读取跑后提问题目；记忆题与探针题必须属于同一个故事，id 不能重复。
 */
export async function readForgettingQuestionFiles(options: {
	readonly storyId: string;
	readonly memoryPath: string | null;
	readonly probePath: string | null;
}): Promise<ForgettingStaticQuestion[]> {
	if (options.memoryPath === null && options.probePath === null) {
		throw new Error("至少要提供一个记忆题或探针题文件");
	}
	const questions: ForgettingStaticQuestion[] = [];
	if (options.memoryPath !== null) {
		for (const question of await readMemoryQuestionFile(options.memoryPath)) {
			questions.push({
				id: question.id,
				story: question.story,
				question: question.question,
				answer: question.answer,
				evidenceNodes: question.evidenceNodes,
				kind: "memory",
				category: question.category,
				fabricated: question.fabricated,
			});
		}
	}
	if (options.probePath !== null) {
		for (const question of await readProbeQuestionFile(options.probePath)) {
			questions.push({
				id: question.id,
				story: question.story,
				question: question.question,
				answer: question.answer,
				evidenceNodes: question.evidenceNodes,
				kind: "probe",
				category: null,
				fabricated: false,
			});
		}
	}
	const seen = new Set<string>();
	for (const question of questions) {
		if (question.story !== options.storyId) {
			throw new Error(
				`题目 ${question.id} 属于故事 ${question.story}，与 ${options.storyId} 不一致`,
			);
		}
		if (seen.has(question.id)) {
			throw new Error(`题目 id 重复：${question.id}`);
		}
		seen.add(question.id);
	}
	return questions;
}

/** 统计试玩里的一致性探针；失败轮次没有探针。 */
export function summarizeInRunProbes(
	records: readonly PlaytestRecord[],
): ForgettingInRunProbes {
	let done = 0;
	let consistent = 0;
	let contradicted = 0;
	let unknown = 0;
	let failed = 0;
	let skipped = 0;
	for (const record of records) {
		if (record.status !== "done" || record.probe === null) continue;
		const probe = record.probe;
		if (probe.status === "done") {
			done += 1;
			if (probe.verdict === "consistent") consistent += 1;
			else if (probe.verdict === "contradicted") contradicted += 1;
			else unknown += 1;
		} else if (probe.status === "failed") {
			failed += 1;
		} else {
			skipped += 1;
		}
	}
	return { done, consistent, contradicted, unknown, failed, skipped };
}

export function forgettingDepthLayer(depth: number): ForgettingDepthLayer {
	if (!Number.isInteger(depth) || depth < 0) {
		throw new Error(`楼层深度必须是非负整数，收到 ${depth}`);
	}
	if (depth < 100) return "<100";
	if (depth < 200) return "100-199";
	if (depth < 300) return "200-299";
	return "300+";
}

/**
 * 在最终 head 上逐题提问。证据楼层不在当前路径上的题目记为跳过，
 * 不进入矛盾率与编造率的分母。
 */
export async function runForgettingQuestions(
	input: RunForgettingQuestionsInput,
): Promise<ForgettingQuestionRecord[]> {
	const path = input.store.getPathToHead(input.storyId);
	if (path.length === 0) {
		throw new Error(`故事 ${input.storyId} 没有楼层`);
	}
	const head = path.at(-1);
	if (head === undefined || head.id !== input.askAtNode) {
		throw new Error(`提问楼层 ${input.askAtNode} 不是当前 head`);
	}
	const onPath = new Set(path.map((node) => node.id));
	const seen = new Set<string>();
	const records: ForgettingQuestionRecord[] = [];
	for (const question of input.questions) {
		if (question.story !== input.storyId) {
			throw new Error(
				`题目 ${question.id} 属于故事 ${question.story}，与 ${input.storyId} 不一致`,
			);
		}
		if (seen.has(question.id)) {
			throw new Error(`题目 id 重复：${question.id}`);
		}
		seen.add(question.id);
		for (const evidence of question.evidenceNodes) {
			if (!input.store.getNode(evidence)) {
				throw new Error(`题目 ${question.id} 的证据楼层不存在：${evidence}`);
			}
		}
		if (!question.evidenceNodes.every((nodeId) => onPath.has(nodeId))) {
			records.push(
				skippedRecord(
					question,
					input.askAtNode,
					"证据楼层不在当前路径上，无法构成回忆题",
				),
			);
			continue;
		}
		const answer = await answerJudgedQuestion({
			store: input.store,
			storyId: input.storyId,
			askAtNode: input.askAtNode,
			spec: question,
			template: input.template,
			providers: input.providers,
			budgetTokens: input.budgetTokens,
			assistant: input.assistant,
			judge: input.judge,
			maxTokens: input.maxTokens,
			temperature: input.temperature,
		});
		records.push(toRecord(question, input.askAtNode, answer));
	}
	return records;
}

function skippedRecord(
	question: ForgettingStaticQuestion,
	askedAtNode: string,
	reason: string,
): ForgettingQuestionRecord {
	return {
		kind: question.kind,
		id: question.id,
		category: question.category,
		status: "skipped",
		askedAtNode,
		answer: null,
		verdict: null,
		fabricatedQuestion: question.fabricated,
		fabricated: false,
		reason,
		judgeAttempts: 0,
		error: null,
		answerUsage: null,
		judgeUsage: null,
	};
}

function toRecord(
	question: ForgettingStaticQuestion,
	askedAtNode: string,
	answer: JudgedQuestionAnswer,
): ForgettingQuestionRecord {
	return {
		kind: question.kind,
		id: question.id,
		category: question.category,
		status: answer.status,
		askedAtNode,
		answer: answer.answer,
		verdict: answer.verdict,
		fabricatedQuestion: question.fabricated,
		fabricated: answer.fabricated,
		reason: answer.reason,
		judgeAttempts: answer.judgeAttempts,
		error: answer.error,
		answerUsage: answer.answerUsage,
		judgeUsage: answer.judgeUsage,
	};
}

export interface ForgettingQuestionCounts {
	readonly questions: number;
	readonly consistent: number;
	readonly contradicted: number;
	readonly unknown: number;
	readonly skipped: number;
	readonly failed: number;
	readonly fabricatedQuestions: number;
	readonly fabricatedJudged: number;
	readonly fabricated: number;
}

export interface ForgettingLayerScore extends ForgettingQuestionCounts {
	readonly depthLayer: ForgettingDepthLayer;
	readonly profile: ChatProfile;
	readonly runCount: number;
	readonly rounds: number;
	readonly contradictionRate: number;
	readonly hitRate: number;
	readonly fabricatedRate: number;
	readonly inRunProbeJudged: number;
	readonly inRunProbeContradicted: number;
	readonly inRunProbeContradictionRate: number;
}

export interface ForgettingTrendLayer {
	readonly depthLayer: ForgettingDepthLayer;
	readonly questionCount: number;
	readonly consistent: number;
	readonly contradicted: number;
	readonly contradictionRate: number;
}

export interface ForgettingTrend {
	readonly profile: ChatProfile;
	readonly layers: readonly ForgettingTrendLayer[];
	/** 同题对照里最深层比最浅层高出的百分点比例；样本不足时为 null。 */
	readonly margin: number | null;
	readonly rising: boolean | null;
}

export interface ForgettingSummary {
	readonly runCount: number;
	readonly layers: readonly ForgettingLayerScore[];
	readonly trends: readonly ForgettingTrend[];
}

interface MutableCounts {
	questions: number;
	consistent: number;
	contradicted: number;
	unknown: number;
	skipped: number;
	failed: number;
	fabricatedQuestions: number;
	fabricatedJudged: number;
	fabricated: number;
}

function emptyCounts(): MutableCounts {
	return {
		questions: 0,
		consistent: 0,
		contradicted: 0,
		unknown: 0,
		skipped: 0,
		failed: 0,
		fabricatedQuestions: 0,
		fabricatedJudged: 0,
		fabricated: 0,
	};
}

function addQuestion(
	counts: MutableCounts,
	record: ForgettingQuestionRecord,
): void {
	counts.questions += 1;
	if (record.fabricatedQuestion) counts.fabricatedQuestions += 1;
	if (record.status === "skipped") {
		counts.skipped += 1;
		return;
	}
	if (record.status === "failed") {
		counts.failed += 1;
		return;
	}
	if (record.verdict === "consistent") counts.consistent += 1;
	else if (record.verdict === "contradicted") counts.contradicted += 1;
	else counts.unknown += 1;
	if (record.fabricatedQuestion && record.verdict !== "unknown") {
		counts.fabricatedJudged += 1;
	}
	if (record.fabricatedQuestion && record.verdict === "contradicted") {
		counts.fabricated += 1;
	}
}

function rate(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : numerator / denominator;
}

export function summarizeForgettingRuns(
	runs: readonly ForgettingRunResult[],
): ForgettingSummary {
	if (runs.length === 0) {
		throw new Error("没有可汇总的运行结果");
	}
	const groups = new Map<
		string,
		{
			readonly depthLayer: ForgettingDepthLayer;
			readonly profile: ChatProfile;
			runCount: number;
			rounds: number;
			counts: MutableCounts;
			inRunProbeJudged: number;
			inRunProbeContradicted: number;
			readonly records: ForgettingQuestionRecord[];
		}
	>();
	for (const run of runs) {
		const depthLayer = forgettingDepthLayer(run.startDepth);
		const key = `${depthLayer}|${run.profile}`;
		let group = groups.get(key);
		if (group === undefined) {
			group = {
				depthLayer,
				profile: run.profile,
				runCount: 0,
				rounds: 0,
				counts: emptyCounts(),
				inRunProbeJudged: 0,
				inRunProbeContradicted: 0,
				records: [],
			};
			groups.set(key, group);
		}
		group.runCount += 1;
		group.rounds += run.rounds;
		group.inRunProbeJudged +=
			run.inRunProbes.consistent + run.inRunProbes.contradicted;
		group.inRunProbeContradicted += run.inRunProbes.contradicted;
		for (const record of run.questions) {
			addQuestion(group.counts, record);
			group.records.push(record);
		}
	}
	const layers: ForgettingLayerScore[] = [];
	for (const group of groups.values()) {
		const counts = group.counts;
		layers.push({
			...counts,
			depthLayer: group.depthLayer,
			profile: group.profile,
			runCount: group.runCount,
			rounds: group.rounds,
			contradictionRate: rate(
				counts.contradicted,
				counts.consistent + counts.contradicted,
			),
			hitRate: rate(counts.consistent, counts.consistent + counts.contradicted),
			fabricatedRate: rate(counts.fabricated, counts.fabricatedJudged),
			inRunProbeJudged: group.inRunProbeJudged,
			inRunProbeContradicted: group.inRunProbeContradicted,
			inRunProbeContradictionRate: rate(
				group.inRunProbeContradicted,
				group.inRunProbeJudged,
			),
		});
	}
	layers.sort(
		(left, right) =>
			depthOrder(left.depthLayer) - depthOrder(right.depthLayer) ||
			left.profile.localeCompare(right.profile),
	);
	return {
		runCount: runs.length,
		layers,
		trends: computeTrends(groups),
	};
}

function depthOrder(layer: ForgettingDepthLayer): number {
	if (layer === "<100") return 0;
	if (layer === "100-199") return 1;
	if (layer === "200-299") return 2;
	return 3;
}

function computeTrends(
	groups: ReadonlyMap<
		string,
		{
			readonly depthLayer: ForgettingDepthLayer;
			readonly profile: ChatProfile;
			readonly records: readonly ForgettingQuestionRecord[];
		}
	>,
): ForgettingTrend[] {
	const byProfile = new Map<
		ChatProfile,
		Map<ForgettingDepthLayer, ForgettingQuestionRecord[]>
	>();
	for (const group of groups.values()) {
		let layers = byProfile.get(group.profile);
		if (layers === undefined) {
			layers = new Map();
			byProfile.set(group.profile, layers);
		}
		const existing = layers.get(group.depthLayer) ?? [];
		existing.push(...group.records);
		layers.set(group.depthLayer, existing);
	}
	const trends: ForgettingTrend[] = [];
	for (const [profile, layersByName] of byProfile) {
		const askedByLayer = new Map<ForgettingDepthLayer, Set<string>>();
		for (const [layer, records] of layersByName) {
			askedByLayer.set(
				layer,
				new Set(
					records
						.filter((record) => record.status === "done")
						.map((record) => record.id),
				),
			);
		}
		const ordered = [...layersByName.keys()].sort(
			(left, right) => depthOrder(left) - depthOrder(right),
		);
		if (ordered.length < 2) {
			trends.push({
				profile,
				layers: [],
				margin: null,
				rising: null,
			});
			continue;
		}
		const common = new Set<string>();
		const first = askedByLayer.get(ordered[0] as ForgettingDepthLayer);
		if (first !== undefined) {
			for (const id of first) {
				if (
					ordered.every((layer) => askedByLayer.get(layer)?.has(id) === true)
				) {
					common.add(id);
				}
			}
		}
		const trendLayers: ForgettingTrendLayer[] = [];
		for (const layer of ordered) {
			const records = (layersByName.get(layer) ?? []).filter(
				(record) => record.status === "done" && common.has(record.id),
			);
			let consistent = 0;
			let contradicted = 0;
			for (const record of records) {
				if (record.verdict === "consistent") consistent += 1;
				else if (record.verdict === "contradicted") contradicted += 1;
			}
			trendLayers.push({
				depthLayer: layer,
				questionCount: common.size,
				consistent,
				contradicted,
				contradictionRate: rate(contradicted, consistent + contradicted),
			});
		}
		const shallowest = trendLayers[0];
		const deepest = trendLayers.at(-1);
		const judgedShallow =
			shallowest === undefined
				? 0
				: shallowest.consistent + shallowest.contradicted;
		const judgedDeep =
			deepest === undefined ? 0 : deepest.consistent + deepest.contradicted;
		const margin =
			shallowest === undefined || deepest === undefined
				? null
				: deepest.contradictionRate - shallowest.contradictionRate;
		trends.push({
			profile,
			layers: trendLayers,
			margin: judgedShallow === 0 || judgedDeep === 0 ? null : margin,
			rising:
				margin === null || judgedShallow === 0 || judgedDeep === 0
					? null
					: margin > FORGETTING_RISE_MARGIN,
		});
	}
	trends.sort((left, right) => left.profile.localeCompare(right.profile));
	return trends;
}

function percent(numerator: number, denominator: number): string {
	return denominator === 0
		? "—"
		: `${((numerator / denominator) * 100).toFixed(1)}%（${numerator}/${denominator}）`;
}

function cell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * 私有版附故事、楼层与逐题明细；统计版只有深度层、档位、数字与模型别名。
 */
export function renderForgettingReport(
	summary: ForgettingSummary,
	options: {
		readonly privateDetails: boolean;
		readonly runs?: readonly ForgettingRunResult[];
	},
): string {
	const lines: string[] = [
		"# 长对话遗忘评测",
		"",
		`分层按分支点所在路径深度：100–199、200–299、300 以上。矛盾率的分母是一致加矛盾，编造率的分母是编造题里裁判可判定的数量，跳过与失败单列、不进入分母。同题对照只统计在每一层都被实际提问的题目；最深一层比最浅一层高 ${(FORGETTING_RISE_MARGIN * 100).toFixed(0)} 个百分点以上才判「上升」。`,
		"",
		"## 分层结果",
		"",
		"| 深度层 | 档位 | 运行 | 轮数 | 静态题 | 一致 | 矛盾 | 无法判断 | 跳过 | 失败 | 矛盾率 | 命中率 | 编造题 | 编造 | 编造率 | 运行内探针矛盾率 |",
		"| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
	];
	for (const layer of summary.layers) {
		lines.push(
			`| ${layer.depthLayer} | ${layer.profile} | ${layer.runCount} | ${layer.rounds} | ${layer.questions} | ${layer.consistent} | ${layer.contradicted} | ${layer.unknown} | ${layer.skipped} | ${layer.failed} | ${percent(layer.contradicted, layer.consistent + layer.contradicted)} | ${percent(layer.consistent, layer.consistent + layer.contradicted)} | ${layer.fabricatedQuestions} | ${layer.fabricated} | ${percent(layer.fabricated, layer.fabricatedJudged)} | ${percent(layer.inRunProbeContradicted, layer.inRunProbeJudged)} |`,
		);
	}
	lines.push("", "## 遗忘趋势（同题对照）", "");
	for (const trend of summary.trends) {
		const verdict =
			trend.rising === null ? "样本不足" : trend.rising ? "上升" : "未上升";
		const margin =
			trend.margin === null
				? "—"
				: `${(trend.margin * 100).toFixed(1)} 个百分点`;
		lines.push(`- ${trend.profile}：${verdict}（最深层减最浅层 ${margin}）`);
		for (const layer of trend.layers) {
			lines.push(
				`  - ${layer.depthLayer}：同题 ${layer.questionCount}，矛盾率 ${percent(layer.contradicted, layer.consistent + layer.contradicted)}`,
			);
		}
	}
	if (!options.privateDetails) return `${lines.join("\n")}\n`;
	lines.push("", "## 运行明细", "");
	for (const run of options.runs ?? []) {
		lines.push(
			`### ${run.story} · ${run.profile} · 深度 ${forgettingDepthLayer(run.startDepth)}`,
			"",
			`- 起点楼层：${run.headNodeId}`,
			`- 起止深度：${run.startDepth} → ${run.endDepth}`,
			`- 轮次：${run.completedRounds}/${run.rounds}，失败 ${run.failedRounds}`,
			`- 模型：写作 ${run.model}，模拟用户 ${run.userModel}，裁判 ${run.judgeModel}`,
			`- 生成时间：${run.generatedAt}`,
			`- 试玩记录：${run.playtestPath ?? "—"}`,
		);
		for (const record of run.questions) {
			const verdict =
				record.status === "skipped"
					? "跳过"
					: record.status === "failed"
						? "失败"
						: record.verdict === "consistent"
							? "一致"
							: record.verdict === "contradicted"
								? record.fabricated
									? "编造"
									: "矛盾"
								: "无法判断";
			const category =
				record.category === null
					? "探针"
					: memoryQuestionCategoryLabel(record.category);
			lines.push(
				`- ${record.id}（${category}，${verdict}）：${cell(record.answer ?? record.error ?? "")}`,
			);
		}
		lines.push("");
	}
	return `${lines.join("\n")}\n`;
}

const VERDICTS: readonly ProbeVerdict[] = [
	"consistent",
	"contradicted",
	"unknown",
];

/** 读回运行 JSON；字段缺失或类型不符直接失败。 */
export function parseForgettingRun(value: unknown): ForgettingRunResult {
	if (!isJsonObject(value)) {
		throw new Error("遗忘评测结果必须是对象");
	}
	const story = requireString(value.story, "story");
	const headNodeId = requireString(value.headNodeId, "headNodeId");
	const profile = value.profile;
	if (typeof profile !== "string" || !isChatProfile(profile)) {
		throw new Error(`profile 只接受 native 或 naive，收到 ${String(profile)}`);
	}
	const model = requireString(value.model, "model");
	const userModel = requireString(value.userModel, "userModel");
	const judgeModel = requireString(value.judgeModel, "judgeModel");
	const seed = requireInteger(value.seed, "seed", 0);
	const startDepth = requireInteger(value.startDepth, "startDepth", 0);
	const endDepth = requireInteger(value.endDepth, "endDepth", 0);
	const rounds = requireInteger(value.rounds, "rounds", 1);
	const completedRounds = requireInteger(
		value.completedRounds,
		"completedRounds",
		0,
	);
	const failedRounds = requireInteger(value.failedRounds, "failedRounds", 0);
	const generatedAt = requireString(value.generatedAt, "generatedAt");
	const playtestPath =
		value.playtestPath === null
			? null
			: requireString(value.playtestPath, "playtestPath");
	const probes = value.inRunProbes;
	if (!isJsonObject(probes)) {
		throw new Error("inRunProbes 必须是对象");
	}
	const inRunProbes: ForgettingInRunProbes = {
		done: requireInteger(probes.done, "inRunProbes.done", 0),
		consistent: requireInteger(probes.consistent, "inRunProbes.consistent", 0),
		contradicted: requireInteger(
			probes.contradicted,
			"inRunProbes.contradicted",
			0,
		),
		unknown: requireInteger(probes.unknown, "inRunProbes.unknown", 0),
		failed: requireInteger(probes.failed, "inRunProbes.failed", 0),
		skipped: requireInteger(probes.skipped, "inRunProbes.skipped", 0),
	};
	if (!Array.isArray(value.questions)) {
		throw new Error("questions 必须是数组");
	}
	const questions = value.questions.map((item, index) =>
		parseQuestionRecord(item, `questions[${index}]`),
	);
	return {
		story,
		headNodeId,
		profile,
		model,
		userModel,
		judgeModel,
		seed,
		startDepth,
		endDepth,
		rounds,
		completedRounds,
		failedRounds,
		generatedAt,
		playtestPath,
		inRunProbes,
		questions,
	};
}

function parseQuestionRecord(
	value: unknown,
	label: string,
): ForgettingQuestionRecord {
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	const kind = value.kind;
	if (kind !== "memory" && kind !== "probe") {
		throw new Error(`${label} 的 kind 只接受 memory 或 probe`);
	}
	const status = value.status;
	if (status !== "done" && status !== "skipped" && status !== "failed") {
		throw new Error(
			`${label} 的 status 只接受 done、skipped、failed，收到 ${String(status)}`,
		);
	}
	const category =
		value.category === null
			? null
			: requireString(value.category, `${label}.category`);
	if (
		category !== null &&
		!(MEMORY_QUESTION_CATEGORIES as readonly string[]).includes(category)
	) {
		throw new Error(`${label} 的 category 不认识：${category}`);
	}
	const verdict =
		value.verdict === null
			? null
			: requireString(value.verdict, `${label}.verdict`);
	if (verdict !== null && !(VERDICTS as readonly string[]).includes(verdict)) {
		throw new Error(`${label} 的 verdict 不认识：${verdict}`);
	}
	return {
		kind,
		id: requireString(value.id, `${label}.id`),
		category: category as MemoryQuestionCategory | null,
		status,
		askedAtNode: requireString(value.askedAtNode, `${label}.askedAtNode`),
		answer:
			value.answer === null
				? null
				: requireString(value.answer, `${label}.answer`),
		verdict: verdict as ProbeVerdict | null,
		fabricatedQuestion: requireBoolean(
			value.fabricatedQuestion,
			`${label}.fabricatedQuestion`,
		),
		fabricated: requireBoolean(value.fabricated, `${label}.fabricated`),
		reason:
			value.reason === null
				? null
				: requireString(value.reason, `${label}.reason`),
		judgeAttempts: requireInteger(
			value.judgeAttempts,
			`${label}.judgeAttempts`,
			0,
		),
		error:
			value.error === null
				? null
				: requireString(value.error, `${label}.error`),
		answerUsage: parseUsage(value.answerUsage, `${label}.answerUsage`),
		judgeUsage: parseUsage(value.judgeUsage, `${label}.judgeUsage`),
	};
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value;
}

function requireInteger(
	value: unknown,
	label: string,
	minimum: number,
): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < minimum
	) {
		throw new Error(`${label} 必须是不小于 ${minimum} 的整数`);
	}
	return value;
}

function requireBoolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`${label} 必须是布尔值`);
	}
	return value;
}

function parseUsage(value: unknown, label: string): LlmUsage | null {
	if (value === null) return null;
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象或 null`);
	}
	const keys = [
		"promptTokens",
		"completionTokens",
		"totalTokens",
		"reasoningTokens",
		"cachedTokens",
	] as const;
	for (const key of keys) {
		if (typeof value[key] !== "number") {
			throw new Error(`${label}.${key} 必须是数字`);
		}
	}
	return {
		promptTokens: value.promptTokens as number,
		completionTokens: value.completionTokens as number,
		totalTokens: value.totalTokens as number,
		reasoningTokens: value.reasoningTokens as number,
		cachedTokens: value.cachedTokens as number,
	};
}
