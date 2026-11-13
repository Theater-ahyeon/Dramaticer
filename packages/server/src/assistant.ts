import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type AssistantAction,
	AssistantActionError,
	AssistantActionPayloadError,
	type AssistantConversation,
	AssistantConversationHasPendingActionsError,
	type AssistantDocsIndex,
	type AssistantEvent,
	type JsonObject,
	type JsonValue,
	type StoryStore,
	approveAssistantAction,
	assertAssistantCompactionThreshold,
	assertAssistantContextBudget,
	assertAssistantConversationStatus,
	assertAssistantPermission,
	assertAssistantThinking,
	assertJsonValue,
	buildAssistantSystemPrompt,
	createDocsSearchTool,
	getAssistantSkill,
	isAssistantActionStatus,
	isDeepTurnStopReason,
	isJsonObject,
	listAssistantSkills,
	rejectAssistantAction,
	runAssistantTurn,
} from "@dramaticer/core";
import {
	ASSISTANT_SSE_EVENT_NAMES,
	type AssistantActionDecisionView,
	type AssistantActionListView,
	type AssistantCancelView,
	type AssistantCompletedPayload,
	type AssistantConversationDetailView,
	type AssistantConversationEventsView,
	type AssistantConversationListView,
	type AssistantConversationStatusView,
	type AssistantConversationView,
	type AssistantErrorPayload,
	type AssistantPermission,
	type AssistantPermissionDeniedPayload,
	type AssistantSkillId,
	type AssistantSkillListView,
	type AssistantSseEventMap,
	type AssistantStartedPayload,
	type AssistantTextDeltaPayload,
	type AssistantThinking,
	type AssistantThinkingDeltaPayload,
	type AssistantToolCallPayload,
	type AssistantToolResultPayload,
	type AssistantUsagePayload,
	type CreateAssistantConversationRequest,
	type RejectAssistantActionRequest,
	type UpdateAssistantConversationRequest,
	isAssistantSkillId,
} from "@dramaticer/protocol";
import type {
	AssistantRuntime,
	AssistantRuntimeManager,
} from "./assistant-runtime.js";
import { HttpError, readJsonBody, sendEmpty, sendJson } from "./http.js";
import { type SseStream, createSseStream } from "./sse.js";

export interface AssistantRouteOptions {
	readonly store: StoryStore;
	readonly maxJsonBodyBytes: number;
	/** 没有配置渠道时为 null，助手消息接口返回 500。 */
	readonly runtime: AssistantRuntimeManager | null;
	readonly runs: AssistantRunCoordinator;
	readonly docsIndex: AssistantDocsIndex;
	readonly heartbeatMs: number;
	/** 批准渠道动作时调用；没有渠道文件时为 null。 */
	readonly applyChannelsAction?: (payload: JsonObject) => Promise<void>;
	readonly now?: () => number;
	readonly log: (line: string) => void;
}

/** 同一助手会话同时只允许一次运行；取消用它找到正在执行的那一次。 */
export interface AssistantRunTicket {
	readonly signal: AbortSignal;
	abort(reason?: unknown): void;
	release(): void;
	/** 运行结束（无论成功、失败或取消）时完成。 */
	readonly done: Promise<void>;
}

interface ActiveAssistantRun {
	readonly controller: AbortController;
	readonly finished: Promise<void>;
}

export class AssistantRunCoordinator {
	readonly #active = new Map<string, ActiveAssistantRun>();

