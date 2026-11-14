import {
	type BackgroundJob,
	type LlmCallOptions,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	NO_CONTINUATION,
	type StoryStore,
	applySettlementProposals,
	buildSettlementMessages,
	createDirectorBitJudgmentsHandler,
	createSceneHandler,
	createSceneLogHandler,
	createUserWillHandler,
	isLedgerNamespace,
	parseSettleResponse,
	prepareSettlementForNodes,
} from "@dramaticer/core";
import {
	type CompareAgreement,
	type SettlementFloorView,
	compareFloors,
} from "./gap-pass-compare.js";

/** 场记对照的默认结算窗口；与生产一致。两边用同一个值。 */
export const SCENE_LOG_COMPARE_SETTLE_WINDOW = 4;

export interface SceneLogCompareOptions {
	readonly storyId: string;
	/** 要对照的助手楼层，按路径从旧到新排列；两个库都必须有这些楼层。 */
	readonly nodeIds: readonly string[];
	/** 独立任务档（结算、现场分析、用户意志、小品条件）。 */
	readonly independent: StoryStore;
	/** 场记档。 */
	readonly merged: StoryStore;
	readonly independentClient: LlmClient;
	readonly mergedClient: LlmClient;
	/** 结算窗口楼层数；默认 4，与生产一致。 */
	readonly settleWindowFloors?: number;
}

export interface SceneLogRegimeStats {
	readonly label: string;
	readonly floors: number;
	/** 有结算记录（独立档）或有场记记录（场记档）的楼层数。 */
	readonly processedFloors: number;
	readonly diffs: number;
	readonly repairs: number;
	readonly requests: number;
	readonly failures: readonly SceneLogCompareFailure[];
}

export interface SceneLogCompareFailure {
	readonly nodeId: string;
	readonly step: string;
	readonly error: string;
}

export interface SceneLogQuoteAgreement {
	readonly submitted: number;
	readonly verified: number;
	readonly rejected: number;
	/** 核验通过的引文比例；没有提交过状态时为 null。 */
	readonly hitRate: number | null;
}

export interface SceneLogConditionAgreement {
	/** 两边都给出了判断的条件数；场记档要求恰好覆盖，独立档没有条件时不判。 */
	readonly compared: number;
	readonly agree: number;
	readonly agreement: number | null;
}

export interface SceneLogCompareResult {
	readonly storyId: string;
	readonly floors: number;
	readonly independent: SceneLogRegimeStats;
	readonly merged: SceneLogRegimeStats;
	readonly agreement: CompareAgreement;
	readonly quotes: SceneLogQuoteAgreement;
	readonly conditions: SceneLogConditionAgreement;
	readonly perFloor: readonly SceneLogFloorComparison[];
}

export interface SceneLogFloorComparison {
	readonly storyId: string;
	readonly nodeId: string;
	readonly independentPaths: readonly string[];
	readonly mergedPaths: readonly string[];
	/** 两边写入的路径、操作与值，逐条一个 JSON 字符串。 */
	readonly independentDiffs: readonly string[];
	readonly mergedDiffs: readonly string[];
	/** 逐条拒绝原因，格式为「动作:路径:原因」。 */
	readonly independentRepairs: readonly string[];
	readonly mergedRepairs: readonly string[];
	/** 场记档在这个楼层提交与核验通过的引文；独立档没有引文。 */
	readonly quotes: SceneLogQuoteAgreement;
	/** 这个楼层两边各自发出的模型请求数。 */
	readonly independentRequests: number;
	readonly mergedRequests: number;
}

interface CountingClient {
	readonly client: LlmClient;
	requests: number;
}

function countingClient(client: LlmClient): CountingClient {
	const counted: CountingClient = {
		requests: 0,
		client: {
			async complete(
				request: LlmRequest,
				options?: LlmCallOptions,
			): Promise<LlmResult> {
				counted.requests += 1;
				return client.complete(request, options);
			},
		},
	};
	return counted;
}

function jobFor(kind: string, storyId: string, nodeId: string): BackgroundJob {
	const now = new Date().toISOString();
	return {
		id: 1,
		storyId,
		nodeId,
		kind,
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: now,
		startedAt: now,
		finishedAt: null,
	};
}

