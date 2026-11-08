import {
	type BackgroundJobHandler,
	requireJobNodeId,
} from "../background/types.js";
import type { LlmClient, LlmMessage } from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";
import {
	DEFAULT_CHAPTER_SIZE,
	DEFAULT_MAINLINE_SIZE,
	type Summary,
} from "./summary.js";
import { formatFloors } from "./window.js";

export interface SummaryHandlerOptions {
	/** 章节摘要覆盖的已确认助手楼层数；默认 20。 */
	readonly chapterSize?: number;
	/** 主线摘要覆盖的章节数；默认 5。 */
	readonly mainlineSize?: number;
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型。 */
	readonly model?: string;
}

const CHAPTER_PROMPT = [
	"你是故事摘要器。把给定的楼层压缩成一段连贯的章节摘要。",
	"只输出摘要正文，不要输出标题、解释、列表符号或代码块标记。",
	"保留：关键事件、人物关系的变化、尚未解决的冲突、重要物品与地点的变化。",
	"不要编造楼层里没有出现的信息。使用与楼层一致的人称。",
].join("\n");

const MAINLINE_PROMPT = [
	"你是故事摘要器。把给定的连续章节摘要压缩成一段主线摘要。",
	"只输出摘要正文，不要输出标题、解释、列表符号或代码块标记。",
	"保留：贯穿全篇的主线、核心冲突的进展、主要人物的长期目标与关系变化。",
	"不要编造章节摘要里没有出现的信息。使用与原文一致的人称。",
].join("\n");

/** 摘要输出只接受去掉首尾空白后的非空正文。 */
export function parseSummaryText(text: string): string {
	if (typeof text !== "string") {
		throw new Error("摘要输出必须是字符串");
	}
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		throw new Error("摘要输出不能是空字符串");
	}
	return trimmed;
}

/**
 * 生成分层摘要的后台任务处理器。
 *
 * 章节摘要由已确认助手楼层的计数触发，窗口是上一章节终点之后到任务楼层的原文；
 * 主线摘要由有效章节摘要的计数触发，窗口是最近若干条章节摘要，全部位于当前分支。
 */
export function createSummaryHandler(
	options: SummaryHandlerOptions = {},
): BackgroundJobHandler {
	const chapterSize = options.chapterSize ?? DEFAULT_CHAPTER_SIZE;
	const mainlineSize = options.mainlineSize ?? DEFAULT_MAINLINE_SIZE;
	if (!Number.isInteger(chapterSize) || chapterSize < 2) {
		throw new Error("章节摘要窗口必须是不小于 2 的整数");
	}
	if (!Number.isInteger(mainlineSize) || mainlineSize < 1) {
		throw new Error("主线摘要窗口必须是不小于 1 的整数");
	}
	return async ({ store, client, job }) => {
		const nodeId = requireJobNodeId(job);
		const confirmed = store.countConfirmedAssistantNodesOnPath(nodeId);
		if (confirmed > 0 && confirmed % chapterSize === 0) {
			await ensureChapterSummary({
				store,
				client,
				storyId: job.storyId,
				nodeId,
				model: options.model,
			});
		}
		await ensureMainlineSummary({
			store,
			client,
			storyId: job.storyId,
			nodeId: nodeId,
			mainlineSize,
			model: options.model,
		});
	};
}

interface SummaryStepContext {
	readonly store: StoryStore;
	readonly client: LlmClient;
	readonly storyId: string;
	readonly nodeId: string;
	readonly model: string | undefined;
}

async function ensureChapterSummary(
	context: SummaryStepContext,
): Promise<void> {
	const { store, client, storyId, nodeId } = context;
	const chapters = summariesOfLevel(store, storyId, nodeId, "chapter");
	const last = chapters.at(-1) ?? null;
	if (last?.endNodeId === nodeId) return;
	const path = store.getPathToNode(nodeId);
	const boundaryIndex =
		last === null ? -1 : path.findIndex((node) => node.id === last.endNodeId);
	if (last !== null && boundaryIndex === -1) {
		throw new Error(`上一章节摘要的终点不在当前路径上：${last.endNodeId}`);
	}
	const window = path.slice(boundaryIndex + 1);
	if (window.length < 2) return;
	const text = await requestSummary({
		client,
		model: context.model,
		prompt: CHAPTER_PROMPT,
		content: formatFloors(window),
	});
	store.insertSummary({
		storyId,
		level: "chapter",
		startNodeId: requireFirst(window).id,
		endNodeId: nodeId,
		text,
	});
}

async function ensureMainlineSummary(
	context: SummaryStepContext & { readonly mainlineSize: number },
): Promise<void> {
	const { store, client, storyId, nodeId, mainlineSize } = context;
	const summaries = store.getValidSummaries(storyId, nodeId);
	const chapters = summaries.filter((summary) => summary.level === "chapter");
	if (chapters.length === 0 || chapters.length % mainlineSize !== 0) return;
	const lastChapter = requireLast(chapters);
	const lastMainline =
		summaries.filter((summary) => summary.level === "mainline").at(-1) ?? null;
	if (lastMainline?.endNodeId === lastChapter.endNodeId) return;
	const window = chapters.slice(-mainlineSize);
	const text = await requestSummary({
		client,
		model: context.model,
		prompt: MAINLINE_PROMPT,
		content: formatChapters(window),
	});
	store.insertSummary({
		storyId,
		level: "mainline",
		startNodeId: requireFirst(window).startNodeId,
		endNodeId: lastChapter.endNodeId,
		text,
	});
}

function summariesOfLevel(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	level: Summary["level"],
): Summary[] {
	return store
		.getValidSummaries(storyId, nodeId)
		.filter((summary) => summary.level === level);
}

interface SummaryRequest {
	readonly client: LlmClient;
	readonly model: string | undefined;
	readonly prompt: string;
	readonly content: string;
}

async function requestSummary(request: SummaryRequest): Promise<string> {
	const messages: LlmMessage[] = [
		{ role: "system", content: request.prompt },
		{ role: "user", content: request.content },
	];
	const result = await request.client.complete({
		messages,
		model: request.model,
		temperature: 0,
	});
	return parseSummaryText(result.text);
}

function requireFirst<T>(items: readonly T[]): T {
	const first = items[0];
	if (first === undefined) {
		throw new Error("摘要窗口不能为空");
	}
	return first;
}

function requireLast<T>(items: readonly T[]): T {
	const last = items.at(-1);
	if (last === undefined) {
		throw new Error("摘要窗口不能为空");
	}
	return last;
}

function formatChapters(chapters: readonly Summary[]): string {
	const lines = ["以下是按时间顺序排列的章节摘要："];
	for (const chapter of chapters) {
		lines.push(`<章节 起="${chapter.startNodeId}" 止="${chapter.endNodeId}">`);
		lines.push(chapter.text);
		lines.push("</章节>");
	}
	return lines.join("\n");
}
