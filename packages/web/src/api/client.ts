import type { NodeImageRecord } from "@dramaticer/core";
import {
	API_ERROR_CODES,
	type ApiErrorBody,
	type ApiErrorResponse,
	type ChannelProbeRequest,
	type ChannelProbeResult,
	type ChannelsUpdateRequest,
	type ChannelsView,
	type ContextTemplateRecord,
	type CreateContextTemplateRequest,
	type CreateStoryRequest,
	type FulfillClueRequest,
	type FulfillClueResult,
	type ImportStoryRequest,
	type ImportStoryResult,
	type NodeActionResult,
	type NodeActionsView,
	type NodeChoiceRequest,
	type NodeChoiceResult,
	type NodeCompressionsView,
	type NodeDirectorView,
	type NodeEventsView,
	type NodeImagesView,
	type NodeLedgerView,
	type NodeTextRequest,
	type ProposalDecisionAction,
	type ProposalDecisionResult,
	SSE_EVENT_NAMES,
	type SetHeadRequest,
	type SseEvent,
	type StoryCluesView,
	type StoryDirectorPlanRequest,
	type StoryDirectorPlanView,
	type StoryEntitiesView,
	type StoryJobsView,
	type StoryLoreView,
	type StoryOpeningGenerateResult,
	type StoryOpeningPickResult,
	type StoryOpeningsView,
	type StoryPath,
	type StoryProposalsView,
	type StorySettings,
	type StorySettingsUpdate,
	type StoryTemplateView,
	type StoryTree,
	type StoryView,
	type TurnCompletedPayload,
	type TurnRequest,
	type UpdateContextTemplateRequest,
	type UpdateStoryRequest,
} from "@dramaticer/protocol";
import { parseSseStream } from "./sse";

export interface HealthView {
	readonly status: string;
	readonly version: string;
	readonly schemaVersion: number;
}

export interface StoryPathOptions {
	readonly nodeId?: string;
	readonly limit?: number;
	readonly before?: string;
}

export interface NodeEventsOptions {
	readonly limit?: number;
	readonly offset?: number;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
	/** 默认同源；测试与独立部署时可以指向别的地址。 */
	readonly baseUrl?: string;
	readonly fetch?: FetchLike;
}

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly body: ApiErrorBody,
	) {
		super(body.message);
		this.name = "ApiError";
	}
}

