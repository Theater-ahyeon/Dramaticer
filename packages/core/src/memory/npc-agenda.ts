import {
	type BackgroundJobHandler,
	requireJobNodeId,
} from "../background/types.js";
import type { NpcAgenda } from "../director/pool.js";
import { normalizeEntityName } from "../entity.js";
import type { LlmMessage } from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";
import { parseJsonOutputArray } from "./json-output.js";
import { DEFAULT_CHAPTER_SIZE } from "./summary.js";
import { formatFloors } from "./window.js";

/** 后台任务类型：章节边界推进 NPC 议程。 */
export const NPC_AGENDA_JOB_KIND = "npc_agenda";

export interface NpcAgendaHandlerOptions {
	/** 章节由多少个已确认助手楼层组成；必须与章节摘要使用同一个值。 */
	readonly chapterSize?: number;
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型。 */
	readonly model?: string;
}

export interface NpcAgendaProgress {
	readonly npc: string;
	readonly progress: string;
}

const NPC_PROGRESS_FIELDS: Readonly<Record<string, true>> = {
	npc: true,
	progress: true,
};

const SYSTEM_PROMPT = [
	"你是 NPC 议程推进器。故事按章节推进，你需要写出每个主要 NPC 在幕后做了什么。",
	"只输出一个 JSON 数组，不要输出解释、前后缀或代码块标记。",
	"数组的每一项包含这两个字段：",
	'{"npc":"NPC 名称","progress":"这一章节里该 NPC 的具体进展"}',
	"- npc 必须与输入的议程名称之一完全一致，不要输出输入之外的名称。",
	"- progress 必须是非空字符串，写具体行动与结果；暂无进展的 NPC 也要说明原因。",
	"- 输入里列出的每个 NPC 都要出现一次，不要遗漏或重复。",
	"不要编造输入里没有出现的设定。",
].join("\n");

/** 解析模型输出；只校验结构与重复名称，名称与议程的对应关系由处理器完成。 */
export function parseNpcAgendaProgress(text: string): NpcAgendaProgress[] {
	const parsed = parseJsonOutputArray(text, "NPC 议程输出");
	const seen = new Set<string>();
	return parsed.map((item, index) => {
		const label = `NPC 议程输出[${index}]`;
		if (item === null || typeof item !== "object" || Array.isArray(item)) {
			throw new Error(`${label} 必须是对象`);
		}
		const record = item as Record<string, unknown>;
		for (const key of Object.keys(record)) {
			if (NPC_PROGRESS_FIELDS[key] !== true) {
				throw new Error(`${label} 包含未知字段 ${key}`);
			}
		}
		const npc = requireNonEmptyString(record.npc, `${label}.npc`);
		const progress = requireNonEmptyString(
			record.progress,
			`${label}.progress`,
		);
		const key = normalizeEntityName(npc);
		if (seen.has(key)) {
			throw new Error(`${label}.npc 重复：${npc}`);
		}
		seen.add(key);
		return { npc, progress };
	});
}

/**
 * 生成 NPC 议程的后台任务处理器。
 *
 * 只在章节边界执行：当前路径已确认助手楼层数是章节大小的整数倍。
 * 每条议程按 `everyChapters` 决定落在哪些边界推进；同一楼层重复执行时不重复推进。
 */
export function createNpcAgendaHandler(
	options: NpcAgendaHandlerOptions = {},
): BackgroundJobHandler {
	const chapterSize = options.chapterSize ?? DEFAULT_CHAPTER_SIZE;
	if (!Number.isInteger(chapterSize) || chapterSize < 2) {
		throw new Error("NPC 议程的章节窗口必须是不小于 2 的整数");
	}
	return async ({ store, client, job }) => {
		const nodeId = requireJobNodeId(job);
		const confirmed = store.countConfirmedAssistantNodesOnPath(nodeId);
		if (confirmed === 0 || confirmed % chapterSize !== 0) return;
		const agendas = store.listNpcAgendas(job.storyId);
		if (agendas.length === 0) return;
		const chapterNumber = confirmed / chapterSize;
		const due = agendas.filter(
			(agenda) =>
				chapterNumber % agenda.everyChapters === 0 &&
				agenda.lastAdvancedNodeId !== nodeId,
		);
		if (due.length === 0) return;
		const entries = due.map((agenda) => {
			const entity = store.getEntity(agenda.entityId);
			if (entity === null) {
				throw new Error(`NPC 议程对应的实体不存在：${agenda.entityId}`);
			}
			return { agenda, name: entity.name, aliases: entity.aliases };
		});
		const lookup = buildNameLookup(entries);
		const content = [
			formatChapterContext(store, job.storyId, nodeId),
			formatAgendas(entries),
		].join("\n\n");
		const messages: LlmMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content },
		];
		const result = await client.complete({
			messages,
			model: options.model,
			temperature: 0,
		});
		const progressByEntity = resolveProgress(
			parseNpcAgendaProgress(result.text),
			entries,
			lookup,
		);
		store.advanceNpcAgendas({
			storyId: job.storyId,
			nodeId,
			advances: due.map((agenda) => ({
				entityId: agenda.entityId,
				progress: requireProgress(progressByEntity, agenda.entityId),
			})),
		});
	};
}

