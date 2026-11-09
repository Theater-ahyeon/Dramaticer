import {
	type LlmMessage,
	type LlmUsage,
	NO_CONTINUATION,
} from "@dramaticer/core";
import {
	type PairwiseJudge,
	type PairwiseTask,
	isPairwiseTask,
} from "./pairwise.js";

export const MAX_QUALITY_ATTEMPTS = 3;
export const DEFAULT_QUALITY_MAX_TOKENS = 512;

export const QUALITY_DIMENSIONS = [
	"originality",
	"character",
	"pacing",
	"dialogue",
] as const;
export type QualityDimension = (typeof QUALITY_DIMENSIONS)[number];

/** 一次评分落在接受侧还是放弃侧。 */
export const QUALITY_SIDES = ["accepted", "abandoned"] as const;
export type QualitySide = (typeof QUALITY_SIDES)[number];

export interface QualityScores {
	readonly originality: number;
	readonly character: number;
	readonly pacing: number;
	readonly dialogue: number;
}

export interface QualityVerdict {
	readonly scores: QualityScores;
	readonly reason: string;
}

export interface QualityJudgeInput {
	readonly task: PairwiseTask;
	/** 与两两对比相同的最近对话。 */
	readonly context: string;
	readonly text: string;
	readonly judge: PairwiseJudge;
}

export type QualityJudgeResult =
	| {
			readonly status: "done";
			readonly scores: QualityScores;
			readonly reason: string;
			readonly attempts: number;
			readonly usage: LlmUsage | null;
	  }
	| {
			readonly status: "failed";
			readonly scores: null;
			readonly reason: null;
			readonly attempts: number;
			readonly usage: LlmUsage | null;
			readonly error: string;
	  };

const QUALITY_SYSTEM_PROMPT = `你是资深故事编辑，按 TTCW 式的产品评分表给一段角色扮演文本打分。只评给出的这一段文本，不评玩家，也不替它改写。
四个维度各打 1 到 5 分，只允许整数：
- originality（原创性）：是否避开陈词滥调，给出具体而不俗套的细节。5 有新意且可信；3 常见但不坏；1 套路化或空泛。
- character（人物）：言行、动机与情绪是否一致且有张力。5 让人物立体；3 基本可信；1 像工具人或明显崩坏。
- pacing（节奏）：场景是否有推进、张力与留白。5 张弛得当；3 能读但平淡或略拖；1 停滞、重复或跳跃。
- dialogue（对话）：台词是否自然、符合人物并推动场景。5 自然且有潜台词；3 合格；1 生硬、说明性或与人物不符。
如果文本是选项而不是完整续写，按该选项所指的剧情方向评分。
只输出一个 JSON 对象，键为 originality、character、pacing、dialogue 与 reason，例如 {"originality":4,"character":3,"pacing":4,"dialogue":2,"reason":"细节新鲜，但台词偏说明"}。分值是 1 到 5 的整数，reason 用一句话说明依据。不要输出代码块。`;

/** 严格解析评分输出：五个键齐全，四项为 1 到 5 的整数。 */
export function parseQualityOutput(text: string): QualityVerdict | null {
	let value: unknown;
	try {
		value = JSON.parse(text.trim());
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const expected = ["character", "dialogue", "originality", "pacing", "reason"];
	const keys = Object.keys(value).sort();
	if (
		keys.length !== expected.length ||
		keys.some((key, index) => key !== expected[index])
	) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const scores = QUALITY_DIMENSIONS.map((dimension) =>
		parseScore(record[dimension]),
	);
	if (scores.some((score) => score === null)) return null;
	if (typeof record.reason !== "string" || record.reason.trim().length === 0) {
		return null;
	}
	return {
		scores: {
			originality: scores[0] as number,
			character: scores[1] as number,
			pacing: scores[2] as number,
			dialogue: scores[3] as number,
		},
		reason: record.reason,
	};
}

function parseScore(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isInteger(value)) return null;
	return value >= 1 && value <= 5 ? value : null;
}

export function buildQualityMessages(input: {
	readonly task: PairwiseTask;
	readonly context: string;
	readonly text: string;
}): LlmMessage[] {
	const context =
		input.context.trim().length === 0
			? "（没有更早的对话）"
			: input.context.trim();
	const label = input.task === "choice" ? "选项" : "回复";
	return [
		{ role: "system", content: QUALITY_SYSTEM_PROMPT },
		{
			role: "user",
			content: [
				`最近的对话：\n${context}`,
				`需要评分的${label}：\n${input.text}`,
				"请评分并只输出 JSON。",
			].join("\n\n"),
		},
	];
}

