import type { JsonValue } from "../json.js";
import {
	type LlmClient,
	type LlmMessage,
	NO_CONTINUATION,
} from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";
import { type TokenEstimator, createTokenEstimator } from "../tokens.js";
import {
	type AssistantCompaction,
	type AssistantMessage,
	DEFAULT_ASSISTANT_KEEP_RECENT_MESSAGES,
} from "./types.js";

/** 摘要消息的前缀；运行时与用量估算共用，保证两边的 token 口径一致。 */
export const ASSISTANT_SUMMARY_PREFIX = "更早对话的摘要：\n";

const COMPACTION_SYSTEM_PROMPT = [
	"你是应用内助手的上下文压缩器。把较早的对话压缩成一段摘要，供后续请求继续使用。",
	"保留：用户的目标与约束、已经确认的结论与证据、未完成的事项、涉及的工具名与楼层或台账路径。",
	"不要添加新事实，不要替用户做决定，不要省略待确认的提案与它们的来源。",
	"只输出摘要正文，不要标题，不要分点以外的前言。",
].join("\n");

export type AssistantContextPartId =
	| "system"
	| "summary"
	| "messages"
	| "tools";

export interface AssistantContextPart {
	readonly id: AssistantContextPartId;
	readonly tokens: number;
}

/**
 * 下一次模型请求的上下文占用。`percent` 是 `used / budget` 的比值，
 * 与 `compaction_threshold` 同一个口径。
 */
export interface AssistantContextUsage {
	readonly used: number;
	readonly budget: number;
	readonly percent: number;
	readonly parts: readonly AssistantContextPart[];
}

export interface AssistantContextInput {
	readonly systemPrompt: string;
	readonly messages: readonly AssistantMessage[];
	/** 最新一次压缩；它决定哪些消息已被摘要替代。 */
	readonly compaction: AssistantCompaction | null;
	readonly contextBudget: number;
	/** 尚未写入的消息（例如发送请求前刚收到的那条）估算用。 */
	readonly pendingUserText?: string | null;
	readonly estimator?: TokenEstimator;
}

export interface BuildAssistantMessagesInput {
	readonly systemPrompt: string;
	readonly messages: readonly AssistantMessage[];
	readonly compaction: AssistantCompaction | null;
}

export interface CompactAssistantConversationOptions {
	readonly store: StoryStore;
	readonly client: LlmClient;
	readonly conversationId: string;
	readonly systemPrompt: string;
	readonly model?: string;
	readonly maxTokens?: number;
	/** 手动压缩时可以附带的要求；自动压缩不传。 */
	readonly instructions?: string | null;
	readonly keepRecent?: number;
	readonly signal?: AbortSignal;
	readonly estimator?: TokenEstimator;
}

export interface AssistantCompactionOutcome {
	readonly compaction: AssistantCompaction;
	readonly before: AssistantContextUsage;
	readonly after: AssistantContextUsage;
}

/**
 * 把会话消息转成模型消息。被压缩消息用一条 system 摘要替代；
 * 工具消息没有可回放的调用 id 与原生签名，统一以 system 消息保留。
 */
export function buildAssistantRequestMessages(
	input: BuildAssistantMessagesInput,
): LlmMessage[] {
	if (input.systemPrompt.trim().length === 0) {
		throw new Error("助手系统提示不能为空");
	}
	const omitted = new Set(input.compaction?.omittedMessageIds ?? []);
	const result: LlmMessage[] = [
		{ role: "system", content: input.systemPrompt },
	];
	if (input.compaction !== null) {
		result.push({
			role: "system",
			content: `${ASSISTANT_SUMMARY_PREFIX}${input.compaction.summary}`,
		});
	}
	for (const message of input.messages) {
		if (omitted.has(message.ordinal)) continue;
		switch (message.role) {
			case "user":
				result.push({ role: "user", content: message.text });
				break;
			case "assistant":
				result.push({ role: "assistant", content: message.text });
				break;
			case "system":
				result.push({ role: "system", content: message.text });
				break;
			case "tool":
				result.push({
					role: "system",
					content: `工具 ${message.toolName ?? "未知"} 的结果：${JSON.stringify(
						message.toolResult ?? null,
					)}`,
				});
				break;
		}
	}
	return result;
}

/** 按消息与摘要分别估算下一次请求的 token 占用。 */
export function estimateAssistantContext(
	input: AssistantContextInput,
): AssistantContextUsage {
	if (!(input.contextBudget > 0)) {
		throw new Error(`助手上下文预算必须大于 0：${input.contextBudget}`);
	}
	const estimator = input.estimator ?? createTokenEstimator();
	const omitted = new Set(input.compaction?.omittedMessageIds ?? []);
	const system = estimator(input.systemPrompt);
	const summary =
		input.compaction === null
			? 0
			: estimator(`${ASSISTANT_SUMMARY_PREFIX}${input.compaction.summary}`);
	let messages =
		input.pendingUserText == null ? 0 : estimator(input.pendingUserText);
	let tools = 0;
	for (const message of input.messages) {
		if (omitted.has(message.ordinal)) continue;
		if (message.role === "tool") {
			tools += estimator(toolEstimateText(message));
			continue;
		}
		messages += estimator(message.text);
	}
	const parts: AssistantContextPart[] = [
		{ id: "system", tokens: system },
		{ id: "summary", tokens: summary },
		{ id: "messages", tokens: messages },
		{ id: "tools", tokens: tools },
	];
	const used = system + summary + messages + tools;
	return {
		used,
		budget: input.contextBudget,
		percent: used / input.contextBudget,
		parts,
	};
}

