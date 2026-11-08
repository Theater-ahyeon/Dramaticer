import {
	type ChatProfile,
	type LlmReasoningLevel,
	type LlmUsage,
	type TimelineNode,
	isLlmReasoningLevel,
	modelFamily,
} from "@dramaticer/core";
import { selectBranchPoints } from "./director-eval.js";
import {
	type PairwiseJudge,
	type PairwiseWinner,
	judgePairwise,
} from "./pairwise.js";
import type { QualitySample, QualitySide, QualitySummary } from "./quality.js";

export const B1_ORDERS = ["generated-first", "historical-first"] as const;
export type B1Order = (typeof B1_ORDERS)[number];

export const B1_PROFILES = ["native", "naive"] as const;
export type B1Profile = ChatProfile;

export const DEFAULT_B1_INTERVAL = 100;
export const DEFAULT_B1_ROUNDS = 1;
export const DEFAULT_B1_MAX_BRANCH_POINTS = 2;
/** 历史回放的语境比偏好样本长得多；512 常被思考占满。 */
export const DEFAULT_B1_JUDGE_MAX_TOKENS = 2048;

export type NormalizedB1Winner = "generated" | "historical" | "tie";

export interface PlanHistoricalReplayOptions {
	readonly interval: number;
	readonly rounds: number;
	readonly maxBranchPointsPerStory: number;
}

/** 沿主路径选出的历史回放分支点；历史回复是当时主路径上的下一条助手楼层。 */
export interface HistoricalReplayBranchPoint {
	readonly branchNodeId: string;
	/** 路径深度，从 1 开始。 */
	readonly branchFloor: number;
	readonly historicalNodeId: string;
	readonly userTexts: readonly string[];
	readonly historicalModel: string | null;
}

/**
 * 按 ADR-0027 的分支点规则取点，并定位第一段真实回复：
 * 分支点之后第一条非空玩家消息的下一层助手楼层。
 */
export function planHistoricalReplaySamples(
	path: readonly TimelineNode[],
	options: PlanHistoricalReplayOptions,
	historicalModelOf: (nodeId: string) => string | null,
): HistoricalReplayBranchPoint[] {
	const branches = selectBranchPoints(path, options);
	return branches.map((branch) => {
		let userIndex = -1;
		for (let index = branch.floor; index < path.length; index += 1) {
			const node = path[index];
			if (node === undefined) break;
			if (node.role !== "user" || node.raw.trim().length === 0) continue;
			if (node.raw !== branch.userTexts[0]) continue;
			userIndex = index;
			break;
		}
		if (userIndex < 0) {
			throw new Error(`分支点 ${branch.nodeId} 之后的玩家消息不在主路径上`);
		}
		let historical: TimelineNode | null = null;
		for (let index = userIndex + 1; index < path.length; index += 1) {
			const node = path[index];
			if (node === undefined) break;
			if (node.role !== "assistant") continue;
			if (node.raw.trim().length === 0) continue;
			historical = node;
			break;
		}
		if (historical === null) {
			throw new Error(`分支点 ${branch.nodeId} 之后没有历史回复`);
		}
		return {
			branchNodeId: branch.nodeId,
			branchFloor: branch.floor,
			historicalNodeId: historical.id,
			userTexts: branch.userTexts,
			historicalModel: historicalModelOf(historical.id),
		};
	});
}

/** 本次回放样本的元数据；续跑与只读报告都从它恢复分组信息。 */
export interface HistoricalReplaySample {
	readonly sampleId: string;
	readonly storyId: string;
	readonly profile: B1Profile;
	readonly branchNodeId: string;
	readonly branchFloor: number;
	readonly historicalNodeId: string;
	readonly generatedNodeId: string;
	readonly writerModel: string;
	readonly writerModelId: string;
	readonly judgeModel: string;
	readonly historicalModel: string | null;
	/** 历史回复模型与本次写作模型同名（去掉渠道前缀后逐字相同）。 */
	readonly sameModel: boolean;
	/** 两个模型属于同一家族；同模型必然同家族。 */
	readonly sameFamily: boolean;
	readonly prefixFloors: number;
	readonly rounds: number;
	readonly interval: number;
	readonly maxBranchPointsPerStory: number;
	/** 首次规划时的主路径终点；续跑用它恢复原始路径。 */
	readonly originalHeadNodeId: string;
	readonly memory: boolean;
	readonly director: boolean;
	readonly temperature: number;
	readonly maxTokens: number;
	readonly reasoning: LlmReasoningLevel;
	readonly budgetTokens: number;
	readonly createdAt: string;
}

