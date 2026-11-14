import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	type LlmMessage,
	type LlmUsage,
	NO_CONTINUATION,
	modelFamily,
} from "@dramaticer/core";
import {
	type R6InstrumentGateInput,
	R6_GATE_VERSION,
	type WilsonInterval,
	wilsonInterval,
} from "./gates.js";
import {
	MAX_PAIRWISE_ATTEMPTS,
	type PairwiseJudge,
	type PairwiseWinner,
	parsePairwiseOutput,
} from "./pairwise.js";

export const R6_INSTRUMENT_FORMAT = "dramaticer.r6-instrument";

/** A/A 检验的两种展示顺序；种子 1 的生成排在甲位或乙位。 */
export const R6_AA_ORDERS = ["seed1-first", "seed2-first"] as const;
export type R6AaOrder = (typeof R6_AA_ORDERS)[number];

/** 真人标注的两种展示顺序，与 F0-T03 一致：被放弃侧在甲位或乙位。 */
export const R6_HUMAN_LABEL_ORDERS = [
	"rejected-first",
	"accepted-first",
] as const;
export type R6HumanLabelOrder = (typeof R6_HUMAN_LABEL_ORDERS)[number];

/** 一次生成的结果；失败时保留原因，不把空文本送进裁判。 */
export type R6AaGeneration =
	| { readonly status: "done"; readonly text: string }
	| { readonly status: "failed"; readonly error: string };

/**
 * A/A 样本：同一玩家楼层下的两次独立生成，配置相同、只有种子不同。
 * `context` 是父玩家楼层的最近对话，已按楼层格式化。
 */
export interface R6AaSample {
	readonly sampleId: string;
	readonly story: string;
	readonly context: string;
	readonly seed1: R6AaGeneration;
	readonly seed2: R6AaGeneration;
}

/** 判定失败的原因：生成失败、两次文本相同，或裁判没有给出合法输出。 */
export type R6AaFailureStage = "generation" | "identical" | "judge";

export type R6AaJudgement = {
	readonly sampleId: string;
	readonly story: string;
	readonly order: R6AaOrder;
	/** 生成文本的指纹；文本变了，旧记录作废。 */
	readonly sampleHash: string;
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
			readonly stage: "judge";
	  }
	| {
			readonly status: "failed";
			readonly winner: null;
			readonly reason: null;
			readonly error: string;
			readonly stage: R6AaFailureStage;
	  }
);

export interface R6HumanLabelPair {
	readonly pairId: string;
	/** 被接受的回复不是同一楼层的最后一条 swipe。 */
	readonly acceptedNotLast: boolean;
	readonly context: readonly {
		readonly role: "user" | "assistant";
		readonly text: string;
	}[];
	readonly acceptedText: string;
	readonly rejectedText: string;
}

export type R6HumanLabelJudgement = {
	readonly pairId: string;
	readonly order: R6HumanLabelOrder;
	readonly attempts: number;
	readonly usage: LlmUsage | null;
	readonly model: string;
	readonly createdAt: string;
} & (
	| {
			readonly status: "done";
			readonly choice: "A" | "B";
			readonly confidence: number;
			readonly error: null;
	  }
	| {
			readonly status: "failed";
			readonly choice: null;
			readonly confidence: null;
			readonly error: string;
	  }
);

export type R6AaOutcome = "win" | "loss" | "tie" | "inconsistent";

export interface R6AaStorySummary {
	readonly story: string;
	readonly plannedPairs: number;
	readonly completedPairs: number;
	readonly wins: number;
	readonly losses: number;
	readonly ties: number;
	readonly inconsistent: number;
	readonly failures: number;
}

export interface R6AaSummary {
	readonly plannedPairs: number;
	readonly completedPairs: number;
	readonly wins: number;
	readonly losses: number;
	readonly ties: number;
	readonly inconsistent: number;
	/** 生成失败、两次文本相同或判定失败的配对数，不进入胜率分母。 */
	readonly failures: number;
	/** 两次生成的文本完全相同；单独报告，不计入裁判失败。 */
	readonly identicalPairs: number;
	readonly generationFailures: number;
	readonly judgementsCompleted: number;
	readonly judgementsFailed: number;
	readonly winRate: number | null;
	readonly wilson: WilsonInterval | null;
	readonly inconsistentShare: number | null;
	readonly excludedShare: number | null;
	readonly judgeFailureShare: number | null;
	readonly identicalShare: number | null;
	readonly stories: readonly R6AaStorySummary[];
}

export interface R6HumanLabelCounts {
	readonly plannedPairs: number;
	readonly completedPairs: number;
	readonly judgements: number;
	readonly acceptedChoices: number;
	readonly agreement: number | null;
}

export interface R6HumanLabelSummary {
	readonly plannedPairs: number;
	readonly completedPairs: number;
	readonly acceptedChoices: number;
	/** 成功判断次数，两种顺序合计。 */
	readonly judgements: number;
	/** 选中位置甲的次数。 */
	readonly positionA: number;
	readonly failures: number;
	readonly agreement: number | null;
	readonly wilson: WilsonInterval | null;
	readonly positionBias: number | null;
	readonly judgeFailureShare: number | null;
	/** 被接受的回复不是最后一条 swipe 的子集；只报告，不设门槛。 */
	readonly earlierSwipe: R6HumanLabelCounts;
}

export interface R6InstrumentReport {
	readonly format: typeof R6_INSTRUMENT_FORMAT;
	readonly gateVersion: string;
	readonly generatedAt: string;
	readonly judge: { readonly model: string; readonly family: string };
	readonly aa: R6AaSummary;
	readonly humanLabels: R6HumanLabelSummary;
	readonly gateInput: R6InstrumentGateInput;
}

export interface R6AaInstrumentOptions {
	/** r6-replay 写出的 `.aa-samples.jsonl`。 */
	readonly samplesPath: string;
	readonly dir: string;
	readonly judge: PairwiseJudge;
	readonly now?: () => Date;
	readonly log?: (message: string) => void;
}

export interface R6AaInstrumentResult {
	readonly samples: readonly R6AaSample[];
	readonly records: readonly R6AaJudgement[];
	readonly summary: R6AaSummary;
}

