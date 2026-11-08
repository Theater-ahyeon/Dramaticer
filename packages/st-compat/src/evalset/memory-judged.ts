import {
	type ContextSlotProviders,
	type ContextTemplate,
	type LlmClient,
	type LlmUsage,
	type StoryStore,
	assembleContext,
	readLedger,
} from "@dramaticer/core";
import {
	MEMORY_QUESTION_CATEGORIES,
	type MemoryQuestion,
	type MemoryQuestionCategory,
	memoryQuestionCategoryLabel,
} from "./memory-questions.js";
import {
	PROBE_INSTRUCTION,
	type ProbeVerdict,
	judgeAnswerConsistency,
} from "./probe.js";

export const DEFAULT_JUDGED_MEMORY_MAX_TOKENS = 1_024;
export const DEFAULT_JUDGED_MEMORY_TEMPERATURE = 0.3;
/** 单条证据楼层的原文上限；裁判不需要整楼全文。 */
const MAX_EVIDENCE_FLOOR_CHARS = 1_500;
const MAX_EVIDENCE_CHARS = 5_000;

export interface JudgedMemoryQuestionRecord {
	readonly story: string;
	readonly question: MemoryQuestion;
	/** 实际提问楼层；没指定覆盖时与题目的 askAtNode 相同。 */
	readonly askedAtNode: string;
	readonly status: "done" | "failed";
	readonly answer: string | null;
	readonly verdict: ProbeVerdict | null;
	/** 编造题判为不一致，才算模型编造了回忆。 */
	readonly fabricated: boolean;
	readonly reason: string | null;
	readonly judgeAttempts: number;
	readonly error: string | null;
	readonly answerUsage: LlmUsage | null;
	readonly judgeUsage: LlmUsage | null;
}

export interface JudgedMemoryRunOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly questions: readonly MemoryQuestion[];
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
	/** 在指定楼层提问；缺省用每道题自己的 askAtNode。 */
	readonly askAtNode?: string;
}

/** 提问只需题目文本、参考答案、证据与编造标记；记忆题与探针题共用。 */
export interface JudgedQuestionSpec {
	readonly id: string;
	readonly question: string;
	readonly answer: string;
	readonly evidenceNodes: readonly string[];
	readonly fabricated: boolean;
}

export interface JudgedQuestionAnswer {
	readonly status: "done" | "failed";
	readonly answer: string | null;
	readonly verdict: ProbeVerdict | null;
	/** 编造题判为矛盾才算编造。 */
	readonly fabricated: boolean;
	readonly reason: string | null;
	readonly judgeAttempts: number;
	readonly error: string | null;
	readonly answerUsage: LlmUsage | null;
	readonly judgeUsage: LlmUsage | null;
}