/**
 * 同一批楼层分别跑独立任务与场记，按楼层的台账路径、值与引文命中率对照。
 * 两边必须是各自独立、内容相同的数据库：两个档位都会写台账。
 */
export async function compareSceneLog(
	options: SceneLogCompareOptions,
): Promise<SceneLogCompareResult> {
	if (options.nodeIds.length === 0) {
		throw new Error("场记对照至少需要一个楼层");
	}
	const settleWindowFloors =
		options.settleWindowFloors ?? SCENE_LOG_COMPARE_SETTLE_WINDOW;
	if (!Number.isInteger(settleWindowFloors) || settleWindowFloors < 1) {
		throw new Error("对照的结算窗口必须是正整数");
	}
	const independent = countingClient(options.independentClient);
	const merged = countingClient(options.mergedClient);
	const failures: {
		independent: SceneLogCompareFailure[];
		merged: SceneLogCompareFailure[];
	} = { independent: [], merged: [] };
	const independentViews: SettlementFloorView[] = [];
	const mergedViews: SettlementFloorView[] = [];
	const floorDetails: {
		quotes: SceneLogQuoteAgreement;
		independentRequests: number;
		mergedRequests: number;
	}[] = [];
	let quoteSubmitted = 0;
	let quoteVerified = 0;
	let conditionsCompared = 0;
	let conditionsAgree = 0;

	for (const nodeId of options.nodeIds) {
		const independentRequestsBefore = independent.requests;
		const mergedRequestsBefore = merged.requests;
		await runStep(failures.independent, nodeId, "settle", async () => {
			const window = prepareSettlementForNodes(
				options.independent,
				options.storyId,
				[nodeId],
				{ windowSize: settleWindowFloors },
			);
			if (window === null) throw new Error(`楼层 ${nodeId} 无法构建结算窗口`);
			const result = await independent.client.complete(
				{
					messages: buildSettlementMessages(window),
					temperature: 0,
				},
				NO_CONTINUATION,
			);
			applySettlementProposals(
				options.independent,
				window,
				parseSettleResponse(result.text, [nodeId]),
			);
		});
		await runStep(failures.independent, nodeId, "scene", async () => {
			await createSceneHandler()({
				store: options.independent,
				client: independent.client,
				job: jobFor("scene", options.storyId, nodeId),
			});
		});
		await runStep(failures.independent, nodeId, "user_will", async () => {
			await createUserWillHandler()({
				store: options.independent,
				client: independent.client,
				job: jobFor("user_will", options.storyId, nodeId),
			});
		});
		await runStep(failures.independent, nodeId, "director_bits", async () => {
			await createDirectorBitJudgmentsHandler({ client: independent.client })({
				store: options.independent,
				client: independent.client,
				job: jobFor("director_bits", options.storyId, nodeId),
			});
		});
		await runStep(failures.merged, nodeId, "scene_log", async () => {
			await createSceneLogHandler()({
				store: options.merged,
				client: merged.client,
				job: jobFor("scene_log", options.storyId, nodeId),
			});
		});
		const independentView = readFloorView(
			options.independent,
			"independent",
			nodeId,
		);
		const mergedView = readFloorView(options.merged, "merged", nodeId);
		independentViews.push(independentView);
		mergedViews.push(mergedView);
		const mergedLog = options.merged.getSceneLog(nodeId);
		const floorQuotes = quoteAgreement(
			mergedLog?.quotes.submitted ?? 0,
			mergedLog?.quotes.verified ?? 0,
		);
		floorDetails.push({
			quotes: floorQuotes,
			independentRequests: independent.requests - independentRequestsBefore,
			mergedRequests: merged.requests - mergedRequestsBefore,
		});
		if (mergedLog !== null) {
			quoteSubmitted += mergedLog.quotes.submitted;
			quoteVerified += mergedLog.quotes.verified;
			const independentJudgments =
				options.independent.findDirectorBitJudgments(nodeId)?.judgments ?? [];
			const mergedById = new Map(
				mergedLog.conditions.map((judgment) => [judgment.id, judgment.matched]),
			);
			for (const judgment of independentJudgments) {
				const mergedMatched = mergedById.get(judgment.id);
				if (mergedMatched === undefined) continue;
				conditionsCompared += 1;
				if (mergedMatched === judgment.matched) conditionsAgree += 1;
			}
		}
	}

	return {
		storyId: options.storyId,
		floors: options.nodeIds.length,
		independent: regimeStats(
			"独立任务",
			independentViews,
			independent.requests,
			failures.independent,
		),
		merged: regimeStats("场记", mergedViews, merged.requests, failures.merged),
		agreement: compareFloors(independentViews, mergedViews),
		quotes: quoteAgreement(quoteSubmitted, quoteVerified),
		conditions: {
			compared: conditionsCompared,
			agree: conditionsAgree,
			agreement:
				conditionsCompared === 0 ? null : conditionsAgree / conditionsCompared,
		},
		perFloor: options.nodeIds.map((nodeId, index) => {
			const independentView = independentViews[index];
			const mergedView = mergedViews[index];
			const detail = floorDetails[index];
			return {
				storyId: options.storyId,
				nodeId,
				independentPaths: independentView?.paths ?? [],
				mergedPaths: mergedView?.paths ?? [],
				independentDiffs: independentView?.facts ?? [],
				mergedDiffs: mergedView?.facts ?? [],
				independentRepairs: independentView?.repairs ?? [],
				mergedRepairs: mergedView?.repairs ?? [],
				quotes: detail?.quotes ?? quoteAgreement(0, 0),
				independentRequests: detail?.independentRequests ?? 0,
				mergedRequests: detail?.mergedRequests ?? 0,
			};
		}),
	};
}

