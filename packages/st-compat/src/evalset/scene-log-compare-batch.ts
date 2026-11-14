import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { type LlmClient, StoryStore } from "@dramaticer/core";
import type { CompareAgreement } from "./gap-pass-compare.js";
import {
	type SceneLogCompareFailure,
	type SceneLogCompareResult,
	type SceneLogConditionAgreement,
	type SceneLogFloorComparison,
	type SceneLogQuoteAgreement,
	type SceneLogRegimeStats,
	combineSceneLogCompare,
	compareSceneLog,
} from "./scene-log-compare.js";

/** W2-T04 真实对照要求的楼层下限。 */
export const MIN_SCENE_LOG_COMPARE_FLOORS = 20;

export const SCENE_LOG_COMPARE_FORMAT = "scene-log-compare/v1";

export interface SceneLogSampleStory {
	readonly story: string;
	/** 绝对路径；相对路径在读取样本时按样本文件所在目录解析。 */
	readonly sourceDbPath: string;
	/** 固定的助手楼层清单，按路径从旧到新排列。 */
	readonly nodeIds: readonly string[];
}

export interface SceneLogSamples {
	readonly minimumFloors: number;
	readonly stories: readonly SceneLogSampleStory[];
}

export interface SceneLogStorySummary {
	readonly story: string;
	readonly floors: number;
	readonly independentDiffs: number;
	readonly mergedDiffs: number;
	readonly independentRequests: number;
	readonly mergedRequests: number;
	readonly pathAgreement: number | null;
	readonly factAgreement: number | null;
	readonly quoteHitRate: number | null;
	readonly failures: number;
}

export interface SceneLogSampleSummary {
	readonly path: string | null;
	readonly stories: number;
	readonly requestedFloors: number;
	/** 两边都完成结算、进入一致率计算的楼层数。 */
	readonly completedFloors: number;
	readonly minimumFloors: number;
	readonly insufficient: boolean;
	readonly reason: string | null;
}

export interface SceneLogCompareBatchResult {
	readonly format: string;
	readonly generatedAt: string;
	readonly samples: SceneLogSampleSummary;
	readonly independent: SceneLogRegimeStats;
	readonly merged: SceneLogRegimeStats;
	readonly agreement: CompareAgreement;
	readonly quotes: SceneLogQuoteAgreement;
	readonly conditions: SceneLogConditionAgreement;
	readonly stories: readonly SceneLogStorySummary[];
	readonly perFloor: readonly SceneLogFloorComparison[];
	readonly failures: readonly (SceneLogCompareFailure & {
		readonly story: string;
	})[];
}

export interface SceneLogCompareBatchOptions {
	readonly stories: readonly SceneLogSampleStory[];
	/** 运行目录：每个故事在这里得到两份源库副本与一个 `runs/<故事>` 子目录。 */
	readonly dir: string;
	readonly independentClient: LlmClient;
	readonly mergedClient: LlmClient;
	readonly minimumFloors?: number;
	readonly settleWindowFloors?: number;
	/** 写进结果的样本文件路径，只用于追溯。 */
	readonly samplesPath?: string | null;
	readonly log?: (message: string) => void;
	readonly now?: () => Date;
}

/**
 * 读取固定楼层清单。`sourceDb` 可以相对样本文件；楼层必须存在且是助手楼层，
 * 缺一个就直接失败，不跳过。
 */
export async function readSceneLogSamples(
	filePath: string,
): Promise<SceneLogSamples> {
	const raw = await readFile(filePath, "utf8");
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`${filePath} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${filePath} 必须是带 stories 的 JSON 对象`);
	}
	const record = value as Record<string, unknown>;
	const minimumFloors =
		record.minimumFloors === undefined
			? MIN_SCENE_LOG_COMPARE_FLOORS
			: requirePositiveInteger(record.minimumFloors, "minimumFloors");
	if (!Array.isArray(record.stories) || record.stories.length === 0) {
		throw new Error(`${filePath} 的 stories 必须是非空数组`);
	}
	const baseDir = path.dirname(path.resolve(filePath));
	const stories: SceneLogSampleStory[] = [];
	const seenStories = new Set<string>();
	for (const [index, item] of record.stories.entries()) {
		const entry = requireObject(item, `stories[${index}]`);
		const story = requireNonEmptyString(entry.story, `stories[${index}].story`);
		if (seenStories.has(story)) {
			throw new Error(`${filePath} 里的故事 ${story} 出现了多次`);
		}
		seenStories.add(story);
		const sourceDb = requireNonEmptyString(
			entry.sourceDb,
			`stories[${index}].sourceDb`,
		);
		if (!Array.isArray(entry.nodeIds) || entry.nodeIds.length === 0) {
			throw new Error(`stories[${index}].nodeIds 必须是非空数组`);
		}
		const nodeIds: string[] = [];
		for (const [position, nodeId] of entry.nodeIds.entries()) {
			const id = requireNonEmptyString(
				nodeId,
				`stories[${index}].nodeIds[${position}]`,
			);
			if (nodeIds.includes(id)) {
				throw new Error(`故事 ${story} 的楼层清单里 ${id} 出现了多次`);
			}
			nodeIds.push(id);
		}
		stories.push({
			story,
			sourceDbPath: path.resolve(baseDir, sourceDb),
			nodeIds,
		});
	}
	return { minimumFloors, stories };
}