export interface AnswerJudgedQuestionInput {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly askAtNode: string;
	readonly spec: JudgedQuestionSpec;
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
 * 在指定楼层组装上下文、生成回答，再交给与探针同一套的裁判。
 * 不写楼层，也不改 head；调用方负责确认提问楼层在当前路径上。
 */
export async function answerJudgedQuestion(
	input: AnswerJudgedQuestionInput,
): Promise<JudgedQuestionAnswer> {
	for (const evidence of input.spec.evidenceNodes) {
		if (!input.store.getNode(evidence)) {
			throw new Error(`题目 ${input.spec.id} 的证据楼层不存在：${evidence}`);
		}
	}
	const evidenceText = renderEvidence(input.store, input.spec.evidenceNodes);
	const assembled = await assembleContext({
		template: input.template,
		budgetTokens: input.budgetTokens,
		storyId: input.storyId,
		nodeId: input.askAtNode,
		providers: input.providers,
	});
	let answer: string;
	let answerUsage: LlmUsage | null;
	try {
		const result = await input.assistant.client.complete({
			messages: [
				...assembled.messages,
				{
					role: "user",
					content: `${PROBE_INSTRUCTION}${input.spec.question}`,
				},
			],
			model: input.assistant.model,
			temperature: input.temperature ?? DEFAULT_JUDGED_MEMORY_TEMPERATURE,
			maxTokens: input.maxTokens ?? DEFAULT_JUDGED_MEMORY_MAX_TOKENS,
		});
		answer = result.text.trim();
		answerUsage = result.usage;
		if (answer.length === 0) throw new Error("记忆题回答为空");
	} catch (error) {
		return {
			status: "failed",
			answer: null,
			verdict: null,
			fabricated: false,
			reason: null,
			judgeAttempts: 0,
			error: error instanceof Error ? error.message : String(error),
			answerUsage: null,
			judgeUsage: null,
		};
	}
	const judged = await judgeAnswerConsistency({
		judge: input.judge,
		question: input.spec.question,
		answer,
		snapshot: readLedger(input.store, input.askAtNode) ?? {},
		referenceAnswer: input.spec.answer,
		evidenceText,
		fabricated: input.spec.fabricated,
	});
	return {
		status: judged.status,
		answer,
		verdict: judged.verdict,
		fabricated: input.spec.fabricated && judged.verdict === "contradicted",
		reason: judged.reason,
		judgeAttempts: judged.attempts,
		error: judged.error,
		answerUsage,
		judgeUsage: judged.usage,
	};
}

/**
 * 在每道题的提问楼层组装上下文、生成回答，再交给与探针同一套的裁判。
 * 不写楼层，也不改 head。
 */
export async function runJudgedMemoryQuestions(
	options: JudgedMemoryRunOptions,
): Promise<JudgedMemoryQuestionRecord[]> {
	const path = options.store.getPathToHead(options.storyId);
	if (path.length === 0) {
		throw new Error(`故事 ${options.storyId} 没有楼层`);
	}
	const onPath = new Set(path.map((node) => node.id));
	const records: JudgedMemoryQuestionRecord[] = [];
	for (const question of options.questions) {
		if (question.story !== options.storyId) {
			throw new Error(
				`题目 ${question.id} 属于故事 ${question.story}，与 ${options.storyId} 不一致`,
			);
		}
		const askedAtNode = options.askAtNode ?? question.askAtNode;
		if (!onPath.has(askedAtNode)) {
			throw new Error(
				`题目 ${question.id} 的提问楼层不在当前路径上：${askedAtNode}`,
			);
		}
		const result = await answerJudgedQuestion({
			store: options.store,
			storyId: options.storyId,
			askAtNode: askedAtNode,
			spec: question,
			template: options.template,
			providers: options.providers,
			budgetTokens: options.budgetTokens,
			assistant: options.assistant,
			judge: options.judge,
			maxTokens: options.maxTokens,
			temperature: options.temperature,
		});
		records.push({
			story: options.storyId,
			question,
			askedAtNode,
			status: result.status,
			answer: result.answer,
			verdict: result.verdict,
			fabricated: result.fabricated,
			reason: result.reason,
			judgeAttempts: result.judgeAttempts,
			error: result.error,
			answerUsage: result.answerUsage,
			judgeUsage: result.judgeUsage,
		});
	}
	return records;
}

function renderEvidence(
	store: StoryStore,
	evidenceNodes: readonly string[],
): string {
	const parts: string[] = [];
	let total = 0;
	for (const nodeId of evidenceNodes) {
		const node = store.getNode(nodeId);
		if (node === null) continue;
		const text = node.raw.slice(0, MAX_EVIDENCE_FLOOR_CHARS);
		if (total + text.length > MAX_EVIDENCE_CHARS) break;
		parts.push(`楼层 ${nodeId}：\n${text}`);
		total += text.length;
	}
	return parts.join("\n\n");
}

export interface JudgedMemoryCategoryScore {
	readonly category: MemoryQuestionCategory;
	readonly questionCount: number;
	readonly consistent: number;
	readonly contradicted: number;
	readonly unknown: number;
	readonly failed: number;
	/** 一致数除以（一致加矛盾）；没有可判定的样本时为 0。 */
	readonly hitRate: number;
	readonly fabricatedQuestionCount: number;
	/** 编造题里被判为不一致的数量。 */
	readonly fabricated: number;
	/** 编造题里裁判可判定的数量（一致加矛盾）。 */
	readonly fabricatedJudged: number;
	/** 编造数除以可判定的编造题数；没有可判定的编造题时为 0。 */
	readonly fabricatedRate: number;
}

export interface JudgedMemorySummary {
	readonly questionCount: number;
	readonly consistent: number;
	readonly contradicted: number;
	readonly unknown: number;
	readonly failed: number;
	readonly hitRate: number;
	readonly fabricatedQuestionCount: number;
	readonly fabricated: number;
	readonly fabricatedJudged: number;
	readonly fabricatedRate: number;
	readonly byCategory: readonly JudgedMemoryCategoryScore[];
	readonly records: readonly JudgedMemoryQuestionRecord[];
}

interface MutableJudgedCategory {
	questionCount: number;
	consistent: number;
	contradicted: number;
	unknown: number;
	failed: number;
	fabricatedQuestionCount: number;
	fabricated: number;
	fabricatedJudged: number;
}

function emptyCategory(): MutableJudgedCategory {
	return {
		questionCount: 0,
		consistent: 0,
		contradicted: 0,
		unknown: 0,
		failed: 0,
		fabricatedQuestionCount: 0,
		fabricated: 0,
		fabricatedJudged: 0,
	};
}

function addRecord(
	target: MutableJudgedCategory,
	record: JudgedMemoryQuestionRecord,
): void {
	target.questionCount += 1;
	if (record.question.fabricated) target.fabricatedQuestionCount += 1;
	if (record.status === "failed") {
		target.failed += 1;
		return;
	}
	if (record.verdict === "consistent") target.consistent += 1;
	else if (record.verdict === "contradicted") target.contradicted += 1;
	else target.unknown += 1;
	if (record.question.fabricated && record.verdict !== "unknown") {
		target.fabricatedJudged += 1;
	}
	if (record.fabricated) target.fabricated += 1;
}

function completeness(score: MutableJudgedCategory): {
	readonly hitRate: number;
	readonly fabricatedRate: number;
} {
	const judged = score.consistent + score.contradicted;
	return {
		hitRate: judged === 0 ? 0 : score.consistent / judged,
		fabricatedRate:
			score.fabricatedJudged === 0
				? 0
				: score.fabricated / score.fabricatedJudged,
	};
}

export function summarizeJudgedMemoryQuestions(
	records: readonly JudgedMemoryQuestionRecord[],
): JudgedMemorySummary {
	const byCategory = new Map<MemoryQuestionCategory, MutableJudgedCategory>();
	for (const category of MEMORY_QUESTION_CATEGORIES) {
		byCategory.set(category, emptyCategory());
	}
	const total = emptyCategory();
	for (const record of records) {
		addRecord(total, record);
		const category = byCategory.get(record.question.category);
		if (category === undefined) {
			throw new Error(`未知的记忆题类别：${record.question.category}`);
		}
		addRecord(category, record);
	}
	const categories: JudgedMemoryCategoryScore[] = [];
	for (const category of MEMORY_QUESTION_CATEGORIES) {
		const score = byCategory.get(category);
		if (score === undefined) continue;
		const rates = completeness(score);
		categories.push({ category, ...score, ...rates });
	}
	return {
		questionCount: total.questionCount,
		consistent: total.consistent,
		contradicted: total.contradicted,
		unknown: total.unknown,
		failed: total.failed,
		...completeness(total),
		fabricatedQuestionCount: total.fabricatedQuestionCount,
		fabricated: total.fabricated,
		fabricatedJudged: total.fabricatedJudged,
		byCategory: categories,
		records,
	};
}

function rateText(numerator: number, denominator: number): string {
	return denominator === 0
		? "—"
		: `${((numerator / denominator) * 100).toFixed(1)}%（${numerator}/${denominator}）`;
}

function cell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * 五类记忆题与编造回忆率的报告段。统计版只有类别与数字；
 * 私有版附题目、参考答案、回答与裁判理由。
 */
export function renderJudgedMemorySection(
	summary: JudgedMemorySummary,
	options: { readonly privateDetails: boolean },
): string {
	const lines: string[] = [
		"## 五类记忆题与编造回忆率",
		"",
		"命中率的分母是一致加矛盾；`unknown` 与失败单列，不进入分母。编造率的分母是编造题里裁判可判定的数量。",
		"",
		"| 类别 | 题数 | 命中 | 矛盾 | 无法判断 | 失败 | 命中率 | 编造题 | 编造 | 编造率 |",
		"| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
	];
	for (const score of summary.byCategory) {
		lines.push(
			`| ${memoryQuestionCategoryLabel(score.category)} | ${score.questionCount} | ${score.consistent} | ${score.contradicted} | ${score.unknown} | ${score.failed} | ${rateText(score.consistent, score.consistent + score.contradicted)} | ${score.fabricatedQuestionCount} | ${score.fabricated} | ${rateText(score.fabricated, score.fabricatedJudged)} |`,
		);
	}
	lines.push(
		`| 合计 | ${summary.questionCount} | ${summary.consistent} | ${summary.contradicted} | ${summary.unknown} | ${summary.failed} | ${rateText(summary.consistent, summary.consistent + summary.contradicted)} | ${summary.fabricatedQuestionCount} | ${summary.fabricated} | ${rateText(summary.fabricated, summary.fabricatedJudged)} |`,
	);
	if (!options.privateDetails) return `${lines.join("\n")}\n`;
	lines.push("", "### 逐题明细", "");
	for (const record of summary.records) {
		const question = record.question;
		const verdict =
			record.status === "failed"
				? "失败"
				: record.verdict === "consistent"
					? "一致"
					: record.verdict === "contradicted"
						? record.fabricated
							? "编造"
							: "矛盾"
						: "无法判断";
		lines.push(
			`#### ${question.id}（${memoryQuestionCategoryLabel(question.category)}，${verdict}）`,
			"",
			`- 故事：${record.story}`,
			`- 提问楼层：${record.askedAtNode}`,
			`- 证据楼层：${question.evidenceNodes.join("、")}`,
			`- 问题：${cell(question.question)}`,
			`- 参考答案：${cell(question.answer)}`,
		);
		if (record.answer !== null) {
			lines.push(`- 模型回答：${cell(record.answer)}`);
		}
		if (record.reason !== null) {
			lines.push(`- 裁判理由：${cell(record.reason)}`);
		}
		if (record.error !== null) {
			lines.push(`- 错误：${cell(record.error)}`);
		}
		lines.push("");
	}
	return `${lines.join("\n")}\n`;
}
