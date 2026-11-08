import { createHash } from "node:crypto";
import type {
	LlmClient,
	LlmMessage,
	LlmUsage,
	StoryStore,
	TimelineNode,
} from "@dramaticer/core";
import type { PreferencePair } from "../preferences/export.js";

export const MAX_PAIRWISE_ATTEMPTS = 3;
export const DEFAULT_PAIRWISE_MAX_TOKENS = 512;
export const DEFAULT_PAIRWISE_CONTEXT_FLOORS = 6;

/** 两种展示顺序：接受侧在回复甲，或接受侧在回复乙。 */
export const PAIRWISE_ORDERS = ["accepted-first", "abandoned-first"] as const;
export type PairwiseOrder = (typeof PAIRWISE_ORDERS)[number];

export type PairwiseTask = "reroll" | "choice";
export type PairwiseWinner = "A" | "B" | "tie";
/** 把位置结论换回接受/放弃两侧后的结果。 */
export type NormalizedWinner = "accepted" | "abandoned" | "tie";

export interface PairwiseJudge {
	readonly client: LlmClient;
	readonly model: string;
	readonly maxTokens?: number;
}

export interface PairwiseJudgeInput {
	readonly task: PairwiseTask;
	/** 两份续写共用的上下文，已经按楼层格式化。 */
	readonly context: string;
	/** 排在回复甲位置的文本。 */
	readonly first: string;
	/** 排在回复乙位置的文本。 */
	readonly second: string;
	readonly judge: PairwiseJudge;
}

export interface PairwiseVerdict {
	readonly winner: PairwiseWinner;
	readonly reason: string;
}

export type PairwiseJudgeRecord =
	| {
			readonly status: "done";
			readonly winner: PairwiseWinner;
			readonly reason: string;
			readonly attempts: number;
			readonly usage: LlmUsage | null;
	  }
	| {
			readonly status: "failed";
			readonly winner: null;
			readonly reason: null;
			readonly attempts: number;
			readonly usage: LlmUsage | null;
			readonly error: string;
	  };

const SYSTEM_PROMPTS: Readonly<Record<PairwiseTask, string>> = {
	reroll: `你是故事编辑，正在做盲评。同一分支点的助手回复有两个版本，玩家保留了一个、放弃了另一个。
请只根据最近的对话与两个版本的内容，判断玩家更可能保留哪一个。
两个版本的位置与质量无关：不要因为某个版本排在前面或后面就偏向它。
只有两个版本无法区分时才判平局。
只输出一个 JSON 对象，键为 winner 与 reason，例如 {"winner":"A","reason":"回复甲推进了场景"}。winner 取 "A"、"B" 或 "tie"。reason 用一句话说明依据。不要输出代码块。`,
	choice: `你是故事编辑，正在做盲评。同一楼层的选项块里有两个选项，玩家选择了一个。
请只根据最近的对话与两个选项的内容，判断玩家更可能选择哪一个。
两个选项的位置与质量无关：不要因为某个选项排在前面或后面就偏向它。
只有两个选项无法区分时才判平局。
只输出一个 JSON 对象，键为 winner 与 reason，例如 {"winner":"A","reason":"选项甲更符合玩家前面的意图"}。winner 取 "A"、"B" 或 "tie"。reason 用一句话说明依据。不要输出代码块。`,
};

const CANDIDATE_LABELS: Readonly<
	Record<PairwiseTask, readonly [string, string]>
> = {
	reroll: ["回复甲", "回复乙"],
	choice: ["选项甲", "选项乙"],
};

