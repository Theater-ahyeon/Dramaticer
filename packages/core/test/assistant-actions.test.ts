import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, onTestFinished } from "vitest";
import type {
	DeepToolDefinition,
	LlmCallOptions,
	LlmRequest,
	LlmResult,
	LlmStream,
	LlmStreamEvent,
	LlmStreamingClient,
	LlmToolCall,
} from "../src/index.js";
import {
	ASSISTANT_ACTION_KINDS,
	AssistantActionError,
	AssistantActionPayloadError,
	AssistantConversationHasPendingActionsError,
	StoryStore,
	approveAssistantAction,
	assistantActionGate,
	canAutoExecuteAssistantAction,
	createDefaultContextTemplate,
	decideAssistantToolExecution,
	defineAssistantTool,
	readDirectorPlan,
	rejectAssistantAction,
	runAssistantTurn,
} from "../src/index.js";

function openTempStore(): { store: StoryStore; path: string } {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-assistant-actions-")),
		"story.db",
	);
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(path), { recursive: true, force: true, maxRetries: 5 });
	});
	return { store, path };
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

describe("助手三级权限", () => {
	it("权限矩阵：只读拒绝写工具，确认与自动把提案留到确认", () => {
		expect(decideAssistantToolExecution("read_only", "read")).toBe("execute");
		expect(decideAssistantToolExecution("read_only", "control")).toBe("deny");
		expect(decideAssistantToolExecution("read_only", "propose")).toBe("deny");
		expect(decideAssistantToolExecution("read_only", "side_effect")).toBe(
			"deny",
		);
		for (const permission of ["confirm", "auto"] as const) {
			expect(decideAssistantToolExecution(permission, "read")).toBe("execute");
			expect(decideAssistantToolExecution(permission, "control")).toBe(
				"execute",
			);
			expect(decideAssistantToolExecution(permission, "propose")).toBe(
				"pending",
			);
			expect(decideAssistantToolExecution(permission, "side_effect")).toBe(
				"pending",
			);
		}
	});

	it("自动级别只直接执行渠道动作，其余种类一律待确认", () => {
		expect(canAutoExecuteAssistantAction("channels")).toBe(true);
		for (const kind of ASSISTANT_ACTION_KINDS) {
			if (kind === "channels") continue;
			expect(canAutoExecuteAssistantAction(kind)).toBe(false);
		}
		expect(assistantActionGate("auto", "channels")).toBe("execute");
		expect(assistantActionGate("auto", "template")).toBe("propose");
		expect(assistantActionGate("confirm", "channels")).toBe("propose");
		expect(assistantActionGate("read_only", "channels")).toBe("deny");
	});

	it("只读级别拒绝提案工具，写 permission.denied 事件且不执行工具", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "ledger_revision",
			permission: "read_only",
		});
		let executed = false;
		const deniedTools: DeepToolDefinition[] = [
			{
				name: "propose_fake_change",
				description: "测试用提案工具",
				parameters: {
					type: "object",
					properties: {},
					additionalProperties: false,
				},
				permission: "propose",
				progressLabel: "提案……",
				execute: () => {
					executed = true;
					return "已提案";
				},
			},
			{
				name: "side_effect_fake_change",
				description: "测试用外部影响工具",
				parameters: {
					type: "object",
					properties: {},
					additionalProperties: false,
				},
				permission: "side_effect",
				progressLabel: "写入……",
				execute: () => {
					executed = true;
					return "已写入";
				},
			},
		];
		const client = new ScriptedClient([
			{
				text: "",
				toolCalls: [
					{ id: "call-1", name: "propose_fake_change", arguments: {} },
					{ id: "call-2", name: "side_effect_fake_change", arguments: {} },
				],
			},
			{ text: "这次没有修改。" },
		]);
		const result = await runAssistantTurn({
			store,
			client,
			conversationId: conversation.id,
			userText: "把好感度改成 5。",
			systemPrompt: "你是助手。",
			extraTools: deniedTools,
		});
		expect(result.status).toBe("completed");
		expect(executed).toBe(false);
		const toolMessages = store
			.getAssistantMessages(conversation.id)
			.filter((message) => message.role === "tool");
		expect(toolMessages).toHaveLength(2);
		for (const toolMessage of toolMessages) {
			expect(JSON.stringify(toolMessage.toolResult)).toContain(
				"permission_denied",
			);
		}
		const deniedEvents = store
			.listAssistantEvents(conversation.id)
			.filter((event) => event.kind === "permission.denied");
		expect(deniedEvents).toHaveLength(2);
		expect(store.listAssistantActions()).toEqual([]);
	});

	it("确认级别允许提案工具执行并写入待确认动作", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "card_workshop",
			permission: "confirm",
		});
		const propose = defineAssistantTool(
			{
				permission: "confirm",
				conversationId: conversation.id,
			},
			{
				name: "propose_fake_change",
				description: "测试用提案工具",
				parameters: {
					type: "object",
					properties: {},
					additionalProperties: false,
				},
				permission: "propose",
				progressLabel: "提案……",
				execute: () => {
					const action = store.createAssistantAction({
						conversationId: conversation.id,
						kind: "card",
						summary: "改人物提示",
						payload: { characterPrompt: "新的提示" },
					});
					return `已生成待确认动作 ${action.id}`;
				},
			},
		);
		const raw = await propose.execute?.({});
		expect(String(raw)).toContain("已生成待确认动作");
		expect(store.listAssistantActions()).toHaveLength(1);
	});
});

