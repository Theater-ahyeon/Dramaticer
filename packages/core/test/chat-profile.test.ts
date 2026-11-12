import { describe, expect, it } from "vitest";
import {
	type ChatProfile,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	SETTLE_JOB_KIND,
	type StoryStore,
	assertChatProfile,
	createDefaultContextTemplate,
	createEventStream,
	createHistorySlotProvider,
	createNaiveChatSlots,
	createNaiveContextTemplate,
	createStandardChatSlots,
	createStaticSlotProvider,
	isChatProfile,
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

const REPLY = `山门缓缓打开。
<状态栏>当前时间：黄昏</状态栏>
<state_update>{"path":["场景","地点"],"op":"set","value":"山门"}</state_update>
<plot_note>{"text":"门后有人跟踪"}</plot_note>`;

interface Recorded {
	readonly client: LlmStreamingClient;
	readonly requests: LlmRequest[];
}

function createFakeClient(text: string): Recorded {
	const requests: LlmRequest[] = [];
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
		continuation: text.length > 0 ? { text, reasoning: "" } : null,
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
					emit({ type: "text_delta", delta: text });
					return result;
				});
			},
		},
	};
}

function seedStory(store: StoryStore, storyId = "s1"): void {
	store.createStory({ id: storyId, title: "档位测试" });
	store.appendNode({
		id: `${storyId}-greeting`,
		storyId,
		parentId: null,
		role: "assistant",
		raw: "井底的风还在吹。\n<选项>往上看 / 往下看</选项>",
	});
}

async function naiveInputs(store: StoryStore, storyId: string) {
	return {
		template: createNaiveContextTemplate(),
		providers: (
			await createNaiveChatSlots({
				store,
				characterPrompt: "你扮演山神。",
				persona: "你是云游的剑客。",
			})
		).providers,
		storyId,
	};
}

