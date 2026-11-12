import {
	type BackgroundJobHandler,
	requireJobNodeId,
} from "../background/types.js";
import { resolveCurrentBeat } from "../director/plan.js";
import { rejectUnknownKeys } from "../json.js";
import { type LlmMessage, NO_CONTINUATION } from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";
import { formatCompressionSections } from "./compression.js";
import { parseJsonOutputObject } from "./json-output.js";
import {
	type LoreEntry,
	type LorePrefilter,
	rankLoreEntriesByBm25,
} from "./lore.js";

/** 后台任务类型：为下一轮回复预筛世界书条目。 */
export const LORE_PREFILTER_JOB_KIND = "lore_prefilter";

/** BM25 预筛交给模型的候选条数；默认 20。 */
export const DEFAULT_LORE_PREFILTER_LIMIT = 20;

export interface LorePrefilterHandlerOptions {
	/** BM25 预筛的候选条数；默认 20。 */
	readonly limit?: number;
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型。 */
	readonly model?: string;
}

const SYSTEM_PROMPT = [
	"你是世界书预筛器。阅读本轮玩家消息、最近的压缩记录与下一拍方案，再从候选世界书条目里选出下一轮回复可能用到的条目。",
	"只输出一个 JSON 对象，不要输出解释、前后缀或代码块标记。",
	'对象的形状固定为：{"entryIds":["条目 id"]}。',
	"- 只能从候选条目里选择，条目 id 必须与候选完全一致，不要重复。",
	"- 只选与下一轮回复直接相关的条目；没有相关条目时返回空数组。",
	"- 不要编造候选之外的条目，也不要输出任何额外字段。",
].join("\n");

/**
 * 解析模型输出的预筛结果：必须是只含 entryIds 的对象，数组里的 id 都必须在
 * 候选集合内且不重复；空数组是合法结果。
 */
export function parseLorePrefilterSelection(
	text: string,
	candidateIds: readonly string[],
): string[] {
	const parsed = parseJsonOutputObject(text, "世界书预筛输出");
	rejectUnknownKeys(parsed, ["entryIds"], "世界书预筛输出");
	if (!Array.isArray(parsed.entryIds)) {
		throw new Error("世界书预筛输出的 entryIds 必须是数组");
	}
	const allowed = new Set(candidateIds);
	const seen = new Set<string>();
	const selected: string[] = [];
	for (const [index, item] of parsed.entryIds.entries()) {
		const label = `世界书预筛输出 entryIds[${index}]`;
		if (typeof item !== "string") {
			throw new Error(`${label} 必须是字符串`);
		}
		const id = item.trim();
		if (id.length === 0) {
			throw new Error(`${label} 不能是空字符串`);
		}
		if (!allowed.has(id)) {
			throw new Error(`${label} 不在候选条目里：${id}`);
		}
		if (seen.has(id)) {
			throw new Error(`${label} 重复：${id}`);
		}
		seen.add(id);
		selected.push(id);
	}
	return selected;
}

export interface LorePrefilterInput {
	/** 用于 BM25 的查询文本：玩家消息、最近压缩与本拍方案。 */
	readonly query: string;
	/** 完整提示词内容；候选条目由处理器追加。 */
	readonly content: string;
	readonly candidates: readonly LoreEntry[];
}

