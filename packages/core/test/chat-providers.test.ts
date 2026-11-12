import { describe, expect, it } from "vitest";
import {
	COMPRESSION_SECTION_KEYS,
	type CompressionSectionKey,
	type CompressionSections,
	type ContextSlotRequest,
	assembleContext,
	createCharacterSlotProvider,
	createDefaultContextTemplate,
	createHistorySlotProvider,
	createMemorySlotProvider,
	createStandardChatSlots,
	createStateSlotProvider,
	createStaticSlotProvider,
	createSummarySlotProvider,
	createTokenEstimator,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function request(
	storyId: string,
	nodeId: string | null,
	slot: ContextSlotRequest["slot"],
): ContextSlotRequest {
	return { slot, storyId, nodeId, switches: {}, state: undefined };
}

function compressionSections(
	overrides: Partial<Record<CompressionSectionKey, string>> = {},
): CompressionSections {
	const sections = {} as Record<CompressionSectionKey, string>;
	for (const key of COMPRESSION_SECTION_KEYS) {
		sections[key] = `${key}正文`;
	}
	return { ...sections, ...overrides };
}

describe("createDefaultContextTemplate", () => {
	it("文本标签模式在协议段说明标签写法", () => {
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		});
		const protocol = template.segments.find(
			(segment) => segment.id === "protocol",
		);
		expect(protocol?.kind).toBe("static");
		if (protocol?.kind !== "static") throw new Error("缺少协议段");
		expect(protocol.text).toContain("<state_update>");
		expect(protocol.text).toContain("<plot_note>");
		expect(template.segments.at(-1)?.id).toBe("protocol");
		expect(protocol.text).toContain("写作契约");
		expect(protocol.text).toContain(
			"玩家输入是本轮演出的指引，不是已经发生的剧情",
		);
		expect(protocol.text).toContain("玩家不是上帝");
		expect(protocol.text).toContain("不重复之前的正文");
		expect(protocol.text).toContain("遵守用户意志");
	});

	it("函数调用模式不在协议段写标签", () => {
		const template = createDefaultContextTemplate({
			structuredOutput: "function-call",
		});
		const protocol = template.segments.find(
			(segment) => segment.id === "protocol",
		);
		if (protocol?.kind !== "static") throw new Error("缺少协议段");
		expect(protocol.text).toContain("工具调用");
		expect(protocol.text).not.toContain("<state_update>");
	});

	it("block_format 关闭时模板与默认模板完全一致", () => {
		const plain = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		});
		const disabled = createDefaultContextTemplate({
			structuredOutput: "text-tags",
			blockFormat: false,
		});
		expect(disabled).toEqual(plain);
		expect(
			plain.segments.some((segment) => segment.id === "block_format"),
		).toBe(false);
	});

	it("block_format 开启后说明两种写入的格式且不强制输出", () => {
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
			blockFormat: true,
		});
		const index = template.segments.findIndex(
			(segment) => segment.id === "block_format",
		);
		const segment = template.segments[index];
		if (segment?.kind !== "static") throw new Error("缺少块格式段");
		expect(index).toBe(
			template.segments.findIndex((item) => item.id === "protocol") - 1,
		);
		expect(segment.text).toContain("<state_update>");
		expect(segment.text).toContain("<plot_note>");
		expect(segment.text).toContain('"path"');
		expect(segment.text).toContain('"text"');
		expect(segment.text).not.toMatch(/必须|务必|一律|一定要/);
		expect(template.segments.at(-1)?.id).toBe("protocol");
	});

	it("函数调用模式下的块格式段不提标签写法", () => {
		const template = createDefaultContextTemplate({
			structuredOutput: "function-call",
			blockFormat: true,
		});
		const segment = template.segments.find(
			(item) => item.id === "block_format",
		);
		if (segment?.kind !== "static") throw new Error("缺少块格式段");
		expect(segment.text).toContain("state_update");
		expect(segment.text).toContain("plot_note");
		expect(segment.text).toContain('"path"');
		expect(segment.text).not.toContain("<state_update>");
		expect(segment.text).not.toMatch(/必须|务必|一律|一定要/);
	});
});