describe("对话档位", () => {
	it("只接受 native 与 naive，默认档位是 native", () => {
		expect(isChatProfile("native")).toBe(true);
		expect(isChatProfile("naive")).toBe(true);
		expect(isChatProfile("turbo")).toBe(false);
		expect(() => {
			assertChatProfile("turbo");
		}).toThrow("native 或 naive");
		expect(() => {
			assertChatProfile("turbo", "--profile");
		}).toThrow("--profile");
	});

	it("朴素模式的模板只有角色、persona、历史与写作契约", () => {
		const template = createNaiveContextTemplate();
		expect(template.segments.map((segment) => segment.id)).toEqual([
			"character",
			"persona",
			"history",
			"protocol",
		]);
		const protocol = template.segments.at(-1);
		expect(protocol?.kind).toBe("static");
		expect(protocol?.kind === "static" ? protocol.text : "").toContain(
			"写作契约",
		);
		expect(protocol?.kind === "static" ? protocol.text : "").not.toContain(
			"<state_update>",
		);
	});

	it("朴素模式：Trace 只有四个片段，历史走原文，不写台账与笔记，不带工具", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const fake = createFakeClient(REPLY);
		const inputs = await naiveInputs(store, "s1");

		const result = await runChatTurn({
			store,
			client: fake.client,
			storyId: "s1",
			userText: "我推开山门。",
			template: inputs.template,
			providers: inputs.providers,
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			profile: "naive",
		});

		expect(result.trace.profile).toBe("naive");
		const entries = result.trace.context.entries;
		expect(entries.map((entry) => entry.segmentId)).toEqual([
			"character",
			"persona",
			"history",
			"protocol",
		]);
		expect(entries.map((entry) => entry.status)).toEqual([
			"included",
			"included",
			"included",
			"included",
		]);
		for (const entry of entries) {
			expect(entry.source).not.toMatch(
				/^(memory|summary|state|ledger|director|lore|scene)/,
			);
		}

		const request = fake.requests[0] as LlmRequest;
		expect(request.tools).toBeUndefined();
		expect(request.messages.map((message) => message.role)).toEqual([
			"system",
			"system",
			"assistant",
			"user",
			"system",
		]);
		expect(request.messages[1]?.content).toBe("你是云游的剑客。");
		expect(request.messages[2]?.content).toContain("<选项>");
		expect(request.messages[4]?.content).toContain("写作契约");

		expect(result.stateDiffs).toEqual([]);
		expect(store.getStateDiffs(result.node.id)).toEqual([]);
		expect(result.plotNotes).toEqual([]);
		expect(store.getOpenPlotNotes("s1")).toEqual([]);
		expect(result.trace.structured).toEqual({
			mode: "text-tags",
			acceptedStateUpdates: 0,
			acceptedNotes: 0,
			issues: [],
		});
		expect(store.countBackgroundJobs({ storyId: "s1" })).toEqual({
			pending: 0,
			running: 0,
			done: 0,
			failed: 0,
			discarded: 0,
		});

		const trace = store.getTurnTrace(result.node.id);
		expect(trace?.profile).toBe("naive");
	});

	it("两种档位共用同一条楼层写入路径，节点结构一致", async () => {
		const { store } = openTempStore();
		seedStory(store, "naive-story");
		seedStory(store, "native-story");
		const structure = async (profile: ChatProfile, storyId: string) => {
			const fake = createFakeClient("风停了。");
			const providers =
				profile === "naive"
					? (
							await createNaiveChatSlots({
								store,
								characterPrompt: "你扮演山神。",
								persona: null,
							})
						).providers
					: {
							character: createStaticSlotProvider(
								[{ role: "system", content: "你扮演山神。" }],
								"card:山神",
							),
							history: createHistorySlotProvider(store, { limit: 10 }),
						};
			const result = await runChatTurn({
				store,
				client: fake.client,
				storyId,
				userText: "我抬头。",
				template:
					profile === "naive"
						? createNaiveContextTemplate()
						: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
				providers,
				budgetTokens: 4_000,
				structuredOutput: "text-tags",
				profile,
			});
			expect(result.trace.profile).toBe(profile);
			const path = store.getPathToNode(result.node.id);
			return {
				shapes: path.map((node) => [
					node.role,
					node.parentId === null ? null : "parent",
					node.raw,
				]),
				head: store.getHead(storyId)?.id === result.node.id,
			};
		};

		const naive = await structure("naive", "naive-story");
		const native = await structure("native", "native-story");
		expect(native).toEqual(naive);
		expect(naive.head).toBe(true);
	});

	it("朴素模式没有 persona 时 persona 槽位记为缺失", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const fake = createFakeClient("风停了。");
		const result = await runChatTurn({
			store,
			client: fake.client,
			storyId: "s1",
			userText: "我抬头。",
			template: createNaiveContextTemplate(),
			providers: (
				await createNaiveChatSlots({
					store,
					characterPrompt: "你扮演山神。",
					persona: null,
				})
			).providers,
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			profile: "naive",
		});
		expect(
			result.trace.context.entries.map((entry) => [
				entry.segmentId,
				entry.status,
			]),
		).toEqual([
			["character", "included"],
			["persona", "missing-slot"],
			["history", "included"],
			["protocol", "included"],
		]);
	});

	it("朴素模式的楼层不进结算窗口，也不建后台任务", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "档位测试" });
		const fake = createFakeClient("风停了。");
		const naive = await runChatTurn({
			store,
			client: fake.client,
			storyId: "s1",
			userText: "我抬头。",
			template: createNaiveContextTemplate(),
			providers: (
				await createNaiveChatSlots({
					store,
					characterPrompt: "你扮演山神。",
					persona: null,
				})
			).providers,
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			profile: "naive",
		});
		expect(store.listUnsettledSettledAssistantNodes("s1", 4)).toEqual([]);
		expect(
			store.enqueueMissingBackgroundJobs({
				storyId: "s1",
				kinds: [SETTLE_JOB_KIND],
				conditions: { [SETTLE_JOB_KIND]: "settled" },
			}),
		).toEqual([]);

		const nativeFake = createFakeClient("风又起了。");
		const native = await runChatTurn({
			store,
			client: nativeFake.client,
			storyId: "s1",
			userText: "我站起来。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: (
				await createStandardChatSlots({
					store,
					characterPrompt: "你扮演山神。",
				})
			).providers,
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			profile: "native",
		});
		expect(store.listUnsettledSettledAssistantNodes("s1", 4)).toEqual([
			native.node.id,
		]);
		expect(
			store
				.enqueueMissingBackgroundJobs({
					storyId: "s1",
					kinds: [SETTLE_JOB_KIND],
					conditions: { [SETTLE_JOB_KIND]: "settled" },
				})
				.map((job) => job.nodeId),
		).toEqual([native.node.id]);
		expect(naive.node.id).not.toBe(native.node.id);
	});

	it("原生档位仍然写台账，Trace 记录 native", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const fake = createFakeClient(REPLY);
		const result = await runChatTurn({
			store,
			client: fake.client,
			storyId: "s1",
			userText: "我推开山门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: (
				await createStandardChatSlots({
					store,
					characterPrompt: "你扮演山神。",
				})
			).providers,
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			profile: "native",
		});
		expect(result.trace.profile).toBe("native");
		expect(result.stateDiffs).toHaveLength(1);
		expect(store.getOpenPlotNotes("s1")).toHaveLength(1);
		expect(result.trace.structured.acceptedStateUpdates).toBe(1);
	});
});
