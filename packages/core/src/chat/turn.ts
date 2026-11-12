import { parseBlocks } from "../blocks/parser.js";
import type { ParsedContent } from "../blocks/types.js";
import {
	type AssembledContext,
	type ContextSlotProviders,
	assembleContext,
} from "../context/assembler.js";
import { contextPackFingerprint } from "../context/pack-format.js";
import { loadReusableContextPack, saveContextPack } from "../context/pack.js";
import type { ContextTemplate } from "../context/template.js";
import {
	type DirectorIntensity,
	resolveDirectorIntensity,
} from "../director/intensity.js";
import {
	ILLUSTRATE_TOOL,
	type IllustrateTurnOptions,
	applyIllustrateCalls,
	resolveIllustrateTool,
} from "../images/tool.js";
import { type LlmToolTransport, assertToolTransport } from "../llm/channels.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import type { RerankClient } from "../llm/rerank.js";
import {
	DEFAULT_TRUNCATION_TERMINATORS,
	detectTruncations,
} from "../llm/truncation.js";
import type {
	LlmReasoningLevel,
	LlmStreamingClient,
	LlmUsage,
} from "../llm/types.js";
import type { PlotNote } from "../memory/plot-note.js";
import type { TurnRunEventInput, TurnRunFinalStatus } from "../run-log.js";
import type { StoryStore } from "../store/story-store.js";
import {
	collectStructuredOutputFromText,
	collectStructuredOutputFromToolCalls,
} from "../structured/collect.js";
import { STRUCTURED_OUTPUT_TOOLS } from "../structured/schema.js";
import type {
	AcceptedStateUpdate,
	StructuredOutputCollection,
	StructuredOutputMode,
} from "../structured/types.js";
import type { NewStateDiff, StateDiff, TimelineNode } from "../timeline.js";
import { DEEP_TURN_TOOLS, FAST_TURN_TOOLS } from "../tools/index.js";
import type { ToolProgressEvent } from "../tools/registry.js";
import type { TurnTrace, TurnTraceRun } from "../trace.js";
import { type DeepTurnResult, runDeepTurn } from "./deep-turn.js";
import { TurnDraftController, type TurnDraftSnapshot } from "./draft.js";
import {
	type ModelTurnResult,
	TurnAbortedError,
	runModelTurns,
} from "./executor.js";
import {
	type TurnMode,
	assertDeepContextTokenLimit,
	assertDeepMaxToolCalls,
	assertDeepRecentToolSteps,
	assertDeepTimeoutMs,
	assertMaxReadRounds,
} from "./mode.js";
import {
	type ChatProfile,
	DEFAULT_CHAT_PROFILE,
	assertChatProfile,
} from "./profile.js";
import {
	createDirectorSlotProvider,
	isDirectorSlotProvider,
} from "./providers.js";

export interface ChatTurnOptions {
	readonly store: StoryStore;
	readonly client: LlmStreamingClient;
	readonly storyId: string;
	readonly userText: string;
	readonly template: ContextTemplate;
	readonly providers?: ContextSlotProviders;
	readonly budgetTokens: number;
	readonly structuredOutput: StructuredOutputMode;
	/** 工具调用传输；不设置时走原生函数调用。 */
	readonly toolTransport?: LlmToolTransport | null;
	/** 有 embedding 客户端时 memory_search 启用向量路。 */
	readonly embedder?: EmbeddingClient | null;
	/** memory_search 的融合后重排序客户端。 */
	readonly reranker?: RerankClient | null;
	/** 知情者视角；不设置时读取工具返回全知结果。 */
	readonly viewpoint?: string | null;
	/** 单轮模式；不设置时使用故事设置里的锁定值。 */
	readonly turnMode?: TurnMode | null;
	/** 对话档位；不设置时是 native。naive 不提供读写工具，也不写台账。 */
	readonly profile?: ChatProfile;
	/** 读取工具软上限；不设置时使用故事设置。 */
	readonly maxReadRounds?: number | null;
	/** 单轮导演强度；优先于导演槽位配置里的值。 */
	readonly directorIntensity?: DirectorIntensity | null;
	/** 生图设置；工具可见性与频率检查都读这里。 */
	readonly illustrate?: IllustrateTurnOptions | null;
	readonly model?: string;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly reasoning?: LlmReasoningLevel;
	readonly signal?: AbortSignal;
	readonly onTextDelta?: (
		delta: string,
		snapshot: readonly ParsedContent[],
	) => void;
	readonly onThinkingDelta?: (delta: string) => void;
	/** 每次读取工具执行后回调，服务端用它转发 SSE 事件。 */
	readonly onToolCall?: (call: {
		readonly name: string;
		readonly ok: boolean;
	}) => void;
	/** 工具执行前的进度阶段；同一阶段连续调用只回调一次。 */
	readonly onToolProgress?: (event: ToolProgressEvent) => void;
	/** 深回合草稿整份替换后的快照；服务端用它发 SSE。 */
	readonly onDraftReplace?: (draft: TurnDraftSnapshot) => void;
	readonly now?: () => number;
}

