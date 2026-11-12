import { describe, expect, it } from "vitest";
import {
	DEEP_TURN_TOOLS,
	FAST_TURN_TOOLS,
	type LlmCallOptions,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmToolCall,
	type ReadToolContext,
	type StoryStore,
	TurnNoteController,
	createDefaultContextTemplate,
	createEventStream,
	createHistorySlotProvider,
	createStaticSlotProvider,
	executeNoteWriteTool,
	executeReadTool,
	runChatTurn,
	validateReadToolArguments,
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

function createScriptedClient(
	rounds: readonly Round[],
	onRound?: (index: number, requests: readonly LlmRequest[]) => void,
): { client: LlmStreamingClient; requests: LlmRequest[] } {
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
				onRound?.(index, requests);
				return resultOf(round);
			});
		},
	};
	return { client, requests };
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "导演手记" });
	store.appendNode({
		id: "n-root",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "井底的青铜匕首还在。",
	});
	store.appendNode({
		id: "n-user",
		storyId: "s1",
		parentId: "n-root",
		role: "user",
		raw: "我把匕首收进袖子里。",
	});
	store.setHead("s1", "n-user");
}

function providers(store: StoryStore) {
	return {
		character: createStaticSlotProvider(
			[{ role: "system", content: "你扮演山神。" }],
			"card:山神",
		),
		history: createHistorySlotProvider(store, { limit: 10 }),
	};
}

async function runTurn(input: {
	readonly store: StoryStore;
	readonly client: LlmStreamingClient;
	readonly userText: string;
	readonly mode: "fast" | "deep";
}) {
	return runChatTurn({
		store: input.store,
		client: input.client,
		storyId: "s1",
		userText: input.userText,
		template: createDefaultContextTemplate({
			structuredOutput: "function-call",
		}),
		providers: providers(input.store),
		budgetTokens: 4_000,
		structuredOutput: "function-call",
		turnMode: input.mode,
	});
}

describe("导演手记存储", () => {
	it("沿路径累加 set 与 delete，后写覆盖先写", () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendNode({
			id: "n-a1",
			storyId: "s1",
			parentId: "n-user",
			role: "assistant",
			raw: "第一段。",
		});
		store.appendNode({
			id: "n-u2",
			storyId: "s1",
			parentId: "n-a1",
			role: "user",
			raw: "继续。",
		});
		store.saveDirectorNotes({
			nodeId: "n-root",
			storyId: "s1",
			diffs: [
				{ action: "set", key: "伏笔", text: "井底的匕首" },
				{ action: "set", key: "动机", text: "山神在找骨笛" },
			],
		});
		store.saveDirectorNotes({
			nodeId: "n-a1",
			storyId: "s1",
			diffs: [
				{ action: "set", key: "伏笔", text: "骨笛藏在井壁" },
				{ action: "delete", key: "动机" },
				{ action: "set", key: "下一拍", text: "山神开门" },
			],
		});

		expect(store.readDirectorNoteEntries("n-root")).toEqual([
			{ key: "伏笔", text: "井底的匕首" },
			{ key: "动机", text: "山神在找骨笛" },
		]);
		expect(store.readDirectorNoteEntries("n-u2")).toEqual([
			{ key: "下一拍", text: "山神开门" },
			{ key: "伏笔", text: "骨笛藏在井壁" },
		]);
		expect(store.getDirectorNotes("n-a1")?.diffs).toHaveLength(3);
		expect(store.getDirectorNotes("n-user")).toBeNull();
	});

	it("分支各自累加，互不影响", () => {
		const { store } = openTempStore();
		seedStory(store);
		store.saveDirectorNotes({
			nodeId: "n-root",
			storyId: "s1",
			diffs: [{ action: "set", key: "共同", text: "两分支都看得到" }],
		});
		store.appendNode({
			id: "n-a1",
			storyId: "s1",
			parentId: "n-user",
			role: "assistant",
			raw: "走左边。",
		});
		store.appendNode({
			id: "n-a2",
			storyId: "s1",
			parentId: "n-user",
			role: "assistant",
			raw: "走右边。",
		});
		store.saveDirectorNotes({
			nodeId: "n-a1",
			storyId: "s1",
			diffs: [{ action: "set", key: "路线", text: "左门" }],
		});
		store.saveDirectorNotes({
			nodeId: "n-a2",
			storyId: "s1",
			diffs: [{ action: "set", key: "路线", text: "右门" }],
		});

		expect(store.readDirectorNoteEntries("n-a1")).toEqual([
			{ key: "共同", text: "两分支都看得到" },
			{ key: "路线", text: "左门" },
		]);
		expect(store.readDirectorNoteEntries("n-a2")).toEqual([
			{ key: "共同", text: "两分支都看得到" },
			{ key: "路线", text: "右门" },
		]);
	});

	it("写入前校验键、动作、文本长度与每楼条数", () => {
		const { store } = openTempStore();
		seedStory(store);
		const save = (diffs: unknown) =>
			store.saveDirectorNotes({
				nodeId: "n-root",
				storyId: "s1",
				diffs: diffs as never,
			});
		expect(() => save([{ action: "set", key: " ", text: "x" }])).toThrow(
			"key 必须是非空字符串",
		);
		expect(() => save([{ action: "append", key: "a", text: "x" }])).toThrow(
			"action 只能是 set 或 delete",
		);
		expect(() => save([{ action: "set", key: "a" }])).toThrow(
			"text 必须是字符串",
		);
		expect(() =>
			save([{ action: "set", key: "a", text: "字".repeat(2_001) }]),
		).toThrow("不能超过 2000 字");
		expect(() =>
			save(
				Array.from({ length: 51 }, (_, index) => ({
					action: "set" as const,
					key: `k${index}`,
					text: "x",
				})),
			),
		).toThrow("最多 50 条");
		expect(() => save([])).toThrow("至少要有一条");
		expect(() =>
			store.saveDirectorNotes({
				nodeId: "n-root",
				storyId: "other-story",
				diffs: [{ action: "set", key: "a", text: "x" }],
			}),
		).toThrow("storyId 与楼层所属故事不一致");
	});
});