/**
 * 每个故事复制源数据库两次（独立任务一份、场记一份），在副本上跑对照，
 * 再把结果合成一份。源库只读，副本每次重建。
 */
export async function runSceneLogCompareBatch(
	options: SceneLogCompareBatchOptions,
): Promise<SceneLogCompareBatchResult> {
	if (options.stories.length === 0) {
		throw new Error("场记对照至少需要一个故事");
	}
	if (options.dir.trim().length === 0) {
		throw new Error("运行目录不能为空");
	}
	if (
		options.minimumFloors !== undefined &&
		(!Number.isInteger(options.minimumFloors) || options.minimumFloors < 1)
	) {
		throw new Error(
			`最低样本楼层数必须是不小于 1 的整数，收到 ${options.minimumFloors}`,
		);
	}
	await mkdir(options.dir, { recursive: true });
	const log = options.log ?? (() => undefined);
	const results: SceneLogCompareResult[] = [];
	for (const sample of options.stories) {
		const runDir = path.join(
			options.dir,
			"runs",
			runDirectoryName(sample.story),
		);
		const independentDbPath = path.join(runDir, "independent.db");
		const mergedDbPath = path.join(runDir, "merged.db");
		await copyDatabase(sample.sourceDbPath, independentDbPath);
		await copyDatabase(sample.sourceDbPath, mergedDbPath);
		const independent = StoryStore.open(independentDbPath);
		try {
			const merged = StoryStore.open(mergedDbPath);
			try {
				assertSampleFloors(independent, sample);
				log(
					`故事 ${sample.story}：${sample.nodeIds.length} 个楼层，源库副本在 ${runDir}`,
				);
				results.push(
					await compareSceneLog({
						storyId: sample.story,
						nodeIds: sample.nodeIds,
						independent,
						merged,
						independentClient: options.independentClient,
						mergedClient: options.mergedClient,
						settleWindowFloors: options.settleWindowFloors,
					}),
				);
			} finally {
				merged.close();
			}
		} finally {
			independent.close();
		}
	}

	const combined = combineSceneLogCompare(results);
	const requestedFloors = results.reduce(
		(sum, result) => sum + result.floors,
		0,
	);
	const completedFloors = combined.agreement.floorsBothSettled;
	const minimumFloors = options.minimumFloors ?? MIN_SCENE_LOG_COMPARE_FLOORS;
	const reason =
		requestedFloors < minimumFloors
			? `样本清单只有 ${requestedFloors} 个楼层，低于下限 ${minimumFloors}`
			: completedFloors < minimumFloors
				? `两边都完成结算的楼层只有 ${completedFloors} 个，低于下限 ${minimumFloors}`
				: null;
	const failures = results.flatMap((result) =>
		[...result.independent.failures, ...result.merged.failures].map(
			(failure) => ({ story: result.storyId, ...failure }),
		),
	);
	return {
		format: SCENE_LOG_COMPARE_FORMAT,
		generatedAt: (options.now ?? (() => new Date()))().toISOString(),
		samples: {
			path: options.samplesPath ?? null,
			stories: results.length,
			requestedFloors,
			completedFloors,
			minimumFloors,
			insufficient: reason !== null,
			reason,
		},
		independent: combined.independent,
		merged: combined.merged,
		agreement: combined.agreement,
		quotes: combined.quotes,
		conditions: combined.conditions,
		stories: results.map((result) => ({
			story: result.storyId,
			floors: result.floors,
			independentDiffs: result.independent.diffs,
			mergedDiffs: result.merged.diffs,
			independentRequests: result.independent.requests,
			mergedRequests: result.merged.requests,
			pathAgreement: result.agreement.pathAgreement,
			factAgreement: result.agreement.factAgreement,
			quoteHitRate: result.quotes.hitRate,
			failures:
				result.independent.failures.length + result.merged.failures.length,
		})),
		perFloor: results.flatMap((result) => result.perFloor),
		failures,
	};
}

