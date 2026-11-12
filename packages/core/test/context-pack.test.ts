import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	CONTEXT_PACK_VERSION,
	type ContextSlotContent,
	type ContextSlotProvider,
	type ContextSlotRequest,
	LATEST_SCHEMA_VERSION,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type StoryStore,
	createDefaultContextTemplate,
	createEventStream,
	createHistorySlotProvider,
	createLoreSlotProvider,
	createMemorySlotProvider,
	createSceneSlotProvider,
	createStateSlotProvider,
	createStaticSlotProvider,
	generateAssistantTurn,
	regenerateAssistantTurn,
	runChatTurn,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const USAGE = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

function createScriptedClient(texts: readonly string[]): {
	readonly client: LlmStreamingClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const client: LlmStreamingClient = {
		async complete() {
			throw new Error("本测试不使用 complete");
		},
		stream(request) {
			const text = texts[requests.length];
			if (text === undefined) {
				throw new Error(`没有为第 ${requests.length + 1} 次请求准备回复`);
			}
			requests.push(request);
			const result: LlmResult = {
				text,
				reasoning: "",
				toolCalls: [],
				finishReason: "stop",
				stopReason: "stop",
				model: "fake-model",
				channel: "fake-channel",
				usage: USAGE,
				raw: null,
				cached: false,
				attempts: 1,
				rounds: 1,
				truncation: null,
				continuation: { text, reasoning: "" },
			};
			return createEventStream(async (emit) => {
				emit({ type: "text_delta", delta: text });
				return result;
			});
		},
	};
	return { client, requests };
}

interface Counts {
	lore: number;
	scene: number;
	memory: number;
}

function wrapped(
	provider: ContextSlotProvider,
	counts: Counts,
	key: keyof Counts,
): ContextSlotProvider {
	return {
		...provider,
		async provide(
			request: ContextSlotRequest,
		): Promise<ContextSlotContent | null> {
			counts[key] += 1;
			return await provider.provide(request);
		},
	};
}

function buildProviders(store: StoryStore, counts: Counts) {
	return {
		character: createStaticSlotProvider(
			[{ role: "system", content: "你扮演山神。" }],
			"card:山神",
		),
		history: createHistorySlotProvider(store, { limit: 10 }),
		state: createStateSlotProvider(store),
		lore: wrapped(createLoreSlotProvider(store), counts, "lore"),
		scene: wrapped(createSceneSlotProvider(store), counts, "scene"),
		memory: wrapped(createMemorySlotProvider(store), counts, "memory"),
	};
}

function emptyCounts(): Counts {
	return { lore: 0, scene: 0, memory: 0 };
}

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "上下文包" });
	store.appendNode({
		id: "a0",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "山门外的雨没有停。",
	});
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
			keywords: ["码头"],
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
	store.saveSceneAnalysis({
		nodeId: "a0",
		storyId: "s1",
		text: "山神想让他回头。",
		tokenCount: 12,
	});
}

const TEMPLATE = createDefaultContextTemplate({
	structuredOutput: "text-tags",
});

function turnOptions(store: StoryStore, client: LlmStreamingClient) {
	return {
		store,
		client,
		storyId: "s1",
		template: TEMPLATE,
		providers: buildProviders(store, emptyCounts()),
		budgetTokens: 4_000,
		structuredOutput: "text-tags" as const,
		model: "fake",
	};
}

