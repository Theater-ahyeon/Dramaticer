import {
	type ContextTemplate,
	type DirectorConfig,
	type DirectorMechanism,
	type EmbeddingClient,
	type LlmReasoningLevel,
	type LlmStreamingClient,
	type PlotNote,
	type StoryStore,
	type TurnTrace,
	parseBlocks,
	renderContextView,
	runChatTurn,
} from "@dramaticer/core";
import type { StCharacterCard } from "../character-card.js";
import { createChatProviders } from "../chat/session.js";

const DIRECTOR_SEGMENT_ID = "director";
const DIRECTOR_SOURCE_PREFIX = "director:";

export interface ReplayGeneratorInput {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly userText: string;
	readonly round: number;
}

export interface ReplayGeneratorTurn {
	readonly userNodeId: string;
	readonly assistantNodeId: string;
	readonly notes: readonly PlotNote[];
	readonly trace: TurnTrace;
}

/** 回放的一步：真实用户消息加上生成出来的助手楼层。 */
export type ReplayGenerator = (
	input: ReplayGeneratorInput,
) => Promise<ReplayGeneratorTurn>;

export interface ReplayTurn {
	readonly round: number;
	readonly userText: string;
	readonly userNodeId: string;
	readonly assistantNodeId: string;
	readonly raw: string;
	/** 显示视图：去掉不入上下文的块。 */
	readonly reply: string;
	readonly notes: readonly PlotNote[];
	readonly trace: TurnTrace;
	/** 本轮上下文里实际出现的导演机制；没有导演消息时为 null。 */
	readonly directorSelected: string | null;
}

export interface RunDirectorReplayOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly userTexts: readonly string[];
	readonly generate: ReplayGenerator;
	/** 每轮生成完成后调用，用于写入向量与统计线索兑现。 */
	readonly afterTurn?: (turn: ReplayTurn) => void | Promise<void>;
}

export interface DirectorReplayOutcome {
	readonly turns: readonly ReplayTurn[];
}

/** 顺序回放用户消息，每一轮由注入的生成器写出用户与助手楼层。 */
export async function runDirectorReplay(
	options: RunDirectorReplayOptions,
): Promise<DirectorReplayOutcome> {
	const { store, storyId } = options;
	if (!store.getStory(storyId)) {
		throw new Error(`故事不存在：${storyId}`);
	}
	if (options.userTexts.length === 0) {
		throw new Error("回放至少需要一条用户消息");
	}
	const turns: ReplayTurn[] = [];
	for (const [index, userText] of options.userTexts.entries()) {
		if (typeof userText !== "string" || userText.trim().length === 0) {
			throw new Error(`第 ${index + 1} 轮的用户消息不能为空`);
		}
		const generated = await options.generate({
			store,
			storyId,
			userText,
			round: index + 1,
		});
		const userNode = store.getNode(generated.userNodeId);
		if (!userNode) {
			throw new Error(`生成器返回的用户楼层不存在：${generated.userNodeId}`);
		}
		if (userNode.storyId !== storyId) {
			throw new Error(`用户楼层 ${userNode.id} 属于另一个故事`);
		}
		if (userNode.role !== "user") {
			throw new Error(`用户楼层 ${userNode.id} 的角色是 ${userNode.role}`);
		}
		if (userNode.raw !== userText) {
			throw new Error(`用户楼层 ${userNode.id} 的原文与回放输入不一致`);
		}
		const assistantNode = store.getNode(generated.assistantNodeId);
		if (!assistantNode) {
			throw new Error(
				`生成器返回的助手楼层不存在：${generated.assistantNodeId}`,
			);
		}
		if (assistantNode.storyId !== storyId) {
			throw new Error(`助手楼层 ${assistantNode.id} 属于另一个故事`);
		}
		if (assistantNode.role !== "assistant") {
			throw new Error(
				`助手楼层 ${assistantNode.id} 的角色是 ${assistantNode.role}`,
			);
		}
		if (assistantNode.parentId !== userNode.id) {
			throw new Error(
				`助手楼层 ${assistantNode.id} 的父节点不是用户楼层 ${userNode.id}`,
			);
		}
		const turn: ReplayTurn = {
			round: index + 1,
			userText,
			userNodeId: userNode.id,
			assistantNodeId: assistantNode.id,
			raw: assistantNode.raw,
			reply: renderContextView(parseBlocks(assistantNode.raw)),
			notes: generated.notes,
			trace: generated.trace,
			directorSelected: directorMechanismFromTrace(generated.trace),
		};
		turns.push(turn);
		await options.afterTurn?.(turn);
	}
	return { turns };
}

/** 从 Trace 的导演片段读出被选中的机制。 */
export function directorMechanismFromTrace(trace: TurnTrace): string | null {
	const entry = trace.context.entries.find(
		(candidate) => candidate.segmentId === DIRECTOR_SEGMENT_ID,
	);
	if (entry === undefined) return null;
	if (entry.status === "missing-slot" || entry.status === "condition-false") {
		return null;
	}
	if (!entry.source.startsWith(DIRECTOR_SOURCE_PREFIX)) return null;
	const mechanism = entry.source.slice(DIRECTOR_SOURCE_PREFIX.length).trim();
	return mechanism.length === 0 ? null : mechanism;
}

export interface ChatReplayGeneratorOptions {
	readonly card: StCharacterCard;
	readonly client: LlmStreamingClient;
	readonly template: ContextTemplate;
	readonly structuredOutput: "text-tags" | "function-call";
	readonly budgetTokens: number;
	readonly directorConfig: DirectorConfig;
	readonly mechanisms?: readonly DirectorMechanism[];
	readonly embedder?: EmbeddingClient | null;
	readonly model?: string;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly reasoning?: LlmReasoningLevel;
	readonly now?: () => number;
}

/** 生产对话链路的回放生成器：卡内容、槽位与 `runChatTurn` 完全相同。 */
export function createChatReplayGenerator(
	options: ChatReplayGeneratorOptions,
): ReplayGenerator {
	return async ({ store, storyId, userText }) => {
		const result = await runChatTurn({
			store,
			client: options.client,
			storyId,
			userText,
			template: options.template,
			providers: createChatProviders(store, {
				card: options.card,
				embedder: options.embedder,
				directorConfig: options.directorConfig,
				mechanisms: options.mechanisms,
			}),
			budgetTokens: options.budgetTokens,
			structuredOutput: options.structuredOutput,
			model: options.model,
			embedder: options.embedder ?? null,
			maxTokens: options.maxTokens,
			temperature: options.temperature,
			reasoning: options.reasoning,
			now: options.now,
		});
		return {
			userNodeId: result.userNode.id,
			assistantNodeId: result.node.id,
			notes: result.plotNotes,
			trace: result.trace,
		};
	};
}
