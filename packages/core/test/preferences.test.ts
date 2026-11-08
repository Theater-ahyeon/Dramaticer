import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	StoryStore,
	type TimelineNode,
	approveLedgerChangeCard,
	assembleContext,
	createDefaultContextTemplate,
	createStandardChatProviders,
	rejectLedgerChangeCard,
} from "../src/index.js";

function openTempStore(): { store: StoryStore; path: string } {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-preferences-")),
		"story.db",
	);
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(path), {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
	});
	return { store, path };
}

function seedStory(store: StoryStore): {
	user: TimelineNode;
	assistant: TimelineNode;
} {
	store.createStory({ id: "story-1", title: "偏好测试故事" });
	const root = store.appendNode({
		id: "n-root",
		storyId: "story-1",
		parentId: null,
		role: "system",
		raw: "你是故事引擎。",
	});
	const user = store.appendNode({
		id: "n-user",
		storyId: "story-1",
		parentId: root.id,
		role: "user",
		raw: "我推开古老的山门。",
	});
	const assistant = store.appendNode({
		id: "n-assistant",
		storyId: "story-1",
		parentId: user.id,
		role: "assistant",
		raw: "银色的麒麟守着门后的雕像。",
	});
	return { user, assistant };
}

function seedPendingCard(store: StoryStore, user: TimelineNode): string {
	const cardId = "card-preference";
	store.insertLedgerChangeCard({
		id: cardId,
		storyId: "story-1",
		source: "settler",
		sourceNodeId: user.id,
		text: "把凛的所在地改成屋顶",
		diffs: [
			{
				path: ["userWill", "will-preference"],
				op: "set",
				value: {
					kind: "correction",
					text: "希望故事更轻松",
					sourceNodeId: user.id,
					createdAt: "2026-11-08T00:00:00.000Z",
				},
			},
		],
		before: [{ path: ["userWill", "will-preference"], existed: false }],
		status: "pending",
	});
	return cardId;
}

