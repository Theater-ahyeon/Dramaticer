import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ApiErrorResponse,
	AssistantConversationDetailView,
	AssistantConversationEventsView,
	AssistantConversationListView,
	AssistantConversationStatusView,
	AssistantConversationView,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-assistant-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

async function startTestServer(): Promise<RunningServer> {
	const dir = tempDir();
	const webRoot = join(dir, "web");
	mkdirSync(webRoot, { recursive: true });
	writeFileSync(
		join(webRoot, "index.html"),
		"<!doctype html><title>应用</title>",
	);
	const running = await startServer({
		dbPath: join(dir, "story.db"),
		webRoot,
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => {},
	});
	onTestFinished(() => running.close());
	return running;
}

function request(
	origin: string,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${origin}${path}`, {
		...init,
		headers: { "Content-Type": "application/json", ...init.headers },
	});
}

function post(origin: string, path: string, body: unknown): Promise<Response> {
	return request(origin, path, { method: "POST", body: JSON.stringify(body) });
}

function patch(origin: string, path: string, body: unknown): Promise<Response> {
	return request(origin, path, { method: "PATCH", body: JSON.stringify(body) });
}

async function errorBody(response: Response): Promise<ApiErrorResponse> {
	return (await response.json()) as ApiErrorResponse;
}

async function createConversation(
	origin: string,
	body: unknown,
): Promise<AssistantConversationView> {
	const response = await post(origin, "/api/assistant/conversations", body);
	expect(response.status).toBe(201);
	return (await response.json()) as AssistantConversationView;
}

describe("助手会话接口", () => {
	it("创建、搜索、改名、改权限、删除与错误字段", async () => {
		const running = await startTestServer();
		const { store } = running;
		store.createStory({ id: "story-1", title: "测试故事" });
		const root = store.appendNode({
			storyId: "story-1",
			parentId: null,
			role: "system",
			raw: "你是故事引擎。",
		});
		const user = store.appendNode({
			storyId: "story-1",
			parentId: root.id,
			role: "user",
			raw: "我推开古老的山门。",
		});
		const headBefore = store.getHead("story-1")?.id ?? null;
		const nodeCountBefore = store.getPathToHead("story-1").length;

		const empty = await request(running.origin, "/api/assistant/conversations");
		expect(empty.status).toBe(200);
		expect(
			((await empty.json()) as AssistantConversationListView).conversations,
		).toEqual([]);

		const titled = await createConversation(running.origin, {
			storyId: "story-1",
			skill: "troubleshoot",
			title: "山门为什么重复",
		});
		expect(titled.storyId).toBe("story-1");
		expect(titled.permission).toBe("confirm");
		expect(titled.status).toBe("idle");
		expect(titled.contextBudget).toBe(48_000);

		const bodyMatch = await createConversation(running.origin, {
			storyId: "story-1",
			skill: "strategy",
			title: "剧情参谋",
			thinking: "high",
		});
		store.appendAssistantMessage({
			conversationId: bodyMatch.id,
			role: "assistant",
			text: "上一轮反复写了山门之外的风。",
		});

		const search = await request(
			running.origin,
			"/api/assistant/conversations?query=%E5%B1%B1%E9%97%A8&storyId=story-1",
		);
		expect(search.status).toBe(200);
		const searchBody = (await search.json()) as AssistantConversationListView;
		expect(searchBody.conversations.map((item) => item.id)).toEqual(
			expect.arrayContaining([titled.id, bodyMatch.id]),
		);
		expect(searchBody.matches).toHaveLength(searchBody.conversations.length);
		const titleIndex = searchBody.conversations.findIndex(
			(item) => item.id === titled.id,
		);
		expect(searchBody.matches?.[titleIndex]?.matchedIn).toBe("title");
		expect(searchBody.matches?.[titleIndex]?.snippet).toContain("[山门]");
		const messageIndex = searchBody.conversations.findIndex(
			(item) => item.id === bodyMatch.id,
		);
		expect(searchBody.matches?.[messageIndex]?.matchedIn).toBe("message");
		expect(searchBody.matches?.[messageIndex]?.messageOrdinal).toBe(1);

		const detail = await request(
			running.origin,
			`/api/assistant/conversations/${bodyMatch.id}`,
		);
		expect(detail.status).toBe(200);
		const detailBody = (await detail.json()) as AssistantConversationDetailView;
		expect(detailBody.conversation.id).toBe(bodyMatch.id);
		expect(detailBody.messages).toHaveLength(1);
		expect(detailBody.messages[0]?.text).toContain("山门");

		const renamed = await patch(
			running.origin,
			`/api/assistant/conversations/${titled.id}`,
			{
				title: "为什么忘了剑冢",
				permission: "read_only",
				modelAlias: "main-fallback",
				thinking: "low",
				contextBudget: 64_000,
				compactionThreshold: 0.9,
			},
		);
		expect(renamed.status).toBe(200);
		const renamedBody = (await renamed.json()) as AssistantConversationView;
		expect(renamedBody.title).toBe("为什么忘了剑冢");
		expect(renamedBody.permission).toBe("read_only");
		expect(renamedBody.modelAlias).toBe("main-fallback");
		expect(renamedBody.thinking).toBe("low");
		expect(renamedBody.contextBudget).toBe(64_000);
		expect(renamedBody.compactionThreshold).toBe(0.9);

		const status = await request(
			running.origin,
			`/api/assistant/conversations/${titled.id}/status`,
		);
		const statusBody = (await status.json()) as AssistantConversationStatusView;
		expect(statusBody.status).toBe("idle");
		expect(statusBody.lastEventSeq).toBe(0);
		store.appendAssistantEvent({
			conversationId: titled.id,
			kind: "started",
			payload: { skill: "troubleshoot" },
		});
		store.appendAssistantEvent({
			conversationId: titled.id,
			kind: "completed",
			payload: { status: "completed" },
		});
		const events = await request(
			running.origin,
			`/api/assistant/conversations/${titled.id}/events?after=1`,
		);
		const eventsBody = (await events.json()) as AssistantConversationEventsView;
		expect(eventsBody.after).toBe(1);
		expect(eventsBody.lastSeq).toBe(2);
		expect(eventsBody.events.map((event) => event.kind)).toEqual(["completed"]);

		const removed = await request(
			running.origin,
			`/api/assistant/conversations/${bodyMatch.id}`,
			{ method: "DELETE" },
		);
		expect(removed.status).toBe(204);
		const missing = await request(
			running.origin,
			`/api/assistant/conversations/${bodyMatch.id}`,
		);
		expect(missing.status).toBe(404);
		expect(() => store.getAssistantMessages(bodyMatch.id)).toThrow(/不存在/);

		for (const response of [
			await request(running.origin, "/api/assistant/conversations/missing"),
			await patch(running.origin, "/api/assistant/conversations/missing", {
				title: "不存在",
			}),
			await request(running.origin, "/api/assistant/conversations/missing", {
				method: "DELETE",
			}),
		]) {
			expect(response.status).toBe(404);
		}

		const unknownSkill = await post(
			running.origin,
			"/api/assistant/conversations",
			{ skill: "unknown" },
		);
		expect(unknownSkill.status).toBe(400);
		expect((await errorBody(unknownSkill)).error.details).toEqual({
			path: "skill",
		});
		const badThreshold = await post(
			running.origin,
			"/api/assistant/conversations",
			{ skill: "troubleshoot", compactionThreshold: 0.2 },
		);
		expect(badThreshold.status).toBe(400);
		expect((await errorBody(badThreshold)).error.details).toEqual({
			path: "compactionThreshold",
		});
		const unknownField = await patch(
			running.origin,
			`/api/assistant/conversations/${titled.id}`,
			{ nope: true },
		);
		expect(unknownField.status).toBe(400);
		expect((await errorBody(unknownField)).error.details).toEqual({
			path: "nope",
		});
		const missingStory = await post(
			running.origin,
			"/api/assistant/conversations",
			{ skill: "guide", storyId: "nope" },
		);
		expect(missingStory.status).toBe(404);

		expect(store.getHead("story-1")?.id ?? null).toBe(headBefore);
		expect(store.getPathToHead("story-1").length).toBe(nodeCountBefore);
		expect(store.getNode(user.id)?.raw).toBe("我推开古老的山门。");
		expect(store.getStateDiffs(user.id)).toEqual([]);
	});
});
