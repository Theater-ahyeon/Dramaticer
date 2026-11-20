// StoryStore 的领域仓储：应用内助手的会话、消息、事件与动作（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import { randomUUID } from "node:crypto";
import {
	type AssistantAction,
	type AssistantActionStatus,
	AssistantConversationHasPendingActionsError,
	DEFAULT_ASSISTANT_ACTION_LIST_LIMIT,
	type ListAssistantActionsOptions,
	type NewAssistantActionInput,
	assertAssistantActionKind,
	assertAssistantActionListLimit,
	assertAssistantActionPayload,
	assertAssistantActionStatus,
	canonicalAssistantActionPayload,
	isAssistantActionStatus,
} from "../../assistant/actions.js";
import {
	type AssistantCompaction,
	type AssistantConversation,
	type AssistantConversationSearchOptions,
	type AssistantConversationStatus,
	type AssistantConversationUpdate,
	type AssistantEvent,
	type AssistantEventKind,
	type AssistantMessage,
	AssistantRunConflictError,
	type AssistantSearchHit,
	DEFAULT_ASSISTANT_COMPACTION_THRESHOLD,
	DEFAULT_ASSISTANT_CONTEXT_BUDGET,
	DEFAULT_ASSISTANT_LIST_LIMIT,
	DEFAULT_ASSISTANT_PERMISSION,
	DEFAULT_ASSISTANT_THINKING,
	DEFAULT_ASSISTANT_TITLE,
	type ListAssistantConversationsOptions,
	type ListAssistantEventsOptions,
	type NewAssistantCompactionInput,
	type NewAssistantConversationInput,
	type NewAssistantMessageInput,
	assertAssistantCompactionThreshold,
	assertAssistantContextBudget,
	assertAssistantConversationStatus,
	assertAssistantEventKind,
	assertAssistantListLimit,
	assertAssistantMessageOrdinals,
	assertAssistantMessageRole,
	assertAssistantPermission,
	assertAssistantThinking,
} from "../../assistant/types.js";
import {
	type JsonObject,
	type JsonValue,
	assertJsonValue,
	isJsonObject,
} from "../../json.js";
import { buildTrigramQuery } from "../../retrieval/chunk-index.js";
import { serializeJsonValue } from "../json-value.js";
import { StoreRepo } from "./base.js";
import { assertNonEmptyString } from "./shared.js";

interface AssistantConversationRow {
	readonly id: string;
	readonly story_id: string | null;
	readonly skill: string;
	readonly title: string;
	readonly permission: string;
	readonly status: string;
	readonly model_alias: string | null;
	readonly thinking: string;
	readonly context_budget: number;
	readonly compaction_threshold: number;
	readonly created_at: string;
	readonly updated_at: string;
	readonly last_message_at: string | null;
}

interface AssistantMessageRow {
	readonly conversation_id: string;
	readonly ordinal: number;
	readonly role: string;
	readonly text: string;
	readonly tool_name: string | null;
	readonly tool_result: string | null;
	readonly usage: string | null;
	readonly created_at: string;
}

interface AssistantMessageSearchRow {
	readonly conversation_id: string;
	readonly ordinal: number;
	readonly snippet: string;
	readonly score: number;
}

interface AssistantMessageLikeRow {
	readonly conversation_id: string;
	readonly ordinal: number;
	readonly text: string;
}

interface AssistantEventRow {
	readonly conversation_id: string;
	readonly seq: number;
	readonly kind: string;
	readonly payload: string;
	readonly created_at: string;
}

interface AssistantCompactionRow {
	readonly id: string;
	readonly conversation_id: string;
	readonly seq: number;
	readonly summary: string;
	readonly omitted_message_ids: string;
	readonly before_tokens: number;
	readonly after_tokens: number;
	readonly created_at: string;
}

interface AssistantActionRow {
	readonly id: string;
	readonly conversation_id: string;
	readonly story_id: string | null;
	readonly kind: string;
	readonly summary: string;
	readonly payload: string;
	readonly status: string;
	readonly rejection_reason: string | null;
	readonly created_at: string;
	readonly decided_at: string | null;
}

function rowToAssistantConversation(
	row: AssistantConversationRow,
): AssistantConversation {
	assertAssistantPermission(row.permission, `助手会话 ${row.id} 的权限`);
	assertAssistantConversationStatus(row.status, `助手会话 ${row.id} 的状态`);
	assertAssistantThinking(row.thinking, `助手会话 ${row.id} 的思考强度`);
	assertAssistantContextBudget(
		row.context_budget,
		`助手会话 ${row.id} 的上下文预算`,
	);
	assertAssistantCompactionThreshold(
		row.compaction_threshold,
		`助手会话 ${row.id} 的压缩阈值`,
	);
	return {
		id: row.id,
		storyId: row.story_id,
		skill: row.skill,
		title: row.title,
		permission: row.permission,
		status: row.status,
		modelAlias: row.model_alias,
		thinking: row.thinking,
		contextBudget: row.context_budget,
		compactionThreshold: row.compaction_threshold,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		lastMessageAt: row.last_message_at,
	};
}