/** 严格解析裁判输出：只接受 {winner:"A"|"B"|"tie", reason:string}。 */
export function parsePairwiseOutput(text: string): PairwiseVerdict | null {
	let value: unknown;
	try {
		value = JSON.parse(text.trim());
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const keys = Object.keys(value).sort();
	if (keys.length !== 2 || keys[0] !== "reason" || keys[1] !== "winner") {
		return null;
	}
	const record = value as { winner?: unknown; reason?: unknown };
	if (
		record.winner !== "A" &&
		record.winner !== "B" &&
		record.winner !== "tie"
	) {
		return null;
	}
	if (typeof record.reason !== "string" || record.reason.trim().length === 0) {
		return null;
	}
	return { winner: record.winner, reason: record.reason };
}

/** 两种顺序下接受侧的位置，用于把位置结论换回两侧身份。 */
export function acceptedPositionOf(order: PairwiseOrder): "A" | "B" {
	return order === "accepted-first" ? "A" : "B";
}

export function normalizeWinner(
	order: PairwiseOrder,
	winner: PairwiseWinner,
): NormalizedWinner {
	if (winner === "tie") return "tie";
	return winner === acceptedPositionOf(order) ? "accepted" : "abandoned";
}

export function buildPairwiseMessages(input: {
	readonly task: PairwiseTask;
	readonly context: string;
	readonly first: string;
	readonly second: string;
}): LlmMessage[] {
	const [firstLabel, secondLabel] = CANDIDATE_LABELS[input.task];
	const context =
		input.context.trim().length === 0
			? "（没有更早的对话）"
			: input.context.trim();
	return [
		{ role: "system", content: SYSTEM_PROMPTS[input.task] },
		{
			role: "user",
			content: [
				`最近的对话：\n${context}`,
				`${firstLabel}：\n${input.first}`,
				`${secondLabel}：\n${input.second}`,
				"请判断并只输出 JSON。",
			].join("\n\n"),
		},
	];
}

/**
 * 让裁判比较两份文本。两份完全相同时不调用模型，直接判平局：
 * 顺序无论如何交换都不能产生位置偏差。
 */
export async function judgePairwise(
	input: PairwiseJudgeInput,
): Promise<PairwiseJudgeRecord> {
	if (input.first === input.second) {
		return {
			status: "done",
			winner: "tie",
			reason: "两份文本完全相同",
			attempts: 0,
			usage: null,
		};
	}
	const baseMessages = buildPairwiseMessages(input);
	let usage: LlmUsage | null = null;
	let lastProblem = "";
	for (let attempt = 1; attempt <= MAX_PAIRWISE_ATTEMPTS; attempt += 1) {
		const messages: LlmMessage[] =
			attempt === 1
				? baseMessages
				: [
						...baseMessages,
						{
							role: "user",
							content: `上一次输出不是合法的判定 JSON（${lastProblem}）。只输出 {"winner":"A"|"B"|"tie","reason":"…"}，不要代码块。`,
						},
					];
		let text: string;
		try {
			const result = await input.judge.client.complete({
				messages,
				model: input.judge.model,
				temperature: 0,
				maxTokens: input.judge.maxTokens ?? DEFAULT_PAIRWISE_MAX_TOKENS,
			});
			text = result.text;
			usage = result.usage;
		} catch (error) {
			return {
				status: "failed",
				winner: null,
				reason: null,
				attempts: attempt,
				usage,
				error: `裁判调用失败：${error instanceof Error ? error.message : String(error)}`,
			};
		}
		const verdict = parsePairwiseOutput(text);
		if (verdict !== null) {
			return {
				status: "done",
				winner: verdict.winner,
				reason: verdict.reason,
				attempts: attempt,
				usage,
			};
		}
		lastProblem = "缺少 winner 或 reason、winner 不是 A/B/tie，或包含多余字段";
	}
	return {
		status: "failed",
		winner: null,
		reason: null,
		attempts: MAX_PAIRWISE_ATTEMPTS,
		usage,
		error: `裁判连续 ${MAX_PAIRWISE_ATTEMPTS} 次没有输出合法的 {winner, reason}`,
	};
}

/** 从导出文件读回的回复对；只接受 `preferences export` 写出的字段。 */
export function parsePreferencePairsJsonl(
	text: string,
	source: string,
): PreferencePair[] {
	const pairs: PreferencePair[] = [];
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
		pairs.push(parsePreferencePair(value, `${source} 第 ${index + 1} 行`));
	});
	return pairs;
}