/** 浏览器 fetch 要绑定 window，自己包一层可以安全地当值传递。 */
const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export class ApiClient {
	private readonly baseUrl: string;
	private readonly fetchImpl: FetchLike;

	constructor(options: ApiClientOptions = {}) {
		this.baseUrl = options.baseUrl ?? "";
		this.fetchImpl = options.fetch ?? defaultFetch;
	}

	async health(): Promise<HealthView> {
		return this.json<HealthView>("GET", "/api/health");
	}

	async login(password: string): Promise<void> {
		await this.send("POST", "/api/login", { password });
	}

	async listStories(): Promise<readonly StoryView[]> {
		return this.json<readonly StoryView[]>("GET", "/api/stories");
	}

	async createStory(request: CreateStoryRequest): Promise<StoryView> {
		return this.json<StoryView>("POST", "/api/stories", request);
	}

	async getStory(storyId: string): Promise<StoryView> {
		return this.json<StoryView>("GET", storyPath(storyId));
	}

	async updateStory(
		storyId: string,
		request: UpdateStoryRequest,
	): Promise<StoryView> {
		return this.json<StoryView>("PATCH", storyPath(storyId), request);
	}

	async importCard(
		storyId: string,
		request: ImportStoryRequest,
	): Promise<ImportStoryResult> {
		return this.json<ImportStoryResult>(
			"POST",
			`${storyPath(storyId)}/import`,
			request,
		);
	}

	async getJobs(storyId: string): Promise<StoryJobsView> {
		return this.json<StoryJobsView>("GET", `${storyPath(storyId)}/jobs`);
	}

	async getTree(storyId: string): Promise<StoryTree> {
		return this.json<StoryTree>("GET", `${storyPath(storyId)}/tree`);
	}

	async getPath(
		storyId: string,
		options: StoryPathOptions = {},
	): Promise<StoryPath> {
		const query = new URLSearchParams();
		if (options.nodeId !== undefined) query.set("nodeId", options.nodeId);
		if (options.limit !== undefined) query.set("limit", String(options.limit));
		if (options.before !== undefined) query.set("before", options.before);
		return this.json<StoryPath>(
			"GET",
			`${storyPath(storyId)}/path${queryText(query)}`,
		);
	}

	async setHead(storyId: string, nodeId: string): Promise<StoryPath> {
		const request: SetHeadRequest = { nodeId };
		return this.json<StoryPath>("POST", `${storyPath(storyId)}/head`, request);
	}

	async getSettings(storyId: string): Promise<StorySettings> {
		return this.json<StorySettings>("GET", `${storyPath(storyId)}/settings`);
	}

	async updateSettings(
		storyId: string,
		update: StorySettingsUpdate,
	): Promise<StorySettings> {
		return this.json<StorySettings>(
			"PUT",
			`${storyPath(storyId)}/settings`,
			update,
		);
	}

	async getStoryTemplate(storyId: string): Promise<StoryTemplateView> {
		return this.json<StoryTemplateView>(
			"GET",
			`${storyPath(storyId)}/template`,
		);
	}

	async listTemplates(): Promise<readonly ContextTemplateRecord[]> {
		return this.json<readonly ContextTemplateRecord[]>("GET", "/api/templates");
	}

	async createTemplate(
		request: CreateContextTemplateRequest,
	): Promise<ContextTemplateRecord> {
		return this.json<ContextTemplateRecord>("POST", "/api/templates", request);
	}

	async getTemplate(templateId: string): Promise<ContextTemplateRecord> {
		return this.json<ContextTemplateRecord>(
			"GET",
			`/api/templates/${encodeURIComponent(templateId)}`,
		);
	}

	async updateTemplate(
		templateId: string,
		request: UpdateContextTemplateRequest,
	): Promise<ContextTemplateRecord> {
		return this.json<ContextTemplateRecord>(
			"PUT",
			`/api/templates/${encodeURIComponent(templateId)}`,
			request,
		);
	}

	async deleteTemplate(templateId: string): Promise<void> {
		await this.send(
			"DELETE",
			`/api/templates/${encodeURIComponent(templateId)}`,
		);
	}

	async getClues(storyId: string): Promise<StoryCluesView> {
		return this.json<StoryCluesView>("GET", `${storyPath(storyId)}/clues`);
	}

	async fulfillClue(
		clueId: string,
		request: FulfillClueRequest,
	): Promise<FulfillClueResult> {
		return this.json<FulfillClueResult>(
			"POST",
			`/api/clues/${encodeURIComponent(clueId)}/fulfill`,
			request,
		);
	}

	async getEntities(storyId: string): Promise<StoryEntitiesView> {
		return this.json<StoryEntitiesView>(
			"GET",
			`${storyPath(storyId)}/entities`,
		);
	}

	async getLore(storyId: string): Promise<StoryLoreView> {
		return this.json<StoryLoreView>("GET", `${storyPath(storyId)}/lore`);
	}

	async getProposals(
		storyId: string,
		status?: string,
	): Promise<StoryProposalsView> {
		const query = new URLSearchParams();
		if (status !== undefined) query.set("status", status);
		return this.json<StoryProposalsView>(
			"GET",
			`${storyPath(storyId)}/proposals${queryText(query)}`,
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

	async getOpenings(
		storyId: string,
		status?: StoryOpeningsView["status"],
	): Promise<StoryOpeningsView> {
		const query = new URLSearchParams();
		if (status !== undefined) query.set("status", status);
		return this.json<StoryOpeningsView>(
			"GET",
			`${storyPath(storyId)}/openings${queryText(query)}`,
		);
	}

	async generateOpenings(storyId: string): Promise<StoryOpeningGenerateResult> {
		return this.json<StoryOpeningGenerateResult>(
			"POST",
			`${storyPath(storyId)}/openings/generate`,
		);
	}

	async pickOpening(
		storyId: string,
		candidateId: string,
	): Promise<StoryOpeningPickResult> {
		return this.json<StoryOpeningPickResult>(
			"POST",
			`${storyPath(storyId)}/openings/${encodeURIComponent(candidateId)}/pick`,
		);
	}

	async getDirectorPlan(storyId: string): Promise<StoryDirectorPlanView> {
		return this.json<StoryDirectorPlanView>(
			"GET",
			`${storyPath(storyId)}/director/plan`,
		);
	}

	async updateDirectorPlan(
		storyId: string,
		request: StoryDirectorPlanRequest,
	): Promise<StoryDirectorPlanView> {
		return this.json<StoryDirectorPlanView>(
			"PUT",
			`${storyPath(storyId)}/director/plan`,
			request,
		);
	}

	async swipeNode(
		nodeId: string,
		request: NodeTextRequest,
	): Promise<NodeActionResult> {
		return this.json<NodeActionResult>(
			"POST",
			`${nodePath(nodeId)}/swipe`,
			request,
		);
	}

	async editNode(
		nodeId: string,
		request: NodeTextRequest,
	): Promise<NodeActionResult> {
		return this.json<NodeActionResult>(
			"POST",
			`${nodePath(nodeId)}/edit`,
			request,
		);
	}

	async recordChoice(
		nodeId: string,
		request: NodeChoiceRequest,
	): Promise<NodeChoiceResult> {
		return this.json<NodeChoiceResult>(
			"POST",
			`${nodePath(nodeId)}/choice`,
			request,
		);
	}

	async getTrace(nodeId: string): Promise<TurnCompletedPayload["trace"]> {
		return this.json<TurnCompletedPayload["trace"]>(
			"GET",
			`${nodePath(nodeId)}/trace`,
		);
	}

	async getLedger(nodeId: string): Promise<NodeLedgerView> {
		return this.json<NodeLedgerView>("GET", `${nodePath(nodeId)}/ledger`);
	}

	async getEvents(
		nodeId: string,
		options: NodeEventsOptions = {},
	): Promise<NodeEventsView> {
		const query = new URLSearchParams();
		if (options.limit !== undefined) query.set("limit", String(options.limit));
		if (options.offset !== undefined) {
			query.set("offset", String(options.offset));
		}
		return this.json<NodeEventsView>(
			"GET",
			`${nodePath(nodeId)}/events${queryText(query)}`,
		);
	}

	async getCompressions(nodeId: string): Promise<NodeCompressionsView> {
		return this.json<NodeCompressionsView>(
			"GET",
			`${nodePath(nodeId)}/compressions`,
		);
	}

	async getDirector(nodeId: string): Promise<NodeDirectorView> {
		return this.json<NodeDirectorView>("GET", `${nodePath(nodeId)}/director`);
	}

	async getActions(nodeId: string): Promise<NodeActionsView> {
		return this.json<NodeActionsView>("GET", `${nodePath(nodeId)}/actions`);
	}

	async getNodeImages(nodeId: string): Promise<NodeImagesView> {
		return this.json<NodeImagesView>("GET", `${nodePath(nodeId)}/images`);
	}

	async retryImage(imageId: string): Promise<NodeImageRecord> {
		return this.json<NodeImageRecord>(
			"POST",
			`/api/images/${encodeURIComponent(imageId)}/retry`,
		);
	}

	async getChannels(): Promise<ChannelsView> {
		return this.json<ChannelsView>("GET", "/api/channels");
	}

	async updateChannels(request: ChannelsUpdateRequest): Promise<ChannelsView> {
		return this.json<ChannelsView>("PUT", "/api/channels", request);
	}

	async probeChannel(
		request: ChannelProbeRequest,
	): Promise<ChannelProbeResult> {
		return this.json<ChannelProbeResult>(
			"POST",
			"/api/channels/probe",
			request,
		);
	}

	async *streamTurn(
		storyId: string,
		request: TurnRequest,
		signal?: AbortSignal,
	): AsyncGenerator<SseEvent> {
		yield* this.stream(`${storyPath(storyId)}/turns`, request, signal);
	}

	async *streamRegenerate(
		nodeId: string,
		signal?: AbortSignal,
	): AsyncGenerator<SseEvent> {
		yield* this.stream(`${nodePath(nodeId)}/regenerate`, undefined, signal);
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
			if (isAbortError(error)) throw error;
			throw new ApiError(0, { code: "internal", message: "无法连接服务端" });
		}
		if (!response.ok) throw await readApiError(response);
		return response;
	}

	private async *stream(
		path: string,
		body: unknown,
		signal?: AbortSignal,
	): AsyncGenerator<SseEvent> {
		const response = await this.send("POST", path, body, signal);
		if (response.body === null) {
			throw new ApiError(0, {
				code: "internal",
				message: "服务端没有返回事件流",
			});
		}
		for await (const event of parseSseStream(response.body)) {
			if (event.event === SSE_EVENT_NAMES.turnError) {
				throw new ApiError(0, event.data);
			}
			yield event;
		}
	}
}

function storyPath(storyId: string): string {
	return `/api/stories/${encodeURIComponent(storyId)}`;
}

function nodePath(nodeId: string): string {
	return `/api/nodes/${encodeURIComponent(nodeId)}`;
}

function queryText(query: URLSearchParams): string {
	const text = query.toString();
	return text.length === 0 ? "" : `?${text}`;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

async function readApiError(response: Response): Promise<ApiError> {
	const fallback: ApiErrorBody = {
		code: "internal",
		message: `请求失败（HTTP ${response.status}）`,
	};
	try {
		const parsed: unknown = await response.json();
		if (isApiErrorResponse(parsed)) {
			return new ApiError(response.status, parsed.error);
		}
	} catch {
		// 错误响应不是 JSON 时保留状态码信息。
	}
	return new ApiError(response.status, fallback);
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
	if (typeof value !== "object" || value === null || !("error" in value)) {
		return false;
	}
	const error = value.error;
	if (
		typeof error !== "object" ||
		error === null ||
		!("code" in error) ||
		!("message" in error)
	) {
		return false;
	}
	return (
		typeof error.message === "string" &&
		typeof error.code === "string" &&
		(API_ERROR_CODES as readonly string[]).includes(error.code)
	);
}