export interface GenerateAssistantTurnOptions
	extends Omit<ChatTurnOptions, "userText"> {
	readonly userNodeId: string;
	/** 重新生成时被放弃的助手楼层；不设置时是普通生成，不写偏好记录。 */
	readonly swipeFromNodeId?: string | null;
}

export interface RegenerateAssistantTurnOptions
	extends Omit<ChatTurnOptions, "userText"> {
	readonly assistantNodeId: string;
}

export interface ChatTurnResult {
	readonly userNode: TimelineNode;
	readonly node: TimelineNode;
	readonly stateDiffs: readonly StateDiff[];
	readonly plotNotes: readonly PlotNote[];
	readonly structured: StructuredOutputCollection;
	readonly blocks: readonly ParsedContent[];
	readonly reasoning: string;
	readonly trace: TurnTrace;
}

/** 正文里需要成对闭合的写入标签；续写与截断检测共用。 */
const WRITE_BLOCK_TAGS = ["state_update", "plot_note"] as const;

/**
 * 截断检测口径：未闭合的写入标签、没有以结束字符收尾的正文都算截断；
 * 以完整标签收尾的回复不算突然中断。
 */
const TRUNCATION_OPTIONS = {
	expectedTags: WRITE_BLOCK_TAGS,
	terminators: `${DEFAULT_TRUNCATION_TERMINATORS}>`,
	detectAbruptEnd: true,
} as const;

export interface ResolvedDeepTurnSettings {
	readonly maxToolCalls: number;
	readonly maxDurationMs: number;
	readonly contextTokenLimit: number;
	readonly recentToolSteps: number;
}

export interface ResolvedFastTurnMode {
	readonly mode: "fast";
	readonly maxReadRounds: number;
	readonly deep: null;
}

export interface ResolvedDeepTurnMode {
	readonly mode: "deep";
	/** 快回合的软上限；深回合不使用它。 */
	readonly maxReadRounds: number;
	readonly deep: ResolvedDeepTurnSettings;
}

export type ResolvedTurnMode = ResolvedFastTurnMode | ResolvedDeepTurnMode;

/**
 * 深回合在达到上限、超时或没有任何正文时结束，又没有提交草稿：
 * 运行记为失败，不写助手楼层，head 停在用户楼层。
 */
export class DeepTurnWithoutCommitError extends Error {
	readonly runId: string;
	readonly reason: ModelTurnResult["stopReason"];

	constructor(
		message: string,
		runId: string,
		reason: ModelTurnResult["stopReason"],
	) {
		super(message);
		this.name = "DeepTurnWithoutCommitError";
		this.runId = runId;
		this.reason = reason;
	}
}

/**
 * 模式与读取工具软上限的唯一解析口：单轮参数优先于故事设置。
 * 深回合只解析防失控上限；没有按任何运行状况切换模式的路径。
 * 服务端在写楼层之前调用它，配置非法时请求不会留下用户楼层。
 */
export function resolveTurnMode(
	store: StoryStore,
	storyId: string,
	requestedMode: TurnMode | null | undefined,
	requestedRounds: number | null | undefined,
): ResolvedTurnMode {
	const settings = store.getStorySettings(storyId);
	const mode = requestedMode ?? settings.turnMode;
	const maxReadRounds = requestedRounds ?? settings.maxReadRounds;
	assertMaxReadRounds(maxReadRounds, "读取工具软上限");
	if (mode === "fast") return { mode, maxReadRounds, deep: null };
	assertDeepMaxToolCalls(
		settings.deepMaxToolCalls,
		"故事设置的 deepMaxToolCalls",
	);
	assertDeepTimeoutMs(settings.deepTimeoutMs, "故事设置的 deepTimeoutMs");
	assertDeepContextTokenLimit(
		settings.deepContextTokenLimit,
		"故事设置的 deepContextTokenLimit",
	);
	assertDeepRecentToolSteps(
		settings.deepRecentToolSteps,
		"故事设置的 deepRecentToolSteps",
	);
	return {
		mode,
		maxReadRounds,
		deep: {
			maxToolCalls: settings.deepMaxToolCalls,
			maxDurationMs: settings.deepTimeoutMs,
			contextTokenLimit: settings.deepContextTokenLimit,
			recentToolSteps: settings.deepRecentToolSteps,
		},
	};
}

