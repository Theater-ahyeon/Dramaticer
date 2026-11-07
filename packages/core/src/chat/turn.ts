import type { ParsedContent } from "../blocks/types.js";
import {
	type ContextSlotProviders,
	assembleContext,
} from "../context/assembler.js";
import type { ContextTemplate } from "../context/template.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import type { LlmReasoningLevel, LlmStreamingClient } from "../llm/types.js";
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
import { MAX_TOOL_ROUNDS, runModelTurns } from "./executor.js";

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
	readonly now?: () => number;
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
	const now = options.now ?? Date.now;
	const head = options.store.getHead(options.storyId);

	const userNode = options.store.appendNode({
		storyId: options.storyId,
		parentId: head?.id ?? null,
		role: "user",
		raw: options.userText,
	});
	const assembled = await assembleContext({
		template: options.template,
		budgetTokens: options.budgetTokens,
		storyId: options.storyId,
		nodeId: userNode.id,
		providers: options.providers,
	});

	const startedAt = now();
	const functionCall = options.structuredOutput === "function-call";
	const turn = await runModelTurns({
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
		now,
	});
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
			toNewStateDiffs(
				options.storyId,
				node.id,
				options.structuredOutput,
				structured.stateUpdates,
			),
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

function toNewStateDiffs(
	storyId: string,
	nodeId: string,
	mode: StructuredOutputMode,
	updates: readonly AcceptedStateUpdate[],
): NewStateDiff[] {
	return updates.map((update) => {
		const common = {
			storyId,
			nodeId,
			path: update.path,
			reason: update.reason,
			source: `structured-output:${mode}`,
		};
		return update.op === "set"
			? { ...common, op: "set", value: update.value }
			: { ...common, op: "delete" };
	});
}