/** 构造预筛输入；查询与提示词内容分开，避免标签文字干扰 BM25。 */
export function buildLorePrefilterInput(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	limit: number,
): LorePrefilterInput {
	const node = store.getNode(nodeId);
	if (node === null) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	if (node.storyId !== storyId) {
		throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	const path = store.getPathToNode(nodeId);
	const positions = new Map(
		path.map((item, index) => [item.id, index] as const),
	);
	const latestCompression =
		store
			.getValidCompressions(storyId, nodeId)
			.slice()
			.sort(
				(left, right) =>
					(positions.get(right.endNodeId) ?? -1) -
					(positions.get(left.endNodeId) ?? -1),
			)[0] ?? null;
	const beat = resolveCurrentBeat(store, storyId, nodeId);
	const parent = node.parentId === null ? null : store.getNode(node.parentId);
	if (node.parentId !== null && parent === null) {
		throw new Error(`楼层树断裂：${nodeId} 的父节点缺失`);
	}
	const playerText =
		node.role === "user"
			? node.raw.trim()
			: parent?.role === "user"
				? parent.raw.trim()
				: "";
	const queryParts = [playerText];
	const lines = [
		"本轮玩家消息：",
		playerText.length > 0 ? playerText : "（无）",
	];
	if (latestCompression !== null) {
		const rendered = formatCompressionSections(latestCompression.sections);
		queryParts.push(rendered);
		lines.push("", "最近一条压缩记录：", rendered);
	}
	if (beat !== null) {
		queryParts.push(
			beat.beat.goal,
			...beat.beat.entrySigns,
			...beat.beat.fitPoints,
		);
		lines.push(
			"",
			"下一拍方案：",
			`目标：${beat.beat.goal}`,
			`起始迹象：${beat.beat.entrySigns.join("；")}`,
			`契合点：${beat.beat.fitPoints.join("；")}`,
		);
	}
	const entries = store
		.listLoreEntries(storyId)
		.filter((entry) => !entry.constant);
	const query = queryParts.filter((part) => part.length > 0).join("\n");
	const candidates = rankLoreEntriesByBm25(entries, query, limit).map(
		(match) => match.entry,
	);
	return {
		query,
		content: lines.join("\n"),
		candidates,
	};
}

/**
 * 预筛只服务于下一轮回复，因此只处理当前路径上最新的助手楼层。历史楼层的
 * 任务直接完成：它们既不需要结果，也不该为每次 drain 增加一次模型调用。
 */
function isLatestAssistantOnHeadPath(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): boolean {
	const latest = store
		.getPathToHead(storyId)
		.filter((node) => node.role === "assistant")
		.at(-1);
	return latest?.id === nodeId;
}

/**
 * 预筛处理器：按本轮消息、最近压缩与下一拍方案做 BM25，再让后台模型从候选里
 * 挑出相关条目。结果按楼层覆盖写入；候选为空时不发请求，直接写空数组。
 */
export function createLorePrefilterHandler(
	options: LorePrefilterHandlerOptions = {},
): BackgroundJobHandler {
	const limit = options.limit ?? DEFAULT_LORE_PREFILTER_LIMIT;
	if (!Number.isInteger(limit) || limit < 1) {
		throw new Error("世界书预筛的候选条数必须是正整数");
	}
	return async ({ store, client, job, signal }) => {
		const nodeId = requireJobNodeId(job);
		if (!isLatestAssistantOnHeadPath(store, job.storyId, nodeId)) return;
		const input = buildLorePrefilterInput(store, job.storyId, nodeId, limit);
		if (input.candidates.length === 0) {
			saveLorePrefilter(store, job.storyId, nodeId, []);
			return;
		}
		const messages: LlmMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			{
				role: "user",
				content: [
					input.content,
					"",
					"候选世界书条目：",
					...input.candidates.map(formatCandidate),
				].join("\n"),
			},
		];
		const result = await client.complete(
			{
				messages,
				model: options.model,
				temperature: 0,
				signal,
			},
			NO_CONTINUATION,
		);
		const entryIds = parseLorePrefilterSelection(
			result.text,
			input.candidates.map((entry) => entry.id),
		);
		saveLorePrefilter(store, job.storyId, nodeId, entryIds);
	};
}

function formatCandidate(entry: LoreEntry): string {
	const lines = [
		`<条目 id="${entry.id}" 名称="${entry.name}">`,
		`关键词：${entry.keywords.length === 0 ? "无" : entry.keywords.join("、")}`,
		entry.content,
		"</条目>",
	];
	return lines.join("\n");
}

function saveLorePrefilter(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	entryIds: readonly string[],
): LorePrefilter {
	return store.saveLorePrefilter({ nodeId, storyId, entryIds });
}