describe("导演手记工具", () => {
	it("note_write 收集修改并拒绝越界累计", () => {
		const notes = new TurnNoteController();
		const outcome = executeNoteWriteTool(
			{
				diffs: [
					{ action: "set", key: "伏笔", text: "骨笛" },
					{ action: "delete", key: "动机" },
				],
			},
			notes,
		);
		expect(outcome.content).toContain("已记录 2 条手记修改（本轮共 2 条）");
		expect(notes.pending).toEqual([
			{ action: "set", key: "伏笔", text: "骨笛" },
			{ action: "delete", key: "动机" },
		]);
		expect(() =>
			executeNoteWriteTool(
				{
					diffs: Array.from({ length: 49 }, (_, index) => ({
						action: "set",
						key: `k${index}`,
						text: "x",
					})),
				},
				notes,
			),
		).toThrow("每楼最多 50 条");
		expect(() =>
			executeNoteWriteTool({ diffs: [], extra: true }, notes),
		).toThrow("未知字段");
	});

	it("只有深回合注册手记工具", () => {
		expect(FAST_TURN_TOOLS.has("note_read")).toBe(false);
		expect(FAST_TURN_TOOLS.has("note_write")).toBe(false);
		expect(DEEP_TURN_TOOLS.get("note_read")?.permission).toBe("read");
		expect(DEEP_TURN_TOOLS.get("note_write")?.permission).toBe("propose");
		expect(validateReadToolArguments("note_read", {})).toEqual({});
		expect(() => validateReadToolArguments("note_read", { x: 1 })).toThrow(
			"note_read 不接受参数 x",
		);
	});

	it("note_read 返回路径累加结果并叠加本轮待提交修改", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.saveDirectorNotes({
			nodeId: "n-root",
			storyId: "s1",
			diffs: [{ action: "set", key: "伏笔", text: "井底的匕首" }],
		});
		const notes = new TurnNoteController();
		executeNoteWriteTool(
			{ diffs: [{ action: "set", key: "伏笔", text: "井壁的骨笛" }] },
			notes,
		);
		const context: ReadToolContext = {
			store,
			storyId: "s1",
			beforeNodeId: "n-user",
			notes,
		};
		const content = await executeReadTool("note_read", {}, context);
		expect(content).toContain("导演手记");
		expect(content).toContain("伏笔：井壁的骨笛");
		expect(content).not.toContain("井底的匕首");

		store.saveDirectorNotes({
			nodeId: "n-user",
			storyId: "s1",
			diffs: [{ action: "delete", key: "伏笔" }],
		});
		const cleared = await executeReadTool(
			"note_read",
			{},
			{
				store,
				storyId: "s1",
				beforeNodeId: "n-user",
			},
		);
		expect(cleared).toBe("当前没有导演手记。");
	});
});

