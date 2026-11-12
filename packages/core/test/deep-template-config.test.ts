import { describe, expect, it } from "vitest";
import {
	type ContextTemplate,
	type LlmCallOptions,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmToolCall,
	type StoryStore,
	assertContextTemplate,
	contextPackFingerprint,
	createDefaultContextTemplate,
	createEventStream,
	createHistorySlotProvider,
	createStaticSlotProvider,
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
			const round = rounds[requests.length];
			if (round === undefined) {
				throw new Error(`没有为第 ${requests.length + 1} 次请求准备回复`);
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
	store.createStory({ id: "s1", title: "模板深回合配置" });
	store.appendNode({
		id: "n-root",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "井底的风还在吹。",
	});
	store.saveDirectorNotes({
		nodeId: "n-root",
		storyId: "s1",
		diffs: [{ action: "set", key: "暗记", text: "井里还有一层" }],
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

function templateWithDeepTurn(
	deepTurn: ContextTemplate["deepTurn"],
): ContextTemplate {
	const base = createDefaultContextTemplate({ structuredOutput: "text-tags" });
	return { ...base, id: "t-deep", deepTurn };
}

function toolNames(request: LlmRequest | undefined): string[] {
	return (request?.tools ?? []).map((tool) => tool.name);
}

describe("模板深回合配置校验", () => {
	it("合法配置通过校验并能保存", () => {
		const { store } = openTempStore();
		const template = templateWithDeepTurn({
			tools: ["state_get", "note_read", "draft_write"],
			maxToolCalls: 7,
			maxDurationMs: 120_000,
			notesEnabled: true,
		});
		expect(() => assertContextTemplate(template)).not.toThrow();
		const saved = store.createContextTemplate({
			name: "深回合模板",
			template,
		});
		expect(saved.template.deepTurn).toEqual(template.deepTurn);
		expect(() =>
			store.createContextTemplate({
				name: "坏的深回合模板",
				template: templateWithDeepTurn({ tools: ["nope"] }),
			}),
		).toThrow("上下文模板 t-deep 的 deepTurn.tools[0] 是未知工具：nope");
	});

	it("没有 deepTurn 的模板字段与改动前一致", () => {
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		});
		expect(template.deepTurn).toBeUndefined();
		expect(Object.keys(template).sort()).toEqual(["id", "segments"]);
	});

	it("未知工具名、重复工具名都指出模板与字段", () => {
		expect(() =>
			assertContextTemplate(
				templateWithDeepTurn({ tools: ["state_get", "nope"] }),
			),
		).toThrow("上下文模板 t-deep 的 deepTurn.tools[1] 是未知工具：nope");
		expect(() =>
			assertContextTemplate(
				templateWithDeepTurn({ tools: ["state_get", "state_get"] }),
			),
		).toThrow("上下文模板 t-deep 的 deepTurn.tools[1] 重复的工具名：state_get");
		expect(() =>
			assertContextTemplate(templateWithDeepTurn({ tools: ["state_get", ""] })),
		).toThrow("上下文模板 t-deep 的 deepTurn.tools[1] 必须是非空字符串");
	});

	it("越界上限、非布尔开关与未知字段都拒绝", () => {
		expect(() =>
			assertContextTemplate(templateWithDeepTurn({ maxToolCalls: 0 })),
		).toThrow(
			"上下文模板 t-deep 的 deepTurn.maxToolCalls 必须是 1 到 200 之间的整数",
		);
		expect(() =>
			assertContextTemplate(templateWithDeepTurn({ maxDurationMs: 59_999 })),
		).toThrow(
			"上下文模板 t-deep 的 deepTurn.maxDurationMs 必须是 60000 到 3600000 之间的整数",
		);
		expect(() =>
			assertContextTemplate(
				templateWithDeepTurn({ notesEnabled: "yes" as never }),
			),
		).toThrow("上下文模板 t-deep 的 deepTurn.notesEnabled 必须是布尔值");
		expect(() =>
			assertContextTemplate(templateWithDeepTurn({ maxToolCall: 3 } as never)),
		).toThrow("上下文模板 t-deep 的 deepTurn.maxToolCall 是未知字段");
	});

	it("手记关闭时不允许点名手记工具", () => {
		expect(() =>
			assertContextTemplate(
				templateWithDeepTurn({ notesEnabled: false, tools: ["note_read"] }),
			),
		).toThrow(
			"上下文模板 t-deep 的 deepTurn.tools 不能在 notesEnabled 为 false 时包含 note_read",
		);
	});

	it("模板变化后上下文包指纹随之变化", () => {
		const base = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		});
		const fingerprint = (template: ContextTemplate): string =>
			contextPackFingerprint({
				template,
				budgetTokens: 4_000,
				profile: "native",
				directorIntensity: null,
				providers: undefined,
			});
		expect(fingerprint({ ...base, deepTurn: { maxToolCalls: 12 } })).not.toBe(
			fingerprint(base),
		);
	});
});