/**
 * 单轮强度覆盖导演槽位配置里的值。槽位携带了评估用的配置与机制，
 * 这里只重建导演槽位，其它槽位原样复用。
 */
function resolveTurnProviders(options: {
	readonly store: StoryStore;
	readonly providers?: ContextSlotProviders;
	readonly directorIntensity?: DirectorIntensity | null;
}): ContextSlotProviders | undefined {
	const requested = options.directorIntensity;
	if (requested === null || requested === undefined) return options.providers;
	const director = options.providers?.director;
	if (director === undefined) {
		throw new Error("指定了单轮导演强度，但上下文槽位里没有导演槽位");
	}
	if (!isDirectorSlotProvider(director)) {
		throw new Error("指定了单轮导演强度，但导演槽位没有携带配置");
	}
	return {
		...options.providers,
		director: createDirectorSlotProvider(options.store, {
			config: resolveDirectorIntensity(director.config, requested),
			mechanisms: director.mechanisms,
		}),
	};
}

/**
 * 单轮生成：追加用户楼层，组装上下文，流式生成并解析块，
 * 把回复、状态 diff 与 Trace 一起写进楼层树。
 */
export async function runChatTurn(
	options: ChatTurnOptions,
): Promise<ChatTurnResult> {
	if (typeof options.userText !== "string" || options.userText.length === 0) {
		throw new Error("用户消息必须是非空字符串");
	}
	if (!Number.isInteger(options.budgetTokens) || options.budgetTokens < 0) {
		throw new Error("token 预算必须是非负整数");
	}
	if (!options.store.getStory(options.storyId)) {
		throw new Error(`故事不存在：${options.storyId}`);
	}
	const resolved = resolveTurnMode(
		options.store,
		options.storyId,
		options.turnMode,
		options.maxReadRounds,
	);
	const providers = resolveTurnProviders(options);
	const head = options.store.getHead(options.storyId);

	const userNode = options.store.appendNode({
		storyId: options.storyId,
		parentId: head?.id ?? null,
		role: "user",
		raw: options.userText,
	});
	return generateAssistantTurn({
		...options,
		providers,
		directorIntensity: null,
		userNodeId: userNode.id,
		turnMode: resolved.mode,
		maxReadRounds: resolved.maxReadRounds,
	});
}

/**
 * 基于一个已存在的用户楼层生成助手回复：不追加用户楼层，
 * 新回复作为该用户楼层的子节点写入，并把 head 移过去。
 */