describe("偏好信号", () => {
	it("swipe、edit、choice 与 card_decision 各写入一行且内容完整", async () => {
		const { store } = openTempStore();
		const { user, assistant } = seedStory(store);
		const cardId = seedPendingCard(store, user);

		const swiped = store.swipeNode(assistant.id, "门后是一阵风。");
		const edited = store.editNode(assistant.id, "门后是一座空庭。");
		store.recordPreference({
			storyId: "story-1",
			nodeId: user.id,
			kind: "choice",
			payload: { choiceText: "跟随银色的麒麟" },
			createdAt: "2026-11-08T00:00:03.000Z",
		});
		await approveLedgerChangeCard(store, cardId, {
			decidedAt: "2026-11-08T00:00:04.000Z",
		});

		const events = store.listPreferenceEvents("story-1");
		expect(events).toHaveLength(4);
		const byKind = new Map(events.map((event) => [event.kind, event]));
		expect(byKind.get("swipe")).toEqual({
			id: expect.any(String),
			storyId: "story-1",
			nodeId: swiped.id,
			kind: "swipe",
			payload: {
				abandonedNodeId: assistant.id,
				acceptedNodeId: swiped.id,
			},
			createdAt: swiped.createdAt,
		});
		expect(byKind.get("edit")).toEqual({
			id: expect.any(String),
			storyId: "story-1",
			nodeId: edited.id,
			kind: "edit",
			payload: {
				beforeNodeId: assistant.id,
				afterNodeId: edited.id,
			},
			createdAt: edited.createdAt,
		});
		expect(byKind.get("choice")?.payload).toEqual({
			choiceText: "跟随银色的麒麟",
		});
		expect(byKind.get("choice")?.nodeId).toBe(user.id);
		expect(byKind.get("card_decision")?.payload).toEqual({
			cardId,
			decision: "approved",
		});
		expect(byKind.get("card_decision")?.nodeId).toBe(user.id);

		expect(
			store.listPreferenceEvents("story-1", { kind: "swipe" }),
		).toHaveLength(1);
		expect(
			store.listPreferenceEvents("story-1", { kind: "card_decision" }),
		).toHaveLength(1);
		expect(
			store.listPreferenceEvents("story-1", { kind: "choice" }),
		).toHaveLength(1);
	});

	it("拒绝变更卡同样记录决定，重复操作产生新的行", async () => {
		const { store } = openTempStore();
		const { user, assistant } = seedStory(store);
		const pending = seedPendingCard(store, user);

		await rejectLedgerChangeCard(store, pending, {
			decidedAt: "2026-11-08T00:00:05.000Z",
		});
		store.swipeNode(assistant.id, "第一次重 roll。");
		store.swipeNode(assistant.id, "第二次重 roll。");

		const decisions = store.listPreferenceEvents("story-1", {
			kind: "card_decision",
		});
		expect(decisions.map((event) => event.payload)).toEqual([
			{ cardId: pending, decision: "rejected" },
		]);
		expect(
			store.listPreferenceEvents("story-1", { kind: "swipe" }),
		).toHaveLength(2);
	});

	it("校验载荷字段、节点归属与卡片归属", () => {
		const { store } = openTempStore();
		const { user, assistant } = seedStory(store);
		store.createStory({ id: "story-2", title: "另一个故事" });
		const foreign = store.appendNode({
			storyId: "story-2",
			parentId: null,
			role: "assistant",
			raw: "另一个分支。",
		});

		expect(() =>
			store.recordPreference({
				storyId: "story-1",
				nodeId: user.id,
				kind: "choice",
				// @ts-expect-error 未知字段必须在运行时拒绝
				payload: { choiceText: "跟随", extra: true },
			}),
		).toThrow(/载荷\.extra 是未知字段/);
		expect(() =>
			store.recordPreference({
				storyId: "story-1",
				nodeId: "missing",
				kind: "choice",
				payload: { choiceText: "跟随" },
			}),
		).toThrow(/楼层不存在/);
		expect(() =>
			store.recordPreference({
				storyId: "story-1",
				nodeId: assistant.id,
				kind: "swipe",
				payload: {
					abandonedNodeId: foreign.id,
					acceptedNodeId: assistant.id,
				},
			}),
		).toThrow(/属于另一个故事/);
		expect(() =>
			store.recordPreference({
				storyId: "story-1",
				nodeId: user.id,
				kind: "swipe",
				payload: {
					abandonedNodeId: assistant.id,
					acceptedNodeId: assistant.id,
				},
			}),
		).toThrow(/必须等于记录的所在楼层/);
		expect(() =>
			store.recordPreference({
				storyId: "story-1",
				nodeId: user.id,
				kind: "card_decision",
				payload: { cardId: "card-missing", decision: "approved" },
			}),
		).toThrow(/变更卡不存在/);
		expect(() =>
			store.recordPreference({
				storyId: "story-1",
				nodeId: user.id,
				kind: "edit",
				payload: { beforeNodeId: assistant.id, afterNodeId: "n-other" },
			}),
		).toThrow(/必须等于记录的所在楼层/);
	});

	it("数据库触发器拒绝修改与删除", () => {
		const { store, path } = openTempStore();
		const { user } = seedStory(store);
		store.recordPreference({
			storyId: "story-1",
			nodeId: user.id,
			kind: "choice",
			payload: { choiceText: "跟随" },
		});

		const raw = new Database(path);
		onTestFinished(() => raw.close());
		expect(() =>
			raw.prepare("UPDATE preference_events SET kind = 'swipe'").run(),
		).toThrow(/只追加/);
		expect(() => raw.prepare("DELETE FROM preference_events").run()).toThrow(
			/只追加/,
		);
		expect(store.listPreferenceEvents("story-1")).toHaveLength(1);
	});

	it("事务失败时偏好记录与对应操作一起回滚", async () => {
		const { store } = openTempStore();
		const { user, assistant } = seedStory(store);
		const headBefore = store.getHead("story-1")?.id;

		await expect(
			store.runInTransaction(async () => {
				store.swipeNode(assistant.id, "会被回滚的重 roll");
				store.recordPreference({
					storyId: "story-1",
					nodeId: user.id,
					kind: "choice",
					payload: { choiceText: "会被回滚的选择" },
				});
				throw new Error("提交前失败");
			}),
		).rejects.toThrow("提交前失败");

		expect(store.getHead("story-1")?.id).toBe(headBefore);
		expect(store.listPreferenceEvents("story-1")).toEqual([]);
	});

	it("偏好记录不进入上下文组装与检索", async () => {
		const { store } = openTempStore();
		const { user } = seedStory(store);
		const marker = "偏好载荷里的独特句子";
		store.recordPreference({
			storyId: "story-1",
			nodeId: user.id,
			kind: "choice",
			payload: { choiceText: marker },
		});

		const assembled = await assembleContext({
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			budgetTokens: 12_000,
			storyId: "story-1",
			nodeId: user.id,
			providers: createStandardChatProviders({
				store,
				characterPrompt: null,
			}),
		});
		const text = assembled.messages
			.map((message) => message.content)
			.join("\n");
		expect(text).not.toContain(marker);
		expect(store.searchNodeText(marker, { storyId: "story-1" })).toEqual([]);
	});
});
