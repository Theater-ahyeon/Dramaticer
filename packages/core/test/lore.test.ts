import { describe, expect, it } from "vitest";
import {
	type ContextSlotRequest,
	DEFAULT_DIRECTOR_CONFIG,
	type StoryStore,
	createDirectorSlotProvider,
	createLoreSlotProvider,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function request(
	storyId: string,
	nodeId: string | null,
	slot: ContextSlotRequest["slot"],
): ContextSlotRequest {
	return { slot, storyId, nodeId, switches: {}, state: undefined };
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "山门在夜里开着。",
	});
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "a1",
		role: "user",
		raw: "我走向山门。",
	});
}

describe("世界书条目存储", () => {
	it("按来源幂等写入，按导入顺序列出并还原关键词", () => {
		const { store } = openTempStore();
		seedStory(store);
		const first = store.insertLoreEntries([
			{
				id: "l1",
				storyId: "s1",
				name: "山门",
				content: "山门由山神看守。",
				constant: true,
				keywords: ["山门", "石门"],
				source: "world-info:测试:0",
			},
		]);
		expect(first).toHaveLength(1);
		expect(first[0]).toMatchObject({
			id: "l1",
			name: "山门",
			constant: true,
			keywords: ["山门", "石门"],
			entityId: null,
		});

		const repeated = store.insertLoreEntries([
			{
				id: "l1-other",
				storyId: "s1",
				name: "山门",
				content: "重复导入的内容。",
				source: "world-info:测试:0",
			},
		]);
		expect(repeated).toEqual([]);
		expect(store.listLoreEntries("s1").map((entry) => entry.id)).toEqual([
			"l1",
		]);
	});

	it("拒绝空正文、空关键词与跨故事实体", () => {
		const { store } = openTempStore();
		seedStory(store);
		store.createStory({ id: "s2", title: "另一个故事" });
		const foreign = store.upsertEntity({
			storyId: "s2",
			kind: "lore",
			name: "异界",
			source: "test",
		});

		expect(() =>
			store.insertLoreEntries([
				{
					storyId: "s1",
					name: "空",
					content: "   ",
					source: "world-info:测试:1",
				},
			]),
		).toThrow("content 不能是空字符串");
		expect(() =>
			store.insertLoreEntries([
				{
					storyId: "s1",
					name: "空关键词",
					content: "正文",
					keywords: [" "],
					source: "world-info:测试:2",
				},
			]),
		).toThrow("keywords 不能包含空字符串");
		expect(() =>
			store.insertLoreEntries([
				{
					storyId: "s1",
					entityId: foreign.id,
					name: "跨故事",
					content: "正文",
					source: "world-info:测试:3",
				},
			]),
		).toThrow("与实体所属故事不一致");
	});
});

function seedLore(store: StoryStore): void {
	const shanmen = store.upsertEntity({
		storyId: "s1",
		kind: "lore",
		name: "山门",
		source: "test",
		aliases: ["石门"],
	});
	const harbor = store.upsertEntity({
		storyId: "s1",
		kind: "lore",
		name: "海港",
		source: "test",
	});
	store.insertLoreEntries([
		{
			id: "constant",
			storyId: "s1",
			name: "世界规则",
			content: "常驻规则。",
			constant: true,
			keywords: [],
			source: "test:constant",
		},
		{
			id: "shanmen",
			storyId: "s1",
			entityId: shanmen.id,
			name: "山门",
			content: "山门由山神看守。",
			keywords: ["山门"],
			source: "test:shanmen",
		},
		{
			id: "harbor",
			storyId: "s1",
			entityId: harbor.id,
			name: "海港",
			content: "海港终年下雨。",
			keywords: ["码头"],
			source: "test:harbor",
		},
	]);
}