describe("槽位提供者", () => {
	it("历史槽位只带最近若干楼，并按上下文策略删除隐藏块", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "n-greeting",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "山门开了。",
		});
		store.appendNode({
			id: "n-user",
			storyId: "s1",
			parentId: "n-greeting",
			role: "user",
			raw: "我推门进去。",
		});
		store.appendNode({
			id: "n-reply",
			storyId: "s1",
			parentId: "n-user",
			role: "assistant",
			raw: '他说：<thinking>犹豫</thinking>请进。<state_update>{"path":["场景"],"op":"set","value":"山门"}</state_update>',
		});

		const provider = createHistorySlotProvider(store, { limit: 2 });
		const content = await provider.provide(request("s1", "n-reply", "history"));
		expect(content?.source).toBe("history:最近 2 楼");
		expect(content?.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
		expect(content?.messages[0]?.content).toBe("我推门进去。");
		expect(content?.messages[1]?.content).toBe("他说：请进。");
		expect(content?.messages[1]?.content).not.toContain("<state_update>");
	});

	it("历史槽位默认省略更早楼层的显示类块，并在 Trace 里记录省略量", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "n-greeting",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场<选项>甲</选项>",
		});
		store.appendNode({
			id: "n-user",
			storyId: "s1",
			parentId: "n-greeting",
			role: "user",
			raw: "我推门进去。",
		});
		store.appendNode({
			id: "n-reply",
			storyId: "s1",
			parentId: "n-user",
			role: "assistant",
			raw: "请进。<选项>乙</选项>",
		});

		const provider = createHistorySlotProvider(store, {
			limit: 3,
			estimator: (text) => text.length,
		});
		const content = await provider.provide(request("s1", "n-reply", "history"));
		expect(content?.messages.map((message) => message.content)).toEqual([
			"开场",
			"我推门进去。",
			"请进。<选项>乙</选项>",
		]);
		expect(content?.history).toEqual({
			policy: "default",
			recentRawFloors: 1,
			omitted: [{ blockType: "选项", characters: 10, tokens: 10 }],
		});

		const full = createHistorySlotProvider(store, {
			limit: 3,
			estimator: (text) => text.length,
			policy: { mode: "full", overrides: {} },
		});
		const fullContent = await full.provide(request("s1", "n-reply", "history"));
		expect(fullContent?.messages[0]?.content).toBe("开场<选项>甲</选项>");
		expect(fullContent?.history).toEqual({
			policy: "full",
			recentRawFloors: 1,
			omitted: [],
		});
	});

	it("状态槽位回放路径上的 diff", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "n-reply",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "山门开了。",
		});
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "n-reply",
			path: ["场景", "地点"],
			op: "set",
			value: "山门",
			source: "test",
		});

		const provider = createStateSlotProvider(store);
		const content = await provider.provide(request("s1", "n-reply", "state"));
		expect(content?.source).toBe("state:1 条 diff");
		expect(content?.messages[0]?.content).toContain('"地点": "山门"');
	});

	it("没有楼层或没有状态时返回 null", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "n-reply",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "山门开了。",
		});
		const history = createHistorySlotProvider(store);
		const state = createStateSlotProvider(store);
		expect(await history.provide(request("s1", null, "history"))).toBeNull();
		expect(await state.provide(request("s1", "n-reply", "state"))).toBeNull();
	});

	it("静态槽位返回固定消息并拒绝空内容", async () => {
		const provider = createStaticSlotProvider(
			[{ role: "system", content: "你是角色。" }],
			"card:测试",
		);
		const content = await provider.provide(request("s1", null, "character"));
		expect(content).toEqual({
			messages: [{ role: "system", content: "你是角色。" }],
			source: "card:测试",
		});
		expect(() => createStaticSlotProvider([], "card:空")).toThrow("至少");
	});
});

