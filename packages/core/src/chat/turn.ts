import { parseBlocks } from "../blocks/parser.js";
import type { ParsedContent } from "../blocks/types.js";
import {
	type AssembledContext,
	type ContextSlotProviders,
	assembleContext,
} from "../context/assembler.js";
import type { ContextTemplate } from "../context/template.js";
import {
	type DirectorIntensity,
	resolveDirectorIntensity,
} from "../director/intensity.js";
import { type LlmToolTransport, assertToolTransport } from "../llm/channels.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
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
import { READ_TOOLS } from "../tools/read-tools.js";
import type { TurnTrace } from "../trace.js";
import {
	type ModelTurnResult,
	TurnAbortedError,
	runModelTurns,
} from "./executor.js";
import {
	type TurnMode,
	assertMaxReadRounds,
	assertTurnModeSupported,
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
	readonly now?: () => number;
}

export interface GenerateAssistantTurnOptions
	extends Omit<ChatTurnOptions, "userText"> {
	readonly userNodeId: string;
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

interface ResolvedTurnMode {
	readonly mode: TurnMode;
	readonly maxReadRounds: number;
}

/**
 * 模式与读取工具软上限的唯一解析口：单轮参数优先于故事设置。
 * 深回合未实现时在这里直接失败；没有按任何运行状况切换模式的路径。
 */
function resolveTurnMode(
	store: StoryStore,
	storyId: string,
	requestedMode: TurnMode | null | undefined,
	requestedRounds: number | null | undefined,
): ResolvedTurnMode {
	const settings = store.getStorySettings(storyId);
	const mode = requestedMode ?? settings.turnMode;
	assertTurnModeSupported(mode);
	const maxReadRounds = requestedRounds ?? settings.maxReadRounds;
	assertMaxReadRounds(maxReadRounds, "读取工具软上限");
	return { mode, maxReadRounds };
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
	const assembled = await assembleContext({
		template: options.template,
		budgetTokens: options.budgetTokens,
		storyId: options.storyId,
		nodeId: userNode.id,
		providers: resolveTurnProviders(options),
	});

	const startedAt = now();
	const functionCall =
		writesLedger && options.structuredOutput === "function-call";
	const transport = assertToolTransport(options.toolTransport ?? "native");
	let turn: ModelTurnResult;
	try {
		turn = await runModelTurns({
			client: options.client,
			messages: assembled.messages,
			structuredTools: functionCall ? STRUCTURED_OUTPUT_TOOLS : undefined,
			readTools:
				writesLedger && (functionCall || transport === "text")
					? READ_TOOLS
					: undefined,
			toolTransport: transport,
			toolContext: {
				store: options.store,
				storyId: options.storyId,
				beforeNodeId: userNode.id,
				embedder: options.embedder ?? null,
				viewpoint: options.viewpoint ?? null,
			},
			maxReadRounds: resolved.maxReadRounds,
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
			now,
		});
	} catch (error) {
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
			});
		}
		throw error;
	}
	const result = turn.result;
	const completedAt = now();
	const blocks = turn.blocks;
	const truncations = detectTruncations(
		{ text: result.text, stopReason: result.stopReason },
		TRUNCATION_OPTIONS,
	);

	const structured = !writesLedger
		? emptyStructuredCollection(options.structuredOutput)
		: functionCall
			? collectStructuredOutputFromToolCalls(turn.toolCalls)
			: collectStructuredOutputFromText(result.text);

	return await options.store.runInTransaction(() => {
		const node = options.store.appendNode({
			storyId: options.storyId,
			parentId: userNode.id,
			role: "assistant",
			raw: result.text,
		});
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
				calls: turn.calls.map((call) => ({
					name: call.name,
					ok: call.ok,
					error: call.error,
				})),
				rejected: turn.rejected.map((rejection) => ({
					name: rejection.name,
					reason: rejection.reason,
				})),
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
	});
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

/** 朴素模式不收集结构化写入，返回与请求模式一致的空集合。 */
function emptyStructuredCollection(
	mode: StructuredOutputMode,
): StructuredOutputCollection {
	return { mode, stateUpdates: [], notes: [], issues: [] };
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
		};
		return update.op === "set"
			? { ...common, op: "set", value: update.value }
			: { ...common, op: "delete" };
	});
}
