import { describe, expect, it } from "vitest";
import {
	type DramaticerRuleDeclaration,
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
	runChatTurn,
	validateLedgerDiff,
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

function seedStory(
	store: StoryStore,
	rules: readonly DramaticerRuleDeclaration[],
	resource: number | null = null,
): void {
	store.createStory({ id: "s1", title: "规则工具" });
	store.appendNode({
		id: "n-root",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "山门打开。",
	});
	if (resource !== null) {
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "n-root",
				path: ["mvu", "真气"],
				op: "set",
				value: resource,
				source: "import",
			},
		]);
	}
	if (rules.length > 0) {
		store.replaceStoryRules({ storyId: "s1", rules });
	}
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

const sword = (
	difficulty: number,
	cost: number,
): DramaticerRuleDeclaration => ({
	id: "sword",
	label: "剑术检定",
	target: "剑术",
	difficulty,
	resource: { path: ["真气"], cost },
});

async function runFast(input: {
	readonly store: StoryStore;
	readonly client: LlmStreamingClient;
}) {
	return runChatTurn({
		store: input.store,
		client: input.client,
		storyId: "s1",
		userText: "我拔剑。",
		template: createDefaultContextTemplate({
			structuredOutput: "function-call",
		}),
		providers: providers(input.store),
		budgetTokens: 4_000,
		structuredOutput: "function-call",
	});
}

function toolResultMessage(
	requests: readonly LlmRequest[],
	index: number,
	toolCallId: string,
) {
	const messages = requests[index]?.messages ?? [];
	const message = messages.find(
		(item) => item.role === "tool" && item.toolCallId === toolCallId,
	);
	if (message === undefined) {
		throw new Error(`第 ${index + 1} 次请求里没有工具结果 ${toolCallId}`);
	}
	return message;
}

