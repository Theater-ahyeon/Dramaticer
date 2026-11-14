import {
	type BackgroundJobRegistry,
	type ChatProfile,
	type ChatTurnResult,
	type ContextSlotProviders,
	type ContextTemplate,
	type EmbeddingClient,
	type GapWorkBacklog,
	type LlmClient,
	type LlmMessage,
	type LlmReasoningLevel,
	type LlmStreamingClient,
	type LlmToolTransport,
	type LlmUsage,
	NO_CONTINUATION,
	type StoryStore,
	type StructuredOutputMode,
	type TurnTrace,
	assertChatProfile,
	drainBackgroundJobs,
	generateAssistantTurn,
	readGapWorkBacklog,
	regenerateAssistantTurn,
	resolveStoryBackgroundKinds,
	runChatTurn,
} from "@dramaticer/core";
import {
	DEFAULT_PROBE_MAX_TOKENS,
	DEFAULT_PROBE_MIN_AGE_FLOORS,
	DEFAULT_PROBE_TEMPERATURE,
	type PlaytestProbeOptions,
	type PlaytestProbeRecord,
	runPlaytestProbe,
} from "./probe.js";
import { type TurnJudgeRecord, judgePlaytestTurn } from "./turn-judge.js";

export const DEFAULT_PLAYTEST_ROUNDS = 20;
export const DEFAULT_PLAYTEST_MODEL = "rp";
export const DEFAULT_PLAYTEST_USER_MODEL = "background";
/** 模拟用户连续输出非法 JSON 的次数上限；达到后试玩终止。 */
export const MAX_PLAYTEST_USER_OUTPUT_ATTEMPTS = 3;
export const DEFAULT_PLAYTEST_USER_CONTEXT_FLOORS = 12;

/** 按轮次配置的 swipe、编辑与分支切换；轮次从 1 开始。 */
export interface PlaytestOperationSchedule {
	readonly swipeAt?: readonly number[];
	readonly editAt?: readonly number[];
	readonly branchAt?: readonly number[];
}

export interface PlaytestOperationRecord {
	readonly kind: "swipe" | "edit" | "branch";
	readonly round: number;
	readonly fromNodeId: string;
	readonly toNodeId: string;
}

export interface PlaytestDirectorRecord {
	readonly directive: string | null;
	readonly mechanisms: readonly {
		readonly name: string;
		readonly triggered: boolean;
		readonly reason: string;
	}[];
	readonly signals: Readonly<Record<string, unknown>>;
}

export interface PlaytestTraceSummary {
	readonly templateId: string;
	readonly turnMode: string;
	readonly profile: ChatProfile;
	readonly budgetTokens: number;
	readonly totalTokens: number;
	readonly segments: readonly {
		readonly segmentId: string;
		readonly kind: string;
		readonly slot: string | null;
		readonly source: string;
		readonly priority: number;
		readonly tokens: number;
		readonly status: string;
	}[];
	readonly model: string;
	readonly channel: string | null;
	readonly stopReason: string;
	readonly finishReason: string | null;
	readonly truncations: readonly string[];
	readonly usage: LlmUsage;
	readonly attempts: number;
	readonly rounds: number;
	readonly cached: boolean;
	readonly tools: {
		readonly transport: LlmToolTransport;
		readonly rounds: number;
		readonly maxRounds: number;
		readonly capped: boolean;
		readonly calls: readonly {
			readonly name: string;
			readonly ok: boolean;
			readonly error: string | null;
		}[];
		readonly rejected: readonly {
			readonly name: string;
			readonly reason: string;
		}[];
	};
	readonly structured: {
		readonly mode: StructuredOutputMode;
		readonly acceptedStateUpdates: number;
		readonly acceptedNotes: number;
		readonly issues: readonly {
			readonly payload: string;
			readonly reason: string;
		}[];
	};
	readonly timing: {
		readonly firstTokenMs: number | null;
		readonly durationMs: number;
	};
}