/** 评分失败重试 3 次后返回失败记录，不中断整批。 */
export async function judgeQuality(
	input: QualityJudgeInput,
): Promise<QualityJudgeResult> {
	const baseMessages = buildQualityMessages(input);
	let usage: LlmUsage | null = null;
	let lastProblem = "";
	for (let attempt = 1; attempt <= MAX_QUALITY_ATTEMPTS; attempt += 1) {
		const messages: LlmMessage[] =
			attempt === 1
				? baseMessages
				: [
						...baseMessages,
						{
							role: "user",
							content: `上一次输出不是合法的评分 JSON（${lastProblem}）。只输出 {"originality":1-5,"character":1-5,"pacing":1-5,"dialogue":1-5,"reason":"…"}，不要代码块。`,
						},
					];
		let text: string;
		try {
			const result = await input.judge.client.complete(
				{
					messages,
					model: input.judge.model,
					temperature: 0,
					maxTokens: input.judge.maxTokens ?? DEFAULT_QUALITY_MAX_TOKENS,
				},
				NO_CONTINUATION,
			);
			text = result.text;
			usage = result.usage;
		} catch (error) {
			return {
				status: "failed",
				scores: null,
				reason: null,
				attempts: attempt,
				usage,
				error: `裁判调用失败：${error instanceof Error ? error.message : String(error)}`,
			};
		}
		const verdict = parseQualityOutput(text);
		if (verdict !== null) {
			return {
				status: "done",
				scores: verdict.scores,
				reason: verdict.reason,
				attempts: attempt,
				usage,
			};
		}
		lastProblem = "缺少维度或 reason、分数不是 1 到 5 的整数，或包含多余字段";
	}
	return {
		status: "failed",
		scores: null,
		reason: null,
		attempts: MAX_QUALITY_ATTEMPTS,
		usage,
		error: `裁判连续 ${MAX_QUALITY_ATTEMPTS} 次没有输出合法的评分 JSON`,
	};
}

/** 评分样本只需要两两对比里共用的语境与两份文本。 */
export interface QualitySample {
	readonly sampleId: string;
	readonly storyId: string;
	readonly kind: PairwiseTask;
	readonly context: string;
	readonly acceptedText: string;
	readonly abandonedText: string;
}

export type QualityRecord = {
	readonly sampleId: string;
	readonly storyId: string;
	readonly kind: PairwiseTask;
	readonly side: QualitySide;
	readonly attempts: number;
	readonly usage: LlmUsage | null;
	readonly model: string;
	readonly createdAt: string;
} & (
	| {
			readonly status: "done";
			readonly scores: QualityScores;
			readonly reason: string;
			readonly error: null;
	  }
	| {
			readonly status: "failed";
			readonly scores: null;
			readonly reason: null;
			readonly error: string;
	  }
);

/** 同一份文本只评一次：接受侧与放弃侧各一条记录。 */
export async function runQualitySample(
	sample: QualitySample,
	judge: PairwiseJudge,
	options: { readonly now?: () => string } = {},
): Promise<QualityRecord[]> {
	const now = options.now ?? (() => new Date().toISOString());
	const records: QualityRecord[] = [];
	for (const side of QUALITY_SIDES) {
		const result = await judgeQuality({
			task: sample.kind,
			context: sample.context,
			text: side === "accepted" ? sample.acceptedText : sample.abandonedText,
			judge,
		});
		const base = {
			sampleId: sample.sampleId,
			storyId: sample.storyId,
			kind: sample.kind,
			side,
			attempts: result.attempts,
			usage: result.usage,
			model: judge.model,
			createdAt: now(),
		};
		records.push(
			result.status === "done"
				? {
						...base,
						status: "done",
						scores: result.scores,
						reason: result.reason,
						error: null,
					}
				: {
						...base,
						status: "failed",
						scores: null,
						reason: null,
						error: result.error,
					},
		);
	}
	return records;
}

export interface QualityDimensionStats {
	readonly dimension: QualityDimension;
	readonly count: number;
	readonly mean: number | null;
	/** 1 到 5 分各有多少条。 */
	readonly distribution: readonly number[];
}

export interface QualityGroupStats {
	readonly scope: "story" | "overall";
	readonly storyId: string | null;
	readonly side: QualitySide;
	readonly samples: number;
	readonly scored: number;
	readonly failures: number;
	readonly dimensions: readonly QualityDimensionStats[];
}

export interface QualityFailure {
	readonly sampleId: string;
	readonly storyId: string;
	readonly kind: PairwiseTask;
	readonly side: QualitySide;
	readonly attempts: number;
	readonly error: string;
}

export interface QualitySummary {
	readonly byStory: readonly QualityGroupStats[];
	readonly bySide: readonly QualityGroupStats[];
	readonly failures: readonly QualityFailure[];
	readonly records: number;
}

