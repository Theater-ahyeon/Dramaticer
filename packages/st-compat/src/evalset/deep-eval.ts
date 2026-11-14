import {
	type ChatProfile,
	type ChatTurnResult,
	type ContextSlotProviders,
	type ContextTemplate,
	type EmbeddingClient,
	type LlmClient,
	type LlmReasoningLevel,
	type LlmStreamingClient,
	type LlmToolTransport,
	type LlmUsage,
	NO_CONTINUATION,
	type StoryStore,
	type StructuredOutputMode,
	type TurnTrace,
	type TurnTraceDeep,
	generateAssistantTurn,
	runChatTurn,
} from "@dramaticer/core";
import { formatPairwiseContext, judgePairwise } from "./pairwise.js";
import { PLAYTEST_USER_HINTS, generateUserMessage } from "./playtest.js";

export const DEFAULT_DEEP_EVAL_TURNS = 30;
export const DEFAULT_DEEP_EVAL_BRANCHES = 10;

export interface DeepEvalTurnConfig {
	readonly template: ContextTemplate;
	readonly providers: ContextSlotProviders;
	readonly budgetTokens: number;
	readonly structuredOutput: StructuredOutputMode;
	readonly toolTransport?: LlmToolTransport | null;
	readonly embedder?: EmbeddingClient | null;
	readonly viewpoint?: string | null;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly reasoning?: LlmReasoningLevel;
}

interface DeepEvalRecordBase {
	readonly storyId: string;
	readonly model: string;
	readonly startedAt: string;
}

export interface DeepEvalTurnRecord extends DeepEvalRecordBase {
	readonly kind: "turn";
	readonly status: "done";
	readonly round: number;
	readonly userNodeId: string;
	readonly nodeId: string;
	readonly runId: string | null;
	readonly user: string;
	readonly assistantChars: number;
	readonly firstTokenMs: number | null;
	readonly durationMs: number;
	readonly usage: LlmUsage;
	readonly toolCallCount: number;
	readonly toolCalls: readonly {
		readonly name: string;
		readonly ok: boolean;
		readonly permission: string | null;
	}[];
	readonly stopReason: TurnTraceDeep["stopReason"];
	readonly commit: TurnTraceDeep["commit"];
	readonly drift: TurnTraceDeep["drift"];
	readonly runStatus: string | null;
	readonly eventCount: number | null;
	readonly truncated: boolean;
	readonly contextOmitted: TurnTraceDeep["contextOmitted"] | null;
}

export interface DeepEvalFailureRecord extends DeepEvalRecordBase {
	readonly kind: "turn";
	readonly status: "failed";
	readonly round: number;
	readonly user: string;
	readonly error: string;
}

export interface DeepEvalBranchRecord extends DeepEvalRecordBase {
	readonly kind: "branch";
	readonly sampleId: string;
	readonly round: number;
	readonly userNodeId: string;
	readonly deepNodeId: string;
	readonly fastNodeId: string;
	readonly deepChars: number;
	readonly fastChars: number;
	readonly judgeModel: string;
	readonly outcome: "deep" | "fast" | "tie" | "inconsistent";
	readonly judgements: readonly DeepEvalJudgement[];
}

export interface DeepEvalBranchFailureRecord extends DeepEvalRecordBase {
	readonly kind: "branch";
	readonly sampleId: string;
	readonly round: number;
	readonly userNodeId: string;
	readonly judgeModel: string;
	readonly status: "failed";
	readonly error: string;
}

export interface DeepEvalJudgement {
	readonly order: "deep-first" | "fast-first";
	readonly winner: "A" | "B" | "tie";
	readonly reason: string;
	readonly attempts: number;
}

export type DeepEvalRecord =
	| DeepEvalTurnRecord
	| DeepEvalFailureRecord
	| DeepEvalBranchRecord
	| DeepEvalBranchFailureRecord;