export interface R6HumanLabelInstrumentOptions {
	/** F0-T03 的配对文本（`eval-private/f0/pairs.jsonl`）。 */
	readonly pairsPath: string;
	/** F0-T03 的判定记录（`eval-private/f0/judge.jsonl`），只用来取配对 id。 */
	readonly labelRecordsPath: string;
	readonly dir: string;
	readonly judge: PairwiseJudge;
	readonly now?: () => Date;
	readonly log?: (message: string) => void;
}

export interface R6HumanLabelInstrumentResult {
	readonly pairs: readonly R6HumanLabelPair[];
	readonly records: readonly R6HumanLabelJudgement[];
	readonly summary: R6HumanLabelSummary;
}

export interface R6InstrumentOptions {
	readonly aaSamplesPath: string;
	readonly pairsPath: string;
	readonly labelRecordsPath: string;
	readonly dir: string;
	readonly judge: PairwiseJudge;
	readonly now?: () => Date;
	readonly log?: (message: string) => void;
}

const AA_SYSTEM_PROMPT = [
	"你是故事编辑，正在做盲评。同一分支点有两次独立生成，配置相同、只有随机种子不同。",
	"请只根据最近的对话与两个版本的内容，判断哪一个更适合作为这一分支点的续写。",
	"两个版本展示为续写甲与续写乙，位置与质量无关：不要因为某个版本排在前面或后面就偏向它。",
	"只有两个版本无法区分时才判平局。",
	'只输出一个 JSON 对象，键为 winner 与 reason，例如 {"winner":"A","reason":"续写甲更贴合当前的冲突"}。winner 取 "A"、"B" 或 "tie"。reason 用一句话说明依据。不要输出代码块。',
].join("\n");

const HUMAN_LABEL_SYSTEM_PROMPT = [
	"你是故事编辑，正在做盲评。同一楼层的助手回复有两个版本，玩家保留了其中一个、放弃了另一个。",
	"请只根据最近的对话与两个版本的内容，判断玩家更可能保留哪一个。",
	"两个版本展示为回复甲与回复乙，位置与质量无关：不要因为某个版本排在前面或后面就偏向它。",
	"两个版本差别很小时仍然要选一个。",
	"confidence 是 0 到 1 的小数，表示你对选择的把握。",
	'只输出一个 JSON 对象，不要 Markdown，不要解释：{"choice": "A", "confidence": 0.0}',
	'choice 取 "A"（回复甲）或 "B"（回复乙）。',
].join("\n");

/** 样本指纹只覆盖送进裁判的内容；楼层 id 与种子不参与。 */
export function aaSampleHash(sample: R6AaSample): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				sample.context,
				sample.seed1.status === "done" ? sample.seed1.text : null,
				sample.seed2.status === "done" ? sample.seed2.text : null,
			]),
		)
		.digest("hex")
		.slice(0, 16);
}

export function buildAaMessages(input: {
	readonly context: string;
	readonly first: string;
	readonly second: string;
}): LlmMessage[] {
	const context =
		input.context.trim().length === 0
			? "（没有更早的对话）"
			: input.context.trim();
	return [
		{ role: "system", content: AA_SYSTEM_PROMPT },
		{
			role: "user",
			content: [
				`最近的对话：\n${context}`,
				`续写甲：\n${input.first}`,
				`续写乙：\n${input.second}`,
				"请判断并只输出 JSON。",
			].join("\n\n"),
		},
	];
}

function humanLabelContextBlock(context: R6HumanLabelPair["context"]): string {
	if (context.length === 0) return "（没有更早的对话）";
	return context
		.map((entry) => `${entry.role === "user" ? "用户" : "助手"}：${entry.text}`)
		.join("\n\n");
}

export function buildHumanLabelMessages(
	pair: R6HumanLabelPair,
	order: R6HumanLabelOrder,
): LlmMessage[] {
	const rejectedFirst = order === "rejected-first";
	const first = rejectedFirst ? pair.rejectedText : pair.acceptedText;
	const second = rejectedFirst ? pair.acceptedText : pair.rejectedText;
	return [
		{ role: "system", content: HUMAN_LABEL_SYSTEM_PROMPT },
		{
			role: "user",
			content: [
				`最近的对话：\n${humanLabelContextBlock(pair.context)}`,
				`回复甲：\n${first}`,
				`回复乙：\n${second}`,
				"请输出你的判断。",
			].join("\n\n"),
		},
	];
}

/** 只接受 {choice:"A"|"B", confidence:0..1}，允许外面包一层代码块或多余文字。 */
export function parseHumanLabelOutput(text: string): {
	readonly choice: "A" | "B";
	readonly confidence: number;
} | null {
	const body = stripCodeFence(text.trim());
	const extracted = extractJsonObject(body);
	const parsed =
		tryParseJson(body) ??
		(extracted === null ? undefined : tryParseJson(extracted));
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return null;
	}
	const record = parsed as { choice?: unknown; confidence?: unknown };
	if (record.choice !== "A" && record.choice !== "B") return null;
	if (
		typeof record.confidence !== "number" ||
		!Number.isFinite(record.confidence) ||
		record.confidence < 0 ||
		record.confidence > 1
	) {
		return null;
	}
	return { choice: record.choice, confidence: record.confidence };
}

function stripCodeFence(text: string): string {
	const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return match?.[1] ?? text;
}

function tryParseJson(text: string): unknown {
	if (text.length === 0) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function extractJsonObject(text: string): string | null {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start >= 0 && end > start) return text.slice(start, end + 1);
	return null;
}

/** 顺序与选择的组合换回种子侧；平局原样返回。 */
export function aaSideOf(
	order: R6AaOrder,
	winner: PairwiseWinner,
): "seed1" | "seed2" | "tie" {
	if (winner === "tie") return "tie";
	const positionIsSeed1 =
		(order === "seed1-first" && winner === "A") ||
		(order === "seed2-first" && winner === "B");
	return positionIsSeed1 ? "seed1" : "seed2";
}

