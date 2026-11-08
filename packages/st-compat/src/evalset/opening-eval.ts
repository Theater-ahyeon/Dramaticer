import type { LlmClient, LlmMessage } from "@dramaticer/core";
import type { PlaytestRecord } from "./playtest.js";

export const DEFAULT_OPENING_EVAL_ROUNDS = 10;
/** F0 取证里的 1–10 楼重 roll 率，用作对照。 */
export const F0_EARLY_REROLL_RATE = 0.249;
/** 与 F0 的第 1–10 个消息楼层大致对应的试玩轮数。 */
export const F0_EARLY_WINDOW_ROUNDS = 5;
export const MAX_CANDIDATE_CHOICE_ATTEMPTS = 3;

export type OpeningEvalConfig = "opening" | "baseline";

export interface OpeningEvalRunMeta {
	readonly runId: string;
	readonly cardIndex: number;
	readonly cardLabel: string;
	readonly config: OpeningEvalConfig;
	readonly storyId: string;
	readonly openingFloors: number;
	readonly openingPack: boolean;
	/** 相对于 manifest 所在目录的 JSONL 文件名。 */
	readonly path: string;
	/** 整轮运行失败的原因；成功时为 null。 */
	readonly error: string | null;
}

export interface OpeningEvalCandidateMeta {
	readonly cardIndex: number;
	readonly cardLabel: string;
	readonly storyId: string;
	readonly status: "done" | "failed";
	readonly candidateCount: number;
	readonly candidates: readonly string[];
	/** 选中候选的序号（从 1 开始）；null 表示选择自己写开场。 */
	readonly choice: number | null;
	readonly reason: string | null;
	readonly error: string | null;
}

export interface OpeningEvalManifest {
	readonly generatedAt: string;
	readonly seed: number;
	readonly rounds: number;
	readonly assistantModel: string;
	readonly userModel: string;
	readonly judgeModel: string;
	readonly runs: readonly OpeningEvalRunMeta[];
	readonly candidates: readonly OpeningEvalCandidateMeta[];
}

export interface OpeningEvalRunInput {
	readonly meta: OpeningEvalRunMeta;
	readonly records: readonly PlaytestRecord[];
}

export interface OpeningEvalInput {
	readonly manifest: OpeningEvalManifest;
	readonly runs: readonly OpeningEvalRunInput[];
}

export interface OpeningEvalMetricSummary {
	/** 有合法裁判判定的轮数；这是所有比率的分母。 */
	readonly judged: number;
	readonly rerolled: number;
	readonly followed: number;
	readonly verdictFailed: number;
	readonly rerollRate: number;
	readonly followedRate: number;
}

export interface OpeningEvalConfigSummary extends OpeningEvalMetricSummary {
	readonly config: OpeningEvalConfig;
	readonly runs: number;
	readonly runErrors: number;
	readonly roundsCompleted: number;
	readonly roundsFailed: number;
	readonly truncations: number;
	readonly firstTokenP50: number | null;
	readonly firstTokenP90: number | null;
	/** 前 5 轮（约对应 F0 的第 1–10 个消息楼层）。 */
	readonly early: OpeningEvalMetricSummary;
	/** 前 5 轮重 roll 率是否低于 F0 的 24.9%。 */
	readonly earlyTargetMet: boolean;
	/** 1–10 轮重 roll 率是否低于 F0 的 24.9%。 */
	readonly targetMet: boolean;
}

export interface OpeningEvalCandidateSummary {
	readonly cards: number;
	readonly generated: number;
	readonly failed: number;
	readonly adopted: number;
	readonly none: number;
	/** 采用数除以（采用加自己写）；没有可用选择时为 0。 */
	readonly adoptionRate: number;
	readonly choices: readonly number[];
}

export interface OpeningEvalRoundDetail {
	readonly round: number;
	readonly status: "done" | "failed";
	readonly reroll: boolean | null;
	readonly followed: boolean | null;
	readonly reason: string | null;
	readonly error: string | null;
	readonly firstTokenMs: number | null;
	readonly assistantLength: number;
}