/** 同样本同一侧有多行时取最后一行；失败记录只计数，不进入均值。 */
export function summarizeQuality(
	records: readonly QualityRecord[],
): QualitySummary {
	const latest = new Map<string, QualityRecord>();
	for (const record of records) {
		latest.set(`${record.sampleId}\u0000${record.side}`, record);
	}
	const deduped = [...latest.values()];
	const storyIds = [...new Set(deduped.map((record) => record.storyId))].sort();
	const byStory: QualityGroupStats[] = [];
	for (const storyId of storyIds) {
		for (const side of QUALITY_SIDES) {
			byStory.push(
				summarizeQualityGroup(
					"story",
					storyId,
					side,
					deduped.filter(
						(record) => record.storyId === storyId && record.side === side,
					),
				),
			);
		}
	}
	const bySide = QUALITY_SIDES.map((side) =>
		summarizeQualityGroup(
			"overall",
			null,
			side,
			deduped.filter((record) => record.side === side),
		),
	);
	const failures = deduped
		.filter((record) => record.status === "failed")
		.map((record) => ({
			sampleId: record.sampleId,
			storyId: record.storyId,
			kind: record.kind,
			side: record.side,
			attempts: record.attempts,
			error: record.error ?? "未知错误",
		}))
		.sort((left, right) => {
			const leftKey = `${left.sampleId}\u0000${left.side}`;
			const rightKey = `${right.sampleId}\u0000${right.side}`;
			return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
		});
	return { byStory, bySide, failures, records: deduped.length };
}

function summarizeQualityGroup(
	scope: "story" | "overall",
	storyId: string | null,
	side: QualitySide,
	records: readonly QualityRecord[],
): QualityGroupStats {
	const done = records.filter(
		(record): record is Extract<QualityRecord, { status: "done" }> =>
			record.status === "done",
	);
	const dimensions = QUALITY_DIMENSIONS.map((dimension) => {
		const values = done.map((record) => record.scores[dimension]);
		const distribution = [0, 0, 0, 0, 0];
		for (const value of values) distribution[value - 1] += 1;
		const sum = values.reduce((total, value) => total + value, 0);
		return {
			dimension,
			count: values.length,
			mean: values.length === 0 ? null : sum / values.length,
			distribution,
		};
	});
	return {
		scope,
		storyId,
		side,
		samples: new Set(records.map((record) => record.sampleId)).size,
		scored: done.length,
		failures: records.length - done.length,
		dimensions,
	};
}

/** 读回评分记录，用于续跑与只读报告。 */
export function parseQualityRecordsJsonl(
	text: string,
	source: string,
): QualityRecord[] {
	const records: QualityRecord[] = [];
	text.split("\n").forEach((line, index) => {
		if (line.trim().length === 0) return;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch (error) {
			throw new Error(
				`${source} 第 ${index + 1} 行不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
			);
		}
		records.push(parseQualityRecord(value, `${source} 第 ${index + 1} 行`));
	});
	return records;
}

function parseQualityRecord(value: unknown, where: string): QualityRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${where} 必须是 JSON 对象`);
	}
	const record = value as Record<string, unknown>;
	const expected = [
		"attempts",
		"createdAt",
		"error",
		"kind",
		"model",
		"reason",
		"sampleId",
		"scores",
		"side",
		"status",
		"storyId",
		"usage",
	];
	const keys = Object.keys(record).sort();
	if (
		keys.length !== expected.length ||
		keys.some((key, index) => key !== expected[index])
	) {
		throw new Error(
			`${where} 的字段必须是 ${expected.join("、")}，收到 ${keys.join("、")}`,
		);
	}
	if (!isPairwiseTask(record.kind)) {
		throw new Error(`${where} 的 kind 必须是 reroll、choice 或 historical`);
	}
	const kind: PairwiseTask = record.kind;
	if (!QUALITY_SIDES.includes(record.side as QualitySide)) {
		throw new Error(`${where} 的 side 必须是 accepted 或 abandoned`);
	}
	if (
		typeof record.attempts !== "number" ||
		!Number.isInteger(record.attempts) ||
		record.attempts < 0
	) {
		throw new Error(`${where} 的 attempts 必须是非负整数`);
	}
	if (
		record.usage !== null &&
		(typeof record.usage !== "object" || Array.isArray(record.usage))
	) {
		throw new Error(`${where} 的 usage 必须是对象或 null`);
	}
	const base = {
		sampleId: requireText(record.sampleId, `${where} 的 sampleId`),
		storyId: requireText(record.storyId, `${where} 的 storyId`),
		kind,
		side: record.side as QualitySide,
		attempts: record.attempts,
		usage: record.usage as LlmUsage | null,
		model: requireText(record.model, `${where} 的 model`),
		createdAt: requireText(record.createdAt, `${where} 的 createdAt`),
	};
	if (record.status === "done") {
		const scores = parseScores(record.scores, `${where} 的 scores`);
		return {
			...base,
			status: "done",
			scores,
			reason: requireText(record.reason, `${where} 的 reason`),
			error: null,
		};
	}
	if (record.status === "failed") {
		if (record.scores !== null || record.reason !== null) {
			throw new Error(`${where} 的失败记录里 scores 与 reason 必须是 null`);
		}
		return {
			...base,
			status: "failed",
			scores: null,
			reason: null,
			error: requireText(record.error, `${where} 的 error`),
		};
	}
	throw new Error(`${where} 的 status 必须是 done 或 failed`);
}

function parseScores(value: unknown, where: string): QualityScores {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${where} 必须是 JSON 对象`);
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const expected = [...QUALITY_DIMENSIONS].sort();
	if (
		keys.length !== expected.length ||
		keys.some((key, index) => key !== expected[index])
	) {
		throw new Error(`${where} 的字段必须是 ${expected.join("、")}`);
	}
	const parsed = QUALITY_DIMENSIONS.map((dimension) =>
		parseScore(record[dimension]),
	);
	if (parsed.some((score) => score === null)) {
		throw new Error(`${where} 的分数必须是 1 到 5 的整数`);
	}
	return {
		originality: parsed[0] as number,
		character: parsed[1] as number,
		pacing: parsed[2] as number,
		dialogue: parsed[3] as number,
	};
}

function requireText(value: unknown, where: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${where} 必须是非空字符串`);
	}
	return value;
}