/** 两种顺序都选种子 1 记胜，都选种子 2 记负，都判平记平，其余记换序不一致。 */
export function aaPairOutcome(
	first: "seed1" | "seed2" | "tie",
	second: "seed1" | "seed2" | "tie",
): R6AaOutcome {
	if (first === "tie" || second === "tie") {
		return first === second ? "tie" : "inconsistent";
	}
	if (first !== second) return "inconsistent";
	return first === "seed1" ? "win" : "loss";
}

/** 真人标注里被接受侧的位置：被放弃侧在前时接受侧在乙位。 */
export function humanLabelAcceptedPosition(
	order: R6HumanLabelOrder,
): "A" | "B" {
	return order === "rejected-first" ? "B" : "A";
}

export function humanLabelPicksAccepted(
	order: R6HumanLabelOrder,
	choice: "A" | "B",
): boolean {
	return choice === humanLabelAcceptedPosition(order);
}

export function parseR6AaSamplesJsonl(
	text: string,
	source: string,
): R6AaSample[] {
	const samples: R6AaSample[] = [];
	const seen = new Set<string>();
	splitLines(text).forEach((line, index) => {
		const where = `${source} 第 ${index + 1} 行`;
		const value = parseJsonLine(line, where);
		const sample = parseAaSample(value, where);
		if (seen.has(sample.sampleId)) {
			throw new Error(`${where} 的样本 id 重复：${sample.sampleId}`);
		}
		seen.add(sample.sampleId);
		samples.push(sample);
	});
	return samples;
}

function parseAaSample(value: unknown, where: string): R6AaSample {
	const record = requireObject(value, where);
	const sampleId = requireText(record.sampleId, `${where} 的 sampleId`);
	const story = requireText(record.story, `${where} 的 story`);
	if (typeof record.context !== "string") {
		throw new Error(`${where} 的 context 必须是字符串`);
	}
	return {
		sampleId,
		story,
		context: record.context,
		seed1: parseAaGeneration(record.seed1, `${where} 的 seed1`),
		seed2: parseAaGeneration(record.seed2, `${where} 的 seed2`),
	};
}

function parseAaGeneration(value: unknown, where: string): R6AaGeneration {
	const record = requireObject(value, where);
	if (record.status === "done") {
		return { status: "done", text: requireText(record.text, `${where}.text`) };
	}
	if (record.status === "failed") {
		return {
			status: "failed",
			error: requireText(record.error, `${where}.error`),
		};
	}
	throw new Error(`${where}.status 必须是 done 或 failed`);
}

/** F0-T03 的配对文本；只取判定需要的字段。 */
export function parseR6HumanLabelPairsJsonl(
	text: string,
	source: string,
): R6HumanLabelPair[] {
	const pairs: R6HumanLabelPair[] = [];
	splitLines(text).forEach((line, index) => {
		const where = `${source} 第 ${index + 1} 行`;
		pairs.push(parseHumanLabelPair(parseJsonLine(line, where), where));
	});
	return pairs;
}

function parseHumanLabelPair(value: unknown, where: string): R6HumanLabelPair {
	const record = requireObject(value, where);
	if (!Array.isArray(record.context)) {
		throw new Error(`${where} 的 context 必须是数组`);
	}
	const context = record.context.map(
		(entry, index): { role: "user" | "assistant"; text: string } => {
			const item = requireObject(entry, `${where} 的 context[${index}]`);
			if (item.role !== "user" && item.role !== "assistant") {
				throw new Error(
					`${where} 的 context[${index}].role 必须是 user 或 assistant`,
				);
			}
			return {
				role: item.role,
				text: requireText(item.text, `${where} 的 context[${index}].text`),
			};
		},
	);
	if (typeof record.acceptedNotLast !== "boolean") {
		throw new Error(`${where} 的 acceptedNotLast 必须是布尔值`);
	}
	return {
		pairId: requireText(record.id, `${where} 的 id`),
		acceptedNotLast: record.acceptedNotLast,
		context,
		acceptedText: requireText(record.acceptedText, `${where} 的 acceptedText`),
		rejectedText: requireText(record.rejectedText, `${where} 的 rejectedText`),
	};
}

/** 从 F0-T03 的判定记录里取配对 id；顺序无关，去重后排序。 */
export function readHumanLabelPairIds(text: string, source: string): string[] {
	const ids = new Set<string>();
	splitLines(text).forEach((line, index) => {
		const where = `${source} 第 ${index + 1} 行`;
		const value = requireObject(parseJsonLine(line, where), where);
		ids.add(requireText(value.pair, `${where} 的 pair`));
	});
	if (ids.size === 0) throw new Error(`${source} 里没有配对 id`);
	return [...ids].sort();
}

export function loadR6HumanLabelPairs(
	pairsPath: string,
	plannedIds: readonly string[],
): R6HumanLabelPair[] {
	if (!existsSync(pairsPath)) {
		throw new Error(`配对文本不存在：${pairsPath}`);
	}
	const wanted = new Set(plannedIds);
	const found = new Map<string, R6HumanLabelPair>();
	for (const pair of parseR6HumanLabelPairsJsonl(
		readFileSync(pairsPath, "utf8"),
		pairsPath,
	)) {
		if (wanted.has(pair.pairId) && !found.has(pair.pairId)) {
			found.set(pair.pairId, pair);
		}
	}
	const missing = plannedIds.filter((id) => !found.has(id));
	if (missing.length > 0) {
		throw new Error(
			`${pairsPath} 里缺少 ${missing.length} 个判定记录引用的配对`,
		);
	}
	return plannedIds.map((id) => {
		const pair = found.get(id);
		if (pair === undefined) throw new Error(`缺少配对 ${id}`);
		return pair;
	});
}

export function parseR6AaJudgementsJsonl(
	text: string,
	source: string,
): R6AaJudgement[] {
	return splitLines(text).map((line, index) =>
		parseAaJudgement(
			parseJsonLine(line, `${source} 第 ${index + 1} 行`),
			`${source} 第 ${index + 1} 行`,
		),
	);
}

