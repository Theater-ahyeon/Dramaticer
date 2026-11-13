import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import type {
	LlmCallOptions,
	LlmRequest,
	LlmResult,
	LlmStream,
	LlmStreamEvent,
	LlmStreamingClient,
	LlmToolCall,
} from "../src/index.js";
import {
	PROPOSE_DIRECTOR_PLAN_TOOL_NAME,
	PROPOSE_LEDGER_CHANGE_TOOL_NAME,
	approveAssistantAction,
	approveLedgerChangeCard,
	createAssistantProposalTools,
	createAssistantTools,
	readDirectorPlan,
	readLedger,
	readLedgerFacts,
	rejectAssistantAction,
	rejectLedgerChangeCard,
	requireAssistantSkill,
	runAssistantTurn,
} from "../src/index.js";
import { StoryStore } from "../src/store/story-store.js";

function openTempStore(): { store: StoryStore; path: string } {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-assistant-proposals-")),
		"story.db",
	);
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(path), { recursive: true, force: true, maxRetries: 5 });
	});
	return { store, path };
}

const AFFECTION_PATH = ["relation", "甲", "乙", "affectionInner"];

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
		raw: "我看向她。",
	});
	store.appendStateDiffs([
		{
			storyId: "story-1",
			nodeId: "n-user",
			path: AFFECTION_PATH,
			op: "set",
			value: "冷淡",
			source: "model",
		},
	]);
}

function ledgerTool(
	store: StoryStore,
	conversationId: string,
	permission: "confirm" | "read_only" | "auto" = "confirm",
) {
	const tools = createAssistantProposalTools({
		store,
		storyId: "story-1",
		conversationId,
		permission,
	});
	const tool = tools.find(
		(candidate) => candidate.name === PROPOSE_LEDGER_CHANGE_TOOL_NAME,
	);
	if (tool?.execute === undefined) throw new Error("没有生成台账提案工具");
	return tool;
}

interface FakeReply {
	readonly text: string;
	readonly toolCalls?: readonly LlmToolCall[];
}

class ScriptedClient implements LlmStreamingClient {
	readonly #replies: FakeReply[];

	constructor(replies: readonly FakeReply[]) {
		this.#replies = [...replies];
	}

	async complete(): Promise<LlmResult> {
		throw new Error("助手运行不应该调用 complete");
	}

	stream(request: LlmRequest, _options?: LlmCallOptions): LlmStream {
		const reply = this.#replies.shift();
		if (reply === undefined) {
			throw new Error("测试没有准备这一轮回复");
		}
		const events: LlmStreamEvent[] = [...reply.text].map((delta) => ({
			type: "text_delta" as const,
			delta,
		}));
		const result: LlmResult = {
			text: reply.text,
			reasoning: "",
			toolCalls: reply.toolCalls ?? [],
			finishReason: (reply.toolCalls ?? []).length > 0 ? "tool_calls" : "stop",
			stopReason: (reply.toolCalls ?? []).length > 0 ? "toolUse" : "stop",
			model: "fake-model",
			channel: "fake",
			usage: {
				promptTokens: 1,
				completionTokens: 1,
				totalTokens: 2,
				reasoningTokens: 0,
				cachedTokens: 0,
			},
			raw: null,
			cached: false,
			attempts: 1,
			rounds: 1,
			truncation: null,
			continuation: null,
		};
		let index = 0;
		return {
			[Symbol.asyncIterator]() {
				return this;
			},
			async next(): Promise<IteratorResult<LlmStreamEvent>> {
				if (request.signal?.aborted) throw request.signal.reason;
				if (index < events.length) {
					const event = events[index] as LlmStreamEvent;
					index += 1;
					return { done: false, value: event };
				}
				return { done: true, value: undefined };
			},
			async result(): Promise<LlmResult> {
				return result;
			},
		};
	}
}