function quoteAgreement(
	submitted: number,
	verified: number,
): SceneLogQuoteAgreement {
	return {
		submitted,
		verified,
		rejected: submitted - verified,
		hitRate: submitted === 0 ? null : verified / submitted,
	};
}

/**
 * 把多个故事的结果加成一份：楼层互不重叠，所以交集与并集可以直接相加，
 * 汇总后的比率按总和重算。
 */
export function combineSceneLogCompare(
	results: readonly SceneLogCompareResult[],
): {
	readonly independent: SceneLogRegimeStats;
	readonly merged: SceneLogRegimeStats;
	readonly agreement: CompareAgreement;
	readonly quotes: SceneLogQuoteAgreement;
	readonly conditions: SceneLogConditionAgreement;
} {
	const total = (pick: (result: SceneLogCompareResult) => number): number =>
		results.reduce((sum, result) => sum + pick(result), 0);
	const pathIntersection = total((result) => result.agreement.pathIntersection);
	const pathUnion = total((result) => result.agreement.pathUnion);
	const factIntersection = total((result) => result.agreement.factIntersection);
	const factUnion = total((result) => result.agreement.factUnion);
	const quoteSubmitted = total((result) => result.quotes.submitted);
	const quoteVerified = total((result) => result.quotes.verified);
	const conditionsCompared = total((result) => result.conditions.compared);
	const conditionsAgree = total((result) => result.conditions.agree);
	return {
		independent: {
			label: "独立任务",
			floors: total((result) => result.independent.floors),
			processedFloors: total((result) => result.independent.processedFloors),
			diffs: total((result) => result.independent.diffs),
			repairs: total((result) => result.independent.repairs),
			requests: total((result) => result.independent.requests),
			failures: results.flatMap((result) => result.independent.failures),
		},
		merged: {
			label: "场记",
			floors: total((result) => result.merged.floors),
			processedFloors: total((result) => result.merged.processedFloors),
			diffs: total((result) => result.merged.diffs),
			repairs: total((result) => result.merged.repairs),
			requests: total((result) => result.merged.requests),
			failures: results.flatMap((result) => result.merged.failures),
		},
		agreement: {
			floors: total((result) => result.agreement.floors),
			floorsBothSettled: total((result) => result.agreement.floorsBothSettled),
			pathIntersection,
			pathUnion,
			pathAgreement: pathUnion === 0 ? null : pathIntersection / pathUnion,
			factIntersection,
			factUnion,
			factAgreement: factUnion === 0 ? null : factIntersection / factUnion,
			floorsIdentical: total((result) => result.agreement.floorsIdentical),
			floorsOneSideEmpty: total(
				(result) => result.agreement.floorsOneSideEmpty,
			),
		},
		quotes: quoteAgreement(quoteSubmitted, quoteVerified),
		conditions: {
			compared: conditionsCompared,
			agree: conditionsAgree,
			agreement:
				conditionsCompared === 0 ? null : conditionsAgree / conditionsCompared,
		},
	};
}