export interface OpeningEvalCardDetail {
	readonly cardIndex: number;
	readonly cardLabel: string;
	readonly config: OpeningEvalConfig;
	readonly storyId: string;
	readonly rounds: readonly OpeningEvalRoundDetail[];
}

export interface OpeningEvalSummary {
	readonly manifest: OpeningEvalManifest;
	readonly opening: OpeningEvalConfigSummary;
	readonly baseline: OpeningEvalConfigSummary;
	readonly candidates: OpeningEvalCandidateSummary;
	readonly details: readonly OpeningEvalCardDetail[];
}

function rate(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : numerator / denominator;
}

function metric(
	records: readonly PlaytestRecord[],
	predicate: (round: number) => boolean,
): OpeningEvalMetricSummary {
	let judged = 0;
	let rerolled = 0;
	let followed = 0;
	let verdictFailed = 0;
	for (const record of records) {
		if (!predicate(record.round)) continue;
		if (record.status !== "done") continue;
		const verdict = record.verdict;
		if (verdict === null || verdict.status === "failed") {
			verdictFailed += 1;
			continue;
		}
		judged += 1;
		if (verdict.reroll) rerolled += 1;
		if (verdict.followed) followed += 1;
	}
	return {
		judged,
		rerolled,
		followed,
		verdictFailed,
		rerollRate: rate(rerolled, judged),
		followedRate: rate(followed, judged),
	};
}

/** 最近秩分位；输入为空时返回 null。 */
function percentile(
	values: readonly number[],
	quantile: number,
): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(sorted.length * quantile) - 1),
	);
	return sorted[index] ?? null;
}

function summarizeConfig(
	config: OpeningEvalConfig,
	runs: readonly OpeningEvalRunInput[],
): OpeningEvalConfigSummary {
	const records = runs.flatMap((run) => run.records);
	const all = metric(records, () => true);
	const early = metric(records, (round) => round <= F0_EARLY_WINDOW_ROUNDS);
	const completed = records.filter((record) => record.status === "done");
	const firstTokens = completed
		.map((record) => record.firstTokenMs)
		.filter((value): value is number => value !== null);
	return {
		...all,
		config,
		runs: runs.length,
		runErrors: runs.filter((run) => run.meta.error !== null).length,
		roundsCompleted: completed.length,
		roundsFailed: records.length - completed.length,
		truncations: completed.filter((record) => record.truncated).length,
		firstTokenP50: percentile(firstTokens, 0.5),
		firstTokenP90: percentile(firstTokens, 0.9),
		early,
		earlyTargetMet: early.judged > 0 && early.rerollRate < F0_EARLY_REROLL_RATE,
		targetMet: all.judged > 0 && all.rerollRate < F0_EARLY_REROLL_RATE,
	};
}

function summarizeCandidates(
	candidates: readonly OpeningEvalCandidateMeta[],
): OpeningEvalCandidateSummary {
	let generated = 0;
	let failed = 0;
	let adopted = 0;
	let none = 0;
	const choices: number[] = [];
	for (const candidate of candidates) {
		if (candidate.status === "failed") {
			failed += 1;
			continue;
		}
		generated += 1;
		if (candidate.choice === null) {
			none += 1;
		} else {
			adopted += 1;
			choices.push(candidate.choice);
		}
	}
	return {
		cards: candidates.length,
		generated,
		failed,
		adopted,
		none,
		adoptionRate: rate(adopted, adopted + none),
		choices,
	};
}