/**
 * 压缩较早的消息。没有可以省略的消息时返回 null；摘要请求失败直接抛错，
 * 调用方保留原上下文。
 */
export async function compactAssistantConversation(
	options: CompactAssistantConversationOptions,
): Promise<AssistantCompactionOutcome | null> {
	const conversation = options.store.getAssistantConversation(
		options.conversationId,
	);
	if (conversation === null) {
		throw new Error(`助手会话不存在：${options.conversationId}`);
	}
	if (options.systemPrompt.trim().length === 0) {
		throw new Error("助手系统提示不能为空");
	}
	const keepRecent =
		options.keepRecent ?? DEFAULT_ASSISTANT_KEEP_RECENT_MESSAGES;
	if (!Number.isInteger(keepRecent) || keepRecent < 0) {
		throw new Error(`压缩后保留的消息条数必须是非负整数：${keepRecent}`);
	}
	const estimator = options.estimator ?? createTokenEstimator();
	const latest = options.store.getAssistantCompaction(options.conversationId);
	const messages = options.store.getAssistantMessages(options.conversationId);
	const before = estimateAssistantContext({
		systemPrompt: options.systemPrompt,
		messages,
		compaction: latest,
		contextBudget: conversation.contextBudget,
		estimator,
	});
	const omittedBefore = new Set(latest?.omittedMessageIds ?? []);
	const effective = messages.filter(
		(message) => !omittedBefore.has(message.ordinal),
	);
	const boundary = selectCompactionBoundary(
		options.store,
		options.conversationId,
		effective,
		keepRecent,
	);
	if (boundary <= 0) return null;
	const omitted = effective.slice(0, boundary);
	const remaining = effective.slice(boundary);
	const summary = await requestCompactionSummary(options, latest, omitted);
	const after = estimateAssistantContext({
		systemPrompt: options.systemPrompt,
		messages: remaining,
		compaction: {
			id: "pending",
			conversationId: options.conversationId,
			seq: (latest?.seq ?? 0) + 1,
			summary,
			omittedMessageIds: [],
			beforeTokens: 0,
			afterTokens: 0,
			createdAt: "",
		},
		contextBudget: conversation.contextBudget,
		estimator,
	});
	const compaction = options.store.createAssistantCompaction({
		conversationId: options.conversationId,
		summary,
		omittedMessageIds: [
			...omittedBefore,
			...omitted.map((message) => message.ordinal),
		].sort((left, right) => left - right),
		beforeTokens: before.used,
		afterTokens: after.used,
	});
	return { compaction, before, after };
}

/**
 * 省略边界：最近 keepRecent 条保留；有等待确认的动作时，不省略产生它的
 * 那段对话之后的消息，避免压缩后看不懂待审提案。
 */
function selectCompactionBoundary(
	store: StoryStore,
	conversationId: string,
	effective: readonly AssistantMessage[],
	keepRecent: number,
): number {
	let boundary = Math.max(0, effective.length - keepRecent);
	const pending = store.listAssistantActions({
		conversationId,
		status: "pending",
		limit: 100,
	});
	if (pending.length === 0) return boundary;
	const earliest = pending.reduce(
		(min, action) => (action.createdAt < min ? action.createdAt : min),
		pending[0]?.createdAt ?? "",
	);
	const firstProtected = effective.findIndex(
		(message) => message.createdAt >= earliest,
	);
	if (firstProtected >= 0) boundary = Math.min(boundary, firstProtected);
	return boundary;
}

async function requestCompactionSummary(
	options: CompactAssistantConversationOptions,
	latest: AssistantCompaction | null,
	omitted: readonly AssistantMessage[],
): Promise<string> {
	const lines: string[] = [];
	if (latest !== null) {
		lines.push("已有摘要：", latest.summary, "", "新增需要压缩的对话：");
	} else {
		lines.push("需要压缩的对话：");
	}
	for (const message of omitted) {
		lines.push(formatCompactionMessage(message));
	}
	const instructions = options.instructions?.trim() ?? "";
	if (instructions.length > 0) {
		lines.push("", `附加要求：${instructions}`);
	}
	const result = await options.client.complete(
		{
			messages: [
				{ role: "system", content: COMPACTION_SYSTEM_PROMPT },
				{ role: "user", content: lines.join("\n") },
			],
			model: options.model,
			temperature: 0,
			maxTokens: options.maxTokens,
			signal: options.signal,
		},
		NO_CONTINUATION,
	);
	const summary = result.text.trim();
	if (summary.length === 0) {
		throw new Error("上下文压缩返回了空摘要");
	}
	return summary;
}

function formatCompactionMessage(message: AssistantMessage): string {
	switch (message.role) {
		case "user":
			return `[用户 #${message.ordinal}] ${message.text}`;
		case "assistant":
			return `[助手 #${message.ordinal}] ${message.text}`;
		case "system":
			return `[系统 #${message.ordinal}] ${message.text}`;
		case "tool":
			return `[工具 #${message.ordinal} ${message.toolName ?? "未知"}] ${JSON.stringify(
				message.toolResult ?? null,
			)}`;
	}
}

function toolEstimateText(message: AssistantMessage): string {
	return `工具 ${message.toolName ?? "未知"} 的结果：${JSON.stringify(
		message.toolResult as JsonValue | null,
	)}`;
}