	begin(conversationId: string): AssistantRunTicket | null {
		if (this.#active.has(conversationId)) return null;
		const controller = new AbortController();
		const finished = Promise.withResolvers<void>();
		this.#active.set(conversationId, {
			controller,
			finished: finished.promise,
		});
		let released = false;
		return {
			signal: controller.signal,
			abort: (reason?: unknown) => {
				if (!controller.signal.aborted) controller.abort(reason);
			},
			release: () => {
				if (released) return;
				released = true;
				this.#active.delete(conversationId);
				finished.resolve();
			},
			done: finished.promise,
		};
	}

	get(conversationId: string): AssistantRunTicket | null {
		const run = this.#active.get(conversationId);
		if (run === undefined) return null;
		return {
			signal: run.controller.signal,
			abort: (reason?: unknown) => {
				if (!run.controller.signal.aborted) run.controller.abort(reason);
			},
			release: () => {},
			done: run.finished,
		};
	}

	/** 服务端关闭时中止全部助手运行，并等它们写完状态。 */
	async abortAll(reason: unknown = new Error("服务端关闭")): Promise<void> {
		const runs = [...this.#active.values()];
		for (const run of runs) {
			if (!run.controller.signal.aborted) run.controller.abort(reason);
		}
		await Promise.all(runs.map((run) => run.finished));
	}
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
	if (collection === "skills") {
		if (id !== undefined) {
			throw new HttpError(404, "not_found", "没有这个接口");
		}
		requireMethod(method, ["GET"]);
		handleSkillList(res);
		return;
	}
	if (collection === "actions") {
		if (id === undefined) {
			requireMethod(method, ["GET"]);
			handleActionList(res, url, options);
			return;
		}
		if (action === "approve") {
			requireMethod(method, ["POST"]);
			await handleActionApprove(req, res, options, id);
			return;
		}
		if (action === "reject") {
			requireMethod(method, ["POST"]);
			await handleActionReject(req, res, options, id);
			return;
		}
		throw new HttpError(404, "not_found", "没有这个接口");
	}
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
	if (action === "messages") {
		requireMethod(method, ["POST"]);
		await handleConversationMessage(req, res, options, id);
		return;
	}
	if (action === "cancel") {
		requireMethod(method, ["POST"]);
		await handleConversationCancel(res, options, id);
		return;
	}
	throw new HttpError(404, "not_found", "没有这个接口");
}

function handleSkillList(res: ServerResponse): void {
	const body: AssistantSkillListView = {
		skills: listAssistantSkills().map((skill) => ({
			id: skill.id,
			name: skill.name,
			description: skill.description,
			defaultPermission: skill.defaultPermission,
			tools: [...skill.toolNames],
		})),
	};
	sendJson(res, 200, body);
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
	if (
		!isAssistantSkillId(body.skill) ||
		getAssistantSkill(body.skill) === null
	) {
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
		if (
			!isAssistantSkillId(body.skill) ||
			getAssistantSkill(body.skill) === null
		) {
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
	try {
		options.store.deleteAssistantConversation(id);
	} catch (error) {
		if (error instanceof AssistantConversationHasPendingActionsError) {
			throw new HttpError(409, "conflict", error.message, {
				pendingActions: error.pendingCount,
			});
		}
		throw error;
	}
	sendEmpty(res, 204);
}

function handleActionList(
	res: ServerResponse,
	url: URL,
	options: AssistantRouteOptions,
): void {
	const rawStatus = url.searchParams.get("status");
	const status =
		rawStatus === null || rawStatus === "pending"
			? "pending"
			: rawStatus === "all"
				? undefined
				: rawStatus;
	if (status !== undefined && !isAssistantActionStatus(status)) {
		throw fieldError(
			"status",
			"status 只能是 all、pending、approved 或 rejected",
		);
	}
	const storyId = url.searchParams.get("storyId") ?? undefined;
	if (storyId !== undefined && options.store.getStory(storyId) === null) {
		throw new HttpError(404, "not_found", `故事不存在：${storyId}`, {
			path: "storyId",
		});
	}
	const conversationId = url.searchParams.get("conversationId") ?? undefined;
	if (
		conversationId !== undefined &&
		options.store.getAssistantConversation(conversationId) === null
	) {
		throw new HttpError(404, "not_found", `助手会话不存在：${conversationId}`, {
			path: "conversationId",
		});
	}
	const actions = options.store.listAssistantActions({
		...(conversationId === undefined ? {} : { conversationId }),
		...(storyId === undefined ? {} : { storyId }),
		...(status === undefined ? {} : { status }),
		limit: readLimit(url, 50),
	});
	const body: AssistantActionListView = { actions };
	sendJson(res, 200, body);
}

async function handleActionApprove(
	req: IncomingMessage,
	res: ServerResponse,
	options: AssistantRouteOptions,
	id: string,
): Promise<void> {
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, []);
	let action: AssistantAction;
	try {
		action = await approveAssistantAction(options.store, id, {
			...(options.applyChannelsAction === undefined
				? {}
				: { applyChannels: options.applyChannelsAction }),
		});
	} catch (error) {
		throw toActionDecisionError(error);
	}
	const view: AssistantActionDecisionView = { action };
	sendJson(res, 200, view);
}

async function handleActionReject(
	req: IncomingMessage,
	res: ServerResponse,
	options: AssistantRouteOptions,
	id: string,
): Promise<void> {
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["reason"]);
	const request: RejectAssistantActionRequest = {
		reason: requireText(body.reason, "reason"),
	};
	let action: AssistantAction;
	try {
		action = rejectAssistantAction(options.store, id, request.reason);
	} catch (error) {
		throw toActionDecisionError(error);
	}
	const view: AssistantActionDecisionView = { action };
	sendJson(res, 200, view);
}

