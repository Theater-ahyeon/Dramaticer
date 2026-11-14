import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
	type R6DeepGateInput,
	type R6GateInput,
	type R6GateReport,
	type R6GateStatus,
	type R6InstrumentGateInput,
	type R6PairCounts,
	type R6PreferenceGateInput,
	type R6ReplayGateInput,
	type R6SimilarityGateInput,
	type R6StoryMetric,
	R6_GATE_VERSION,
	evaluateR6Gates,
	wilsonInterval,
} from "./gates.js";
import { R6_B1_FORMAT } from "./r6-b1.js";
import { R6_COMPARE_FORMAT } from "./r6-compare.js";
import { R6_DEEP_FORMAT } from "./r6-deep.js";
import {
	type R6FunnelClass,
	type R6FunnelSummary,
	R6_FUNNEL_CLASSES,
	R6_FUNNEL_CLASS_LABELS,
	R6_FUNNEL_FORMAT,
	r6FunnelDirection,
} from "./r6-funnel.js";
import { R6_INSTRUMENT_FORMAT } from "./r6-instrument.js";
import { R6_PREFERENCE_FORMAT } from "./r6-preference.js";
import { R6_REPLAY_FORMAT } from "./r6-replay.js";

export const R6_GATE_FORMAT = "dramaticer.r6-gate";

export const R6_GATE_STATUS_LABELS: Readonly<Record<R6GateStatus, string>> = {
	pass: "通过",
	fail: "未通过",
	insufficient: "样本不足",
	"not-measurable": "不可测",
	invalid: "仪器无效",
};

/** B1 只作参考样本，不设门槛；这里只留报告需要的聚合数字。 */
export interface R6B1Reference {
	readonly plannedPairs: number;
	readonly completedPairs: number;
	readonly pairs: R6PairCounts;
	readonly failures: number;
	readonly winRate: number | null;
	readonly wilsonLower: number | null;
	readonly wilsonUpper: number | null;
	readonly insufficient: boolean;
}

/** 结果 JSON 只记录输入文件名，不记录私有目录的绝对路径。 */
export interface R6GateRunInputs {
	readonly instrument: string;
	readonly replay: string;
	readonly compares: readonly string[];
	readonly deep: string;
	readonly preference: string;
	readonly funnel: string;
	readonly b1: readonly string[];
}

export interface R6GateRunReport {
	readonly format: typeof R6_GATE_FORMAT;
	readonly gateVersion: string;
	readonly generatedAt: string;
	readonly inputs: R6GateRunInputs;
	readonly gates: R6GateReport;
	readonly b1: R6B1Reference | null;
	readonly funnel: R6FunnelSummary;
}

export interface R6GateRunOptions {
	/** G0 的 `r6-instrument` 结果。 */
	readonly instrumentPath: string;
	/** G1 的 `r6-replay` 结果。 */
	readonly replayPath: string;
	/** G2、G3、G4 的 `r6-compare` 结果，每个故事一份。 */
	readonly comparePaths: readonly string[];
	/** G5 的 `r6-deep` 结果。 */
	readonly deepPath: string;
	/** G6 的 `r6-preference` 结果。 */
	readonly preferencePath: string;
	/** 遗忘漏斗结果；只作诊断，不参与判定。 */
	readonly funnelPath: string;
	/** B1 参考结果；只报告数字，不参与判定。 */
	readonly b1Paths?: readonly string[];
	readonly now?: () => number;
}

async function readJsonObject(
	file: string,
	label: string,
): Promise<Record<string, unknown>> {
	if (!existsSync(file)) {
		throw new Error(`缺少${label}：${file}`);
	}
	let value: unknown;
	try {
		value = JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		throw new Error(
			`${file} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return requireObject(value, file);
}

function requireObject(value: unknown, where: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${where} 必须是 JSON 对象`);
	}
	return value as Record<string, unknown>;
}

function requireInteger(value: unknown, where: string): number {
	if (!Number.isInteger(value) || (value as number) < 0) {
		throw new Error(`${where} 必须是非负整数，收到 ${String(value)}`);
	}
	return value as number;
}

