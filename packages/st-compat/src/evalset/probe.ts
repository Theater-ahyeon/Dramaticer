import {
	type ContextSlotProviders,
	type ContextTemplate,
	type JsonValue,
	type LlmClient,
	type LlmMessage,
	type LlmResult,
	type LlmUsage,
	NO_CONTINUATION,
	type StoryStore,
	assembleContext,
	readLedger,
	readLedgerFacts,
} from "@dramaticer/core";
import type { PlaytestRecord } from "./playtest.js";

export const DEFAULT_PROBE_EVERY = 10;
export const DEFAULT_PROBE_MIN_AGE_FLOORS = 20;
export const MAX_PROBE_JUDGE_ATTEMPTS = 3;
export const DEFAULT_PROBE_MAX_TOKENS = 1_024;
export const DEFAULT_PROBE_TEMPERATURE = 0.3;
/** 探针只针对可读的短文本事实；过长的值不适合直接出题。 */
const MAX_FACT_VALUE_LENGTH = 300;

/** 这些命名空间的事实不进入探针：用户意志考的是指令遵循，MVU 是导入的原始变量。 */
const EXCLUDED_NAMESPACES: Readonly<Record<string, true>> = {
	userWill: true,
	mvu: true,
};

/** 一条适合出回忆题的台账事实。 */
export interface ProbeFact {
	readonly path: readonly string[];
	/** 最后写入这条事实的楼层。 */
	readonly nodeId: string;
	/** 事实写入楼层与当前 head 之间相隔的楼层数。 */
	readonly ageFloors: number;
	readonly value: JsonValue;
}

export interface PlaytestProbeOptions {
	/** 每多少轮插入一次探针；0 表示关闭。 */
	readonly every: number;
	/** 事实至少要早于 head 多少楼才会被选中。 */
	readonly minAgeFloors?: number;
	readonly judge: {
		readonly client: LlmClient;
		readonly model: string;
	};
	readonly maxTokens?: number;
	readonly temperature?: number;
}

export type ProbeVerdict = "consistent" | "contradicted" | "unknown";

export interface ProbeJudgeVerdict {
	readonly verdict: ProbeVerdict;
	readonly reason: string;
}

/** 答题请求里实际进入上下文的一段；遗忘漏斗据此判断事实有没有进 prompt。 */
export interface ProbeContextSegment {
	readonly segmentId: string;
	readonly slot: string | null;
	readonly source: string;
	/** 这一段的全部消息正文，按顺序用空行拼接。 */
	readonly text: string;
}

export interface PlaytestProbeRecord {
	/** done 表示裁判给出判定；failed 表示探针或裁判出错；skipped 表示没有可出题的事实。 */
	readonly status: "done" | "failed" | "skipped";
	readonly round: number;
	/** 探针执行时的 head；探针不改变它。 */
	readonly nodeId: string;
	readonly fact: ProbeFact | null;
	/** 答题请求实际带上的上下文段；组装失败或跳过的探针为空数组。 */
	readonly context: readonly ProbeContextSegment[];
	readonly question: string | null;
	readonly answer: string | null;
	readonly verdict: ProbeVerdict | null;
	readonly reason: string | null;
	readonly judgeAttempts: number;
	readonly error: string | null;
	readonly answerUsage: LlmUsage | null;
	readonly judgeUsage: LlmUsage | null;
}

export interface PlaytestProbeInput {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly round: number;
	readonly headNodeId: string;
	readonly minAgeFloors: number;
	readonly random: () => number;
	readonly template: ContextTemplate;
	readonly providers: ContextSlotProviders;
	readonly budgetTokens: number;
	readonly assistant: {
		readonly client: LlmClient;
		readonly model: string;
	};
	readonly judge: {
		readonly client: LlmClient;
		readonly model: string;
		readonly maxTokens?: number;
	};
	readonly maxTokens: number;
	readonly temperature: number;
}

/**
 * 从当前台账里挑一条至少 `minAgeFloors` 楼之前写入的文本事实。
 * 选择用调用方的随机函数决定，保证同一份种子重复运行时题目一致。
 */
