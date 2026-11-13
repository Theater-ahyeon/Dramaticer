import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import type {
	AssistantChannelsSnapshot,
	AssistantSearchClient,
	DeepToolDefinition,
	JsonObject,
} from "../src/index.js";
import {
	AssistantActionPayloadError,
	StoryStore,
	approveAssistantAction,
	createAssistantSetupTools,
	createDefaultContextTemplate,
	createHttpAssistantSearchClient,
	rejectAssistantAction,
} from "../src/index.js";

function openTempStore(): StoryStore {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-assistant-setup-")),
		"story.db",
	);
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(path), { recursive: true, force: true, maxRetries: 5 });
	});
	return store;
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
	store.updateStorySettings("story-1", {
		cardName: "守门人",
		characterPrompt: "守门人沉默寡言。",
		persona: "旅人",
	});
	store.upsertEntity({
		storyId: "story-1",
		kind: "character",
		name: "守门人",
		description: "住在山门旁。",
		source: "test",
		aliases: ["老守"],
	});
	store.insertLoreEntries([
		{
			storyId: "story-1",
			name: "山门",
			content: "山门每夜闭合。",
			source: "test",
		},
	]);
}

function findTool(
	tools: readonly DeepToolDefinition[],
	name: string,
): DeepToolDefinition {
	const tool = tools.find((candidate) => candidate.name === name);
	if (tool === undefined) throw new Error(`没有工具 ${name}`);
	return tool;
}

async function run(
	tool: DeepToolDefinition,
	args: JsonObject = {},
): Promise<string> {
	const output = await tool.execute?.(args);
	return String(output);
}

function setupTools(
	store: StoryStore,
	options: {
		readonly permission?: "read_only" | "confirm" | "auto";
		readonly searchClient?: AssistantSearchClient;
		readonly readChannels?: () => Promise<AssistantChannelsSnapshot>;
	},
): readonly DeepToolDefinition[] {
	const conversation = store.createAssistantConversation({
		storyId: "story-1",
		skill: "research",
		...(options.permission === undefined
			? {}
			: { permission: options.permission }),
	});
	return createAssistantSetupTools({
		store,
		storyId: "story-1",
		conversationId: conversation.id,
		permission: options.permission ?? "confirm",
		searchClient: options.searchClient,
		readChannels: options.readChannels,
	});
}

describe("资料员工具", () => {
	it("HTTP 搜索客户端发送查询并校验响应", async () => {
		const requests: { readonly url: string; readonly body: string }[] = [];
		const client = createHttpAssistantSearchClient({
			baseUrl: "https://example.com/search",
			now: () => new Date("2026-11-13T01:02:03.000Z"),
			fetch: async (input, init) => {
				requests.push({
					url: String(input),
					body: String(init?.body),
				});
				return new Response(
					JSON.stringify({
						results: [
							{
								title: "年表",
								url: "https://example.com/timeline",
								snippet: "第三卷。",
							},
						],
					}),
					{ status: 200 },
				);
			},
		});
		const results = await client.search("山门", 3);
		expect(requests).toEqual([
			{
				url: "https://example.com/search",
				body: JSON.stringify({ query: "山门", limit: 3 }),
			},
		]);
		expect(results).toEqual([
			{
				title: "年表",
				url: "https://example.com/timeline",
				snippet: "第三卷。",
				fetchedAt: "2026-11-13T01:02:03.000Z",
			},
		]);

		const failing = createHttpAssistantSearchClient({
			baseUrl: "https://example.com/search",
			fetch: async () => new Response("no", { status: 503 }),
		});
		await expect(failing.search("山门", 1)).rejects.toThrow(
			/联网搜索请求失败：HTTP 503/,
		);
	});

	it("只有注入搜索客户端时才注册 web_search，结果带链接与抓取时间", async () => {
		const store = openTempStore();
		seedStory(store);
		const withoutSearch = setupTools(store, {});
		expect(withoutSearch.map((tool) => tool.name)).not.toContain("web_search");

		const queries: string[] = [];
		const client: AssistantSearchClient = {
			async search(query, limit) {
				queries.push(`${query}:${limit}`);
				return [
					{
						title: "原作年表",
						url: "https://example.com/timeline",
						snippet: "山门在第三卷关闭。",
						fetchedAt: "2026-11-13T00:00:00.000Z",
					},
				];
			},
		};
		const tool = findTool(
			setupTools(store, { searchClient: client }),
			"web_search",
		);
		expect(tool.permission).toBe("read");
		const output = await run(tool, { query: "山门", limit: 2 });
		expect(queries).toEqual(["山门:2"]);
		expect(output).toContain("https://example.com/timeline");
		expect(output).toContain("抓取时间：2026-11-13T00:00:00.000Z");
		expect(output).toContain("摘要：山门在第三卷关闭。");
	});

	it("世界书条目提案批准后写入，拒绝后不变", async () => {
		const store = openTempStore();
		seedStory(store);
		const tool = findTool(setupTools(store, {}), "propose_lore_entries");
		const first = await run(tool, {
			entries: [{ name: "原作时间点", content: "第三卷之后。" }],
			summary: "补充原作资料",
		});
		expect(first).toContain("待确认动作");
		const action = store.listAssistantActions()[0];
		if (action === undefined) throw new Error("没有生成动作");
		expect(store.listLoreEntries("story-1")).toHaveLength(1);
		await approveAssistantAction(store, action.id);
		expect(store.listLoreEntries("story-1").map((entry) => entry.name)).toEqual(
			["山门", "原作时间点"],
		);

		const rejected = await run(tool, {
			entries: [{ name: "不要写入", content: "这条会被拒绝。" }],
		});
		expect(rejected).toContain("待确认动作");
		const second = store
			.listAssistantActions()
			.find((candidate) => candidate.status === "pending");
		if (second === undefined) throw new Error("没有生成第二个动作");
		rejectAssistantAction(store, second.id, "资料不准确");
		expect(store.listLoreEntries("story-1")).toHaveLength(2);
	});
});

