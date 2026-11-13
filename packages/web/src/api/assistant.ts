import type {
	AssistantActionDecisionView,
	AssistantActionListView,
	AssistantActionStatus,
	AssistantCancelView,
	AssistantCompactView,
	AssistantConversationDetailView,
	AssistantConversationEventsView,
	AssistantConversationListView,
	AssistantConversationStatusView,
	AssistantConversationView,
	AssistantSkillListView,
	ChannelsView,
	CompactAssistantConversationRequest,
	CreateAssistantConversationRequest,
	ProposalDecisionAction,
	ProposalDecisionResult,
	RejectAssistantActionRequest,
	SendAssistantMessageRequest,
	StoryProposalsView,
	UpdateAssistantConversationRequest,
} from "@dramaticer/protocol";
import {
	type AssistantSseEvent,
	parseAssistantSseStream,
} from "../assistant/stream";
import { ApiError, type FetchLike, readApiError } from "./client";

export interface AssistantApiClientOptions {
	/** 默认同源；测试与独立部署时可以指向别的地址。 */
	readonly baseUrl?: string;
	readonly fetch?: FetchLike;
}

export interface ListAssistantConversationsOptions {
	readonly query?: string;
	readonly storyId?: string;
	readonly limit?: number;
}

export interface ListAssistantActionsOptions {
	/** 缺省只列待确认动作；`all` 列出全部状态。 */
	readonly status?: AssistantActionStatus | "all";
	readonly storyId?: string;
	readonly conversationId?: string;
	readonly limit?: number;
}

/** 浏览器 fetch 要绑定 window，自己包一层可以安全地当值传递。 */
const defaultFetch: FetchLike = (input, init) => fetch(input, init);

/** `/api/assistant` 的类型化客户端；界面不直接拼请求。 */
export class AssistantApiClient {
	private readonly baseUrl: string;
	private readonly fetchImpl: FetchLike;

	constructor(options: AssistantApiClientOptions = {}) {
		this.baseUrl = options.baseUrl ?? "";
		this.fetchImpl = options.fetch ?? defaultFetch;
	}

	async listConversations(
		options: ListAssistantConversationsOptions = {},
	): Promise<AssistantConversationListView> {
		const query = new URLSearchParams();
		if (options.query !== undefined && options.query.length > 0) {
			query.set("query", options.query);
		}
		if (options.storyId !== undefined) {
			query.set("storyId", options.storyId);
		}
		if (options.limit !== undefined) {
			query.set("limit", String(options.limit));
		}
		const text = query.toString();
		return this.json<AssistantConversationListView>(
			"GET",
			`/api/assistant/conversations${text.length === 0 ? "" : `?${text}`}`,
		);
	}

	async createConversation(
		request: CreateAssistantConversationRequest,
	): Promise<AssistantConversationView> {
		return this.json<AssistantConversationView>(
			"POST",
			"/api/assistant/conversations",
			request,
		);
	}

	async getConversation(id: string): Promise<AssistantConversationDetailView> {
		return this.json<AssistantConversationDetailView>(
			"GET",
			conversationPath(id),
		);
	}

	async updateConversation(
		id: string,
		request: UpdateAssistantConversationRequest,
	): Promise<AssistantConversationView> {
		return this.json<AssistantConversationView>(
			"PATCH",
			conversationPath(id),
			request,
		);
	}

	async deleteConversation(id: string): Promise<void> {
		await this.send("DELETE", conversationPath(id));
	}

	async getStatus(id: string): Promise<AssistantConversationStatusView> {
		return this.json<AssistantConversationStatusView>(
			"GET",
			`${conversationPath(id)}/status`,
		);
	}

	async listSkills(): Promise<AssistantSkillListView> {
		return this.json<AssistantSkillListView>("GET", "/api/assistant/skills");
	}

	/** 模型选择器需要的别名与启用状态；渠道接口本来就只返回脱敏字段。 */
	async getChannels(): Promise<ChannelsView> {
		return this.json<ChannelsView>("GET", "/api/channels");
	}

