import {
	type BackgroundJobHandler,
	requireJobNodeId,
} from "../background/types.js";
import {
	type LlmClient,
	type LlmMessage,
	NO_CONTINUATION,
} from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";
import { parseJsonOutputObject } from "./json-output.js";
import { DEFAULT_CHAPTER_SIZE, DEFAULT_MAINLINE_SIZE } from "./summary.js";
import { formatFloors } from "./window.js";

/** 后台任务类型：在章节边界生成八段式压缩。 */
export const COMPRESSION_JOB_KIND = "compression";

export const COMPRESSION_LEVELS = ["chapter", "mainline"] as const;
export type CompressionLevel = (typeof COMPRESSION_LEVELS)[number];

export function isCompressionLevel(value: unknown): value is CompressionLevel {
	return (
		typeof value === "string" &&
		(COMPRESSION_LEVELS as readonly string[]).includes(value)
	);
}

/** 八段的固定顺序；存储与渲染都按这个顺序。 */
export const COMPRESSION_SECTION_KEYS = [
	"剧情脉络",
	"人物档案",
	"关系网",
	"世界与设定",
	"物品与资源",
	"伏笔与约定",
	"当前情况",
	"用户意志",
] as const;

export type CompressionSectionKey = (typeof COMPRESSION_SECTION_KEYS)[number];

export type CompressionSections = Readonly<
	Record<CompressionSectionKey, string>
>;

export interface ChapterCompression {
	readonly id: string;
	readonly storyId: string;
	readonly level: CompressionLevel;
	/** 覆盖区间的第一楼；必须位于终点楼层所在路径上。 */
	readonly startNodeId: string;
	/** 覆盖区间的最后一楼。 */
	readonly endNodeId: string;
	readonly sections: CompressionSections;
	/** 由写入时的估算器按渲染后的八段正文计算，不接受调用方传入。 */
	readonly tokenCount: number;
	readonly createdAt: string;
}

export interface NewChapterCompressionInput {
	readonly id?: string;
	readonly storyId: string;
	readonly level: CompressionLevel;
	readonly startNodeId: string;
	readonly endNodeId: string;
	readonly sections: CompressionSections;
	readonly createdAt?: string;
}

const SECTION_KEYS: ReadonlySet<string> = new Set(COMPRESSION_SECTION_KEYS);

/**
 * 校验八段对象并按其固定顺序重建：缺键、未知键、非字符串与空正文都抛错，
 * 错误信息带上出问题的字段名。
 */
