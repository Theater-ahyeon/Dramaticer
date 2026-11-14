import { describe, expect, it } from "vitest";
import {
	BUILTIN_PLUGINS,
	CHARACTER_SLOT_PLUGIN,
	type ContextSlotProviders,
	DIRECTOR_SLOT_PLUGIN,
	HISTORY_SLOT_PLUGIN,
	LORE_SLOT_PLUGIN,
	MEMORY_SLOT_PLUGIN,
	PERSONA_SLOT_PLUGIN,
	PROFILE_SLOT_PLUGIN,
	RAW_HISTORY_SLOT_PLUGIN,
	REUNION_SLOT_PLUGIN,
	SCENE_CARD_SLOT_PLUGIN,
	SCENE_SLOT_PLUGIN,
	STATE_SLOT_PLUGIN,
	SUMMARY_SLOT_PLUGIN,
	type StoryStore,
	USER_WILL_SLOT_PLUGIN,
	assembleContext,
	collectSlotProviders,
	createDefaultContextTemplate,
	createNaiveChatSlots,
	createStandardChatSlots,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function seedStory(): StoryStore {
	const { store } = openTempStore();
	store.createStory({ id: "s1", title: "槽位插件" });
	store.appendNode({
		storyId: "s1",
		parentId: null,
		role: "user",
		raw: "我推开山门。",
	});
	const head = store.getHead("s1");
	if (head === null) throw new Error("种子楼层没有写入");
	store.appendNode({
		storyId: "s1",
		parentId: head.id,
		role: "assistant",
		raw: "门轴发出一声长响。",
	});
	return store;
}

function headId(store: StoryStore): string {
	const head = store.getHead("s1");
	if (head === null) throw new Error("故事没有 head");
	return head.id;
}

describe("内置槽位插件", () => {
	it("标准集合的每个槽位都来自内核注册表", async () => {
		const store = seedStory();
		const slots = await createStandardChatSlots({
			store,
			characterPrompt: "你扮演山神。",
		});

		expect(
			slots.kernel.snapshot().plugins.map((plugin) => plugin.name),
		).toEqual(BUILTIN_PLUGINS.map((plugin) => plugin.name));
		expect(
			slots.kernel.snapshot().plugins.map((plugin) => plugin.state),
		).toEqual(BUILTIN_PLUGINS.map(() => "active"));
		expect(slots.kernel.snapshot().slots).toEqual({
			character: [CHARACTER_SLOT_PLUGIN],
			history: [HISTORY_SLOT_PLUGIN],
			state: [STATE_SLOT_PLUGIN],
			summary: [SUMMARY_SLOT_PLUGIN],
			memory: [MEMORY_SLOT_PLUGIN],
			lore: [LORE_SLOT_PLUGIN],
			scene: [SCENE_SLOT_PLUGIN],
			profile: [PROFILE_SLOT_PLUGIN],
			reunion: [REUNION_SLOT_PLUGIN],
			scene_card: [SCENE_CARD_SLOT_PLUGIN],
			director: [DIRECTOR_SLOT_PLUGIN],
			user_will: [USER_WILL_SLOT_PLUGIN],
		});
		expect(Object.keys(slots.providers).sort()).toEqual([
			"character",
			"director",
			"history",
			"lore",
			"memory",
			"profile",
			"reunion",
			"scene",
			"scene_card",
			"state",
			"summary",
			"user_will",
		]);

		await slots.kernel.dispose();
	});

	it("没有角色提示词时不注册角色槽位", async () => {
		const store = seedStory();
		const slots = await createStandardChatSlots({
			store,
			characterPrompt: "   ",
		});

		expect(slots.providers.character).toBeUndefined();
		expect(slots.kernel.snapshot().slots.character).toBeUndefined();

		await slots.kernel.dispose();
	});

	it("朴素集合注册角色、人设与原文历史三个槽位", async () => {
		const store = seedStory();
		const slots = await createNaiveChatSlots({
			store,
			characterPrompt: "你扮演山神。",
			persona: "你是云游的剑客。",
			historyLimit: 2,
		});

		expect(slots.kernel.snapshot().slots).toEqual({
			character: [CHARACTER_SLOT_PLUGIN],
			persona: [PERSONA_SLOT_PLUGIN],
			history: [RAW_HISTORY_SLOT_PLUGIN],
		});
		expect(Object.keys(slots.providers).sort()).toEqual([
			"character",
			"history",
			"persona",
		]);

		await slots.kernel.dispose();
	});

	it("卸载槽位插件后该槽位缺失并被 Trace 记录", async () => {
		const store = seedStory();
		const slots = await createStandardChatSlots({
			store,
			characterPrompt: "你扮演山神。",
		});
		const nodeId = headId(store);
		const assemble = (providers: ContextSlotProviders) =>
			assembleContext({
				template: createDefaultContextTemplate({
					structuredOutput: "text-tags",
				}),
				budgetTokens: 12_000,
				storyId: "s1",
				nodeId,
				providers,
			});

		const before = await assemble(slots.providers);
		expect(
			before.trace.entries.find((entry) => entry.slot === "history")?.status,
		).toBe("included");

		await slots.kernel.unload(HISTORY_SLOT_PLUGIN);
		const after = await assemble(collectSlotProviders(slots.kernel));
		const history = after.trace.entries.find(
			(entry) => entry.slot === "history",
		);
		expect(history?.status).toBe("missing-slot");
		expect(history?.source).toBe("slot:history");
		expect(after.trace.entries.some((entry) => entry.slot === "scene")).toBe(
			true,
		);

		await slots.kernel.dispose();
	});
});
