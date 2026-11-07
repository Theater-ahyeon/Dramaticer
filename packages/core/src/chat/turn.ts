import { parseBlocks } from "../blocks/parser.js";
import type { ParsedContent } from "../blocks/types.js";
import {
	type AssembledContext,
	type ContextSlotProviders,
	assembleContext,
} from "../context/assembler.js";
import type { ContextTemplate } from "../context/template.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
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
	MAX_TOOL_ROUNDS,
	type ModelTurnResult,
	TurnAbortedError,
	runModelTurns,
} from "./executor.js";

export interface ChatTurnOptions {
	readonly store: StoryStore;
	readonly client: LlmStreamingClient;
	readonly storyId: string;
	readonly userText: string;
	readonly template: ContextTemplate;
	readonly providers?: ContextSlotProviders;
	readonly budgetTokens: number;
	readonly structuredOutput: StructuredOutputMode;
	/** 有 embedding 客户端时 memory_search 启用向量路。 */
	readonly embedder?: EmbeddingClient | null;
	/** 知情者视角；不设置时读取工具返回全知结果。 */
	readonly viewpoint?: string | null;
	/** 最多执行多少轮读取工具，默认 2，上限由执行器强制。 */
	readonly maxToolRounds?: number;
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
	const head = options.store.getHead(options.storyId);

	const userNode = options.store.appendNode({
		storyId: options.storyId,
		parentId: head?.id ?? null,
		role: "user",
		raw: options.userText,
	});
	return generateAssistantTurn({ ...options, userNodeId: userNode.id });
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
	const now = options.now ?? Date.now;
	const assembled = await assembleContext({
		template: options.template,
		budgetTokens: options.budgetTokens,
		storyId: options.storyId,
		nodeId: userNode.id,
		providers: options.providers,
	});

	const startedAt = now();
	const functionCall = options.structuredOutput === "function-call";
	let turn: ModelTurnResult;
	try {
		turn = await runModelTurns({
			client: options.client,
			messages: assembled.messages,
			structuredTools: functionCall ? STRUCTURED_OUTPUT_TOOLS : undefined,
			readTools: functionCall ? READ_TOOLS : undefined,
			toolContext: {
				store: options.store,
				storyId: options.storyId,
				beforeNodeId: userNode.id,
				embedder: options.embedder ?? null,
				viewpoint: options.viewpoint ?? null,
			},
			maxToolRounds: options.maxToolRounds ?? MAX_TOOL_ROUNDS,
			model: options.model,
			maxTokens: options.maxTokens,
			temperature: options.temperature,
			reasoning: options.reasoning,
			signal: options.signal,
			continuation: {
				expectedTags: ["state_update", "plot_note"],
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
			});
		}
		throw error;
	}
	const result = turn.result;
	const completedAt = now();
	const blocks = turn.blocks;

	const structured = functionCall
		? collectStructuredOutputFromToolCalls(turn.toolCalls)
		: collectStructuredOutputFromText(result.text);

	return await options.store.runInTransaction(() => {
		const node = options.store.appendNode({
			storyId: options.storyId,
			parentId: userNode.id,
			role: "assistant",
			raw: result.text,
		});
		const savedDiffs = options.store.appendStateDiffs(
			toNewStateDiffs(options.storyId, node.id, structured.stateUpdates),
		);
		const plotNotes = options.store.insertPlotNotes(
			structured.notes.map((note) => ({
				storyId: options.storyId,
				sourceNodeId: node.id,
				text: note.text,
			})),
		);
		const trace: TurnTrace = {
			storyId: options.storyId,
			nodeId: node.id,
			parentNodeId: userNode.id,
			templateId: options.template.id,
			createdAt: node.createdAt,
			context: assembled.trace,
			llm: {
				role: "writer",
				model: result.model,
				channel: result.channel,
				stopReason: result.stopReason,
				finishReason: result.finishReason,
				truncation: result.truncation,
				usage: turn.usage,
				attempts: turn.attempts,
				rounds: turn.modelRounds,
				cached: turn.cached,
			},
			tools: {
				rounds: turn.rounds,
				calls: turn.calls.map((call) => call.name),
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
			createdAt: node.createdAt,
			context: assembled.trace,
			llm: {
				role: "writer",
				model: options.model ?? "unknown",
				channel: null,
				stopReason: "aborted",
				finishReason: null,
				truncation: null,
				usage: emptyUsage(),
				attempts: 0,
				rounds: 0,
				cached: false,
			},
			tools: { rounds: 0, calls: [] },
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