export interface PlaytestGapRecord {
	readonly pending: number;
	readonly running: number;
	readonly done: number;
	readonly failed: number;
	readonly discarded: number;
	readonly unfinishedRatio: number;
}

export interface PlaytestDrainRecord {
	readonly enqueued: number;
	readonly discarded: number;
	readonly done: number;
	readonly retrying: number;
	readonly failed: number;
}

interface PlaytestRecordBase {
	/** 轮次；从 1 开始。 */
	readonly round: number;
	/** 记录所属故事；报告按它分组。 */
	readonly storyId: string;
	readonly profile: ChatProfile;
	readonly seed: number;
	readonly startedAt: string;
	/** 本轮开始时（上一轮结束后的间隙）关键间隙工作的完成情况。 */
	readonly gapWork: PlaytestGapRecord;
	readonly operations: readonly PlaytestOperationRecord[];
	/** 本轮之后的一致性探针结果；不到探针轮次或失败轮次为 null。 */
	readonly probe: PlaytestProbeRecord | null;
	/** 本轮回复的玩家侧评价；未开启裁判或失败轮次为 null。 */
	readonly verdict: TurnJudgeRecord | null;
}

export interface PlaytestRoundRecord extends PlaytestRecordBase {
	readonly status: "done";
	readonly userNodeId: string;
	readonly nodeId: string;
	/** Trace 所在的楼层；编辑或分支操作产生的楼层没有 Trace。 */
	readonly traceNodeId: string;
	readonly user: string;
	readonly assistant: string;
	readonly userHint: string;
	readonly firstTokenMs: number | null;
	readonly durationMs: number;
	readonly usage: LlmUsage;
	/** 本轮结束时该助手楼层上的全部台账事实条数（含间隙结算）。 */
	readonly ledgerDiffCount: number;
	readonly newClues: number;
	readonly fulfilledClues: number;
	readonly director: PlaytestDirectorRecord | null;
	readonly trace: PlaytestTraceSummary;
	readonly truncated: boolean;
	readonly drain: PlaytestDrainRecord | null;
}

export interface PlaytestFailureRecord extends PlaytestRecordBase {
	readonly status: "failed";
	readonly user: string;
	readonly userHint: string;
	readonly error: string;
	readonly drain: PlaytestDrainRecord | null;
}

export type PlaytestRecord = PlaytestRoundRecord | PlaytestFailureRecord;

/** 一轮生成需要的模板、槽位与采样参数。 */
export interface PlaytestTurnConfig {
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

export interface PlaytestBackgroundOptions {
	readonly client: LlmClient;
	readonly registry: BackgroundJobRegistry;
}

export interface PlaytestOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly rounds: number;
	/** 从第几轮开始；`--resume` 用上一份记录的最后轮次加一。 */
	readonly startRound?: number;
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
	readonly turn: PlaytestTurnConfig;
	/** 不提供时既不补建也不执行后台任务，间隙记录全为零。 */
	readonly background?: PlaytestBackgroundOptions | null;
	/** 一致性探针；不提供或每轮数为 0 时不插探针。 */
	readonly probes?: PlaytestProbeOptions | null;
	/** 玩家侧裁判：每轮判断是否重 roll 与是否遵循指令；不提供时不调用。 */
	readonly turnJudge?: {
		readonly client: LlmClient;
		readonly model: string;
		readonly maxTokens?: number;
	} | null;
	readonly operations?: PlaytestOperationSchedule;
	/** 每完成一轮调用一次；失败轮次也写。 */
	readonly onRecord: (record: PlaytestRecord) => void | Promise<void>;
	readonly log?: (message: string) => void;
	readonly now?: () => number;
}

export interface PlaytestRunResult {
	readonly records: readonly PlaytestRecord[];
	readonly failures: number;
	readonly lastRound: number;
}