function parsePreferencePair(value: unknown, where: string): PreferencePair {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${where} 必须是 JSON 对象`);
	}
	const record = value as Record<string, unknown>;
	const expected = [
		"abandoned",
		"accepted",
		"anchorNodeId",
		"createdAt",
		"kind",
		"sourceEventId",
		"storyId",
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
	const storyId = requireText(record.storyId, `${where} 的 storyId`);
	const sourceEventId = requireText(
		record.sourceEventId,
		`${where} 的 sourceEventId`,
	);
	const anchorNodeId = requireText(
		record.anchorNodeId,
		`${where} 的 anchorNodeId`,
	);
	const createdAt = requireText(record.createdAt, `${where} 的 createdAt`);
	if (record.kind !== "reroll" && record.kind !== "choice") {
		throw new Error(`${where} 的 kind 必须是 reroll 或 choice`);
	}
	const accepted = parsePairSide(record.accepted, `${where} 的 accepted`);
	const abandoned = parsePairSide(record.abandoned, `${where} 的 abandoned`);
	return {
		storyId,
		kind: record.kind,
		sourceEventId,
		anchorNodeId,
		createdAt,
		accepted,
		abandoned,
	};
}

function parsePairSide(
	value: unknown,
	where: string,
): { readonly nodeId: string | null; readonly text: string } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${where} 必须是 JSON 对象`);
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	if (keys.length !== 2 || keys[0] !== "nodeId" || keys[1] !== "text") {
		throw new Error(`${where} 的字段必须是 nodeId 与 text`);
	}
	const nodeId = record.nodeId;
	if (nodeId !== null && typeof nodeId !== "string") {
		throw new Error(`${where} 的 nodeId 必须是字符串或 null`);
	}
	return {
		nodeId: nodeId === null ? null : requireText(nodeId, `${where} 的 nodeId`),
		text: requireText(record.text, `${where} 的 text`),
	};
}