describe("createLoreSlotProvider", () => {
	it("常驻条目每轮都出现，非恒常条目只在关键词或实体命中时出现", async () => {
		const { store } = openTempStore();
		seedStory(store);
		seedLore(store);
		const provider = createLoreSlotProvider(store);

		const atShanmen = await provider.provide(request("s1", "u1", "lore"));
		expect(atShanmen?.source).toBe("lore:常驻 1 条、检索 1 条");
		expect(atShanmen?.messages[0]?.content).toContain("世界规则：常驻规则。");
		expect(atShanmen?.messages[0]?.content).toContain("山门：山门由山神看守。");
		expect(atShanmen?.messages[0]?.content).not.toContain("海港");

		store.appendNode({
			id: "u2",
			storyId: "s1",
			parentId: "u1",
			role: "user",
			raw: "我站在石门前面。",
		});
		const byAlias = await provider.provide(request("s1", "u2", "lore"));
		expect(byAlias?.source).toBe("lore:常驻 1 条、检索 1 条");
		expect(byAlias?.messages[0]?.content).toContain("山门由山神看守。");

		store.appendNode({
			id: "u3",
			storyId: "s1",
			parentId: "u1",
			role: "user",
			raw: "我去码头看看。",
		});
		const byKeyword = await provider.provide(request("s1", "u3", "lore"));
		expect(byKeyword?.messages[0]?.content).toContain("海港终年下雨。");
		expect(byKeyword?.messages[0]?.content).not.toContain("山门由山神看守。");
	});

	it("同一实体或同一正文只出现一次，没有命中且没有常驻条目时返回 null", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const entity = store.upsertEntity({
			storyId: "s1",
			kind: "lore",
			name: "甲",
			source: "test",
		});
		store.insertLoreEntries([
			{
				id: "dup-content-a",
				storyId: "s1",
				name: "甲",
				content: "相同正文。",
				keywords: ["正文"],
				source: "test:a",
			},
			{
				id: "dup-content-b",
				storyId: "s1",
				name: "乙",
				content: "相同正文。",
				keywords: ["正文"],
				source: "test:b",
			},
			{
				id: "dup-entity-a",
				storyId: "s1",
				entityId: entity.id,
				name: "甲",
				content: "甲的另一种说法。",
				keywords: ["甲"],
				source: "test:c",
			},
			{
				id: "dup-entity-b",
				storyId: "s1",
				entityId: entity.id,
				name: "甲",
				content: "甲的第三种说法。",
				keywords: ["甲"],
				source: "test:d",
			},
		]);
		store.appendNode({
			id: "u2",
			storyId: "s1",
			parentId: "u1",
			role: "user",
			raw: "我看着甲，想起相同正文。",
		});
		const provider = createLoreSlotProvider(store);
		const content = await provider.provide(request("s1", "u2", "lore"));
		expect(content?.source).toBe("lore:常驻 0 条、检索 2 条");
		expect(content?.messages[0]?.content).toContain("相同正文。");
		expect(content?.messages[0]?.content).toContain("甲的另一种说法。");
		expect(content?.messages[0]?.content).not.toContain("甲的第三种说法。");

		store.appendNode({
			id: "u3",
			storyId: "s1",
			parentId: "u2",
			role: "user",
			raw: "什么都没有发生。",
		});
		expect(await provider.provide(request("s1", "u3", "lore"))).toBeNull();
	});

	it("超出预算时先裁靠后的检索条目，常驻条目最后才裁", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const entity = store.upsertEntity({
			storyId: "s1",
			kind: "lore",
			name: "山门",
			source: "test",
		});
		store.insertLoreEntries([
			{
				id: "constant",
				storyId: "s1",
				name: "规则",
				content: "常驻内容",
				constant: true,
				source: "test:constant",
			},
			{
				id: "first",
				storyId: "s1",
				entityId: entity.id,
				name: "甲",
				content: "甲内容",
				keywords: ["山门"],
				source: "test:first",
			},
			{
				id: "second",
				storyId: "s1",
				name: "乙",
				content: "乙内容",
				keywords: ["山门"],
				source: "test:second",
			},
		]);
		const provider = createLoreSlotProvider(store, {
			tokenEstimator: (text) => text.length,
		});
		const header = "世界书条目：";
		const constantLine = "【常驻】规则：常驻内容";
		const firstLine = "【检索】甲：甲内容";

		const trimmedTail = await provider.provide(request("s1", "u1", "lore"));
		expect(trimmedTail?.source).toBe("lore:常驻 1 条、检索 2 条");

		const noRetrieved = createLoreSlotProvider(store, {
			tokenLimit: header.length + constantLine.length,
			tokenEstimator: (text) => text.length,
		});
		const keptConstant = await noRetrieved.provide(request("s1", "u1", "lore"));
		expect(keptConstant?.source).toBe("lore:常驻 1 条、检索 0 条");
		expect(keptConstant?.messages[0]?.content).toBe(
			`${header}\n${constantLine}`,
		);

		const noConstant = createLoreSlotProvider(store, {
			tokenLimit: header.length + constantLine.length - 1,
			tokenEstimator: (text) => text.length,
		});
		expect(await noConstant.provide(request("s1", "u1", "lore"))).toBeNull();

		const twoRetrieved = createLoreSlotProvider(store, {
			tokenLimit: header.length + constantLine.length + firstLine.length,
			tokenEstimator: (text) => text.length,
		});
		const keptOne = await twoRetrieved.provide(request("s1", "u1", "lore"));
		expect(keptOne?.source).toBe("lore:常驻 1 条、检索 1 条");
	});
});