function requireRate(value: unknown, where: string): number | null {
	if (value === null || value === undefined) return null;
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 1
	) {
		throw new Error(
			`${where} 必须是 0 到 1 之间的数或 null，收到 ${String(value)}`,
		);
	}
	return value;
}

function requirePairs(value: unknown, where: string): R6PairCounts {
	const pairs = requireObject(value, where);
	return {
		wins: requireInteger(pairs.wins, `${where}.wins`),
		losses: requireInteger(pairs.losses, `${where}.losses`),
		ties: requireInteger(pairs.ties, `${where}.ties`),
		inconsistent: requireInteger(pairs.inconsistent, `${where}.inconsistent`),
	};
}

/** 结果文件的格式与门槛版本必须与当前预注册一致，避免把旧批次混进来。 */
function assertEnvelope(
	value: Record<string, unknown>,
	file: string,
	format: string,
): void {
	if (value.format !== format) {
		throw new Error(
			`${file} 的 format 是 ${String(value.format)}，应为 ${format}`,
		);
	}
	if (value.gateVersion !== R6_GATE_VERSION) {
		throw new Error(
			`${file} 的门槛版本是 ${String(value.gateVersion)}，当前是 ${R6_GATE_VERSION}`,
		);
	}
}

async function readInstrument(file: string): Promise<R6InstrumentGateInput> {
	const value = await readJsonObject(file, " G0 结果（r6-instrument）");
	assertEnvelope(value, file, R6_INSTRUMENT_FORMAT);
	return requireObject(
		value.gateInput,
		`${file}.gateInput`,
	) as unknown as R6InstrumentGateInput;
}

async function readReplay(file: string): Promise<R6ReplayGateInput> {
	const value = await readJsonObject(file, " G1 结果（r6-replay）");
	assertEnvelope(value, file, R6_REPLAY_FORMAT);
	const summary = requireObject(value.summary, `${file}.summary`);
	return requireObject(
		summary.gateInput,
		`${file}.summary.gateInput`,
	) as unknown as R6ReplayGateInput;
}

interface CompareArm {
	readonly repetition: {
		readonly pairs: number;
		readonly mean: number | null;
	};
	readonly progression: {
		readonly samples: number;
		readonly mean: number | null;
	};
	readonly probes: {
		readonly consistent: number;
		readonly contradicted: number;
		readonly unknown: number;
		readonly failed: number;
	};
}

interface CompareData {
	readonly stories: ReadonlyMap<
		string,
		{ readonly native: CompareArm; readonly naive: CompareArm }
	>;
	readonly probes: {
		consistent: number;
		contradicted: number;
		unknown: number;
		failed: number;
	};
}

function readCompareArm(value: unknown, where: string): CompareArm {
	const arm = requireObject(value, where);
	const repetition = requireObject(arm.repetition, `${where}.repetition`);
	const progression = requireObject(arm.progression, `${where}.progression`);
	const probes = requireObject(arm.probes, `${where}.probes`);
	return {
		repetition: {
			pairs: requireInteger(repetition.pairs, `${where}.repetition.pairs`),
			mean: requireRate(repetition.mean, `${where}.repetition.mean`),
		},
		progression: {
			samples: requireInteger(
				progression.samples,
				`${where}.progression.samples`,
			),
			mean: requireRate(progression.mean, `${where}.progression.mean`),
		},
		probes: {
			consistent: requireInteger(
				probes.consistent,
				`${where}.probes.consistent`,
			),
			contradicted: requireInteger(
				probes.contradicted,
				`${where}.probes.contradicted`,
			),
			unknown: requireInteger(probes.unknown, `${where}.probes.unknown`),
			failed: requireInteger(probes.failed, `${where}.probes.failed`),
		},
	};
}

