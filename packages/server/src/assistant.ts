import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type AssistantConversation,
	type StoryStore,
	assertAssistantCompactionThreshold,
	assertAssistantContextBudget,
	assertAssistantPermission,
	assertAssistantThinking,
} from "@dramaticer/core";
import {
	type AssistantConversationDetailView,
	type AssistantConversationEventsView,
	type AssistantConversationListView,
	type AssistantConversationStatusView,
	type AssistantConversationView,
	type AssistantPermission,
	type AssistantSkillId,
	type AssistantThinking,
	type CreateAssistantConversationRequest,
	type UpdateAssistantConversationRequest,
	isAssistantSkillId,
} from "@dramaticer/protocol";
import { HttpError, readJsonBody, sendEmpty, sendJson } from "./http.js";

export interface AssistantRouteOptions {
	readonly store: StoryStore;
	readonly maxJsonBodyBytes: number;
}

const PATH_PREFIX = "/api/assistant";

/** 处理 `/api/assistant` 下的会话接口；不认识的路径返回 404。 */
export async function handleAssistantRequest(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
	method: string,
	options: AssistantRouteOptions,
): Promise<void> {
	if (
		url.pathname !== PATH_PREFIX &&
		!url.pathname.startsWith(`${PATH_PREFIX}/`)
	) {
		throw new HttpError(404, "not_found", "没有这个接口");
	}
	const parts = assistantPathSegments(url.pathname);
	const [collection, id, action] = parts;
	if (collection !== "conversations") {
		throw new HttpError(404, "not_found", "没有这个接口");
	}
	if (id === undefined) {
		if (method === "GET") {
			handleConversationList(res, url, options);
			return;
		}
		requireMethod(method, ["POST"]);
		await handleConversationCreate(req, res, options);
		return;
	}
	if (action === undefined) {
		if (method === "GET") {
			handleConversationDetail(res, options, id);
			return;
		}
		if (method === "PATCH") {
			await handleConversationUpdate(req, res, options, id);
			return;
		}
		if (method === "DELETE") {
			handleConversationDelete(res, options, id);
			return;
		}
		throw new HttpError(405, "bad_request", `不支持的请求方法：${method}`);
	}
	if (action === "status") {
		requireMethod(method, ["GET"]);
		handleConversationStatus(res, options, id);
		return;
	}
	if (action === "events") {
		requireMethod(method, ["GET"]);
		handleConversationEvents(res, url, options, id);
		return;
	}
	throw new HttpError(404, "not_found", "没有这个接口");
}

function handleConversationList(
	res: ServerResponse,
	url: URL,
	options: AssistantRouteOptions,
): void {
	const rawQuery = url.searchParams.get("query");
	const query = rawQuery === null ? "" : rawQuery.trim();
	if (query.includes("\u0000")) {
		throw fieldError("query", "query 不能包含空字符");
	}
	const storyId = readStoryIdQuery(url);
	if (storyId !== null && options.store.getStory(storyId) === null) {
		throw new HttpError(404, "not_found", `故事不存在：${storyId}`, {
			path: "storyId",
		});
	}
	const limit = readLimit(url, 20);
	if (query.length === 0) {
		const conversations = options.store
			.listAssistantConversations({ storyId: storyId ?? undefined, limit })
			.map(toConversationView);
		const body: AssistantConversationListView = { conversations };
		sendJson(res, 200, body);
		return;
	}
	const hits = options.store.searchAssistantConversations(query, {
		storyId: storyId ?? undefined,
		limit,
	});
	const body: AssistantConversationListView = {
		conversations: hits.map((hit) => toConversationView(hit.conversation)),
		matches: hits.map((hit) => ({
			matchedIn: hit.matchedIn,
			snippet: hit.snippet,
			messageOrdinal: hit.messageOrdinal,
			score: hit.score,
		})),
	};
	sendJson(res, 200, body);
}

