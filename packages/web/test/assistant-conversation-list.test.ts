import type {
	AssistantConversationListView,
	AssistantConversationView,
} from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import {
	activeConversation,
	applyConversationList,
	createConversationListState,
	matchFor,
	patchConversation,
	removeConversation,
	selectConversation,
	upsertConversation,
} from "../src/assistant/conversation-list";

function conversation(
	id: string,
	title: string,
	overrides: Partial<AssistantConversationView> = {},
): AssistantConversationView {
	return {
		id,
		storyId: "story-1",
		skill: "troubleshoot",
		title,
		permission: "confirm",
		status: "idle",
		modelAlias: null,
		thinking: "off",
		contextBudget: 48_000,
		compactionThreshold: 0.8,
		createdAt: "2026-11-13T01:00:00.000Z",
		updatedAt: "2026-11-13T01:00:00.000Z",
		lastMessageAt: null,
		...overrides,
	};
}

describe("会话列表", () => {
	it("搜索响应把命中片段按会话 id 索引", () => {
		const view: AssistantConversationListView = {
			conversations: [conversation("c-1", "排障"), conversation("c-2", "指南")],
			matches: [
				{
					matchedIn: "title",
					snippet: "[排障]",
					messageOrdinal: null,
					score: 0,
				},
				{
					matchedIn: "message",
					snippet: "看 [排障] 记录",
					messageOrdinal: 3,
					score: -1.5,
				},
			],
		};
		const state = applyConversationList(createConversationListState(), view);
		expect(matchFor(state, "c-2")?.messageOrdinal).toBe(3);
		expect(matchFor(state, "c-9")).toBeNull();
	});

	it("替换列表不改变活动会话；删除活动会话后选中第一条", () => {
		let state = applyConversationList(createConversationListState(), {
			conversations: [conversation("c-1", "一"), conversation("c-2", "二")],
		});
		state = selectConversation(state, "c-2");
		expect(activeConversation(state)?.id).toBe("c-2");
		state = removeConversation(state, "c-2");
		expect(state.activeId).toBe("c-1");
		expect(activeConversation(state)?.title).toBe("一");
		state = removeConversation(state, "c-1");
		expect(state.activeId).toBeNull();
	});

	it("新建会话放到最前并选中，改名只替换原位置", () => {
		let state = applyConversationList(createConversationListState(), {
			conversations: [conversation("c-1", "一"), conversation("c-2", "二")],
		});
		state = selectConversation(state, "c-1");
		state = upsertConversation(state, conversation("c-3", "三"));
		expect(state.conversations.map((item) => item.id)).toEqual([
			"c-3",
			"c-1",
			"c-2",
		]);
		expect(state.activeId).toBe("c-3");
		state = patchConversation(state, conversation("c-3", "三（改名）"));
		expect(activeConversation(state)?.title).toBe("三（改名）");
		expect(state.conversations.map((item) => item.id)).toEqual([
			"c-3",
			"c-1",
			"c-2",
		]);
	});
});