describe("模板深回合配置的生效顺序", () => {
	it("模板覆盖故事设置，缺省字段沿用故事设置", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.updateStorySettings("s1", {
			deepMaxToolCalls: 12,
			deepTimeoutMs: 300_000,
		});

		const overridden = await runChatTurn({
			store,
			client: createScriptedClient([{ text: "井底有回声。" }]).client,
			storyId: "s1",
			userText: "我往下看。",
			template: templateWithDeepTurn({
				maxToolCalls: 2,
				maxDurationMs: 120_000,
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			turnMode: "deep",
		});
		expect(overridden.trace.deep?.maxToolCalls).toBe(2);
		expect(overridden.trace.deep?.maxDurationMs).toBe(120_000);

		const inherited = await runChatTurn({
			store,
			client: createScriptedClient([{ text: "井底更暗了。" }]).client,
			storyId: "s1",
			userText: "我再往下看。",
			template: templateWithDeepTurn(undefined),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			turnMode: "deep",
		});
		expect(inherited.trace.deep?.maxToolCalls).toBe(12);
		expect(inherited.trace.deep?.maxDurationMs).toBe(300_000);
	});
});

describe("模板深回合工具白名单", () => {
	it("只向模型暴露白名单里的工具，白名单内的调用照常执行", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{ text: "", toolCalls: [{ id: "c1", name: "state_get", arguments: {} }] },
			{ text: "看完了。" },
		]);

		const turn = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我先看看状态。",
			template: templateWithDeepTurn({ tools: ["state_get"] }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			turnMode: "deep",
		});

		expect(toolNames(requests[0])).toEqual(["state_get"]);
		expect(requests).toHaveLength(2);
		expect(turn.trace.tools.calls).toEqual([
			{ name: "state_get", ok: true, error: null, permission: "read" },
		]);
		expect(turn.trace.tools.rejected).toEqual([]);
	});

	it("白名单外调用按未知工具拒绝并记录", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{
				text: "我查了一眼，什么也没有。",
				toolCalls: [{ id: "c1", name: "ledger_read", arguments: {} }],
			},
			{ text: "改主意了。" },
		]);

		const turn = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我查查台账。",
			template: templateWithDeepTurn({ tools: ["state_get"] }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			turnMode: "deep",
		});

		expect(toolNames(requests[0])).toEqual(["state_get"]);
		expect(turn.trace.tools.rejected).toEqual([
			{ name: "ledger_read", reason: "未知工具：ledger_read" },
		]);
	});

	it("notesEnabled 为 false 时不暴露手记工具也不注入手记", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([
			{
				text: "记不下来。",
				toolCalls: [{ id: "c1", name: "note_write", arguments: {} }],
			},
			{ text: "记不了。" },
		]);

		const turn = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "你先记一下。",
			template: templateWithDeepTurn({ notesEnabled: false }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			turnMode: "deep",
		});

		expect(toolNames(requests[0])).not.toContain("note_read");
		expect(toolNames(requests[0])).not.toContain("note_write");
		const contents = requests[0]?.messages.map((message) => message.content);
		expect(contents?.some((content) => content.includes("暗记"))).toBe(false);
		expect(turn.trace.tools.rejected).toEqual([
			{ name: "note_write", reason: "未知工具：note_write" },
		]);
	});

	it("缺省配置仍暴露全部工具并注入手记", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([{ text: "照旧。" }]);

		await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "照常来。",
			template: templateWithDeepTurn(undefined),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			turnMode: "deep",
		});

		const names = toolNames(requests[0]);
		expect(names).toContain("note_read");
		expect(names).toContain("note_write");
		expect(names).toContain("commit_draft");
		const contents = requests[0]?.messages.map((message) => message.content);
		expect(contents?.some((content) => content.includes("暗记"))).toBe(true);
	});

	it("快回合忽略 deepTurn", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createScriptedClient([{ text: "快。" }]);

		const turn = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "快一点。",
			template: templateWithDeepTurn({
				tools: ["state_get"],
				maxToolCalls: 1,
				notesEnabled: false,
			}),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "function-call",
			turnMode: "fast",
		});

		expect(turn.trace.deep).toBeNull();
		const names = toolNames(requests[0]);
		expect(names).toContain("memory_search");
		expect(names).toContain("ledger_read");
		expect(names).not.toContain("history_read");
		expect(names).not.toContain("note_read");
	});
});