/** 汇总全部 `r6-compare` 结果；重复故事、缺档位都直接失败并指出文件。 */
async function readCompares(files: readonly string[]): Promise<CompareData> {
	const collected = new Map<
		string,
		{ native?: CompareArm; naive?: CompareArm }
	>();
	const probes = { consistent: 0, contradicted: 0, unknown: 0, failed: 0 };
	for (const file of files) {
		const value = await readJsonObject(file, " C1 结果（r6-compare）");
		assertEnvelope(value, file, R6_COMPARE_FORMAT);
		if (!Array.isArray(value.profiles) || value.profiles.length === 0) {
			throw new Error(`${file}.profiles 必须是非空数组`);
		}
		value.profiles.forEach((entry, index) => {
			const profile = requireObject(entry, `${file}.profiles[${index}]`);
			const story = profile.story;
			if (typeof story !== "string" || story.trim().length === 0) {
				throw new Error(`${file}.profiles[${index}].story 必须是非空字符串`);
			}
			const arm = profile.profile;
			if (arm !== "native" && arm !== "naive") {
				throw new Error(
					`${file}.profiles[${index}].profile 必须是 native 或 naive，收到 ${String(arm)}`,
				);
			}
			const slot = collected.get(story) ?? {};
			if (slot[arm] !== undefined) {
				throw new Error(`${file} 里故事 ${story} 的 ${arm} 档重复`);
			}
			slot[arm] = readCompareArm(profile, `${file}.profiles[${index}]`);
			collected.set(story, slot);
		});
	}
	const stories = new Map<
		string,
		{ readonly native: CompareArm; readonly naive: CompareArm }
	>();
	for (const [story, slot] of collected) {
		if (slot.native === undefined) {
			throw new Error(`故事 ${story} 缺少 native 档的 r6-compare 结果`);
		}
		if (slot.naive === undefined) {
			throw new Error(`故事 ${story} 缺少 naive 档的 r6-compare 结果`);
		}
		stories.set(story, { native: slot.native, naive: slot.naive });
		probes.consistent += slot.native.probes.consistent;
		probes.contradicted += slot.native.probes.contradicted;
		probes.unknown += slot.native.probes.unknown;
		probes.failed += slot.native.probes.failed;
	}
	if (stories.size === 0) {
		throw new Error("没有读到任何 r6-compare 结果");
	}
	return { stories, probes };
}

function similarityInput(
	data: CompareData,
	label: "repetition" | "progression",
): R6SimilarityGateInput {
	const stories: R6StoryMetric[] = [...data.stories.entries()]
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([story, slot]) => ({
			story,
			native:
				label === "repetition"
					? {
							mean: slot.native.repetition.mean,
							samples: slot.native.repetition.pairs,
						}
					: {
							mean: slot.native.progression.mean,
							samples: slot.native.progression.samples,
						},
			naive:
				label === "repetition"
					? {
							mean: slot.naive.repetition.mean,
							samples: slot.naive.repetition.pairs,
						}
					: {
							mean: slot.naive.progression.mean,
							samples: slot.naive.progression.samples,
						},
		}));
	return { stories };
}

async function readDeep(file: string): Promise<R6DeepGateInput> {
	const value = await readJsonObject(file, " G5 结果（r6-deep）");
	assertEnvelope(value, file, R6_DEEP_FORMAT);
	const summary = requireObject(value.summary, `${file}.summary`);
	const turns = requireObject(summary.turns, `${file}.summary.turns`);
	return {
		plannedPairs: requireInteger(
			summary.plannedPairs,
			`${file}.summary.plannedPairs`,
		),
		pairs: requirePairs(summary.pairs, `${file}.summary.pairs`),
		failures: requireInteger(summary.failures, `${file}.summary.failures`),
		turns: {
			completed: requireInteger(
				turns.completed,
				`${file}.summary.turns.completed`,
			),
			failed: requireInteger(turns.failed, `${file}.summary.turns.failed`),
		},
		toolCalls: requireInteger(
			turns.toolCalls,
			`${file}.summary.turns.toolCalls`,
		),
	};
}

async function readPreference(file: string): Promise<R6PreferenceGateInput> {
	const value = await readJsonObject(file, " G6 结果（r6-preference）");
	assertEnvelope(value, file, R6_PREFERENCE_FORMAT);
	const summary = requireObject(value.summary, `${file}.summary`);
	return {
		accepted: requireInteger(summary.accepted, `${file}.summary.accepted`),
		abandoned: requireInteger(summary.abandoned, `${file}.summary.abandoned`),
		ties: requireInteger(summary.ties, `${file}.summary.ties`),
		inconsistent: requireInteger(
			summary.inconsistent,
			`${file}.summary.inconsistent`,
		),
		failures: requireInteger(summary.failures, `${file}.summary.failures`),
	};
}