describe("台账修订提案", () => {
	it("生成待批准卡，批准后写入事实，拒绝后不变", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "ledger_revision",
		});
		const propose = ledgerTool(store, conversation.id);
		const pathBefore = store.getPathToNode("n-user").length;

		const text = String(
			await propose.execute?.({
				diffs: [{ path: AFFECTION_PATH, op: "set", value: "亲近" }],
				explanation: "她刚刚主动出手救人，好感应当提高。",
			}),
		);
		const cards = store.listLedgerChangeCards("story-1", {
			status: "pending",
		});
		expect(cards).toHaveLength(1);
		const card = cards[0];
		if (card === undefined) throw new Error("没有生成变更卡");
		expect(text).toContain(card.id);
		expect(card.source).toBe("assistant");
		expect(card.assistantConversationId).toBe(conversation.id);
		expect(card.sourceNodeId).toBe("n-user");
		expect(card.text).toBe("她刚刚主动出手救人，好感应当提高。");
		expect(card.diffs).toEqual([
			{ path: AFFECTION_PATH, op: "set", value: "亲近" },
		]);
		expect(card.before).toEqual([
			{ path: AFFECTION_PATH, existed: true, value: "冷淡" },
		]);
		expect(readLedger(store, "n-user", AFFECTION_PATH)).toBe("冷淡");

		const again = String(
			await propose.execute?.({
				diffs: [{ path: AFFECTION_PATH, op: "set", value: "亲近" }],
				explanation: "她刚刚主动出手救人，好感应当提高。",
			}),
		);
		expect(again).toContain("已经存在");
		expect(store.listLedgerChangeCards("story-1")).toHaveLength(1);

		await approveLedgerChangeCard(store, card.id);
		expect(readLedger(store, "n-user", AFFECTION_PATH)).toBe("亲近");
		const fact = readLedgerFacts(store, "n-user", AFFECTION_PATH).at(-1);
		expect(fact?.source).toBe("player");
		expect(store.getPathToNode("n-user").length).toBe(pathBefore);
		expect(store.getHead("story-1")?.id).toBe("n-user");

		const rejectedText = String(
			await propose.execute?.({
				diffs: [{ path: AFFECTION_PATH, op: "set", value: "敌对" }],
				explanation: "这次先压回去。",
			}),
		);
		const pending = store.listLedgerChangeCards("story-1", {
			status: "pending",
		});
		expect(pending).toHaveLength(1);
		const rejected = pending[0];
		if (rejected === undefined) throw new Error("没有生成第二张变更卡");
		expect(rejectedText).toContain(rejected.id);
		await rejectLedgerChangeCard(store, rejected.id);
		expect(readLedger(store, "n-user", AFFECTION_PATH)).toBe("亲近");
	});

	it("非法路径整条拒绝并指出字段，未存在的删除路径与没有 head 的故事直接失败", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "ledger_revision",
		});
		const propose = ledgerTool(store, conversation.id);

		expect(() =>
			propose.execute?.({
				diffs: [{ path: ["nope", "x"], op: "set", value: 1 }],
				explanation: "未知命名空间",
			}),
		).toThrow(/参数\.diffs\[0\] 不合法.*未知台账命名空间/);
		expect(() =>
			propose.execute?.({
				diffs: [{ path: ["item", "剑"], op: "delete" }],
				explanation: "删掉不存在的物品",
			}),
		).toThrow(/参数\.diffs\[0\]\.path 指向的台账路径不存在/);
		expect(store.listLedgerChangeCards("story-1")).toEqual([]);

		store.createStory({ id: "story-2", title: "空故事" });
		const empty = store.createAssistantConversation({
			storyId: "story-2",
			skill: "ledger_revision",
		});
		const emptyTool = createAssistantProposalTools({
			store,
			storyId: "story-2",
			conversationId: empty.id,
			permission: "confirm",
		}).find((candidate) => candidate.name === PROPOSE_LEDGER_CHANGE_TOOL_NAME);
		expect(() =>
			emptyTool?.execute?.({
				diffs: [{ path: AFFECTION_PATH, op: "set", value: "亲近" }],
				explanation: "没有楼层",
			}),
		).toThrow(/还没有任何楼层（没有 head）/);
	});

	it("只读级别拒绝生成变更卡，自动级别仍然只生成待确认卡", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "ledger_revision",
			permission: "read_only",
		});
		const propose = ledgerTool(store, conversation.id, "read_only");
		expect(() =>
			propose.execute?.({
				diffs: [{ path: AFFECTION_PATH, op: "set", value: "亲近" }],
				explanation: "只读会话",
			}),
		).toThrow(/permission_denied/);
		expect(store.listLedgerChangeCards("story-1")).toEqual([]);

		const auto = store.createAssistantConversation({
			storyId: "story-1",
			skill: "ledger_revision",
			permission: "auto",
		});
		const autoTool = ledgerTool(store, auto.id, "auto");
		String(
			autoTool.execute?.({
				diffs: [{ path: AFFECTION_PATH, op: "set", value: "亲近" }],
				explanation: "自动级别也要玩家批准。",
			}),
		);
		const cards = store.listLedgerChangeCards("story-1");
		expect(cards).toHaveLength(1);
		expect(cards[0]?.status).toBe("pending");
		expect(cards[0]?.assistantConversationId).toBe(auto.id);
	});
});