export function historicalReplaySampleId(
	storyId: string,
	branchFloor: number,
	profile: B1Profile,
): string {
	return `${storyId}:${branchFloor}:${profile}`;
}

/** 渠道前缀不参与同模型判断；家族判断仍按 `modelFamily`。 */
export function normalizeModelId(id: string): string {
	return id
		.trim()
		.toLowerCase()
		.replace(/^auto\//, "");
}

export function isSameModel(
	writerModelId: string,
	historicalModel: string | null,
): boolean {
	if (historicalModel === null) return false;
	return normalizeModelId(writerModelId) === normalizeModelId(historicalModel);
}

export function isSameModelFamily(
	writerModelId: string,
	historicalModel: string | null,
): boolean {
	if (historicalModel === null) return false;
	return modelFamily(writerModelId) === modelFamily(historicalModel);
}

export type HistoricalReplayRecord = {
	readonly sampleId: string;
	readonly storyId: string;
	readonly profile: B1Profile;
	readonly order: B1Order;
	readonly attempts: number;
	readonly usage: LlmUsage | null;
	readonly model: string;
	readonly createdAt: string;
} & (
	| {
			readonly status: "done";
			readonly winner: PairwiseWinner;
			readonly reason: string;
			readonly error: null;
	  }
	| {
			readonly status: "failed";
			readonly winner: null;
			readonly reason: null;
			readonly error: string;
	  }
);

type DoneHistoricalReplayRecord = Extract<
	HistoricalReplayRecord,
	{ readonly status: "done" }
>;

/** 把位置结论换回续写与历史回复两侧。 */
export function normalizeB1Winner(
	order: B1Order,
	winner: PairwiseWinner,
): NormalizedB1Winner {
	if (winner === "tie") return "tie";
	const generatedPosition = order === "generated-first" ? "A" : "B";
	return winner === generatedPosition ? "generated" : "historical";
}

/** 同一续写按两种顺序各判一次；两侧身份不告诉裁判。 */
export async function judgeHistoricalReplaySample(
	sample: {
		readonly sampleId: string;
		readonly storyId: string;
		readonly profile: B1Profile;
		readonly context: string;
		readonly generatedText: string;
		readonly historicalText: string;
	},
	judge: PairwiseJudge,
	options: { readonly now?: () => string } = {},
): Promise<HistoricalReplayRecord[]> {
	const now = options.now ?? (() => new Date().toISOString());
	const records: HistoricalReplayRecord[] = [];
	for (const order of B1_ORDERS) {
		const generatedFirst = order === "generated-first";
		const verdict = await judgePairwise({
			task: "historical",
			context: sample.context,
			first: generatedFirst ? sample.generatedText : sample.historicalText,
			second: generatedFirst ? sample.historicalText : sample.generatedText,
			judge,
		});
		const base = {
			sampleId: sample.sampleId,
			storyId: sample.storyId,
			profile: sample.profile,
			order,
			attempts: verdict.attempts,
			usage: verdict.usage,
			model: judge.model,
			createdAt: now(),
		};
		records.push(
			verdict.status === "done"
				? {
						...base,
						status: "done",
						winner: verdict.winner,
						reason: verdict.reason,
						error: null,
					}
				: {
						...base,
						status: "failed",
						winner: null,
						reason: null,
						error: verdict.error,
					},
		);
	}
	return records;
}

/** 评分复用盲测样本口径：续写放在接受侧，历史回复放在放弃侧。 */
export function buildHistoricalReplayQualitySample(sample: {
	readonly sampleId: string;
	readonly storyId: string;
	readonly context: string;
	readonly generatedText: string;
	readonly historicalText: string;
}): QualitySample {
	return {
		sampleId: sample.sampleId,
		storyId: sample.storyId,
		kind: "historical",
		context: sample.context,
		acceptedText: sample.generatedText,
		abandonedText: sample.historicalText,
	};
}

export interface HistoricalReplayGroupStats {
	readonly scope: "overall" | "story" | "same-model";
	readonly storyId: string | null;
	readonly profile: B1Profile;
	readonly samples: number;
	readonly judgements: number;
	readonly completed: number;
	readonly generatedWins: number;
	readonly historicalWins: number;
	readonly ties: number;
	readonly inconsistent: number;
	readonly generatedShare: number | null;
	readonly tieShare: number | null;
	readonly positionBias: number | null;
	readonly failures: number;
}

export interface HistoricalReplayFailure {
	readonly sampleId: string;
	readonly storyId: string;
	readonly profile: B1Profile;
	readonly order: B1Order;
	readonly attempts: number;
	readonly error: string;
}

export interface HistoricalReplaySummary {
	readonly overall: readonly HistoricalReplayGroupStats[];
	readonly byStory: readonly HistoricalReplayGroupStats[];
	readonly sameModel: readonly HistoricalReplayGroupStats[];
	readonly failures: readonly HistoricalReplayFailure[];
	readonly records: number;
	readonly hasSameModelSamples: boolean;
}

/**
 * 同一样本同一顺序有多行时取最后一行；胜率按顺序级判定，
 * 位置偏差是两种顺序结论不一致的样本占双向完成样本的比例。
 */
export function summarizeHistoricalReplay(
	records: readonly HistoricalReplayRecord[],
	samples: readonly HistoricalReplaySample[],
): HistoricalReplaySummary {
	const sampleById = new Map(
		samples.map((sample) => [sample.sampleId, sample]),
	);
	for (const record of records) {
		if (!sampleById.has(record.sampleId)) {
			throw new Error(`判定记录引用了未知样本：${record.sampleId}`);
		}
	}
	const latest = new Map<string, HistoricalReplayRecord>();
	for (const record of records) {
		latest.set(`${record.sampleId}\u0000${record.order}`, record);
	}
	const deduped = [...latest.values()];
	const profiles = [...new Set(samples.map((sample) => sample.profile))].sort();
	const storyIds = [...new Set(samples.map((sample) => sample.storyId))].sort();
	const overall = profiles.map((profile) =>
		summarizeGroup("overall", null, profile, deduped),
	);
	const byStory: HistoricalReplayGroupStats[] = [];
	for (const storyId of storyIds) {
		for (const profile of profiles) {
			byStory.push(summarizeGroup("story", storyId, profile, deduped));
		}
	}
	const sameModel = profiles.map((profile) =>
		summarizeGroup(
			"same-model",
			null,
			profile,
			deduped.filter(
				(record) => sampleById.get(record.sampleId)?.sameModel === true,
			),
		),
	);
	const failures = deduped
		.filter((record) => record.status === "failed")
		.map((record) => ({
			sampleId: record.sampleId,
			storyId: record.storyId,
			profile: record.profile,
			order: record.order,
			attempts: record.attempts,
			error: record.error ?? "未知错误",
		}))
		.sort((left, right) => {
			const leftKey = `${left.sampleId}\u0000${left.order}`;
			const rightKey = `${right.sampleId}\u0000${right.order}`;
			return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
		});
	return {
		overall,
		byStory,
		sameModel,
		failures,
		records: deduped.length,
		hasSameModelSamples: samples.some((sample) => sample.sameModel),
	};
}

function summarizeGroup(
	scope: "overall" | "story" | "same-model",
	storyId: string | null,
	profile: B1Profile,
	records: readonly HistoricalReplayRecord[],
): HistoricalReplayGroupStats {
	const groupRecords = records.filter((record) => {
		if (record.profile !== profile) return false;
		if (storyId !== null && record.storyId !== storyId) return false;
		return true;
	});
	const bySample = new Map<string, Map<B1Order, HistoricalReplayRecord>>();
	for (const record of groupRecords) {
		let orders = bySample.get(record.sampleId);
		if (orders === undefined) {
			orders = new Map();
			bySample.set(record.sampleId, orders);
		}
		orders.set(record.order, record);
	}
	let judgements = 0;
	let generatedWins = 0;
	let historicalWins = 0;
	let ties = 0;
	let completed = 0;
	let inconsistent = 0;
	for (const orders of bySample.values()) {
		const first = orders.get("generated-first");
		const second = orders.get("historical-first");
		const done = [first, second].filter(
			(record): record is DoneHistoricalReplayRecord =>
				record !== undefined && record.status === "done",
		);
		for (const record of done) {
			judgements += 1;
			const normalized = normalizeB1Winner(record.order, record.winner);
			if (normalized === "generated") generatedWins += 1;
			else if (normalized === "historical") historicalWins += 1;
			else ties += 1;
		}
		if (first?.status !== "done" || second?.status !== "done") continue;
		completed += 1;
		const firstNormalized = normalizeB1Winner(first.order, first.winner);
		const secondNormalized = normalizeB1Winner(second.order, second.winner);
		if (firstNormalized !== secondNormalized) {
			inconsistent += 1;
		}
	}
	return {
		scope,
		storyId,
		profile,
		samples: bySample.size,
		judgements,
		completed,
		generatedWins,
		historicalWins,
		ties,
		inconsistent,
		generatedShare: judgements === 0 ? null : generatedWins / judgements,
		tieShare: judgements === 0 ? null : ties / judgements,
		positionBias: completed === 0 ? null : inconsistent / completed,
		failures: groupRecords.filter((record) => record.status === "failed")
			.length,
	};
}

export function parseHistoricalReplaySamplesJsonl(
	text: string,
	source: string,
): HistoricalReplaySample[] {
	const samples: HistoricalReplaySample[] = [];
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
		samples.push(parseSample(value, `${source} 第 ${index + 1} 行`));
	});
	return samples;
}

