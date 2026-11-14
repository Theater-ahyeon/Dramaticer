import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, onTestFinished } from "vitest";
import { LATEST_SCHEMA_VERSION, StoryStore } from "../src/index.js";

function openTempStore(): { store: StoryStore; path: string } {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-assistant-")),
		"story.db",
	);
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(path), { recursive: true, force: true, maxRetries: 5 });
	});
	return { store, path };
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "story-1", title: "测试故事" });
	const root = store.appendNode({
		id: "n-root",
		storyId: "story-1",
		parentId: null,
		role: "system",
		raw: "你是故事引擎。",
	});
	store.appendNode({
		id: "n-user",
		storyId: "story-1",
		parentId: root.id,
		role: "user",
		raw: "我推开古老的山门。",
	});
}

describe("助手会话存储", () => {
	it("迁移 v44 建表建索引，事件只追加", () => {
		const { store, path } = openTempStore();
		expect(store.getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION);
		expect(LATEST_SCHEMA_VERSION).toBe(63);
		const raw = new Database(path);
		onTestFinished(() => raw.close());
		const tables = raw
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all() as { readonly name: string }[];
		const names = tables.map((row) => row.name);
		expect(names).toContain("assistant_conversations");
		expect(names).toContain("assistant_messages");
		expect(names).toContain("assistant_events");
		expect(names).toContain("assistant_message_text");
		const triggers = raw
			.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
			.all() as { readonly name: string }[];
		expect(triggers.map((row) => row.name)).toEqual(
			expect.arrayContaining([
				"assistant_messages_fts_insert",
				"assistant_messages_fts_delete",
				"assistant_events_append_only_update",
				"assistant_events_append_only_delete",
			]),
		);
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "troubleshoot",
		});
		const event = store.appendAssistantEvent({
			conversationId: conversation.id,
			kind: "started",
			payload: { skill: "troubleshoot" },
		});
		expect(event.seq).toBe(1);
		expect(() =>
			raw
				.prepare("UPDATE assistant_events SET payload = '{}' WHERE seq = 1")
				.run(),
		).toThrow(/只追加/);
		expect(() => raw.prepare("DELETE FROM assistant_events").run()).toThrow(
			/只追加/,
		);
		store.deleteAssistantConversation(conversation.id);
		expect(store.getAssistantConversation(conversation.id)).toBeNull();
	});

	it("压缩记录按序号追加，不能修改或单独删除，删除会话时随会话消失", () => {
		const { store, path } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "troubleshoot",
		});
		store.appendAssistantMessage({
			conversationId: conversation.id,
			role: "user",
			text: "第一句",
		});
		const before = store.getAssistantConversation(conversation.id);
		expect(before).not.toBeNull();
		const updatedAtBefore = before?.updatedAt ?? "";
		const first = store.createAssistantCompaction({
			conversationId: conversation.id,
			summary: "摘要一",
			omittedMessageIds: [1],
			beforeTokens: 300,
			afterTokens: 120,
			createdAt: "2026-11-13T03:00:00.000Z",
		});
		expect(first.seq).toBe(1);
		expect(first.omittedMessageIds).toEqual([1]);
		const second = store.createAssistantCompaction({
			conversationId: conversation.id,
			summary: "摘要二",
			omittedMessageIds: [1, 2],
			beforeTokens: 400,
			afterTokens: 160,
			createdAt: "2026-11-13T03:05:00.000Z",
		});
		expect(second.seq).toBe(2);
		expect(store.getAssistantCompaction(conversation.id)?.id).toBe(second.id);
		expect(
			store
				.listAssistantCompactions(conversation.id)
				.map((compaction) => compaction.seq),
		).toEqual([1, 2]);
		expect(store.getAssistantConversation(conversation.id)?.updatedAt).not.toBe(
			updatedAtBefore,
		);

		const raw = new Database(path);
		onTestFinished(() => raw.close());
		expect(() =>
			raw
				.prepare(
					"UPDATE assistant_compactions SET summary = '改' WHERE seq = 1",
				)
				.run(),
		).toThrow(/只追加/);
		expect(() =>
			raw.prepare("DELETE FROM assistant_compactions WHERE seq = 1").run(),
		).toThrow(/只追加/);

		store.deleteAssistantConversation(conversation.id);
		expect(
			raw
				.prepare(
					"SELECT COUNT(*) AS c FROM assistant_compactions WHERE conversation_id = ?",
				)
				.get(conversation.id),
		).toEqual({ c: 0 });
	});

	it("非法压缩记录在写入前拒绝", () => {
		const { store } = openTempStore();
		const conversation = store.createAssistantConversation({
			skill: "guide",
		});
		expect(() =>
			store.createAssistantCompaction({
				conversationId: conversation.id,
				summary: "  ",
				omittedMessageIds: [1],
				beforeTokens: 1,
				afterTokens: 1,
			}),
		).toThrow(/摘要不能为空/);
		expect(() =>
			store.createAssistantCompaction({
				conversationId: conversation.id,
				summary: "摘要",
				omittedMessageIds: [2, 1],
				beforeTokens: 1,
				afterTokens: 1,
			}),
		).toThrow(/严格递增/);
		expect(() =>
			store.createAssistantCompaction({
				conversationId: conversation.id,
				summary: "摘要",
				omittedMessageIds: [1],
				beforeTokens: -1,
				afterTokens: 1,
			}),
		).toThrow(/非负整数/);
		expect(store.getAssistantCompaction(conversation.id)).toBeNull();
	});

	it("创建、改字段、按故事与技能列出，并记住模型与压缩设置", () => {
		const { store } = openTempStore();
		seedStory(store);
		const first = store.createAssistantConversation({
			storyId: "story-1",
			skill: "troubleshoot",
			title: "排障",
		});
		expect(first.permission).toBe("confirm");
		expect(first.status).toBe("idle");
		expect(first.thinking).toBe("off");
		expect(first.contextBudget).toBe(48_000);
		expect(first.compactionThreshold).toBe(0.8);
		const second = store.createAssistantConversation({ skill: "guide" });
		expect(second.storyId).toBeNull();
		expect(second.title).toBe("新会话");

		const updated = store.updateAssistantConversation(first.id, {
			title: "为什么忘了",
			permission: "auto",
			modelAlias: "main-fallback",
			thinking: "high",
			contextBudget: 64_000,
			compactionThreshold: 0.9,
		});
		expect(updated.title).toBe("为什么忘了");
		expect(updated.permission).toBe("auto");
		expect(updated.modelAlias).toBe("main-fallback");
		expect(updated.thinking).toBe("high");
		expect(updated.contextBudget).toBe(64_000);
		expect(updated.compactionThreshold).toBe(0.9);

		expect(
			store.listAssistantConversations({ storyId: "story-1" }).map((c) => c.id),
		).toEqual([first.id]);
		expect(
			store.listAssistantConversations({ skill: "guide" }).map((c) => c.id),
		).toEqual([second.id]);
		expect(
			store
				.listAssistantConversations({ skill: "troubleshoot", limit: 1 })
				.map((c) => c.id),
		).toEqual([first.id]);
		expect(() => store.listAssistantConversations({ limit: 0 })).toThrow(
			/1 到 100/,
		);
		expect(() =>
			store.listAssistantConversations({ storyId: "missing" }),
		).toThrow(/故事不存在/);

		const running = store.setAssistantConversationStatus(first.id, "running");
		expect(running.status).toBe("running");
		expect(store.markInterruptedAssistantConversations()).toBe(1);
		expect(store.getAssistantConversation(first.id)?.status).toBe(
			"interrupted",
		);
	});

	it("消息序号递增，工具结果与用量按 JSON 读回", () => {
		const { store } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "troubleshoot",
		});
		store.appendAssistantMessage({
			conversationId: conversation.id,
			role: "user",
			text: "这一轮为什么反复回忆剑冢？",
		});
		store.appendAssistantMessage({
			conversationId: conversation.id,
			role: "tool",
			text: "",
			toolName: "ledger_read",
			toolResult: { clues: ["剑冢"] },
		});
		store.appendAssistantMessage({
			conversationId: conversation.id,
			role: "assistant",
			text: "检索命中了锦囊。",
			usage: { inputTokens: 120, outputTokens: 40 },
		});
		const messages = store.getAssistantMessages(conversation.id);
		expect(messages.map((message) => message.ordinal)).toEqual([1, 2, 3]);
		expect(messages[1]?.toolName).toBe("ledger_read");
		expect(messages[1]?.toolResult).toEqual({ clues: ["剑冢"] });
		expect(messages[2]?.usage).toEqual({
			inputTokens: 120,
			outputTokens: 40,
		});
		const saved = store.getAssistantConversation(conversation.id);
		expect(saved?.lastMessageAt).not.toBeNull();

		expect(() =>
			store.appendAssistantMessage({
				conversationId: conversation.id,
				role: "tool",
				text: "",
			}),
		).toThrow(/工具名/);
		expect(() =>
			store.appendAssistantMessage({
				conversationId: conversation.id,
				role: "user",
				text: "用户",
				usage: { inputTokens: 1 },
			}),
		).toThrow(/只有助手消息/);
		expect(() =>
			store.appendAssistantMessage({
				conversationId: conversation.id,
				role: "assistant",
				text: "   ",
			}),
		).toThrow(/正文不能为空/);
	});

	it("中文两字查询命中标题与正文，三字以上走 trigram 片段", () => {
		const { store } = openTempStore();
		seedStory(store);
		const titled = store.createAssistantConversation({
			storyId: "story-1",
			skill: "troubleshoot",
			title: "山门为什么重复",
		});
		const body = store.createAssistantConversation({
			storyId: "story-1",
			skill: "strategy",
			title: "剧情参谋",
		});
		store.appendAssistantMessage({
			conversationId: body.id,
			role: "assistant",
			text: "上一轮反复写了山门之外的风。",
		});
		const hidden = store.createAssistantConversation({
			storyId: "story-1",
			skill: "guide",
			title: "使用指南",
		});
		store.appendAssistantMessage({
			conversationId: hidden.id,
			role: "assistant",
			text: "山门与古老的山门不是一回事。",
		});

		const twoChars = store.searchAssistantConversations("山门", {
			storyId: "story-1",
		});
		const matchedIds = twoChars.map((hit) => hit.conversation.id);
		expect(matchedIds).toContain(titled.id);
		expect(matchedIds).toContain(body.id);
		expect(
			twoChars.find((hit) => hit.conversation.id === titled.id)?.matchedIn,
		).toBe("title");
		expect(
			twoChars.find((hit) => hit.conversation.id === body.id)?.snippet,
		).toContain("[山门]");

		const longQuery = store.searchAssistantConversations("古老的山门", {
			storyId: "story-1",
		});
		const longHit = longQuery.find((hit) => hit.conversation.id === hidden.id);
		expect(longHit?.matchedIn).toBe("message");
		expect(longHit?.snippet).toContain("[古老的山门]");
		expect(
			store.searchAssistantConversations("山门", { limit: 1 }),
		).toHaveLength(1);
		expect(() => store.searchAssistantConversations("   ")).toThrow(/不能为空/);
	});

	it("删除会话连同消息与事件一起消失，助手操作不影响楼层与台账", () => {
		const { store, path } = openTempStore();
		seedStory(store);
		const headBefore = store.getHead("story-1")?.id ?? null;
		const raw = new Database(path);
		onTestFinished(() => raw.close());
		const countsBefore = {
			nodes: raw.prepare("SELECT COUNT(*) AS c FROM nodes").get() as {
				c: number;
			},
			turnRuns: raw.prepare("SELECT COUNT(*) AS c FROM turn_runs").get() as {
				c: number;
			},
			stateDiffs: raw
				.prepare("SELECT COUNT(*) AS c FROM state_diffs")
				.get() as { c: number },
		};
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "troubleshoot",
		});
		store.appendAssistantMessage({
			conversationId: conversation.id,
			role: "user",
			text: "检查剑冢的检索名次。",
		});
		store.appendAssistantEvent({
			conversationId: conversation.id,
			kind: "started",
			payload: { skill: "troubleshoot" },
		});
		store.appendAssistantEvent({
			conversationId: conversation.id,
			kind: "completed",
			payload: { status: "completed" },
		});
		expect(store.countAssistantEvents(conversation.id)).toBe(2);
		expect(
			store
				.listAssistantEvents(conversation.id, { afterSeq: 1 })
				.map((event) => event.seq),
		).toEqual([2]);

		store.deleteAssistantConversation(conversation.id);
		expect(store.getAssistantConversation(conversation.id)).toBeNull();
		const leftover = raw
			.prepare(
				"SELECT COUNT(*) AS c FROM assistant_message_text WHERE conversation_id = ?",
			)
			.get(conversation.id) as { c: number };
		expect(leftover.c).toBe(0);
		expect(
			raw
				.prepare(
					"SELECT COUNT(*) AS c FROM assistant_messages WHERE conversation_id = ?",
				)
				.get(conversation.id),
		).toEqual({ c: 0 });
		expect(
			raw
				.prepare(
					"SELECT COUNT(*) AS c FROM assistant_events WHERE conversation_id = ?",
				)
				.get(conversation.id),
		).toEqual({ c: 0 });

		expect(store.getHead("story-1")?.id ?? null).toBe(headBefore);
		const nodesAfter = raw.prepare("SELECT COUNT(*) AS c FROM nodes").get() as {
			readonly c: number;
		};
		const turnRunsAfter = raw
			.prepare("SELECT COUNT(*) AS c FROM turn_runs")
			.get() as { readonly c: number };
		const stateDiffsAfter = raw
			.prepare("SELECT COUNT(*) AS c FROM state_diffs")
			.get() as { readonly c: number };
		expect(nodesAfter.c).toBe(countsBefore.nodes.c);
		expect(turnRunsAfter.c).toBe(countsBefore.turnRuns.c);
		expect(stateDiffsAfter.c).toBe(countsBefore.stateDiffs.c);
	});

	it("非法权限、阈值与预算在写入前拒绝", () => {
		const { store } = openTempStore();
		expect(() =>
			store.createAssistantConversation({
				skill: "troubleshoot",
				permission: "admin" as never,
			}),
		).toThrow(/权限级别/);
		expect(() =>
			store.createAssistantConversation({
				skill: "troubleshoot",
				compactionThreshold: 0.4,
			}),
		).toThrow(/0.5 到 0.95/);
		expect(() =>
			store.createAssistantConversation({
				skill: "troubleshoot",
				contextBudget: 0,
			}),
		).toThrow(/大于等于 1/);
		expect(() =>
			store.createAssistantConversation({
				skill: "   ",
			}),
		).toThrow(/助手技能/);
		expect(() =>
			store.createAssistantConversation({
				skill: "troubleshoot",
				storyId: "missing",
			}),
		).toThrow(/故事不存在/);
	});
});