export interface DeepEvalOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly turns: number;
	readonly branches: number;
	readonly profile: ChatProfile;
	readonly seed: number;
	readonly assistant: {
		readonly client: LlmStreamingClient;
		readonly model: string;
	};
	readonly user: {
		readonly client: LlmClient;
		readonly model: string;
	};
	readonly judge: {
		readonly client: LlmClient;
		readonly model: string;
	};
	readonly turn: DeepEvalTurnConfig;
	readonly existing?: readonly DeepEvalRecord[];
	/** 连续失败达到这个数就终止该次运行；默认不终止。 */
	readonly maxConsecutiveFailures?: number;
	readonly onRecord: (record: DeepEvalRecord) => void | Promise<void>;
	readonly log?: (message: string) => void;
	readonly now?: () => number;
}

export interface DeepEvalResult {
	readonly records: readonly DeepEvalRecord[];
	readonly lastRound: number;
}

export interface DeepEvalSummary {
	readonly model: string;
	readonly storyId: string;
	readonly turns: {
		readonly completed: number;
		readonly failed: number;
		readonly failureRate: number;
		readonly firstTokenMs: PercentileSummary | null;
		readonly durationMs: PercentileSummary | null;
		readonly assistantChars: PercentileSummary | null;
		readonly toolCalls: {
			readonly total: number;
			readonly mean: number;
			readonly max: number;
			readonly distribution: Readonly<Record<string, number>>;
		};
		readonly usage: {
			readonly promptTokens: number;
			readonly completionTokens: number;
			readonly totalTokens: number;
			readonly meanTotalPerTurn: number;
		};
		readonly stopReasons: Readonly<Record<string, number>>;
		readonly commits: Readonly<Record<string, number>>;
		readonly drift: number;
		readonly runStatuses: Readonly<Record<string, number>>;
		readonly truncated: number;
		readonly contextOmitted: number;
	};
	readonly branches: {
		readonly completed: number;
		readonly failed: number;
		readonly deepWins: number;
		readonly fastWins: number;
		readonly ties: number;
		readonly inconsistent: number;
	};
}

export interface PercentileSummary {
	readonly count: number;
	readonly p50: number;
	readonly p90: number;
	readonly max: number;
}

/** 从 1 到 turns 里等距挑出指定数量的分支点轮次。 */
export function selectBranchRounds(turns: number, branches: number): number[] {
	if (branches < 1) return [];
	if (branches > turns) {
		throw new Error(`分支点数 ${branches} 不能多于轮数 ${turns}`);
	}
	if (branches === 1) return [1];
	const rounds: number[] = [];
	for (let index = 0; index < branches; index += 1) {
		const round = Math.round(1 + (index * (turns - 1)) / (branches - 1));
		rounds.push(round);
	}
	const unique = [...new Set(rounds)];
	if (unique.length !== branches) {
		throw new Error(`无法从 ${turns} 轮里挑出 ${branches} 个不同分支点`);
	}
	return unique;
}

/** 末尾连续失败的轮次；续跑时恢复“连续 3 轮失败终止”的计数。 */
export function countTrailingTurnFailures(
	records: readonly DeepEvalRecord[],
): number {
	const latest = new Map<number, DeepEvalRecord>();
	for (const record of records) {
		if (record.kind === "turn") latest.set(record.round, record);
	}
	const ordered = [...latest.entries()].sort(([left], [right]) => left - right);
	let count = 0;
	for (let index = ordered.length - 1; index >= 0; index -= 1) {
		const record = ordered[index]?.[1];
		if (record === undefined || record.kind !== "turn") break;
		if (record.status !== "failed") break;
		count += 1;
	}
	return count;
}