async function runStep(
	failures: SceneLogCompareFailure[],
	nodeId: string,
	step: string,
	action: () => Promise<void>,
): Promise<void> {
	try {
		await action();
	} catch (error) {
		failures.push({
			nodeId,
			step,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/** 逐楼层读取台账写入；路径、值与修复按同一口径生成可比较的键。 */
function readFloorView(
	store: StoryStore,
	label: string,
	nodeId: string,
): SettlementFloorView {
	const diffs = store
		.getStateDiffs(nodeId)
		.filter(
			(diff) =>
				typeof diff.path[0] === "string" && isLedgerNamespace(diff.path[0]),
		);
	const repairs = [
		...(store.getLedgerSettlement(nodeId)?.repairs ?? []),
		...(label === "merged" ? (store.getSceneLog(nodeId)?.repairs ?? []) : []),
	]
		.filter((repair) => repair.action !== "fill")
		.map(
			(repair) => `${repair.action}:${repair.path.join(".")}:${repair.reason}`,
		);
	return {
		nodeId,
		settled: store.getLedgerSettlement(nodeId) !== null,
		paths: diffs.map((diff) => JSON.stringify(diff.path)),
		facts: diffs.map((diff) =>
			JSON.stringify([diff.path, diff.op, diff.value]),
		),
		repairs,
	};
}

function regimeStats(
	label: string,
	views: readonly SettlementFloorView[],
	requests: number,
	failures: readonly SceneLogCompareFailure[],
): SceneLogRegimeStats {
	return {
		label,
		floors: views.length,
		processedFloors: views.filter((view) => view.settled).length,
		diffs: views.reduce((total, view) => total + view.paths.length, 0),
		repairs: views.reduce((total, view) => total + view.repairs.length, 0),
		requests,
		failures,
	};
}

/** 文本版对照结果；报告与终端输出共用。 */
export function formatSceneLogCompare(result: SceneLogCompareResult): string {
	const lines: string[] = [
		`故事 ${result.storyId}，样本 ${result.floors} 个助手楼层`,
		`独立任务：请求 ${result.independent.requests} 次，台账 ${result.independent.diffs} 条，修复 ${result.independent.repairs} 条，失败 ${result.independent.failures.length} 次`,
		`场记：请求 ${result.merged.requests} 次，台账 ${result.merged.diffs} 条，修复 ${result.merged.repairs} 条，失败 ${result.merged.failures.length} 次`,
		`路径一致率 ${formatRatio(result.agreement.pathAgreement)}（交集 ${result.agreement.pathIntersection} / 并集 ${result.agreement.pathUnion}）`,
		`事实一致率 ${formatRatio(result.agreement.factAgreement)}（交集 ${result.agreement.factIntersection} / 并集 ${result.agreement.factUnion}）`,
		`引文命中率 ${formatRatio(result.quotes.hitRate)}（核验 ${result.quotes.verified} / 提交 ${result.quotes.submitted}）`,
		`条件判断一致率 ${formatRatio(result.conditions.agreement)}（一致 ${result.conditions.agree} / 对照 ${result.conditions.compared}）`,
	];
	for (const failure of [
		...result.independent.failures,
		...result.merged.failures,
	]) {
		lines.push(`失败：${failure.step} ${failure.nodeId}：${failure.error}`);
	}
	return lines.join("\n");
}

function formatRatio(value: number | null): string {
	return value === null ? "无样本" : `${(value * 100).toFixed(1)}%`;
}