/** 模拟用户没有在允许次数内输出合法 JSON；试玩终止。 */
export class PlaytestUserOutputError extends Error {
	constructor(attempts: number) {
		super(`模拟用户连续 ${attempts} 次没有输出合法的 {message}，试玩终止`);
		this.name = "PlaytestUserOutputError";
	}
}

/** 模拟用户的写作提示；深回合评测复用同一组。 */
export const PLAYTEST_USER_HINTS = [
	"推进当前场景，让事情往前走一步。",
	"对在场的角色提出一个具体的问题。",
	"表达怀疑或不安，试探对方的反应。",
	"做一个明确的选择，并说明理由。",
	"回忆之前发生过的一件事，用上当时的细节。",
] as const;

const USER_SYSTEM_PROMPT = `你在模拟一位玩文字角色扮演游戏的玩家。根据最近的对话，写出玩家下一句发言：可以是行动、对白或一个问题，长度一到三句。不要替角色写正文，不要解释，不要重复角色已经说过的话。
只输出一个 JSON 对象，键为 message，值为玩家发言字符串，例如 {"message":"我推开门，问他是谁。"}。不要输出代码块。`;

/** 执行连续试玩；每轮生成一条记录交给调用方。 */
export async function runPlaytest(
	options: PlaytestOptions,
): Promise<PlaytestRunResult> {
	if (!Number.isInteger(options.rounds) || options.rounds < 1) {
		throw new Error("试玩轮数必须是正整数");
	}
	const startRound = options.startRound ?? 1;
	if (!Number.isInteger(startRound) || startRound < 1) {
		throw new Error("试玩起始轮次必须是正整数");
	}
	assertChatProfile(options.profile);
	if (!Number.isInteger(options.seed) || options.seed < 0) {
		throw new Error("随机种子必须是非负整数");
	}
	validateSchedule(options.operations);
	const probes = options.probes ?? null;
	if (probes !== null) {
		if (!Number.isInteger(probes.every) || probes.every < 1) {
			throw new Error(`探针间隔必须是正整数，收到 ${probes.every}`);
		}
		const minAgeFloors = probes.minAgeFloors ?? DEFAULT_PROBE_MIN_AGE_FLOORS;
		if (!Number.isInteger(minAgeFloors) || minAgeFloors < 1) {
			throw new Error(
				`探针事实的最小楼层年龄必须是正整数，收到 ${minAgeFloors}`,
			);
		}
	}
	if (!options.store.getStory(options.storyId)) {
		throw new Error(`故事不存在：${options.storyId}`);
	}
	const now = options.now ?? Date.now;
	const log = options.log ?? (() => undefined);
	const schedule = normalizeSchedule(options.operations);
	const random = createSeededRandom(options.seed);
	const records: PlaytestRecord[] = [];
	let failures = 0;

	for (let round = startRound; round <= options.rounds; round += 1) {
		const startedAt = new Date(now()).toISOString();
		const gapWork = readGapWork(options);
		const userHint =
			PLAYTEST_USER_HINTS[Math.floor(random() * PLAYTEST_USER_HINTS.length)] ??
			PLAYTEST_USER_HINTS[0];
		const userMessage = await generateUserMessage({
			store: options.store,
			storyId: options.storyId,
			client: options.user.client,
			model: options.user.model,
			hint: userHint,
			now,
		});
		const headBefore = options.store.getHead(options.storyId);
		let result: ChatTurnResult;
		try {
			result = await runChatTurn({
				...turnOptions(options),
				userText: userMessage,
			});
		} catch (error) {
			if (headBefore !== null) {
				const current = options.store.getHead(options.storyId);
				if (current !== null && current.id !== headBefore.id) {
					options.store.setHead(options.storyId, headBefore.id);
				}
			}
			const drained = await runGapDrain(options, now);
			const record: PlaytestFailureRecord = {
				status: "failed",
				round,
				storyId: options.storyId,
				profile: options.profile,
				seed: options.seed,
				startedAt,
				gapWork,
				operations: [],
				probe: null,
				verdict: null,
				user: userMessage,
				userHint,
				error: error instanceof Error ? error.message : String(error),
				drain: drained,
			};
			records.push(record);
			failures += 1;
			await options.onRecord(record);
			log(`第 ${round} 轮失败：${record.error}`);
			continue;
		}

		const operations: PlaytestOperationRecord[] = [];
		if (schedule.swipe.has(round)) {
			const regenerated = await regenerateAssistantTurn({
				...turnOptions(options),
				assistantNodeId: result.node.id,
			});
			operations.push({
				kind: "swipe",
				round,
				fromNodeId: result.node.id,
				toNodeId: regenerated.node.id,
			});
			result = regenerated;
		}
		if (schedule.edit.has(round)) {
			const editedUser = options.store.editNode(
				result.userNode.id,
				`${result.userNode.raw}（我想补充一句。）`,
			);
			const regenerated = await generateAssistantTurn({
				...turnOptions(options),
				userNodeId: editedUser.id,
			});
			operations.push({
				kind: "edit",
				round,
				fromNodeId: result.userNode.id,
				toNodeId: editedUser.id,
			});
			result = regenerated;
		}
		if (schedule.branch.has(round)) {
			const current = options.store.getNode(result.node.id);
			if (current !== null && current.raw.length > 0) {
				const sibling = options.store.swipeNode(current.id, current.raw);
				operations.push({
					kind: "branch",
					round,
					fromNodeId: current.id,
					toNodeId: sibling.id,
				});
			}
		}
		const drained = await runGapDrain(options, now);
		const finalNode = options.store.getHead(options.storyId);
		const probe =
			probes !== null && round % probes.every === 0 && finalNode !== null
				? await runPlaytestProbe({
						store: options.store,
						storyId: options.storyId,
						round,
						headNodeId: finalNode.id,
						minAgeFloors: probes.minAgeFloors ?? DEFAULT_PROBE_MIN_AGE_FLOORS,
						random,
						template: options.turn.template,
						providers: options.turn.providers,
						budgetTokens: options.turn.budgetTokens,
						assistant: options.assistant,
						judge: probes.judge,
						maxTokens: probes.maxTokens ?? DEFAULT_PROBE_MAX_TOKENS,
						temperature: probes.temperature ?? DEFAULT_PROBE_TEMPERATURE,
					})
				: null;
		if (probe !== null) {
			log(
				`第 ${round} 轮探针：${probe.status === "done" ? (probe.verdict ?? "未知") : probe.status}`,
			);
		}
		const assistantNode =
			finalNode !== null && finalNode.role === "assistant"
				? finalNode
				: result.node;
		const verdict =
			options.turnJudge === null || options.turnJudge === undefined
				? null
				: await judgePlaytestTurn({
						store: options.store,
						storyId: options.storyId,
						round,
						userText: result.userNode.raw,
						assistantText: assistantNode.raw,
						assistantNodeId: assistantNode.id,
						judge: options.turnJudge,
					});
		if (verdict !== null) {
			log(
				`第 ${round} 轮裁判：${verdict.status === "done" ? (verdict.reroll ? "会重 roll" : "不重 roll") : "失败"}`,
			);
		}
		const diffs = options.store.getStateDiffs(assistantNode.id);
		const trace = options.store.getTurnTrace(result.node.id);
		if (trace === null) {
			throw new Error(`楼层 ${result.node.id} 没有 Trace，无法记录本轮`);
		}
		const decision = options.store.getDirectorDecision(result.userNode.id);
		const record: PlaytestRoundRecord = {
			status: "done",
			round,
			storyId: options.storyId,
			profile: options.profile,
			seed: options.seed,
			startedAt,
			gapWork,
			operations,
			probe,
			verdict,
			userNodeId: result.userNode.id,
			nodeId: assistantNode.id,
			traceNodeId: result.node.id,
			user: result.userNode.raw,
			assistant: assistantNode.raw,
			userHint,
			firstTokenMs: trace.timing.firstTokenMs,
			durationMs: trace.timing.durationMs,
			usage: trace.llm.usage,
			ledgerDiffCount: diffs.length,
			newClues: diffs.filter(
				(diff) =>
					diff.path[0] === "clue" &&
					diff.path[2] === "text" &&
					diff.op === "set",
			).length,
			fulfilledClues: diffs.filter(
				(diff) =>
					diff.path[0] === "clue" &&
					diff.path[2] === "status" &&
					diff.op === "set" &&
					diff.value === "fulfilled",
			).length,
			director:
				decision === null
					? null
					: {
							directive: decision.directive,
							mechanisms: decision.mechanisms.map((mechanism) => ({
								name: mechanism.name,
								triggered: mechanism.triggered,
								reason: mechanism.reason,
							})),
							signals: decision.signals,
						},
			trace: summarizeTrace(trace),
			truncated: trace.llm.truncations.length > 0,
			drain: drained,
		};
		records.push(record);
		await options.onRecord(record);
		log(
			`第 ${round} 轮：楼层 ${record.nodeId}，首字 ${record.firstTokenMs === null ? "—" : `${record.firstTokenMs} 毫秒`}，台账 ${record.ledgerDiffCount} 条，截断 ${record.truncated ? "是" : "否"}`,
		);
	}

	return {
		records,
		failures,
		lastRound: records.at(-1)?.round ?? startRound - 1,
	};
}