/** 依次跑深回合并做快/深分支点盲评；已有记录用于续跑。 */
export async function runDeepEval(
	options: DeepEvalOptions,
): Promise<DeepEvalResult> {
	if (!Number.isInteger(options.turns) || options.turns < 1) {
		throw new Error("深回合轮数必须是正整数");
	}
	if (!Number.isInteger(options.branches) || options.branches < 0) {
		throw new Error("分支点数必须是非负整数");
	}
	const maxConsecutiveFailures =
		options.maxConsecutiveFailures ?? Number.POSITIVE_INFINITY;
	if (
		maxConsecutiveFailures !== Number.POSITIVE_INFINITY &&
		(!Number.isInteger(maxConsecutiveFailures) || maxConsecutiveFailures < 1)
	) {
		throw new Error(
			`连续失败上限必须是正整数，收到 ${String(maxConsecutiveFailures)}`,
		);
	}
	if (!options.store.getStory(options.storyId)) {
		throw new Error(`故事不存在：${options.storyId}`);
	}
	const now = options.now ?? Date.now;
	const log = options.log ?? (() => undefined);
	const records = [...(options.existing ?? [])];
	const completedTurns = new Map<number, DeepEvalTurnRecord>();
	for (const record of records) {
		if (record.kind === "turn" && record.status === "done") {
			completedTurns.set(record.round, record);
		}
	}
	let lastRound = 0;
	for (const round of completedTurns.keys()) {
		lastRound = Math.max(lastRound, round);
	}
	let consecutiveFailures = countTrailingTurnFailures(records);
	let stopped = false;
	for (let round = lastRound + 1; round <= options.turns; round += 1) {
		const startedAt = new Date(now()).toISOString();
		const hint =
			PLAYTEST_USER_HINTS[(round - 1) % PLAYTEST_USER_HINTS.length] ??
			PLAYTEST_USER_HINTS[0];
		const headBefore = options.store.getHead(options.storyId);
		let userMessage: string;
		try {
			userMessage = await generateUserMessage({
				store: options.store,
				storyId: options.storyId,
				client: options.user.client,
				model: options.user.model,
				hint,
				now,
			});
		} catch (error) {
			const record: DeepEvalFailureRecord = {
				kind: "turn",
				status: "failed",
				storyId: options.storyId,
				model: options.assistant.model,
				startedAt,
				round,
				user: "",
				error: error instanceof Error ? error.message : String(error),
			};
			records.push(record);
			consecutiveFailures += 1;
			await options.onRecord(record);
			log(`第 ${round} 轮失败：${record.error}`);
			if (consecutiveFailures >= maxConsecutiveFailures) {
				stopped = true;
				log(`连续 ${consecutiveFailures} 轮失败，终止该次运行`);
				break;
			}
			continue;
		}
		let result: ChatTurnResult;
		try {
			result = await runChatTurn({
				...turnOptions(options),
				userText: userMessage,
				turnMode: "deep",
			});
		} catch (error) {
			if (
				headBefore !== null &&
				options.store.getHead(options.storyId)?.id !== headBefore.id
			) {
				options.store.setHead(options.storyId, headBefore.id);
			}
			const record: DeepEvalFailureRecord = {
				kind: "turn",
				status: "failed",
				storyId: options.storyId,
				model: options.assistant.model,
				startedAt,
				round,
				user: userMessage,
				error: error instanceof Error ? error.message : String(error),
			};
			records.push(record);
			consecutiveFailures += 1;
			await options.onRecord(record);
			log(`第 ${round} 轮失败：${record.error}`);
			if (consecutiveFailures >= maxConsecutiveFailures) {
				stopped = true;
				log(`连续 ${consecutiveFailures} 轮失败，终止该次运行`);
				break;
			}
			continue;
		}
		const deep = result.trace.deep;
		if (deep === null) {
			throw new Error(`第 ${round} 轮是深回合，但 Trace 没有 deep 段`);
		}
		const record: DeepEvalTurnRecord = {
			kind: "turn",
			status: "done",
			storyId: options.storyId,
			model: options.assistant.model,
			startedAt,
			round,
			userNodeId: result.userNode.id,
			nodeId: result.node.id,
			runId: result.trace.run?.runId ?? null,
			user: userMessage,
			assistantChars: result.node.raw.length,
			firstTokenMs: result.trace.timing.firstTokenMs,
			durationMs: result.trace.timing.durationMs,
			usage: result.trace.llm.usage,
			toolCallCount: deep.toolCallCount,
			toolCalls: result.trace.tools.calls.map((call) => ({
				name: call.name,
				ok: call.ok,
				permission: call.permission,
			})),
			stopReason: deep.stopReason,
			commit: deep.commit,
			drift: deep.drift,
			runStatus: result.trace.run?.status ?? null,
			eventCount: result.trace.run?.eventCount ?? null,
			truncated: result.trace.llm.truncations.length > 0,
			contextOmitted: deep.contextOmitted ?? null,
		};
		records.push(record);
		completedTurns.set(round, record);
		consecutiveFailures = 0;
		await options.onRecord(record);
		log(
			`第 ${round} 轮：楼层 ${record.nodeId}，首字 ${record.firstTokenMs ?? "—"} 毫秒，耗时 ${record.durationMs} 毫秒，工具 ${record.toolCallCount} 次，收束 ${record.stopReason}，漂移 ${record.drift ?? "无"}`,
		);
	}
	const completedRounds = [...completedTurns.keys()].sort(
		(left, right) => left - right,
	);
	if (stopped) {
		log("运行已终止，不生成分支点");
	} else if (
		options.branches > 0 &&
		completedRounds.length < options.branches
	) {
		throw new Error(
			`分支点数 ${options.branches} 不能多于已完成轮数 ${completedRounds.length}`,
		);
	}
	if (options.branches > 0 && !stopped) {
		const head = options.store.getHead(options.storyId);
		if (head === null) throw new Error("分支点盲评需要已有楼层");
		const finished = new Set(
			records
				.filter(
					(record): record is DeepEvalBranchRecord =>
						record.kind === "branch" && !("status" in record),
				)
				.map((record) => record.sampleId),
		);
		const sampledRounds = selectBranchRounds(
			completedRounds.length,
			options.branches,
		).map((position) => completedRounds[position - 1] as number);
		for (const round of sampledRounds) {
			const sampleId = `${options.storyId}#round-${round}`;
			if (finished.has(sampleId)) continue;
			const deepRecord = completedTurns.get(round);
			if (deepRecord === undefined) {
				log(`分支点第 ${round} 轮没有深回合记录，跳过`);
				continue;
			}
			const startedAt = new Date(now()).toISOString();
			const deepNode = options.store.getNode(deepRecord.nodeId);
			if (deepNode === null) {
				throw new Error(`深回合楼层不存在：${deepRecord.nodeId}`);
			}
			try {
				const fast = await generateAssistantTurn({
					...turnOptions(options),
					userNodeId: deepRecord.userNodeId,
					turnMode: "fast",
				});
				const branch = await judgeDeepBranch({
					options,
					startedAt,
					round,
					sampleId,
					userNodeId: deepRecord.userNodeId,
					deepNodeId: deepRecord.nodeId,
					fastNodeId: fast.node.id,
					deepText: deepNode.raw,
					fastText: fast.node.raw,
				});
				records.push(branch);
				await options.onRecord(branch);
				log(
					`分支点第 ${round} 轮：快 ${fast.node.raw.length} 字，深 ${deepNode.raw.length} 字，盲评 ${branch.outcome}`,
				);
			} catch (error) {
				const record: DeepEvalBranchFailureRecord = {
					kind: "branch",
					status: "failed",
					storyId: options.storyId,
					model: options.assistant.model,
					startedAt,
					sampleId,
					round,
					userNodeId: deepRecord.userNodeId,
					judgeModel: options.judge.model,
					error: error instanceof Error ? error.message : String(error),
				};
				records.push(record);
				await options.onRecord(record);
				log(`分支点第 ${round} 轮失败：${record.error}`);
			} finally {
				options.store.setHead(options.storyId, head.id);
			}
		}
	}
	const lastRecordedRound = records.reduce((last, record) => {
		if (record.kind !== "turn") return last;
		return Math.max(last, record.round);
	}, 0);
	return { records, lastRound: lastRecordedRound };
}