export function assertCompressionSections(
	value: unknown,
	label: string,
): CompressionSections {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label}必须是对象`);
	}
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (!SECTION_KEYS.has(key)) {
			throw new Error(`${label}包含未知字段 ${key}`);
		}
	}
	const sections = {} as Record<CompressionSectionKey, string>;
	for (const key of COMPRESSION_SECTION_KEYS) {
		if (!Object.hasOwn(record, key)) {
			throw new Error(`${label}缺少字段 ${key}`);
		}
		const text = record[key];
		if (typeof text !== "string") {
			throw new Error(`${label}的字段 ${key} 必须是字符串`);
		}
		const trimmed = text.trim();
		if (trimmed.length === 0) {
			throw new Error(`${label}的字段 ${key} 不能是空字符串`);
		}
		sections[key] = trimmed;
	}
	return sections;
}

/** 解析模型输出的八段 JSON；允许整体包在 Markdown 代码块里。 */
export function parseCompressionSections(text: string): CompressionSections {
	const parsed = parseJsonOutputObject(text, "章节压缩输出");
	return assertCompressionSections(parsed, "章节压缩输出");
}

/** 按固定顺序渲染八段正文。 */
export function formatCompressionSections(
	sections: CompressionSections,
): string {
	return COMPRESSION_SECTION_KEYS.map(
		(key) => `【${key}】\n${sections[key]}`,
	).join("\n");
}

function formatCompressionBlock(compression: ChapterCompression): string {
	return [
		`<压缩 级别="${compression.level}" 起="${compression.startNodeId}" 止="${compression.endNodeId}">`,
		formatCompressionSections(compression.sections),
		"</压缩>",
	].join("\n");
}

const CHAPTER_PROMPT = [
	"你是故事压缩器。把给定的楼层原文压缩成八段式章节记录。",
	"只输出一个 JSON 对象，不要输出解释、前后缀或代码块标记。",
	`对象的键固定为：${COMPRESSION_SECTION_KEYS.join("、")}。`,
	"每个键的值都是非空字符串；某一段没有变化时写“无”。",
	"剧情脉络写本篇章发生的事件；人物档案写人物状态与动机的变化；关系网写人物关系的变化；世界与设定写地点、规则与环境的更新；物品与资源写获得、失去与消耗；伏笔与约定写尚未兑现的线索与约定；当前情况写篇章结束时的局面与暗线；用户意志写玩家在本篇章明确表达的偏好、底线与纠正。",
	"只使用输入里出现的信息，不要编造；不要复述原文里的露骨措辞，用克制的中性表述概括。",
].join("\n");

const MAINLINE_PROMPT = [
	"你是故事压缩器。把给定的连续章节压缩合并成一份八段式主线记录。",
	"只输出一个 JSON 对象，不要输出解释、前后缀或代码块标记。",
	`对象的键固定为：${COMPRESSION_SECTION_KEYS.join("、")}。`,
	"每个键的值都是非空字符串；某一段没有变化时写“无”。",
	"合并时保留贯穿全篇的主线、核心冲突的进展、主要人物的长期目标与关系变化；只使用输入里出现的信息，不要编造。",
].join("\n");

export interface CompressionHandlerOptions {
	/** 章节压缩覆盖的已确认助手楼层数；默认 20。 */
	readonly chapterSize?: number;
	/** 主线压缩覆盖的章节压缩数；默认 5。 */
	readonly mainlineSize?: number;
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型。 */
	readonly model?: string;
}

/**
 * 生成八段式压缩的后台任务处理器。
 *
 * 章节压缩由已确认助手楼层的计数触发，窗口是上一章节终点之后到任务楼层的原文；
 * 主线压缩由有效章节压缩的计数触发，窗口是最近若干条章节压缩，全部位于当前分支。
 */
export function createCompressionHandler(
	options: CompressionHandlerOptions = {},
): BackgroundJobHandler {
	const chapterSize = options.chapterSize ?? DEFAULT_CHAPTER_SIZE;
	const mainlineSize = options.mainlineSize ?? DEFAULT_MAINLINE_SIZE;
	if (!Number.isInteger(chapterSize) || chapterSize < 2) {
		throw new Error("章节压缩窗口必须是不小于 2 的整数");
	}
	if (!Number.isInteger(mainlineSize) || mainlineSize < 1) {
		throw new Error("主线压缩窗口必须是不小于 1 的整数");
	}
	return async ({ store, client, job, signal }) => {
		const nodeId = requireJobNodeId(job);
		const confirmed = store.countConfirmedAssistantNodesOnPath(nodeId);
		if (confirmed > 0 && confirmed % chapterSize === 0) {
			await ensureChapterCompression({
				store,
				client,
				storyId: job.storyId,
				nodeId,
				model: options.model,
				signal,
			});
		}
		await ensureMainlineCompression({
			store,
			client,
			storyId: job.storyId,
			nodeId,
			mainlineSize,
			model: options.model,
			signal,
		});
	};
}

interface CompressionStepContext {
	readonly store: StoryStore;
	readonly client: LlmClient;
	readonly storyId: string;
	readonly nodeId: string;
	readonly model: string | undefined;
	readonly signal: AbortSignal | undefined;
}

async function ensureChapterCompression(
	context: CompressionStepContext,
): Promise<void> {
	const { store, storyId, nodeId } = context;
	const chapters = compressionsOfLevel(store, storyId, nodeId, "chapter");
	const last = chapters.at(-1) ?? null;
	if (last?.endNodeId === nodeId) return;
	const path = store.getPathToNode(nodeId);
	const boundaryIndex =
		last === null ? -1 : path.findIndex((node) => node.id === last.endNodeId);
	if (last !== null && boundaryIndex === -1) {
		throw new Error(`上一份章节压缩的终点不在当前路径上：${last.endNodeId}`);
	}
	const window = path.slice(boundaryIndex + 1);
	if (window.length < 2) return;
	const content = [
		last === null
			? "这是第一份章节压缩，没有上一份压缩。"
			: `以下是上一份章节压缩：\n${formatCompressionBlock(last)}`,
		`以下是本篇章的楼层原文：\n${formatFloors(window)}`,
	].join("\n\n");
	const sections = await requestCompression({
		client: context.client,
		model: context.model,
		prompt: CHAPTER_PROMPT,
		content,
		signal: context.signal,
	});
	store.insertChapterCompression({
		storyId,
		level: "chapter",
		startNodeId: requireFirst(window).id,
		endNodeId: nodeId,
		sections,
	});
}

async function ensureMainlineCompression(
	context: CompressionStepContext & { readonly mainlineSize: number },
): Promise<void> {
	const { store, storyId, nodeId, mainlineSize } = context;
	const compressions = store.getValidCompressions(storyId, nodeId);
	const chapters = compressions.filter(
		(compression) => compression.level === "chapter",
	);
	if (chapters.length === 0 || chapters.length % mainlineSize !== 0) return;
	const lastChapter = requireLast(chapters);
	const lastMainline =
		compressions
			.filter((compression) => compression.level === "mainline")
			.at(-1) ?? null;
	if (lastMainline?.endNodeId === lastChapter.endNodeId) return;
	const window = chapters.slice(-mainlineSize);
	const content = [
		"以下是按时间顺序排列的章节压缩：",
		...window.map(formatCompressionBlock),
	].join("\n");
	const sections = await requestCompression({
		client: context.client,
		model: context.model,
		prompt: MAINLINE_PROMPT,
		content,
		signal: context.signal,
	});
	store.insertChapterCompression({
		storyId,
		level: "mainline",
		startNodeId: requireFirst(window).startNodeId,
		endNodeId: lastChapter.endNodeId,
		sections,
	});
}

function compressionsOfLevel(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	level: CompressionLevel,
): ChapterCompression[] {
	return store
		.getValidCompressions(storyId, nodeId)
		.filter((compression) => compression.level === level);
}

interface CompressionRequest {
	readonly client: CompressionStepContext["client"];
	readonly model: string | undefined;
	readonly prompt: string;
	readonly content: string;
	readonly signal: AbortSignal | undefined;
}

async function requestCompression(
	request: CompressionRequest,
): Promise<CompressionSections> {
	const messages: LlmMessage[] = [
		{ role: "system", content: request.prompt },
		{ role: "user", content: request.content },
	];
	const result = await request.client.complete(
		{
			messages,
			model: request.model,
			temperature: 0,
			signal: request.signal,
		},
		NO_CONTINUATION,
	);
	return parseCompressionSections(result.text);
}

function requireFirst<T>(items: readonly T[]): T {
	const first = items[0];
	if (first === undefined) {
		throw new Error("压缩窗口不能为空");
	}
	return first;
}

function requireLast<T>(items: readonly T[]): T {
	const last = items.at(-1);
	if (last === undefined) {
		throw new Error("压缩窗口不能为空");
	}
	return last;
}