describe("卡片工坊工具", () => {
	it("card_read 读回人物字段、实体、世界书与模板", async () => {
		const store = openTempStore();
		seedStory(store);
		const output = await run(findTool(setupTools(store, {}), "card_read"));
		expect(output).toContain("守门人沉默寡言。");
		expect(output).toContain("旅人");
		expect(output).toContain("老守");
		expect(output).toContain("山门每夜闭合。");
		expect(output).toContain("dramaticer-default");
	});

	it("卡片字段提案批准后写入设置，模板缺失时批准失败并保留 pending", async () => {
		const store = openTempStore();
		seedStory(store);
		const tool = findTool(setupTools(store, {}), "propose_card_change");
		await run(tool, {
			card: { characterPrompt: "守门人开始说话。" },
			summary: "让人物开口",
		});
		const cardAction = store.listAssistantActions()[0];
		if (cardAction === undefined) throw new Error("没有生成卡片动作");
		expect(cardAction.kind).toBe("card");
		await approveAssistantAction(store, cardAction.id);
		expect(store.getStorySettings("story-1").characterPrompt).toBe(
			"守门人开始说话。",
		);

		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		});
		await run(tool, {
			template: { templateId: "missing-template", template },
			summary: "更新模板",
		});
		const templateAction = store
			.listAssistantActions()
			.find((action) => action.kind === "template");
		if (templateAction === undefined) throw new Error("没有生成模板动作");
		await expect(
			approveAssistantAction(store, templateAction.id),
		).rejects.toThrow(/上下文模板不存在/);
		expect(store.getAssistantAction(templateAction.id)?.status).toBe("pending");

		await expect(run(tool, { card: {}, summary: "空修改" })).rejects.toThrow(
			"至少要包含一个卡片字段",
		);
		await expect(
			run(tool, {
				card: { persona: "旅人" },
				template: { template },
				summary: "两个都给",
			}),
		).rejects.toThrow("只能给一个");
	});
});

describe("设置向导工具", () => {
	it("channels_read 只返回非敏感字段", async () => {
		const store = openTempStore();
		seedStory(store);
		const snapshot: AssistantChannelsSnapshot = {
			channels: [
				{
					id: "main",
					api: "openai-completions",
					baseUrl: "http://127.0.0.1:8000/v1",
					apiKeyEnv: "MAIN_KEY",
					apiKeySet: true,
					requestsPerMinute: 30,
					maxRetries: 2,
					retryBaseDelayMs: 1000,
					timeoutMs: 300000,
				},
			],
			models: [
				{
					alias: "main",
					id: "model-a",
					contextWindow: 131072,
					maxTokens: 8192,
					reasoning: false,
					enabled: true,
					channels: ["main"],
				},
			],
			embeddings: [],
			roles: { writer: "main", settler: "main" },
			configuredRoles: { writer: "main" },
		};
		const output = await run(
			findTool(
				setupTools(store, { readChannels: async () => snapshot }),
				"channels_read",
			),
		);
		expect(output).toContain("http://127.0.0.1:8000/v1");
		expect(output).toContain("apiKeySet");
		expect(output).not.toContain("sk-secret");
	});

	it("渠道与设置提案只生成待确认动作，批准经注入写入函数", async () => {
		const store = openTempStore();
		seedStory(store);
		const tools = setupTools(store, {});
		const channelsTool = findTool(tools, "propose_channels_change");
		await run(channelsTool, {
			channels: {},
			models: { main: { id: "model-b" } },
			embeddings: {},
			roles: {},
			summary: "换模型",
		});
		const channelsAction = store.listAssistantActions()[0];
		if (channelsAction === undefined) throw new Error("没有生成渠道动作");
		expect(channelsAction.kind).toBe("channels");
		await expect(
			approveAssistantAction(store, channelsAction.id),
		).rejects.toThrow(AssistantActionPayloadError);
		expect(store.getAssistantAction(channelsAction.id)?.status).toBe("pending");
		const seen: JsonObject[] = [];
		await approveAssistantAction(store, channelsAction.id, {
			applyChannels: (payload) => {
				seen.push(payload);
			},
		});
		expect(seen).toHaveLength(1);

		await run(findTool(tools, "propose_settings_change"), {
			settings: { budgetTokens: 12_000 },
			summary: "提高预算",
		});
		const settingsAction = store
			.listAssistantActions()
			.find((action) => action.kind === "settings");
		if (settingsAction === undefined) throw new Error("没有生成设置动作");
		await approveAssistantAction(store, settingsAction.id);
		expect(store.getStorySettings("story-1").budgetTokens).toBe(12_000);
	});

	it("只读级别拒绝提案工具", async () => {
		const store = openTempStore();
		seedStory(store);
		const tool = findTool(
			setupTools(store, { permission: "read_only" }),
			"propose_settings_change",
		);
		await expect(
			run(tool, { settings: { budgetTokens: 12_000 } }),
		).rejects.toThrow(/permission_denied/);
		expect(store.listAssistantActions()).toEqual([]);
	});
});