async function judgeDeepBranch(input: {
	readonly options: DeepEvalOptions;
	readonly startedAt: string;
	readonly round: number;
	readonly sampleId: string;
	readonly userNodeId: string;
	readonly deepNodeId: string;
	readonly fastNodeId: string;
	readonly deepText: string;
	readonly fastText: string;
}): Promise<DeepEvalBranchRecord> {
	const context = formatPairwiseContext(
		input.options.store.getPathToNode(input.userNodeId),
	);
	const judgements: DeepEvalJudgement[] = [];
	const deepFirst = await judgePairwise({
		task: "historical",
		context,
		first: input.deepText,
		second: input.fastText,
		judge: input.options.judge,
	});
	if (deepFirst.status !== "done") {
		throw new Error(`盲评失败：${deepFirst.error}`);
	}
	judgements.push({
		order: "deep-first",
		winner: deepFirst.winner,
		reason: deepFirst.reason,
		attempts: deepFirst.attempts,
	});
	const fastFirst = await judgePairwise({
		task: "historical",
		context,
		first: input.fastText,
		second: input.deepText,
		judge: input.options.judge,
	});
	if (fastFirst.status !== "done") {
		throw new Error(`盲评失败：${fastFirst.error}`);
	}
	judgements.push({
		order: "fast-first",
		winner: fastFirst.winner,
		reason: fastFirst.reason,
		attempts: fastFirst.attempts,
	});
	const outcomes = judgements.map((judgement) => {
		if (judgement.winner === "tie") return "tie" as const;
		const aIsDeep =
			(judgement.order === "deep-first" && judgement.winner === "A") ||
			(judgement.order === "fast-first" && judgement.winner === "B");
		return aIsDeep ? ("deep" as const) : ("fast" as const);
	});
	const unique = new Set(outcomes);
	const outcome =
		unique.size === 1
			? (outcomes[0] as "deep" | "fast" | "tie")
			: ("inconsistent" as const);
	return {
		kind: "branch",
		storyId: input.options.storyId,
		model: input.options.assistant.model,
		startedAt: input.startedAt,
		sampleId: input.sampleId,
		round: input.round,
		userNodeId: input.userNodeId,
		deepNodeId: input.deepNodeId,
		fastNodeId: input.fastNodeId,
		deepChars: input.deepText.length,
		fastChars: input.fastText.length,
		judgeModel: input.options.judge.model,
		outcome,
		judgements,
	};
}