interface AgendaEntry {
	readonly agenda: NpcAgenda;
	readonly name: string;
	readonly aliases: readonly string[];
}

function buildNameLookup(
	entries: readonly AgendaEntry[],
): Map<string, AgendaEntry> {
	const lookup = new Map<string, AgendaEntry>();
	for (const entry of entries) {
		for (const value of [entry.name, ...entry.aliases]) {
			const key = normalizeEntityName(value);
			if (key.length === 0) continue;
			const existing = lookup.get(key);
			if (
				existing !== undefined &&
				existing.agenda.entityId !== entry.agenda.entityId
			) {
				throw new Error(`NPC 议程名称对应多个实体：${value}`);
			}
			lookup.set(key, entry);
		}
	}
	return lookup;
}

function resolveProgress(
	output: readonly NpcAgendaProgress[],
	entries: readonly AgendaEntry[],
	lookup: ReadonlyMap<string, AgendaEntry>,
): Map<string, string> {
	const progress = new Map<string, string>();
	for (const item of output) {
		const entry = lookup.get(normalizeEntityName(item.npc));
		if (entry === undefined) {
			throw new Error(`NPC 议程输出里的名称找不到议程：${item.npc}`);
		}
		if (progress.has(entry.agenda.entityId)) {
			throw new Error(`NPC 议程输出重复覆盖同一条议程：${item.npc}`);
		}
		progress.set(entry.agenda.entityId, item.progress);
	}
	const missing = entries
		.filter((entry) => !progress.has(entry.agenda.entityId))
		.map((entry) => entry.name);
	if (missing.length > 0) {
		throw new Error(`NPC 议程输出缺少议程：${missing.join("、")}`);
	}
	return progress;
}

function requireProgress(
	progress: ReadonlyMap<string, string>,
	entityId: string,
): string {
	const value = progress.get(entityId);
	if (value === undefined) {
		throw new Error(`NPC 议程输出缺少议程进度：${entityId}`);
	}
	return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串`);
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new Error(`${label} 不能是空字符串`);
	}
	return trimmed;
}

/**
 * 本篇章的输入：优先使用终点正好在当前楼层的章节摘要；没有摘要时用上一章节
 * 终点之后的楼层原文，与章节摘要的窗口一致。
 */
function formatChapterContext(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): string {
	const chapters = store
		.getValidSummaries(storyId, nodeId)
		.filter((summary) => summary.level === "chapter");
	const last = chapters.at(-1) ?? null;
	if (last !== null && last.endNodeId === nodeId) {
		return ["以下是本篇章的章节摘要：", "<章节>", last.text, "</章节>"].join(
			"\n",
		);
	}
	const path = store.getPathToNode(nodeId);
	const boundaryIndex =
		last === null ? -1 : path.findIndex((node) => node.id === last.endNodeId);
	if (last !== null && boundaryIndex === -1) {
		throw new Error(`上一章节摘要的终点不在当前路径上：${last.endNodeId}`);
	}
	const window = path.slice(boundaryIndex + 1);
	if (window.length === 0) {
		throw new Error("NPC 议程的章节窗口不能为空");
	}
	return formatFloors(window);
}

function formatAgendas(entries: readonly AgendaEntry[]): string {
	const lines = ["以下是 NPC 议程（名称｜目标｜上次进度）："];
	for (const entry of entries) {
		lines.push(`<议程 名称="${entry.name}" 目标="${entry.agenda.goal}">`);
		lines.push(
			entry.agenda.progress.length === 0
				? "（尚未推进）"
				: entry.agenda.progress,
		);
		lines.push("</议程>");
	}
	return lines.join("\n");
}
