import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";
import { type SerialChapter, readSerialView } from "./view.js";

/** 文件名里不能出现的字符；Windows 与 macOS 共用这一份。 */
const FILE_NAME_ILLEGAL = /[\\/:*?"<>|]/g;

/** 没有标题时用的文件名主干。 */
const FILE_NAME_FALLBACK = "story";

/** 导出成书的结果：用于下载的 Markdown 与建议的文件名。 */
export interface SerialBookExport {
	readonly storyId: string;
	/** 导出所用楼层；故事没有楼层时为 null。 */
	readonly nodeId: string | null;
	readonly fileName: string;
	readonly markdown: string;
}

export interface SerialBookExportOptions {
	/** 导出楼层；不设置时用当前 head。 */
	readonly nodeId?: string;
}

/** 一章在路径上占的区间；`chapter` 为 null 表示还没有章末清点的段落。 */
interface BookSection {
	readonly chapter: SerialChapter | null;
	readonly start: number;
	readonly end: number;
}

/** 下载文件名：去掉不能出现的字符；标题为空时退回 `story`。 */
function buildFileName(title: string, storyId: string): string {
	const fromTitle = title.replace(FILE_NAME_ILLEGAL, "_").trim();
	const fromId = storyId.replace(FILE_NAME_ILLEGAL, "_").trim();
	const stem = fromTitle.length > 0 ? fromTitle : fromId;
	return `${stem.length > 0 ? stem : FILE_NAME_FALLBACK}.md`;
}

/**
 * 按章节目录切分路径。章与章之间不重叠也不留空档：前一章的章末楼层之后
 * 紧接着下一章；章末之后的玩家楼层仍属于最后一章。
 */
function planSections(
	chapters: readonly SerialChapter[],
	position: ReadonlyMap<string, number>,
	pathLength: number,
): BookSection[] {
	if (chapters.length === 0) {
		return pathLength === 0
			? []
			: [{ chapter: null, start: 0, end: pathLength - 1 }];
	}
	const sections: BookSection[] = [];
	let cursor = 0;
	for (const chapter of chapters) {
		const end =
			chapter.endNodeId === null
				? pathLength - 1
				: position.get(chapter.endNodeId);
		if (end === undefined) {
			throw new Error(`第 ${chapter.ordinal} 章的章末楼层不在当前路径上`);
		}
		if (end < cursor) {
			throw new Error(`第 ${chapter.ordinal} 章的章末楼层早于上一章`);
		}
		sections.push({ chapter, start: cursor, end });
		cursor = end + 1;
	}
	const last = sections[sections.length - 1];
	if (last !== undefined && cursor < pathLength) {
		sections[sections.length - 1] = {
			chapter: last.chapter,
			start: last.start,
			end: pathLength - 1,
		};
	}
	return sections;
}

/** 场次摘要在路径上出现的位置；没归档的场次没有摘要。 */
function planSummaries(
	summaries: readonly {
		readonly startNodeId: string;
		readonly summary: string | null;
	}[],
	position: ReadonlyMap<string, number>,
): Map<number, string> {
	const at = new Map<number, string>();
	for (const scene of summaries) {
		if (scene.summary === null) continue;
		const index = position.get(scene.startNodeId);
		if (index === undefined) continue;
		at.set(index, scene.summary);
	}
	return at;
}

/**
 * 把当前路径按章节目录导出成 Markdown。章标题与场次摘要来自连载视图，
 * 正文逐字取楼层原文，不加时间戳与路径，同一路径重复导出逐字节一致。
 */
export function exportSerialBook(
	store: StoryStore,
	storyId: string,
	options: SerialBookExportOptions = {},
): SerialBookExport {
	const view = readSerialView(
		store,
		storyId,
		options.nodeId === undefined ? {} : { nodeId: options.nodeId },
	);
	const story = store.getStory(storyId);
	if (story === null) throw new Error(`故事不存在：${storyId}`);
	const blocks: string[] = [`# ${story.title}`];
	const path: TimelineNode[] =
		view.nodeId === null ? [] : store.getPathToNode(view.nodeId);
	if (view.nodeId !== null) {
		const position = new Map(path.map((node, index) => [node.id, index]));
		const summaryAt = planSummaries(view.scenes, position);
		for (const section of planSections(view.chapters, position, path.length)) {
			if (section.chapter !== null) {
				blocks.push(`## 第 ${section.chapter.ordinal} 章`);
			}
			for (let index = section.start; index <= section.end; index += 1) {
				const node = path[index];
				if (node === undefined) {
					throw new Error(`路径序号 ${index + 1} 没有楼层`);
				}
				const summary = summaryAt.get(index);
				if (summary !== undefined) blocks.push(`> ${summary}`);
				blocks.push(node.raw);
			}
		}
	}
	return {
		storyId,
		nodeId: view.nodeId,
		fileName: buildFileName(story.title, storyId),
		markdown: `${blocks.join("\n\n")}\n`,
	};
}