export async function generateAssistantTurn(
	options: GenerateAssistantTurnOptions,
): Promise<ChatTurnResult> {
	if (!Number.isInteger(options.budgetTokens) || options.budgetTokens < 0) {
		throw new Error("token 预算必须是非负整数");
	}
	if (!options.store.getStory(options.storyId)) {
		throw new Error(`故事不存在：${options.storyId}`);
	}
	const userNode = options.store.getNode(options.userNodeId);
	if (!userNode) {
		throw new Error(`用户楼层不存在：${options.userNodeId}`);
	}
	if (userNode.storyId !== options.storyId) {
		throw new Error(
			`用户楼层 ${userNode.id} 属于另一个故事 ${userNode.storyId}`,
		);
	}
	if (userNode.role !== "user") {
		throw new Error(
			`助手楼层需要以用户楼层为父节点：${userNode.id} 的角色是 ${userNode.role}`,
		);
	}
	const resolved = resolveTurnMode(
		options.store,
		options.storyId,
		options.turnMode,
		options.maxReadRounds,
	);
	const profile = options.profile ?? DEFAULT_CHAT_PROFILE;
	assertChatProfile(profile);
	const writesLedger = profile === "native";
	const now = options.now ?? Date.now;
	const providers = resolveTurnProviders(options);
	const fingerprint = contextPackFingerprint({
		template: options.template,
		budgetTokens: options.budgetTokens,
		profile,
		directorIntensity: options.directorIntensity ?? null,
		providers,
	});
	const cached = loadReusableContextPack(
		options.store,
		options.storyId,
		userNode.id,
		fingerprint,
	);
	const assembled =
		cached ??
		(await assembleContext({
			template: options.template,
			budgetTokens: options.budgetTokens,
			storyId: options.storyId,
			nodeId: userNode.id,
			providers,
		}));
	if (cached === null) {
		saveContextPack(options.store, {
			storyId: options.storyId,
			nodeId: userNode.id,
			fingerprint,
			assembled,
		});
	}

	const startedAt = now();
	const functionCall =
		writesLedger && options.structuredOutput === "function-call";
	const transport = assertToolTransport(options.toolTransport ?? "native");
	const illustrateTool = writesLedger
		? resolveIllustrateTool(options.store, options.illustrate)
		: null;
	const exposeReadTools =
		resolved.mode === "deep"
			? writesLedger
			: writesLedger && (functionCall || transport === "text");
	const toolSet = resolved.mode === "deep" ? DEEP_TURN_TOOLS : FAST_TURN_TOOLS;
	const readTools = exposeReadTools ? toolSet.tools : [];
	const tools =
		readTools.length === 0 && illustrateTool === null
			? undefined
			: [...readTools, ...(illustrateTool === null ? [] : [illustrateTool])];
	const disabledTools =
		illustrateTool === null && (tools !== undefined || transport === "text")
			? [ILLUSTRATE_TOOL]
			: undefined;
	// 运行表只记录深回合；快回合保持现有 Trace 语义，不写运行行。
	const runId =
		resolved.mode === "deep"
			? options.store.startTurnRun({
					storyId: options.storyId,
					userNodeId: userNode.id,
					mode: "deep",
				}).runId
			: null;
	const onRunEvent =
		runId === null
			? undefined
			: (event: TurnRunEventInput): void => {
					options.store.appendTurnRunEvent({ runId, ...event });
				};
	const draft =
		resolved.mode === "deep"
			? new TurnDraftController({
					onReplace: (snapshot) => {
						onRunEvent?.({
							kind: "draft.replace",
							payload: {
								version: snapshot.version,
								textLength: snapshot.text.length,
							},
						});
						options.onDraftReplace?.(snapshot);
					},
					onCommit: (snapshot, method) => {
						onRunEvent?.({
							kind: "draft.commit",
							payload: {
								version: snapshot.version,
								textLength: snapshot.text.length,
								method,
							},
						});
					},
				})
			: null;
	const turnOptions = {
		client: options.client,
		messages: assembled.messages,
		structuredTools: functionCall ? STRUCTURED_OUTPUT_TOOLS : undefined,
		tools,
		disabledTools,
		toolTransport: transport,
		toolContext: {
			store: options.store,
			storyId: options.storyId,
			beforeNodeId: userNode.id,
			embedder: options.embedder ?? null,
			reranker: options.reranker ?? null,
			viewpoint: options.viewpoint ?? null,
		},
		model: options.model,
		maxTokens: options.maxTokens,
		temperature: options.temperature,
		reasoning: options.reasoning,
		signal: options.signal,
		continuation: {
			expectedTags: WRITE_BLOCK_TAGS,
			continueOn: ["length", "unclosed_tag"],
		},
		onTextDelta: options.onTextDelta,
		onThinkingDelta: options.onThinkingDelta,
		onToolCall: options.onToolCall,
		onToolProgress: options.onToolProgress,
		onRunEvent,
		draft,
		now,
	} as const;
	let turn: ModelTurnResult;
	let deepTurn: DeepTurnResult | null = null;
	try {
		if (resolved.mode === "deep") {
			deepTurn = await runDeepTurn({
				...turnOptions,
				maxToolCalls: resolved.deep.maxToolCalls,
				maxDurationMs: resolved.deep.maxDurationMs,
			});
			turn = deepTurn.turn;
		} else {
			turn = await runModelTurns({
				...turnOptions,
				maxReadRounds: resolved.maxReadRounds,
			});
		}
	} catch (error) {
		if (runId !== null) {
			options.store.appendTurnRunEvent({
				runId,
				kind: "error",
				payload: { message: describeRunError(error) },
			});
			options.store.finishTurnRun({
				runId,
				status: error instanceof TurnAbortedError ? "aborted" : "failed",
			});
		}
		if (resolved.mode === "deep") throw error;
		if (
			error instanceof TurnAbortedError &&
			error.partialText.trim().length > 0
		) {
			return persistAbortedTurn({
				options,
				userNode,
				assembled,
				startedAt,
				error,
				now,
				mode: resolved,
				profile,
				transport,
				runId: null,
			});
		}
		throw error;
	}
	const result = turn.result;
	const completedAt = now();
	const completion = resolveTurnBody({
		mode: resolved.mode,
		draft,
		turn,
	});
	if (completion.text === null) {
		const message = describeMissingCommit(turn.stopReason);
		const failedRunId = runId as string;
		options.store.appendTurnRunEvent({
			runId: failedRunId,
			kind: "error",
			payload: { message, reason: turn.stopReason },
		});
		options.store.finishTurnRun({ runId: failedRunId, status: "failed" });
		throw new DeepTurnWithoutCommitError(message, failedRunId, turn.stopReason);
	}
	const finalText = completion.text;
	const blocks =
		finalText === result.text ? turn.blocks : parseBlocks(finalText);
	const truncations = detectTruncations(
		{ text: finalText, stopReason: result.stopReason },
		TRUNCATION_OPTIONS,
	);

	const structured = !writesLedger
		? emptyStructuredCollection(options.structuredOutput)
		: withProposedStateUpdates(
				functionCall
					? collectStructuredOutputFromToolCalls(turn.toolCalls)
					: collectStructuredOutputFromText(finalText),
				turn.proposedStateUpdates,
			);

	return await options.store.runInTransaction(() => {
		const node = options.store.appendNode({
			storyId: options.storyId,
			parentId: userNode.id,
			role: "assistant",
			raw: finalText,
		});
		recordRegeneratedSwipe(options, node);
		const savedDiffs = writesLedger
			? options.store.appendStateDiffs(
					toNewStateDiffs(options.storyId, node.id, structured.stateUpdates),
				)
			: [];
		const plotNotes = writesLedger
			? options.store.insertPlotNotes(
					structured.notes.map((note) => ({
						storyId: options.storyId,
						sourceNodeId: node.id,
						text: note.text,
					})),
				)
			: [];
		const imageResult = writesLedger
			? applyIllustrateCalls({
					store: options.store,
					storyId: options.storyId,
					nodeId: node.id,
					calls: turn.toolCalls,
					options: options.illustrate,
				})
			: { accepted: 0, rejected: [], calls: [] };
		const runTrace = finishRunWithTrace(
			options.store,
			runId,
			"completed",
			node.id,
		);
		const trace: TurnTrace = {
			storyId: options.storyId,
			nodeId: node.id,
			parentNodeId: userNode.id,
			templateId: options.template.id,
			turnMode: resolved.mode,
			profile,
			createdAt: node.createdAt,
			context: assembled.trace,
			llm: {
				role: "writer",
				model: result.model,
				channel: result.channel,
				stopReason: result.stopReason,
				finishReason: result.finishReason,
				truncations,
				usage: turn.usage,
				attempts: turn.attempts,
				rounds: turn.modelRounds,
				cached: turn.cached,
			},
			tools: {
				transport,
				rounds: turn.rounds,
				maxRounds: resolved.maxReadRounds,
				capped: turn.capped,
				calls: [
					...turn.calls
						.filter((call) => call.name !== "illustrate")
						.map((call) => ({
							name: call.name,
							ok: call.ok,
							error: call.error,
							permission: call.permission,
						})),
					...imageResult.calls.map((call) => ({
						...call,
						permission: "side_effect" as const,
					})),
				],
				rejected: turn.rejected.map((rejection) => ({
					name: rejection.name,
					reason: rejection.reason,
				})),
			},
			images: {
				accepted: imageResult.accepted,
				rejected: imageResult.rejected,
			},
			structured: {
				mode: structured.mode,
				acceptedStateUpdates: structured.stateUpdates.length,
				acceptedNotes: structured.notes.length,
				issues: structured.issues,
			},
			timing: {
				firstTokenMs: turn.firstTokenMs,
				durationMs: completedAt - startedAt,
			},
			deep:
				deepTurn === null
					? null
					: {
							maxToolCalls: deepTurn.maxToolCalls,
							maxDurationMs: deepTurn.maxDurationMs,
							toolCallCount: deepTurn.toolCallCount,
							durationMs: deepTurn.durationMs,
							stopReason: deepTurn.stopReason,
							commit: draft?.commitMethod ?? "none",
							drift: completion.drift,
						},
			run: runTrace,
		};
		options.store.saveTurnTrace(trace);
		return {
			userNode,
			node,
			stateDiffs: savedDiffs,
			plotNotes,
			structured,
			blocks,
			reasoning: result.reasoning,
			trace,
		};
	});
}

