import type {
	AssistantConversationDetailView,
	AssistantConversationEventsView,
	AssistantConversationListView,
	AssistantConversationStatusView,
	AssistantConversationView,
	CreateAssistantConversationRequest,
	UpdateAssistantConversationRequest,
} from "@dramaticer/protocol";
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
	): Promise<Response> {
		const init: RequestInit = {
			method,
			credentials: "include",
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
		} catch {
			throw new ApiError(0, { code: "internal", message: "无法连接服务端" });
		}
		if (!response.ok) throw await readApiError(response);
		return response;
	}
}

function conversationPath(id: string): string {
	return `/api/assistant/conversations/${encodeURIComponent(id)}`;
}
