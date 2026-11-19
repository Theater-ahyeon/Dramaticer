import { describe, expect, it } from "vitest";
import {
	DEEP_TURN_TOOLS,
	type DeepToolDefinition,
	type LlmCallOptions,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmToolCall,
	type StoryStore,
	createDeepToolRegistry,
	createDefaultContextTemplate,
	createEventStream,
	createHistorySlotProvider,
	createStaticSlotProvider,
	executeLedgerWriteTool,
	runChatTurn,
	validateLedgerWriteArguments,
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
	store.createStory({ id: "s1", title: "深回合工具" });
	store.appendNode({
		id: "n-root",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "井底的青铜匕首还在。",
	});
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

async function runDeep(input: {
	readonly store: StoryStore;
	readonly client: LlmStreamingClient;
	readonly userText: string;
	readonly transport?: "native" | "text";
	readonly structuredOutput?: "function-call" | "text-tags";
	readonly onToolProgress?: (event: {
		readonly phase: string;
		readonly detail: string;
	}) => void;
}) {
	return runChatTurn({
		store: input.store,
		client: input.client,
		storyId: "s1",
		userText: input.userText,
		template: createDefaultContextTemplate({
			structuredOutput: input.structuredOutput ?? "function-call",
		}),
		providers: providers(input.store),
		budgetTokens: 4_000,
		structuredOutput: input.structuredOutput ?? "function-call",
		toolTransport: input.transport ?? "native",
		turnMode: "deep",
		onToolProgress: input.onToolProgress,
	});
}

function toolDefinition(
	name: string,
	overrides: Partial<DeepToolDefinition> = {},
): DeepToolDefinition {
	return {
		name,
		description: "测试工具",
		parameters: { type: "object" },
		permission: "read",
		progressLabel: "处理中……",
		...overrides,
	};
}

describe("深回合工具注册表", () => {
	it("注册表拒绝未知权限、重复工具名与空进度文字", () => {
		expect(() =>
			createDeepToolRegistry([
				toolDefinition("a", { permission: "write" as never }),
			]),
		).toThrow("工具 a 的 permission 只能是");
		expect(() =>
			createDeepToolRegistry([toolDefinition("a"), toolDefinition("a")]),
		).toThrow("重复的工具名：a");
		expect(() =>
			createDeepToolRegistry([toolDefinition("a", { progressLabel: " " })]),
		).toThrow("progressLabel 必须是非空字符串");
	});

	it("深回合注册十五个工具，权限各自声明", () => {
		const registry = DEEP_TURN_TOOLS;
		expect(registry.tools.map((tool) => tool.name)).toEqual([
			"memory_search",
			"lore_lookup",
			"state_get",
			"ledger_read",
			"history_read",
			"note_read",
			"ledger_write",
			"note_write",
			"file_read",
			"file_search",
			"file_write",
			"file_patch",
			"draft_write",
			"commit_draft",
			"rule_check",
		]);
		expect(registry.get("note_read")?.permission).toBe("read");
		expect(registry.get("note_write")?.permission).toBe("propose");
		expect(registry.get("ledger_write")?.permission).toBe("propose");
		expect(registry.get("rule_check")?.permission).toBe("propose");
		expect(registry.get("history_read")?.permission).toBe("read");
		expect(registry.get("ledger_read")?.permission).toBe("read");
		expect(registry.get("file_read")?.permission).toBe("read");
		expect(registry.get("file_search")?.permission).toBe("read");
		expect(registry.get("file_write")?.permission).toBe("control");
		expect(registry.get("file_patch")?.permission).toBe("control");
		expect(registry.get("draft_write")?.permission).toBe("control");
		expect(registry.get("commit_draft")?.permission).toBe("control");
	});
});

describe("ledger_write 参数校验", () => {
	it("逐条接受合法条目并拒绝非法条目", () => {
		const validation = validateLedgerWriteArguments({
			diffs: [
				{
					path: ["character", "卫宫", "status"],
					value: "警觉",
					storyTime: { start: "夜", end: null },
					confidence: 0.5,
				},
				{ path: ["unknown", "x"], value: 1 },
				{ path: ["character", "卫宫"], value: 1 },
				{ path: ["clue", "井底匕首", "status"], value: "resolved" },
			],
		});
		expect(validation.accepted).toHaveLength(1);
		expect(validation.accepted[0]).toMatchObject({
			path: ["character", "卫宫", "status"],
			value: "警觉",
			storyTime: { start: "夜", end: null },
			confidence: 0.5,
		});
		expect(validation.rejected.map((item) => item.index)).toEqual([1, 2, 3]);
		expect(validation.rejected[0]?.reason).toContain("未知台账命名空间");
		expect(validation.rejected[1]?.reason).toContain(
			"只能删除，字段必须逐项写入",
		);
		expect(validation.rejected[2]?.reason).toContain(
			"status 只能是 open、progress、fulfilled",
		);
	});

	it("整体形状错误直接拒绝", () => {
		expect(() => validateLedgerWriteArguments({ diffs: [] })).toThrow(
			"ledger_write.diffs 至少要有一条",
		);
		expect(() => validateLedgerWriteArguments({ diffs: "x" })).toThrow(
			"ledger_write.diffs 必须是数组",
		);
		const missingValue = validateLedgerWriteArguments({
			diffs: [{ path: ["character", "a", "status"] }],
		});
		expect(missingValue.accepted).toHaveLength(0);
		expect(missingValue.rejected[0]?.reason).toContain("value 缺失");
		const unknownField = validateLedgerWriteArguments({
			diffs: [{ path: ["character", "a", "status"], value: "x", note: 1 }],
		});
		expect(unknownField.rejected[0]?.reason).toContain(
			"ledger_write.diffs[0].note 是未知字段",
		);
		const many = Array.from({ length: 21 }, (_, index) => ({
			path: ["character", `n${index}`, "status"],
			value: "x",
		}));
		expect(() => validateLedgerWriteArguments({ diffs: many })).toThrow(
			"ledger_write.diffs 最多 20 条",
		);
	});

	it("执行时不写数据库，只报告收集结果", () => {
		const outcome = executeLedgerWriteTool({
			diffs: [{ path: ["character", "卫宫", "status"], value: "警觉" }],
		});
		expect(outcome.ok).toBe(true);
		expect(outcome.error).toBeNull();
		expect(outcome.content).toContain("已收集 1 条台账写入");
	});
});

describe("深回合内的台账写入", () => {
	it("合法条目在楼层提交时写入，非法条目返回工具错误", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const observed: number[] = [];
		const { client, requests } = createScriptedClient(
			[
				{
					text: "我先记下。",
					toolCalls: [
						{
							id: "call-1",
							name: "ledger_write",
							arguments: {
								diffs: [
									{
										path: ["character", "卫宫", "status"],
										value: "警觉",
										storyTime: { start: "夜", end: null },
										confidence: 0.5,
									},
									{ path: ["unknown", "x"], value: 1 },
								],
							},
						},
						{
							id: "call-2",
							name: "ledger_write",
							arguments: {
								diffs: [
									{ path: ["clue", "井底匕首", "status"], value: "open" },
								],
							},
						},
						{ id: "call-3", name: "state_get", arguments: {} },
					],
				},
				{ text: "记好了。" },
			],
			(index) => {
				if (index !== 1) return;
				const head = store.getHead("s1");
				if (head === null) throw new Error("第二轮前没有用户楼层");
				observed.push(store.getStateDiffsAlongPath(head.id).length);
			},
		);

		const turn = await runDeep({ store, client, userText: "我记下井底的事。" });

		expect(requests).toHaveLength(2);
		expect(observed).toEqual([0]);
		expect(turn.stateDiffs).toHaveLength(2);
		expect(turn.stateDiffs[0]).toMatchObject({
			path: ["character", "卫宫", "status"],
			value: "警觉",
			storyTime: { start: "夜", end: null },
			confidence: 0.5,
			nodeId: turn.node.id,
			source: "model",
		});
		expect(turn.trace.tools.calls.map((call) => call.permission)).toEqual([
			"propose",
			"propose",
			"read",
		]);
		expect(turn.trace.tools.calls[0]).toMatchObject({
			name: "ledger_write",
			ok: false,
			error: "1 条台账写入不合法",
		});
		const results = (requests[1]?.messages ?? []).filter(
			(message) => message.role === "tool",
		);
		expect(results[0]?.content).toContain("以下 1 条不合法");
		expect(results[0]?.isError).toBe(true);
		expect(results[1]?.content).toContain("已收集 1 条台账写入");
		expect(results[1]?.isError).toBe(false);
	});

	it("文本协议与原生传输产生相同的写入结果", async () => {
		const paths: string[][] = [];
		for (const transport of ["native", "text"] as const) {
			const { store } = openTempStore();
			seedStory(store);
			const { client } = createScriptedClient(
				transport === "native"
					? [
							{
								text: "",
								toolCalls: [
									{
										id: "call-1",
										name: "ledger_write",
										arguments: {
											diffs: [
												{
													path: ["character", "卫宫", "status"],
													value: "警觉",
												},
											],
										},
									},
									{ id: "call-2", name: "state_get", arguments: {} },
								],
							},
							{ text: "记好了。" },
						]
					: [
							{
								text: [
									'<tool name="ledger_write">{"diffs":[{"path":["character","卫宫","status"],"value":"警觉"}]}</tool>',
									'<tool name="state_get">{}</tool>',
								].join("\n"),
							},
							{ text: "记好了。" },
						],
			);
			const turn = await runDeep({
				store,
				client,
				userText: "我记下。",
				transport,
				structuredOutput: transport === "text" ? "text-tags" : "function-call",
			});
			paths.push(turn.stateDiffs.map((diff) => [...diff.path]));
			expect(turn.trace.tools.calls.map((call) => call.name)).toEqual([
				"ledger_write",
				"state_get",
			]);
		}
		expect(paths[0]).toEqual(paths[1]);
		expect(paths[0]).toEqual([["character", "卫宫", "status"]]);
	});

	it("未启用的侧效应工具返回错误，未注册的工具被拒绝", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{
				text: "",
				toolCalls: [
					{
						id: "call-1",
						name: "illustrate",
						arguments: { scene: "雨夜" },
					},
					{ id: "call-2", name: "teleport", arguments: {} },
					{ id: "call-3", name: "state_get", arguments: {} },
				],
			},
			{ text: "我收回手。" },
		]);

		const turn = await runDeep({ store, client, userText: "我想画一张。" });

		expect(turn.trace.tools.calls).toContainEqual({
			name: "illustrate",
			ok: false,
			error: "故事没有配置生图",
			permission: "side_effect",
		});
		expect(turn.trace.tools.rejected).toEqual([
			{ name: "teleport", reason: "未知工具：teleport" },
		]);
		const results = (requests[1]?.messages ?? []).filter(
			(message) => message.role === "tool",
		);
		expect(results[0]?.content).toContain("工具未启用：illustrate");
	});

	it("进度事件只在阶段变化时发送", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const phases: string[] = [];
		const search = (id: string) => ({
			id,
			name: "memory_search",
			arguments: { query: "青铜匕首" },
		});
		const { client } = createScriptedClient([
			{ text: "", toolCalls: [search("call-1"), search("call-2")] },
			{ text: "", toolCalls: [search("call-3")] },
			{
				text: "",
				toolCalls: [{ id: "call-4", name: "state_get", arguments: {} }],
			},
			{ text: "看完了。" },
		]);

		await runDeep({
			store,
			client,
			userText: "我四处查。",
			onToolProgress: (event) => {
				phases.push(`${event.phase}:${event.detail}`);
			},
		});

		expect(phases).toEqual(["回忆中……:memory_search", "读取状态……:state_get"]);
	});

	it("自查清单与工作区说明记进上下文构成", async () => {
		const { store } = openTempStore();
		seedStory(store);
		writeMemoryPref(store, "s1", { text: "别替我做决定" });
		const { client } = createScriptedClient([{ text: "我记下了。" }]);

		const turn = await runDeep({ store, client, userText: "我想想。" });

		const entries = turn.trace.context.entries;
		const checklist = entries.find(
			(entry) => entry.segmentId === "deep:自查清单",
		);
		expect(checklist?.status).toBe("included");
		expect(checklist?.tokens).toBeGreaterThan(0);
		const guide = entries.find(
			(entry) => entry.segmentId === "deep:工作区说明",
		);
		expect(guide?.status).toBe("included");
		expect(guide?.tokens).toBeGreaterThan(0);
	});
});