/**
 * 重新生成一条助手回复：以原回复的父用户楼层为输入，
 * 在父节点下新建助手兄弟节点并把 head 移过去；旧回复与旧 Trace 保持不变。
 */
export async function regenerateAssistantTurn(
	options: RegenerateAssistantTurnOptions,
): Promise<ChatTurnResult> {
	if (!options.store.getStory(options.storyId)) {
		throw new Error(`故事不存在：${options.storyId}`);
	}
	const assistantNode = options.store.getNode(options.assistantNodeId);
	if (!assistantNode) {
		throw new Error(`助手楼层不存在：${options.assistantNodeId}`);
	}
	if (assistantNode.storyId !== options.storyId) {
		throw new Error(
			`助手楼层 ${assistantNode.id} 属于另一个故事 ${assistantNode.storyId}`,
		);
	}
	if (assistantNode.role !== "assistant") {
		throw new Error(
			`只能重新生成助手楼层：${assistantNode.id} 的角色是 ${assistantNode.role}`,
		);
	}
	if (assistantNode.parentId === null) {
		throw new Error(`助手楼层没有父用户楼层：${assistantNode.id}`);
	}
	return generateAssistantTurn({
		...options,
		userNodeId: assistantNode.parentId,
		swipeFromNodeId: assistantNode.id,
	});
}