/** 聚合一次开局评测的全部运行；不读文件，输入相同结果逐字节相同。 */
export function summarizeOpeningEval(
	input: OpeningEvalInput,
): OpeningEvalSummary {
	const openingRuns: OpeningEvalRunInput[] = [];
	const baselineRuns: OpeningEvalRunInput[] = [];
	const details: OpeningEvalCardDetail[] = [];
	for (const run of input.runs) {
		if (run.meta.config === "opening") {
			openingRuns.push(run);
		} else {
			baselineRuns.push(run);
		}
		details.push({
			cardIndex: run.meta.cardIndex,
			cardLabel: run.meta.cardLabel,
			config: run.meta.config,
			storyId: run.meta.storyId,
			rounds: run.records.map((record) => {
				const verdict = record.status === "done" ? record.verdict : null;
				return {
					round: record.round,
					status: record.status,
					reroll: verdict?.status === "done" ? verdict.reroll : null,
					followed: verdict?.status === "done" ? verdict.followed : null,
					reason: verdict?.status === "done" ? verdict.reason : null,
					error:
						record.status === "failed"
							? record.error
							: verdict?.status === "failed"
								? verdict.error
								: null,
					firstTokenMs: record.status === "done" ? record.firstTokenMs : null,
					assistantLength:
						record.status === "done" ? record.assistant.length : 0,
				};
			}),
		});
	}
	details.sort((left, right) => {
		if (left.cardIndex !== right.cardIndex) {
			return left.cardIndex - right.cardIndex;
		}
		return left.config === right.config
			? 0
			: left.config === "opening"
				? -1
				: 1;
	});
	return {
		manifest: input.manifest,
		opening: summarizeConfig("opening", openingRuns),
		baseline: summarizeConfig("baseline", baselineRuns),
		candidates: summarizeCandidates(input.manifest.candidates),
		details,
	};
}

function percent(value: number, judged: number): string {
	return judged === 0 ? "—" : `${(value * 100).toFixed(1)}%`;
}

function signedPoints(left: number, right: number): string {
	const points = (left - right) * 100;
	return `${points >= 0 ? "+" : ""}${points.toFixed(1)} 个百分点`;
}

function milliseconds(value: number | null): string {
	return value === null ? "—" : `${value}`;
}

function cell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function configLabel(config: OpeningEvalConfig): string {
	return config === "opening" ? "开局开启" : "开局关闭";
}

function configTableRow(summary: OpeningEvalConfigSummary): string {
	return `| ${configLabel(summary.config)} | ${summary.runs} | ${summary.runErrors} | ${summary.roundsCompleted} | ${summary.roundsFailed} | ${summary.judged} | ${summary.rerolled} | ${percent(summary.rerollRate, summary.judged)} | ${summary.followed} | ${percent(summary.followedRate, summary.judged)} | ${summary.early.judged} | ${percent(summary.early.rerollRate, summary.early.judged)} | ${summary.verdictFailed} | ${milliseconds(summary.firstTokenP50)} | ${milliseconds(summary.firstTokenP90)} | ${summary.truncations} |`;
}

/**
 * 生成开局评测报告。统计版只有聚合数字与模型别名；私有版附卡名、
 * 故事 id、逐轮判定理由与候选正文。
 */