describe("助手待确认动作", () => {
	it("迁移 v45 建表、唯一待定索引与助手来源的变更卡", () => {
		const { store, path } = openTempStore();
		const raw = new Database(path);
		onTestFinished(() => raw.close());
		const tables = raw
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all() as { readonly name: string }[];
		expect(tables.map((row) => row.name)).toContain("assistant_actions");
		const indexes = raw
			.prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
			.all() as { readonly name: string }[];
		expect(indexes.map((row) => row.name)).toContain(
			"assistant_actions_pending_payload_idx",
		);
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "ledger_revision",
		});
		const card = store.insertLedgerChangeCard({
			id: "card-1",
			storyId: "story-1",
			source: "assistant",
			assistantConversationId: conversation.id,
			sourceNodeId: "n-user",
			text: "助手提案",
			diffs: [{ path: ["mvu", "time"], op: "set", value: "夜晚" }],
			before: [{ path: ["mvu", "time"], existed: false }],
			status: "pending",
		});
		expect(card.source).toBe("assistant");
		expect(card.assistantConversationId).toBe(conversation.id);
	});

	it("相同种类与规范化载荷不重复创建，拒绝只改状态", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "setup_wizard",
		});
		const first = store.createAssistantAction({
			conversationId: conversation.id,
			kind: "settings",
			summary: "提高预算",
			payload: { budgetTokens: 20_000, maxReadRounds: 4 },
		});
		const second = store.createAssistantAction({
			conversationId: conversation.id,
			kind: "settings",
			summary: "提高预算（重复）",
			payload: { maxReadRounds: 4, budgetTokens: 20_000 },
		});
		expect(second.id).toBe(first.id);
		expect(
			store.countPendingAssistantActions({ conversationId: conversation.id }),
		).toBe(1);
		const before = store.getStorySettings("story-1").budgetTokens;
		const rejected = rejectAssistantAction(store, first.id, "现在不需要");
		expect(rejected.status).toBe("rejected");
		expect(rejected.rejectionReason).toBe("现在不需要");
		expect(store.getStorySettings("story-1").budgetTokens).toBe(before);
		await expect(approveAssistantAction(store, first.id)).rejects.toThrow(
			/不能批准/,
		);
	});

	it("批准故事设置、卡片字段、模板、世界书、导演计划与生图配置", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "setup_wizard",
		});
		const create = (
			kind: Parameters<StoryStore["createAssistantAction"]>[0]["kind"],
			payload: Record<string, unknown>,
		) =>
			store.createAssistantAction({
				conversationId: conversation.id,
				kind,
				summary: kind,
				payload: payload as never,
			});

		const settings = create("settings", { budgetTokens: 15_000 });
		await approveAssistantAction(store, settings.id);
		expect(store.getStorySettings("story-1").budgetTokens).toBe(15_000);

		const card = create("card", { characterPrompt: "新的角色提示" });
		await approveAssistantAction(store, card.id);
		expect(store.getStorySettings("story-1").characterPrompt).toBe(
			"新的角色提示",
		);

		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		});
		const templateAction = create("template", {
			name: "助手模板",
			template,
		});
		await approveAssistantAction(store, templateAction.id);
		expect(store.listContextTemplates().map((record) => record.name)).toContain(
			"助手模板",
		);

		const lore = create("lore", {
			entries: [
				{
					name: "山门",
					content: "山门每夜闭合。",
					keywords: ["山门"],
				},
			],
		});
		await approveAssistantAction(store, lore.id);
		const entries = store.listLoreEntries("story-1");
		expect(entries).toHaveLength(1);
		expect(entries[0]?.name).toBe("山门");

		const plan = create("director_plan", { plan: { arcs: [] } });
		await approveAssistantAction(store, plan.id);
		expect(readDirectorPlan(store, "story-1").arcs).toEqual([]);

		const image = create("image_config", {
			imageConfig: {
				mode: "manual",
				workflowId: "wf-1",
				maxPerFloor: 2,
				minFloorsBetween: 4,
			},
		});
		await approveAssistantAction(store, image.id);
		expect(store.getStorySettings("story-1").imageConfig).toEqual({
			mode: "manual",
			workflowId: "wf-1",
			maxPerFloor: 2,
			minFloorsBetween: 4,
		});
	});

	it("渠道动作批准时调用注入的写入函数，缺失时保留待定", async () => {
		const { store } = openTempStore();
		const conversation = store.createAssistantConversation({
			skill: "setup_wizard",
		});
		const payload = { channels: {}, models: {}, embeddings: {}, roles: {} };
		const action = store.createAssistantAction({
			conversationId: conversation.id,
			kind: "channels",
			summary: "调整模型",
			payload,
		});
		await expect(approveAssistantAction(store, action.id)).rejects.toThrow(
			AssistantActionPayloadError,
		);
		expect(store.getAssistantAction(action.id)?.status).toBe("pending");
		const seen: unknown[] = [];
		const approved = await approveAssistantAction(store, action.id, {
			applyChannels: (value) => {
				seen.push(value);
			},
		});
		expect(approved.status).toBe("approved");
		expect(seen).toEqual([payload]);
	});

	it("批准时载荷失效保留 pending，动作不存在与重复决定有明确错误", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "card_workshop",
		});
		const action = store.createAssistantAction({
			conversationId: conversation.id,
			kind: "settings",
			summary: "换模板",
			payload: { templateId: "missing-template" },
		});
		await expect(approveAssistantAction(store, action.id)).rejects.toThrow(
			/模板不存在/,
		);
		expect(store.getAssistantAction(action.id)?.status).toBe("pending");
		const missing = await approveAssistantAction(store, "missing").catch(
			(error: unknown) => error,
		);
		expect(missing).toBeInstanceOf(AssistantActionError);
		rejectAssistantAction(store, action.id, "先不用");
		await expect(approveAssistantAction(store, action.id)).rejects.toThrow(
			/不能批准/,
		);
	});

	it("删除有未决动作的会话被拒绝，处理后可以删除", () => {
		const { store } = openTempStore();
		seedStory(store);
		const conversation = store.createAssistantConversation({
			storyId: "story-1",
			skill: "setup_wizard",
		});
		const action = store.createAssistantAction({
			conversationId: conversation.id,
			kind: "settings",
			summary: "提高预算",
			payload: { budgetTokens: 20_000 },
		});
		expect(() => store.deleteAssistantConversation(conversation.id)).toThrow(
			AssistantConversationHasPendingActionsError,
		);
		rejectAssistantAction(store, action.id, "不需要");
		store.deleteAssistantConversation(conversation.id);
		expect(store.getAssistantConversation(conversation.id)).toBeNull();
		expect(store.listAssistantActions()).toEqual([]);
	});
});
