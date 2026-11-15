import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	DIRECTOR_SUFFIX_NOTE,
	type LlmChannelsConfig,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	StoryStore,
	createEventStream,
	mergePlannedArcs,
} from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { parseCharacterCardFile } from "../src/character-card.js";
import { renderCharacterPrompt } from "../src/chat/character.js";
import { type ChatCliDependencies, runChatCli } from "../src/chat/cli.js";

const cardPath = join(import.meta.dirname, "fixtures", "chat-card.json");
const extensionCardPath = join(
	import.meta.dirname,
	"fixtures",
	"chat-card-extension.json",
);
const REPLY = `山门在你面前缓缓打开。
<state_update>{"path":["场景","地点"],"op":"set","value":"山门"}</state_update>`;

function createTempDb(): string {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-chat-cli-")),
		"story.db",
	);
	onTestFinished(() => {
		rmSync(dirname(path), {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	});
	return path;
}

function createConfig(): LlmChannelsConfig {
	const channel = (id: string) => ({
		id,
		api: "openai-completions" as const,
		baseUrl: "http://localhost:1234",
		apiKey: "",
		requestsPerMinute: 0,
		maxRetries: 0,
		retryBaseDelayMs: 0,
		timeoutMs: 1_000,
	});
	const model = (alias: string) => ({
		alias,
		id: "fake-model",
		channels: [alias],
		contextWindow: 8_192,
		maxTokens: 1_024,
		reasoning: true,
		enabled: true,
		tools: null,
		probe: null,
	});
	return {
		channels: new Map([
			["main", channel("main")],
			["bg", channel("bg")],
		]),
		models: new Map([
			["main", model("main")],
			["background", model("background")],
		]),
		roles: new Map(),
		embeddings: new Map(),
	};
}

interface FakeChatClient {
	readonly client: LlmStreamingClient;
	readonly requests: LlmRequest[];
}

function createFakeClient(): FakeChatClient {
	const requests: LlmRequest[] = [];
	const result: LlmResult = {
		text: REPLY,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake",
		usage: {
			promptTokens: 5,
			completionTokens: 6,
			totalTokens: 11,
			reasoningTokens: 0,
			cachedTokens: 0,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: { text: REPLY, reasoning: "" },
	};
	return {
		requests,
		client: {
			async complete() {
				return result;
			},
			stream(request) {
				requests.push(request);
				return createEventStream(async (emit) => {
					for (const char of REPLY) {
						emit({ type: "text_delta", delta: char });
					}
					return result;
				});
			},
		},
	};
}

function dependencies(
	fake: FakeChatClient,
	logs: string[],
	output: string[],
): ChatCliDependencies {
	return {
		loadEnv: () => undefined,
		loadConfig: async () => createConfig(),
		createClient: () => fake.client,
		log: (message) => {
			logs.push(message);
		},
		write: (text) => {
			output.push(text);
		},
	};
}

/** 建一条 14 楼的主分支并在第一楼放一条老线索，让线索机制必然触发。 */
function seedClueChain(dbPath: string): void {
	const seed = StoryStore.open(dbPath);
	seed.createStory({ id: "s1", title: "山神" });
	let parentId: string | null = seed.appendNode({
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "山门在夜里开着。",
	}).id;
	seed.insertPlotNotes([
		{ storyId: "s1", sourceNodeId: parentId, text: "井底的脚步声" },
	]);
	for (let index = 0; index < 13; index += 1) {
		parentId = seed.appendNode({
			storyId: "s1",
			parentId,
			role: "assistant",
			raw: `第 ${index} 楼。`,
		}).id;
	}
	seed.close();
}

describe("dramaticer chat", () => {
	it("首次运行导入角色卡、生成一层并把 Trace 写进数据库", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();
		const logs: string[] = [];
		const output: string[] = [];
		const result = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
				"--model",
				"main",
			],
			dependencies(fake, logs, output),
		);

		expect(fake.requests).toHaveLength(1);
		expect(fake.requests[0]?.tools).toBeUndefined();
		expect(output.join("")).toBe(`${REPLY}\n`);
		expect(logs).toContain("已创建故事 s1");
		expect(logs.some((line) => line.includes("状态变更 1 条"))).toBe(true);
		expect(result.stateDiffs).toHaveLength(1);
		expect(result.trace.structured.mode).toBe("text-tags");

		const store = StoryStore.open(dbPath);
		try {
			const story = store.getStory("s1");
			expect(story?.title).toBe("山神");
			const nodes = store.getPathToNode(result.node.id);
			expect(nodes.map((node) => node.role)).toEqual([
				"assistant",
				"user",
				"assistant",
			]);
			expect(nodes[0]?.raw).toBe("山门为你打开。");
			expect(nodes[1]?.raw).toBe("我推开山门。");
			expect(nodes[2]?.raw).toBe(REPLY);
			const trace = store.getTurnTrace(nodes[2]?.id ?? "");
			expect(trace?.context.entries.map((entry) => entry.segmentId)).toEqual([
				"character",
				"lore",
				"summary",
				"history",
				"state",
				"memory",
				"scene",
				"profile",
				"reunion",
				"scene_card",
				"blueprint",
				"director",
				"user_will",
				"protocol",
			]);
			expect(trace?.structured.acceptedStateUpdates).toBe(1);
			const decision = store.getDirectorDecision(result.userNode.id);
			expect(decision?.directive).toBeNull();
			expect(decision?.mechanisms.map((item) => item.name)).toEqual([
				"clue",
				"opening",
				"beat",
				"repetition",
				"event_pool",
				"pacing",
			]);
			const entity = store.findEntityByName("s1", "山神");
			expect(entity?.kind).toBe("character");
			expect(entity?.aliases).toEqual(["山神"]);
		} finally {
			store.close();
		}
	});

	it("请求深回合时按深回合运行并记录防失控上限", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();
		const logs: string[] = [];

		const result = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
				"--mode",
				"deep",
			],
			dependencies(fake, logs, []),
		);
		expect(fake.requests).toHaveLength(1);
		expect(result.trace.turnMode).toBe("deep");
		expect(result.trace.deep).toMatchObject({
			maxToolCalls: 40,
			maxDurationMs: 600_000,
			toolCallCount: 0,
			stopReason: "completed",
		});
		expect(result.node.raw).toBe(REPLY);
	});

	it("不认识的模式在参数解析阶段就被拒绝", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();

		await expect(
			runChatCli(
				[
					"chat",
					"--story",
					"s1",
					"--card",
					cardPath,
					"--user",
					"我推开山门。",
					"--db",
					dbPath,
					"--mode",
					"turbo",
				],
				dependencies(fake, [], []),
			),
		).rejects.toThrow("--mode 只接受 fast 或 deep");
		expect(fake.requests).toHaveLength(0);
	});

	it("不认识的档位在参数解析阶段就被拒绝", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();

		await expect(
			runChatCli(
				[
					"chat",
					"--story",
					"s1",
					"--card",
					cardPath,
					"--user",
					"我推开山门。",
					"--db",
					dbPath,
					"--profile",
					"turbo",
				],
				dependencies(fake, [], []),
			),
		).rejects.toThrow("--profile 只接受 native 或 naive");
		expect(fake.requests).toHaveLength(0);
	});

	it("朴素模式只带角色、persona、历史原文与写作契约，不写台账", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();
		const result = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
				"--model",
				"main",
				"--profile",
				"naive",
				"--persona",
				"你是云游的剑客。",
			],
			dependencies(fake, [], []),
		);

		expect(fake.requests).toHaveLength(1);
		expect(fake.requests[0]?.tools).toBeUndefined();
		expect(result.trace.profile).toBe("naive");
		expect(
			result.trace.context.entries.map((entry) => entry.segmentId),
		).toEqual(["character", "persona", "history", "protocol"]);
		expect(result.stateDiffs).toEqual([]);
		expect(result.trace.structured.acceptedStateUpdates).toBe(0);

		const store = StoryStore.open(dbPath);
		try {
			expect(store.getStorySettings("s1").persona).toBe("你是云游的剑客。");
			expect(store.getStateDiffs(result.node.id)).toEqual([]);
			expect(store.getOpenPlotNotes("s1")).toEqual([]);
			expect(store.getDirectorDecision(result.userNode.id)).toBeNull();
			expect(store.countBackgroundJobs({ storyId: "s1" })).toEqual({
				pending: 0,
				running: 0,
				done: 0,
				failed: 0,
				discarded: 0,
			});
		} finally {
			store.close();
		}
	});

	it("朴素模式不接受显式打开导演", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();

		await expect(
			runChatCli(
				[
					"chat",
					"--story",
					"s1",
					"--card",
					cardPath,
					"--user",
					"我推开山门。",
					"--db",
					dbPath,
					"--profile",
					"naive",
					"--director",
					"transparent",
				],
				dependencies(fake, [], []),
			),
		).rejects.toThrow("朴素模式没有导演");
		expect(fake.requests).toHaveLength(0);
	});

	it("单轮 --mode fast 覆盖故事锁定的深回合，Trace 记录快回合", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();
		const first = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
			],
			dependencies(fake, [], []),
		);
		const store = StoryStore.open(dbPath);
		try {
			store.updateStorySettings("s1", { turnMode: "deep" });
		} finally {
			store.close();
		}

		const second = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--user",
				"我往里走。",
				"--db",
				dbPath,
				"--mode",
				"fast",
			],
			dependencies(fake, [], []),
		);

		expect(second.trace.turnMode).toBe("fast");
		expect(second.trace.tools).toMatchObject({ maxRounds: 3, capped: false });
		expect(second.userNode.parentId).toBe(first.node.id);
	});

	it("第二次运行接在已有楼层后面，并在上下文里带上状态", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();
		const first = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
			],
			dependencies(fake, [], []),
		);
		const second = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我往里走。",
				"--db",
				dbPath,
			],
			dependencies(fake, [], []),
		);

		expect(second.userNode.parentId).toBe(first.node.id);
		const store = StoryStore.open(dbPath);
		try {
			const nodes = store.getPathToNode(second.node.id);
			expect(nodes).toHaveLength(5);
			expect(nodes.map((node) => node.raw)).toEqual([
				"山门为你打开。",
				"我推开山门。",
				REPLY,
				"我往里走。",
				REPLY,
			]);
			const trace = store.getTurnTrace(second.node.id);
			const stateEntry = trace?.context.entries.find(
				(entry) => entry.segmentId === "state",
			);
			expect(stateEntry?.status).toBe("included");
			expect(stateEntry?.source).toBe("state:1 条 diff");
		} finally {
			store.close();
		}
	});

	it("导入世界书条目并让常驻条目进入上下文", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();
		const worldPath = join(
			import.meta.dirname,
			"fixtures",
			"health-world.json",
		);
		const result = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--world",
				worldPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
			],
			dependencies(fake, [], []),
		);

		expect(fake.requests).toHaveLength(1);
		const store = StoryStore.open(dbPath);
		try {
			const entries = store.listLoreEntries("s1");
			expect(entries).toHaveLength(1);
			expect(entries[0]).toMatchObject({
				name: "龙",
				constant: true,
				source: "world-info:health-world:0",
			});
			const trace = store.getTurnTrace(result.node.id);
			const loreEntry = trace?.context.entries.find(
				(entry) => entry.segmentId === "lore",
			);
			expect(loreEntry?.status).toBe("included");
			expect(loreEntry?.source).toBe("lore:升级 常驻 1 条、检索 0 条");
		} finally {
			store.close();
		}
	});

	it("对话轮次只创建正文客户端，不触碰后台模型", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();
		const aliases: string[] = [];
		await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
			],
			{
				...dependencies(fake, [], []),
				createClient: (_config, alias) => {
					aliases.push(alias);
					return fake.client;
				},
			},
		);

		expect(aliases).toEqual(["main"]);
		expect(fake.requests).toHaveLength(1);
	});

	it("透明模式下线索到期注入导演尾注并写入决策记录", async () => {
		const dbPath = createTempDb();
		seedClueChain(dbPath);

		const fake = createFakeClient();
		const result = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
			],
			dependencies(fake, [], []),
		);

		const directorEntry = result.trace.context.entries.find(
			(entry) => entry.segmentId === "director",
		);
		expect(directorEntry?.status).toBe("included");
		expect(directorEntry?.source).toBe("director:clue");
		expect(directorEntry?.appendedTo).toBe("last-user");
		const messages = fake.requests[0]?.messages ?? [];
		expect(
			messages.some(
				(message) =>
					message.role === "system" && message.content.startsWith("【导演】"),
			),
		).toBe(false);
		const userMessages = messages.filter((message) => message.role === "user");
		const lastUser = userMessages.at(-1)?.content as string;
		expect(lastUser.startsWith("我推开山门。")).toBe(true);
		expect(lastUser).toContain("井底的脚步声");
		expect(lastUser.endsWith(DIRECTOR_SUFFIX_NOTE)).toBe(true);

		const store = StoryStore.open(dbPath);
		try {
			expect(store.getNode(result.userNode.id)?.raw).toBe("我推开山门。");
			const decision = store.getDirectorDecision(result.userNode.id);
			expect(decision?.directive).not.toBeNull();
			expect(decision?.mechanisms[0]?.name).toBe("clue");
		} finally {
			store.close();
		}
	});

	it("--director blind 同样注入并写决策记录", async () => {
		const dbPath = createTempDb();
		seedClueChain(dbPath);
		const fake = createFakeClient();
		const result = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
				"--director",
				"blind",
			],
			dependencies(fake, [], []),
		);

		const directorEntry = result.trace.context.entries.find(
			(entry) => entry.segmentId === "director",
		);
		expect(directorEntry?.status).toBe("included");
		expect(directorEntry?.source).toBe("director:clue");
		expect(directorEntry?.appendedTo).toBe("last-user");
		const lastUser = (fake.requests[0]?.messages ?? [])
			.filter((message) => message.role === "user")
			.at(-1)?.content as string;
		expect(lastUser.endsWith(DIRECTOR_SUFFIX_NOTE)).toBe(true);
		expect(lastUser).toContain("井底的脚步声");

		const store = StoryStore.open(dbPath);
		try {
			const decision = store.getDirectorDecision(result.userNode.id);
			expect(decision?.directive).not.toBeNull();
			expect(decision?.mechanisms[0]?.name).toBe("clue");
			expect(decision?.signals).toMatchObject({ openClues: 1 });
		} finally {
			store.close();
		}
	});

	it("--director off 时导演槽位缺失且没有决策记录", async () => {
		const dbPath = createTempDb();
		seedClueChain(dbPath);
		const fake = createFakeClient();
		const result = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
				"--director",
				"off",
			],
			dependencies(fake, [], []),
		);

		const directorEntry = result.trace.context.entries.find(
			(entry) => entry.segmentId === "director",
		);
		expect(directorEntry?.status).toBe("missing-slot");
		expect(
			fake.requests[0]?.messages.some((message) =>
				message.content.includes("【导演】"),
			),
		).toBe(false);
		expect(
			fake.requests[0]?.messages.some((message) =>
				message.content.includes(DIRECTOR_SUFFIX_NOTE),
			),
		).toBe(false);

		const store = StoryStore.open(dbPath);
		try {
			expect(store.getDirectorDecision(result.userNode.id)).toBeNull();
		} finally {
			store.close();
		}
	});

	it("--intensity 覆盖故事设置的拍强度，非法值直接失败", async () => {
		const dbPath = createTempDb();
		const seed = StoryStore.open(dbPath);
		seed.createStory({ id: "s1", title: "山神" });
		seed.appendNode({
			id: "a0",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "山门在夜里开着。",
		});
		mergePlannedArcs(
			seed,
			"s1",
			{
				arcs: [
					{
						id: "arc-1",
						title: "开学",
						throughLine: "凛必须说出真相",
						difficulty: 0.4,
						redLines: [],
						sequences: [
							{
								id: "seq-1",
								title: "相遇",
								beats: [
									{
										id: "beat-1",
										goal: "确认来意",
										entrySigns: ["凛堵在门口"],
										fitPoints: ["凛盯着你"],
									},
								],
							},
						],
					},
				],
			},
			"model",
		);
		seed.close();

		const fake = createFakeClient();
		const result = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
				"--intensity",
				"setup",
			],
			dependencies(fake, [], []),
		);
		const store = StoryStore.open(dbPath);
		try {
			const decision = store.getDirectorDecision(result.userNode.id);
			expect(decision?.signals.beat).toMatchObject({ intensity: "setup" });
			expect(decision?.directive).toContain("确认来意");
		} finally {
			store.close();
		}

		await expect(
			runChatCli(
				[
					"chat",
					"--story",
					"s1",
					"--card",
					cardPath,
					"--user",
					"我推开山门。",
					"--db",
					dbPath,
					"--intensity",
					"hype",
				],
				dependencies(createFakeClient(), [], []),
			),
		).rejects.toThrow("--intensity");
		await expect(
			runChatCli(
				[
					"chat",
					"--story",
					"s1",
					"--card",
					cardPath,
					"--user",
					"我推开山门。",
					"--db",
					dbPath,
					"--profile",
					"naive",
					"--intensity",
					"setup",
				],
				dependencies(createFakeClient(), [], []),
			),
		).rejects.toThrow("朴素模式");
	});

	it("导入角色卡时同时写入 extensions.dramaticer 的事件池与 NPC 议程", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();
		await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				extensionCardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
			],
			dependencies(fake, [], []),
		);

		const store = StoryStore.open(dbPath);
		try {
			const events = store.listEventPool("s1");
			expect(events.map((event) => event.sourceId)).toEqual([
				"flood",
				"wolves",
			]);
			expect(events[0]?.preconditions).toEqual({
				kind: "state",
				path: ["场景", "地点"],
				op: "exists",
			});
			const entity = store.findEntityByName("s1", "山神");
			const agendas = store.listNpcAgendas("s1");
			expect(agendas).toHaveLength(1);
			expect(agendas[0]).toMatchObject({
				entityId: entity?.id,
				goal: "在暗处引导来客走向山门",
				everyChapters: 2,
				importance: 0.7,
			});
		} finally {
			store.close();
		}
	});

	it("导入后把提示词写入故事设置，之后的运行不需要卡文件", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();
		const first = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
			],
			dependencies(fake, [], []),
		);
		const card = await parseCharacterCardFile(cardPath);
		const prompt = renderCharacterPrompt(card);

		const store = StoryStore.open(dbPath);
		try {
			const settings = store.getStorySettings("s1");
			expect(settings.cardName).toBe("山神");
			expect(settings.characterPrompt).toBe(prompt);
			const trace = store.getTurnTrace(first.node.id);
			const characterEntry = trace?.context.entries.find(
				(entry) => entry.segmentId === "character",
			);
			expect(characterEntry?.source).toBe(`character:${prompt.length} 字符`);
		} finally {
			store.close();
		}

		const second = await runChatCli(
			["chat", "--story", "s1", "--user", "我往里走。", "--db", dbPath],
			dependencies(fake, [], []),
		);
		expect(second.userNode.parentId).toBe(first.node.id);
		expect(fake.requests).toHaveLength(2);
		expect(
			fake.requests[1]?.messages.some(
				(message) => message.role === "system" && message.content === prompt,
			),
		).toBe(true);
	});

	it("首次运行没有角色卡时抛错", async () => {
		const dbPath = createTempDb();
		const fake = createFakeClient();
		await expect(
			runChatCli(
				["chat", "--story", "s1", "--user", "你好", "--db", dbPath],
				dependencies(fake, [], []),
			),
		).rejects.toThrow("首次运行需要用 --card");
	});

	it("故事设置指向的模板优先于内置模板", async () => {
		const dbPath = createTempDb();
		const seed = StoryStore.open(dbPath);
		seed.createStory({ id: "s1", title: "山神" });
		const created = seed.createContextTemplate({
			name: "只有协议",
			template: {
				id: "custom",
				segments: [
					{ id: "protocol", kind: "static", text: "只按这个模板组装。" },
				],
			},
		});
		seed.updateStorySettings("s1", { templateId: created.id });
		seed.close();

		const fake = createFakeClient();
		const result = await runChatCli(
			[
				"chat",
				"--story",
				"s1",
				"--card",
				cardPath,
				"--user",
				"我推开山门。",
				"--db",
				dbPath,
			],
			dependencies(fake, [], []),
		);
		const messages = fake.requests[0]?.messages ?? [];
		expect(
			messages.some((message) => message.content === "只按这个模板组装。"),
		).toBe(true);
		const store = StoryStore.open(dbPath);
		try {
			expect(store.getTurnTrace(result.node.id)?.templateId).toBe("custom");
		} finally {
			store.close();
		}
	});

	it("参数错误给出用法", async () => {
		const fake = createFakeClient();
		const deps = dependencies(fake, [], []);
		await expect(runChatCli(["chat", "--story", "s1"], deps)).rejects.toThrow(
			"--card",
		);
		await expect(
			runChatCli(
				["chat", "--story", "s1", "--card", cardPath, "--user", "你好", "--db"],
				deps,
			),
		).rejects.toThrow("--db");
		await expect(
			runChatCli(
				[
					"chat",
					"--story",
					"s1",
					"--card",
					cardPath,
					"--user",
					"你好",
					"--budget",
					"-1",
				],
				deps,
			),
		).rejects.toThrow("--budget");
		await expect(
			runChatCli(
				[
					"chat",
					"--story",
					"s1",
					"--card",
					cardPath,
					"--user",
					"你好",
					"--director",
					"maybe",
				],
				deps,
			),
		).rejects.toThrow("--director 只接受 off、transparent 或 blind");
		await expect(
			runChatCli(
				[
					"chat",
					"--story",
					"s1",
					"--card",
					cardPath,
					"--user",
					"你好",
					"--unknown",
					"x",
				],
				deps,
			),
		).rejects.toThrow("不认识的参数");
	});
});

describe("renderCharacterPrompt", () => {
	it("只拼接非空的角色卡字段", async () => {
		const card = await parseCharacterCardFile(cardPath);
		const prompt = renderCharacterPrompt(card);
		expect(prompt).toContain("你扮演的角色：山神");
		expect(prompt).toContain("守护山门的神灵。");
		expect(prompt).toContain("寡言，重视承诺。");
		expect(prompt).not.toContain("对话示例");
		expect(prompt).not.toContain("系统提示");
	});
});