export function selectProbeFact(
	store: StoryStore,
	headNodeId: string,
	minAgeFloors: number,
	random: () => number,
): ProbeFact | null {
	if (!Number.isInteger(minAgeFloors) || minAgeFloors < 1) {
		throw new Error(`探针事实的最小楼层年龄必须是正整数，收到 ${minAgeFloors}`);
	}
	const path = store.getPathToNode(headNodeId);
	if (path.length === 0) return null;
	const depth = new Map<string, number>();
	path.forEach((node, index) => {
		depth.set(node.id, index);
	});
	const headIndex = path.length - 1;
	const eligible: ProbeFact[] = [];
	for (const fact of readLedgerFacts(store, headNodeId)) {
		const namespace = fact.path[0] ?? "";
		if (EXCLUDED_NAMESPACES[namespace] === true) continue;
		if (typeof fact.value !== "string") continue;
		if (fact.value.trim().length === 0) continue;
		if (fact.value.length > MAX_FACT_VALUE_LENGTH) continue;
		const written = depth.get(fact.nodeId);
		if (written === undefined) continue;
		const ageFloors = headIndex - written;
		if (ageFloors < minAgeFloors) continue;
		const probeFact: ProbeFact = {
			path: fact.path,
			nodeId: fact.nodeId,
			ageFloors,
			value: fact.value,
		};
		if (buildProbeQuestion(probeFact) === null) continue;
		eligible.push(probeFact);
	}
	if (eligible.length === 0) return null;
	const index = Math.min(
		eligible.length - 1,
		Math.floor(random() * eligible.length),
	);
	return eligible[index] ?? null;
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
	identity: "身份",
	appearance: "外貌",
	outfit: "衣着",
	status: "状态",
	location: "所在位置",
	tier: "角色层级",
	type: "关系类型",
	stage: "关系阶段",
	turningPoint: "关系转折",
	affectionInner: "内在好感",
	affectionOuter: "外在好感",
	inertia: "关系惯性",
	holder: "持有者",
	origin: "来历",
	name: "名称",
	description: "描述",
	parent: "上级地点",
	place: "当前地点",
	posture: "当前架势",
	atmosphere: "当前氛围",
	participants: "在场人物",
	text: "内容",
	openedAt: "开启时间",
	updatedAt: "更新时间",
	current: "当前故事时间",
};

const QUESTION_SUFFIX =
	"只回答你记得的内容，用一到三句话；记不清就说记不清，不要编造。";

/**
 * 把台账路径转成不泄露答案的回忆题；路径形状不认识时返回 null，
 * 这类事实不进入探针。
 */
export function buildProbeQuestion(fact: ProbeFact): string | null {
	const [namespace, ...rest] = fact.path;
	const field = (segment: string | undefined): string => {
		if (segment === undefined) return "内容";
		return FIELD_LABELS[segment] ?? segment;
	};
	switch (namespace) {
		case "character":
			return rest[0] === undefined || rest[1] === undefined
				? null
				: `请回忆：角色「${rest[0]}」的${field(rest[1])}是什么？${QUESTION_SUFFIX}`;
		case "relation":
			return rest[0] === undefined ||
				rest[1] === undefined ||
				rest[2] === undefined
				? null
				: `请回忆：角色「${rest[0]}」与「${rest[1]}」之间的${field(rest[2])}是什么？${QUESTION_SUFFIX}`;
		case "item":
			return rest[0] === undefined || rest[1] === undefined
				? null
				: `请回忆：物品「${rest[0]}」的${field(rest[1])}是什么？${QUESTION_SUFFIX}`;
		case "scene":
			if (rest[0] === "places") {
				return rest[1] === undefined || rest[2] === undefined
					? null
					: `请回忆：地点「${rest[1]}」的${field(rest[2])}是什么？${QUESTION_SUFFIX}`;
			}
			if (rest[0] === "current") {
				return rest[1] === undefined
					? null
					: `请回忆：当前场景的${field(rest[1])}是什么？${QUESTION_SUFFIX}`;
			}
			return null;
		case "time":
			return rest[0] === "current"
				? `请回忆：故事现在进行到什么时间？${QUESTION_SUFFIX}`
				: null;
		case "clue":
			return rest[0] === undefined || rest[1] === undefined
				? null
				: `请回忆：线索（编号 ${rest[0]}）的${field(rest[1])}是什么？${QUESTION_SUFFIX}`;
		case "knowledge":
			return rest[0] === undefined || rest[1] === undefined
				? null
				: `请回忆：角色「${rest[0]}」知道关于「${rest[1]}」的什么内容？${QUESTION_SUFFIX}`;
		default:
			return null;
	}
}

export const PROBE_INSTRUCTION = `下面这个问题用来检验你对这段故事的记忆。请不要写后续情节，也不要解释你在做什么。

`;

