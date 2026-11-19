import { describe, expect, it } from "vitest";
import {
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type StoryStore,
	createDefaultContextTemplate,
	createEventStream,
	createHistorySlotProvider,
	createStateSlotProvider,
	createStaticSlotProvider,
	formatWritingDials,
	readContextBreakdown,
	readWritingView,
	runChatTurn,
	saveRecommendedWriting,
	saveWritingPreset,
	writeWritingOverrides,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const USAGE = {
	promptTokens: 5,
	completionTokens: 5,
	totalTokens: 10,
	reasoningTokens: 0,
	cachedTokens: 0,
};

function createFakeClient(): {
	client: LlmStreamingClient;
	requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const result: LlmResult = {
		text: "风从山口灌进来。",
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
		continuation: { text: "风从山口灌进来。", reasoning: "" },
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

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
	store.appendNode({
		id: "n-greeting",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "你好，旅人。",
	});
}

function providers(store: StoryStore) {
	return {
		character: createStaticSlotProvider(
			[{ role: "system", content: "你扮演山神。" }],
			"card:山神",
		),
		history: createHistorySlotProvider(store, { limit: 10 }),
		state: createStateSlotProvider(store),
	};
}

async function nextTurn(
	store: StoryStore,
	client: LlmStreamingClient,
	requests: LlmRequest[],
	userText: string,
): Promise<string> {
	await runChatTurn({
		store,
		client,
		storyId: "s1",
		userText,
		template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
		providers: providers(store),
		budgetTokens: 4_000,
		structuredOutput: "text-tags",
		model: "fake",
	});
	const request = requests.at(-1);
	if (request === undefined) throw new Error("没有发出请求");
	const writing = request.messages.find(
		(message) =>
			message.role === "system" &&
			typeof message.content === "string" &&
			message.content.startsWith("【写作要求】"),
	);
	return typeof writing?.content === "string" ? writing.content : "";
}

describe("写作选项进入下一楼的上下文", () => {
	it("改了选项，下一楼的写作要求随之改变，已经发出的请求不变", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient();

		const first = await nextTurn(store, client, requests, "我推开山门。");
		expect(first).toContain("不要替玩家角色说话");
		expect(first).not.toContain("人称：");
		expect(first).not.toContain("长度：");

		writeWritingOverrides(store, "s1", {
			person: "first",
			length: "short",
			pace: "fast",
		});

		const second = await nextTurn(store, client, requests, "我走进山门。");
		expect(second).toContain("人称：用第一人称");
		expect(second).toContain("长度：这一楼写短");
		expect(second).toContain("节奏：快");
		expect(first).not.toContain("人称：用第一人称");
	});
});

describe("文风包可以整体开关", () => {
	const PACK = "街灯亮着，雨点敲在铁皮棚上。";

	function seedPreset(store: StoryStore): void {
		saveWritingPreset(
			store,
			"s1",
			{
				name: "清风预设",
				total: 3,
				mapped: 1,
				packCount: 2,
				packText: PACK,
			},
			{ person: "third" },
		);
	}

	it("开着时文风包进入上下文，关掉后只剩选项", () => {
		const { store } = openTempStore();
		seedStory(store);
		seedPreset(store);

		const on = formatWritingDials(store, "s1");
		expect(on).toContain(PACK);
		expect(on).toContain("人称：用第三人称");

		writeWritingOverrides(store, "s1", { stylePack: false });
		const off = formatWritingDials(store, "s1");
		expect(off).not.toContain(PACK);
		expect(off).toContain("人称：用第三人称");

		writeWritingOverrides(store, "s1", { stylePack: true });
		expect(formatWritingDials(store, "s1")).toContain(PACK);
	});

	it("关掉文风包不丢掉导入结果", () => {
		const { store } = openTempStore();
		seedStory(store);
		seedPreset(store);
		writeWritingOverrides(store, "s1", { stylePack: false });

		const view = readWritingView(store, "s1");
		expect(view.dials.stylePack).toBe(false);
		expect(view.preset).toEqual({
			name: "清风预设",
			total: 3,
			mapped: 1,
			packCount: 2,
		});
	});
});

describe("卡的推荐与玩家的调整", () => {
	it("玩家的调整叠在推荐之上，清掉调整后回到推荐", () => {
		const { store } = openTempStore();
		seedStory(store);
		saveRecommendedWriting(store, "s1", { person: "third", actForMe: true });

		expect(readWritingView(store, "s1").dials).toMatchObject({
			person: "third",
			actForMe: true,
		});

		const adjusted = writeWritingOverrides(store, "s1", { person: "first" });
		expect(adjusted.dials.person).toBe("first");
		expect(adjusted.dials.actForMe).toBe(true);
		expect(adjusted.recommended).toEqual({ person: "third", actForMe: true });
		expect(adjusted.overrides).toEqual({ person: "first" });

		const restored = writeWritingOverrides(store, "s1", null);
		expect(restored.dials.person).toBe("third");
		expect(restored.overrides).toEqual({});
	});

	it("来历不明的选项值被丢掉", () => {
		const { store } = openTempStore();
		seedStory(store);
		const view = writeWritingOverrides(store, "s1", {
			person: "谁",
			length: "long",
			stylePack: "也许是",
		});
		expect(view.overrides).toEqual({ length: "long" });
	});
});

describe("思考档位进入写作要求", () => {
	it("默认不产生文字，选不想与多想各有一句要求", () => {
		const { store } = openTempStore();
		seedStory(store);
		expect(formatWritingDials(store, "s1")).not.toContain("思考：");

		writeWritingOverrides(store, "s1", { thinking: "off" });
		expect(formatWritingDials(store, "s1")).toContain("不用在正文前推理");

		writeWritingOverrides(store, "s1", { thinking: "high" });
		const high = formatWritingDials(store, "s1") ?? "";
		expect(high).toContain("动笔前多想一步");
		expect(high).not.toContain("不用在正文前推理");
	});
});

describe("写作要求记进上下文构成", () => {
	it("追加的写作要求带类别、token 与来源", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient();
		const result = await runChatTurn({
			store,
			client,
			storyId: "s1",
			userText: "我推开山门。",
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: providers(store),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			model: "fake",
		});

		const breakdown = readContextBreakdown(store, result.node.id);
		if (breakdown === null) throw new Error("缺少上下文构成");
		const other = breakdown.categories.find((item) => item.id === "other");
		const writing = other?.items.find(
			(item) =>
				item.source.kind === "segment" &&
				item.source.segmentId === "writing:写作选项",
		);
		expect(writing?.label).toBe("writing:写作选项");
		expect(writing?.tokens).toBeGreaterThan(0);
		expect(other?.tokens).toBeGreaterThan(0);
		expect(
			breakdown.categories.reduce((sum, item) => sum + item.tokens, 0),
		).toBe(breakdown.totalTokens);
	});
});