async function readFunnel(file: string): Promise<R6FunnelSummary> {
	const value = await readJsonObject(file, "遗忘漏斗结果（r6-funnel）");
	assertEnvelope(value, file, R6_FUNNEL_FORMAT);
	const summary = requireObject(value.summary, `${file}.summary`);
	const classes = requireObject(summary.classes, `${file}.summary.classes`);
	const counts = {} as Record<R6FunnelClass, number>;
	for (const kind of R6_FUNNEL_CLASSES) {
		counts[kind] = requireInteger(
			classes[kind],
			`${file}.summary.classes.${kind}`,
		);
	}
	if (!Array.isArray(summary.stories)) {
		throw new Error(`${file}.summary.stories 必须是数组`);
	}
	const stories = summary.stories.map((entry, index) => {
		const story = requireObject(entry, `${file}.summary.stories[${index}]`);
		const name = story.story;
		if (typeof name !== "string" || name.trim().length === 0) {
			throw new Error(
				`${file}.summary.stories[${index}].story 必须是非空字符串`,
			);
		}
		const storyClasses = requireObject(
			story.classes,
			`${file}.summary.stories[${index}].classes`,
		);
		const storyCounts = {} as Record<R6FunnelClass, number>;
		for (const kind of R6_FUNNEL_CLASSES) {
			storyCounts[kind] = requireInteger(
				storyClasses[kind],
				`${file}.summary.stories[${index}].classes.${kind}`,
			);
		}
		return {
			story: name,
			contradicted: requireInteger(
				story.contradicted,
				`${file}.summary.stories[${index}].contradicted`,
			),
			classes: storyCounts,
			weakEvidence: requireInteger(
				story.weakEvidence,
				`${file}.summary.stories[${index}].weakEvidence`,
			),
		};
	});
	return {
		contradicted: requireInteger(
			summary.contradicted,
			`${file}.summary.contradicted`,
		),
		classes: counts,
		weakEvidence: requireInteger(
			summary.weakEvidence,
			`${file}.summary.weakEvidence`,
		),
		unattributed: requireInteger(
			summary.unattributed,
			`${file}.summary.unattributed`,
		),
		stories,
	};
}

async function readB1(file: string): Promise<R6B1Reference> {
	const value = await readJsonObject(file, " B1 参考结果（r6-b1）");
	assertEnvelope(value, file, R6_B1_FORMAT);
	const summary = requireObject(value.summary, `${file}.summary`);
	const wilson =
		summary.wilson === null || summary.wilson === undefined
			? null
			: requireObject(summary.wilson, `${file}.summary.wilson`);
	return {
		plannedPairs: requireInteger(
			summary.plannedPairs,
			`${file}.summary.plannedPairs`,
		),
		completedPairs: requireInteger(
			summary.completedPairs,
			`${file}.summary.completedPairs`,
		),
		pairs: requirePairs(summary.pairs, `${file}.summary.pairs`),
		failures: requireInteger(summary.failures, `${file}.summary.failures`),
		winRate: requireRate(summary.winRate, `${file}.summary.winRate`),
		wilsonLower:
			wilson === null
				? null
				: requireRate(wilson.lower, `${file}.summary.wilson.lower`),
		wilsonUpper:
			wilson === null
				? null
				: requireRate(wilson.upper, `${file}.summary.wilson.upper`),
		insufficient: summary.insufficient === true,
	};
}

/** `--compare` 没有显式给出时，按文件名收集运行目录里的 `compare-*.json`。 */
export async function listCompareResults(dir: string): Promise<string[]> {
	if (!existsSync(dir)) return [];
	const entries = await readdir(dir, { withFileTypes: true });
	return entries
		.filter(
			(entry) =>
				entry.isFile() &&
				entry.name.startsWith("compare-") &&
				entry.name.endsWith(".json"),
		)
		.map((entry) => path.join(dir, entry.name))
		.sort();
}