/**
 * 重新生成写出新楼层时补一条 swipe 偏好；与楼层写入同一事务，
 * 中止后保存了部分正文的楼层同样记录。普通生成不传来源，只写楼层。
 */
function recordRegeneratedSwipe(
	options: GenerateAssistantTurnOptions,
	node: TimelineNode,
): void {
	const abandonedNodeId = options.swipeFromNodeId;
	if (abandonedNodeId === undefined || abandonedNodeId === null) return;
	options.store.recordPreference({
		storyId: options.storyId,
		nodeId: node.id,
		kind: "swipe",
		payload: { abandonedNodeId, acceptedNodeId: node.id },
		createdAt: node.createdAt,
	});
}

/** 运行结束却没有提交草稿时的原因。 */
function describeMissingCommit(reason: ModelTurnResult["stopReason"]): string {
	if (reason === "timeout") return "深回合超过时长上限，没有提交草稿";
	if (reason === "max_tool_calls") {
		return "深回合达到工具调用上限，没有提交草稿";
	}
	return "模型没有生成正文，运行没有提交草稿";
}

/**
 * 运行结束后的楼层正文：显式提交用草稿；正常结束但没有提交时，
 * 把最后一次输出当作草稿自动提交并记漂移；达到上限、超时或没有正文
 * 且没有提交时返回 null，调用方不写助手楼层。
 */
function resolveTurnBody(input: {
	readonly mode: TurnMode;
	readonly draft: TurnDraftController | null;
	readonly turn: ModelTurnResult;
}): { readonly text: string | null; readonly drift: "missing_commit" | null } {
	if (input.mode !== "deep") {
		return { text: input.turn.result.text, drift: null };
	}
	const draft = input.draft;
	if (draft === null) throw new Error("深回合缺少草稿控制器");
	if (draft.committed) return { text: draft.text, drift: null };
	if (input.turn.stopReason !== "completed") {
		return { text: null, drift: null };
	}
	const body = input.turn.result.text;
	if (body.trim().length > 0 && body !== draft.text) draft.replace(body);
	if (draft.version > 0) {
		draft.commit("auto");
		return { text: draft.text, drift: "missing_commit" };
	}
	return { text: null, drift: null };
}

