import { describe, expect, it } from "vitest";
import {
	DEEP_ONLY_READ_TOOLS,
	READ_TOOLS,
	type ReadToolContext,
	executeReadTool,
	validateReadToolArguments,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function seedStory(): { contextOf: (nodeId: string) => ReadToolContext } {
	const { store } = openTempStore();
	store.createStory({ id: "s1", title: "读取工具" });
	store.appendNode({
		id: "n-root",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "青铜匕首藏在井底。",
	});
	store.appendNode({
		id: "n-user",
		storyId: "s1",
		parentId: "n-root",
		role: "user",
		raw: "我顺着绳子下井。",
	});
	store.appendNode({
		id: "n-assistant",
		storyId: "s1",
		parentId: "n-user",
		role: "assistant",
		raw: "你找到了青铜匕首。",
	});
	store.appendNode({
		id: "n-current",
		storyId: "s1",
		parentId: "n-assistant",
		role: "user",
		raw: "我抬头看向井口。",
	});
	store.insertMemoryEvents([
		{
			storyId: "s1",
			sourceNodeId: "n-root",
			ordinal: 0,
			participants: ["我"],
			importance: 0.9,
			knowers: [],
			text: "匕首藏在井底",
		},
	]);
	const entity = store.upsertEntity({
		storyId: "s1",
		kind: "character",
		name: "山神",
		description: "看守山门的神灵",
		source: "test",
		aliases: ["山君"],
	});
	store.insertLoreEntries([
		{
			storyId: "s1",
			entityId: entity.id,
			name: "山门",
			content: "山门由山神看守，夜里才开。",
			keywords: ["山门"],
			source: "world-info:测试:0",
		},
		{
			storyId: "s1",
			name: "集市",
			content: "集市在城南。",
			keywords: ["集市"],
			source: "world-info:测试:1",
		},
	]);
	store.appendStateDiffs([
		{
			storyId: "s1",
			nodeId: "n-assistant",
			path: ["场景", "地点"],
			op: "set",
			value: "井底",
			source: "test",
		},
		{
			storyId: "s1",
			nodeId: "n-assistant",
			path: ["角色", "山神", "好感度"],
			op: "set",
			value: 12,
			source: "test",
		},
		{
			storyId: "s1",
			nodeId: "n-assistant",
			path: ["character", "山神", "status"],
			op: "set",
			value: "守夜",
			source: "model",
			storyTime: { start: "子时", end: null },
			confidence: 0.8,
		},
		{
			storyId: "s1",
			nodeId: "n-assistant",
			path: ["clue", "井底匕首", "status"],
			op: "set",
			value: "open",
			source: "model",
		},
	]);
	return {
		store,
		contextOf: (nodeId) => ({
			store,
			storyId: "s1",
			beforeNodeId: nodeId,
		}),
	};
}

describe("读取工具", () => {
	it("memory_search 返回事件与原文片段，并带当前路径", async () => {
		const { contextOf } = seedStory();
		const args = validateReadToolArguments("memory_search", {
			query: "青铜匕首",
			limit: 6,
		});
		const content = await executeReadTool(
			"memory_search",
			args,
			contextOf("n-current"),
		);
		expect(content).toContain("记忆检索结果（查询：青铜匕首）");
		expect(content).toContain("匕首藏在井底");
		expect(content).toContain("你找到了青铜匕首");
	});

	it("lore_lookup 按关键词与实体别名返回条目和实体", async () => {
		const { contextOf } = seedStory();
		const context = contextOf("n-current");
		const byKeyword = await executeReadTool(
			"lore_lookup",
			validateReadToolArguments("lore_lookup", { query: "山门" }),
			context,
		);
		expect(byKeyword).toContain("世界书条目：");
		expect(byKeyword).toContain("山门：山门由山神看守");
		expect(byKeyword).not.toContain("实体：");

		const byEntity = await executeReadTool(
			"lore_lookup",
			validateReadToolArguments("lore_lookup", { query: "山神" }),
			context,
		);
		expect(byEntity).toContain("实体：");
		expect(byEntity).toContain("山神（character）");
		expect(byEntity).toContain("山门：山门由山神看守");

		const byAlias = await executeReadTool(
			"lore_lookup",
			validateReadToolArguments("lore_lookup", { query: "山君" }),
			context,
		);
		expect(byAlias).toContain("山门：山门由山神看守");
		expect(byAlias).toContain("山神（character）");

		const missing = await executeReadTool(
			"lore_lookup",
			validateReadToolArguments("lore_lookup", { query: "不存在的词" }),
			context,
		);
		expect(missing).toBe("没有匹配的世界书条目或实体（查询：不存在的词）。");
	});

	it("state_get 读取完整快照与指定路径", async () => {
		const { contextOf } = seedStory();
		const context = contextOf("n-current");
		const full = await executeReadTool(
			"state_get",
			validateReadToolArguments("state_get", {}),
			context,
		);
		expect(full).toContain('"地点": "井底"');
		expect(full).toContain('"好感度": 12');

		const value = await executeReadTool(
			"state_get",
			validateReadToolArguments("state_get", {
				path: ["角色", "山神", "好感度"],
			}),
			context,
		);
		expect(value).toBe("路径 「角色」「山神」「好感度」 的值：\n12");

		const missing = await executeReadTool(
			"state_get",
			validateReadToolArguments("state_get", { path: ["角色", "卫宫"] }),
			context,
		);
		expect(missing).toBe("路径 「角色」「卫宫」 不存在。");
	});

	it("ledger_read 按前缀读取台账事实与元数据", async () => {
		const { contextOf } = seedStory();
		const context = contextOf("n-current");
		const full = await executeReadTool(
			"ledger_read",
			validateReadToolArguments("ledger_read", {}),
			context,
		);
		expect(full).toContain('「character」「山神」「status」 = "守夜"');
		expect(full).toContain("来源：model");
		expect(full).toContain("故事时间：子时 至 …");
		expect(full).toContain("楼层：n-assistant");
		expect(full).toContain('「clue」「井底匕首」「status」 = "open"');

		const prefix = await executeReadTool(
			"ledger_read",
			validateReadToolArguments("ledger_read", {
				prefix: ["character", "山神"],
			}),
			context,
		);
		expect(prefix).toContain("「character」「山神」「status」");
		expect(prefix).not.toContain("「clue」");

		const missing = await executeReadTool(
			"ledger_read",
			validateReadToolArguments("ledger_read", { prefix: ["item"] }),
			context,
		);
		expect(missing).toBe("台账前缀 「item」没有事实。");
	});

	it("history_read 读取最近楼层与祖先楼层，拒绝其他分支", async () => {
		const { store, contextOf } = seedStory();
		store.appendNode({
			id: "n-other",
			storyId: "s1",
			parentId: "n-root",
			role: "assistant",
			raw: "另一条分支。",
		});
		const context = contextOf("n-current");

		const recent = await executeReadTool(
			"history_read",
			validateReadToolArguments("history_read", { count: 2 }),
			context,
		);
		expect(recent).toContain("当前路径最近 2 楼");
		expect(recent).toContain("n-assistant");
		expect(recent).toContain("n-current");
		expect(recent).not.toContain("n-root");

		const ancestor = await executeReadTool(
			"history_read",
			validateReadToolArguments("history_read", { nodeId: "n-root" }),
			context,
		);
		expect(ancestor).toContain("n-root");
		expect(ancestor).toContain("青铜匕首藏在井底。");

		await expect(
			executeReadTool(
				"history_read",
				validateReadToolArguments("history_read", { nodeId: "n-other" }),
				context,
			),
		).rejects.toThrow("不在当前路径上");
	});

	it("参数校验拒绝缺失、未知字段与越界值", () => {
		expect(() =>
			validateReadToolArguments("memory_search", { limit: 3 }),
		).toThrow("memory_search.query 必须是非空字符串");
		expect(() =>
			validateReadToolArguments("memory_search", {
				query: "山门",
				viewpoint: "山神",
			}),
		).toThrow("memory_search 不接受参数 viewpoint");
		expect(() =>
			validateReadToolArguments("memory_search", { query: "山门", limit: 0 }),
		).toThrow("memory_search.limit 必须是 1 到 12 之间的整数");
		expect(() => validateReadToolArguments("state_get", { path: [] })).toThrow(
			"state_get.path 必须是非空的字符串数组",
		);
		expect(() =>
			validateReadToolArguments("state_get", { path: ["场景", ""] }),
		).toThrow("state_get.path 的每一段都必须是非空字符串");
		expect(() => validateReadToolArguments("lore_lookup", "山门")).toThrow(
			"lore_lookup 的参数必须是 JSON 对象",
		);
		expect(() =>
			validateReadToolArguments("ledger_read", { prefix: [] }),
		).toThrow("ledger_read.prefix 必须是非空的字符串数组");
		expect(() =>
			validateReadToolArguments("history_read", { nodeId: "" }),
		).toThrow("history_read.nodeId 必须是非空字符串");
		expect(() =>
			validateReadToolArguments("history_read", { count: 21 }),
		).toThrow("history_read.count 必须是 1 到 20 之间的整数");
	});

	it("工具定义带 JSON Schema、权限与进度阶段", () => {
		expect(READ_TOOLS.map((tool) => tool.name)).toEqual([
			"memory_search",
			"lore_lookup",
			"state_get",
			"ledger_read",
		]);
		for (const tool of READ_TOOLS) {
			expect(tool.parameters).toMatchObject({ type: "object" });
			expect(tool.description.length).toBeGreaterThan(0);
			expect(tool.permission).toBe("read");
			expect(tool.progressLabel.length).toBeGreaterThan(0);
		}
		expect(DEEP_ONLY_READ_TOOLS.map((tool) => tool.name)).toEqual([
			"history_read",
		]);
	});
});
