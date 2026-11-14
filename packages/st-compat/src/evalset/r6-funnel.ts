import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
	SETTLE_CONFLICT_WINDOW_FLOORS,
	type StoryStore,
	StoryStore as StoryStoreClass,
} from "@dramaticer/core";
import { R6_GATE_VERSION } from "./gates.js";
import { contentGrams } from "./metrics.js";
import type { PlaytestProbeRecord } from "./probe.js";

export const R6_FUNNEL_FORMAT = "dramaticer.r6-funnel";

/**
 * 遗忘漏斗的三步归因，按顺序判定、互斥：
 * 台账没有原文支撑 → 事实没进入答题上下文 → 进入了 prompt 仍没答对。
 */
export const R6_FUNNEL_CLASSES = [
	"no-evidence",
	"not-in-prompt",
	"not-recalled",
] as const;
export type R6FunnelClass = (typeof R6_FUNNEL_CLASSES)[number];

export const R6_FUNNEL_CLASS_LABELS: Readonly<Record<R6FunnelClass, string>> = {
	"no-evidence": "无依据",
	"not-in-prompt": "未进入 prompt",
	"not-recalled": "进入 prompt 未答对",
};

/** 弱依据的 4-gram 覆盖率门槛；与预注册第八节一致。 */
export const R6_FUNNEL_WEAK_EVIDENCE_COVERAGE = 0.5;

export type R6FunnelEvidence = "exact" | "weak" | "none";

export interface R6FunnelAttribution {
	readonly story: string;
	readonly floor: number;
	readonly round: number;
	readonly factPath: readonly string[];
	readonly ageFloors: number;
	readonly class: R6FunnelClass;
	readonly evidence: R6FunnelEvidence;
	/** 事实值与写入楼层冲突窗口原文的 4-gram 覆盖率；没有事实值时为 null。 */
	readonly evidenceCoverage: number | null;
	/** 台账段在答题上下文里的段 id；没有台账段时为 null。 */
	readonly ledgerSegmentId: string | null;
	readonly judgeReason: string | null;
}

export interface R6FunnelStorySummary {
	readonly story: string;
	readonly contradicted: number;
	readonly classes: Readonly<Record<R6FunnelClass, number>>;
	readonly weakEvidence: number;
}

export interface R6FunnelSummary {
	readonly contradicted: number;
	readonly classes: Readonly<Record<R6FunnelClass, number>>;
	readonly weakEvidence: number;
	/** 探针记录没有保存上下文段，无法做第二步；不进三类。 */
	readonly unattributed: number;
	readonly stories: readonly R6FunnelStorySummary[];
}

export interface R6FunnelReport {
	readonly format: typeof R6_FUNNEL_FORMAT;
	readonly gateVersion: string;
	readonly generatedAt: string;
	readonly dirs: readonly string[];
	readonly summary: R6FunnelSummary;
	readonly attributions: readonly R6FunnelAttribution[];
}

export interface R6FunnelOptions {
	/** 一个或多个 `r6-compare` 运行目录；每个目录下有 `runs/<故事>/<楼层>/native.json`。 */
	readonly dirs: readonly string[];
	readonly log?: (message: string) => void;
	readonly now?: () => number;
}

/** 去掉空白后再比较；台账值与原文的换行和缩进不参与匹配。 */
function normalize(text: string): string {
	return text.replace(/\s+/g, "");
}

function evidenceCoverage(value: string, text: string): number | null {
	const valueGrams = contentGrams(value);
	if (valueGrams.size === 0) return null;
	const textGrams = contentGrams(text);
	let hit = 0;
	for (const gram of valueGrams) {
		if (textGrams.has(gram)) hit += 1;
	}
	return hit / valueGrams.size;
}

interface ProbeRunFile {
	readonly file: string;
	readonly story: string;
	readonly floor: number;
	readonly dbPath: string;
	readonly probes: readonly PlaytestProbeRecord[];
}