/** `--b1` 没有显式给出时，按文件名收集运行目录里的 `b1-*.json`。 */
export async function listB1Results(dir: string): Promise<string[]> {
	if (!existsSync(dir)) return [];
	const entries = await readdir(dir, { withFileTypes: true });
	return entries
		.filter(
			(entry) =>
				entry.isFile() &&
				entry.name.startsWith("b1-") &&
				entry.name.endsWith(".json"),
		)
		.map((entry) => path.join(dir, entry.name))
		.sort();
}

/**
 * 读齐 G0–G6 的输入交给 `evaluateR6Gates`。任何一项缺失、格式不符或门槛版本
 * 不一致都直接失败并指出文件。遗忘漏斗是诊断的固定一节，缺失时同样失败；
 * B1 只作参考，缺失时报告里写明未提供。
 */
export async function runR6Gate(
	options: R6GateRunOptions,
): Promise<R6GateRunReport> {
	if (options.comparePaths.length === 0) {
		throw new Error("缺少 C1 结果（r6-compare）：没有给出任何结果文件");
	}
	const instrument = await readInstrument(options.instrumentPath);
	const replay = await readReplay(options.replayPath);
	const compares = await readCompares(options.comparePaths);
	const deep = await readDeep(options.deepPath);
	const preference = await readPreference(options.preferencePath);
	const input: R6GateInput = {
		instrument,
		replay,
		repetition: similarityInput(compares, "repetition"),
		progression: similarityInput(compares, "progression"),
		contradiction: {
			consistent: compares.probes.consistent,
			contradictory: compares.probes.contradicted,
			undecidable: compares.probes.unknown,
			failed: compares.probes.failed,
		},
		deep,
		preference,
	};
	const gates = evaluateR6Gates(input);
	const funnel = await readFunnel(options.funnelPath);
	const b1Paths = options.b1Paths ?? [];
	const b1Items: R6B1Reference[] = [];
	for (const file of b1Paths) {
		b1Items.push(await readB1(file));
	}
	let reference: R6B1Reference | null = null;
	if (b1Items.length > 0) {
		const pairs = b1Items.reduce<R6PairCounts>(
			(total, item) => ({
				wins: total.wins + item.pairs.wins,
				losses: total.losses + item.pairs.losses,
				ties: total.ties + item.pairs.ties,
				inconsistent: total.inconsistent + item.pairs.inconsistent,
			}),
			{ wins: 0, losses: 0, ties: 0, inconsistent: 0 },
		);
		const decided = pairs.wins + pairs.losses;
		const completed = decided + pairs.ties + pairs.inconsistent;
		reference = {
			plannedPairs: b1Items.reduce(
				(total, item) => total + item.plannedPairs,
				0,
			),
			completedPairs: completed,
			pairs,
			failures: b1Items.reduce((total, item) => total + item.failures, 0),
			winRate: decided === 0 ? null : pairs.wins / decided,
			// 合并后的区间要按合并计数重算，不能沿用单份结果的区间。
			wilsonLower: wilsonInterval(pairs.wins, decided)?.lower ?? null,
			wilsonUpper: wilsonInterval(pairs.wins, decided)?.upper ?? null,
			insufficient: b1Items.some((item) => item.insufficient),
		};
	}
	return {
		format: R6_GATE_FORMAT,
		gateVersion: gates.version,
		generatedAt: new Date((options.now ?? Date.now)()).toISOString(),
		inputs: {
			instrument: path.basename(options.instrumentPath),
			replay: path.basename(options.replayPath),
			compares: options.comparePaths.map((file) => path.basename(file)).sort(),
			deep: path.basename(options.deepPath),
			preference: path.basename(options.preferencePath),
			funnel: path.basename(options.funnelPath),
			b1: b1Paths.map((file) => path.basename(file)).sort(),
		},
		gates,
		b1: reference,
		funnel,
	};
}