function parseAaJudgement(value: unknown, where: string): R6AaJudgement {
	const record = requireObject(value, where);
	const base = {
		sampleId: requireText(record.sampleId, `${where} 的 sampleId`),
		story: requireText(record.story, `${where} 的 story`),
		order: requireAaOrder(record.order, `${where} 的 order`),
		sampleHash: requireText(record.sampleHash, `${where} 的 sampleHash`),
		attempts: requireNonNegativeInteger(
			record.attempts,
			`${where} 的 attempts`,
		),
		usage: parseUsage(record.usage, `${where} 的 usage`),
		model: requireText(record.model, `${where} 的 model`),
		createdAt: requireText(record.createdAt, `${where} 的 createdAt`),
	};
	if (record.status === "done") {
		if (record.stage !== "judge") {
			throw new Error(`${where} 的 stage 必须是 judge`);
		}
		if (
			record.winner !== "A" &&
			record.winner !== "B" &&
			record.winner !== "tie"
		) {
			throw new Error(`${where} 的 winner 必须是 A、B 或 tie`);
		}
		return {
			...base,
			status: "done",
			winner: record.winner,
			reason: requireText(record.reason, `${where} 的 reason`),
			error: null,
			stage: "judge",
		};
	}
	if (record.status !== "failed") {
		throw new Error(`${where} 的 status 必须是 done 或 failed`);
	}
	if (
		record.stage !== "generation" &&
		record.stage !== "identical" &&
		record.stage !== "judge"
	) {
		throw new Error(`${where} 的 stage 必须是 generation、identical 或 judge`);
	}
	return {
		...base,
		status: "failed",
		winner: null,
		reason: null,
		error: requireText(record.error, `${where} 的 error`),
		stage: record.stage,
	};
}

export function parseR6HumanLabelJudgementsJsonl(
	text: string,
	source: string,
): R6HumanLabelJudgement[] {
	return splitLines(text).map((line, index) =>
		parseHumanLabelJudgement(
			parseJsonLine(line, `${source} 第 ${index + 1} 行`),
			`${source} 第 ${index + 1} 行`,
		),
	);
}

function parseHumanLabelJudgement(
	value: unknown,
	where: string,
): R6HumanLabelJudgement {
	const record = requireObject(value, where);
	const base = {
		pairId: requireText(record.pairId, `${where} 的 pairId`),
		order: requireHumanLabelOrder(record.order, `${where} 的 order`),
		attempts: requireNonNegativeInteger(
			record.attempts,
			`${where} 的 attempts`,
		),
		usage: parseUsage(record.usage, `${where} 的 usage`),
		model: requireText(record.model, `${where} 的 model`),
		createdAt: requireText(record.createdAt, `${where} 的 createdAt`),
	};
	if (record.status === "done") {
		if (record.choice !== "A" && record.choice !== "B") {
			throw new Error(`${where} 的 choice 必须是 A 或 B`);
		}
		if (
			typeof record.confidence !== "number" ||
			!Number.isFinite(record.confidence) ||
			record.confidence < 0 ||
			record.confidence > 1
		) {
			throw new Error(`${where} 的 confidence 必须是 0 到 1 的数字`);
		}
		return {
			...base,
			status: "done",
			choice: record.choice,
			confidence: record.confidence,
			error: null,
		};
	}
	if (record.status !== "failed") {
		throw new Error(`${where} 的 status 必须是 done 或 failed`);
	}
	return {
		...base,
		status: "failed",
		choice: null,
		confidence: null,
		error: requireText(record.error, `${where} 的 error`),
	};
}

/** 汇总 A/A：每个计划配对占两个判定槽位，生成失败与两次相同也占位并记失败。 */
export function summarizeR6Aa(input: {
	readonly samples: readonly R6AaSample[];
	readonly records: readonly R6AaJudgement[];
}): R6AaSummary {
	const latest = latestAaRecords(input.records);
	const storyNames = [...new Set(input.samples.map((sample) => sample.story))];
	let completedPairs = 0;
	let wins = 0;
	let losses = 0;
	let ties = 0;
	let inconsistent = 0;
	let failures = 0;
	let identicalPairs = 0;
	let generationFailures = 0;
	let judgementsCompleted = 0;
	let judgementsFailed = 0;
	const perStory = new Map(
		storyNames.map((story) => [
			story,
			{
				story,
				plannedPairs: 0,
				completedPairs: 0,
				wins: 0,
				losses: 0,
				ties: 0,
				inconsistent: 0,
				failures: 0,
			},
		]),
	);
	for (const sample of input.samples) {
		const story = perStory.get(sample.story);
		if (story === undefined) {
			throw new Error(`故事 ${sample.story} 没有进入汇总`);
		}
		story.plannedPairs += 1;
		const first = latest.get(aaRecordKey(sample.sampleId, "seed1-first"));
		const second = latest.get(aaRecordKey(sample.sampleId, "seed2-first"));
		for (const record of [first, second]) {
			if (record === undefined) continue;
			if (record.status === "done") judgementsCompleted += 1;
			else judgementsFailed += 1;
		}
		if (isGenerationFailure(sample)) generationFailures += 1;
		if (isIdenticalGeneration(sample)) identicalPairs += 1;
		const outcome = aaOutcomeOf(sample, first, second);
		if (outcome === "win") {
			wins += 1;
			story.wins += 1;
		} else if (outcome === "loss") {
			losses += 1;
			story.losses += 1;
		} else if (outcome === "tie") {
			ties += 1;
			story.ties += 1;
		} else if (outcome === "inconsistent") {
			inconsistent += 1;
			story.inconsistent += 1;
		} else {
			failures += 1;
			story.failures += 1;
			continue;
		}
		completedPairs += 1;
		story.completedPairs += 1;
	}
	const decided = wins + losses;
	const judgementTotal = judgementsCompleted + judgementsFailed;
	return {
		plannedPairs: input.samples.length,
		completedPairs,
		wins,
		losses,
		ties,
		inconsistent,
		failures,
		identicalPairs,
		generationFailures,
		judgementsCompleted,
		judgementsFailed,
		winRate: decided === 0 ? null : wins / decided,
		wilson: wilsonInterval(wins, decided),
		inconsistentShare:
			completedPairs === 0 ? null : inconsistent / completedPairs,
		excludedShare:
			input.samples.length === 0
				? null
				: (ties + inconsistent + failures) / input.samples.length,
		judgeFailureShare:
			judgementTotal === 0 ? null : judgementsFailed / judgementTotal,
		identicalShare:
			input.samples.length === 0 ? null : identicalPairs / input.samples.length,
		stories: storyNames.map((story) => {
			const entry = perStory.get(story);
			if (entry === undefined) throw new Error(`缺少故事 ${story} 的汇总`);
			return entry;
		}),
	};
}