function parseSample(value: unknown, where: string): HistoricalReplaySample {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${where} 必须是 JSON 对象`);
	}
	const record = value as Record<string, unknown>;
	const expected = [
		"branchFloor",
		"branchNodeId",
		"budgetTokens",
		"createdAt",
		"director",
		"generatedNodeId",
		"historicalModel",
		"historicalNodeId",
		"interval",
		"judgeModel",
		"maxBranchPointsPerStory",
		"maxTokens",
		"memory",
		"originalHeadNodeId",
		"prefixFloors",
		"profile",
		"reasoning",
		"rounds",
		"sameFamily",
		"sameModel",
		"sampleId",
		"storyId",
		"temperature",
		"writerModel",
		"writerModelId",
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
	if (record.profile !== "native" && record.profile !== "naive") {
		throw new Error(`${where} 的 profile 必须是 native 或 naive`);
	}
	for (const [field, label] of [
		["branchFloor", "branchFloor"],
		["prefixFloors", "prefixFloors"],
		["rounds", "rounds"],
		["interval", "interval"],
		["maxBranchPointsPerStory", "maxBranchPointsPerStory"],
		["maxTokens", "maxTokens"],
		["budgetTokens", "budgetTokens"],
	] as const) {
		if (!isNonNegativeInteger(record[field])) {
			throw new Error(`${where} 的 ${label} 必须是非负整数`);
		}
	}
	if (
		typeof record.temperature !== "number" ||
		!Number.isFinite(record.temperature)
	) {
		throw new Error(`${where} 的 temperature 必须是有限数字`);
	}
	for (const [field, label] of [
		["memory", "memory"],
		["director", "director"],
		["sameModel", "sameModel"],
		["sameFamily", "sameFamily"],
	] as const) {
		if (typeof record[field] !== "boolean") {
			throw new Error(`${where} 的 ${label} 必须是布尔值`);
		}
	}
	if (
		record.historicalModel !== null &&
		(typeof record.historicalModel !== "string" ||
			record.historicalModel.trim().length === 0)
	) {
		throw new Error(`${where} 的 historicalModel 必须是字符串或 null`);
	}
	return {
		sampleId: requireText(record.sampleId, `${where} 的 sampleId`),
		storyId: requireText(record.storyId, `${where} 的 storyId`),
		profile: record.profile as B1Profile,
		branchNodeId: requireText(record.branchNodeId, `${where} 的 branchNodeId`),
		branchFloor: record.branchFloor as number,
		historicalNodeId: requireText(
			record.historicalNodeId,
			`${where} 的 historicalNodeId`,
		),
		generatedNodeId: requireText(
			record.generatedNodeId,
			`${where} 的 generatedNodeId`,
		),
		writerModel: requireText(record.writerModel, `${where} 的 writerModel`),
		writerModelId: requireText(
			record.writerModelId,
			`${where} 的 writerModelId`,
		),
		judgeModel: requireText(record.judgeModel, `${where} 的 judgeModel`),
		historicalModel: record.historicalModel as string | null,
		sameModel: record.sameModel as boolean,
		sameFamily: record.sameFamily as boolean,
		prefixFloors: record.prefixFloors as number,
		rounds: record.rounds as number,
		interval: record.interval as number,
		maxBranchPointsPerStory: record.maxBranchPointsPerStory as number,
		originalHeadNodeId: requireText(
			record.originalHeadNodeId,
			`${where} 的 originalHeadNodeId`,
		),
		memory: record.memory as boolean,
		director: record.director as boolean,
		temperature: record.temperature,
		maxTokens: record.maxTokens as number,
		reasoning: parseReasoning(record.reasoning, where),
		budgetTokens: record.budgetTokens as number,
		createdAt: requireText(record.createdAt, `${where} 的 createdAt`),
	};
}

function parseReasoning(value: unknown, where: string): LlmReasoningLevel {
	if (!isLlmReasoningLevel(value)) {
		throw new Error(`${where} 的 reasoning 不合法`);
	}
	return value;
}

export function parseHistoricalReplayRecordsJsonl(
	text: string,
	source: string,
): HistoricalReplayRecord[] {
	const records: HistoricalReplayRecord[] = [];
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
		records.push(parseRecord(value, `${source} 第 ${index + 1} 行`));
	});
	return records;
}

function parseRecord(value: unknown, where: string): HistoricalReplayRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${where} 必须是 JSON 对象`);
	}
	const record = value as Record<string, unknown>;
	const expected = [
		"attempts",
		"createdAt",
		"error",
		"model",
		"order",
		"profile",
		"reason",
		"sampleId",
		"status",
		"storyId",
		"usage",
		"winner",
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
	if (record.profile !== "native" && record.profile !== "naive") {
		throw new Error(`${where} 的 profile 必须是 native 或 naive`);
	}
	if (!B1_ORDERS.includes(record.order as B1Order)) {
		throw new Error(
			`${where} 的 order 必须是 generated-first 或 historical-first`,
		);
	}
	if (!isNonNegativeInteger(record.attempts)) {
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
		profile: record.profile as B1Profile,
		order: record.order as B1Order,
		attempts: record.attempts as number,
		usage: record.usage as LlmUsage | null,
		model: requireText(record.model, `${where} 的 model`),
		createdAt: requireText(record.createdAt, `${where} 的 createdAt`),
	};
	if (record.status === "done") {
		if (!isWinner(record.winner)) {
			throw new Error(`${where} 的 winner 必须是 A、B 或 tie`);
		}
		return {
			...base,
			status: "done",
			winner: record.winner,
			reason: requireText(record.reason, `${where} 的 reason`),
			error: null,
		};
	}
	if (record.status === "failed") {
		if (record.winner !== null || record.reason !== null) {
			throw new Error(`${where} 的失败记录里 winner 与 reason 必须是 null`);
		}
		return {
			...base,
			status: "failed",
			winner: null,
			reason: null,
			error: requireText(record.error, `${where} 的 error`),
		};
	}
	throw new Error(`${where} 的 status 必须是 done 或 failed`);
}