const DIMENSION_LABELS: Readonly<Record<QualityDimension, string>> = {
	originality: "原创性",
	character: "人物",
	pacing: "节奏",
	dialogue: "对话",
};

const SIDE_LABELS: Readonly<Record<QualitySide, string>> = {
	accepted: "接受侧",
	abandoned: "放弃侧",
};

export interface QualityReportOptions {
	readonly privateDetails: boolean;
}

/**
 * 评分段附在盲测报告末尾。统计版只给汇总分数与样本数，
 * 不出现故事 id、样本 id、理由与原文。
 */
export function renderQualitySection(
	summary: QualitySummary,
	options: QualityReportOptions,
): string {
	const lines = [
		"## 叙事质量评分",
		"",
		"评分口径：原创性、人物、节奏、对话各 1 到 5 分；均值只统计成功记录，分布是 1 到 5 分各自的条数；失败记录单列。",
		"",
	];
	const groups = options.privateDetails ? summary.byStory : summary.bySide;
	if (groups.length === 0) {
		lines.push("没有评分记录。", "");
		return lines.join("\n");
	}
	lines.push(
		"| 范围 | 侧 | 样本 | 成功 | 原创性 | 人物 | 节奏 | 对话 | 失败 |",
		"|---|---|---|---|---|---|---|---|---|",
	);
	for (const group of groups) {
		const scope = options.privateDetails
			? (group.storyId ?? "全部")
			: group.scope === "overall"
				? "全部"
				: "分组";
		lines.push(
			`| ${scope} | ${SIDE_LABELS[group.side]} | ${group.samples} | ${group.scored} | ${formatMean(group, "originality")} | ${formatMean(group, "character")} | ${formatMean(group, "pacing")} | ${formatMean(group, "dialogue")} | ${group.failures} |`,
		);
	}
	lines.push("", "### 分数分布（1/2/3/4/5 的条数）", "");
	lines.push(
		`| 范围 | 侧 | ${QUALITY_DIMENSIONS.map((dimension) => DIMENSION_LABELS[dimension]).join(" | ")} |`,
		`|---|---|${QUALITY_DIMENSIONS.map(() => "---").join("|")}|`,
	);
	for (const group of groups) {
		const scope = options.privateDetails
			? (group.storyId ?? "全部")
			: group.scope === "overall"
				? "全部"
				: "分组";
		lines.push(
			`| ${scope} | ${SIDE_LABELS[group.side]} | ${group.dimensions.map((entry) => entry.distribution.join("/")).join(" | ")} |`,
		);
	}
	lines.push("", "### 评分失败", "");
	if (summary.failures.length === 0) {
		lines.push("没有失败。");
	} else if (options.privateDetails) {
		lines.push(`共 ${summary.failures.length} 条：`, "");
		for (const failure of summary.failures) {
			lines.push(
				`- ${failure.sampleId}（${failure.kind}，${failure.side}，尝试 ${failure.attempts} 次）：${failure.error}`,
			);
		}
	} else {
		lines.push(`共 ${summary.failures.length} 条，原因不在此列出。`);
	}
	lines.push("");
	return lines.join("\n");
}

function formatMean(
	group: QualityGroupStats,
	dimension: QualityDimension,
): string {
	const entry = group.dimensions.find(
		(record) => record.dimension === dimension,
	);
	if (entry === undefined || entry.mean === null) return "—";
	return entry.mean.toFixed(2);
}