function aaOutcomeOf(
	sample: R6AaSample,
	first: R6AaJudgement | undefined,
	second: R6AaJudgement | undefined,
): R6AaOutcome | "failure" {
	if (first === undefined || second === undefined) return "failure";
	if (first.status !== "done" || second.status !== "done") return "failure";
	return aaPairOutcome(
		aaSideOf("seed1-first", first.winner),
		aaSideOf("seed2-first", second.winner),
	);
}

function isGenerationFailure(sample: R6AaSample): boolean {
	return sample.seed1.status === "failed" || sample.seed2.status === "failed";
}

function isIdenticalGeneration(sample: R6AaSample): boolean {
	return (
		sample.seed1.status === "done" &&
		sample.seed2.status === "done" &&
		sample.seed1.text === sample.seed2.text
	);
}

/** 汇总真人标注：一致率分母是成功判断次数，两种顺序合计。 */
export function summarizeR6HumanLabels(input: {
	readonly pairs: readonly R6HumanLabelPair[];
	readonly records: readonly R6HumanLabelJudgement[];
}): R6HumanLabelSummary {
	const latest = latestHumanLabelRecords(input.records);
	const counts = humanLabelCounts(input.pairs, latest);
	const earlier = humanLabelCounts(
		input.pairs.filter((pair) => pair.acceptedNotLast),
		latest,
	);
	const judgementsCompleted = counts.judgements;
	const judgementsFailed = [...latest.values()].filter(
		(record) => record.status === "failed",
	).length;
	const judgementTotal = judgementsCompleted + judgementsFailed;
	return {
		plannedPairs: counts.plannedPairs,
		completedPairs: counts.completedPairs,
		acceptedChoices: counts.acceptedChoices,
		judgements: counts.judgements,
		positionA: counts.positionA,
		failures: judgementsFailed,
		agreement:
			judgementsCompleted === 0
				? null
				: counts.acceptedChoices / judgementsCompleted,
		wilson: wilsonInterval(counts.acceptedChoices, judgementsCompleted),
		positionBias:
			judgementsCompleted === 0
				? null
				: Math.abs(counts.positionA / judgementsCompleted - 0.5),
		judgeFailureShare:
			judgementTotal === 0 ? null : judgementsFailed / judgementTotal,
		earlierSwipe: earlier,
	};
}

function humanLabelCounts(
	pairs: readonly R6HumanLabelPair[],
	latest: ReadonlyMap<string, R6HumanLabelJudgement>,
): R6HumanLabelCounts & { readonly positionA: number } {
	let completedPairs = 0;
	let judgements = 0;
	let acceptedChoices = 0;
	let positionA = 0;
	for (const pair of pairs) {
		const first = latest.get(humanRecordKey(pair.pairId, "rejected-first"));
		const second = latest.get(humanRecordKey(pair.pairId, "accepted-first"));
		let bothDone = true;
		for (const [order, record] of [
			["rejected-first", first],
			["accepted-first", second],
		] as const) {
			if (record === undefined || record.status !== "done") {
				bothDone = false;
				continue;
			}
			judgements += 1;
			if (record.choice === "A") positionA += 1;
			if (humanLabelPicksAccepted(order, record.choice)) acceptedChoices += 1;
		}
		if (bothDone) completedPairs += 1;
	}
	return {
		plannedPairs: pairs.length,
		completedPairs,
		judgements,
		acceptedChoices,
		positionA,
		agreement: judgements === 0 ? null : acceptedChoices / judgements,
	};
}

/** G0 的判定输入；`failures` 与 `judgeFailures` 按判定槽位计数。 */
export function r6InstrumentGateInput(input: {
	readonly aa: R6AaSummary;
	readonly humanLabels: R6HumanLabelSummary;
}): R6InstrumentGateInput {
	return {
		sameConfig: {
			plannedPairs: input.aa.plannedPairs,
			pairs: {
				wins: input.aa.wins,
				losses: input.aa.losses,
				ties: input.aa.ties,
				inconsistent: input.aa.inconsistent,
			},
			failures: input.aa.failures,
			judgments: {
				completed: input.aa.judgementsCompleted,
				failed: input.aa.judgementsFailed,
			},
		},
		humanLabels: {
			plannedPairs: input.humanLabels.plannedPairs,
			completedPairs: input.humanLabels.completedPairs,
			acceptedChoices: input.humanLabels.acceptedChoices,
			judgments: input.humanLabels.judgements,
			positionA: input.humanLabels.positionA,
			failures: input.humanLabels.failures,
		},
	};
}