/** 动作不存在映射 404、已决定映射 409、载荷非法映射 400；都保留原状态。 */
function toActionDecisionError(error: unknown): HttpError {
	if (error instanceof HttpError) return error;
	if (error instanceof AssistantActionError) {
		return error.code === "not_found"
			? new HttpError(404, "not_found", error.message)
			: new HttpError(409, "conflict", error.message);
	}
	if (error instanceof AssistantActionPayloadError) {
		return new HttpError(400, "bad_request", error.message);
	}
	return new HttpError(
		400,
		"bad_request",
		error instanceof Error ? error.message : String(error),
	);
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

/**
 * `POST /api/assistant/conversations/:id/messages` 的 SSE 实现：运行一次
 * 助手回合，事件按 `assistant.*` 名字推送。客户端断开不中止运行，
 * 事件仍然写入数据库，重连后用 `events?after=` 续读。
 */
async function handleConversationMessage(
	req: IncomingMessage,
	res: ServerResponse,
	options: AssistantRouteOptions,
	id: string,
): Promise<void> {
	const conversation = requireConversation(options.store, id);
	const skill = getAssistantSkill(conversation.skill);
	if (skill === null) {
		throw new HttpError(
			500,
			"internal",
			`助手会话 ${id} 的技能未注册：${conversation.skill}`,
		);
	}
	if (conversation.status === "running") {
		throw new HttpError(409, "conflict", `助手会话正在运行：${id}`);
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["text"]);
	const text = requireText(body.text, "text");
	if (options.runtime === null) {
		throw new HttpError(500, "internal", "服务端没有配置渠道");
	}
	let runtime: AssistantRuntime;
	try {
		runtime = await options.runtime.get(conversation);
	} catch (error) {
		throw fieldError("modelAlias", errorMessage(error));
	}
	const ticket = options.runs.begin(id);
	if (ticket === null) {
		throw new HttpError(409, "conflict", `助手会话正在运行：${id}`);
	}
	let clientGone = false;
	const sse = createSseStream<AssistantSseEventMap>(res);
	const heartbeat = setInterval(
		() => sse.comment("ping"),
		Math.max(1, options.heartbeatMs),
	);
	heartbeat.unref();
	const onClose = (): void => {
		clientGone = true;
	};
	res.once("close", onClose);
	try {
		await runAssistantTurn({
			store: options.store,
			client: runtime.client,
			conversationId: id,
			userText: text,
			systemPrompt: buildAssistantSystemPrompt({
				skill: skill.id,
				instructions: skill.instructions,
			}),
			toolNames: skill.toolNames,
			extraTools: [createDocsSearchTool(options.docsIndex)],
			model: runtime.modelAlias,
			maxTokens: runtime.maxTokens,
			toolTransport: runtime.toolTransport,
			reasoning: conversation.thinking,
			contextBudget: conversation.contextBudget,
			embedder: runtime.embedder,
			reranker: runtime.reranker,
			signal: ticket.signal,
			onEvent: (event) => {
				if (clientGone) return;
				sendAssistantEvent(sse, toAssistantSseEvent(event));
			},
			now: options.now,
		});
	} catch (error) {
		if (!clientGone) {
			sse.send(ASSISTANT_SSE_EVENT_NAMES.error, {
				message: errorMessage(error),
			});
		}
		options.log(
			`助手运行失败：${error instanceof Error ? error.name : "未知错误"}`,
		);
	} finally {
		clearInterval(heartbeat);
		res.off("close", onClose);
		ticket.release();
		sse.close();
	}
}

/**
 * `POST /api/assistant/conversations/:id/cancel`：中止正在运行的助手回合，
 * 等它把状态写成 cancelled 之后再返回实际状态。
 */
async function handleConversationCancel(
	res: ServerResponse,
	options: AssistantRouteOptions,
	id: string,
): Promise<void> {
	requireConversation(options.store, id);
	const ticket = options.runs.get(id);
	if (ticket === null) {
		throw new HttpError(409, "conflict", `助手会话没有正在运行的任务：${id}`);
	}
	ticket.abort(new Error("玩家取消"));
	await ticket.done;
	const updated = requireConversation(options.store, id);
	const body: AssistantCancelView = {
		conversationId: id,
		status: updated.status,
	};
	sendJson(res, 200, body);
}

type AssistantSseEvent =
	| {
			readonly event: typeof ASSISTANT_SSE_EVENT_NAMES.started;
			readonly data: AssistantStartedPayload;
	  }
	| {
			readonly event: typeof ASSISTANT_SSE_EVENT_NAMES.textDelta;
			readonly data: AssistantTextDeltaPayload;
	  }
	| {
			readonly event: typeof ASSISTANT_SSE_EVENT_NAMES.thinkingDelta;
			readonly data: AssistantThinkingDeltaPayload;
	  }
	| {
			readonly event: typeof ASSISTANT_SSE_EVENT_NAMES.toolCall;
			readonly data: AssistantToolCallPayload;
	  }
	| {
			readonly event: typeof ASSISTANT_SSE_EVENT_NAMES.toolResult;
			readonly data: AssistantToolResultPayload;
	  }
	| {
			readonly event: typeof ASSISTANT_SSE_EVENT_NAMES.permissionDenied;
			readonly data: AssistantPermissionDeniedPayload;
	  }
	| {
			readonly event: typeof ASSISTANT_SSE_EVENT_NAMES.usage;
			readonly data: AssistantUsagePayload;
	  }
	| {
			readonly event: typeof ASSISTANT_SSE_EVENT_NAMES.completed;
			readonly data: AssistantCompletedPayload;
	  }
	| {
			readonly event: typeof ASSISTANT_SSE_EVENT_NAMES.error;
			readonly data: AssistantErrorPayload;
	  };

/** 把库里的事件转成 SSE 帧；载荷形状不对时直接失败，不发送半截数据。 */
function toAssistantSseEvent(event: AssistantEvent): AssistantSseEvent {
	const payload = event.payload;
	switch (event.kind) {
		case "started":
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.started,
				data: {
					conversationId: readPayloadString(payload, "conversationId"),
					skill: readPayloadString(payload, "skill"),
				},
			};
		case "text.delta":
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.textDelta,
				data: { delta: readPayloadString(payload, "delta") },
			};
		case "thinking.delta":
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.thinkingDelta,
				data: { delta: readPayloadString(payload, "delta") },
			};
		case "tool.call": {
			const args = payload.arguments;
			if (!isJsonObject(args)) {
				throw new Error("助手 tool.call 事件的 arguments 必须是 JSON 对象");
			}
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.toolCall,
				data: {
					name: readPayloadString(payload, "name"),
					arguments: args,
				},
			};
		}
		case "tool.result": {
			const ok = payload.ok;
			if (typeof ok !== "boolean") {
				throw new Error("助手 tool.result 事件的 ok 必须是布尔值");
			}
			const result = payload.result;
			if (result === undefined) {
				throw new Error("助手 tool.result 事件缺少 result");
			}
			assertJsonValue(result, "助手 tool.result 事件的 result");
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.toolResult,
				data: {
					name: readPayloadString(payload, "name"),
					ok,
					result,
				},
			};
		}
		case "permission.denied":
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.permissionDenied,
				data: {
					name: readPayloadString(payload, "name"),
					permission: readPayloadString(payload, "permission"),
					reason: readPayloadString(payload, "reason"),
				},
			};
		case "usage": {
			const usage = payload.usage;
			if (usage === undefined) {
				throw new Error("助手 usage 事件缺少 usage");
			}
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.usage,
				data: { usage: toLlmUsage(usage) },
			};
		}
		case "completed": {
			const status = payload.status;
			assertAssistantConversationStatus(status, "助手 completed 事件的状态");
			const stopReason = payload.stopReason;
			if (!isDeepTurnStopReason(stopReason)) {
				throw new Error(
					`助手 completed 事件的 stopReason 不合法：${String(stopReason)}`,
				);
			}
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.completed,
				data: { status, stopReason },
			};
		}
		case "error":
			return {
				event: ASSISTANT_SSE_EVENT_NAMES.error,
				data: { message: readPayloadString(payload, "message") },
			};
	}
}