function isWinner(value: unknown): value is PairwiseWinner {
	return value === "A" || value === "B" || value === "tie";
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function requireText(value: unknown, where: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${where} 必须是非空字符串`);
	}
	return value;
}

export interface HistoricalReplayReportSettings {
	readonly interval: number;
	readonly rounds: number;
	readonly maxBranchPointsPerStory: number;
}

export interface HistoricalReplayReportOptions {
	readonly privateDetails: boolean;
	readonly generatedAt: string;
	readonly writerModel: string;
	readonly writerModelId: string;
	readonly judgeModel: string;
	readonly settings: HistoricalReplayReportSettings;
	/** 私有版列出样本文件；统计版不显示。 */
	readonly sampleSources?: readonly string[];
}

export function renderHistoricalReplayReport(
	summary: HistoricalReplaySummary,
	samples: readonly HistoricalReplaySample[],
	quality: QualitySummary,
	options: HistoricalReplayReportOptions,
): string {
	const labels = storyLabels(samples, options.privateDetails);
	const lines = [
		options.privateDetails
			? "# R2-T05 B1 历史回放基线（私有版）"
			: "# R2-T05 B1 历史回放基线（统计版）",
		"",
		`- 生成时间：${options.generatedAt}`,
		`- 续写侧模型：${options.writerModel}（${options.writerModelId}）`,
		`- 裁判模型：${options.judgeModel}`,
		`- 分支点间隔：${options.settings.interval} 楼；回放轮数：${options.settings.rounds}；每对话分支点上限：${options.settings.maxBranchPointsPerStory}`,
	];
	if (options.privateDetails && options.sampleSources !== undefined) {
		lines.push(`- 样本来源：${options.sampleSources.join("、") || "无"}`);
	}
	lines.push(
		"- 口径：分支点之后用真实玩家消息回放固定轮数，只把第一段续写与当时的历史回复配对；同一对按两种顺序各判一次；胜率与平局率按单次顺序判定统计；位置偏差是两种顺序结论不一致的样本占双向完成样本的比例。",
		"- B1 不访问本地 ST：历史回复来自已导入的 ST 对话记录。",
		"",
		"## 分组数字",
		"",
		"| 组 | 档位 | 样本 | 双向完成 | 顺序判定 | 续写胜 | 历史胜 | 平局 | 续写胜率 | 平局率 | 位置偏差 | 失败 |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|",
	);
	for (const group of summary.overall) {
		lines.push(renderGroupRow("总体", null, group, labels));
	}
	for (const group of summary.byStory) {
		lines.push(renderGroupRow("对话", group.storyId, group, labels));
	}
	if (!summary.hasSameModelSamples) {
		lines.push(
			"",
			"同模型子集：没有样本的历史回复模型与本次写作模型相同，B1 只作参考，不作门槛。",
		);
	} else {
		lines.push("", "### 同模型子集", "");
		lines.push(
			"| 组 | 档位 | 样本 | 双向完成 | 顺序判定 | 续写胜 | 历史胜 | 平局 | 续写胜率 | 平局率 | 位置偏差 | 失败 |",
			"|---|---|---|---|---|---|---|---|---|---|---|---|",
		);
		for (const group of summary.sameModel) {
			lines.push(renderGroupRow("同模型子集", null, group, labels));
		}
	}
	lines.push("", "## 上下文差异", "");
	lines.push(
		"| 对话 | 档位 | 分支点楼层 | 前缀楼层 | 续写模型 | 温度 | 输出上限 | 思考 | 记忆 | 导演 | 历史回复模型 | 同模型 |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|",
	);
	for (const sample of samples) {
		lines.push(
			`| ${labels.get(sample.storyId) ?? sample.storyId} | ${sample.profile} | ${sample.branchFloor} | ${sample.prefixFloors} | ${sample.writerModel}（${sample.writerModelId}） | ${sample.temperature} | ${sample.maxTokens} | ${sample.reasoning} | ${sample.memory ? "有" : "无"} | ${sample.director ? "有" : "无"} | ${sample.historicalModel ?? "未记录"} | ${sample.sameModel ? "是" : sample.sameFamily ? "同家族" : "否"} |`,
		);
	}
	lines.push("", "## 叙事质量评分", "");
	if (quality.records === 0) {
		lines.push("没有评分记录。", "");
	}
	lines.push(
		"| 侧 | 样本 | 有效评分 | 原创性 | 人物 | 节奏 | 对话 | 失败 |",
		"|---|---|---|---|---|---|---|---|",
	);
	const qualitySides = new Map(
		quality.bySide.map((group) => [group.side, group]),
	);
	for (const side of ["accepted", "abandoned"] as const) {
		const group = qualitySides.get(side);
		if (group === undefined) {
			lines.push(renderQualityRow(sideLabel(side), 0, 0, null, 0));
			continue;
		}
		const means = new Map(
			group.dimensions.map((dimension) => [dimension.dimension, dimension]),
		);
		lines.push(
			renderQualityRow(
				sideLabel(side),
				group.samples,
				group.scored,
				[
					means.get("originality")?.mean ?? null,
					means.get("character")?.mean ?? null,
					means.get("pacing")?.mean ?? null,
					means.get("dialogue")?.mean ?? null,
				],
				group.failures,
			),
		);
	}
	lines.push("");
	if (options.privateDetails) {
		lines.push("## 按对话的评分均值", "");
		for (const group of quality.byStory) {
			const means = new Map(
				group.dimensions.map((dimension) => [dimension.dimension, dimension]),
			);
			lines.push(
				`- ${labels.get(group.storyId ?? "") ?? group.storyId} ${sideLabel(group.side)}：原创 ${formatMean(means.get("originality")?.mean ?? null)}、人物 ${formatMean(means.get("character")?.mean ?? null)}、节奏 ${formatMean(means.get("pacing")?.mean ?? null)}、对话 ${formatMean(means.get("dialogue")?.mean ?? null)}，有效 ${group.scored}/${group.samples}`,
			);
		}
		lines.push("");
	}
	lines.push("## 失败", "");
	if (summary.failures.length === 0) {
		lines.push("没有失败。");
	} else if (options.privateDetails) {
		lines.push(`共 ${summary.failures.length} 条：`, "");
		for (const failure of summary.failures) {
			lines.push(
				`- ${failure.sampleId}（${failure.profile}，${failure.order}，尝试 ${failure.attempts} 次）：${failure.error}`,
			);
		}
	} else {
		lines.push(`共 ${summary.failures.length} 条，原因不在此列出。`);
	}
	lines.push("");
	return lines.join("\n");
}

function storyLabels(
	samples: readonly HistoricalReplaySample[],
	privateDetails: boolean,
): Map<string, string> {
	const ids = [...new Set(samples.map((sample) => sample.storyId))].sort();
	return new Map(
		ids.map((id, index) => [id, privateDetails ? id : `对话 ${index + 1}`]),
	);
}

function renderGroupRow(
	scope: "总体" | "对话" | "同模型子集",
	storyId: string | null,
	group: HistoricalReplayGroupStats,
	labels: ReadonlyMap<string, string>,
): string {
	const label =
		scope === "对话" ? (labels.get(storyId ?? "") ?? storyId ?? "") : scope;
	return `| ${label} | ${group.profile} | ${group.samples} | ${group.completed} | ${group.judgements} | ${group.generatedWins} | ${group.historicalWins} | ${group.ties} | ${formatRate(group.generatedShare)} | ${formatRate(group.tieShare)} | ${formatRate(group.positionBias)} | ${group.failures} |`;
}

function sideLabel(side: QualitySide): string {
	return side === "accepted" ? "续写" : "历史回复";
}

function renderQualityRow(
	side: string,
	samples: number,
	scored: number,
	means: readonly (number | null)[] | null,
	failures: number,
): string {
	const cells = (means ?? [null, null, null, null]).map(formatMean);
	return `| ${side} | ${samples} | ${scored} | ${cells.join(" | ")} | ${failures} |`;
}

function formatMean(value: number | null): string {
	return value === null ? "—" : value.toFixed(2);
}

function formatRate(value: number | null): string {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}
