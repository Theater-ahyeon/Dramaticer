import type { LedgerChangeCard } from "@dramaticer/core";
import type {
	AssistantActionView,
	AssistantConversationView,
} from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import {
	REVIEW_FILTER_ALL,
	describeAssistantActionFields,
	describeLedgerRows,
	matchesReviewConversation,
	reviewConversationOptions,
} from "../src/assistant/review.js";

const conversation: AssistantConversationView = {
	id: "conv-1",
	storyId: "story-1",
	skill: "setup_wizard",
	title: "设置向导",
	permission: "confirm",
	status: "idle",
	modelAlias: null,
	thinking: "off",
	contextBudget: 48_000,
	compactionThreshold: 0.8,
	createdAt: "2026-11-13T01:00:00.000Z",
	updatedAt: "2026-11-13T01:00:00.000Z",
	lastMessageAt: null,
};

function action(
	kind: AssistantActionView["kind"],
	payload: AssistantActionView["payload"],
): AssistantActionView {
	return {
		id: `action-${kind}`,
		conversationId: conversation.id,
		storyId: "story-1",
		kind,
		summary: `${kind} 提案`,
		payload,
		status: "pending",
		rejectionReason: null,
		createdAt: "2026-11-13T01:00:00.000Z",
		decidedAt: null,
	};
}

function card(overrides: Partial<LedgerChangeCard> = {}): LedgerChangeCard {
	return {
		id: "card-1",
		storyId: "story-1",
		source: "assistant",
		assistantConversationId: "conv-1",
		sourceNodeId: "n-1",
		text: "把所在地改成屋顶",
		diffs: [
			{ path: ["character", "凛", "location"], op: "set", value: "屋顶" },
			{ path: ["clue", "旧钥匙"], op: "delete" },
		],
		before: [
			{
				path: ["character", "凛", "location"],
				existed: true,
				value: "走廊",
			},
		],
		status: "pending",
		rejectionReason: null,
		createdAt: "2026-11-13T01:00:00.000Z",
		decidedAt: null,
		...overrides,
	};
}

describe("待确认视图字段", () => {
	it("渠道动作只显示别名、模型与密钥状态", () => {
		const fields = describeAssistantActionFields(
			action("channels", {
				channels: {
					main: {
						api: "openai-completions",
						baseUrl: "https://example.com/v1",
						apiKeyEnv: "SECRET_ENV_NAME",
						requestsPerMinute: 10,
					},
				},
				models: {
					writer: {
						id: "example-model",
						channels: ["main"],
						contextWindow: 8_000,
						maxTokens: 1_000,
						reasoning: false,
					},
				},
				embeddings: {
					emb: { model: "embed-model", apiKey: "sk-raw-secret" },
				},
				roles: { writer: "writer", judge: "writer" },
			}),
		);
		const text = JSON.stringify(fields);
		expect(text).toContain("模型 writer");
		expect(text).toContain("example-model");
		expect(text).toContain("密钥已设置");
		expect(text).not.toContain("sk-raw-secret");
		expect(text).not.toContain("SECRET_ENV_NAME");
		expect(text).not.toContain("example.com");
	});

	it("设置、模板、世界书与导演计划给出可以阅读的字段", () => {
		expect(
			describeAssistantActionFields(action("settings", { maxTokens: 2_048 })),
		).toEqual([{ label: "maxTokens", value: 2_048 }]);
		const templateFields = describeAssistantActionFields(
			action("template", {
				templateId: null,
				name: "新模板",
				template: {
					id: "t-1",
					segments: [{ id: "history" }, { id: "protocol" }],
				},
			}),
		);
		expect(templateFields).toContainEqual({ label: "模板", value: "新建" });
		expect(templateFields).toContainEqual({
			label: "段落",
			value: "history、protocol",
		});
		const loreFields = describeAssistantActionFields(
			action("lore", {
				entries: [{ name: "山门", content: "山门常年关闭。" }],
			}),
		);
		expect(loreFields).toEqual([
			{ label: "条目 山门", value: "山门常年关闭。" },
		]);
		const planFields = describeAssistantActionFields(
			action("director_plan", {
				plan: { arcs: [{ title: "入山" }, { title: "旧友" }] },
			}),
		);
		expect(planFields).toEqual([
			{ label: "弧线数量", value: 2 },
			{ label: "弧线 1", value: "入山" },
			{ label: "弧线 2", value: "旧友" },
		]);
	});
});

describe("待确认视图的台账卡与过滤", () => {
	it("每条路径带出原值与新值，删除没有新值", () => {
		const rows = describeLedgerRows(card());
		expect(rows).toEqual([
			{
				path: "character / 凛 / location",
				beforeExisted: true,
				before: "走廊",
				op: "set",
				after: "屋顶",
			},
			{
				path: "clue / 旧钥匙",
				beforeExisted: false,
				before: undefined,
				op: "delete",
				after: undefined,
			},
		]);
	});

	it("按会话过滤动作与台账卡，全部来源时都显示", () => {
		expect(matchesReviewConversation("conv-1", REVIEW_FILTER_ALL)).toBe(true);
		expect(matchesReviewConversation("conv-1", "conv-1")).toBe(true);
		expect(matchesReviewConversation(null, "conv-1")).toBe(false);
		const options = reviewConversationOptions(
			[action("settings", { maxTokens: 1 })],
			[card(), card({ id: "card-2", assistantConversationId: null })],
			[conversation],
		);
		expect(options).toEqual([{ id: "conv-1", title: "设置向导" }]);
	});
});