/**
 * 三步归因：先看台账事实在写入时有没有原文支撑，再看答题请求的台账段
 * 有没有这条事实，两步都成立才记为「进入 prompt 未答对」。
 */
export function attributeContradictedProbe(input: {
	readonly store: Pick<StoryStore, "getNode" | "getPathToNode">;
	readonly story: string;
	readonly floor: number;
	readonly probe: PlaytestProbeRecord;
}): R6FunnelAttribution | null {
	const probe = input.probe;
	const fact = probe.fact;
	if (fact === null) return null;
	const valueText =
		typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
	const normalizedValue = normalize(valueText);
	const pathSegments = fact.path.filter((segment) => segment.trim().length > 0);
	const floorPath = input.store.getPathToNode(fact.nodeId);
	const evidenceText = floorPath
		.slice(-SETTLE_CONFLICT_WINDOW_FLOORS)
		.map((node) => node.raw)
		.join("\n");
	const coverage = evidenceCoverage(valueText, evidenceText);
	const exact =
		normalizedValue.length > 0 &&
		normalize(evidenceText).includes(normalizedValue);
	const evidence: R6FunnelEvidence = exact
		? "exact"
		: coverage !== null && coverage >= R6_FUNNEL_WEAK_EVIDENCE_COVERAGE
			? "weak"
			: "none";
	const ledgerSegments = probe.context.filter(
		(segment) => segment.slot === "state",
	);
	const ledgerText = normalize(
		ledgerSegments.map((segment) => segment.text).join("\n"),
	);
	const inPrompt =
		ledgerSegments.length > 0 &&
		normalizedValue.length > 0 &&
		ledgerText.includes(normalizedValue) &&
		pathSegments.every((segment) => ledgerText.includes(normalize(segment)));
	const attributedClass: R6FunnelClass =
		evidence === "none"
			? "no-evidence"
			: inPrompt
				? "not-recalled"
				: "not-in-prompt";
	return {
		story: input.story,
		floor: input.floor,
		round: probe.round,
		factPath: fact.path,
		ageFloors: fact.ageFloors,
		class: attributedClass,
		evidence,
		evidenceCoverage: coverage,
		ledgerSegmentId: ledgerSegments[0]?.segmentId ?? null,
		judgeReason: probe.reason,
	};
}

async function readRunFile(
	file: string,
	story: string,
	floor: number,
	dbPath: string,
): Promise<ProbeRunFile> {
	const value: unknown = JSON.parse(await readFile(file, "utf8"));
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${file} 不是对象`);
	}
	if (!("records" in value) || !Array.isArray(value.records)) {
		throw new Error(`${file} 缺少 records`);
	}
	const probes: PlaytestProbeRecord[] = [];
	for (const round of value.records) {
		if (typeof round !== "object" || round === null) continue;
		if (!("probe" in round)) continue;
		const probe = round.probe;
		if (probe === undefined || probe === null) continue;
		probes.push(assertProbeRecord(probe, file));
	}
	return { file, story, floor, dbPath, probes };
}

/**
 * sidecar 由 `r6-compare` 写出，这里只校验遗忘漏斗真正读取的字段：
 * 判定状态、轮次、事实与答题上下文段。形状不对直接失败并指出文件。
 */
function assertProbeRecord(value: unknown, file: string): PlaytestProbeRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${file} 里的探针记录不是对象`);
	}
	if (!("status" in value) || typeof value.status !== "string") {
		throw new Error(`${file} 里的探针记录缺少 status`);
	}
	if (!("round" in value) || typeof value.round !== "number") {
		throw new Error(`${file} 里的探针记录缺少 round`);
	}
	if (
		!("verdict" in value) ||
		(typeof value.verdict !== "string" && value.verdict !== null)
	) {
		throw new Error(`${file} 里的探针记录缺少 verdict`);
	}
	// 旧 sidecar 没有 context：读回后按「无法归因」计数，不猜测分类。
	return value as PlaytestProbeRecord;
}

