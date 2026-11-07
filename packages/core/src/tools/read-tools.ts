import { parseBlocks } from "../blocks/parser.js";
import { renderContextView } from "../blocks/view.js";
import { normalizeEntityName } from "../entity.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import type { LlmToolDefinition } from "../llm/types.js";
import { loreEntryMatchScore } from "../memory/lore.js";
import { retrieveMemory } from "../retrieval/hybrid.js";
import type { StoryStore } from "../store/story-store.js";

export const READ_TOOL_NAMES = [
	"memory_search",
	"lore_lookup",
	"state_get",
] as const;

export type ReadToolName = (typeof READ_TOOL_NAMES)[number];

const READ_TOOL_NAME_SET: ReadonlySet<string> = new Set(READ_TOOL_NAMES);

export const MAX_READ_TOOL_LIMIT = 20;
const MAX_MEMORY_SEARCH_LIMIT = 12;
const MAX_SNIPPET_CHARS = 500;
const MAX_RESULT_CHARS = 6_000;

const MEMORY_SEARCH_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		query: {
			type: "string",
			minLength: 1,
			description: "要检索的关键词或一句话，例如人物名、地点或事件",
		},
		limit: {
			type: "integer",
			minimum: 1,
			maximum: MAX_MEMORY_SEARCH_LIMIT,
			description: `最多返回多少条，默认 8，上限 ${MAX_MEMORY_SEARCH_LIMIT}`,
		},
	},
	required: ["query"],
	additionalProperties: false,
};

const LORE_LOOKUP_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		query: {
			type: "string",
			minLength: 1,
			description: "要查的世界书关键词、实体名或一句话",
		},
		limit: {
			type: "integer",
			minimum: 1,
			maximum: MAX_READ_TOOL_LIMIT,
			description: `最多返回多少条，默认 5，上限 ${MAX_READ_TOOL_LIMIT}`,
		},
	},
	required: ["query"],
	additionalProperties: false,
};

const STATE_GET_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		path: {
			type: "array",
			items: { type: "string", minLength: 1 },
			minItems: 1,
			description:
				'状态路径，从宽到窄；省略时返回完整状态，例如 ["角色","卫宫","好感度"]',
		},
	},
	additionalProperties: false,
};

/** 函数调用模式下提供给模型的只读工具。 */
export const READ_TOOLS: readonly LlmToolDefinition[] = [
	{
		name: "memory_search",
		description:
			"检索过去的原文与事件记忆。返回按相关度排序的楼层片段；调用不会修改任何数据。",
		parameters: MEMORY_SEARCH_SCHEMA,
	},
	{
		name: "lore_lookup",
		description:
			"按关键词、实体名或别名查询世界书条目与实体档案；调用不会修改任何数据。",
		parameters: LORE_LOOKUP_SCHEMA,
	},
	{
		name: "state_get",
		description:
			"读取当前累计状态；给出 path 时只返回该路径的值。调用不会修改任何数据。",
		parameters: STATE_GET_SCHEMA,
	},
];

export function isReadToolName(name: string): name is ReadToolName {
	return READ_TOOL_NAME_SET.has(name);
}

export interface ReadToolContext {
	readonly store: StoryStore;
	readonly storyId: string;
	/** 当前用户楼层；检索范围是它的祖先 */
	readonly beforeNodeId: string;
	readonly embedder?: EmbeddingClient | null;
	readonly viewpoint?: string | null;
}

/**
 * 校验模型给出的工具参数。模型输出不可信，先在这里拒绝非法形状，
 * 由调用方把错误写回工具结果，模型可以在下一轮修正。
 */