export async function runR6AaInstrument(
	options: R6AaInstrumentOptions,
): Promise<R6AaInstrumentResult> {
	const log = options.log ?? (() => undefined);
	const now = options.now ?? (() => new Date());
	const samples = parseR6AaSamplesJsonl(
		await readFileRequired(options.samplesPath, "A/A 样本"),
		options.samplesPath,
	);
	if (samples.length === 0) {
		throw new Error(`A/A 样本为空：${options.samplesPath}`);
	}
	const file = path.join(options.dir, "aa.jsonl");
	const records = new Map<string, R6AaJudgement>();
	for (const record of await loadRecords(file, parseR6AaJudgementsJsonl)) {
		records.set(aaRecordKey(record.sampleId, record.order), record);
	}
	const byId = new Map(samples.map((sample) => [sample.sampleId, sample]));
	for (const record of records.values()) {
		const sample = byId.get(record.sampleId);
		if (sample === undefined) {
			throw new Error(
				`${file} 里的样本 ${record.sampleId} 不在本次计划中；删除该文件后重跑`,
			);
		}
		if (record.story !== sample.story) {
			throw new Error(
				`${file} 里样本 ${record.sampleId} 的故事 ${record.story} 与计划 ${sample.story} 不一致`,
			);
		}
		if (record.sampleHash !== aaSampleHash(sample)) {
			throw new Error(
				`${file} 里样本 ${record.sampleId} 的生成文本已变化；删除该文件后重跑`,
			);
		}
		if (record.model !== options.judge.model) {
			throw new Error(
				`${file} 里的判定使用裁判模型 ${record.model}，与本次 ${options.judge.model} 不一致；删除该文件后重跑`,
			);
		}
	}
	for (const sample of samples) {
		const hash = aaSampleHash(sample);
		for (const order of R6_AA_ORDERS) {
			const key = aaRecordKey(sample.sampleId, order);
			const existing = records.get(key);
			if (existing !== undefined) {
				if (existing.status === "done") continue;
				if (existing.stage !== "judge") continue;
			}
			let record: R6AaJudgement;
			if (isGenerationFailure(sample)) {
				record = failedAaRecord({
					sample,
					order,
					hash,
					stage: "generation",
					error: generationFailureMessage(sample),
					model: options.judge.model,
					createdAt: now().toISOString(),
				});
			} else if (isIdenticalGeneration(sample)) {
				record = failedAaRecord({
					sample,
					order,
					hash,
					stage: "identical",
					error: "两次生成的文本完全相同",
					model: options.judge.model,
					createdAt: now().toISOString(),
				});
			} else {
				record = await judgeAaOrder({
					sample,
					order,
					hash,
					judge: options.judge,
					createdAt: now().toISOString(),
				});
			}
			records.set(key, record);
			await saveRecords(file, [...records.values()], compareAaRecords);
			log(
				`A/A 样本 ${sample.sampleId}：${order} ${
					record.status === "done" ? record.winner : `失败（${record.stage}）`
				}`,
			);
		}
	}
	const sorted = [...records.values()].sort(compareAaRecords);
	const summary = summarizeR6Aa({ samples, records: sorted });
	log(
		`A/A 检验：计划 ${summary.plannedPairs} 对，完成 ${summary.completedPairs}，胜 ${summary.wins}、负 ${summary.losses}、平 ${summary.ties}、换序不一致 ${summary.inconsistent}、失败 ${summary.failures}（两次相同 ${summary.identicalPairs}）`,
	);
	return { samples, records: sorted, summary };
}

export async function runR6HumanLabelInstrument(
	options: R6HumanLabelInstrumentOptions,
): Promise<R6HumanLabelInstrumentResult> {
	const log = options.log ?? (() => undefined);
	const now = options.now ?? (() => new Date());
	const labelRecords = await readFileRequired(
		options.labelRecordsPath,
		"F0-T03 判定记录",
	);
	const plannedIds = readHumanLabelPairIds(
		labelRecords,
		options.labelRecordsPath,
	);
	const pairs = loadR6HumanLabelPairs(options.pairsPath, plannedIds);
	const file = path.join(options.dir, "human.jsonl");
	const records = new Map<string, R6HumanLabelJudgement>();
	for (const record of await loadRecords(
		file,
		parseR6HumanLabelJudgementsJsonl,
	)) {
		records.set(humanRecordKey(record.pairId, record.order), record);
	}
	const planned = new Set(pairs.map((pair) => pair.pairId));
	for (const record of records.values()) {
		if (!planned.has(record.pairId)) {
			throw new Error(
				`${file} 里的配对 ${record.pairId} 不在本次计划中；删除该文件后重跑`,
			);
		}
		if (record.model !== options.judge.model) {
			throw new Error(
				`${file} 里的判定使用裁判模型 ${record.model}，与本次 ${options.judge.model} 不一致；删除该文件后重跑`,
			);
		}
	}
	for (const pair of pairs) {
		for (const order of R6_HUMAN_LABEL_ORDERS) {
			const key = humanRecordKey(pair.pairId, order);
			const existing = records.get(key);
			if (existing !== undefined && existing.status === "done") continue;
			const record = await judgeHumanLabelOrder({
				pair,
				order,
				judge: options.judge,
				createdAt: now().toISOString(),
			});
			records.set(key, record);
			await saveRecords(file, [...records.values()], compareHumanLabelRecords);
			log(
				`真人标注配对 ${pair.pairId}：${order} ${
					record.status === "done"
						? `${record.choice}（${record.confidence.toFixed(2)}）`
						: "失败"
				}`,
			);
		}
	}
	const sorted = [...records.values()].sort(compareHumanLabelRecords);
	const summary = summarizeR6HumanLabels({ pairs, records: sorted });
	log(
		`真人标注：计划 ${summary.plannedPairs} 对，完成 ${summary.completedPairs}，一致 ${summary.acceptedChoices}/${summary.judgements}，位置甲 ${summary.positionA}，失败 ${summary.failures}`,
	);
	return { pairs, records: sorted, summary };
}

export async function runR6Instrument(
	options: R6InstrumentOptions,
): Promise<R6InstrumentReport> {
	const now = options.now ?? (() => new Date());
	const aa = await runR6AaInstrument({
		samplesPath: options.aaSamplesPath,
		dir: options.dir,
		judge: options.judge,
		now,
		...(options.log === undefined ? {} : { log: options.log }),
	});
	const human = await runR6HumanLabelInstrument({
		pairsPath: options.pairsPath,
		labelRecordsPath: options.labelRecordsPath,
		dir: options.dir,
		judge: options.judge,
		now,
		...(options.log === undefined ? {} : { log: options.log }),
	});
	const gateInput = r6InstrumentGateInput({
		aa: aa.summary,
		humanLabels: human.summary,
	});
	return {
		format: R6_INSTRUMENT_FORMAT,
		gateVersion: R6_GATE_VERSION,
		generatedAt: now().toISOString(),
		judge: {
			model: options.judge.model,
			family: modelFamily(options.judge.model),
		},
		aa: aa.summary,
		humanLabels: human.summary,
		gateInput,
	};
}