function rowToAssistantMessage(row: AssistantMessageRow): AssistantMessage {
	const label = `助手消息 ${row.conversation_id}#${row.ordinal}`;
	assertAssistantMessageRole(row.role, `${label} 的角色`);
	let toolResult: JsonValue | null = null;
	if (row.tool_result !== null) {
		const parsed: unknown = JSON.parse(row.tool_result);
		assertJsonValue(parsed, `${label} 的工具结果`);
		toolResult = parsed as JsonValue;
	}
	let usage: JsonObject | null = null;
	if (row.usage !== null) {
		const parsed: unknown = JSON.parse(row.usage);
		if (!isJsonObject(parsed)) {
			throw new Error(`${label} 的用量不是 JSON 对象`);
		}
		usage = parsed;
	}
	return {
		conversationId: row.conversation_id,
		ordinal: row.ordinal,
		role: row.role,
		text: row.text,
		toolName: row.tool_name,
		toolResult,
		usage,
		createdAt: row.created_at,
	};
}

function rowToAssistantEvent(row: AssistantEventRow): AssistantEvent {
	assertAssistantEventKind(
		row.kind,
		`助手会话 ${row.conversation_id} 的事件 ${row.seq} 的种类`,
	);
	const payload: unknown = JSON.parse(row.payload);
	if (!isJsonObject(payload)) {
		throw new Error(
			`助手会话 ${row.conversation_id} 的事件 ${row.seq} 的载荷不是 JSON 对象`,
		);
	}
	return {
		conversationId: row.conversation_id,
		seq: row.seq,
		kind: row.kind,
		payload,
		createdAt: row.created_at,
	};
}

function rowToAssistantCompaction(
	row: AssistantCompactionRow,
): AssistantCompaction {
	const label = `助手压缩记录 ${row.conversation_id}#${row.seq}`;
	let parsed: unknown;
	try {
		parsed = JSON.parse(row.omitted_message_ids);
	} catch {
		throw new Error(`${label} 的省略消息序号不是合法 JSON`);
	}
	assertAssistantMessageOrdinals(parsed, `${label} 的省略消息序号`);
	if (typeof row.summary !== "string" || row.summary.trim().length === 0) {
		throw new Error(`${label} 的摘要不能为空`);
	}
	return {
		id: row.id,
		conversationId: row.conversation_id,
		seq: row.seq,
		summary: row.summary,
		omittedMessageIds: parsed,
		beforeTokens: row.before_tokens,
		afterTokens: row.after_tokens,
		createdAt: row.created_at,
	};
}

function rowToAssistantAction(row: AssistantActionRow): AssistantAction {
	assertAssistantActionKind(row.kind, `助手动作 ${row.id} 的种类`);
	if (!isAssistantActionStatus(row.status)) {
		throw new Error(`助手动作 ${row.id} 的状态不合法：${row.status}`);
	}
	const payload: unknown = JSON.parse(row.payload);
	if (!isJsonObject(payload)) {
		throw new Error(`助手动作 ${row.id} 的载荷不是 JSON 对象`);
	}
	return {
		id: row.id,
		conversationId: row.conversation_id,
		storyId: row.story_id,
		kind: row.kind,
		summary: row.summary,
		payload,
		status: row.status,
		rejectionReason: row.rejection_reason,
		createdAt: row.created_at,
		decidedAt: row.decided_at,
	};
}

const ASSISTANT_SNIPPET_RADIUS = 24;

/** 把命中位置前后各截一段，命中词用方括号标出。 */
function createAssistantSnippet(text: string, query: string): string {
	const index = text.toLowerCase().indexOf(query.toLowerCase());
	if (index < 0) {
		return text.length <= ASSISTANT_SNIPPET_RADIUS * 2
			? text
			: `${text.slice(0, ASSISTANT_SNIPPET_RADIUS * 2)}…`;
	}
	const start = Math.max(0, index - ASSISTANT_SNIPPET_RADIUS);
	const end = Math.min(
		text.length,
		index + query.length + ASSISTANT_SNIPPET_RADIUS,
	);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < text.length ? "…" : "";
	return `${prefix}${text.slice(start, index)}[${text.slice(index, index + query.length)}]${text.slice(index + query.length, end)}${suffix}`;
}