describe("createDirectorSlotProvider", () => {
	function appendChain(
		store: StoryStore,
		count: number,
		parentId: string,
	): string {
		let parent = parentId;
		for (let index = 0; index < count; index += 1) {
			const node = store.appendNode({
				id: `c${index}`,
				storyId: "s1",
				parentId: parent,
				role: "assistant",
				raw: `第 ${index} 楼。`,
			});
			parent = node.id;
		}
		return parent;
	}

	it("线索超过年龄阈值时给出一条【导演】消息，并写入决策记录", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.insertPlotNotes([
			{ storyId: "s1", sourceNodeId: "a1", text: "井底的脚步声" },
		]);
		const current = appendChain(store, 13, "u1");

		const provider = createDirectorSlotProvider(store);
		const content = await provider.provide(request("s1", current, "director"));
		expect(content?.source).toBe("director:clue");
		expect(content?.messages).toHaveLength(1);
		const text = content?.messages[0]?.content as string;
		expect(text.startsWith("【导演】")).toBe(true);
		expect(text).toContain("井底的脚步声");

		const decision = store.getDirectorDecision(current);
		expect(decision?.directive).toBe(text.slice("【导演】".length));
		expect(decision?.mechanisms).toEqual([
			{
				name: "clue",
				triggered: true,
				reason: expect.stringContaining("超过阈值 12"),
			},
			expect.objectContaining({ name: "opening", triggered: false }),
			expect.objectContaining({ name: "repetition", triggered: false }),
			{ name: "event_pool", triggered: false, reason: "事件池为空" },
			expect.objectContaining({ name: "pacing", triggered: false }),
		]);

		expect(
			await provider.provide(request("s1", current, "director")),
		).toMatchObject({ source: "director:clue" });
		expect(
			store
				.getDirectorDecisionsAlongPath(current)
				.filter((item) => item.nodeId === current),
		).toHaveLength(1);
	});

	it("线索未到阈值时返回 null，但仍写入一条没有指令的决策记录", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.insertPlotNotes([
			{ storyId: "s1", sourceNodeId: "u1", text: "刚埋下的伏笔" },
		]);
		const provider = createDirectorSlotProvider(store);
		expect(await provider.provide(request("s1", "u1", "director"))).toBeNull();
		const decision = store.getDirectorDecision("u1");
		expect(decision?.directive).toBeNull();
		expect(decision?.mechanisms[0]?.triggered).toBe(false);
	});

	it("导演关闭时返回 null 且不写决策记录", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.insertPlotNotes([
			{ storyId: "s1", sourceNodeId: "a1", text: "井底的脚步声" },
		]);
		const current = appendChain(store, 13, "u1");
		const provider = createDirectorSlotProvider(store, {
			config: { ...DEFAULT_DIRECTOR_CONFIG, enabled: false },
		});
		expect(
			await provider.provide(request("s1", current, "director")),
		).toBeNull();
		expect(store.getDirectorDecision(current)).toBeNull();
	});

	it("其他分支上的笔记不参与评估", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const mainNotes = store.insertPlotNotes([
			{ storyId: "s1", sourceNodeId: "a1", text: "主线伏笔" },
		]);
		store.appendNode({
			id: "b1",
			storyId: "s1",
			parentId: "u1",
			role: "assistant",
			raw: "另一条分支。",
		});
		store.insertPlotNotes([
			{ storyId: "s1", sourceNodeId: "b1", text: "分支伏笔" },
		]);
		store.appendNode({
			id: "a2",
			storyId: "s1",
			parentId: "u1",
			role: "assistant",
			raw: "留在主线的回复。",
		});
		store.setHead("s1", "a2");

		const provider = createDirectorSlotProvider(store, {
			config: {
				...DEFAULT_DIRECTOR_CONFIG,
				enabled: true,
				clueAgeWarning: 0,
			},
		});
		const content = await provider.provide(request("s1", "a2", "director"));
		expect(content?.messages[0]?.content).toContain("主线伏笔");
		expect(content?.messages[0]?.content).not.toContain("分支伏笔");
		expect(store.getDirectorDecision("a2")?.signals).toMatchObject({
			openClues: 1,
			selectedNoteId: mainNotes[0]?.id,
		});
	});
});