describe("上下文包复用", () => {
	it("同一玩家楼层重复重新生成只组装一次，上下文逐字节一致", async () => {
		const { store, path } = openTempStore();
		seed(store);
		const counts = emptyCounts();
		const providers = buildProviders(store, counts);
		const firstClient = createScriptedClient(["第一次回复。"]);
		const first = await runChatTurn({
			...turnOptions(store, firstClient.client),
			userText: "我想去码头找老渔夫。",
			providers,
		});
		expect(counts).toEqual({ lore: 1, scene: 1, memory: 1 });
		const pack = store.getContextPack(first.userNode.id);
		expect(pack?.payload.version).toBe(CONTEXT_PACK_VERSION);
		expect(pack?.payload.references.loreEntryIds).toEqual([
			"constant",
			"harbor",
		]);
		expect(pack?.payload.references.sceneAnalysisNodeId).toBe("a0");
		expect(pack?.payload.references.ledgerSnapshot).toEqual({
			nodeId: first.userNode.id,
			diffCount: 0,
		});
		const createdAt = pack?.createdAt;

		const secondClient = createScriptedClient(["第二次回复。"]);
		const second = await regenerateAssistantTurn({
			...turnOptions(store, secondClient.client),
			assistantNodeId: first.node.id,
			providers,
		});
		expect(counts).toEqual({ lore: 1, scene: 1, memory: 1 });

		const thirdClient = createScriptedClient(["第三次回复。"]);
		await regenerateAssistantTurn({
			...turnOptions(store, thirdClient.client),
			assistantNodeId: second.node.id,
			providers,
		});
		expect(counts).toEqual({ lore: 1, scene: 1, memory: 1 });
		expect(firstClient.requests[0]?.messages).toEqual(
			secondClient.requests[0]?.messages,
		);
		expect(secondClient.requests[0]?.messages).toEqual(
			thirdClient.requests[0]?.messages,
		);
		expect(store.getContextPack(first.userNode.id)?.createdAt).toBe(createdAt);

		const db = new Database(path, { readonly: true });
		const row = db
			.prepare("SELECT COUNT(*) AS count FROM context_packs WHERE node_id = ?")
			.get(first.userNode.id) as { readonly count: number };
		db.close();
		expect(row.count).toBe(1);
	});

	it("玩家编辑输入产生新楼层后重新组装", async () => {
		const { store } = openTempStore();
		seed(store);
		const counts = emptyCounts();
		const providers = buildProviders(store, counts);
		const first = await runChatTurn({
			...turnOptions(store, createScriptedClient(["第一次回复。"]).client),
			userText: "我想去码头。",
			providers,
		});
		expect(counts.lore).toBe(1);

		const edited = store.editNode(first.userNode.id, "我改去山门。");
		const client = createScriptedClient(["编辑后的回复。"]);
		await generateAssistantTurn({
			...turnOptions(store, client.client),
			userNodeId: edited.id,
			providers,
		});
		expect(counts).toEqual({ lore: 2, scene: 2, memory: 2 });
		const pack = store.getContextPack(edited.id);
		expect(pack?.payload.references.loreEntryIds).toEqual([
			"constant",
			"shanmen",
		]);
	});

	it("引用的世界书条目被删后重新组装", async () => {
		const { store, path } = openTempStore();
		seed(store);
		const counts = emptyCounts();
		const providers = buildProviders(store, counts);
		const first = await runChatTurn({
			...turnOptions(store, createScriptedClient(["第一次回复。"]).client),
			userText: "我想去码头。",
			providers,
		});
		expect(store.getContextPack(first.userNode.id)).not.toBeNull();

		const raw = new Database(path);
		raw.prepare("DELETE FROM lore_entries WHERE id = 'harbor'").run();
		raw.close();

		const client = createScriptedClient(["条目删除后的回复。"]);
		await regenerateAssistantTurn({
			...turnOptions(store, client.client),
			assistantNodeId: first.node.id,
			providers,
		});
		expect(counts).toEqual({ lore: 2, scene: 2, memory: 2 });
		expect(
			store.getContextPack(first.userNode.id)?.payload.references.loreEntryIds,
		).toEqual(["constant"]);
	});

	it("引用的现场分析不在当前路径上时重新组装", async () => {
		const { store } = openTempStore();
		seed(store);
		store.appendNode({
			id: "u0",
			storyId: "s1",
			parentId: "a0",
			role: "user",
			raw: "我抬头看山门。",
		});
		store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: "u0",
			role: "assistant",
			raw: "山门没有开。",
		});
		store.saveSceneAnalysis({
			nodeId: "a1",
			storyId: "s1",
			text: "山神在山门后。",
			tokenCount: 10,
		});
		const counts = emptyCounts();
		const providers = buildProviders(store, counts);
		const first = await runChatTurn({
			...turnOptions(store, createScriptedClient(["第一次回复。"]).client),
			userText: "我继续等。",
			providers,
		});
		expect(
			store.getContextPack(first.userNode.id)?.payload.references
				.sceneAnalysisNodeId,
		).toBe("a1");
		expect(counts.scene).toBe(1);

		store.appendNode({
			id: "a1b",
			storyId: "s1",
			parentId: "u0",
			role: "assistant",
			raw: "山门开了。",
		});
		store.setHead("s1", "a1b");

		const client = createScriptedClient(["分支切换后的回复。"]);
		await regenerateAssistantTurn({
			...turnOptions(store, client.client),
			assistantNodeId: first.node.id,
			providers,
		});
		expect(counts).toEqual({ lore: 2, scene: 2, memory: 2 });
	});

	it("包不跨玩家楼层复用", async () => {
		const { store } = openTempStore();
		seed(store);
		const counts = emptyCounts();
		const providers = buildProviders(store, counts);
		const first = await runChatTurn({
			...turnOptions(store, createScriptedClient(["第一次回复。"]).client),
			userText: "我想去码头。",
			providers,
		});
		const other = store.appendNode({
			storyId: "s1",
			parentId: "a0",
			role: "user",
			raw: "我想看山门。",
		});
		await generateAssistantTurn({
			...turnOptions(store, createScriptedClient(["另一个回复。"]).client),
			userNodeId: other.id,
			providers,
		});
		expect(counts).toEqual({ lore: 2, scene: 2, memory: 2 });
		expect(store.getContextPack(first.userNode.id)).not.toBeNull();
		expect(store.getContextPack(other.id)).not.toBeNull();
	});

	it("模板或预算变化后不复用旧包", async () => {
		const { store } = openTempStore();
		seed(store);
		const counts = emptyCounts();
		const providers = buildProviders(store, counts);
		const first = await runChatTurn({
			...turnOptions(store, createScriptedClient(["第一次回复。"]).client),
			userText: "我想去码头。",
			providers,
		});
		const client = createScriptedClient(["预算变化后的回复。"]);
		await regenerateAssistantTurn({
			...turnOptions(store, client.client),
			assistantNodeId: first.node.id,
			providers,
			budgetTokens: 2_000,
		});
		expect(counts).toEqual({ lore: 2, scene: 2, memory: 2 });
		const pack = store.getContextPack(first.userNode.id);
		expect(pack?.payload.assembled.trace.budgetTokens).toBe(2_000);
	});
});