function requireText(value: unknown, where: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${where} 必须是非空字符串`);
	}
	return value;
}

export interface PreferenceSample {
	readonly sampleId: string;
	readonly storyId: string;
	readonly kind: PairwiseTask;
	readonly sourceEventId: string;
	/** 接受侧不是同一父楼层下最新的助手回复：玩家切回较早的 swipe。 */
	readonly earlierSwipe: boolean;
	readonly context: string;
	readonly acceptedText: string;
	readonly abandonedText: string;
}

/**
 * 用导出对构造盲测样本。`reroll` 的两侧必须是同一父楼层的助手回复；
 * `choice` 的语境取选项所在楼层及其路径。
 */
export function buildPreferenceSample(
	store: StoryStore,
	pair: PreferencePair,
): PreferenceSample {
	if (pair.kind === "reroll") {
		const acceptedId = pair.accepted.nodeId;
		const abandonedId = pair.abandoned.nodeId;
		if (acceptedId === null || abandonedId === null) {
			throw new Error(
				`回复对 ${pair.sourceEventId} 的 reroll 两侧必须都有楼层 id`,
			);
		}
		const accepted = requireNode(store, acceptedId, pair);
		const abandoned = requireNode(store, abandonedId, pair);
		if (accepted.role !== "assistant" || abandoned.role !== "assistant") {
			throw new Error(`回复对 ${pair.sourceEventId} 的两侧必须是助手楼层`);
		}
		if (accepted.parentId !== abandoned.parentId) {
			throw new Error(
				`回复对 ${pair.sourceEventId} 的两侧不在同一分支点：${accepted.parentId ?? "根"} 与 ${abandoned.parentId ?? "根"}`,
			);
		}
		const path =
			accepted.parentId === null ? [] : store.getPathToNode(accepted.parentId);
		return {
			sampleId: preferenceSampleId(pair),
			storyId: pair.storyId,
			kind: "reroll",
			sourceEventId: pair.sourceEventId,
			earlierSwipe: hasLaterSibling(store, accepted),
			context: formatContext(path),
			acceptedText: pair.accepted.text,
			abandonedText: pair.abandoned.text,
		};
	}
	if (pair.accepted.nodeId !== null || pair.abandoned.nodeId !== null) {
		throw new Error(
			`回复对 ${pair.sourceEventId} 的 choice 两侧不应该有楼层 id`,
		);
	}
	const anchor = requireNode(store, pair.anchorNodeId, pair);
	return {
		sampleId: preferenceSampleId(pair),
		storyId: pair.storyId,
		kind: "choice",
		sourceEventId: pair.sourceEventId,
		earlierSwipe: false,
		context: formatContext(store.getPathToNode(anchor.id)),
		acceptedText: pair.accepted.text,
		abandonedText: pair.abandoned.text,
	};
}

/** 同一选项事件会拆成多个回复对，用放弃侧的短哈希区分样本。 */
function preferenceSampleId(pair: PreferencePair): string {
	const key = pair.abandoned.nodeId ?? pair.abandoned.text;
	const hash = createHash("sha256").update(key).digest("hex").slice(0, 12);
	return `${pair.storyId}:${pair.sourceEventId}:${hash}`;
}

function requireNode(
	store: StoryStore,
	nodeId: string,
	pair: PreferencePair,
): TimelineNode {
	const node = store.getNode(nodeId);
	if (node === null) {
		throw new Error(`回复对 ${pair.sourceEventId} 引用的楼层不存在：${nodeId}`);
	}
	if (node.storyId !== pair.storyId) {
		throw new Error(
			`回复对 ${pair.sourceEventId} 引用的楼层属于另一个故事：${nodeId}`,
		);
	}
	return node;
}

function formatContext(nodes: readonly TimelineNode[]): string {
	return nodes
		.slice(-DEFAULT_PAIRWISE_CONTEXT_FLOORS)
		.map((node) => `${node.role === "user" ? "玩家" : "角色"}：${node.raw}`)
		.join("\n\n");
}

/** 同一父楼层下是否存在更晚创建的同类回复。 */
function hasLaterSibling(store: StoryStore, node: TimelineNode): boolean {
	const nodes = store.listStoryNodes(node.storyId);
	const index = nodes.findIndex((entry) => entry.id === node.id);
	if (index < 0) {
		throw new Error(`楼层不在故事 ${node.storyId} 里：${node.id}`);
	}
	return nodes
		.slice(index + 1)
		.some(
			(entry) => entry.parentId === node.parentId && entry.role === node.role,
		);
}

export type PreferenceComparisonRecord = {
	readonly sampleId: string;
	readonly storyId: string;
	readonly kind: PairwiseTask;
	readonly earlierSwipe: boolean;
	readonly order: PairwiseOrder;
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

type DoneComparisonRecord = Extract<
	PreferenceComparisonRecord,
	{ readonly status: "done" }
>;

/** 同一样本按两种顺序各判一次；每次判定单独返回，便于逐条落盘。 */
export async function runPreferenceSample(
	sample: PreferenceSample,
	judge: PairwiseJudge,
	options: { readonly now?: () => string } = {},
): Promise<PreferenceComparisonRecord[]> {
	const now = options.now ?? (() => new Date().toISOString());
	const records: PreferenceComparisonRecord[] = [];
	for (const order of PAIRWISE_ORDERS) {
		const acceptedFirst = order === "accepted-first";
		const verdict = await judgePairwise({
			task: sample.kind,
			context: sample.context,
			first: acceptedFirst ? sample.acceptedText : sample.abandonedText,
			second: acceptedFirst ? sample.abandonedText : sample.acceptedText,
			judge,
		});
		const base = {
			sampleId: sample.sampleId,
			storyId: sample.storyId,
			kind: sample.kind,
			earlierSwipe: sample.earlierSwipe,
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

export interface PairwiseGroupStats {
	readonly group: string;
	readonly samples: number;
	readonly judgements: number;
	readonly completed: number;
	readonly acceptedWins: number;
	readonly abandonedWins: number;
	readonly ties: number;
	readonly inconsistent: number;
	readonly consensusAccepted: number;
	readonly consensusAbandoned: number;
	readonly consensusTie: number;
	readonly acceptedShare: number | null;
	readonly tieShare: number | null;
	readonly positionBias: number | null;
	readonly preferenceConsistency: number | null;
	readonly failures: number;
}

export interface PairwiseFailure {
	readonly sampleId: string;
	readonly storyId: string;
	readonly kind: PairwiseTask;
	readonly order: PairwiseOrder;
	readonly attempts: number;
	readonly error: string;
}

export interface PreferenceComparisonSummary {
	readonly groups: readonly PairwiseGroupStats[];
	readonly failures: readonly PairwiseFailure[];
	readonly records: number;
}

interface GroupDefinition {
	readonly label: string;
	readonly includes: (record: PreferenceComparisonRecord) => boolean;
}

/** 总体一致率不含切回较早 swipe 的样本；该子集单列。 */
const GROUP_DEFINITIONS: readonly GroupDefinition[] = [
	{
		label: "总体（不含切回较早 swipe）",
		includes: (record) => record.kind === "choice" || !record.earlierSwipe,
	},
	{
		label: "重 roll（全部）",
		includes: (record) => record.kind === "reroll",
	},
	{
		label: "重 roll：接受的是最新 swipe",
		includes: (record) => record.kind === "reroll" && !record.earlierSwipe,
	},
	{
		label: "重 roll：切回较早 swipe",
		includes: (record) => record.kind === "reroll" && record.earlierSwipe,
	},
	{
		label: "选项选择",
		includes: (record) => record.kind === "choice",
	},
];

/**
 * 同一样本同一顺序有多行时取最后一行；统计口径与 F0-T03 一致：
 * 胜率是顺序级判定占比，位置偏差是两种顺序结论不一致的样本占比。
 */
export function summarizePreferenceComparisons(
	records: readonly PreferenceComparisonRecord[],
): PreferenceComparisonSummary {
	const latest = new Map<string, PreferenceComparisonRecord>();
	for (const record of records) {
		latest.set(`${record.sampleId}\u0000${record.order}`, record);
	}
	const deduped = [...latest.values()];
	const groups = GROUP_DEFINITIONS.map((definition) =>
		summarizeGroup(
			definition.label,
			deduped.filter((record) => definition.includes(record)),
		),
	);
	const failures = deduped
		.filter((record) => record.status === "failed")
		.map((record) => ({
			sampleId: record.sampleId,
			storyId: record.storyId,
			kind: record.kind,
			order: record.order,
			attempts: record.attempts,
			error: record.error ?? "未知错误",
		}))
		.sort((left, right) => {
			const leftKey = `${left.sampleId}\u0000${left.order}`;
			const rightKey = `${right.sampleId}\u0000${right.order}`;
			return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
		});
	return { groups, failures, records: deduped.length };
}

function summarizeGroup(
	group: string,
	records: readonly PreferenceComparisonRecord[],
): PairwiseGroupStats {
	const bySample = new Map<
		string,
		Map<PairwiseOrder, PreferenceComparisonRecord>
	>();
	for (const record of records) {
		let orders = bySample.get(record.sampleId);
		if (orders === undefined) {
			orders = new Map();
			bySample.set(record.sampleId, orders);
		}
		orders.set(record.order, record);
	}
	let judgements = 0;
	let acceptedWins = 0;
	let abandonedWins = 0;
	let ties = 0;
	let completed = 0;
	let inconsistent = 0;
	let consensusAccepted = 0;
	let consensusAbandoned = 0;
	let consensusTie = 0;
	for (const orders of bySample.values()) {
		const first = orders.get("accepted-first");
		const second = orders.get("abandoned-first");
		const done = [first, second].filter(
			(record): record is DoneComparisonRecord =>
				record !== undefined && record.status === "done",
		);
		for (const record of done) {
			judgements += 1;
			const normalized = normalizeWinner(record.order, record.winner);
			if (normalized === "accepted") acceptedWins += 1;
			else if (normalized === "abandoned") abandonedWins += 1;
			else ties += 1;
		}
		if (first?.status !== "done" || second?.status !== "done") continue;
		completed += 1;
		const firstNormalized = normalizeWinner(first.order, first.winner);
		const secondNormalized = normalizeWinner(second.order, second.winner);
		if (firstNormalized !== secondNormalized) {
			inconsistent += 1;
			continue;
		}
		if (firstNormalized === "accepted") consensusAccepted += 1;
		else if (firstNormalized === "abandoned") consensusAbandoned += 1;
		else consensusTie += 1;
	}
	return {
		group,
		samples: bySample.size,
		judgements,
		completed,
		acceptedWins,
		abandonedWins,
		ties,
		inconsistent,
		consensusAccepted,
		consensusAbandoned,
		consensusTie,
		acceptedShare: judgements === 0 ? null : acceptedWins / judgements,
		tieShare: judgements === 0 ? null : ties / judgements,
		positionBias: completed === 0 ? null : inconsistent / completed,
		preferenceConsistency:
			completed === 0 ? null : consensusAccepted / completed,
		failures: records.filter((record) => record.status === "failed").length,
	};
}

/** 读回逐条判定记录，用于续跑与只读报告。 */
export function parseComparisonRecordsJsonl(
	text: string,
	source: string,
): PreferenceComparisonRecord[] {
	const records: PreferenceComparisonRecord[] = [];
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
		records.push(parseComparisonRecord(value, `${source} 第 ${index + 1} 行`));
	});
	return records;
}

function parseComparisonRecord(
	value: unknown,
	where: string,
): PreferenceComparisonRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${where} 必须是 JSON 对象`);
	}
	const record = value as Record<string, unknown>;
	const expected = [
		"attempts",
		"createdAt",
		"earlierSwipe",
		"error",
		"kind",
		"model",
		"order",
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
	if (record.kind !== "reroll" && record.kind !== "choice") {
		throw new Error(`${where} 的 kind 必须是 reroll 或 choice`);
	}
	const kind: PairwiseTask = record.kind;
	if (!PAIRWISE_ORDERS.includes(record.order as PairwiseOrder)) {
		throw new Error(`${where} 的 order 不合法`);
	}
	if (typeof record.earlierSwipe !== "boolean") {
		throw new Error(`${where} 的 earlierSwipe 必须是布尔值`);
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
		earlierSwipe: record.earlierSwipe,
		order: record.order as PairwiseOrder,
		attempts: record.attempts,
		usage: record.usage as LlmUsage | null,
		model: requireText(record.model, `${where} 的 model`),
		createdAt: requireText(record.createdAt, `${where} 的 createdAt`),
	};
	if (record.status === "done") {
		if (!isPairwiseWinner(record.winner)) {
			throw new Error(`${where} 的 winner 不合法`);
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

function isPairwiseWinner(value: unknown): value is PairwiseWinner {
	return value === "A" || value === "B" || value === "tie";
}

export interface PairwiseReportOptions {
	readonly privateDetails: boolean;
	readonly model: string;
	readonly generatedAt: string;
	/** 私有版列出样本文件；统计版不显示。 */
	readonly sampleSources?: readonly string[];
}

export function renderPairwiseReport(
	summary: PreferenceComparisonSummary,
	options: PairwiseReportOptions,
): string {
	const title = options.privateDetails
		? "# R2-T04 盲测两两对比（私有版）"
		: "# R2-T04 盲测两两对比（统计版）";
	const lines = [
		title,
		"",
		`- 生成时间：${options.generatedAt}`,
		`- 裁判模型：${options.model}`,
	];
	if (options.privateDetails && options.sampleSources !== undefined) {
		lines.push(`- 样本来源：${options.sampleSources.join("、") || "无"}`);
	}
	lines.push(
		"- 判定口径：同一样本按接受侧在前、接受侧在后各判一次；胜率与平局率按单次顺序判定统计；位置偏差是两种顺序结论不一致的样本占双向完成样本的比例；偏好一致率是双向结论都选中接受侧（玩家实际选择）的样本占双向完成样本的比例。总体一致率不含切回较早 swipe 的子集。",
		"",
		"## 分组数字",
		"",
		"| 组 | 样本 | 双向完成 | 顺序判定 | 接受胜 | 放弃胜 | 平局 | 接受胜率 | 平局率 | 位置偏差 | 偏好一致率 | 失败 |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|",
	);
	for (const group of summary.groups) {
		lines.push(
			`| ${group.group} | ${group.samples} | ${group.completed} | ${group.judgements} | ${group.acceptedWins} | ${group.abandonedWins} | ${group.ties} | ${formatRate(group.acceptedShare)} | ${formatRate(group.tieShare)} | ${formatRate(group.positionBias)} | ${formatRate(group.preferenceConsistency)} | ${group.failures} |`,
		);
	}
	lines.push("", "## 失败", "");
	if (summary.failures.length === 0) {
		lines.push("没有失败。");
	} else if (options.privateDetails) {
		lines.push(`共 ${summary.failures.length} 条：`, "");
		for (const failure of summary.failures) {
			lines.push(
				`- ${failure.sampleId}（${failure.kind}，${failure.order}，尝试 ${failure.attempts} 次）：${failure.error}`,
			);
		}
	} else {
		lines.push(`共 ${summary.failures.length} 条，原因不在此列出。`);
	}
	lines.push("");
	return lines.join("\n");
}

function formatRate(value: number | null): string {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}
