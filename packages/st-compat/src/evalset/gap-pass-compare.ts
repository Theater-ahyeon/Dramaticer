import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	type BackgroundJob,
	BackgroundJobDeferredError,
	type BackgroundJobHandler,
	type LlmCallOptions,
	type LlmRequest,
	type LlmResult,
	type LlmStream,
	type LlmStreamingClient,
	type StoryStore,
	StoryStore as StoryStoreClass,
	createGapPassHandler,
	createMemoryRevisionHandler,
	createSceneHandler,
	createSettleHandler,
	createUserWillHandler,
} from "@dramaticer/core";
import { importChatToStore } from "../chat-import.js";
import { type StChatEntry, parseChatJsonlFile } from "../chat-jsonl.js";
import { openSnapshot } from "../health/manifest.js";
import { selectTargets } from "./events-backfill.js";
import { importStoryEntities } from "./memory-eval.js";

/** 对比样本的最少楼层数；任务要求至少 20 个楼层。 */
export const MIN_COMPARE_FLOORS = 20;

/** 独立任务里结算窗口的楼层数；与生产默认值一致。 */
const SETTLE_WINDOW_FLOORS = 4;

/** 与后台任务框架一致：一个任务连续失败 3 次才放弃。 */
const JOB_ATTEMPTS = 3;

export interface GapPassCompareOptions {
	readonly rawRoot: string;
	/** manifest 里的对话 id。 */
	readonly story: string;
	/** 取该对话主路径上最早的多少个助手楼层；至少 20。 */
	readonly floors: number;
	/** 两个对比数据库所在的目录；每次运行前重建。 */
	readonly dir: string;
	readonly client: LlmStreamingClient;
	readonly log?: (message: string) => void;
	/** 结算窗口的楼层数；默认 4。 */
	readonly windowSize?: number;
}

/** 一个楼层的结算结果视图；两边用相同的楼层 id 对齐。 */
export interface SettlementFloorView {
	readonly nodeId: string;
	readonly settled: boolean;
	/** 结算写进这个楼层的台账路径，每条一个 JSON 数组字符串。 */
	readonly paths: readonly string[];
	/** 路径、操作与值都相同的可比较键。 */
	readonly facts: readonly string[];
	readonly repairs: readonly string[];
}

export interface CompareRegimeStats {
	readonly label: string;
	readonly settledFloors: number;
	readonly diffs: number;
	readonly repairCount: number;
	/** 补写缺失路径之外的修复：非法条目、悬空的状态改写与冲突。 */
	readonly invalidEntries: number;
	readonly conflictRepairs: number;
	/** 合并调用里整段被拒绝的结算次数。 */
	readonly settleSegmentRejections: number;
	readonly settlerCards: number;
	readonly deferredJobs: number;
	readonly failedJobs: readonly {
		readonly nodeId: string;
		readonly kind: string;
		readonly error: string;
	}[];
	readonly requests: number;
	readonly cachedRequests: number;
}

export interface CompareAgreement {
	readonly floors: number;
	readonly floorsBothSettled: number;
	readonly pathIntersection: number;
	readonly pathUnion: number;
	/** 交集 / 并集；两边都没有写任何路径时为 null。 */
	readonly pathAgreement: number | null;
	readonly factIntersection: number;
	readonly factUnion: number;
	readonly factAgreement: number | null;
	readonly floorsIdentical: number;
	readonly floorsOneSideEmpty: number;
}

export interface GapPassCompareReport {
	readonly story: string;
	readonly floors: number;
	readonly generatedAt: string;
	readonly independent: CompareRegimeStats;
	readonly merged: CompareRegimeStats;
	readonly agreement: CompareAgreement;
	readonly perFloor: readonly {
		readonly nodeId: string;
		readonly independentPaths: readonly string[];
		readonly mergedPaths: readonly string[];
	}[];
}

interface RequestStats {
	requests: number;
	cachedRequests: number;
}

interface CountedClient {
	readonly client: LlmStreamingClient;
	readonly stats: RequestStats;
}