async function runGapDrain(
	options: PlaytestOptions,
	now: () => number,
): Promise<PlaytestDrainRecord | null> {
	const background = options.background ?? null;
	if (background === null || options.profile === "naive") return null;
	const settings = options.store.getStorySettings(options.storyId);
	const kinds = resolveStoryBackgroundKinds(background.registry, {
		gapPassEnabled: settings.gapPassEnabled,
	});
	const result = await drainBackgroundJobs({
		store: options.store,
		registry: background.registry,
		client: background.client,
		storyId: options.storyId,
		kinds,
		gapSeconds: 0,
		sessionEnded: false,
		now,
	});
	return {
		enqueued: result.enqueued,
		discarded: result.discarded,
		done: result.runs.filter((run) => run.status === "done").length,
		retrying: result.runs.filter((run) => run.status === "pending").length,
		failed: result.runs.filter((run) => run.status === "failed").length,
	};
}

function readGapWork(options: PlaytestOptions): PlaytestGapRecord {
	const background = options.background ?? null;
	if (background === null || options.profile === "naive") {
		return {
			pending: 0,
			running: 0,
			done: 0,
			failed: 0,
			discarded: 0,
			unfinishedRatio: 0,
		};
	}
	const gapKinds = [...background.registry]
		.filter(([, type]) => type.tier === "gap")
		.map(([kind]) => kind);
	const backlog: GapWorkBacklog = readGapWorkBacklog(
		options.store,
		options.storyId,
		gapKinds,
	);
	return {
		pending: backlog.counts.pending,
		running: backlog.counts.running,
		done: backlog.counts.done,
		failed: backlog.counts.failed,
		discarded: backlog.counts.discarded,
		unfinishedRatio: backlog.unfinishedRatio,
	};
}