export function formatR6InstrumentReport(report: R6InstrumentReport): string {
	const aa = report.aa;
	const human = report.humanLabels;
	const lines: string[] = [];
	lines.push("# R6 仪器有效性（G0）");
	lines.push("");
	lines.push(`- 门槛版本：${report.gateVersion}`);
	lines.push(`- 生成时间：${report.generatedAt}`);
	lines.push(`- 裁判：${report.judge.model}（${report.judge.family}）`);
	lines.push("");
	lines.push("## A/A 检验");
	lines.push("");
	lines.push(
		`- 配对：计划 ${aa.plannedPairs}，完成 ${aa.completedPairs}，胜 ${aa.wins}、负 ${aa.losses}、平 ${aa.ties}、换序不一致 ${aa.inconsistent}、失败 ${aa.failures}`,
	);
	lines.push(
		`- 胜率：${formatPercent(aa.winRate)}（Wilson 95% ${formatInterval(aa.wilson)}）`,
	);
	lines.push(
		`- 换序不一致：${formatPercent(aa.inconsistentShare)}；平、换序不一致与失败合计 ${formatPercent(aa.excludedShare)}`,
	);
	lines.push(
		`- 失败构成：生成失败 ${aa.generationFailures}、两次文本相同 ${aa.identicalPairs}（${formatPercent(aa.identicalShare)}）；判定 ${aa.judgementsCompleted}/${aa.judgementsCompleted + aa.judgementsFailed} 成功，失败率 ${formatPercent(aa.judgeFailureShare)}`,
	);
	lines.push("");
	lines.push("|故事|计划|完成|胜|负|平|换序不一致|失败|");
	lines.push("|---|---|---|---|---|---|---|---|");
	for (const story of aa.stories) {
		lines.push(
			`|${story.story}|${story.plannedPairs}|${story.completedPairs}|${story.wins}|${story.losses}|${story.ties}|${story.inconsistent}|${story.failures}|`,
		);
	}
	lines.push("");
	lines.push("## 真人标注配对");
	lines.push("");
	lines.push(
		`- 配对：计划 ${human.plannedPairs}，完成 ${human.completedPairs}；成功判断 ${human.judgements}，失败 ${human.failures}`,
	);
	lines.push(
		`- 一致率：${formatPercent(human.agreement)}（Wilson 95% ${formatInterval(human.wilson)}）`,
	);
	lines.push(
		`- 位置甲：${human.positionA}/${human.judgements}，偏差 ${formatPercent(human.positionBias)}；判定失败率 ${formatPercent(human.judgeFailureShare)}`,
	);
	lines.push(
		`- 早期 swipe 子集：计划 ${human.earlierSwipe.plannedPairs}，完成 ${human.earlierSwipe.completedPairs}，一致 ${human.earlierSwipe.acceptedChoices}/${human.earlierSwipe.judgements}（${formatPercent(human.earlierSwipe.agreement)}）`,
	);
	lines.push("");
	lines.push(
		"- 口径：A/A 两次生成来自同一配置，胜率区间应包含 50%；两次文本相同、生成失败或判定失败记为配对失败，不进入胜率分母；真人标注的一致率分母是成功判断次数，两种顺序合计。",
	);
	lines.push("");
	lines.push("## G0 判定输入");
	lines.push("");
	lines.push("```json");
	lines.push(JSON.stringify(report.gateInput, null, 2));
	lines.push("```");
	lines.push("");
	return lines.join("\n");
}