async function handleConversationCreate(
	req: IncomingMessage,
	res: ServerResponse,
	options: AssistantRouteOptions,
): Promise<void> {
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, [
		"storyId",
		"skill",
		"title",
		"permission",
		"modelAlias",
		"thinking",
		"contextBudget",
		"compactionThreshold",
	]);
	if (!isAssistantSkillId(body.skill)) {
		throw fieldError(
			"skill",
			`skill 必须是已注册的技能 id：${String(body.skill)}`,
		);
	}
	const storyId =
		body.storyId === undefined
			? null
			: readNullableText(body.storyId, "storyId");
	if (storyId !== null && options.store.getStory(storyId) === null) {
		throw new HttpError(404, "not_found", `故事不存在：${storyId}`, {
			path: "storyId",
		});
	}
	const request: CreateAssistantConversationRequest = {
		skill: body.skill,
		...(storyId === null ? {} : { storyId }),
		...(body.title === undefined
			? {}
			: { title: requireText(body.title, "title") }),
		...(body.permission === undefined
			? {}
			: { permission: readPermission(body.permission, "permission") }),
		...(body.modelAlias === undefined
			? {}
			: { modelAlias: readNullableText(body.modelAlias, "modelAlias") }),
		...(body.thinking === undefined
			? {}
			: { thinking: readThinking(body.thinking, "thinking") }),
		...(body.contextBudget === undefined
			? {}
			: {
					contextBudget: readContextBudget(body.contextBudget, "contextBudget"),
				}),
		...(body.compactionThreshold === undefined
			? {}
			: {
					compactionThreshold: readCompactionThreshold(
						body.compactionThreshold,
						"compactionThreshold",
					),
				}),
	};
	const conversation = options.store.createAssistantConversation(request);
	sendJson(res, 201, toConversationView(conversation));
}

function handleConversationDetail(
	res: ServerResponse,
	options: AssistantRouteOptions,
	id: string,
): void {
	const conversation = requireConversation(options.store, id);
	const body: AssistantConversationDetailView = {
		conversation: toConversationView(conversation),
		messages: options.store.getAssistantMessages(id),
	};
	sendJson(res, 200, body);
}

async function handleConversationUpdate(
	req: IncomingMessage,
	res: ServerResponse,
	options: AssistantRouteOptions,
	id: string,
): Promise<void> {
	requireConversation(options.store, id);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, [
		"title",
		"skill",
		"permission",
		"modelAlias",
		"thinking",
		"contextBudget",
		"compactionThreshold",
	]);
	const update: {
		title?: string;
		skill?: AssistantSkillId;
		permission?: AssistantPermission;
		modelAlias?: string | null;
		thinking?: AssistantThinking;
		contextBudget?: number;
		compactionThreshold?: number;
	} = {};
	if (body.title !== undefined) update.title = requireText(body.title, "title");
	if (body.skill !== undefined) {
		if (!isAssistantSkillId(body.skill)) {
			throw fieldError(
				"skill",
				`skill 必须是已注册的技能 id：${String(body.skill)}`,
			);
		}
		update.skill = body.skill;
	}
	if (body.permission !== undefined) {
		update.permission = readPermission(body.permission, "permission");
	}
	if (body.modelAlias !== undefined) {
		update.modelAlias = readNullableText(body.modelAlias, "modelAlias");
	}
	if (body.thinking !== undefined) {
		update.thinking = readThinking(body.thinking, "thinking");
	}
	if (body.contextBudget !== undefined) {
		update.contextBudget = readContextBudget(
			body.contextBudget,
			"contextBudget",
		);
	}
	if (body.compactionThreshold !== undefined) {
		update.compactionThreshold = readCompactionThreshold(
			body.compactionThreshold,
			"compactionThreshold",
		);
	}
	if (Object.keys(update).length === 0) {
		throw fieldError("body", "更新至少需要一个字段");
	}
	const request: UpdateAssistantConversationRequest = update;
	const conversation = options.store.updateAssistantConversation(id, request);
	sendJson(res, 200, toConversationView(conversation));
}

function handleConversationDelete(
	res: ServerResponse,
	options: AssistantRouteOptions,
	id: string,
): void {
	requireConversation(options.store, id);
	options.store.deleteAssistantConversation(id);
	sendEmpty(res, 204);
}

function handleConversationStatus(
	res: ServerResponse,
	options: AssistantRouteOptions,
	id: string,
): void {
	const conversation = requireConversation(options.store, id);
	const body: AssistantConversationStatusView = {
		conversationId: conversation.id,
		status: conversation.status,
		lastEventSeq: options.store.countAssistantEvents(id),
		updatedAt: conversation.updatedAt,
		lastMessageAt: conversation.lastMessageAt,
	};
	sendJson(res, 200, body);
}