export class AssistantRepo extends StoreRepo {
	createAssistantConversation(
		input: NewAssistantConversationInput,
	): AssistantConversation {
		if (typeof input.skill !== "string" || input.skill.trim().length === 0) {
			throw new Error("助手技能必须是非空字符串");
		}
		const skill = input.skill.trim();
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "助手会话 id");
		if (this.getAssistantConversation(id) !== null) {
			throw new Error(`助手会话已存在：${id}`);
		}
		const storyId = input.storyId ?? null;
		if (storyId !== null) {
			assertNonEmptyString(storyId, "助手会话的故事 id");
			if (!this.store.getStory(storyId)) {
				throw new Error(`故事不存在：${storyId}`);
			}
		}
		const title = (input.title ?? DEFAULT_ASSISTANT_TITLE).trim();
		if (title.length === 0) {
			throw new Error("助手会话标题不能为空");
		}
		const permission = input.permission ?? DEFAULT_ASSISTANT_PERMISSION;
		assertAssistantPermission(permission, "助手会话权限");
		const thinking = input.thinking ?? DEFAULT_ASSISTANT_THINKING;
		assertAssistantThinking(thinking, "助手会话思考强度");
		const contextBudget =
			input.contextBudget ?? DEFAULT_ASSISTANT_CONTEXT_BUDGET;
		assertAssistantContextBudget(contextBudget, "助手会话上下文预算");
		const compactionThreshold =
			input.compactionThreshold ?? DEFAULT_ASSISTANT_COMPACTION_THRESHOLD;
		assertAssistantCompactionThreshold(compactionThreshold, "助手会话压缩阈值");
		const modelAlias = input.modelAlias ?? null;
		if (modelAlias !== null) {
			assertNonEmptyString(modelAlias, "助手会话模型别名");
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "助手会话创建时间");
		this.db
			.prepare(
				`INSERT INTO assistant_conversations
				(id, story_id, skill, title, permission, status, model_alias,
					thinking, context_budget, compaction_threshold, created_at,
					updated_at, last_message_at)
				VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?, NULL)`,
			)
			.run(
				id,
				storyId,
				skill,
				title,
				permission,
				modelAlias,
				thinking,
				contextBudget,
				compactionThreshold,
				createdAt,
				createdAt,
			);
		const conversation = this.getAssistantConversation(id);
		if (conversation === null) {
			throw new Error(`助手会话写入后读取失败：${id}`);
		}
		return conversation;
	}

	getAssistantConversation(id: string): AssistantConversation | null {
		assertNonEmptyString(id, "助手会话 id");
		const row = this.db
			.prepare("SELECT * FROM assistant_conversations WHERE id = ?")
			.get(id) as AssistantConversationRow | undefined;
		return row === undefined ? null : rowToAssistantConversation(row);
	}

	/** 按最近活动列出会话；可以按故事与技能过滤。 */
	listAssistantConversations(
		options: ListAssistantConversationsOptions = {},
	): AssistantConversation[] {
		const limit = options.limit ?? DEFAULT_ASSISTANT_LIST_LIMIT;
		assertAssistantListLimit(limit, "助手会话条数");
		const storyId = options.storyId ?? null;
		if (storyId !== null) {
			assertNonEmptyString(storyId, "助手会话的故事 id");
			if (!this.store.getStory(storyId)) {
				throw new Error(`故事不存在：${storyId}`);
			}
		}
		const skill = options.skill ?? null;
		if (skill !== null) assertNonEmptyString(skill, "助手技能");
		const conditions: string[] = [];
		const params: (string | number)[] = [];
		if (storyId !== null) {
			conditions.push("story_id = ?");
			params.push(storyId);
		}
		if (skill !== null) {
			conditions.push("skill = ?");
			params.push(skill);
		}
		const where =
			conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
		params.push(limit);
		const rows = this.db
			.prepare(
				`SELECT * FROM assistant_conversations
				${where}
				ORDER BY COALESCE(last_message_at, updated_at) DESC,
					created_at DESC, id ASC
				LIMIT ?`,
			)
			.all(...params) as AssistantConversationRow[];
		return rows.map(rowToAssistantConversation);
	}

	/**
	 * 按标题与消息正文搜索。标题走 LIKE，两字中文也能命中；正文优先用
	 * trigram 索引，查询短于三个字符时退回到 LIKE。
	 */
	searchAssistantConversations(
		query: string,
		options: AssistantConversationSearchOptions = {},
	): AssistantSearchHit[] {
		if (typeof query !== "string") {
			throw new Error("检索语句必须是字符串");
		}
		const trimmed = query.trim();
		if (trimmed.length === 0) {
			throw new Error("检索语句不能为空");
		}
		if (trimmed.includes("\u0000")) {
			throw new Error("检索语句不能包含空字符");
		}
		const limit = options.limit ?? DEFAULT_ASSISTANT_LIST_LIMIT;
		assertAssistantListLimit(limit, "检索条数");
		const storyId = options.storyId ?? null;
		if (storyId !== null) {
			assertNonEmptyString(storyId, "助手会话的故事 id");
			if (!this.store.getStory(storyId)) {
				throw new Error(`故事不存在：${storyId}`);
			}
		}
		const likePattern = `%${trimmed
			.replaceAll("\\", "\\\\")
			.replaceAll("%", "\\%")
			.replaceAll("_", "\\_")}%`;
		const titleRows = this.db
			.prepare(
				`SELECT * FROM assistant_conversations
				WHERE title LIKE @pattern ESCAPE '\\'
					AND (@storyId IS NULL OR story_id = @storyId)
				ORDER BY COALESCE(last_message_at, updated_at) DESC,
					created_at DESC, id ASC
				LIMIT @limit`,
			)
			.all({
				pattern: likePattern,
				storyId,
				limit,
			}) as AssistantConversationRow[];
		const titleIds = new Set(titleRows.map((row) => row.id));

		const messageHits: {
			conversationId: string;
			ordinal: number;
			snippet: string;
			score: number;
		}[] = [];
		const ftsQuery = buildTrigramQuery(trimmed);
		if (ftsQuery !== null) {
			const rows = this.db
				.prepare(
					`WITH matches AS (
						SELECT m.conversation_id AS conversation_id,
							m.ordinal AS ordinal,
							snippet(assistant_message_text, 2, '[', ']', '…', 12) AS snippet,
							bm25(assistant_message_text) AS score
						FROM assistant_message_text
						JOIN assistant_messages AS m
							ON m.rowid = assistant_message_text.rowid
						WHERE assistant_message_text MATCH @query
							AND (@storyId IS NULL OR m.conversation_id IN (
								SELECT id FROM assistant_conversations
								WHERE story_id = @storyId
							))
					),
					ranked AS (
						SELECT conversation_id, ordinal, snippet, score,
							ROW_NUMBER() OVER (
								PARTITION BY conversation_id
								ORDER BY score ASC, ordinal ASC
							) AS position
						FROM matches
					)
					SELECT conversation_id, ordinal, snippet, score
					FROM ranked WHERE position = 1
					ORDER BY score ASC, ordinal ASC, conversation_id ASC
					LIMIT @limit`,
				)
				.all({
					query: ftsQuery,
					storyId,
					limit,
				}) as AssistantMessageSearchRow[];
			for (const row of rows) {
				messageHits.push({
					conversationId: row.conversation_id,
					ordinal: row.ordinal,
					snippet: row.snippet,
					score: row.score,
				});
			}
		} else {
			const rows = this.db
				.prepare(
					`WITH matches AS (
						SELECT conversation_id, ordinal, text,
							ROW_NUMBER() OVER (
								PARTITION BY conversation_id ORDER BY ordinal ASC
							) AS position
						FROM assistant_messages
						WHERE text LIKE @pattern ESCAPE '\\'
							AND (@storyId IS NULL OR conversation_id IN (
								SELECT id FROM assistant_conversations
								WHERE story_id = @storyId
							))
					)
					SELECT conversation_id, ordinal, text
					FROM matches WHERE position = 1
					ORDER BY ordinal ASC, conversation_id ASC
					LIMIT @limit`,
				)
				.all({
					pattern: likePattern,
					storyId,
					limit,
				}) as AssistantMessageLikeRow[];
			for (const row of rows) {
				messageHits.push({
					conversationId: row.conversation_id,
					ordinal: row.ordinal,
					snippet: createAssistantSnippet(row.text, trimmed),
					score: 0,
				});
			}
		}

		const results: AssistantSearchHit[] = [];
		const used = new Set<string>();
		for (const hit of messageHits) {
			if (results.length >= limit) break;
			const conversation = this.getAssistantConversation(hit.conversationId);
			if (conversation === null) {
				throw new Error(`助手会话不存在：${hit.conversationId}`);
			}
			used.add(hit.conversationId);
			results.push({
				conversation,
				matchedIn: "message",
				snippet: hit.snippet,
				messageOrdinal: hit.ordinal,
				score: hit.score,
			});
		}
		for (const row of titleRows) {
			if (results.length >= limit) break;
			if (used.has(row.id)) continue;
			results.push({
				conversation: rowToAssistantConversation(row),
				matchedIn: "title",
				snippet: createAssistantSnippet(row.title, trimmed),
				messageOrdinal: null,
				score: 0,
			});
		}
		return results;
	}

	getAssistantMessages(conversationId: string): AssistantMessage[] {
		assertNonEmptyString(conversationId, "助手会话 id");
		if (this.getAssistantConversation(conversationId) === null) {
			throw new Error(`助手会话不存在：${conversationId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT conversation_id, ordinal, role, text, tool_name,
					tool_result, usage, created_at
				FROM assistant_messages
				WHERE conversation_id = ?
				ORDER BY ordinal ASC`,
			)
			.all(conversationId) as AssistantMessageRow[];
		return rows.map(rowToAssistantMessage);
	}

	/** 写入一次压缩记录；序号在同一事务里取最大值加一，并更新会话时间。 */
	createAssistantCompaction(
		input: NewAssistantCompactionInput,
	): AssistantCompaction {
		assertNonEmptyString(input.conversationId, "助手会话 id");
		if (
			typeof input.summary !== "string" ||
			input.summary.trim().length === 0
		) {
			throw new Error("助手压缩摘要不能为空");
		}
		assertAssistantMessageOrdinals(
			input.omittedMessageIds,
			"助手压缩的省略消息序号",
		);
		if (
			!Number.isInteger(input.beforeTokens) ||
			input.beforeTokens < 0 ||
			!Number.isInteger(input.afterTokens) ||
			input.afterTokens < 0
		) {
			throw new Error("助手压缩前后的 token 必须是非负整数");
		}
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "助手压缩记录 id");
		if (this.getAssistantConversation(input.conversationId) === null) {
			throw new Error(`助手会话不存在：${input.conversationId}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "助手压缩记录时间");
		return this.db.transaction((): AssistantCompaction => {
			this.db
				.prepare(
					`INSERT INTO assistant_compactions
					(id, conversation_id, seq, summary, omitted_message_ids,
						before_tokens, after_tokens, created_at)
					SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?
					FROM assistant_compactions WHERE conversation_id = ?`,
				)
				.run(
					id,
					input.conversationId,
					input.summary,
					JSON.stringify(input.omittedMessageIds),
					input.beforeTokens,
					input.afterTokens,
					createdAt,
					input.conversationId,
				);
			this.db
				.prepare(
					"UPDATE assistant_conversations SET updated_at = ? WHERE id = ?",
				)
				.run(createdAt, input.conversationId);
			const row = this.db
				.prepare(
					`SELECT id, conversation_id, seq, summary, omitted_message_ids,
						before_tokens, after_tokens, created_at
					FROM assistant_compactions
					WHERE conversation_id = ?
					ORDER BY seq DESC LIMIT 1`,
				)
				.get(input.conversationId) as AssistantCompactionRow | undefined;
			if (row === undefined) {
				throw new Error(`助手压缩记录写入后读取失败：${input.conversationId}`);
			}
			return rowToAssistantCompaction(row);
		})();
	}

	/** 最新一次压缩；没有压缩过时返回 null。后续请求按它过滤消息。 */
	getAssistantCompaction(conversationId: string): AssistantCompaction | null {
		assertNonEmptyString(conversationId, "助手会话 id");
		if (this.getAssistantConversation(conversationId) === null) {
			throw new Error(`助手会话不存在：${conversationId}`);
		}
		const row = this.db
			.prepare(
				`SELECT id, conversation_id, seq, summary, omitted_message_ids,
					before_tokens, after_tokens, created_at
				FROM assistant_compactions
				WHERE conversation_id = ?
				ORDER BY seq DESC LIMIT 1`,
			)
			.get(conversationId) as AssistantCompactionRow | undefined;
		return row === undefined ? null : rowToAssistantCompaction(row);
	}

	listAssistantCompactions(conversationId: string): AssistantCompaction[] {
		assertNonEmptyString(conversationId, "助手会话 id");
		if (this.getAssistantConversation(conversationId) === null) {
			throw new Error(`助手会话不存在：${conversationId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT id, conversation_id, seq, summary, omitted_message_ids,
					before_tokens, after_tokens, created_at
				FROM assistant_compactions
				WHERE conversation_id = ?
				ORDER BY seq ASC`,
			)
			.all(conversationId) as AssistantCompactionRow[];
		return rows.map(rowToAssistantCompaction);
	}

	/** 追加一条消息；序号在同一事务里取最大值加一，并更新会话的最后消息时间。 */
	appendAssistantMessage(input: NewAssistantMessageInput): AssistantMessage {
		assertNonEmptyString(input.conversationId, "助手会话 id");
		assertAssistantMessageRole(input.role, "助手消息角色");
		if (typeof input.text !== "string") {
			throw new Error("助手消息正文必须是字符串");
		}
		if (input.role !== "tool" && input.text.trim().length === 0) {
			throw new Error("助手消息正文不能为空");
		}
		const toolName = input.toolName ?? null;
		const toolResult = input.toolResult;
		if (input.role === "tool") {
			if (toolName === null) {
				throw new Error("工具消息必须提供工具名");
			}
			assertNonEmptyString(toolName, "工具名");
		} else if (toolName !== null || toolResult !== undefined) {
			throw new Error("只有工具消息可以携带工具名与工具结果");
		}
		const usage = input.usage;
		if (input.role !== "assistant" && usage !== undefined) {
			throw new Error("只有助手消息可以携带用量");
		}
		const toolResultJson =
			toolResult === undefined
				? null
				: serializeJsonValue(toolResult, "助手消息的工具结果");
		const usageJson =
			usage === undefined ? null : serializeJsonValue(usage, "助手消息的用量");
		if (this.getAssistantConversation(input.conversationId) === null) {
			throw new Error(`助手会话不存在：${input.conversationId}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "助手消息时间");
		return this.db.transaction((): AssistantMessage => {
			this.db
				.prepare(
					`INSERT INTO assistant_messages
					(conversation_id, ordinal, role, text, tool_name, tool_result,
						usage, created_at)
					SELECT ?, COALESCE(MAX(ordinal), 0) + 1, ?, ?, ?, ?, ?, ?
					FROM assistant_messages WHERE conversation_id = ?`,
				)
				.run(
					input.conversationId,
					input.role,
					input.text,
					toolName,
					toolResultJson,
					usageJson,
					createdAt,
					input.conversationId,
				);
			this.db
				.prepare(
					`UPDATE assistant_conversations
					SET updated_at = ?, last_message_at = ?
					WHERE id = ?`,
				)
				.run(createdAt, createdAt, input.conversationId);
			const row = this.db
				.prepare(
					`SELECT conversation_id, ordinal, role, text, tool_name,
						tool_result, usage, created_at
					FROM assistant_messages
					WHERE conversation_id = ?
					ORDER BY ordinal DESC LIMIT 1`,
				)
				.get(input.conversationId) as AssistantMessageRow | undefined;
			if (row === undefined) {
				throw new Error(`助手消息写入后读取失败：${input.conversationId}`);
			}
			return rowToAssistantMessage(row);
		})();
	}

	updateAssistantConversation(
		id: string,
		update: AssistantConversationUpdate,
	): AssistantConversation {
		assertNonEmptyString(id, "助手会话 id");
		if (this.getAssistantConversation(id) === null) {
			throw new Error(`助手会话不存在：${id}`);
		}
		const sets: string[] = [];
		const params: (string | number | null)[] = [];
		if (update.title !== undefined) {
			const title = update.title.trim();
			if (title.length === 0) {
				throw new Error("助手会话标题不能为空");
			}
			sets.push("title = ?");
			params.push(title);
		}
		if (update.skill !== undefined) {
			if (
				typeof update.skill !== "string" ||
				update.skill.trim().length === 0
			) {
				throw new Error("助手技能必须是非空字符串");
			}
			sets.push("skill = ?");
			params.push(update.skill.trim());
		}
		if (update.permission !== undefined) {
			assertAssistantPermission(update.permission, "助手会话权限");
			sets.push("permission = ?");
			params.push(update.permission);
		}
		if (update.modelAlias !== undefined) {
			if (update.modelAlias !== null) {
				assertNonEmptyString(update.modelAlias, "助手会话模型别名");
			}
			sets.push("model_alias = ?");
			params.push(update.modelAlias);
		}
		if (update.thinking !== undefined) {
			assertAssistantThinking(update.thinking, "助手会话思考强度");
			sets.push("thinking = ?");
			params.push(update.thinking);
		}
		if (update.contextBudget !== undefined) {
			assertAssistantContextBudget(update.contextBudget, "助手会话上下文预算");
			sets.push("context_budget = ?");
			params.push(update.contextBudget);
		}
		if (update.compactionThreshold !== undefined) {
			assertAssistantCompactionThreshold(
				update.compactionThreshold,
				"助手会话压缩阈值",
			);
			sets.push("compaction_threshold = ?");
			params.push(update.compactionThreshold);
		}
		if (sets.length === 0) {
			throw new Error("助手会话更新至少需要一个字段");
		}
		sets.push("updated_at = ?");
		params.push(new Date().toISOString());
		params.push(id);
		this.db
			.prepare(
				`UPDATE assistant_conversations SET ${sets.join(", ")} WHERE id = ?`,
			)
			.run(...params);
		const conversation = this.getAssistantConversation(id);
		if (conversation === null) {
			throw new Error(`助手会话更新后读取失败：${id}`);
		}
		return conversation;
	}

	setAssistantConversationStatus(
		id: string,
		status: AssistantConversationStatus,
	): AssistantConversation {
		assertNonEmptyString(id, "助手会话 id");
		assertAssistantConversationStatus(status, "助手会话状态");
		if (this.getAssistantConversation(id) === null) {
			throw new Error(`助手会话不存在：${id}`);
		}
		this.db
			.prepare(
				"UPDATE assistant_conversations SET status = ?, updated_at = ? WHERE id = ?",
			)
			.run(status, new Date().toISOString(), id);
		const conversation = this.getAssistantConversation(id);
		if (conversation === null) {
			throw new Error(`助手会话状态更新后读取失败：${id}`);
		}
		return conversation;
	}

	/**
	 * 开始一次运行：在同一事务里检查会话没有在跑、把状态改成 running，
	 * 并写入 started 事件。并发启动的第二个请求抛 `AssistantRunConflictError`。
	 */
	startAssistantConversationRun(
		id: string,
		payload: JsonObject,
	): AssistantEvent {
		assertNonEmptyString(id, "助手会话 id");
		if (!isJsonObject(payload)) {
			throw new Error("助手 started 事件的载荷必须是 JSON 对象");
		}
		const createdAt = new Date().toISOString();
		return this.db.transaction((): AssistantEvent => {
			const conversation = this.getAssistantConversation(id);
			if (conversation === null) {
				throw new Error(`助手会话不存在：${id}`);
			}
			if (conversation.status === "running") {
				throw new AssistantRunConflictError(id);
			}
			this.db
				.prepare(
					"UPDATE assistant_conversations SET status = 'running', updated_at = ? WHERE id = ?",
				)
				.run(createdAt, id);
			this.db
				.prepare(
					`INSERT INTO assistant_events
					(conversation_id, seq, kind, payload, created_at)
					SELECT ?, COALESCE(MAX(seq), 0) + 1, 'started', ?, ?
					FROM assistant_events WHERE conversation_id = ?`,
				)
				.run(id, JSON.stringify(payload), createdAt, id);
			const row = this.db
				.prepare(
					`SELECT conversation_id, seq, kind, payload, created_at
					FROM assistant_events WHERE conversation_id = ?
					ORDER BY seq DESC LIMIT 1`,
				)
				.get(id) as AssistantEventRow | undefined;
			if (row === undefined) {
				throw new Error(`助手事件写入后读取失败：${id}`);
			}
			return rowToAssistantEvent(row);
		})();
	}

	/**
	 * 结束一次运行：在同一事务里切换会话状态并写入最终事件。
	 * 只有 completed、failed、cancelled、interrupted 四种结束状态。
	 */
	finishAssistantConversationRun(
		id: string,
		status: "completed" | "failed" | "cancelled" | "interrupted",
		kind: "completed" | "error",
		payload: JsonObject,
	): AssistantEvent {
		assertNonEmptyString(id, "助手会话 id");
		assertAssistantConversationStatus(status, "助手会话结束状态");
		assertAssistantEventKind(kind, "助手结束事件种类");
		if (status === "completed" && kind !== "completed") {
			throw new Error("完成的助手运行必须写 completed 事件");
		}
		if (status !== "completed" && kind !== "error") {
			throw new Error("失败、取消或中断的助手运行必须写 error 事件");
		}
		if (!isJsonObject(payload)) {
			throw new Error("助手结束事件的载荷必须是 JSON 对象");
		}
		const createdAt = new Date().toISOString();
		return this.db.transaction((): AssistantEvent => {
			if (this.getAssistantConversation(id) === null) {
				throw new Error(`助手会话不存在：${id}`);
			}
			this.db
				.prepare(
					"UPDATE assistant_conversations SET status = ?, updated_at = ? WHERE id = ?",
				)
				.run(status, createdAt, id);
			this.db
				.prepare(
					`INSERT INTO assistant_events
					(conversation_id, seq, kind, payload, created_at)
					SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?
					FROM assistant_events WHERE conversation_id = ?`,
				)
				.run(id, kind, JSON.stringify(payload), createdAt, id);
			const row = this.db
				.prepare(
					`SELECT conversation_id, seq, kind, payload, created_at
					FROM assistant_events WHERE conversation_id = ?
					ORDER BY seq DESC LIMIT 1`,
				)
				.get(id) as AssistantEventRow | undefined;
			if (row === undefined) {
				throw new Error(`助手事件写入后读取失败：${id}`);
			}
			return rowToAssistantEvent(row);
		})();
	}

	/** 启动时把上一个进程留下的运行中会话标为 interrupted。 */
	markInterruptedAssistantConversations(updatedAt?: string): number {
		const value = updatedAt ?? new Date().toISOString();
		assertNonEmptyString(value, "助手会话结束时间");
		const info = this.db
			.prepare(
				`UPDATE assistant_conversations SET status = 'interrupted', updated_at = ?
				WHERE status = 'running'`,
			)
			.run(value);
		return info.changes;
	}

	/**
	 * 删除会话及其消息、事件与已决定动作；先删消息让 trigram 索引同步清理。
	 * 仍有待确认动作时拒绝删除，避免玩家丢掉待审提案。
	 */
	deleteAssistantConversation(id: string): void {
		assertNonEmptyString(id, "助手会话 id");
		if (this.getAssistantConversation(id) === null) {
			throw new Error(`助手会话不存在：${id}`);
		}
		const pending = this.countPendingAssistantActions({ conversationId: id });
		if (pending > 0) {
			throw new AssistantConversationHasPendingActionsError(id, pending);
		}
		this.db.transaction(() => {
			this.db
				.prepare("DELETE FROM assistant_messages WHERE conversation_id = ?")
				.run(id);
			this.db
				.prepare("DELETE FROM assistant_conversations WHERE id = ?")
				.run(id);
			this.db
				.prepare("DELETE FROM assistant_events WHERE conversation_id = ?")
				.run(id);
		})();
	}

	appendAssistantEvent(input: {
		readonly conversationId: string;
		readonly kind: AssistantEventKind;
		readonly payload: JsonObject;
		readonly createdAt?: string;
	}): AssistantEvent {
		assertNonEmptyString(input.conversationId, "助手会话 id");
		assertAssistantEventKind(input.kind, "助手事件种类");
		if (!isJsonObject(input.payload)) {
			throw new Error("助手事件载荷必须是 JSON 对象");
		}
		if (this.getAssistantConversation(input.conversationId) === null) {
			throw new Error(`助手会话不存在：${input.conversationId}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "助手事件时间");
		this.db
			.prepare(
				`INSERT INTO assistant_events
				(conversation_id, seq, kind, payload, created_at)
				SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?
				FROM assistant_events WHERE conversation_id = ?`,
			)
			.run(
				input.conversationId,
				input.kind,
				JSON.stringify(input.payload),
				createdAt,
				input.conversationId,
			);
		const row = this.db
			.prepare(
				`SELECT conversation_id, seq, kind, payload, created_at
				FROM assistant_events WHERE conversation_id = ?
				ORDER BY seq DESC LIMIT 1`,
			)
			.get(input.conversationId) as AssistantEventRow | undefined;
		if (row === undefined) {
			throw new Error(`助手事件写入后读取失败：${input.conversationId}`);
		}
		return rowToAssistantEvent(row);
	}

	listAssistantEvents(
		conversationId: string,
		options: ListAssistantEventsOptions = {},
	): AssistantEvent[] {
		assertNonEmptyString(conversationId, "助手会话 id");
		const afterSeq = options.afterSeq ?? 0;
		if (!Number.isInteger(afterSeq) || afterSeq < 0) {
			throw new Error(`助手事件起始序号必须是非负整数：${String(afterSeq)}`);
		}
		if (this.getAssistantConversation(conversationId) === null) {
			throw new Error(`助手会话不存在：${conversationId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT conversation_id, seq, kind, payload, created_at
				FROM assistant_events
				WHERE conversation_id = ? AND seq > ?
				ORDER BY seq ASC`,
			)
			.all(conversationId, afterSeq) as AssistantEventRow[];
		return rows.map(rowToAssistantEvent);
	}

	countAssistantEvents(conversationId: string): number {
		assertNonEmptyString(conversationId, "助手会话 id");
		if (this.getAssistantConversation(conversationId) === null) {
			throw new Error(`助手会话不存在：${conversationId}`);
		}
		const row = this.db
			.prepare(
				"SELECT COUNT(*) AS count FROM assistant_events WHERE conversation_id = ?",
			)
			.get(conversationId) as { readonly count: number };
		return row.count;
	}

	/**
	 * 写入一个待确认动作。同一会话里种类与规范化载荷都相同的待定动作只保留
	 * 第一条，重复提案直接返回已有记录。
	 */
	createAssistantAction(input: NewAssistantActionInput): AssistantAction {
		assertNonEmptyString(input.conversationId, "助手会话 id");
		assertAssistantActionKind(input.kind, "助手动作种类");
		if (
			typeof input.summary !== "string" ||
			input.summary.trim().length === 0
		) {
			throw new Error("助手动作的摘要必须是非空字符串");
		}
		assertAssistantActionPayload(input.kind, input.payload);
		const conversation = this.getAssistantConversation(input.conversationId);
		if (conversation === null) {
			throw new Error(`助手会话不存在：${input.conversationId}`);
		}
		const storyId = conversation.storyId;
		if (storyId === null && input.kind !== "channels") {
			throw new Error(`动作 ${input.kind} 必须来自关联故事的会话`);
		}
		if (storyId !== null && this.store.getStory(storyId) === null) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "助手动作的创建时间");
		const payload = canonicalAssistantActionPayload(input.payload);
		const existing = this.db
			.prepare(
				`SELECT * FROM assistant_actions
				WHERE conversation_id = ? AND kind = ? AND payload = ?
					AND status = 'pending'
				LIMIT 1`,
			)
			.get(input.conversationId, input.kind, payload) as
			| AssistantActionRow
			| undefined;
		if (existing !== undefined) return rowToAssistantAction(existing);
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "助手动作 id");
		if (this.getAssistantAction(id) !== null) {
			throw new Error(`助手动作已存在：${id}`);
		}
		this.db
			.prepare(
				`INSERT INTO assistant_actions
				(id, conversation_id, story_id, kind, summary, payload, status,
					rejection_reason, created_at, decided_at)
				VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)`,
			)
			.run(
				id,
				input.conversationId,
				storyId,
				input.kind,
				input.summary.trim(),
				payload,
				createdAt,
			);
		const action = this.getAssistantAction(id);
		if (action === null) {
			throw new Error(`助手动作写入后读取失败：${id}`);
		}
		return action;
	}

	getAssistantAction(id: string): AssistantAction | null {
		assertNonEmptyString(id, "助手动作 id");
		const row = this.db
			.prepare("SELECT * FROM assistant_actions WHERE id = ?")
			.get(id) as AssistantActionRow | undefined;
		return row === undefined ? null : rowToAssistantAction(row);
	}

	/** 按创建顺序列出待确认动作；可以按会话、故事与状态过滤。 */
	listAssistantActions(
		options: ListAssistantActionsOptions = {},
	): AssistantAction[] {
		const limit = options.limit ?? DEFAULT_ASSISTANT_ACTION_LIST_LIMIT;
		assertAssistantActionListLimit(limit, "助手动作条数");
		const conditions: string[] = [];
		const params: (string | number)[] = [];
		if (options.conversationId !== undefined) {
			assertNonEmptyString(options.conversationId, "助手会话 id");
			if (this.getAssistantConversation(options.conversationId) === null) {
				throw new Error(`助手会话不存在：${options.conversationId}`);
			}
			conditions.push("conversation_id = ?");
			params.push(options.conversationId);
		}
		if (options.storyId !== undefined) {
			assertNonEmptyString(options.storyId, "助手动作的故事 id");
			if (this.store.getStory(options.storyId) === null) {
				throw new Error(`故事不存在：${options.storyId}`);
			}
			conditions.push("story_id = ?");
			params.push(options.storyId);
		}
		if (options.status !== undefined) {
			assertAssistantActionStatus(options.status, "助手动作状态");
			conditions.push("status = ?");
			params.push(options.status);
		}
		const where =
			conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
		params.push(limit);
		const rows = this.db
			.prepare(
				`SELECT * FROM assistant_actions
				${where}
				ORDER BY created_at ASC, id ASC
				LIMIT ?`,
			)
			.all(...params) as AssistantActionRow[];
		return rows.map(rowToAssistantAction);
	}

	countPendingAssistantActions(
		options: {
			readonly conversationId?: string;
			readonly storyId?: string;
		} = {},
	): number {
		const conditions = ["status = 'pending'"];
		const params: string[] = [];
		if (options.conversationId !== undefined) {
			assertNonEmptyString(options.conversationId, "助手会话 id");
			conditions.push("conversation_id = ?");
			params.push(options.conversationId);
		}
		if (options.storyId !== undefined) {
			assertNonEmptyString(options.storyId, "助手动作的故事 id");
			conditions.push("story_id = ?");
			params.push(options.storyId);
		}
		const row = this.db
			.prepare(
				`SELECT COUNT(*) AS count FROM assistant_actions
				WHERE ${conditions.join(" AND ")}`,
			)
			.get(...params) as { readonly count: number };
		return row.count;
	}

	/** 结束一个待确认动作；只有待定状态可以改成批准或拒绝。 */
	setAssistantActionDecision(
		id: string,
		status: Exclude<AssistantActionStatus, "pending">,
		options: {
			readonly decidedAt?: string;
			readonly rejectionReason?: string | null;
		} = {},
	): AssistantAction {
		assertNonEmptyString(id, "助手动作 id");
		if (status !== "approved" && status !== "rejected") {
			throw new Error("助手动作的结束状态只能是 approved 或 rejected");
		}
		const decidedAt = options.decidedAt ?? new Date().toISOString();
		assertNonEmptyString(decidedAt, "助手动作的决定时间");
		const rejectionReason =
			status === "rejected" ? (options.rejectionReason ?? null) : null;
		if (
			status === "rejected" &&
			(rejectionReason === null || rejectionReason.trim().length === 0)
		) {
			throw new Error("拒绝助手动作必须写明原因");
		}
		return this.db.transaction((): AssistantAction => {
			const existing = this.getAssistantAction(id);
			if (existing === null) {
				throw new Error(`助手动作不存在：${id}`);
			}
			if (existing.status !== "pending") {
				throw new Error(
					`助手动作 ${id} 的状态是 ${existing.status}，不能再决定`,
				);
			}
			this.db
				.prepare(
					`UPDATE assistant_actions
					SET status = ?, rejection_reason = ?, decided_at = ?
					WHERE id = ?`,
				)
				.run(status, rejectionReason, decidedAt, id);
			const action = this.getAssistantAction(id);
			if (action === null) {
				throw new Error(`助手动作 ${id} 更新后读取失败`);
			}
			return action;
		})();
	}
}