async function readRunFiles(dir: string): Promise<ProbeRunFile[]> {
	const runsDir = path.join(dir, "runs");
	if (!existsSync(runsDir)) {
		throw new Error(`运行目录里没有 runs：${dir}`);
	}
	const files: ProbeRunFile[] = [];
	const stories = (await readdir(runsDir, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	for (const story of stories) {
		const storyDir = path.join(runsDir, story);
		const floors = (await readdir(storyDir, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort((left, right) => Number(left) - Number(right));
		for (const floorDir of floors) {
			const floor = Number(floorDir);
			if (!Number.isInteger(floor) || floor < 1) {
				throw new Error(`${storyDir} 里的楼层目录名不是正整数：${floorDir}`);
			}
			const file = path.join(storyDir, floorDir, "native.json");
			if (!existsSync(file)) continue;
			files.push(
				await readRunFile(
					file,
					story,
					floor,
					path.join(storyDir, floorDir, "native.db"),
				),
			);
		}
	}
	return files;
}

function emptyClasses(): Record<R6FunnelClass, number> {
	return { "no-evidence": 0, "not-in-prompt": 0, "not-recalled": 0 };
}

function summarizeAttributions(
	attributions: readonly R6FunnelAttribution[],
	unattributed: number,
): R6FunnelSummary {
	const classes = emptyClasses();
	let weakEvidence = 0;
	const byStory = new Map<string, R6FunnelAttribution[]>();
	for (const attribution of attributions) {
		classes[attribution.class] += 1;
		if (attribution.evidence === "weak") weakEvidence += 1;
		byStory.set(attribution.story, [
			...(byStory.get(attribution.story) ?? []),
			attribution,
		]);
	}
	const stories = [...byStory.keys()].sort().map((story) => {
		const items = byStory.get(story) ?? [];
		const storyClasses = emptyClasses();
		let storyWeak = 0;
		for (const item of items) {
			storyClasses[item.class] += 1;
			if (item.evidence === "weak") storyWeak += 1;
		}
		return {
			story,
			contradicted: items.length,
			classes: storyClasses,
			weakEvidence: storyWeak,
		};
	});
	return {
		contradicted: attributions.length,
		classes,
		weakEvidence,
		unattributed,
		stories,
	};
}

/**
 * 对运行目录里每条判为矛盾的探针做遗忘漏斗归因。只读数据库与 sidecar，
 * 不调用任何模型。
 */
export async function runR6Funnel(
	options: R6FunnelOptions,
): Promise<R6FunnelReport> {
	if (options.dirs.length === 0) {
		throw new Error("至少需要一个运行目录");
	}
	const log = options.log ?? ((message: string) => console.log(message));
	const attributions: R6FunnelAttribution[] = [];
	let unattributed = 0;
	let contradicted = 0;
	for (const dir of options.dirs) {
		const files = await readRunFiles(dir);
		for (const file of files) {
			const probes = file.probes.filter(
				(probe) => probe.status === "done" && probe.verdict === "contradicted",
			);
			if (probes.length === 0) continue;
			if (!existsSync(file.dbPath)) {
				throw new Error(`探针所在运行的数据库不存在：${file.dbPath}`);
			}
			const store = StoryStoreClass.open(file.dbPath);
			try {
				for (const probe of probes) {
					contradicted += 1;
					if (!Array.isArray(probe.context)) {
						unattributed += 1;
						continue;
					}
					const attribution = attributeContradictedProbe({
						store,
						story: file.story,
						floor: file.floor,
						probe,
					});
					if (attribution === null) {
						unattributed += 1;
						continue;
					}
					attributions.push(attribution);
				}
			} finally {
				store.close();
			}
		}
		log(`${dir}：矛盾探针归因完成`);
	}
	attributions.sort((left, right) =>
		left.story === right.story
			? left.floor === right.floor
				? left.round - right.round
				: left.floor - right.floor
			: left.story < right.story
				? -1
				: 1,
	);
	const summary = summarizeAttributions(attributions, unattributed);
	if (summary.contradicted + unattributed !== contradicted) {
		throw new Error(
			`归因数量与矛盾探针数不一致：${summary.contradicted} 加 ${unattributed} 不等于 ${contradicted}`,
		);
	}
	return {
		format: R6_FUNNEL_FORMAT,
		gateVersion: R6_GATE_VERSION,
		generatedAt: new Date((options.now ?? Date.now)()).toISOString(),
		dirs: [...options.dirs],
		summary,
		attributions,
	};
}

function formatPercent(value: number, total: number): string {
	return total === 0 ? "—" : `${((value / total) * 100).toFixed(1)}%`;
}

/** 改进方向按占比最大的一类决定；没有样本时返回 null。 */
export function r6FunnelDirection(
	summary: R6FunnelSummary,
): R6FunnelClass | null {
	let best: R6FunnelClass | null = null;
	let bestCount = 0;
	for (const kind of R6_FUNNEL_CLASSES) {
		const count = summary.classes[kind];
		if (count > bestCount) {
			best = kind;
			bestCount = count;
		}
	}
	return best;
}

const DIRECTION_ADVICE: Readonly<Record<R6FunnelClass, string>> = {
	"no-evidence": "指向结算器：台账事实在写入楼层与冲突窗口里找不到原文支撑。",
	"not-in-prompt":
		"指向上下文组装：事实有原文支撑，但没有进入答题请求的台账段。",
	"not-recalled": "指向裁判或写作模型：事实已进入 prompt 仍被判为矛盾。",
};

/** 报告只写聚合数字与故事 slug，不含台账路径、题目与回答。 */
export function formatR6FunnelReport(report: R6FunnelReport): string {
	const summary = report.summary;
	const lines: string[] = [];
	lines.push("# R6 遗忘漏斗诊断");
	lines.push("");
	lines.push(`- 门槛版本：${report.gateVersion}`);
	lines.push(`- 生成时间：${report.generatedAt}`);
	lines.push(`- 运行目录：${report.dirs.length} 个`);
	lines.push(
		`- 矛盾探针：${summary.contradicted} 条；无法归因（记录里没有上下文段）${summary.unattributed} 条`,
	);
	lines.push(
		"- 口径：按台账依据、答题上下文、答对与否三步顺序判定，三类互斥；弱依据指事实值与写入楼层原文的内容字符 4-gram 覆盖率不低于 50%。",
	);
	lines.push("");
	lines.push("## 三类分布");
	lines.push("");
	lines.push("|类别|条数|占比|");
	lines.push("|---|---:|---:|");
	for (const kind of R6_FUNNEL_CLASSES) {
		const count = summary.classes[kind];
		lines.push(
			`|${R6_FUNNEL_CLASS_LABELS[kind]}|${count}|${formatPercent(count, summary.contradicted)}|`,
		);
	}
	lines.push("");
	lines.push(`- 弱依据：${summary.weakEvidence} 条`);
	const direction = r6FunnelDirection(summary);
	lines.push(
		`- 改进方向：${direction === null ? "没有矛盾探针，不产生方向" : `${R6_FUNNEL_CLASS_LABELS[direction]}。${DIRECTION_ADVICE[direction]}`}`,
	);
	lines.push("");
	lines.push("## 按故事");
	lines.push("");
	lines.push("|故事|矛盾|无依据|未进入 prompt|进入 prompt 未答对|弱依据|");
	lines.push("|---|---:|---:|---:|---:|---:|");
	for (const story of summary.stories) {
		lines.push(
			`|${story.story}|${story.contradicted}|${story.classes["no-evidence"]}|${story.classes["not-in-prompt"]}|${story.classes["not-recalled"]}|${story.weakEvidence}|`,
		);
	}
	lines.push("");
	return lines.join("\n");
}
