import { describe, expect, it } from "vitest";
import {
	type LlmCallOptions,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmToolCall,
	type StoryStore,
	createDefaultContextTemplate,
	createEventStream,
	createHistorySlotProvider,
	createStaticSlotProvider,
	readWorkspaceFile,
	runChatTurn,
	searchWorkspace,
	writeMemoryPref,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const USAGE = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

interface Round {
	readonly text: string;
	readonly toolCalls?: readonly LlmToolCall[];
}

function resultOf(round: Round): LlmResult {
	const calls = round.toolCalls ?? [];
	return {
		text: round.text,
		reasoning: "",
		toolCalls: calls,
		finishReason: calls.length > 0 ? "tool_calls" : "stop",
		stopReason: calls.length > 0 ? "toolUse" : "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: USAGE,
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation:
			round.text.length > 0 ? { text: round.text, reasoning: "" } : null,
	};
}

function createScriptedClient(rounds: readonly Round[]): {
	client: LlmStreamingClient;
	requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const client: LlmStreamingClient = {
		async complete() {
			throw new Error("本测试不使用 complete");
		},
		stream(request, _options?: LlmCallOptions) {
			const index = requests.length;
			const round = rounds[index];
			if (round === undefined) {
				throw new Error(`没有为第 ${index + 1} 次请求准备回复`);
			}
			requests.push(request);
			return createEventStream(async (emit) => {
				for (const char of round.text) {
					emit({ type: "text_delta", delta: char });
				}
				return resultOf(round);
			});
		},
	};
	return { client, requests };
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "深度工作区" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "凛站在教室门口，手里握着青铜匕首。",
	});
	store.saveSceneLog({
		nodeId: "a1",
		storyId: "s1",
		beat: "试探",
		present: ["凛", "卫宫"],
		sceneEnds: false,
		sceneCard: null,
		bits: [],
		conditions: [],
		states: [],
		quotes: { submitted: 0, verified: 0 },
		repairs: [],
	});
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "a1",
		role: "user",
		raw: "我把门推开。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "卫宫退后一步，盯着那把匕首。",
	});
	store.saveSceneLog({
		nodeId: "a2",
		storyId: "s1",
		beat: "对峙",
		present: ["凛", "卫宫"],
		sceneEnds: false,
		sceneCard: null,
		bits: [],
		conditions: [],
		states: [],
		quotes: { submitted: 0, verified: 0 },
		repairs: [],
	});
	store.appendStateDiffs([
		{
			storyId: "s1",
			nodeId: "a1",
			path: ["凛", "位置"],
			op: "set",
			value: "教室",
			source: "auto",
		},
		{
			storyId: "s1",
			nodeId: "a2",
			path: ["凛", "手里的东西"],
			op: "set",
			value: "青铜匕首",
			source: "auto",
		},
	]);
	store.insertMemoryEvents([
		{
			storyId: "s1",
			sourceNodeId: "a1",
			ordinal: 0,
			text: "匕首是假的",
			participants: ["凛"],
			knowers: ["凛"],
			importance: 0.7,
		},
		{
			storyId: "s1",
			sourceNodeId: "a2",
			ordinal: 0,
			text: "卫宫退后一步",
			participants: ["卫宫"],
			knowers: ["*"],
			importance: 0.3,
		},
	]);
	store.saveDirectorLines({
		nodeId: "a2",
		storyId: "s1",
		diffs: [
			{
				action: "set",
				line: {
					id: "promise-1",
					kind: "promise",
					who: "凛",
					want: "把匕首还给卫宫",
					obstacle: "卫宫不信任她",
					countdown: null,
					preparations: [],
				},
			},
		],
	});
	writeMemoryPref(store, "s1", { text: "别写死角色，我想看轻松一点的" });
}

function providers(store: StoryStore) {
	return {
		character: createStaticSlotProvider(
			[{ role: "system", content: "你扮演凛。" }],
			"card:凛",
		),
		history: createHistorySlotProvider(store, { limit: 10 }),
	};
}

function turnInput(store: StoryStore, client: LlmStreamingClient) {
	return {
		store,
		client,
		storyId: "s1",
		userText: "我走进教室。",
		template: createDefaultContextTemplate({
			structuredOutput: "function-call",
		}),
		providers: providers(store),
		budgetTokens: 4_000,
		structuredOutput: "function-call" as const,
		turnMode: "deep" as const,
	};
}

function systemText(request: LlmRequest): string {
	return request.messages
		.filter((message) => message.role === "system")
		.map((message) => message.content)
		.join("\n");
}