export interface UserMessageOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly client: LlmClient;
	readonly model: string;
	readonly hint: string;
	/** 输出上限；不提供时用模型在渠道里声明的上限。 */
	readonly maxTokens?: number;
	readonly now: () => number;
}

/** 让模拟用户输出下一句玩家发言；非法输出重试三次。 */
export async function generateUserMessage(
	options: UserMessageOptions,
): Promise<string> {
	const base = buildUserSimulatorMessages(options);
	let lastProblem = "";
	let lastText = "";
	for (
		let attempt = 1;
		attempt <= MAX_PLAYTEST_USER_OUTPUT_ATTEMPTS;
		attempt += 1
	) {
		const messages: LlmMessage[] =
			attempt === 1
				? base
				: [
						...base,
						{
							role: "user",
							content: retryInstruction(attempt, lastProblem, lastText),
						},
					];
		const result = await options.client.complete(
			{
				messages,
				model: options.model,
				temperature: 0.8,
				...(options.maxTokens === undefined
					? {}
					: { maxTokens: options.maxTokens }),
			},
			NO_CONTINUATION,
		);
		const message = parseUserMessage(result.text);
		if (message !== null) return message;
		lastProblem = "缺少 message 或包含多余字段";
		lastText = result.text.trim();
	}
	throw new PlaytestUserOutputError(MAX_PLAYTEST_USER_OUTPUT_ATTEMPTS);
}