/** 严格解析裁判输出：只接受 {consistent: boolean | "unknown", reason: string}。 */
export function parseProbeJudgeOutput(text: string): ProbeJudgeVerdict | null {
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
	if (keys.length !== 2 || keys[0] !== "consistent" || keys[1] !== "reason") {
		return null;
	}
	const record = value as { consistent?: unknown; reason?: unknown };
	const reason = record.reason;
	if (typeof reason !== "string" || reason.trim().length === 0) return null;
	if (record.consistent === true) return { verdict: "consistent", reason };
	if (record.consistent === false) return { verdict: "contradicted", reason };
	if (record.consistent === "unknown") return { verdict: "unknown", reason };
	return null;
}

const JUDGE_SYSTEM_PROMPT = `你是剧情一致性裁判。你会看到一道回忆题、模型对它的回答，以及故事当前的台账快照。判断回答是否与台账一致：
- 回答与台账相符：consistent 写 true。
- 回答与台账矛盾，或捏造了台账里没有的具体事实：consistent 写 false。
- 台账不足以判断（问题无关、回答含糊、台账里没有对应信息）：consistent 写 "unknown"。
只输出一个 JSON 对象，键为 consistent 与 reason，例如 {"consistent":true,"reason":"台账写明……"}。reason 用一句话说明依据。不要输出代码块。`;

export interface AnswerJudgeInput {
	readonly judge: {
		readonly client: LlmClient;
		readonly model: string;
		readonly maxTokens?: number;
	};
	readonly question: string;
	readonly answer: string;
	readonly snapshot: JsonValue;
	/** 记忆题的标准答案；探针没有这一项。 */
	readonly referenceAnswer?: string;
	/** 记忆题的证据楼层原文；探针没有这一项。 */
	readonly evidenceText?: string;
	/** 编造回忆题：问题问的是从未发生的人、事、物。 */
	readonly fabricated?: boolean;
}

export interface AnswerJudgeResult {
	readonly status: "done" | "failed";
	readonly verdict: ProbeVerdict | null;
	readonly reason: string | null;
	readonly attempts: number;
	readonly error: string | null;
	readonly usage: LlmUsage | null;
}

/**
 * 一致性探针与记忆评测共用的判分：同一套裁判提示词、严格 JSON 解析与
 * 重试语义。`referenceAnswer`、`evidenceText`、`fabricated` 只给记忆题补充依据。
 */
export async function judgeAnswerConsistency(
	input: AnswerJudgeInput,
): Promise<AnswerJudgeResult> {
	const parts = [
		`问题：${input.question}`,
		`模型回答：${input.answer}`,
		`台账快照（JSON）：\n${JSON.stringify(input.snapshot)}`,
	];
	if (input.referenceAnswer !== undefined) {
		parts.push(`参考答案：${input.referenceAnswer}`);
	}
	if (input.evidenceText !== undefined && input.evidenceText.length > 0) {
		parts.push(`证据楼层原文：\n${input.evidenceText}`);
	}
	if (input.fabricated === true) {
		parts.push(
			"这是编造回忆题：问题问的是从未发生的人、事、物。明确否认或拒答算一致；肯定描述不存在的人、事、物算不一致。",
		);
	}
	const baseMessages: LlmMessage[] = [
		{ role: "system", content: JUDGE_SYSTEM_PROMPT },
		{ role: "user", content: parts.join("\n\n") },
	];
	let usage: LlmUsage | null = null;
	let lastProblem = "";
	for (let attempt = 1; attempt <= MAX_PROBE_JUDGE_ATTEMPTS; attempt += 1) {
		const messages: LlmMessage[] =
			attempt === 1
				? baseMessages
				: [
						...baseMessages,
						{
							role: "user",
							content: `上一次输出不是合法的判定 JSON（${lastProblem}）。这是第 ${attempt} 次尝试，只输出 {"consistent":true|false|"unknown","reason":"…"}，不要代码块，不要多余字段。`,
						},
					];
		let result: LlmResult;
		try {
			result = await input.judge.client.complete(
				{
					messages,
					model: input.judge.model,
					temperature: 0,
					...(input.judge.maxTokens === undefined
						? {}
						: { maxTokens: input.judge.maxTokens }),
				},
				NO_CONTINUATION,
			);
		} catch (error) {
			return {
				status: "failed",
				verdict: null,
				reason: null,
				attempts: attempt,
				error: `裁判调用失败：${error instanceof Error ? error.message : String(error)}`,
				usage,
			};
		}
		usage = result.usage;
		const verdict = parseProbeJudgeOutput(result.text);
		if (verdict !== null) {
			return {
				status: "done",
				verdict: verdict.verdict,
				reason: verdict.reason,
				attempts: attempt,
				error: null,
				usage,
			};
		}
		lastProblem = "缺少 consistent 或 reason，或包含多余字段";
	}
	return {
		status: "failed",
		verdict: null,
		reason: null,
		attempts: MAX_PROBE_JUDGE_ATTEMPTS,
		error: `裁判连续 ${MAX_PROBE_JUDGE_ATTEMPTS} 次没有输出合法的 {consistent, reason}`,
		usage,
	};
}