	async listActions(
		options: ListAssistantActionsOptions = {},
	): Promise<AssistantActionListView> {
		const query = new URLSearchParams();
		if (options.status !== undefined) query.set("status", options.status);
		if (options.storyId !== undefined) query.set("storyId", options.storyId);
		if (options.conversationId !== undefined) {
			query.set("conversationId", options.conversationId);
		}
		if (options.limit !== undefined) query.set("limit", String(options.limit));
		const text = query.toString();
		return this.json<AssistantActionListView>(
			"GET",
			`/api/assistant/actions${text.length === 0 ? "" : `?${text}`}`,
		);
	}

	/** 批准待确认动作；载荷非法时服务端保留待定并返回原因。 */
	async approveAction(id: string): Promise<AssistantActionDecisionView> {
		return this.json<AssistantActionDecisionView>(
			"POST",
			`/api/assistant/actions/${encodeURIComponent(id)}/approve`,
			{},
		);
	}

	async rejectAction(
		id: string,
		reason: string,
	): Promise<AssistantActionDecisionView> {
		const request: RejectAssistantActionRequest = { reason };
		return this.json<AssistantActionDecisionView>(
			"POST",
			`/api/assistant/actions/${encodeURIComponent(id)}/reject`,
			request,
		);
	}

	/** 故事下待批准的台账变更卡；审阅面板与台账页共用同一接口。 */
	async listProposals(
		storyId: string,
		status = "pending",
	): Promise<StoryProposalsView> {
		const query = new URLSearchParams({ status });
		return this.json<StoryProposalsView>(
			"GET",
			`/api/stories/${encodeURIComponent(storyId)}/proposals?${query.toString()}`,
		);
	}

	async decideProposal(
		cardId: string,
		action: ProposalDecisionAction,
	): Promise<ProposalDecisionResult> {
		return this.json<ProposalDecisionResult>(
			"POST",
			`/api/proposals/${encodeURIComponent(cardId)}/${action}`,
		);
	}

	async cancel(id: string): Promise<AssistantCancelView> {
		return this.json<AssistantCancelView>(
			"POST",
			`${conversationPath(id)}/cancel`,
		);
	}

	/** 手动压缩上下文；可以附带一段要求，摘要由会话模型生成。 */
	async compactConversation(
		id: string,
		request: CompactAssistantConversationRequest = {},
	): Promise<AssistantCompactView> {
		return this.json<AssistantCompactView>(
			"POST",
			`${conversationPath(id)}/compact`,
			request,
		);
	}

	/**
	 * 发送一条消息并读取本次运行的 SSE。服务端在客户端断开后继续运行，
	 * 事件已经写库，重连用 `listEvents(id, after)` 续读。
	 */
	async *streamMessage(
		id: string,
		text: string,
		signal?: AbortSignal,
	): AsyncGenerator<AssistantSseEvent> {
		const request: SendAssistantMessageRequest = { text };
		const response = await this.send(
			"POST",
			`${conversationPath(id)}/messages`,
			request,
			signal,
		);
		if (response.body === null) {
			throw new ApiError(0, {
				code: "internal",
				message: "服务端没有返回事件流",
			});
		}
		for await (const event of parseAssistantSseStream(response.body)) {
			yield event;
		}
	}

	async listEvents(
		id: string,
		after = 0,
	): Promise<AssistantConversationEventsView> {
		const query = after > 0 ? `?after=${after}` : "";
		return this.json<AssistantConversationEventsView>(
			"GET",
			`${conversationPath(id)}/events${query}`,
		);
	}

	private async json<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const response = await this.send(method, path, body);
		return (await response.json()) as T;
	}

	private async send(
		method: string,
		path: string,
		body?: unknown,
		signal?: AbortSignal,
	): Promise<Response> {
		const init: RequestInit = {
			method,
			credentials: "include",
			...(signal === undefined ? {} : { signal }),
			...(body === undefined
				? {}
				: {
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(body),
					}),
		};
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") throw error;
			throw new ApiError(0, { code: "internal", message: "无法连接服务端" });
		}
		if (!response.ok) throw await readApiError(response);
		return response;
	}
}

function conversationPath(id: string): string {
	return `/api/assistant/conversations/${encodeURIComponent(id)}`;
}

/** 与认证信息同源的单例；界面共享一个客户端。 */
export const assistantApi = new AssistantApiClient();