/** 中止时保存已经生成的部分正文；没有正文时不创建楼层。 */
async function persistAbortedTurn(input: {
	readonly options: GenerateAssistantTurnOptions;
	readonly userNode: TimelineNode;
	readonly assembled: AssembledContext;
	readonly startedAt: number;
	readonly error: TurnAbortedError;
	readonly now: () => number;
	readonly mode: ResolvedTurnMode;
	readonly profile: ChatProfile;
	readonly transport: LlmToolTransport;
	/** 深回合的运行 id；快回合为 null。 */
	readonly runId: string | null;
}): Promise<ChatTurnResult> {
	const { options, userNode, assembled, error } = input;
	const completedAt = input.now();
	return await options.store.runInTransaction(() => {
		const node = options.store.appendNode({
			storyId: options.storyId,
			parentId: userNode.id,
			role: "assistant",
			raw: error.partialText,
		});
		recordRegeneratedSwipe(options, node);
		const runTrace = finishRunWithTrace(
			options.store,
			input.runId,
			"aborted",
			node.id,
		);
		const trace: TurnTrace = {
			storyId: options.storyId,
			nodeId: node.id,
			parentNodeId: userNode.id,
			templateId: options.template.id,
			turnMode: input.mode.mode,
			profile: input.profile,
			createdAt: node.createdAt,
			context: assembled.trace,
			llm: {
				role: "writer",
				model: options.model ?? "unknown",
				channel: null,
				stopReason: "aborted",
				finishReason: null,
				truncations: [],
				usage: emptyUsage(),
				attempts: 0,
				rounds: 0,
				cached: false,
			},
			tools: {
				transport: input.transport,
				rounds: 0,
				maxRounds: input.mode.maxReadRounds,
				capped: false,
				calls: [],
				rejected: [],
			},
			structured: {
				mode: options.structuredOutput,
				acceptedStateUpdates: 0,
				acceptedNotes: 0,
				issues: [],
			},
			timing: {
				firstTokenMs: error.firstTokenMs,
				durationMs: completedAt - input.startedAt,
			},
			deep:
				input.mode.deep === null
					? null
					: {
							maxToolCalls: input.mode.deep.maxToolCalls,
							maxDurationMs: input.mode.deep.maxDurationMs,
							toolCallCount: error.toolCallCount,
							durationMs: completedAt - input.startedAt,
							stopReason: "aborted",
							commit: "none",
							drift: null,
						},
			run: runTrace,
		};
		options.store.saveTurnTrace(trace);
		return {
			userNode,
			node,
			stateDiffs: [],
			plotNotes: [],
			structured: {
				mode: options.structuredOutput,
				stateUpdates: [],
				notes: [],
				issues: [],
			},
			blocks: parseBlocks(error.partialText),
			reasoning: error.partialReasoning,
			trace,
		};
	});
}

function emptyUsage(): LlmUsage {
	return {
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		reasoningTokens: null,
		cachedTokens: null,
	};
}

/** 结束运行并把最终状态与事件条数写进 Trace；快回合没有运行行。 */
function finishRunWithTrace(
	store: StoryStore,
	runId: string | null,
	status: TurnRunFinalStatus,
	nodeId: string,
): TurnTraceRun | null {
	if (runId === null) return null;
	const run = store.finishTurnRun({ runId, status, nodeId });
	return {
		runId: run.runId,
		status: run.status,
		eventCount: store.countTurnRunEvents(run.runId),
	};
}

function describeRunError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

/** 朴素模式不收集结构化写入，返回与请求模式一致的空集合。 */
function emptyStructuredCollection(
	mode: StructuredOutputMode,
): StructuredOutputCollection {
	return { mode, stateUpdates: [], notes: [], issues: [] };
}

/** 工具收集的台账写入与标签或函数调用的结构化写入合并，提交时一起写入。 */
function withProposedStateUpdates(
	structured: StructuredOutputCollection,
	proposed: readonly AcceptedStateUpdate[],
): StructuredOutputCollection {
	if (proposed.length === 0) return structured;
	return {
		...structured,
		stateUpdates: [...structured.stateUpdates, ...proposed],
	};
}

function toNewStateDiffs(
	storyId: string,
	nodeId: string,
	updates: readonly AcceptedStateUpdate[],
): NewStateDiff[] {
	return updates.map((update) => {
		const common = {
			storyId,
			nodeId,
			path: update.path,
			reason: update.reason,
			source: "model",
			storyTime: update.storyTime ?? null,
			confidence: update.confidence ?? null,
		};
		return update.op === "set"
			? { ...common, op: "set", value: update.value }
			: { ...common, op: "delete" };
	});
}