export function renderOpeningEvalReport(
	summary: OpeningEvalSummary,
	options: { readonly privateDetails: boolean },
): string {
	const manifest = summary.manifest;
	const lines: string[] = [
		"# 开局机制验收报告",
		"",
		`- 生成时间：${manifest.generatedAt}`,
		`- 样本：${manifest.runs.length / 2} 张卡，每张卡开启与关闭各跑 ${manifest.rounds} 轮`,
		`- 种子：${manifest.seed}`,
		`- 助手模型：${manifest.assistantModel}`,
		`- 模拟用户模型：${manifest.userModel}`,
		`- 裁判模型：${manifest.judgeModel}`,
		`- 对照：F0 的 1–10 楼重 roll 率 ${(F0_EARLY_REROLL_RATE * 100).toFixed(1)}%`,
		"",
		"## 一、汇总",
		"",
		"| 配置 | 运行 | 运行失败 | 完成轮次 | 失败轮次 | 有判定 | 重 roll | 重 roll 率 | 遵循指令 | 遵循率 | 前 5 轮判定 | 前 5 轮重 roll 率 | 裁判失败 | 首字 P50 (ms) | 首字 P90 (ms) | 截断 |",
		"| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
		configTableRow(summary.opening),
		configTableRow(summary.baseline),
		"",
		`- 开局开启的 1–10 轮重 roll 率 ${percent(summary.opening.rerollRate, summary.opening.judged)}，${summary.opening.targetMet ? "低于" : "没有低于"} F0 的 ${(F0_EARLY_REROLL_RATE * 100).toFixed(1)}%。`,
		`- 开局关闭的 1–10 轮重 roll 率 ${percent(summary.baseline.rerollRate, summary.baseline.judged)}。`,
		`- 开局开启相对关闭的重 roll 率变化 ${signedPoints(summary.opening.rerollRate, summary.baseline.rerollRate)}，指令遵循率变化 ${signedPoints(summary.opening.followedRate, summary.baseline.followedRate)}。`,
		`- 前 5 轮（约对应 F0 的第 1–10 个消息楼层）：开局开启 ${percent(summary.opening.early.rerollRate, summary.opening.early.judged)}，开局关闭 ${percent(summary.baseline.early.rerollRate, summary.baseline.early.judged)}。`,
		"",
		"## 二、开场候选采用",
		"",
		"| 卡数 | 生成成功 | 生成失败 | 采用候选 | 自己写开场 | 采用率 |",
		"| ---: | ---: | ---: | ---: | ---: | ---: |",
		`| ${summary.candidates.cards} | ${summary.candidates.generated} | ${summary.candidates.failed} | ${summary.candidates.adopted} | ${summary.candidates.none} | ${percent(summary.candidates.adoptionRate, summary.candidates.adopted + summary.candidates.none)} |`,
		"",
	];
	if (
		summary.candidates.adopted > 0 &&
		summary.candidates.none === 0 &&
		summary.candidates.failed === 0
	) {
		lines.push(
			"- 本批样本全部选择了候选，没有一次选择自己写开场；采用率没有区分度。",
			"",
		);
	}
	if (!options.privateDetails) {
		lines.push(
			"## 三、口径与限制",
			"",
			"- 重 roll 与指令遵循由裁判模型模拟玩家判断，不是真实玩家的重 roll 行为。",
			"- 1–10 轮指助手回复的序号，与开局导演的 openingFloors 同一口径；F0 的楼层是消息序号，两者只能作量级对照。",
			"- 候选采用率由模拟用户模型在三条候选与自己写开场之间选择，一次选择记一张卡。",
			"",
		);
		return `${lines.join("\n")}\n`;
	}
	lines.push(
		"## 三、逐卡逐轮明细",
		"",
		"| 卡 | 配置 | 故事 | 轮次 | 状态 | 重 roll | 遵循 | 理由或错误 | 首字 (ms) | 正文长度 |",
		"| ---: | --- | --- | ---: | --- | --- | --- | --- | ---: | ---: |",
	);
	for (const detail of summary.details) {
		for (const round of detail.rounds) {
			lines.push(
				`| ${detail.cardIndex} | ${configLabel(detail.config)} | ${cell(detail.storyId)} | ${round.round} | ${round.status === "done" ? "完成" : "失败"} | ${round.reroll === null ? "—" : round.reroll ? "是" : "否"} | ${round.followed === null ? "—" : round.followed ? "是" : "否"} | ${cell(round.reason ?? round.error ?? "")} | ${milliseconds(round.firstTokenMs)} | ${round.assistantLength} |`,
			);
		}
	}
	lines.push("", "## 四、候选明细", "");
	for (const candidate of summary.manifest.candidates) {
		lines.push(
			`### 卡 ${candidate.cardIndex}（${cell(candidate.cardLabel)}）`,
			"",
			`- 状态：${candidate.status === "done" ? "完成" : "失败"}`,
			`- 故事：${cell(candidate.storyId)}`,
			`- 选择：${candidate.choice === null ? "自己写开场" : `候选 ${candidate.choice}`}`,
		);
		if (candidate.reason !== null) {
			lines.push(`- 理由：${cell(candidate.reason)}`);
		}
		if (candidate.error !== null) {
			lines.push(`- 错误：${cell(candidate.error)}`);
		}
		candidate.candidates.forEach((text, index) => {
			lines.push("", `#### 候选 ${index + 1}`, "", text);
		});
		lines.push("");
	}
	lines.push(
		"## 五、口径与限制",
		"",
		"- 重 roll 与指令遵循由裁判模型模拟玩家判断，不是真实玩家的重 roll 行为。",
		"- 1–10 轮指助手回复的序号，与开局导演的 openingFloors 同一口径；F0 的楼层是消息序号，两者只能作量级对照。",
		"- 候选采用率由模拟用户模型在三条候选与自己写开场之间选择，一次选择记一张卡。",
		"",
	);
	return `${lines.join("\n")}\n`;
}