export interface GapPassCompareEntriesOptions {
	readonly story: string;
	readonly floors: number;
	readonly dir: string;
	readonly client: LlmStreamingClient;
	readonly entries: readonly StChatEntry[];
	readonly log?: (message: string) => void;
	/** 结算窗口的楼层数；默认 4，与生产一致。两边用同一个值。 */
	readonly windowSize?: number;
	/** 导入楼层之后补齐实体与 lore；真实运行时由 manifest 提供。 */
	readonly prepareStore?: (store: StoryStore, storyId: string) => Promise<void>;
}

/**
 * 在同一个对话的同一段楼层上分别跑合并调用与四个独立任务，再按楼层对比
 * 结算结果。两个数据库使用同一个故事 id，楼层 id 由消息序号生成，因此
 * 可以直接对齐。
 */
export async function runGapPassCompare(
	options: GapPassCompareOptions,
): Promise<GapPassCompareReport> {
	if (
		!Number.isInteger(options.floors) ||
		options.floors < MIN_COMPARE_FLOORS
	) {
		throw new Error(
			`对比样本至少要 ${MIN_COMPARE_FLOORS} 个楼层，收到 ${options.floors}`,
		);
	}
	const entries = await readSampleEntries(
		options.rawRoot,
		options.story,
		options.floors,
	);
	const snapshot = await openSnapshot(options.rawRoot);
	const [target] = selectTargets(snapshot, options.story);
	if (target === undefined)
		throw new Error(`manifest 里没有故事 ${options.story}`);
	const character = target.file.character ?? options.story;
	return runGapPassCompareOnEntries({
		story: options.story,
		floors: options.floors,
		dir: options.dir,
		client: options.client,
		entries,
		log: options.log,
		windowSize: options.windowSize,
		prepareStore: async (store, storyId) => {
			await importStoryEntities(store, storyId, snapshot, character);
		},
	});
}

/**
 * 已经解析好楼层时的对比入口：不读 manifest，也不导入实体与 lore，
 * 只做两次导入、两轮任务与一次对比。测试与真实运行共用这一段。
 * 每跑完一个档位就把楼层视图与统计写进 `dir` 下的 sidecar；重跑时
 * 直接复用，中断只损失正在进行的请求。
 */
export async function runGapPassCompareOnEntries(
	options: GapPassCompareEntriesOptions,
): Promise<GapPassCompareReport> {
	if (!Number.isInteger(options.floors) || options.floors < 1) {
		throw new Error(`对比样本的楼层数必须是正整数，收到 ${options.floors}`);
	}
	const windowSize = options.windowSize ?? SETTLE_WINDOW_FLOORS;
	if (!Number.isInteger(windowSize) || windowSize < 1) {
		throw new Error(`结算窗口的楼层数必须是正整数，收到 ${windowSize}`);
	}
	const log = options.log ?? (() => undefined);
	await mkdir(options.dir, { recursive: true });
	const independent = await runOrLoadRegime({
		regime: "independent",
		options,
		log,
		run: async (store, nodeIds) => {
			const counted = countClient(options.client);
			const outcome = await runIndependentRegime({
				store,
				storyId: options.story,
				nodeIds,
				client: counted.client,
				log,
				windowSize,
			});
			return { outcome, stats: counted.stats };
		},
	});
	const merged = await runOrLoadRegime({
		regime: "merged",
		options,
		log,
		run: async (store, nodeIds) => {
			const counted = countClient(options.client);
			const outcome = await runMergedRegime({
				store,
				storyId: options.story,
				nodeIds,
				client: counted.client,
				log,
				windowSize,
			});
			return { outcome, stats: counted.stats };
		},
	});
	if (independent.floors.length !== merged.floors.length) {
		throw new Error("两次运行的样本楼层数不一致");
	}
	return {
		story: options.story,
		floors: options.floors,
		generatedAt: new Date().toISOString(),
		independent: independent.stats,
		merged: merged.stats,
		agreement: compareFloors(independent.floors, merged.floors),
		perFloor: independent.floors.map((floor, index) => ({
			nodeId: floor.nodeId,
			independentPaths: floor.paths.slice().sort(),
			mergedPaths: merged.floors[index]?.paths.slice().sort() ?? [],
		})),
	};
}