/** 执行一次探针：出题、生成回答、交裁判判定；不写楼层，也不改 head。 */
export async function runPlaytestProbe(
	input: PlaytestProbeInput,
): Promise<PlaytestProbeRecord> {
	const headBefore = input.store.getHead(input.storyId);
	if (headBefore === null || headBefore.id !== input.headNodeId) {
		throw new Error(`探针的 head 已变化：期望 ${input.headNodeId}`);
	}
	const fact = selectProbeFact(
		input.store,
		input.headNodeId,
		input.minAgeFloors,
		input.random,
	);
	if (fact === null) {
		return {
			status: "skipped",
			round: input.round,
			nodeId: input.headNodeId,
			fact: null,
			context: [],
			question: null,
			answer: null,
			verdict: null,
			reason: null,
			judgeAttempts: 0,
			error: `没有至少 ${input.minAgeFloors} 楼之前的文本台账事实`,
			answerUsage: null,
			judgeUsage: null,
		};
	}
	const question = buildProbeQuestion(fact);
	if (question === null) {
		throw new Error(`无法为台账路径 ${fact.path.join(".")} 生成探针问题`);
	}
	let answer: string;
	let answerUsage: LlmUsage | null;
	let context: ProbeContextSegment[] = [];
	try {
		const assembled = await assembleContext({
			template: input.template,
			budgetTokens: input.budgetTokens,
			storyId: input.storyId,
			nodeId: input.headNodeId,
			providers: input.providers,
		});
		context = assembled.segments.map((segment) => ({
			segmentId: segment.segmentId,
			slot: segment.slot,
			source: segment.source,
			text: segment.messages.map((message) => message.content).join("\n\n"),
		}));
		const result = await input.assistant.client.complete({
			messages: [
				...assembled.messages,
				{ role: "user", content: `${PROBE_INSTRUCTION}${question}` },
			],
			model: input.assistant.model,
			temperature: input.temperature,
			maxTokens: input.maxTokens,
		});
		answer = result.text.trim();
		answerUsage = result.usage;
		if (answer.length === 0) {
			throw new Error("探针回答为空");
		}
	} catch (error) {
		const headAfter = input.store.getHead(input.storyId);
		if (headAfter?.id !== headBefore.id) {
			throw new Error("探针修改了 head");
		}
		return {
			status: "failed",
			round: input.round,
			nodeId: input.headNodeId,
			fact,
			context,
			question,
			answer: null,
			verdict: null,
			reason: null,
			judgeAttempts: 0,
			error: error instanceof Error ? error.message : String(error),
			answerUsage: null,
			judgeUsage: null,
		};
	}

	const snapshot = readLedger(input.store, input.headNodeId) ?? {};
	const judged = await judgeAnswerConsistency({
		judge: input.judge,
		question,
		answer,
		snapshot,
	});
	const headAfter = input.store.getHead(input.storyId);
	if (headAfter?.id !== headBefore.id) {
		throw new Error("探针修改了 head");
	}
	return {
		status: judged.status,
		round: input.round,
		nodeId: input.headNodeId,
		fact,
		context,
		question,
		answer,
		verdict: judged.verdict,
		reason: judged.reason,
		judgeAttempts: judged.attempts,
		error: judged.error,
		answerUsage,
		judgeUsage: judged.usage,
	};
}

export interface ProbeSample {
	/** 同一故事内从 1 开始的样例编号。 */
	readonly index: number;
	readonly round: number;
	readonly record: PlaytestProbeRecord;
}

export interface ProbeStorySummary {
	readonly storyId: string;
	/** 真正执行过的探针数（done 加 failed），跳过的不算。 */
	readonly attempted: number;
	readonly consistent: number;
	readonly contradicted: number;
	readonly unknown: number;
	readonly failed: number;
	readonly skipped: number;
	/** 矛盾数除以（一致加矛盾）；没有可判定的样本时为 0。 */
	readonly contradictionRate: number;
	readonly samples: readonly ProbeSample[];
}