function formatRate(value: number | null): string {
	return value === null ? "缺失" : `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

/** 报告只写聚合数字与故事 slug，不含台账路径、正文与题目。 */
export function formatR6GateReport(report: R6GateRunReport): string {
	const lines: string[] = [];
	lines.push("# R6 门槛判定");
	lines.push("");
	lines.push(`- 门槛版本：${report.gateVersion}`);
	lines.push(`- 生成时间：${report.generatedAt}`);
	lines.push(
		`- 输入：${[
			report.inputs.instrument,
			report.inputs.replay,
			...report.inputs.compares,
			report.inputs.deep,
			report.inputs.preference,
		].join("、")}`,
	);
	const failed = report.gates.failed;
	const invalid = report.gates.invalid;
	const insufficient = report.gates.insufficient;
	const unproven = report.gates.unproven;
	lines.push(
		`- 结论：${report.gates.passed ? "通过" : "未通过"}${
			failed.length > 0 ? `；未通过 ${failed.join("、")}` : ""
		}${
			insufficient.length > 0 ? `；样本不足 ${insufficient.join("、")}` : ""
		}${invalid.length > 0 ? `；仪器无效 ${invalid.join("、")}` : ""}${
			unproven.length > 0 ? `；未证实 ${unproven.join("、")}` : ""
		}`,
	);
	lines.push("");
	lines.push("## 门槛");
	lines.push("");
	lines.push("|编号|门槛|状态|原因|");
	lines.push("|---|---|---|---|");
	for (const gate of report.gates.gates) {
		lines.push(
			`|${gate.id}|${gate.title}|${R6_GATE_STATUS_LABELS[gate.status]}|${gate.reason}|`,
		);
	}
	lines.push("");
	lines.push("## 数字");
	lines.push("");
	lines.push("|编号|项目|数值|");
	lines.push("|---|---|---:|");
	for (const gate of report.gates.gates) {
		for (const [key, value] of Object.entries(gate.counts)) {
			lines.push(`|${gate.id}|${key}|${formatNumber(value)}|`);
		}
		for (const [key, value] of Object.entries(gate.values)) {
			lines.push(`|${gate.id}|${key}|${formatRate(value)}|`);
		}
	}
	lines.push("");
	lines.push("## B1 参考");
	lines.push("");
	const b1 = report.b1;
	if (b1 === null) {
		lines.push("- 未提供 B1 结果。");
	} else {
		lines.push(
			`- 配对：完成 ${b1.completedPairs}/${b1.plannedPairs}；胜 ${b1.pairs.wins}、负 ${b1.pairs.losses}、平 ${b1.pairs.ties}、换序不一致 ${b1.pairs.inconsistent}、失败 ${b1.failures}`,
		);
		lines.push(
			`- 胜率：${formatRate(b1.winRate)}${b1.wilsonLower === null || b1.wilsonUpper === null ? "" : `（Wilson 95% ${formatRate(b1.wilsonLower)}–${formatRate(b1.wilsonUpper)}）`}`,
		);
		lines.push(
			`- 样本判定：${b1.insufficient ? "未达参考下限" : "达到参考下限"}；B1 不设门槛，只作参考。`,
		);
	}
	lines.push("");
	lines.push("## 遗忘漏斗");
	lines.push("");
	const funnel = report.funnel;
	lines.push(
		`- 矛盾探针 ${funnel.contradicted} 条；无法归因 ${funnel.unattributed} 条；弱依据 ${funnel.weakEvidence} 条。`,
	);
	lines.push("");
	lines.push("|类别|条数|占比|");
	lines.push("|---|---:|---:|");
	for (const kind of R6_FUNNEL_CLASSES) {
		const count = funnel.classes[kind];
		lines.push(
			`|${R6_FUNNEL_CLASS_LABELS[kind]}|${count}|${funnel.contradicted === 0 ? "—" : `${((count / funnel.contradicted) * 100).toFixed(1)}%`}|`,
		);
	}
	lines.push("");
	lines.push("|故事|矛盾|无依据|未进入 prompt|进入 prompt 未答对|");
	lines.push("|---|---:|---:|---:|---:|");
	for (const story of funnel.stories) {
		lines.push(
			`|${story.story}|${story.contradicted}|${story.classes["no-evidence"]}|${story.classes["not-in-prompt"]}|${story.classes["not-recalled"]}|`,
		);
	}
	const direction = r6FunnelDirection(funnel);
	lines.push("");
	lines.push(
		`- 改进方向：${direction === null ? "没有矛盾探针，不产生方向" : R6_FUNNEL_CLASS_LABELS[direction]}`,
	);
	lines.push("");
	return lines.join("\n");
}