function turnOptions(
	options: DeepEvalOptions,
): Omit<Parameters<typeof runChatTurn>[0], "userText"> {
	const turn = options.turn;
	return {
		store: options.store,
		client: options.assistant.client,
		storyId: options.storyId,
		template: turn.template,
		providers: turn.providers,
		budgetTokens: turn.budgetTokens,
		structuredOutput: turn.structuredOutput,
		toolTransport: turn.toolTransport,
		embedder: turn.embedder,
		viewpoint: turn.viewpoint,
		profile: options.profile,
		maxTokens: turn.maxTokens,
		temperature: turn.temperature,
		reasoning: turn.reasoning,
	};
}

/** 从已有记录计算验收统计；只含数字。 */
export function summarizeDeepEval(
	records: readonly DeepEvalRecord[],
): DeepEvalSummary {
	const latestTurns = new Map<
		number,
		DeepEvalTurnRecord | DeepEvalFailureRecord
	>();
	for (const record of records) {
		if (record.kind === "turn") latestTurns.set(record.round, record);
	}
	const turns = [...latestTurns.values()];
	const done = turns.filter(
		(record): record is DeepEvalTurnRecord => record.status === "done",
	);
	const failed = turns.length - done.length;
	const firstToken = done
		.map((record) => record.firstTokenMs)
		.filter((value): value is number => value !== null);
	const usage = done.reduce(
		(accumulator, record) => ({
			promptTokens: accumulator.promptTokens + (record.usage.promptTokens ?? 0),
			completionTokens:
				accumulator.completionTokens + (record.usage.completionTokens ?? 0),
			totalTokens: accumulator.totalTokens + (record.usage.totalTokens ?? 0),
		}),
		{ promptTokens: 0, completionTokens: 0, totalTokens: 0 },
	);
	const toolTotal = done.reduce(
		(accumulator, record) => accumulator + record.toolCallCount,
		0,
	);
	const distribution: Record<string, number> = {};
	for (const record of done) {
		const key =
			record.toolCallCount === 0
				? "0"
				: record.toolCallCount <= 2
					? "1-2"
					: record.toolCallCount <= 5
						? "3-5"
						: record.toolCallCount <= 10
							? "6-10"
							: "11+";
		distribution[key] = (distribution[key] ?? 0) + 1;
	}
	const latestBranches = new Map<
		string,
		DeepEvalBranchRecord | DeepEvalBranchFailureRecord
	>();
	for (const record of records) {
		if (record.kind === "branch") {
			latestBranches.set(record.sampleId, record);
		}
	}
	const branches = [...latestBranches.values()];
	const branchDone = branches.filter(
		(record): record is DeepEvalBranchRecord => !("status" in record),
	);
	const countOutcome = (outcome: DeepEvalBranchRecord["outcome"]) =>
		branchDone.filter((record) => record.outcome === outcome).length;
	return {
		model: done[0]?.model ?? turns[0]?.model ?? "unknown",
		storyId: done[0]?.storyId ?? turns[0]?.storyId ?? "unknown",
		turns: {
			completed: done.length,
			failed,
			failureRate: turns.length === 0 ? 0 : failed / turns.length,
			firstTokenMs: summarizePercentiles(firstToken),
			durationMs: summarizePercentiles(done.map((record) => record.durationMs)),
			assistantChars: summarizePercentiles(
				done.map((record) => record.assistantChars),
			),
			toolCalls: {
				total: toolTotal,
				mean: done.length === 0 ? 0 : toolTotal / done.length,
				max: done.reduce(
					(accumulator, record) => Math.max(accumulator, record.toolCallCount),
					0,
				),
				distribution,
			},
			usage: {
				...usage,
				meanTotalPerTurn:
					done.length === 0 ? 0 : usage.totalTokens / done.length,
			},
			stopReasons: countBy(done.map((record) => record.stopReason)),
			commits: countBy(done.map((record) => record.commit)),
			drift: done.filter((record) => record.drift !== null).length,
			runStatuses: countBy(done.map((record) => record.runStatus ?? "none")),
			truncated: done.filter((record) => record.truncated).length,
			contextOmitted: done.filter((record) => record.contextOmitted !== null)
				.length,
		},
		branches: {
			completed: branchDone.length,
			failed: branches.length - branchDone.length,
			deepWins: countOutcome("deep"),
			fastWins: countOutcome("fast"),
			ties: countOutcome("tie"),
			inconsistent: countOutcome("inconsistent"),
		},
	};
}