export function validateReadToolArguments(
	name: ReadToolName,
	value: unknown,
): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${name} 的参数必须是 JSON 对象`);
	}
	const args = value as Record<string, unknown>;
	if (name === "state_get") {
		rejectUnknownKeys(name, args, ["path"]);
		if (args.path === undefined) return {};
		const path = readStringArray(args.path, `${name}.path`);
		return { path };
	}
	rejectUnknownKeys(name, args, ["query", "limit"]);
	const query = args.query;
	if (typeof query !== "string" || query.trim().length === 0) {
		throw new Error(`${name}.query 必须是非空字符串`);
	}
	const max = name === "memory_search" ? MAX_MEMORY_SEARCH_LIMIT : MAX_READ_TOOL_LIMIT;
	const limit = readLimit(args.limit, `${name}.limit`, max);
	return limit === null ? { query } : { query, limit };
}

/** 执行一个只读工具，返回可直接写进工具结果的文本。 */
export async function executeReadTool(
	name: ReadToolName,
	args: Record<string, unknown>,
	context: ReadToolContext,
): Promise<string> {
	if (!context.store.getStory(context.storyId)) {
		throw new Error(`故事不存在：${context.storyId}`);
	}
	switch (name) {
		case "memory_search":
			return await runMemorySearch(args, context);
		case "lore_lookup":
			return runLoreLookup(args, context);
		case "state_get":
			return runStateGet(args, context);
	}
}

async function runMemorySearch(
	args: Record<string, unknown>,
	context: ReadToolContext,
): Promise<string> {
	const query = args.query as string;
	const limit = (args.limit as number | undefined) ?? 8;
	const result = await retrieveMemory({
		store: context.store,
		embedder: context.embedder ?? null,
		storyId: context.storyId,
		query,
		beforeNodeId: context.beforeNodeId,
		viewpoint: context.viewpoint ?? null,
		limit,
	});
	if (result.hits.length === 0) {
		return `记忆检索没有命中（查询：${query}）。`;
	}
	const before = context.store.getPathToNode(context.beforeNodeId);
	const positions = new Map(
		before.map((node, index) => [node.id, index] as const),
	);
	const lines: string[] = [];
	for (const hit of result.hits) {
		const node = context.store.getNode(hit.nodeId);
		if (!node) {
			throw new Error(`检索结果引用了不存在的楼层：${hit.nodeId}`);
		}
		let text: string;
		if (hit.kind === "event") {
			const events = context.store.getEventsForNode(hit.nodeId);
			if (events.length === 0) {
				throw new Error(`楼层 ${hit.nodeId} 被标为事件，但没有事件正文`);
			}
			text = events.map((event) => event.text).join("；");
		} else {
			const position = positions.get(hit.nodeId);
			if (position === undefined) {
				throw new Error(`检索结果里的楼层 ${hit.nodeId} 不在当前路径上`);
			}
			text = renderContextView(parseBlocks(node.raw), {
				depth: before.length - 1 - position,
			});
		}
		const kind = hit.kind === "event" ? "事件" : "原文";
		lines.push(`- 楼层 ${hit.nodeId}（${kind}）：${truncate(text)}`);
	}
	return fitResult(`记忆检索结果（查询：${query}）：\n${lines.join("\n")}`);
}

function runLoreLookup(
	args: Record<string, unknown>,
	context: ReadToolContext,
): string {
	const query = args.query as string;
	const limit = (args.limit as number | undefined) ?? 5;
	const normalizedQuery = normalizeEntityName(query);

	const entityMatches: { name: string; matched: number; line: string }[] = [];
	for (const entity of context.store.listEntities(context.storyId)) {
		let matched = 0;
		for (const alias of entity.aliases) {
			const normalized = normalizeEntityName(alias);
			if (
				normalized.length > 0 &&
				normalizedQuery.includes(normalized) &&
				normalized.length > matched
			) {
				matched = normalized.length;
			}
		}
		if (matched === 0) continue;
		const description =
			entity.description.trim().length > 0 ? `：${entity.description}` : "";
		const aliases =
			entity.aliases.length > 1 ? `（别名：${entity.aliases.join("、")}）` : "";
		entityMatches.push({
			name: entity.name,
			matched,
			line: `- ${entity.name}（${entity.kind}）${aliases}${description}`,
		});
	}
	entityMatches.sort(
		(left, right) =>
			right.matched - left.matched || left.name.localeCompare(right.name),
	);

	const entryMatches: { score: number; line: string }[] = [];
	for (const entry of context.store.listLoreEntries(context.storyId)) {
		let entityAliases: readonly string[] = [];
		if (entry.entityId !== null) {
			const entity = context.store.getEntity(entry.entityId);
			if (!entity) {
				throw new Error(`世界书条目 ${entry.id} 关联的实体不存在`);
			}
			entityAliases = entity.aliases;
		}
		let score = loreEntryMatchScore(entry, normalizedQuery, entityAliases);
		const entryName = normalizeEntityName(entry.name);
		if (entryName.length > 0 && normalizedQuery.includes(entryName)) {
			score += 3;
		}
		if (score === 0) continue;
		entryMatches.push({
			score,
			line: `- ${entry.constant ? "【常驻】" : ""}${entry.name}：${truncate(entry.content)}`,
		});
	}
	entryMatches.sort((left, right) => right.score - left.score);

	const sections: string[] = [];
	const entries = entryMatches.slice(0, limit).map((match) => match.line);
	if (entries.length > 0) {
		sections.push(`世界书条目：\n${entries.join("\n")}`);
	}
	const entities = entityMatches.slice(0, limit).map((match) => match.line);
	if (entities.length > 0) {
		sections.push(`实体：\n${entities.join("\n")}`);
	}
	if (sections.length === 0) {
		return `没有匹配的世界书条目或实体（查询：${query}）。`;
	}
	return fitResult(`查询：${query}\n${sections.join("\n")}`);
}

function runStateGet(
	args: Record<string, unknown>,
	context: ReadToolContext,
): string {
	const snapshot = context.store.getStateSnapshot(context.beforeNodeId);
	const path = args.path as readonly string[] | undefined;
	if (path === undefined) {
		return fitResult(`当前状态：\n${JSON.stringify(snapshot.state, null, 2)}`);
	}
	const found = readPath(snapshot.state, path);
	if (found === undefined) {
		return `路径 ${formatPath(path)} 不存在。`;
	}
	return fitResult(
		`路径 ${formatPath(path)} 的值：\n${JSON.stringify(found, null, 2)}`,
	);
}

function readPath(
	state: unknown,
	path: readonly string[],
): unknown {
	let current: unknown = state;
	for (const segment of path) {
		if (typeof current !== "object" || current === null) return undefined;
		if (!Object.hasOwn(current, segment)) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function formatPath(path: readonly string[]): string {
	return path.map((segment) => `「${segment}」`).join("");
}

function readStringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} 必须是非空的字符串数组`);
	}
	return value.map((segment) => {
		if (typeof segment !== "string" || segment.trim().length === 0) {
			throw new Error(`${label} 的每一段都必须是非空字符串`);
		}
		return segment.trim();
	});
}

function readLimit(
	value: unknown,
	label: string,
	max: number,
): number | null {
	if (value === undefined) return null;
	if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) {
		throw new Error(`${label} 必须是 1 到 ${max} 之间的整数`);
	}
	return value as number;
}

function rejectUnknownKeys(
	name: string,
	args: Record<string, unknown>,
	allowed: readonly string[],
): void {
	for (const key of Object.keys(args)) {
		if (!allowed.includes(key)) {
			throw new Error(`${name} 不接受参数 ${key}`);
		}
	}
}

function truncate(text: string): string {
	const trimmed = text.trim().replace(/\s+/g, " ");
	return trimmed.length > MAX_SNIPPET_CHARS
		? `${trimmed.slice(0, MAX_SNIPPET_CHARS)}……（已截断）`
		: trimmed;
}

function fitResult(text: string): string {
	return text.length > MAX_RESULT_CHARS
		? `${text.slice(0, MAX_RESULT_CHARS)}\n……（结果已截断）`
		: text;
}