/** 按故事聚合试玩记录里的探针结果。 */
export function summarizePlaytestProbes(
	records: readonly PlaytestRecord[],
): ProbeStorySummary[] {
	const byStory = new Map<string, PlaytestProbeRecord[]>();
	for (const record of records) {
		if (record.probe === null) continue;
		const list = byStory.get(record.storyId) ?? [];
		list.push(record.probe);
		byStory.set(record.storyId, list);
	}
	const summaries: ProbeStorySummary[] = [];
	for (const storyId of [...byStory.keys()].sort()) {
		const probes = byStory.get(storyId) ?? [];
		let consistent = 0;
		let contradicted = 0;
		let unknown = 0;
		let failed = 0;
		let skipped = 0;
		let attempted = 0;
		const samples: ProbeSample[] = [];
		for (const probe of probes) {
			if (probe.status === "skipped") {
				skipped += 1;
				continue;
			}
			attempted += 1;
			samples.push({
				index: samples.length + 1,
				round: probe.round,
				record: probe,
			});
			if (probe.status === "failed") {
				failed += 1;
				continue;
			}
			if (probe.verdict === "consistent") consistent += 1;
			else if (probe.verdict === "contradicted") contradicted += 1;
			else unknown += 1;
		}
		const judged = consistent + contradicted;
		summaries.push({
			storyId,
			attempted,
			consistent,
			contradicted,
			unknown,
			failed,
			skipped,
			contradictionRate: judged === 0 ? 0 : contradicted / judged,
			samples,
		});
	}
	return summaries;
}

function verdictLabel(probe: PlaytestProbeRecord): string {
	if (probe.status === "skipped") return "跳过";
	if (probe.status === "failed") return "失败";
	if (probe.verdict === "consistent") return "一致";
	if (probe.verdict === "contradicted") return "矛盾";
	return "无法判断";
}

function cell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * 生成一致性探针报告。统计版只有故事编号与数字；私有版附题目、
 * 回答、台账路径与裁判理由。
 */
export function renderProbeReport(
	summaries: readonly ProbeStorySummary[],
	options: { readonly privateDetails: boolean },
): string {
	const labels = summaries.map((summary, index) =>
		options.privateDetails ? summary.storyId : `故事 ${index + 1}`,
	);
	const lines: string[] = [
		"# 一致性探针报告",
		"",
		"| 故事 | 探针 | 一致 | 矛盾 | 无法判断 | 失败 | 跳过 | 矛盾率 |",
		"| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
	];
	summaries.forEach((summary, index) => {
		const judged = summary.consistent + summary.contradicted;
		const rate =
			judged === 0 ? "—" : `${(summary.contradictionRate * 100).toFixed(1)}%`;
		lines.push(
			`| ${cell(labels[index] ?? "")} | ${summary.attempted} | ${summary.consistent} | ${summary.contradicted} | ${summary.unknown} | ${summary.failed} | ${summary.skipped} | ${rate} |`,
		);
	});
	lines.push("", "## 按轮次", "");
	lines.push("| 故事 | 轮次 | 样例 | 判定 |");
	lines.push("| --- | ---: | ---: | --- |");
	summaries.forEach((summary, index) => {
		for (const sample of summary.samples) {
			lines.push(
				`| ${cell(labels[index] ?? "")} | ${sample.round} | ${sample.index} | ${verdictLabel(sample.record)} |`,
			);
		}
	});
	if (!options.privateDetails) return `${lines.join("\n")}\n`;
	lines.push("", "## 样本明细", "");
	summaries.forEach((summary, index) => {
		if (summary.samples.length === 0) return;
		lines.push(`### ${labels[index] ?? ""}`, "");
		for (const sample of summary.samples) {
			const probe = sample.record;
			lines.push(
				`#### 样例 ${sample.index}（第 ${sample.round} 轮，楼层 ${probe.nodeId}）`,
				"",
				`- 判定：${verdictLabel(probe)}`,
			);
			if (probe.fact !== null) {
				lines.push(
					`- 台账路径：${probe.fact.path.join(".")}（写入楼层 ${probe.fact.nodeId}，年龄 ${probe.fact.ageFloors} 楼）`,
				);
			}
			if (probe.question !== null)
				lines.push(`- 问题：${cell(probe.question)}`);
			if (probe.answer !== null) lines.push(`- 回答：${cell(probe.answer)}`);
			if (probe.reason !== null)
				lines.push(`- 裁判理由：${cell(probe.reason)}`);
			if (probe.error !== null) lines.push(`- 错误：${cell(probe.error)}`);
			lines.push("");
		}
	});
	return `${lines.join("\n")}\n`;
}
