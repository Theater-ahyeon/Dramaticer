import { describe, expect, it } from "vitest";
import {
	type ContextSlotRequest,
	type StoryStore,
	createMemorySlotProvider,
	formatReunionMention,
	selectReunionMentions,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function append(
	store: StoryStore,
	id: string,
	parentId: string | null,
	role: "assistant" | "user",
	raw: string,
): void {
	store.appendNode({ id, storyId: "s1", parentId, role, raw });
}

function request(nodeId: string, budgetTokens?: number): ContextSlotRequest {
	return {
		slot: "memory",
		storyId: "s1",
		nodeId,
		switches: {},
		state: undefined,
		...(budgetTokens === undefined ? {} : { budgetTokens }),
	};
}

describe("按在场取用记忆", () => {
	it("在场者的名字驱动实体这一路，不需要玩家在消息里提到他", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "取用" });
		append(store, "a1", null, "assistant", "凛靠在门边，看着窗外的雨。");
		append(store, "u1", "a1", "user", "我推开门。");
		store.upsertEntity({
			storyId: "s1",
			kind: "character",
			name: "凛",
			source: "card",
		});
		store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "a1",
				ordinal: 0,
				participants: ["凛"],
				knowers: [],
				importance: 0.4,
				text: "凛在门边等雨停",
			},
		]);
		store.saveSceneLog({
			nodeId: "a1",
			storyId: "s1",
			beat: "傍晚",
			present: ["凛"],
			sceneEnds: false,
			sceneCard: null,
			bits: [],
			conditions: [],
			states: [],
			quotes: { submitted: 0, verified: 0 },
			repairs: [],
		});

		const provider = createMemorySlotProvider(store, { limit: 4 });
		const content = await provider.provide(request("u1"));
		const entityRoute = content?.retrieval?.routes.find(
			(route) => route.route === "entity",
		);
		expect(entityRoute?.items.map((item) => item.nodeId)).toContain("a1");
		expect(content?.messages[0]?.content).toContain("凛在门边等雨停");
	});

	it("同一件事的新旧说法按故事时间排序", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "取用" });
		append(store, "a1", null, "assistant", "凛在旧教室。");
		append(store, "u1", "a1", "user", "我找她。");
		append(store, "a2", "u1", "assistant", "凛去了树林。");
		append(store, "u2", "a2", "user", "凛现在在哪里？");
		store.upsertEntity({
			storyId: "s1",
			kind: "character",
			name: "凛",
			source: "card",
		});
		store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "a2",
				ordinal: 0,
				participants: ["凛"],
				knowers: [],
				importance: 0.9,
				text: "凛去了树林",
				storyTime: "第二日",
			},
			{
				storyId: "s1",
				sourceNodeId: "a1",
				ordinal: 0,
				participants: ["凛"],
				knowers: [],
				importance: 0.5,
				text: "凛在旧教室",
				storyTime: "第一日",
			},
		]);

		const provider = createMemorySlotProvider(store, { limit: 4 });
		const content = await provider.provide(request("u2"));
		const text = content?.messages[0]?.content ?? "";
		expect(text).toContain("凛在旧教室");
		expect(text).toContain("凛去了树林");
		expect(text.indexOf("凛在旧教室")).toBeLessThan(text.indexOf("凛去了树林"));
	});

	it("故事放得下上下文时不做检索", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "取用" });
		append(store, "a1", null, "assistant", "山门开了，守卫让路。");
		append(store, "u1", "a1", "user", "山门");
		store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "a1",
				ordinal: 0,
				participants: ["守卫"],
				knowers: [],
				importance: 0.6,
				text: "守卫让开了山门",
			},
		]);
		const provider = createMemorySlotProvider(store, { limit: 4 });

		expect(await provider.provide(request("u1", 100_000))).toBeNull();
		expect(await provider.provide(request("u1", 1))).not.toBeNull();
	});
});

describe("重逢时的原文摘录", () => {
	it("久未出场的人物被提到时带上记录里的原文摘录", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "重逢" });
		append(store, "a1", null, "assistant", "凛把信收进口袋。");
		append(store, "u1", "a1", "user", "我点头。");
		append(store, "a2", "u1", "assistant", "我把教室的灯关掉。");
		append(store, "u2", "a2", "user", "我走出门。");
		append(store, "a3", "u2", "assistant", "商人合上账本。");
		append(store, "u3", "a3", "user", "我问他。");
		append(store, "a4", "u3", "assistant", "夜色沉下来。");
		append(store, "u4", "a4", "user", "我打听凛的下落。");
		store.saveSceneArchive({
			storyId: "s1",
			endNodeId: "a2",
			startNodeId: "a1",
			floorCount: 2,
			boundary: "scene-ends",
			summary: "凛收起信，老师看见了。",
			present: ["凛", "老师"],
			profiles: [
				{
					who: "凛",
					want: "拿回那封信",
					hide: null,
					speech: "「把书还我。」",
					unresolved: "信最后在谁手里",
				},
			],
			informed: [],
			stateChanges: [],
			cluesOpened: [],
			cluesClosed: [],
		});
		store.saveSceneArchive({
			storyId: "s1",
			endNodeId: "a4",
			startNodeId: "a3",
			floorCount: 2,
			boundary: "max-floors",
			summary: "商人和我谈完离开。",
			present: ["商人"],
			profiles: [],
			informed: [],
			stateChanges: [],
			cluesOpened: [],
			cluesClosed: [],
		});
		store.upsertEntity({
			storyId: "s1",
			kind: "character",
			name: "凛",
			source: "card",
			aliases: ["小凛"],
		});
		const [event] = store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "a2",
				ordinal: 0,
				participants: ["凛"],
				knowers: ["老师"],
				importance: 0.8,
				text: "凛把信藏进袖口",
			},
		]);
		if (event === undefined) throw new Error("没有写入事件");
		store.saveMemoryEventQuotes("s1", [
			{ eventId: event.id, quote: "凛把信收进口袋。" },
		]);

		const mentions = selectReunionMentions({
			store,
			storyId: "s1",
			nodeId: "u4",
			triggerText: "我打听凛的下落。",
			recentFloors: 2,
		});
		expect(mentions).toHaveLength(1);
		const first = mentions[0];
		if (first === undefined) throw new Error("没有命中");
		expect(first.candidate.excerpts).toEqual([
			{ nodeId: "a2", text: "凛把信收进口袋。" },
		]);
		const text = formatReunionMention(first);
		expect(text).toContain("原文摘录：凛把信收进口袋。");
	});
});