/** 文本版批次结果；报告与终端输出共用。 */
export function formatSceneLogCompareBatchReport(
	result: SceneLogCompareBatchResult,
): string {
	const lines: string[] = ["# 场记对照", ""];
	lines.push(
		`- 样本：${result.samples.stories} 个故事、${result.samples.requestedFloors} 个楼层；两边都完成结算 ${result.samples.completedFloors} 个，下限 ${result.samples.minimumFloors}`,
	);
	lines.push(
		result.samples.insufficient
			? `- 样本判定：不足——${result.samples.reason}`
			: "- 样本判定：达到下限",
	);
	if (result.samples.path !== null) {
		lines.push(`- 样本文件：${result.samples.path}`);
	}
	lines.push(
		`- 独立任务：请求 ${result.independent.requests} 次，台账 ${result.independent.diffs} 条，修复 ${result.independent.repairs} 条，失败 ${result.independent.failures.length} 次`,
	);
	lines.push(
		`- 场记：请求 ${result.merged.requests} 次，台账 ${result.merged.diffs} 条，修复 ${result.merged.repairs} 条，失败 ${result.merged.failures.length} 次`,
	);
	lines.push(
		`- 路径一致率 ${formatRatio(result.agreement.pathAgreement)}（交集 ${result.agreement.pathIntersection} / 并集 ${result.agreement.pathUnion}）`,
	);
	lines.push(
		`- 事实一致率 ${formatRatio(result.agreement.factAgreement)}（交集 ${result.agreement.factIntersection} / 并集 ${result.agreement.factUnion}）`,
	);
	lines.push(
		`- 引文命中率 ${formatRatio(result.quotes.hitRate)}（核验 ${result.quotes.verified} / 提交 ${result.quotes.submitted}，拒绝 ${result.quotes.rejected}）`,
	);
	lines.push(
		`- 条件判断一致率 ${formatRatio(result.conditions.agreement)}（一致 ${result.conditions.agree} / 对照 ${result.conditions.compared}）`,
	);
	lines.push("", "## 逐故事", "");
	lines.push(
		"|故事|楼层|独立 diff|场记 diff|独立请求|场记请求|路径一致率|事实一致率|引文命中率|失败|",
	);
	lines.push("|---|---|---|---|---|---|---|---|---|---|");
	for (const story of result.stories) {
		lines.push(
			`|${story.story}|${story.floors}|${story.independentDiffs}|${story.mergedDiffs}|${story.independentRequests}|${story.mergedRequests}|${formatRatio(story.pathAgreement)}|${formatRatio(story.factAgreement)}|${formatRatio(story.quoteHitRate)}|${story.failures}|`,
		);
	}
	lines.push("", "## 逐楼层", "");
	lines.push(
		"|故事|楼层|独立 diff|场记 diff|独立请求|场记请求|引文核验|引文提交|独立修复|场记修复|",
	);
	lines.push("|---|---|---|---|---|---|---|---|---|---|");
	for (const floor of result.perFloor) {
		lines.push(
			`|${floor.storyId}|${floor.nodeId}|${floor.independentDiffs.length}|${floor.mergedDiffs.length}|${floor.independentRequests}|${floor.mergedRequests}|${floor.quotes.verified}|${floor.quotes.submitted}|${floor.independentRepairs.length}|${floor.mergedRepairs.length}|`,
		);
	}
	const repairLines = result.perFloor.flatMap((floor) => {
		const entries = [
			...floor.independentRepairs.map((repair) => `独立任务 ${repair}`),
			...floor.mergedRepairs.map((repair) => `场记 ${repair}`),
		];
		return entries.length === 0
			? []
			: [`- ${floor.storyId} ${floor.nodeId}：${entries.join("；")}`];
	});
	if (repairLines.length > 0) {
		lines.push("", "## 拒绝原因", "", ...repairLines);
	}
	if (result.failures.length > 0) {
		lines.push("", "## 失败", "");
		for (const failure of result.failures) {
			lines.push(
				`- ${failure.story} ${failure.nodeId} ${failure.step}：${failure.error}`,
			);
		}
	}
	return lines.join("\n");
}

function formatRatio(value: number | null): string {
	return value === null ? "无样本" : `${(value * 100).toFixed(1)}%`;
}

async function copyDatabase(source: string, target: string): Promise<void> {
	await mkdir(path.dirname(target), { recursive: true });
	for (const file of [target, `${target}-wal`, `${target}-shm`]) {
		await rm(file, { force: true });
	}
	await copyFile(source, target);
}

function assertSampleFloors(
	store: StoryStore,
	sample: SceneLogSampleStory,
): void {
	if (store.getStory(sample.story) === null) {
		throw new Error(`数据库 ${sample.sourceDbPath} 里没有故事 ${sample.story}`);
	}
	for (const nodeId of sample.nodeIds) {
		const node = store.getNode(nodeId);
		if (node === null) {
			throw new Error(`故事 ${sample.story} 没有楼层 ${nodeId}`);
		}
		if (node.storyId !== sample.story) {
			throw new Error(`楼层 ${nodeId} 不属于故事 ${sample.story}`);
		}
		if (node.role !== "assistant") {
			throw new Error(
				`样本楼层 ${nodeId} 是 ${node.role}，场记对照只接受助手楼层`,
			);
		}
	}
}

/** 中文故事 id 会退化成同一个下划线串，末尾用 id 摘要区分。 */
function runDirectoryName(story: string): string {
	const safe = story.replace(/[^A-Za-z0-9._-]+/g, "_");
	const digest = createHash("sha256").update(story).digest("hex").slice(0, 8);
	return `${safe}-${digest}`;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`${label} 必须是不小于 1 的整数`);
	}
	return value;
}