describe("参谋提案", () => {
	const plan = {
		arcs: [
			{
				id: "arc-1",
				title: "旧城的影子",
				throughLine: "她必须在家族与自己的选择之间做决定。",
				difficulty: 0.4,
				redLines: ["不让角色凭空白给"],
				sequences: [
					{
						id: "seq-1",
						title: "第一夜",
						beats: [
							{
								id: "beat-1",
								goal: "让玩家看到旧城在夜里换了一副面孔。",
								entrySigns: ["街灯同时熄灭"],
								fitPoints: ["她熟悉每条巷子"],
							},
						],
					},
				],
			},
		],
	};

	function directorTool(
		store: StoryStore,
		conversationId: string,
		permission: "confirm" | "read_only" = "confirm",
	) {
		const tool = createAssistantProposalTools({
			store,
			storyId: "story-1",
			conversationId,
			permission,
		}).find((candidate) => candidate.name === PROPOSE_DIRECTOR_PLAN_TOOL_NAME);
		if (tool?.execute === undefined) throw new Error("没有生成导演提案工具");
		return tool;
	}

	it("批准后计划可读回，拒绝后计划不变", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "strategy",
		});
		const propose = directorTool(store, conversation.id);
		const pathBefore = store.getPathToNode("n-user").length;

		const text = String(
			await propose.execute?.({
				plan,
				summary: "把第一夜写成街灯熄灭后的追踪。",
			}),
		);
		const actions = store.listAssistantActions({ status: "pending" });
		expect(actions).toHaveLength(1);
		const action = actions[0];
		if (action === undefined) throw new Error("没有生成导演计划动作");
		expect(text).toContain(action.id);
		expect(action.kind).toBe("director_plan");
		expect(action.storyId).toBe("story-1");
		expect(action.summary).toBe("把第一夜写成街灯熄灭后的追踪。");
		expect(readDirectorPlan(store, "story-1").arcs).toEqual([]);

		await approveAssistantAction(store, action.id);
		expect(readDirectorPlan(store, "story-1")).toEqual(plan);
		expect(store.getPathToNode("n-user").length).toBe(pathBefore);
		expect(store.getHead("story-1")?.id).toBe("n-user");

		const second = String(
			await propose.execute?.({
				plan: {
					arcs: [
						{
							...plan.arcs[0],
							id: "arc-2",
							title: "另一条线",
						},
					],
				},
			}),
		);
		const pending = store.listAssistantActions({ status: "pending" });
		expect(pending).toHaveLength(1);
		const secondAction = pending[0];
		if (secondAction === undefined) throw new Error("没有生成第二份计划");
		expect(second).toContain(secondAction.id);
		await rejectAssistantAction(store, secondAction.id, "这条线先不用");
		expect(readDirectorPlan(store, "story-1")).toEqual(plan);
	});

	it("非法计划被拒绝，只读级别不能生成动作", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "strategy",
		});
		const propose = directorTool(store, conversation.id);
		expect(() =>
			propose.execute?.({
				plan: { arcs: [], extra: true },
				summary: "非法计划",
			}),
		).toThrow(/参数\.plan/);
		expect(store.listAssistantActions()).toEqual([]);

		const readOnly = store.createAssistantConversation({
			storyId: "story-1",
			skill: "strategy",
			permission: "read_only",
		});
		const denied = directorTool(store, readOnly.id, "read_only");
		expect(() => denied.execute?.({ plan, summary: "只读会话" })).toThrow(
			/permission_denied/,
		);
		expect(store.listAssistantActions()).toEqual([]);
	});

	it("参谋读取工具包含摘要且不调用模型", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.insertSummary({
			storyId: "story-1",
			level: "chapter",
			startNodeId: "n-root",
			endNodeId: "n-user",
			text: "第一章：她在门口停了一下。",
		});
		const tools = createAssistantTools({ store, storyId: "story-1" });
		const summarize = tools.find((tool) => tool.name === "summarize_recent");
		const text = String(await summarize?.execute?.({}));
		expect(text).toContain("第一章：她在门口停了一下。");
		expect(text).toContain("章节摘要");
	});
});

