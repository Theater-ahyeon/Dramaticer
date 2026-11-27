import { describe, expect, it } from "vitest";
import {
	type LlmMessage,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type WritingEntry,
	applyWritingEntries,
	assertWritingEntries,
	createDefaultContextTemplate,
	createEventStream,
	createHistorySlotProvider,
	createStateSlotProvider,
	createStaticSlotProvider,
	formatWritingDials,
	readWritingView,
	runChatTurn,
	saveWritingPreset,
	writeWritingEntries,
	writeWritingOverrides,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function entry(patch: Partial<WritingEntry> & { id: string }): WritingEntry {
	return {
		name: patch.id,
		content: `内容-${patch.id}`,
		role: "system",
		placement: "after-history",
		depth: 0,
		order: 0,
		enabled: true,
		scope: "turn",
		...patch,
	};
}

const BASE: readonly LlmMessage[] = [
	{ role: "system", content: "设定" },
	{ role: "assistant", content: "楼1" },
	{ role: "user", content: "楼2" },
	{ role: "assistant", content: "楼3" },
	{ role: "user", content: "楼4" },
];

function contents(messages: readonly LlmMessage[]): string[] {
	return messages.map((message) => message.content);
}

describe("写作条目的放置", () => {
	it("历史之前、历史之后与历史中的深度各就各位，原有消息顺序不变", () => {
		const { messages, trace } = applyWritingEntries(BASE, [
			entry({ id: "前", placement: "before-history" }),
			entry({ id: "后", placement: "after-history" }),
			entry({ id: "深1", placement: "in-history", depth: 1, role: "user" }),
			entry({ id: "深3", placement: "in-history", depth: 3 }),
		]);
		expect(contents(messages)).toEqual([
			"设定",
			"内容-前",
			"楼1",
			"内容-深3",
			"楼2",
			"楼3",
			"内容-深1",
			"楼4",
			"内容-后",
		]);
		expect(messages[6]?.role).toBe("user");
		expect(trace.map((item) => item.source)).toContain(
			"writing:条目 深1（历史中·深度 1）",
		);
	});

	it("深度超过历史长度时放在历史最前；同一位置按 order 排", () => {
		const { messages } = applyWritingEntries(BASE, [
			entry({ id: "b", placement: "in-history", depth: 99, order: 2 }),
			entry({ id: "a", placement: "in-history", depth: 99, order: 1 }),
		]);
		expect(contents(messages).slice(0, 4)).toEqual([
			"设定",
			"内容-a",
			"内容-b",
			"楼1",
		]);
	});

	it("停用的条目不放进上下文", () => {
		const { messages, trace } = applyWritingEntries(BASE, [
			entry({ id: "关", enabled: false }),
		]);
		expect(contents(messages)).toEqual(contents(BASE));
		expect(trace).toEqual([]);
	});

	it("画面整理条目不会混进正文回合", () => {
		const { messages, trace } = applyWritingEntries(BASE, [
			entry({ id: "正文" }),
			entry({ id: "整理", scope: "image_organizer" }),
		]);
		expect(contents(messages)).toEqual([...contents(BASE), "内容-正文"]);
		expect(trace.map((item) => item.source)).toEqual([
			"writing:条目 正文（历史之后）",
		]);
	});

	it("校验拒绝重复 id、未知位置与越界深度", () => {
		expect(() =>
			assertWritingEntries([entry({ id: "x" }), entry({ id: "x" })]),
		).toThrow("重复");
		expect(() =>
			assertWritingEntries([{ ...entry({ id: "x" }), placement: "top" }]),
		).toThrow("placement");
		expect(() =>
			assertWritingEntries([
				entry({ id: "x", placement: "in-history", depth: -1 }),
			]),
		).toThrow("depth");
	});
});

function fakeClient(): { client: LlmStreamingClient; requests: LlmRequest[] } {
	const requests: LlmRequest[] = [];
	const result: LlmResult = {
		text: "雪落下来。",
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: {
			promptTokens: 5,
			completionTokens: 5,
			totalTokens: 10,
			reasoningTokens: 0,
			cachedTokens: 0,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: { text: "雪落下来。", reasoning: "" },
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
					emit({ type: "text_delta", delta: result.text });
					return result;
				});
			},
		},
	};
}

describe("写作条目进入回合", () => {
	it("条目按位置进入请求；有条目时不再拼文风包；关掉开关后都不进", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试故事" });
		store.appendNode({
			id: "n-greeting",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "你好，旅人。",
		});
		saveWritingPreset(
			store,
			"s1",
			{ name: "预设", total: 1, mapped: 0, packCount: 1, packText: "旧文风包" },
			{},
		);
		writeWritingEntries(store, "s1", [
			entry({
				id: "深",
				placement: "in-history",
				depth: 1,
				content: "深处的提醒",
			}),
		]);
		expect(readWritingView(store, "s1").entries).toHaveLength(1);
		expect(formatWritingDials(store, "s1") ?? "").not.toContain("旧文风包");
		const { client, requests } = fakeClient();
		const turn = async (text: string) => {
			await runChatTurn({
				store,
				client,
				storyId: "s1",
				userText: text,
				template: createDefaultContextTemplate({
					structuredOutput: "text-tags",
				}),
				providers: {
					character: createStaticSlotProvider(
						[{ role: "system", content: "你扮演山神。" }],
						"card:山神",
					),
					history: createHistorySlotProvider(store, { limit: 10 }),
					state: createStateSlotProvider(store),
				},
				budgetTokens: 4_000,
				structuredOutput: "text-tags",
				model: "fake",
			});
			return requests.at(-1)?.messages ?? [];
		};
		const first = await turn("我走进山门。");
		const index = first.findIndex(
			(message) => message.content === "深处的提醒",
		);
		expect(index).toBeGreaterThan(0);
		const last = first.findLastIndex((message) => message.role !== "system");
		expect(first[last]?.content).toContain("我走进山门。");
		expect(index).toBeLessThan(last);
		writeWritingOverrides(store, "s1", { stylePack: false });
		const second = await turn("我停下脚步。");
		expect(second.some((message) => message.content === "深处的提醒")).toBe(
			false,
		);
	});
});