function countBy(values: readonly string[]): Readonly<Record<string, number>> {
	const counts: Record<string, number> = {};
	for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
	return counts;
}

export function summarizePercentiles(
	values: readonly number[],
): PercentileSummary | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	const at = (fraction: number) => {
		const index = Math.min(
			sorted.length - 1,
			Math.max(0, Math.ceil(fraction * sorted.length) - 1),
		);
		return sorted[index] as number;
	};
	return {
		count: sorted.length,
		p50: at(0.5),
		p90: at(0.9),
		max: sorted[sorted.length - 1] as number,
	};
}

export function serializeDeepEvalRecord(record: DeepEvalRecord): string {
	return `${JSON.stringify(record)}\n`;
}

export function parseDeepEvalJsonl(text: string): DeepEvalRecord[] {
	const records: DeepEvalRecord[] = [];
	for (const [index, line] of text.split(/\r?\n/).entries()) {
		if (line.trim().length === 0) continue;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			throw new Error(`第 ${index + 1} 行不是合法 JSON`);
		}
		if (
			typeof value !== "object" ||
			value === null ||
			Array.isArray(value) ||
			!("kind" in value)
		) {
			throw new Error(`第 ${index + 1} 行不是深回合评测记录`);
		}
		const kind = "kind" in value ? value.kind : undefined;
		if (kind !== "turn" && kind !== "branch") {
			throw new Error(`第 ${index + 1} 行的 kind 不是 turn 或 branch`);
		}
		records.push(value as DeepEvalRecord);
	}
	return records;
}
