import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	COMPRESSION_SECTION_KEYS,
	type CompressionSections,
	LATEST_SCHEMA_VERSION,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	createDefaultBackgroundJobRegistry,
	createLorePrefilterHandler,
	createLoreSlotProvider,
	parseLorePrefilterSelection,
	rankLoreEntriesByBm25,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_TIME = "2026-11-12T12:00:00.000Z";

function append(
	store: StoryStore,
	id: string,
	parentId: string | null,
	role: "system" | "user" | "assistant",
	raw: string,
): void {
	store.appendNode({ id, storyId: "s1", parentId, role, raw });
}

function fakeResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: {
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cachedTokens: null,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

function scriptedClient(texts: readonly string[]): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	return {
		requests,
		client: {
			async complete(request) {
				const text = texts[requests.length];
				if (text === undefined) {
					throw new Error(`模型调用次数超过脚本：第 ${requests.length + 1} 次`);
				}
				requests.push(request);
				return fakeResult(text);
			},
		},
	};
}

function jobAt(nodeId: string, kind = "lore_prefilter"): BackgroundJob {
	return {
		id: 1,
		storyId: "s1",
		nodeId,
		kind,
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: FIXED_TIME,
		startedAt: FIXED_TIME,
		finishedAt: null,
	};
}

function compressionSections(): CompressionSections {
	const sections = {} as Record<string, string>;
	for (const key of COMPRESSION_SECTION_KEYS) {
		sections[key] = `${key}正文`;
	}
	sections.剧情脉络 = "码头暗藏密道";
	return sections as CompressionSections;
}

function seedLore(store: StoryStore): void {
	store.insertLoreEntries([
		{
			id: "constant",
			storyId: "s1",
			name: "世界规则",
			content: "常驻规则。",
			constant: true,
			source: "test:constant",
		},
		{
			id: "harbor",
			storyId: "s1",
			name: "海港",
			content: "海港终年下雨。",
			keywords: ["码头", "渔夫"],
			source: "test:harbor",
		},
		{
			id: "shanmen",
			storyId: "s1",
			name: "山门",
			content: "山门由山神看守。",
			keywords: ["山门"],
			source: "test:shanmen",
		},
	]);
}

function seedTurn(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
	append(store, "a1", null, "assistant", "开场");
	append(store, "u1", "a1", "user", "我想去码头找老渔夫，也想看看山门");
	append(store, "a2", "u1", "assistant", "你走到码头。");
}

describe("世界书 BM25 预筛排序", () => {
	it("按二字窗口给命中的非恒常条目打分，分数相同时保持输入顺序", () => {
		const { store } = openTempStore();
		seedTurn(store);
		seedLore(store);
		const entries = store
			.listLoreEntries("s1")
			.filter((entry) => !entry.constant);
		const ranked = rankLoreEntriesByBm25(
			entries,
			"我想去码头找老渔夫，也想看看山门",
			20,
		);
		expect(ranked.map((match) => match.entry.id)).toEqual([
			"harbor",
			"shanmen",
		]);
		expect(ranked[0]?.score ?? 0).toBeGreaterThan(ranked[1]?.score ?? 0);
	});

	it("查询没有可用二字窗口时返回空数组", () => {
		const { store } = openTempStore();
		seedTurn(store);
		seedLore(store);
		const entries = store
			.listLoreEntries("s1")
			.filter((entry) => !entry.constant);
		expect(rankLoreEntriesByBm25(entries, "啊", 20)).toEqual([]);
	});
});

