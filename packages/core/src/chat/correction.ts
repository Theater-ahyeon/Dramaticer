import { validateLedgerDiff } from "../ledger/schema.js";
import { userWillStableId } from "../ledger/user-will.js";
import type { LlmMessage, LlmStreamingClient } from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";
import type { NewStateDiff, TimelineNode } from "../timeline.js";

/** 选中片段在楼层原文里的位置；两端都是字符下标，右端不含。 */
export interface CorrectionSpan {
	readonly start: number;
	readonly end: number;
	/** 选中的原文，逐字取自楼层。 */
	readonly text: string;
}

/**
 * 在楼层原文里定位玩家选中的片段。片段必须逐字出现且只出现一次：
 * 出现多次时无法判定改哪一处，直接拒绝并给出次数。
 */
export function locateCorrectionSpan(
	raw: string,
	quote: string,
): CorrectionSpan {
	if (typeof quote !== "string" || quote.trim().length === 0) {
		throw new Error("选中的片段必须是非空字符串");
	}
	const start = raw.indexOf(quote);
	if (start === -1) {
		throw new Error("选中的片段不在这个楼层的原文里");
	}
	if (raw.indexOf(quote, start + 1) !== -1) {
		throw new Error("选中的片段在楼层里出现了不止一次，请多选几个字再试");
	}
	return { start, end: start + quote.length, text: quote };
}

/**
 * 只替换选中的片段：其余字符逐个保留，因此旧节点里的其它段落与新节点
 * 逐字一致。替换结果为空或与原文相同时拒绝，避免写出没有变化的新楼层。
 */
export function applyCorrectionSpan(
	raw: string,
	span: CorrectionSpan,
	replacement: string,
): string {
	if (typeof replacement !== "string" || replacement.trim().length === 0) {
		throw new Error("改写结果不能为空");
	}
	const trimmed = replacement.replace(/^[\r\n]+|[\r\n]+$/gu, "");
	if (trimmed.trim().length === 0) {
		throw new Error("改写结果不能只有换行");
	}
	if (trimmed === span.text) {
		throw new Error("改写结果与选中的原文相同");
	}
	return `${raw.slice(0, span.start)}${trimmed}${raw.slice(span.end)}`;
}

const SYSTEM_PROMPT = [
	"你在修订一段已经写好的剧情正文。玩家选中了其中一段，说明这一段哪里不对。",
	"- 只重写选中的这一段；前后文的用词、时态、人称与叙述视角保持不变。",
	"- 不要新增人物、事件或设定，不要提前写出后文会发生的事。",
	"- 长度与原文接近；需要更长或更短时以玩家的要求为准。",
	"- 只输出改写后的这一段正文，不要引号、解释、标题或任何前后缀。",
].join("\n");

function buildUserContent(
	node: TimelineNode,
	span: CorrectionSpan,
	instruction: string,
): string {
	return [
		"整个楼层：",
		node.raw,
		"",
		`选中的片段（从第 ${span.start} 个字符起）：`,
		span.text,
		"",
		`玩家说：${instruction}`,
		"",
		"只输出改写后的这一段。",
	].join("\n");
}

export interface RewriteCorrectionInput {
	readonly store: StoryStore;
	readonly client: LlmStreamingClient;
	readonly storyId: string;
	/** 被纠正的助手楼层；旧楼层与它的 Trace 都保留。 */
	readonly nodeId: string;
	/** 玩家选中的原文，必须逐字出现在楼层里且只出现一次。 */
	readonly quote: string;
	/** 玩家对这一段的意见；同时写成一条长期纠正。 */
	readonly instruction: string;
	readonly model?: string;
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly signal?: AbortSignal;
}

export interface RewriteCorrectionResult {
	/** 纠正后的新楼层；它是旧楼层的兄弟节点，head 已经移过来。 */
	readonly node: TimelineNode;
	/** 旧楼层。 */
	readonly beforeNodeId: string;
	readonly span: CorrectionSpan;
	readonly replacement: string;
	/** 这次纠正写进用户意志时用的稳定 id；没有写入时为 null。 */
	readonly willId: string | null;
}

/**
 * 就地纠正：只重写玩家选中的片段，其余正文逐字保留，写成旧楼层的兄弟节点。
 * 纠正意见同时记成来源为玩家的长期纠正，下一轮起进入用户意志槽位。
 */
export async function rewriteFloorSegment(
	input: RewriteCorrectionInput,
): Promise<RewriteCorrectionResult> {
	if (!input.store.getStory(input.storyId)) {
		throw new Error(`故事不存在：${input.storyId}`);
	}
	const node = input.store.getNode(input.nodeId);
	if (node === null) {
		throw new Error(`楼层节点不存在：${input.nodeId}`);
	}
	if (node.storyId !== input.storyId) {
		throw new Error(`楼层节点 ${input.nodeId} 属于另一个故事 ${node.storyId}`);
	}
	if (node.role !== "assistant") {
		throw new Error(`只能纠正助手楼层：${input.nodeId}`);
	}
	const instruction = input.instruction.trim();
	if (instruction.length === 0) {
		throw new Error("纠正意见必须是非空字符串");
	}
	const span = locateCorrectionSpan(node.raw, input.quote);
	const messages: LlmMessage[] = [
		{ role: "system", content: SYSTEM_PROMPT },
		{ role: "user", content: buildUserContent(node, span, instruction) },
	];
	const result = await input.client.complete({
		messages,
		...(input.model === undefined ? {} : { model: input.model }),
		...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
		temperature: input.temperature ?? 0.8,
		signal: input.signal,
	});
	const replacement = result.text.trim();
	const raw = applyCorrectionSpan(node.raw, span, replacement);
	const willText = instruction;
	const willId = userWillStableId(willText);
	const willValue = {
		kind: "correction",
		text: willText,
		sourceNodeId: node.id,
		createdAt: new Date().toISOString(),
	};
	validateLedgerDiff({
		path: ["userWill", willId],
		op: "set",
		value: willValue,
		source: "player",
	});
	return input.store.runInTransaction(() => {
		const created = input.store.editNode(node.id, raw);
		const diffs: NewStateDiff[] = [
			{
				storyId: input.storyId,
				nodeId: created.id,
				path: ["userWill", willId],
				op: "set",
				value: willValue,
				source: "player",
				reason: "就地纠正",
			},
		];
		input.store.appendStateDiffs(diffs);
		return {
			node: created,
			beforeNodeId: node.id,
			span,
			replacement,
			willId,
		};
	});
}