describe("记忆与摘要槽位", () => {
	it("记忆槽位只检索当前楼层之前的路径，同一楼层只出现一次", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "n-greet",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "山门口站着守卫，道路被拦住。",
		});
		store.appendNode({
			id: "n-side",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "山门口的岔路通向树林。",
		});
		store.appendNode({
			id: "n-ask",
			storyId: "s1",
			parentId: "n-greet",
			role: "user",
			raw: "山门口",
		});
		store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "n-greet",
				ordinal: 0,
				participants: ["守卫"],
				importance: 0.9,
				knowers: [],
				text: "守卫拦住了来客",
			},
		]);

		const provider = createMemorySlotProvider(store, { limit: 2 });
		const content = await provider.provide(request("s1", "n-ask", "memory"));
		expect(content?.source).toBe("memory:1");
		expect(content?.messages).toHaveLength(1);
		expect(content?.messages[0]?.role).toBe("system");
		const text = content?.messages[0]?.content ?? "";
		expect(text).toContain("n-greet");
		expect(text).toContain("（原文块）");
		expect(text).toContain("山门口站着守卫，道路被拦住。");
		expect(text.split("n-greet").length - 1).toBe(1);
		expect(text).not.toContain("n-side");
		expect(content?.retrieval?.routes.map((route) => route.route)).toContain(
			"bm25",
		);
		expect(content?.retrieval?.hits[0]?.nodeId).toBe("n-greet");
		expect(content?.retrieval?.injectedNodeIds).toEqual(["n-greet"]);
	});

	it("记忆槽位注入父段而不是整楼，并在 Trace 记录范围", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s-parent", title: "父段" });
		const floor = store.appendNode({
			id: "n-parent",
			storyId: "s-parent",
			parentId: null,
			role: "assistant",
			raw: `${"甲".repeat(700)}\n${"乙".repeat(700)}`,
		});
		store.appendNode({
			id: "n-ask",
			storyId: "s-parent",
			parentId: floor.id,
			role: "user",
			raw: "乙乙乙",
		});

		const provider = createMemorySlotProvider(store, { limit: 2 });
		const content = await provider.provide(
			request("s-parent", "n-ask", "memory"),
		);
		const text = content?.messages[0]?.content ?? "";
		expect(text).toContain("乙".repeat(700));
		expect(text).not.toContain("甲");
		expect(content?.retrieval?.injected).toEqual([
			{
				nodeId: "n-parent",
				kind: "chunk",
				scope: "segment",
				parentOrdinal: 1,
			},
		]);
	});

	it("记忆槽位在没有前置楼层或没有命中时返回 null", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "n-open",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场。",
		});
		store.appendNode({
			id: "n-ask",
			storyId: "s1",
			parentId: "n-open",
			role: "user",
			raw: "无关内容",
		});
		const provider = createMemorySlotProvider(store);
		expect(await provider.provide(request("s1", null, "memory"))).toBeNull();
		expect(
			await provider.provide(request("s1", "n-open", "memory")),
		).toBeNull();
		expect(await provider.provide(request("s1", "n-ask", "memory"))).toBeNull();
	});

	it("摘要槽位返回主线与最近一条章节，并按 token 上限从最久远的开始裁剪", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const floors = [
			["n0", null, "assistant"],
			["n1", "n0", "user"],
			["n2", "n1", "assistant"],
			["n3", "n2", "user"],
			["n4", "n3", "assistant"],
		] as const;
		for (const [id, parentId, role] of floors) {
			store.appendNode({
				id,
				storyId: "s1",
				parentId,
				role,
				raw: `[[${id}]]`,
			});
		}
		store.insertSummary({
			storyId: "s1",
			level: "chapter",
			startNodeId: "n0",
			endNodeId: "n2",
			text: "第一章旧",
		});
		store.insertSummary({
			storyId: "s1",
			level: "mainline",
			startNodeId: "n0",
			endNodeId: "n2",
			text: "主线旧",
		});
		store.insertSummary({
			storyId: "s1",
			level: "chapter",
			startNodeId: "n3",
			endNodeId: "n4",
			text: "第二章新",
		});

		const provider = createSummarySlotProvider(store);
		const content = await provider.provide(request("s1", "n4", "summary"));
		expect(content?.source).toBe("summary:mainline+chapter");
		const text = content?.messages[0]?.content ?? "";
		expect(text).toContain("【主线】主线旧");
		expect(text).toContain("【章节】第二章新");
		expect(text).not.toContain("第一章旧");

		const estimator = createTokenEstimator();
		const tokenLimit = estimator("故事摘要：") + estimator("第二章新");
		const trimmed = createSummarySlotProvider(store, { tokenLimit });
		const trimmedContent = await trimmed.provide(
			request("s1", "n4", "summary"),
		);
		expect(trimmedContent?.source).toBe("summary:chapter");
		const trimmedText = trimmedContent?.messages[0]?.content ?? "";
		expect(trimmedText).toContain("第二章新");
		expect(trimmedText).not.toContain("主线旧");
	});

	it("切换分支后失效摘要不再出现", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const floors = [
			["n0", null, "assistant"],
			["n1", "n0", "user"],
			["n2", "n1", "assistant"],
		] as const;
		for (const [id, parentId, role] of floors) {
			store.appendNode({
				id,
				storyId: "s1",
				parentId,
				role,
				raw: `[[${id}]]`,
			});
		}
		store.insertSummary({
			storyId: "s1",
			level: "chapter",
			startNodeId: "n0",
			endNodeId: "n2",
			text: "旧分支的章节",
		});
		store.appendNode({
			id: "n-side",
			storyId: "s1",
			parentId: "n0",
			role: "assistant",
			raw: "另一条分支。",
		});
		store.setHead("s1", "n-side");

		const provider = createSummarySlotProvider(store);
		expect(
			await provider.provide(request("s1", "n-side", "summary")),
		).toBeNull();
	});

	it("默认模板把两个槽位接进组装器，没有结果时记为 missing-slot", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "n0",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "山门口站着守卫。",
		});
		store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: "n0",
			role: "user",
			raw: "我上前。",
		});
		store.appendNode({
			id: "n2",
			storyId: "s1",
			parentId: "n1",
			role: "assistant",
			raw: "守卫点头。",
		});
		store.appendNode({
			id: "n-ask",
			storyId: "s1",
			parentId: "n2",
			role: "user",
			raw: "山门口",
		});
		store.insertSummary({
			storyId: "s1",
			level: "chapter",
			startNodeId: "n0",
			endNodeId: "n2",
			text: "第一章",
		});

		const assembled = await assembleContext({
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			budgetTokens: 4_000,
			storyId: "s1",
			nodeId: "n-ask",
			providers: {
				memory: createMemorySlotProvider(store),
				summary: createSummarySlotProvider(store),
			},
		});
		const memoryEntry = assembled.trace.entries.find(
			(entry) => entry.segmentId === "memory",
		);
		expect(memoryEntry?.status).toBe("included");
		expect(memoryEntry?.source).toBe("memory:1");
		const summaryEntry = assembled.trace.entries.find(
			(entry) => entry.segmentId === "summary",
		);
		expect(summaryEntry?.status).toBe("included");
		expect(summaryEntry?.source).toBe("summary:chapter");

		store.createStory({ id: "s2", title: "空故事" });
		store.appendNode({
			id: "m0",
			storyId: "s2",
			parentId: null,
			role: "assistant",
			raw: "开场。",
		});
		const empty = await assembleContext({
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			budgetTokens: 4_000,
			storyId: "s2",
			nodeId: "m0",
			providers: {
				memory: createMemorySlotProvider(store),
				summary: createSummarySlotProvider(store),
			},
		});
		for (const segmentId of ["memory", "summary"]) {
			const entry = empty.trace.entries.find(
				(item) => item.segmentId === segmentId,
			);
			expect(entry?.status).toBe("missing-slot");
		}
	});

	it("有有效压缩时注入主线与最近章节压缩，用户意志段不受预算裁剪", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const floors = [
			["n0", null, "assistant"],
			["n1", "n0", "user"],
			["n2", "n1", "assistant"],
			["n3", "n2", "user"],
			["n4", "n3", "assistant"],
		] as const;
		for (const [id, parentId, role] of floors) {
			store.appendNode({
				id,
				storyId: "s1",
				parentId,
				role,
				raw: `[[${id}]]`,
			});
		}
		store.insertSummary({
			storyId: "s1",
			level: "chapter",
			startNodeId: "n0",
			endNodeId: "n4",
			text: "旧摘要文本",
		});
		store.insertChapterCompression({
			storyId: "s1",
			level: "mainline",
			startNodeId: "n0",
			endNodeId: "n2",
			sections: compressionSections({ 剧情脉络: "主线脉络" }),
		});
		store.insertChapterCompression({
			storyId: "s1",
			level: "chapter",
			startNodeId: "n3",
			endNodeId: "n4",
			sections: compressionSections({ 剧情脉络: "章节脉络" }),
		});

		const provider = createSummarySlotProvider(store);
		const content = await provider.provide(request("s1", "n4", "summary"));
		expect(content?.source).toBe("compression:mainline+chapter");
		const text = content?.messages[0]?.content ?? "";
		expect(text).toContain("【主线压缩】");
		expect(text).toContain("【章节压缩】");
		expect(text).toContain("主线脉络");
		expect(text).toContain("章节脉络");
		expect(text).not.toContain("旧摘要文本");

		const trimmed = createSummarySlotProvider(store, {
			compressionTokenLimit: 5,
		});
		const trimmedContent = await trimmed.provide(
			request("s1", "n4", "summary"),
		);
		expect(trimmedContent?.source).toBe("compression:mainline+chapter");
		const trimmedText = trimmedContent?.messages[0]?.content ?? "";
		expect(trimmedText).toContain("【主线压缩·用户意志】");
		expect(trimmedText).toContain("【章节压缩·用户意志】");
		expect(trimmedText).toContain("用户意志正文");
		expect(trimmedText).not.toContain("主线脉络");
		expect(trimmedText).not.toContain("章节脉络");
	});

	it("默认压缩预算容纳实测规模的八段压缩", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const floors = [
			["n0", null, "assistant"],
			["n1", "n0", "user"],
			["n2", "n1", "assistant"],
			["n3", "n2", "user"],
			["n4", "n3", "assistant"],
		] as const;
		for (const [id, parentId, role] of floors) {
			store.appendNode({
				id,
				storyId: "s1",
				parentId,
				role,
				raw: `[[${id}]]`,
			});
		}
		const long = "剧情".repeat(130);
		const sections = {} as Record<CompressionSectionKey, string>;
		for (const key of COMPRESSION_SECTION_KEYS) sections[key] = long;
		store.insertChapterCompression({
			storyId: "s1",
			level: "chapter",
			startNodeId: "n0",
			endNodeId: "n4",
			sections,
		});
		const chapter = store.getValidCompressions("s1", "n4")[0];
		expect(chapter?.tokenCount).toBeGreaterThan(800);
		expect(chapter?.tokenCount).toBeLessThan(2_000);

		const provider = createSummarySlotProvider(store);
		const content = await provider.provide(request("s1", "n4", "summary"));
		const text = content?.messages[0]?.content ?? "";
		expect(text).not.toContain("·用户意志");
		for (const key of COMPRESSION_SECTION_KEYS) {
			expect(text).toContain(`【${key}】`);
		}
	});

	it("分支切换后另一分支的压缩失效，退回该分支的摘要", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const floors = [
			["n0", null, "assistant"],
			["n1", "n0", "user"],
			["n2", "n1", "assistant"],
			["n-side", "n0", "assistant"],
		] as const;
		for (const [id, parentId, role] of floors) {
			store.appendNode({
				id,
				storyId: "s1",
				parentId,
				role,
				raw: `[[${id}]]`,
			});
		}
		store.insertChapterCompression({
			storyId: "s1",
			level: "chapter",
			startNodeId: "n0",
			endNodeId: "n2",
			sections: compressionSections(),
		});
		store.insertSummary({
			storyId: "s1",
			level: "chapter",
			startNodeId: "n0",
			endNodeId: "n-side",
			text: "另一条分支的摘要",
		});
		store.setHead("s1", "n-side");

		const provider = createSummarySlotProvider(store);
		const content = await provider.provide(request("s1", "n-side", "summary"));
		expect(content?.source).toBe("summary:chapter");
		expect(content?.messages[0]?.content).toContain("另一条分支的摘要");
		expect(content?.messages[0]?.content).not.toContain("章节压缩");
	});
});

describe("角色与标准槽位", () => {
	it("角色槽位返回保存的提示词，来源只记录长度", async () => {
		const provider = createCharacterSlotProvider("你扮演山神。");
		const content = await provider.provide(request("s1", null, "character"));
		expect(content?.messages).toEqual([
			{ role: "system", content: "你扮演山神。" },
		]);
		expect(content?.source).toBe("character:6 字符");
	});

	it("空提示词直接抛错", () => {
		expect(() => createCharacterSlotProvider("   ")).toThrow(
			"角色提示词必须是非空字符串",
		);
	});

	it("标准集合包含九个槽位，character 使用传入的提示词", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "山神" });
		const { providers } = await createStandardChatSlots({
			store,
			characterPrompt: "你扮演山神。",
		});
		expect(Object.keys(providers).sort()).toEqual([
			"character",
			"director",
			"history",
			"lore",
			"memory",
			"scene",
			"state",
			"summary",
			"user_will",
		]);
		const content = await providers.character?.provide(
			request("s1", null, "character"),
		);
		expect(content?.messages[0]?.content).toBe("你扮演山神。");
	});
});