describe("上下文包存储", () => {
	it("迁移到 v38，同一楼层覆盖同一行，跨故事写入被拒绝", () => {
		const { store, path } = openTempStore();
		seed(store);
		store.appendNode({
			id: "u1",
			storyId: "s1",
			parentId: "a0",
			role: "user",
			raw: "我站在山门前。",
		});
		store.createStory({ id: "s2", title: "另一个故事" });
		expect(store.getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION);
		expect(store.getSchemaVersion()).toBe(38);

		const payload = {
			version: CONTEXT_PACK_VERSION as const,
			fingerprint: "abc",
			assembled: {
				messages: [{ role: "system" as const, content: "旧内容" }],
				segments: [],
				trace: { budgetTokens: 100, totalTokens: 0, entries: [] },
				references: {
					loreEntryIds: [],
					sceneAnalysisNodeId: null,
					retrievalNodeIds: [],
				},
			},
			references: {
				loreEntryIds: [],
				sceneAnalysisNodeId: null,
				retrievalNodeIds: [],
				ledgerSnapshot: { nodeId: "u1", diffCount: 0 },
			},
		};
		store.saveContextPack({
			nodeId: "u1",
			storyId: "s1",
			payload,
			createdAt: "2026-11-12T00:00:00.000Z",
		});
		store.saveContextPack({
			nodeId: "u1",
			storyId: "s1",
			payload: {
				...payload,
				fingerprint: "def",
			},
		});
		expect(store.getContextPack("u1")?.payload.fingerprint).toBe("def");
		expect(() =>
			store.saveContextPack({ nodeId: "u1", storyId: "s2", payload }),
		).toThrow("与楼层所属故事不一致");

		const raw = new Database(path);
		try {
			expect(() =>
				raw
					.prepare(
						`INSERT INTO context_packs (node_id, story_id, payload, created_at)
						VALUES ('u1', 's2', '{}', '2026-11-12T00:00:00.000Z')`,
					)
					.run(),
			).toThrow("必须与所在楼层一致");
		} finally {
			raw.close();
		}
	});
});