describe("rule_check 工具", () => {
	it("声明了规则时开放，检定与资源余量进入待提交台账写入", async () => {
		const { store } = openTempStore();
		seedStory(store, [sword(10, 2)], 5);
		const { client, requests } = createScriptedClient([
			{
				text: "",
				toolCalls: [
					{ id: "call-1", name: "rule_check", arguments: { ruleId: "sword" } },
				],
			},
			{ text: "剑光一闪。" },
		]);

		const result = await runFast({ store, client });

		expect(requests[0]?.tools?.map((tool) => tool.name)).toEqual([
			"state_update",
			"plot_note",
			"memory_search",
			"lore_lookup",
			"state_get",
			"ledger_read",
			"rule_check",
		]);
		const toolResult = toolResultMessage(requests, 1, "call-1");
		expect(toolResult.isError).toBe(false);
		expect(toolResult.content).toContain("规则「剑术检定」检定");
		expect(toolResult.content).toContain("资源 真气 5 → 3");
		expect(toolResult.content).toContain("由结算器校验后写入台账");

		expect(result.node.raw).toBe("剑光一闪。");
		expect(result.trace.tools.calls).toEqual([
			{
				name: "rule_check",
				ok: true,
				error: null,
				permission: "propose",
			},
		]);
		const resourceDiff = result.stateDiffs.find(
			(diff) => diff.path.join(".") === "mvu.真气",
		);
		expect(resourceDiff?.value).toBe(3);
		const resultDiff = result.stateDiffs.find(
			(diff) => diff.path.join(".") === "rule.sword.result",
		);
		const value = resultDiff?.value as {
			readonly roll: number;
			readonly difficulty: number;
			readonly success: boolean;
		};
		expect(value.difficulty).toBe(10);
		expect(value.roll).toBeGreaterThanOrEqual(1);
		expect(value.roll).toBeLessThanOrEqual(20);
		expect(value.success).toBe(value.roll >= value.difficulty);
		for (const diff of result.stateDiffs) {
			expect(() =>
				validateLedgerDiff({
					path: diff.path,
					op: diff.op,
					value: diff.value,
				}),
			).not.toThrow();
		}
		expect(store.getStateSnapshot(result.node.id).state).toMatchObject({
			mvu: { 真气: 3 },
			rule: { sword: { result: value } },
		});
	});

	it("没有声明规则时不开放，调用被拒绝并记录原因", async () => {
		const { store } = openTempStore();
		seedStory(store, [], 5);
		const { client, requests } = createScriptedClient([
			{
				text: "",
				toolCalls: [
					{ id: "call-1", name: "rule_check", arguments: { ruleId: "sword" } },
				],
			},
			{ text: "剑光一闪。" },
		]);

		const result = await runFast({ store, client });

		expect(requests[0]?.tools?.map((tool) => tool.name)).not.toContain(
			"rule_check",
		);
		expect(result.trace.tools.calls).toEqual([
			{
				name: "rule_check",
				ok: false,
				error: "工具未启用：rule_check（卡没有声明规则）",
				permission: "propose",
			},
		]);
		const toolResult = toolResultMessage(requests, 1, "call-1");
		expect(toolResult.isError).toBe(true);
		expect(toolResult.content).toContain("卡没有声明规则");
		expect(result.node.raw).toBe("剑光一闪。");
		expect(result.stateDiffs).toEqual([]);
	});

	it("未知规则与资源不足作为工具错误返回，正文照常保存", async () => {
		const { store } = openTempStore();
		seedStory(store, [sword(10, 5)], 4);
		const { client, requests } = createScriptedClient([
			{
				text: "",
				toolCalls: [
					{ id: "call-1", name: "rule_check", arguments: { ruleId: "spear" } },
					{ id: "call-2", name: "rule_check", arguments: { ruleId: "sword" } },
				],
			},
			{ text: "剑没有出鞘。" },
		]);

		const result = await runFast({ store, client });

		const unknown = toolResultMessage(requests, 1, "call-1");
		expect(unknown.isError).toBe(true);
		expect(unknown.content).toContain("未知规则：spear");
		expect(unknown.content).toContain("已声明的规则：sword");
		const insufficient = toolResultMessage(requests, 1, "call-2");
		expect(insufficient.isError).toBe(true);
		expect(insufficient.content).toContain("资源 真气 不足：当前 4，需要 5");
		expect(result.trace.tools.calls.map((call) => call.ok)).toEqual([
			false,
			false,
		]);
		expect(result.node.raw).toBe("剑没有出鞘。");
		expect(result.stateDiffs).toEqual([]);
	});

	it("同一回合连续检定不会重复花掉同一份资源", async () => {
		const { store } = openTempStore();
		seedStory(store, [sword(10, 3)], 5);
		const { client, requests } = createScriptedClient([
			{
				text: "",
				toolCalls: [
					{ id: "call-1", name: "rule_check", arguments: { ruleId: "sword" } },
					{ id: "call-2", name: "rule_check", arguments: { ruleId: "sword" } },
				],
			},
			{ text: "我只挥出一剑。" },
		]);

		const result = await runFast({ store, client });

		expect(toolResultMessage(requests, 1, "call-1").isError).toBe(false);
		const second = toolResultMessage(requests, 1, "call-2");
		expect(second.isError).toBe(true);
		expect(second.content).toContain("资源 真气 不足：当前 2，需要 3");
		const resourceDiffs = result.stateDiffs.filter(
			(diff) => diff.path.join(".") === "mvu.真气",
		);
		expect(resourceDiffs).toHaveLength(1);
		expect(resourceDiffs[0]?.value).toBe(2);
		expect(result.trace.tools.calls.map((call) => call.ok)).toEqual([
			true,
			false,
		]);
	});

	it("非法参数指出字段，不执行检定", async () => {
		const { store } = openTempStore();
		seedStory(store, [sword(10, 1)], 5);
		const { client, requests } = createScriptedClient([
			{
				text: "",
				toolCalls: [
					{ id: "call-1", name: "rule_check", arguments: { rule: "sword" } },
				],
			},
			{ text: "剑还在鞘里。" },
		]);

		const result = await runFast({ store, client });

		const rejection = toolResultMessage(requests, 1, "call-1");
		expect(rejection.isError).toBe(true);
		expect(rejection.content).toContain("rule_check 不接受参数 rule");
		expect(result.trace.tools.calls[0]).toMatchObject({
			name: "rule_check",
			ok: false,
			error: "rule_check 不接受参数 rule",
		});
		expect(result.stateDiffs).toEqual([]);
	});
});
