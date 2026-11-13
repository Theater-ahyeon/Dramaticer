import type {
	AssistantActionListView,
	AssistantCancelView,
	AssistantCompactView,
	AssistantConversationDetailView,
	AssistantConversationEventsView,
	AssistantConversationListView,
	AssistantConversationStatusView,
	AssistantConversationView,
	AssistantSkillListView,
} from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import {
	AssistantApiClient,
	type ListAssistantConversationsOptions,
} from "../src/api/assistant.js";
import { ApiError, type FetchLike } from "../src/api/client.js";

const conversation: AssistantConversationView = {
	id: "c-1",
	storyId: "story-1",
	skill: "troubleshoot",
	title: "排障",
	permission: "confirm",
	status: "idle",
	modelAlias: null,
	thinking: "off",
	contextBudget: 48_000,
	compactionThreshold: 0.8,
	createdAt: "2026-11-13T01:00:00.000Z",
	updatedAt: "2026-11-13T01:00:00.000Z",
	lastMessageAt: null,
};

interface Call {
	readonly url: string;
	readonly init: RequestInit;
}

function stubFetch(respond: (call: Call) => Response): {
	fetchImpl: FetchLike;
	calls: Call[];
} {
	const calls: Call[] = [];
	const fetchImpl: FetchLike = async (url, init) => {
		const call = { url, init };
		calls.push(call);
		return respond(call);
	};
	return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("助手接口客户端", () => {
	it("列表请求带上查询、故事与条数", async () => {
		const body: AssistantConversationListView = {
			conversations: [conversation],
			matches: [
				{
					matchedIn: "title",
					snippet: "[排障]",
					messageOrdinal: null,
					score: 0,
				},
			],
		};
		const { fetchImpl, calls } = stubFetch(() => jsonResponse(body));
		const client = new AssistantApiClient({
			baseUrl: "http://localhost:8787",
			fetch: fetchImpl,
		});
		const options: ListAssistantConversationsOptions = {
			query: "排障",
			storyId: "story-1",
			limit: 5,
		};
		await expect(client.listConversations(options)).resolves.toEqual(body);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.init.method).toBe("GET");
		expect(calls[0]?.url).toBe(
			"http://localhost:8787/api/assistant/conversations?query=%E6%8E%92%E9%9A%9C&storyId=story-1&limit=5",
		);
	});

	it("创建、读取、修改、删除与状态、事件都打到对应路径", async () => {
		const detail: AssistantConversationDetailView = {
			conversation,
			messages: [],
			compaction: null,
			context: {
				used: 120,
				budget: conversation.contextBudget,
				percent: 120 / conversation.contextBudget,
				parts: [
					{ id: "system", tokens: 80 },
					{ id: "summary", tokens: 0 },
					{ id: "messages", tokens: 40 },
					{ id: "tools", tokens: 0 },
				],
			},
		};
		const status: AssistantConversationStatusView = {
			conversationId: conversation.id,
			status: "idle",
			lastEventSeq: 0,
			updatedAt: conversation.updatedAt,
			lastMessageAt: null,
		};
		const events: AssistantConversationEventsView = {
			conversationId: conversation.id,
			after: 2,
			lastSeq: 2,
			events: [],
		};
		const compactView: AssistantCompactView = {
			compaction: {
				id: "cmp-1",
				conversationId: conversation.id,
				seq: 1,
				summary: "摘要：排障结论。",
				omittedMessageIds: [1, 2],
				beforeTokens: 500,
				afterTokens: 200,
				createdAt: "2026-11-13T02:00:00.000Z",
			},
			context: detail.context,
		};
		const { fetchImpl, calls } = stubFetch((call) => {
			if (call.url.endsWith("/compact")) return jsonResponse(compactView);
			if (call.init.method === "POST") return jsonResponse(conversation, 201);
			if (call.init.method === "PATCH") return jsonResponse(conversation);
			if (call.init.method === "DELETE")
				return new Response(null, { status: 204 });
			if (call.url.endsWith("/status")) return jsonResponse(status);
			if (call.url.endsWith("/events?after=2")) return jsonResponse(events);
			return jsonResponse(detail);
		});
		const client = new AssistantApiClient({ fetch: fetchImpl });
		await client.createConversation({
			storyId: "story-1",
			skill: "troubleshoot",
			title: "排障",
		});
		await client.getConversation(conversation.id);
		await client.updateConversation(conversation.id, { permission: "auto" });
		await client.getStatus(conversation.id);
		await client.listEvents(conversation.id, 2);
		await expect(
			client.compactConversation(conversation.id, {
				instructions: "保留排障结论",
			}),
		).resolves.toEqual(compactView);
		await client.deleteConversation(conversation.id);

		const callsView = calls.map((call) => ({
			method: call.init.method,
			url: call.url.replace("http://localhost:8787", ""),
			body: call.init.body,
		}));
		expect(callsView).toEqual([
			{
				method: "POST",
				url: "/api/assistant/conversations",
				body: JSON.stringify({
					storyId: "story-1",
					skill: "troubleshoot",
					title: "排障",
				}),
			},
			{
				method: "GET",
				url: "/api/assistant/conversations/c-1",
				body: undefined,
			},
			{
				method: "PATCH",
				url: "/api/assistant/conversations/c-1",
				body: JSON.stringify({ permission: "auto" }),
			},
			{
				method: "GET",
				url: "/api/assistant/conversations/c-1/status",
				body: undefined,
			},
			{
				method: "GET",
				url: "/api/assistant/conversations/c-1/events?after=2",
				body: undefined,
			},
			{
				method: "POST",
				url: "/api/assistant/conversations/c-1/compact",
				body: JSON.stringify({ instructions: "保留排障结论" }),
			},
			{
				method: "DELETE",
				url: "/api/assistant/conversations/c-1",
				body: undefined,
			},
		]);
	});

	it("技能、待确认动作、取消与消息流都打到对应路径", async () => {
		const skills: AssistantSkillListView = {
			skills: [
				{
					id: "troubleshoot",
					name: "排障",
					description: "解释这一轮为什么这么写",
					defaultPermission: "confirm",
					tools: ["trace_read"],
				},
			],
		};
		const actions: AssistantActionListView = { actions: [] };
		const cancel: AssistantCancelView = {
			conversationId: "c-1",
			status: "cancelled",
		};
		const frames = [
			'event: assistant.started\ndata: {"conversationId":"c-1","skill":"troubleshoot"}\n\n',
			'event: assistant.text.delta\ndata: {"delta":"收到"}\n\n',
			'event: assistant.completed\ndata: {"status":"completed","stopReason":"completed"}\n\n',
		].join("");
		const { fetchImpl, calls } = stubFetch((call) => {
			if (call.url.endsWith("/skills")) return jsonResponse(skills);
			if (call.url.includes("/actions?")) return jsonResponse(actions);
			if (call.url.endsWith("/cancel")) return jsonResponse(cancel);
			return new Response(frames, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			});
		});
		const client = new AssistantApiClient({ fetch: fetchImpl });
		await expect(client.listSkills()).resolves.toEqual(skills);
		await expect(
			client.listActions({
				storyId: "story-1",
				status: "pending",
				limit: 5,
			}),
		).resolves.toEqual(actions);
		await expect(client.cancel("c-1")).resolves.toEqual(cancel);
		const events = [];
		for await (const event of client.streamMessage("c-1", "你好")) {
			events.push(event);
		}
		expect(events.map((event) => event.event)).toEqual([
			"assistant.started",
			"assistant.text.delta",
			"assistant.completed",
		]);
		expect(
			calls.map((call) => call.url.replace("http://localhost:8787", "")),
		).toEqual([
			"/api/assistant/skills",
			"/api/assistant/actions?status=pending&storyId=story-1&limit=5",
			"/api/assistant/conversations/c-1/cancel",
			"/api/assistant/conversations/c-1/messages",
		]);
	});

	it("服务端错误转成 ApiError，并保留状态与原因", async () => {
		const { fetchImpl } = stubFetch(() =>
			jsonResponse(
				{
					error: { code: "not_found", message: "助手会话不存在：c-9" },
				},
				404,
			),
		);
		const client = new AssistantApiClient({ fetch: fetchImpl });
		await expect(client.getConversation("c-9")).rejects.toMatchObject({
			name: "ApiError",
			status: 404,
			body: { code: "not_found", message: "助手会话不存在：c-9" },
		});
		await expect(client.getConversation("c-9")).rejects.toBeInstanceOf(
			ApiError,
		);
	});
});