function sendAssistantEvent(
	sse: SseStream<AssistantSseEventMap>,
	event: AssistantSseEvent,
): void {
	switch (event.event) {
		case ASSISTANT_SSE_EVENT_NAMES.started:
			sse.send(event.event, event.data);
			return;
		case ASSISTANT_SSE_EVENT_NAMES.textDelta:
			sse.send(event.event, event.data);
			return;
		case ASSISTANT_SSE_EVENT_NAMES.thinkingDelta:
			sse.send(event.event, event.data);
			return;
		case ASSISTANT_SSE_EVENT_NAMES.toolCall:
			sse.send(event.event, event.data);
			return;
		case ASSISTANT_SSE_EVENT_NAMES.toolResult:
			sse.send(event.event, event.data);
			return;
		case ASSISTANT_SSE_EVENT_NAMES.permissionDenied:
			sse.send(event.event, event.data);
			return;
		case ASSISTANT_SSE_EVENT_NAMES.usage:
			sse.send(event.event, event.data);
			return;
		case ASSISTANT_SSE_EVENT_NAMES.completed:
			sse.send(event.event, event.data);
			return;
		case ASSISTANT_SSE_EVENT_NAMES.error:
			sse.send(event.event, event.data);
			return;
	}
}

function readPayloadString(payload: JsonObject, key: string): string {
	const value = payload[key];
	if (typeof value !== "string") {
		throw new Error(`助手事件载荷的 ${key} 必须是字符串`);
	}
	return value;
}

function toLlmUsage(value: JsonValue): {
	readonly promptTokens: number | null;
	readonly completionTokens: number | null;
	readonly totalTokens: number | null;
	readonly reasoningTokens: number | null;
	readonly cachedTokens: number | null;
} {
	if (!isJsonObject(value)) {
		throw new Error("助手 usage 事件的 usage 必须是 JSON 对象");
	}
	return {
		promptTokens: readNullableNumber(value, "promptTokens"),
		completionTokens: readNullableNumber(value, "completionTokens"),
		totalTokens: readNullableNumber(value, "totalTokens"),
		reasoningTokens: readNullableNumber(value, "reasoningTokens"),
		cachedTokens: readNullableNumber(value, "cachedTokens"),
	};
}

function readNullableNumber(payload: JsonObject, key: string): number | null {
	const value = payload[key];
	if (value === null || value === undefined) return null;
	if (typeof value !== "number") {
		throw new Error(`助手事件载荷的 ${key} 必须是数字或 null`);
	}
	return value;
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
	if (
		!isAssistantSkillId(conversation.skill) ||
		getAssistantSkill(conversation.skill) === null
	) {
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