/** 严格解析候选选择：{choice: 1..count | "none", reason: string}。 */
export function parseCandidateChoice(
	text: string,
	count: number,
): { readonly choice: number | null; readonly reason: string } | null {
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
	if (keys.length !== 2 || keys[0] !== "choice" || keys[1] !== "reason") {
		return null;
	}
	const record = value as { choice?: unknown; reason?: unknown };
	if (typeof record.reason !== "string" || record.reason.trim().length === 0) {
		return null;
	}
	if (record.choice === "none") {
		return { choice: null, reason: record.reason };
	}
	if (
		typeof record.choice !== "number" ||
		!Number.isInteger(record.choice) ||
		record.choice < 1 ||
		record.choice > count
	) {
		return null;
	}
	return { choice: record.choice, reason: record.reason };
}

const CHOICE_SYSTEM_PROMPT = `你在模拟一位玩文字角色扮演游戏的玩家。故事还没有开始，系统给出了几条开场候选。请决定你会采用哪一条，还是自己写开场。
只输出一个 JSON 对象，键为 choice 与 reason：choice 是候选序号（从 1 开始）或字符串 "none"（自己写开场），reason 用一句话说明理由。例如 {"choice":2,"reason":"第二条的冲突最具体"}。不要输出代码块。`;

export interface CandidateChoiceInput {
	readonly cardName: string;
	readonly cardPrompt: string;
	readonly persona: string | null;
	readonly candidates: readonly string[];
	readonly client: LlmClient;
	readonly model: string;
}

/** 让模拟用户选择开场候选；非法输出重试三次，仍失败时返回错误。 */
export async function chooseOpeningCandidate(
	input: CandidateChoiceInput,
): Promise<{
	readonly choice: number | null;
	readonly reason: string | null;
	readonly error: string | null;
}> {
	const candidateText = input.candidates
		.map((text, index) => `候选 ${index + 1}：\n${text}`)
		.join("\n\n");
	const baseMessages: LlmMessage[] = [
		{ role: "system", content: CHOICE_SYSTEM_PROMPT },
		{
			role: "user",
			content: [
				`角色卡名称：${input.cardName}`,
				`角色卡：${input.cardPrompt.slice(0, 1_500)}`,
				`玩家人设：${input.persona ?? "未设置"}`,
				candidateText,
				"请选择并只输出 JSON。",
			].join("\n\n"),
		},
	];
	let lastProblem = "";
	for (
		let attempt = 1;
		attempt <= MAX_CANDIDATE_CHOICE_ATTEMPTS;
		attempt += 1
	) {
		const messages: LlmMessage[] =
			attempt === 1
				? baseMessages
				: [
						...baseMessages,
						{
							role: "user",
							content: `上一次输出不是合法的选择 JSON（${lastProblem}）。只输出 {"choice":1|2|3|"none","reason":"…"}，不要代码块。`,
						},
					];
		let text: string;
		try {
			const result = await input.client.complete({
				messages,
				model: input.model,
				temperature: 0,
				maxTokens: 512,
			});
			text = result.text;
		} catch (error) {
			return {
				choice: null,
				reason: null,
				error: `候选选择调用失败：${error instanceof Error ? error.message : String(error)}`,
			};
		}
		const parsed = parseCandidateChoice(text, input.candidates.length);
		if (parsed !== null) {
			return { choice: parsed.choice, reason: parsed.reason, error: null };
		}
		lastProblem = "choice 不是有效序号或 none，reason 为空，或包含多余字段";
	}
	return {
		choice: null,
		reason: null,
		error: `候选选择连续 ${MAX_CANDIDATE_CHOICE_ATTEMPTS} 次没有输出合法 JSON`,
	};
}