function handleConversationEvents(
	res: ServerResponse,
	url: URL,
	options: AssistantRouteOptions,
	id: string,
): void {
	requireConversation(options.store, id);
	const rawAfter = url.searchParams.get("after");
	let after = 0;
	if (rawAfter !== null && rawAfter.length > 0) {
		if (!/^\d+$/.test(rawAfter)) {
			throw fieldError("after", "after 必须是非负整数");
		}
		after = Number(rawAfter);
	}
	const events = options.store.listAssistantEvents(id, { afterSeq: after });
	const body: AssistantConversationEventsView = {
		conversationId: id,
		after,
		lastSeq: options.store.countAssistantEvents(id),
		events,
	};
	sendJson(res, 200, body);
}

function requireConversation(
	store: StoryStore,
	id: string,
): AssistantConversation {
	const conversation = store.getAssistantConversation(id);
	if (conversation === null) {
		throw new HttpError(404, "not_found", `助手会话不存在：${id}`);
	}
	return conversation;
}

function toConversationView(
	conversation: AssistantConversation,
): AssistantConversationView {
	if (!isAssistantSkillId(conversation.skill)) {
		throw new HttpError(
			500,
			"internal",
			`助手会话 ${conversation.id} 的技能未注册：${conversation.skill}`,
		);
	}
	return {
		id: conversation.id,
		storyId: conversation.storyId,
		skill: conversation.skill,
		title: conversation.title,
		permission: conversation.permission,
		status: conversation.status,
		modelAlias: conversation.modelAlias,
		thinking: conversation.thinking,
		contextBudget: conversation.contextBudget,
		compactionThreshold: conversation.compactionThreshold,
		createdAt: conversation.createdAt,
		updatedAt: conversation.updatedAt,
		lastMessageAt: conversation.lastMessageAt,
	};
}

function assistantPathSegments(pathname: string): string[] {
	const body = pathname.slice(PATH_PREFIX.length);
	if (body.length === 0 || body === "/") return [];
	return body
		.split("/")
		.filter((segment) => segment.length > 0)
		.map((segment) => {
			try {
				return decodeURIComponent(segment);
			} catch {
				throw fieldError("path", "请求路径里的编码不合法");
			}
		});
}

function requireMethod(method: string, allowed: readonly string[]): void {
	if (!allowed.includes(method)) {
		throw new HttpError(405, "bad_request", `不支持的请求方法：${method}`);
	}
}

async function readObjectBody(
	req: IncomingMessage,
	maxJsonBodyBytes: number,
): Promise<Record<string, unknown>> {
	const body = await readJsonBody(req, maxJsonBodyBytes);
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw fieldError("body", "请求体必须是 JSON 对象");
	}
	return body as Record<string, unknown>;
}

function assertKnownKeys(
	object: Record<string, unknown>,
	allowed: readonly string[],
): void {
	for (const key of Object.keys(object)) {
		if (!allowed.includes(key)) {
			throw fieldError(key, `未知字段：${key}`);
		}
	}
}

function requireText(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw fieldError(path, `${path} 必须是非空字符串`);
	}
	return value.trim();
}

function readNullableText(value: unknown, path: string): string | null {
	if (value === null) return null;
	return requireText(value, path);
}

function readStoryIdQuery(url: URL): string | null {
	const value = url.searchParams.get("storyId");
	if (value === null) return null;
	return requireText(value, "storyId");
}

function readLimit(url: URL, defaultValue: number): number {
	const raw = url.searchParams.get("limit");
	if (raw === null || raw.length === 0) return defaultValue;
	if (!/^\d+$/.test(raw)) {
		throw fieldError("limit", "limit 必须是正整数");
	}
	const value = Number(raw);
	if (value < 1 || value > 100) {
		throw fieldError("limit", "limit 必须在 1 到 100 之间");
	}
	return value;
}

function readPermission(value: unknown, path: string): AssistantPermission {
	try {
		assertAssistantPermission(value, path);
		return value;
	} catch (error) {
		throw fieldError(path, errorMessage(error));
	}
}

function readThinking(value: unknown, path: string): AssistantThinking {
	try {
		assertAssistantThinking(value, path);
		return value;
	} catch (error) {
		throw fieldError(path, errorMessage(error));
	}
}

function readContextBudget(value: unknown, path: string): number {
	try {
		assertAssistantContextBudget(value, path);
		return value;
	} catch (error) {
		throw fieldError(path, errorMessage(error));
	}
}

function readCompactionThreshold(value: unknown, path: string): number {
	try {
		assertAssistantCompactionThreshold(value, path);
		return value;
	} catch (error) {
		throw fieldError(path, errorMessage(error));
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function fieldError(path: string, message: string): HttpError {
	return new HttpError(400, "bad_request", message, { path });
}