type CompareRegime = "independent" | "merged";

interface RegimeSnapshot {
	readonly story: string;
	readonly floors: readonly SettlementFloorView[];
	readonly stats: CompareRegimeStats;
}

interface RegimeRun {
	readonly outcome: RegimeRunOutcome;
	readonly stats: RequestStats;
}

async function runOrLoadRegime(input: {
	readonly regime: CompareRegime;
	readonly options: GapPassCompareEntriesOptions;
	readonly log: (message: string) => void;
	readonly run: (
		store: StoryStore,
		nodeIds: readonly string[],
	) => Promise<RegimeRun>;
}): Promise<RegimeSnapshot> {
	const sidecar = path.join(input.options.dir, `${input.regime}.result.json`);
	const saved = await readSidecar(sidecar);
	if (saved !== null) {
		if (saved.story !== input.options.story) {
			throw new Error(
				`${sidecar} 是故事 ${saved.story} 的样本，与本次的 ${input.options.story} 不一致`,
			);
		}
		if (saved.floors.length !== input.options.floors) {
			throw new Error(
				`${sidecar} 的样本是 ${saved.floors.length} 个楼层，与本次的 ${input.options.floors} 不一致`,
			);
		}
		input.log(`${saved.stats.label}：复用已完成的样本`);
		return saved;
	}
	const store = await importSample(
		input.options.entries,
		input.options.story,
		path.join(input.options.dir, `${input.regime}.db`),
		input.options.prepareStore,
	);
	try {
		const nodeIds = assistantNodeIds(store, input.options.story).slice(
			0,
			input.options.floors,
		);
		if (nodeIds.length < input.options.floors) {
			throw new Error(
				`对话 ${input.options.story} 只有 ${nodeIds.length} 个助手楼层，不足 ${input.options.floors}`,
			);
		}
		const { outcome, stats } = await input.run(store, nodeIds);
		const floors = measureFloors(store, input.options.story, nodeIds);
		const snapshot: RegimeSnapshot = {
			story: input.options.story,
			floors,
			stats: summarizeRegime(
				input.regime === "independent" ? "独立任务" : "合并调用",
				store,
				input.options.story,
				floors,
				stats,
				outcome,
			),
		};
		await writeFile(sidecar, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
		input.log(`${snapshot.stats.label}：样本已保存到 ${sidecar}`);
		return snapshot;
	} finally {
		store.close();
	}
}

async function readSidecar(file: string): Promise<RegimeSnapshot | null> {
	try {
		const raw = await readFile(file, "utf8");
		return JSON.parse(raw) as RegimeSnapshot;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/** 只按结算视图对比两组楼层；写报告与测试共用。 */
export function compareFloors(
	independent: readonly SettlementFloorView[],
	merged: readonly SettlementFloorView[],
): CompareAgreement {
	if (independent.length !== merged.length) {
		throw new Error("两组楼层的数量不一致，无法对齐");
	}
	let bothSettled = 0;
	let pathIntersection = 0;
	let factIntersection = 0;
	let floorsIdentical = 0;
	let floorsOneSideEmpty = 0;
	for (const [index, left] of independent.entries()) {
		const right = merged[index];
		if (right === undefined) throw new Error("合并调用缺少对应的楼层");
		if (!left.settled || !right.settled) continue;
		bothSettled += 1;
		const leftPaths = new Set(left.paths);
		const rightPaths = new Set(right.paths);
		const leftFacts = new Set(left.facts);
		const rightFacts = new Set(right.facts);
		for (const key of leftPaths) {
			if (rightPaths.has(key)) pathIntersection += 1;
		}
		for (const key of leftFacts) {
			if (rightFacts.has(key)) factIntersection += 1;
		}
		if (sameSet(leftPaths, rightPaths)) floorsIdentical += 1;
		if ((leftPaths.size === 0) !== (rightPaths.size === 0)) {
			floorsOneSideEmpty += 1;
		}
	}
	const pathUnion = unionWithinFloors(independent, merged, "paths");
	const factUnion = unionWithinFloors(independent, merged, "facts");
	return {
		floors: independent.length,
		floorsBothSettled: bothSettled,
		pathIntersection,
		pathUnion,
		pathAgreement: pathUnion === 0 ? null : pathIntersection / pathUnion,
		factIntersection,
		factUnion,
		factAgreement: factUnion === 0 ? null : factIntersection / factUnion,
		floorsIdentical,
		floorsOneSideEmpty,
	};
}

/**
 * 逐楼层求并集后累加；同一路径在不同楼层各记一次，反映的是楼层之间的差异，
 * 不会被跨楼层的重复路径摊薄。
 */
function unionWithinFloors(
	independent: readonly SettlementFloorView[],
	merged: readonly SettlementFloorView[],
	field: "paths" | "facts",
): number {
	let union = 0;
	for (const [index, left] of independent.entries()) {
		const right = merged[index];
		if (right === undefined) continue;
		if (!left.settled || !right.settled) continue;
		union += new Set([...left[field], ...right[field]]).size;
	}
	return union;
}

export function formatCompareReport(report: GapPassCompareReport): string {
	const lines: string[] = [];
	lines.push(`故事 ${report.story}，样本 ${report.floors} 个助手楼层`);
	for (const regime of [report.independent, report.merged]) {
		lines.push(
			`${regime.label}：已结算 ${regime.settledFloors} 楼，diff ${regime.diffs}，修复 ${regime.repairCount}（其中非法与状态改写 ${regime.invalidEntries}，冲突 ${regime.conflictRepairs}），结算段整段拒绝 ${regime.settleSegmentRejections}，结算来源变更卡 ${regime.settlerCards}，延后 ${regime.deferredJobs}，失败 ${regime.failedJobs.length}，请求 ${regime.requests}（缓存命中 ${regime.cachedRequests}）`,
		);
	}
	const agreement = report.agreement;
	const pathAgreement =
		agreement.pathAgreement === null
			? "无路径可比"
			: `${(agreement.pathAgreement * 100).toFixed(1)}%`;
	const factAgreement =
		agreement.factAgreement === null
			? "无事实可比"
			: `${(agreement.factAgreement * 100).toFixed(1)}%`;
	lines.push(
		`两边都结算 ${agreement.floorsBothSettled} 楼；路径一致率 ${pathAgreement}（交集 ${agreement.pathIntersection} / 并集 ${agreement.pathUnion}）；事实一致率 ${factAgreement}（交集 ${agreement.factIntersection} / 并集 ${agreement.factUnion}）；路径集合相同 ${agreement.floorsIdentical} 楼；只有一边有路径 ${agreement.floorsOneSideEmpty} 楼`,
	);
	return lines.join("\n");
}

interface AttemptOutcome {
	readonly ok: boolean;
	readonly deferred: boolean;
	readonly error: string | null;
}

interface RegimeRunOutcome {
	readonly deferred: number;
	readonly failed: readonly {
		readonly nodeId: string;
		readonly kind: string;
		readonly error: string;
	}[];
}

async function attemptJob(
	handler: BackgroundJobHandler,
	store: StoryStore,
	client: LlmStreamingClient,
	storyId: string,
	nodeId: string,
	kind: string,
): Promise<AttemptOutcome> {
	let lastError: string | null = null;
	for (let attempt = 1; attempt <= JOB_ATTEMPTS; attempt += 1) {
		try {
			await handler({
				store,
				client,
				job: jobOf(storyId, nodeId, kind, attempt),
			});
			return { ok: true, deferred: false, error: null };
		} catch (error) {
			if (error instanceof BackgroundJobDeferredError) {
				return { ok: false, deferred: true, error: null };
			}
			lastError = error instanceof Error ? error.message : String(error);
		}
	}
	return { ok: false, deferred: false, error: lastError };
}

function jobOf(
	storyId: string,
	nodeId: string,
	kind: string,
	attempts: number,
): BackgroundJob {
	return {
		id: 0,
		storyId,
		nodeId,
		kind,
		status: "running",
		attempts,
		lastError: null,
		createdAt: new Date().toISOString(),
		startedAt: null,
		finishedAt: null,
	};
}

interface RegimeOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly nodeIds: readonly string[];
	readonly client: LlmStreamingClient;
	readonly log: (message: string) => void;
	readonly windowSize: number;
}

async function runIndependentRegime(
	options: RegimeOptions,
): Promise<RegimeRunOutcome> {
	const settle = createSettleHandler({ windowSize: options.windowSize });
	const scene = createSceneHandler();
	const userWill = createUserWillHandler();
	const revision = createMemoryRevisionHandler();
	const tally = newOutcomeTally();
	for (;;) {
		const pending = options.nodeIds.find(
			(nodeId) => options.store.getLedgerSettlement(nodeId) === null,
		);
		if (pending === undefined) break;
		const outcome = await attemptJob(
			settle,
			options.store,
			options.client,
			options.storyId,
			pending,
			"settle",
		);
		recordOutcome(tally, outcome, pending, "settle");
		if (!outcome.ok) {
			options.log(
				`独立任务的结算在楼层 ${pending} 停下：${outcome.deferred ? "被延后" : outcome.error}`,
			);
			break;
		}
	}
	let done = 0;
	for (const nodeId of options.nodeIds) {
		for (const [kind, handler] of [
			["scene", scene],
			["user_will", userWill],
			["memory_revision", revision],
		] as const) {
			const outcome = await attemptJob(
				handler,
				options.store,
				options.client,
				options.storyId,
				nodeId,
				kind,
			);
			recordOutcome(tally, outcome, nodeId, kind);
		}
		done += 1;
		if (done % 5 === 0) options.log(`独立任务已处理 ${done} 个楼层`);
	}
	return finishOutcomeTally(tally);
}

async function runMergedRegime(
	options: RegimeOptions,
): Promise<RegimeRunOutcome> {
	const gapPass = createGapPassHandler({ windowSize: options.windowSize });
	const tally = newOutcomeTally();
	let done = 0;
	for (const nodeId of options.nodeIds) {
		const outcome = await attemptJob(
			gapPass,
			options.store,
			options.client,
			options.storyId,
			nodeId,
			"gap_pass",
		);
		recordOutcome(tally, outcome, nodeId, "gap_pass");
		done += 1;
		if (done % 5 === 0) options.log(`合并调用已处理 ${done} 个楼层`);
	}
	return finishOutcomeTally(tally);
}

interface OutcomeTally {
	deferred: number;
	readonly failed: { nodeId: string; kind: string; error: string }[];
}

function newOutcomeTally(): OutcomeTally {
	return { deferred: 0, failed: [] };
}

function recordOutcome(
	tally: OutcomeTally,
	outcome: AttemptOutcome,
	nodeId: string,
	kind: string,
): void {
	if (outcome.deferred) {
		tally.deferred += 1;
		return;
	}
	if (!outcome.ok) {
		tally.failed.push({ nodeId, kind, error: outcome.error ?? "未知错误" });
	}
}

function finishOutcomeTally(tally: OutcomeTally): RegimeRunOutcome {
	return { deferred: tally.deferred, failed: tally.failed };
}

function measureFloors(
	store: StoryStore,
	storyId: string,
	nodeIds: readonly string[],
): SettlementFloorView[] {
	return nodeIds.map((nodeId) => {
		const settlement = store.getLedgerSettlement(nodeId);
		if (settlement === null) {
			return { nodeId, settled: false, paths: [], facts: [], repairs: [] };
		}
		const diffs = store
			.getStateDiffs(nodeId)
			.filter((diff) => diff.source === "settler" && diff.confidence !== null);
		return {
			nodeId,
			settled: true,
			paths: diffs.map((diff) => JSON.stringify(diff.path)),
			facts: diffs.map(
				(diff) =>
					`${diff.op}\u0000${JSON.stringify(diff.path)}\u0000${JSON.stringify(diff.value)}`,
			),
			repairs: settlement.repairs.map((repair) => repair.action),
		};
	});
}

function summarizeRegime(
	label: string,
	store: StoryStore,
	storyId: string,
	floors: readonly SettlementFloorView[],
	stats: RequestStats,
	run: RegimeRunOutcome,
): CompareRegimeStats {
	let diffs = 0;
	let repairCount = 0;
	let invalidEntries = 0;
	let conflictRepairs = 0;
	let settleSegmentRejections = 0;
	for (const floor of floors) {
		diffs += floor.paths.length;
		repairCount += floor.repairs.length;
		for (const action of floor.repairs) {
			if (action === "delete" || action === "rewrite_status") {
				invalidEntries += 1;
			}
			if (action === "conflict") {
				conflictRepairs += 1;
			}
		}
		const gapRun = store.getGapPassRun(floor.nodeId);
		if (gapRun !== null) {
			settleSegmentRejections += gapRun.rejectedSegments.filter(
				(rejection) => rejection.segment === "settlement",
			).length;
		}
	}
	return {
		label,
		settledFloors: floors.filter((floor) => floor.settled).length,
		diffs,
		repairCount,
		invalidEntries,
		conflictRepairs,
		settleSegmentRejections,
		settlerCards: store
			.listLedgerChangeCards(storyId)
			.filter((card) => card.source === "settler").length,
		deferredJobs: run.deferred,
		failedJobs: run.failed,
		requests: stats.requests,
		cachedRequests: stats.cachedRequests,
	};
}

async function readSampleEntries(
	rawRoot: string,
	story: string,
	floors: number,
): Promise<StChatEntry[]> {
	const snapshot = await openSnapshot(rawRoot);
	const [target] = selectTargets(snapshot, story);
	if (target === undefined) throw new Error(`manifest 里没有故事 ${story}`);
	const entries: StChatEntry[] = [];
	let assistants = 0;
	for await (const entry of parseChatJsonlFile(
		await snapshot.resolveFile(target.file),
	)) {
		entries.push(entry);
		if (entry.kind !== "message") continue;
		const message = entry.message;
		if (message.isUser || message.isSystem) continue;
		assistants += 1;
		if (assistants >= floors) break;
	}
	if (assistants < floors) {
		throw new Error(
			`对话 ${story} 只有 ${assistants} 个助手楼层，不足 ${floors}`,
		);
	}
	return entries;
}

async function importSample(
	entries: readonly StChatEntry[],
	story: string,
	dbPath: string,
	prepareStore?: (store: StoryStore, storyId: string) => Promise<void>,
): Promise<StoryStore> {
	await mkdir(path.dirname(dbPath), { recursive: true });
	await rm(dbPath, { force: true });
	await rm(`${dbPath}-wal`, { force: true });
	await rm(`${dbPath}-shm`, { force: true });
	const store = StoryStoreClass.open(dbPath);
	await importChatToStore(store, entries, { storyId: story });
	if (prepareStore !== undefined) await prepareStore(store, story);
	return store;
}

function assistantNodeIds(store: StoryStore, story: string): string[] {
	return store
		.getPathToHead(story)
		.filter((node) => node.role === "assistant")
		.map((node) => node.id);
}

function sameSet(
	left: ReadonlySet<string>,
	right: ReadonlySet<string>,
): boolean {
	if (left.size !== right.size) return false;
	for (const key of left) {
		if (!right.has(key)) return false;
	}
	return true;
}

function countClient(inner: LlmStreamingClient): CountedClient {
	const stats: RequestStats = { requests: 0, cachedRequests: 0 };
	const client: LlmStreamingClient = {
		async complete(
			request: LlmRequest,
			options?: LlmCallOptions,
		): Promise<LlmResult> {
			const result = await inner.complete(request, options);
			if (result.cached) stats.cachedRequests += 1;
			else stats.requests += 1;
			return result;
		},
		stream(request: LlmRequest, options?: LlmCallOptions): LlmStream {
			return inner.stream(request, options);
		},
	};
	return { client, stats };
}