function formatPercent(value: number | null): string {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatInterval(value: WilsonInterval | null): string {
	return value === null
		? "—"
		: `${(value.lower * 100).toFixed(1)}%–${(value.upper * 100).toFixed(1)}%`;
}

async function judgeAaOrder(input: {
	readonly sample: R6AaSample;
	readonly order: R6AaOrder;
	readonly hash: string;
	readonly judge: PairwiseJudge;
	readonly createdAt: string;
}): Promise<R6AaJudgement> {
	const first =
		input.order === "seed1-first" ? input.sample.seed1 : input.sample.seed2;
	const second =
		input.order === "seed1-first" ? input.sample.seed2 : input.sample.seed1;
	if (first.status !== "done" || second.status !== "done") {
		throw new Error(`样本 ${input.sample.sampleId} 的生成不完整`);
	}
	const baseMessages = buildAaMessages({
		context: input.sample.context,
		first: first.text,
		second: second.text,
	});
	const judged = await judgeWithRetry({
		messages: baseMessages,
		judge: input.judge,
		parse: parsePairwiseOutput,
		retryHint:
			'只输出 {"winner":"A"|"B"|"tie","reason":"…"}，不要代码块，不要多余字段。',
	});
	const base = {
		sampleId: input.sample.sampleId,
		story: input.sample.story,
		order: input.order,
		sampleHash: input.hash,
		attempts: judged.attempts,
		usage: judged.usage,
		model: input.judge.model,
		createdAt: input.createdAt,
	};
	return judged.verdict === null
		? {
				...base,
				status: "failed",
				winner: null,
				reason: null,
				error: judged.error,
				stage: "judge",
			}
		: {
				...base,
				status: "done",
				winner: judged.verdict.winner,
				reason: judged.verdict.reason,
				error: null,
				stage: "judge",
			};
}

async function judgeHumanLabelOrder(input: {
	readonly pair: R6HumanLabelPair;
	readonly order: R6HumanLabelOrder;
	readonly judge: PairwiseJudge;
	readonly createdAt: string;
}): Promise<R6HumanLabelJudgement> {
	const judged = await judgeWithRetry({
		messages: buildHumanLabelMessages(input.pair, input.order),
		judge: input.judge,
		parse: parseHumanLabelOutput,
		retryHint:
			'只输出 {"choice":"A"|"B","confidence":0 到 1 的小数}，不要代码块，不要多余字段。',
	});
	const base = {
		pairId: input.pair.pairId,
		order: input.order,
		attempts: judged.attempts,
		usage: judged.usage,
		model: input.judge.model,
		createdAt: input.createdAt,
	};
	return judged.verdict === null
		? {
				...base,
				status: "failed",
				choice: null,
				confidence: null,
				error: judged.error,
			}
		: {
				...base,
				status: "done",
				choice: judged.verdict.choice,
				confidence: judged.verdict.confidence,
				error: null,
			};
}

async function judgeWithRetry<T>(input: {
	readonly messages: readonly LlmMessage[];
	readonly judge: PairwiseJudge;
	readonly parse: (text: string) => T | null;
	readonly retryHint: string;
}): Promise<{
	readonly attempts: number;
	readonly usage: LlmUsage | null;
	readonly verdict: T | null;
	readonly error: string;
}> {
	let usage: LlmUsage | null = null;
	let lastProblem = "";
	for (let attempt = 1; attempt <= MAX_PAIRWISE_ATTEMPTS; attempt += 1) {
		const messages: LlmMessage[] =
			attempt === 1
				? [...input.messages]
				: [
						...input.messages,
						{
							role: "user",
							content: `上一次输出不合法（${lastProblem}）。这是第 ${attempt} 次尝试，${input.retryHint}`,
						},
					];
		let text: string;
		try {
			const result = await input.judge.client.complete(
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
			text = result.text;
			usage = result.usage;
		} catch (error) {
			return {
				attempts: attempt,
				usage,
				verdict: null,
				error: `裁判调用失败：${error instanceof Error ? error.message : String(error)}`,
			};
		}
		const verdict = input.parse(text);
		if (verdict !== null) {
			return { attempts: attempt, usage, verdict, error: "" };
		}
		lastProblem = "缺少必要字段或取值越界";
	}
	return {
		attempts: MAX_PAIRWISE_ATTEMPTS,
		usage,
		verdict: null,
		error: `裁判连续 ${MAX_PAIRWISE_ATTEMPTS} 次没有输出合法判定`,
	};
}

function failedAaRecord(input: {
	readonly sample: R6AaSample;
	readonly order: R6AaOrder;
	readonly hash: string;
	readonly stage: "generation" | "identical";
	readonly error: string;
	readonly model: string;
	readonly createdAt: string;
}): R6AaJudgement {
	return {
		sampleId: input.sample.sampleId,
		story: input.sample.story,
		order: input.order,
		sampleHash: input.hash,
		attempts: 0,
		usage: null,
		model: input.model,
		createdAt: input.createdAt,
		status: "failed",
		winner: null,
		reason: null,
		error: input.error,
		stage: input.stage,
	};
}

function generationFailureMessage(sample: R6AaSample): string {
	const parts: string[] = [];
	if (sample.seed1.status === "failed") {
		parts.push(`种子 1：${sample.seed1.error}`);
	}
	if (sample.seed2.status === "failed") {
		parts.push(`种子 2：${sample.seed2.error}`);
	}
	return `生成失败；${parts.join("；")}`;
}

function aaRecordKey(sampleId: string, order: R6AaOrder): string {
	return `${sampleId}\u0000${order}`;
}

function humanRecordKey(pairId: string, order: R6HumanLabelOrder): string {
	return `${pairId}\u0000${order}`;
}

function latestAaRecords(
	records: readonly R6AaJudgement[],
): Map<string, R6AaJudgement> {
	const latest = new Map<string, R6AaJudgement>();
	for (const record of records) {
		latest.set(aaRecordKey(record.sampleId, record.order), record);
	}
	return latest;
}

function latestHumanLabelRecords(
	records: readonly R6HumanLabelJudgement[],
): Map<string, R6HumanLabelJudgement> {
	const latest = new Map<string, R6HumanLabelJudgement>();
	for (const record of records) {
		latest.set(humanRecordKey(record.pairId, record.order), record);
	}
	return latest;
}

function compareAaRecords(left: R6AaJudgement, right: R6AaJudgement): number {
	if (left.sampleId !== right.sampleId) {
		return left.sampleId < right.sampleId ? -1 : 1;
	}
	return R6_AA_ORDERS.indexOf(left.order) - R6_AA_ORDERS.indexOf(right.order);
}

function compareHumanLabelRecords(
	left: R6HumanLabelJudgement,
	right: R6HumanLabelJudgement,
): number {
	if (left.pairId !== right.pairId) {
		return left.pairId < right.pairId ? -1 : 1;
	}
	return (
		R6_HUMAN_LABEL_ORDERS.indexOf(left.order) -
		R6_HUMAN_LABEL_ORDERS.indexOf(right.order)
	);
}

async function loadRecords<T>(
	file: string,
	parse: (text: string, source: string) => T[],
): Promise<T[]> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	return parse(raw, file);
}

async function saveRecords<T>(
	file: string,
	records: readonly T[],
	compare: (left: T, right: T) => number,
): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp`;
	await writeFile(
		temporary,
		[...records]
			.sort(compare)
			.map((record) => `${JSON.stringify(record)}\n`)
			.join(""),
		"utf8",
	);
	await rename(temporary, file);
}

async function readFileRequired(file: string, label: string): Promise<string> {
	try {
		return await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(`${label}不存在：${file}`);
		}
		throw error;
	}
}

function splitLines(text: string): string[] {
	return text.split("\n").filter((line) => line.trim().length > 0);
}

function parseJsonLine(line: string, where: string): unknown {
	try {
		return JSON.parse(line);
	} catch (error) {
		throw new Error(
			`${where} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function requireObject(value: unknown, where: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${where} 必须是 JSON 对象`);
	}
	return value as Record<string, unknown>;
}

function requireText(value: unknown, where: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${where} 必须是非空字符串`);
	}
	return value;
}

function requireNonNegativeInteger(value: unknown, where: string): number {
	if (!Number.isInteger(value) || (value as number) < 0) {
		throw new Error(`${where} 必须是非负整数，收到 ${String(value)}`);
	}
	return value as number;
}

function requireAaOrder(value: unknown, where: string): R6AaOrder {
	if (value !== "seed1-first" && value !== "seed2-first") {
		throw new Error(`${where} 必须是 seed1-first 或 seed2-first`);
	}
	return value;
}

function requireHumanLabelOrder(
	value: unknown,
	where: string,
): R6HumanLabelOrder {
	if (value !== "rejected-first" && value !== "accepted-first") {
		throw new Error(`${where} 必须是 rejected-first 或 accepted-first`);
	}
	return value;
}

function parseUsage(value: unknown, where: string): LlmUsage | null {
	if (value === null) return null;
	const usage = requireObject(value, where);
	for (const key of [
		"promptTokens",
		"completionTokens",
		"totalTokens",
		"reasoningTokens",
		"cachedTokens",
	]) {
		requireNonNegativeInteger(usage[key], `${where}.${key}`);
	}
	return usage as unknown as LlmUsage;
}