describe("深回合的自查清单", () => {
	it("包含状态、不知情者、最近节拍、偏好与待埋伏笔", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([{ text: "正文。" }]);

		await runChatTurn(turnInput(store, client));

		const system = systemText(requests[0] as LlmRequest);
		expect(system).toContain("交稿前自查");
		expect(system).toContain("状态对得上");
		expect(system).toContain("凛");
		expect(system).toContain("青铜匕首");
		expect(system).toContain("没有写出不知情的人知道的事");
		expect(system).toContain("卫宫不知道「匕首是假的」");
		expect(system).toContain("上两楼的节拍是「试探、对峙」");
		expect(system).toContain("别写死角色");
		expect(system).toContain("把匕首还给卫宫");
	});

	it("告诉模型工作区里有哪些文件与怎么用", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([{ text: "正文。" }]);

		await runChatTurn(turnInput(store, client));

		const system = systemText(requests[0] as LlmRequest);
		expect(system).toContain("草稿.md");
		expect(system).toContain("故事/状态.md");
		expect(system).toContain("file_read");
		expect(system).toContain("file_search");
	});
});

describe("深回合的文件工具", () => {
	it("读文件、搜故事数据、写草稿、打补丁、交稿串成一轮", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{
				text: "",
				toolCalls: [
					{
						id: "r1",
						name: "file_read",
						arguments: { path: "故事/状态.md" },
					},
				],
			},
			{
				text: "",
				toolCalls: [
					{
						id: "r2",
						name: "file_search",
						arguments: { query: "匕首" },
					},
				],
			},
			{
				text: "",
				toolCalls: [
					{
						id: "w1",
						name: "file_write",
						arguments: { path: "草稿.md", text: "第一版：凛把匕首递过去。" },
					},
				],
			},
			{
				text: "",
				toolCalls: [
					{
						id: "p1",
						name: "file_patch",
						arguments: {
							path: "草稿.md",
							oldText: "递过去",
							newText: "收了回去",
						},
					},
				],
			},
			{
				text: "",
				toolCalls: [{ id: "c1", name: "commit_draft", arguments: {} }],
			},
		]);

		const result = await runChatTurn(turnInput(store, client));

		expect(requests).toHaveLength(5);
		expect(result.node.raw).toBe("第一版：凛把匕首收了回去。");
		expect(
			result.trace.tools.calls.map((call) => ({
				name: call.name,
				ok: call.ok,
			})),
		).toEqual([
			{ name: "file_read", ok: true },
			{ name: "file_search", ok: true },
			{ name: "file_write", ok: true },
			{ name: "file_patch", ok: true },
			{ name: "commit_draft", ok: true },
		]);
	});

	it("读状态文件与搜索故事数据返回文件里的原文", () => {
		const { store } = openTempStore();
		seedStory(store);
		const head = store.getHead("s1");
		if (head === null) throw new Error("故事没有楼层");
		const context = {
			store,
			storyId: "s1",
			anchorNodeId: head.id,
			draft: null,
			notes: null,
		};

		expect(readWorkspaceFile("故事/状态.md", context)).toContain("教室");
		expect(readWorkspaceFile("/故事/秘密.md", context)).toContain("匕首是假的");
		expect(searchWorkspace("匕首", 20, context)).toContain("故事/秘密.md");
		expect(searchWorkspace("不存在的词", 20, context)).toContain("没有找到");
	});

	it("模型直接输出正文时照常成为一楼", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createScriptedClient([{ text: "凛没有松手。" }]);

		const result = await runChatTurn(turnInput(store, client));

		expect(result.node.raw).toBe("凛没有松手。");
		expect(result.trace.deep).toMatchObject({
			commit: "auto",
			drift: "missing_commit",
			stopReason: "completed",
		});
	});

	it("参数错误与只读文件被拒绝后仍能交出正文", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createScriptedClient([
			{
				text: "",
				toolCalls: [
					{
						id: "e1",
						name: "file_read",
						arguments: { path: "故事/不存在.md" },
					},
					{
						id: "e2",
						name: "file_write",
						arguments: { path: "故事/状态.md", text: "改掉" },
					},
					{
						id: "e3",
						name: "file_patch",
						arguments: { path: "草稿.md", oldText: "没有", newText: "有" },
					},
				],
			},
			{ text: "凛抬起眼。" },
		]);

		const result = await runChatTurn(turnInput(store, client));

		const calls = result.trace.tools.calls;
		expect(calls.map((call) => call.ok)).toEqual([false, false, false]);
		expect(calls[0]?.error).toContain("没有这个文件");
		expect(calls[1]?.error).toContain("只读");
		expect(calls[2]?.error).toContain("草稿");
		expect(result.node.raw).toBe("凛抬起眼。");
	});
});