function retryInstruction(
	attempt: number,
	problem: string,
	lastText: string,
): string {
	if (lastText.length === 0) {
		return `上一次输出为空，可能把输出预算都用在了思考上。这是第 ${attempt} 次尝试，只输出 {"message":"..."}，不要代码块。`;
	}
	return [
		`上一次输出不是合法 JSON（${problem}）。这是第 ${attempt} 次尝试。`,
		"上一次的发言原文：",
		lastText,
		'把这段发言原样放进 {"message":"…"} 里，只输出 JSON，不要代码块，不要多余字段。',
	].join("\n");
}

function buildUserSimulatorMessages(options: UserMessageOptions): LlmMessage[] {
	const settings = options.store.getStorySettings(options.storyId);
	const story = options.store.getStory(options.storyId);
	const path = options.store.getPathToHead(options.storyId);
	const recent = path.slice(-DEFAULT_PLAYTEST_USER_CONTEXT_FLOORS);
	const lines = recent.map((node) => {
		const speaker = node.role === "user" ? "玩家" : "角色";
		return `${speaker}：${node.raw}`;
	});
	const characterName = settings.cardName ?? story?.title ?? "未命名故事";
	const prompt = settings.characterPrompt ?? "";
	const shortened =
		prompt.length > 1_500 ? `${prompt.slice(0, 1_500)}……` : prompt;
	const parts = [
		`故事：${characterName}`,
		`玩家人设：${settings.persona ?? "未设置"}`,
		shortened.length === 0 ? null : `角色卡：${shortened}`,
		lines.length === 0
			? "最近对话：故事刚开始。"
			: `最近对话：\n${lines.join("\n")}`,
		`本轮写作提示：${options.hint}`,
		"请给出玩家接下来的一句话，只输出 JSON。",
	].filter((part): part is string => part !== null);
	return [
		{ role: "system", content: USER_SYSTEM_PROMPT },
		{ role: "user", content: parts.join("\n\n") },
	];
}

/** 严格解析模拟用户的输出：只接受对象里唯一的非空字符串键 message。 */
export function parseUserMessage(text: string): string | null {
	let value: unknown;
	try {
		value = JSON.parse(text.trim());
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const keys = Object.keys(value);
	if (keys.length !== 1 || keys[0] !== "message") return null;
	if (!("message" in value)) return null;
	const message = value.message;
	if (typeof message !== "string" || message.trim().length === 0) return null;
	return message;
}

function turnOptions(
	options: PlaytestOptions,
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
		now: options.now,
	};
}