describe("lore_prefilter 处理器", () => {
	it("用玩家消息、最近压缩与下一拍方案构造请求并覆盖写入同一楼层", async () => {
		const { store, path } = openTempStore();
		seedTurn(store);
		seedLore(store);
		store.insertChapterCompression({
			storyId: "s1",
			level: "chapter",
			startNodeId: "a1",
			endNodeId: "a2",
			sections: compressionSections(),
		});
		store.replaceDirectorPlan("s1", {
			arcs: [
				{
					id: "arc-1",
					title: "码头风波",
					throughLine: "主角追查码头的秘密",
					difficulty: 0.4,
					redLines: [],
					sequences: [
						{
							id: "seq-1",
							title: "初到码头",
							beats: [
								{
									id: "beat-1",
									goal: "在码头找到老渔夫",
									entrySigns: ["码头有人盯着主角"],
									fitPoints: ["老渔夫认得主角的姓名"],
								},
							],
						},
					],
				},
			],
		});
		const { client, requests } = scriptedClient([
			JSON.stringify({ entryIds: ["harbor"] }),
			JSON.stringify({ entryIds: [] }),
		]);
		const handler = createLorePrefilterHandler();

		await handler({ store, client, job: jobAt("a2") });
		const first = store.getLorePrefilter("a2");
		expect(first?.entryIds).toEqual(["harbor"]);
		expect(requests).toHaveLength(1);
		const content = requests[0]?.messages.find((item) => item.role === "user")
			?.content as string;
		expect(content).toContain("我想去码头找老渔夫，也想看看山门");
		expect(content).toContain("码头暗藏密道");
		expect(content).toContain("在码头找到老渔夫");
		expect(content).toContain('id="harbor"');
		expect(content).toContain('id="shanmen"');
		expect(content).not.toContain("常驻规则。");

		await handler({ store, client, job: jobAt("a2") });
		expect(store.getLorePrefilter("a2")?.entryIds).toEqual([]);
		expect(requests).toHaveLength(2);
		const db = new Database(path, { readonly: true });
		const row = db
			.prepare("SELECT COUNT(*) AS count FROM lore_prefilter WHERE node_id = ?")
			.get("a2") as { readonly count: number };
		db.close();
		expect(row.count).toBe(1);
	});

	it("候选为空时不调用模型并写入空结果", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试故事" });
		append(store, "a1", null, "assistant", "开场");
		store.insertLoreEntries([
			{
				id: "constant",
				storyId: "s1",
				name: "世界规则",
				content: "常驻规则。",
				constant: true,
				source: "test:constant",
			},
		]);
		const handler = createLorePrefilterHandler();
		const { client, requests } = scriptedClient([]);
		await handler({ store, client, job: jobAt("a1") });
		expect(requests).toHaveLength(0);
		expect(store.getLorePrefilter("a1")?.entryIds).toEqual([]);
	});

	it("历史助手楼层的任务直接完成，不调用模型也不写结果", async () => {
		const { store } = openTempStore();
		seedTurn(store);
		seedLore(store);
		const handler = createLorePrefilterHandler();
		const { client, requests } = scriptedClient([]);
		await handler({ store, client, job: jobAt("a1") });
		expect(requests).toHaveLength(0);
		expect(store.getLorePrefilter("a1")).toBeNull();
	});

	it("未知 id、重复 id 与多余字段都整次拒绝", () => {
		expect(() =>
			parseLorePrefilterSelection(JSON.stringify({ entryIds: ["missing"] }), [
				"harbor",
			]),
		).toThrow("不在候选条目里");
		expect(() =>
			parseLorePrefilterSelection(
				JSON.stringify({ entryIds: ["harbor", "harbor"] }),
				["harbor"],
			),
		).toThrow("重复");
		expect(() =>
			parseLorePrefilterSelection(
				JSON.stringify({ entryIds: [], extra: true }),
				["harbor"],
			),
		).toThrow("未知字段");
	});

	it("后台模型输出非法时不写入任何预筛结果", async () => {
		const { store } = openTempStore();
		seedTurn(store);
		seedLore(store);
		const handler = createLorePrefilterHandler();
		const { client } = scriptedClient([
			JSON.stringify({ entryIds: ["missing"] }),
		]);
		await expect(handler({ store, client, job: jobAt("a2") })).rejects.toThrow(
			"不在候选条目里",
		);
		expect(store.getLorePrefilter("a2")).toBeNull();
	});
});