describe("深回合的手记读写", () => {
	it("开始时注入累加手记，note_write 在楼层提交时写入", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.saveDirectorNotes({
			nodeId: "n-root",
			storyId: "s1",
			diffs: [
				{ action: "set", key: "伏笔", text: "井底的匕首" },
				{ action: "set", key: "动机", text: "山神在找骨笛" },
			],
		});
		let rowBeforeCommit: unknown = "unset";
		const { client, requests } = createScriptedClient(
			[
				{
					text: "",
					toolCalls: [
						{
							id: "call-1",
							name: "note_write",
							arguments: {
								diffs: [
									{ action: "set", key: "伏笔", text: "骨笛藏在井壁" },
									{ action: "delete", key: "动机" },
								],
							},
						},
						{ id: "call-2", name: "note_read", arguments: {} },
					],
				},
				{ text: "我把匕首收好，听见井壁里传来笛声。" },
			],
			(index) => {
				if (index !== 1) return;
				const userNode = store.getHead("s1");
				if (userNode === null) throw new Error("第二轮前没有用户楼层");
				rowBeforeCommit = store.getDirectorNotes(userNode.id);
			},
		);

		const turn = await runTurn({
			store,
			client,
			userText: "我贴着井壁听。",
			mode: "deep",
		});

		expect(requests).toHaveLength(2);
		const firstMessages = requests[0]?.messages ?? [];
		const injected = firstMessages.filter(
			(message) =>
				message.role === "system" &&
				typeof message.content === "string" &&
				message.content.startsWith("导演手记"),
		);
		expect(injected).toHaveLength(1);
		expect(injected[0]?.content).toContain("伏笔：井底的匕首");
		expect(injected[0]?.content).toContain("动机：山神在找骨笛");

		const toolResults = (requests[1]?.messages ?? []).filter(
			(message) => message.role === "tool",
		);
		expect(toolResults[0]?.content).toContain("已记录 2 条手记修改");
		expect(toolResults[1]?.content).toContain("伏笔：骨笛藏在井壁");
		expect(toolResults[1]?.content).not.toContain("动机");
		expect(rowBeforeCommit).toBeNull();

		const record = store.getDirectorNotes(turn.node.id);
		expect(record?.diffs).toEqual([
			{ action: "set", key: "伏笔", text: "骨笛藏在井壁" },
			{ action: "delete", key: "动机" },
		]);
		expect(turn.stateDiffs).toHaveLength(0);
		expect(turn.trace.deep).toMatchObject({ drift: "missing_commit" });

		const second = await runTurn({
			store,
			client: createScriptedClient([{ text: "笛声停了。" }]).client,
			userText: "我退后一步。",
			mode: "deep",
		});
		expect(store.readDirectorNoteEntries(second.node.id)).toEqual([
			{ key: "伏笔", text: "骨笛藏在井壁" },
		]);
	});

	it("快回合不注入手记也不暴露手记工具", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.saveDirectorNotes({
			nodeId: "n-root",
			storyId: "s1",
			diffs: [{ action: "set", key: "伏笔", text: "井底的匕首" }],
		});
		const { client, requests } = createScriptedClient([
			{ text: "你沿着井壁摸到了刻痕。" },
		]);

		const turn = await runTurn({
			store,
			client,
			userText: "我继续往下。",
			mode: "fast",
		});

		const messages = requests[0]?.messages ?? [];
		expect(
			messages.some(
				(message) =>
					message.role === "system" &&
					typeof message.content === "string" &&
					message.content.includes("导演手记"),
			),
		).toBe(false);
		expect(turn.trace.tools.calls).toHaveLength(0);
		expect(store.getDirectorNotes(turn.node.id)).toBeNull();
	});
});