describe("提案技能运行", () => {
	it("确认级别通过运行创建变更卡且不改动楼层", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "ledger_revision",
			permission: "confirm",
		});
		const client = new ScriptedClient([
			{
				text: "",
				toolCalls: [
					{
						id: "call-1",
						name: PROPOSE_LEDGER_CHANGE_TOOL_NAME,
						arguments: {
							diffs: [{ path: AFFECTION_PATH, op: "set", value: "亲近" }],
							explanation: "她刚刚主动出手救人。",
						},
					},
				],
			},
			{ text: "已经生成待批准的变更卡。" },
		]);
		const pathBefore = store.getPathToNode("n-user").length;
		const skill = requireAssistantSkill("ledger_revision");
		const result = await runAssistantTurn({
			store,
			client,
			conversationId: conversation.id,
			userText: "把好感度改成亲近。",
			systemPrompt: skill.instructions,
			toolNames: skill.toolNames,
			extraTools: createAssistantProposalTools({
				store,
				storyId: "story-1",
				conversationId: conversation.id,
				permission: conversation.permission,
			}),
		});
		expect(result.status).toBe("completed");
		expect(result.text).toBe("已经生成待批准的变更卡。");
		const cards = store.listLedgerChangeCards("story-1");
		expect(cards).toHaveLength(1);
		expect(cards[0]?.source).toBe("assistant");
		expect(store.getPathToNode("n-user").length).toBe(pathBefore);
		expect(store.getHead("story-1")?.id).toBe("n-user");
	});

	it("只读级别在运行中拒绝提案工具并写事件", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "ledger_revision",
			permission: "read_only",
		});
		const client = new ScriptedClient([
			{
				text: "",
				toolCalls: [
					{
						id: "call-1",
						name: PROPOSE_LEDGER_CHANGE_TOOL_NAME,
						arguments: {
							diffs: [{ path: AFFECTION_PATH, op: "set", value: "亲近" }],
							explanation: "只读会话",
						},
					},
				],
			},
			{ text: "这次只读，没有生成变更卡。" },
		]);
		const skill = requireAssistantSkill("ledger_revision");
		const result = await runAssistantTurn({
			store,
			client,
			conversationId: conversation.id,
			userText: "把好感度改成亲近。",
			systemPrompt: skill.instructions,
			toolNames: skill.toolNames,
			extraTools: createAssistantProposalTools({
				store,
				storyId: "story-1",
				conversationId: conversation.id,
				permission: conversation.permission,
			}),
		});
		expect(result.status).toBe("completed");
		expect(store.listLedgerChangeCards("story-1")).toEqual([]);
		const denied = store
			.listAssistantEvents(conversation.id)
			.filter((event) => event.kind === "permission.denied");
		expect(denied).toHaveLength(1);
		const toolMessage = store
			.getAssistantMessages(conversation.id)
			.find((message) => message.role === "tool");
		expect(JSON.stringify(toolMessage?.toolResult)).toContain(
			"permission_denied",
		);
	});
});