function summarizeTrace(trace: TurnTrace): PlaytestTraceSummary {
	return {
		templateId: trace.templateId,
		turnMode: trace.turnMode,
		profile: trace.profile,
		budgetTokens: trace.context.budgetTokens,
		totalTokens: trace.context.totalTokens,
		segments: trace.context.entries.map((entry) => ({
			segmentId: entry.segmentId,
			kind: entry.kind,
			slot: entry.slot,
			source: entry.source,
			priority: entry.priority,
			tokens: entry.tokens,
			status: entry.status,
		})),
		model: trace.llm.model,
		channel: trace.llm.channel,
		stopReason: trace.llm.stopReason,
		finishReason: trace.llm.finishReason,
		truncations: trace.llm.truncations,
		usage: trace.llm.usage,
		attempts: trace.llm.attempts,
		rounds: trace.llm.rounds,
		cached: trace.llm.cached,
		tools: {
			transport: trace.tools.transport,
			rounds: trace.tools.rounds,
			maxRounds: trace.tools.maxRounds,
			capped: trace.tools.capped,
			calls: trace.tools.calls.map((call) => ({
				name: call.name,
				ok: call.ok,
				error: call.error,
			})),
			rejected: trace.tools.rejected.map((rejection) => ({
				name: rejection.name,
				reason: rejection.reason,
			})),
		},
		structured: {
			mode: trace.structured.mode,
			acceptedStateUpdates: trace.structured.acceptedStateUpdates,
			acceptedNotes: trace.structured.acceptedNotes,
			issues: trace.structured.issues.map((issue) => ({
				payload: issue.payload,
				reason: issue.reason,
			})),
		},
		timing: {
			firstTokenMs: trace.timing.firstTokenMs,
			durationMs: trace.timing.durationMs,
		},
	};
}

interface NormalizedSchedule {
	readonly swipe: ReadonlySet<number>;
	readonly edit: ReadonlySet<number>;
	readonly branch: ReadonlySet<number>;
}

function validateSchedule(
	schedule: PlaytestOperationSchedule | undefined,
): void {
	if (schedule === undefined) return;
	for (const [name, rounds] of [
		["swipeAt", schedule.swipeAt],
		["editAt", schedule.editAt],
		["branchAt", schedule.branchAt],
	] as const) {
		if (rounds === undefined) continue;
		for (const round of rounds) {
			if (!Number.isInteger(round) || round < 1) {
				throw new Error(`${name} 里的轮次必须是正整数，收到 ${round}`);
			}
		}
	}
}

function normalizeSchedule(
	schedule: PlaytestOperationSchedule | undefined,
): NormalizedSchedule {
	return {
		swipe: new Set(schedule?.swipeAt ?? []),
		edit: new Set(schedule?.editAt ?? []),
		branch: new Set(schedule?.branchAt ?? []),
	};
}

function createSeededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

/** 把一份试玩记录写成一行 JSONL。 */
export function serializePlaytestRecord(record: PlaytestRecord): string {
	return `${JSON.stringify(record)}\n`;
}

/** 严格解析试玩 JSONL；空行忽略，坏行直接失败。 */
export function parsePlaytestJsonl(text: string): PlaytestRecord[] {
	const records: PlaytestRecord[] = [];
	const lines = text.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line === undefined || line.trim().length === 0) continue;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			throw new Error(`第 ${index + 1} 行不是合法 JSON`);
		}
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			throw new Error(`第 ${index + 1} 行不是对象`);
		}
		if (!("round" in value)) {
			throw new Error(`第 ${index + 1} 行缺少 round`);
		}
		const round = value.round;
		if (typeof round !== "number" || !Number.isInteger(round) || round < 1) {
			throw new Error(`第 ${index + 1} 行的 round 必须是正整数`);
		}
		if (!("status" in value)) {
			throw new Error(`第 ${index + 1} 行缺少 status`);
		}
		const status = value.status;
		if (status !== "done" && status !== "failed") {
			throw new Error(`第 ${index + 1} 行的 status 必须是 done 或 failed`);
		}
		// 这份 JSONL 只由本模块写出；round 与 status 已校验，其余字段按写入方保证。
		const record: PlaytestRecord = value as PlaytestRecord;
		records.push(record);
	}
	return records;
}