describe("世界书槽位读取预筛结果", () => {
	it("有预筛记录时只注入常驻条目与预筛选中的条目", async () => {
		const { store } = openTempStore();
		seedTurn(store);
		seedLore(store);
		store.saveLorePrefilter({
			nodeId: "a1",
			storyId: "s1",
			entryIds: ["harbor"],
		});
		const provider = createLoreSlotProvider(store);
		const content = await provider.provide({
			slot: "lore",
			storyId: "s1",
			nodeId: "u1",
			switches: {},
			state: undefined,
		});
		expect(content?.source).toBe("lore:常驻 1 条、检索 1 条");
		expect(content?.messages[0]?.content).toContain("世界规则：常驻规则。");
		expect(content?.messages[0]?.content).toContain("海港：海港终年下雨。");
		expect(content?.messages[0]?.content).not.toContain("山门由山神看守。");
	});

	it("没有预筛记录时退回关键词与实体命中", async () => {
		const { store } = openTempStore();
		seedTurn(store);
		seedLore(store);
		const provider = createLoreSlotProvider(store);
		const content = await provider.provide({
			slot: "lore",
			storyId: "s1",
			nodeId: "u1",
			switches: {},
			state: undefined,
		});
		expect(content?.messages[0]?.content).toContain("山门由山神看守。");
		expect(content?.messages[0]?.content).toContain("海港终年下雨。");
	});

	it("只读取参照楼层路径上的预筛记录，其他分支不参与", async () => {
		const { store } = openTempStore();
		seedTurn(store);
		seedLore(store);
		append(store, "a2b", "u1", "assistant", "另一条分支。");
		append(store, "u2", "a2", "user", "我继续留在码头。");
		append(store, "u1b", "a2b", "user", "我走向山门。");
		store.saveLorePrefilter({
			nodeId: "a2",
			storyId: "s1",
			entryIds: ["harbor"],
		});
		store.saveLorePrefilter({
			nodeId: "a2b",
			storyId: "s1",
			entryIds: ["shanmen"],
		});
		store.setHead("s1", "a2b");
		const provider = createLoreSlotProvider(store);

		const main = await provider.provide({
			slot: "lore",
			storyId: "s1",
			nodeId: "u2",
			switches: {},
			state: undefined,
		});
		expect(main?.messages[0]?.content).toContain("海港终年下雨。");
		expect(main?.messages[0]?.content).not.toContain("山门由山神看守。");

		const branch = await provider.provide({
			slot: "lore",
			storyId: "s1",
			nodeId: "u1b",
			switches: {},
			state: undefined,
		});
		expect(branch?.messages[0]?.content).toContain("山门由山神看守。");
		expect(branch?.messages[0]?.content).not.toContain("海港终年下雨。");
	});
});

describe("世界书预筛存储与任务注册", () => {
	it("迁移到 v37，重复写入覆盖同一行，跨故事写入被拒绝", () => {
		const { store } = openTempStore();
		seedTurn(store);
		store.createStory({ id: "s2", title: "另一个故事" });
		expect(store.getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION);
		store.saveLorePrefilter({
			nodeId: "a2",
			storyId: "s1",
			entryIds: ["harbor"],
		});
		store.saveLorePrefilter({
			nodeId: "a2",
			storyId: "s1",
			entryIds: ["harbor", "shanmen"],
		});
		expect(store.getLorePrefilter("a2")?.entryIds).toEqual([
			"harbor",
			"shanmen",
		]);
		expect(() =>
			store.saveLorePrefilter({
				nodeId: "a2",
				storyId: "s2",
				entryIds: [],
			}),
		).toThrow("与楼层所属故事不一致");
		expect(() =>
			store.saveLorePrefilter({
				nodeId: "a2",
				storyId: "s1",
				entryIds: ["harbor", "harbor"],
			}),
		).toThrow("重复");
	});

	it("默认注册表包含 gap 档、settled 入队的 lore_prefilter", () => {
		const registry = createDefaultBackgroundJobRegistry();
		expect(registry.get("lore_prefilter")?.tier).toBe("gap");
		expect(registry.get("lore_prefilter")?.enqueue).toBe("settled");
	});
});
