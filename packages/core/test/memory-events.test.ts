import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	createBackgroundJobRegistry,
	createEventExtractionHandler,
	drainBackgroundJobs,
	enqueueMissingJobs,
	parseEventExtraction,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

function append(
	store: StoryStore,
	id: string,
	parentId: string | null,
	role: "system" | "user" | "assistant",
): void {
	store.appendNode({
		id,
		storyId: "s1",
		parentId,
		role,
		raw: `[[${id}]]`,
	});
}

function fakeResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: {
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cachedTokens: null,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

function scriptedClient(text: string): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	return {
		requests,
		client: {
			async complete(request) {
				requests.push(request);
				return fakeResult(text);
			},
		},
	};
}

function jobOf(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): BackgroundJob {
	const job = store
		.listBackgroundJobs({ storyId, kinds: ["events"] })
		.find((candidate) => candidate.nodeId === nodeId);
	if (!job) throw new Error(`没有找到楼层 ${nodeId} 的事件任务`);
	return store.startBackgroundJob(job.id);
}

describe("事件解析", () => {
	it("解析合法事件，可选字段缺省为 null，容忍代码块包裹", () => {
		const events = parseEventExtraction(
			[
				"```json",
				JSON.stringify([
					{
						text: " 云裳击败守卫 ",
						participants: [" 云裳 ", "守卫"],
						knowers: ["*"],
						importance: 0.8,
						storyTime: "第三日",
						location: "山门",
					},
					{ text: "城门关闭", participants: [], knowers: [], importance: 0 },
				]),
				"```",
			].join("\n"),
		);
		expect(events).toEqual([
			{
				text: "云裳击败守卫",
				participants: ["云裳", "守卫"],
				knowers: ["*"],
				importance: 0.8,
				storyTime: "第三日",
				location: "山门",
			},
			{
				text: "城门关闭",
				participants: [],
				knowers: [],
				importance: 0,
				storyTime: null,
				location: null,
			},
		]);
	});

	it("拒绝非法结构与越界值", () => {
		expect(() => parseEventExtraction("不是 JSON")).toThrow("不是合法 JSON");
		expect(() => parseEventExtraction('{"text":"x"}')).toThrow(
			"必须是 JSON 数组",
		);
		expect(() => parseEventExtraction('[{"text":"x"}]')).toThrow(
			"participants 必须是字符串数组",
		);
		expect(() =>
			parseEventExtraction(
				'[{"text":"x","participants":[],"knowers":[],"importance":1.1}]',
			),
		).toThrow("importance 必须在 0 到 1 之间");
		expect(() =>
			parseEventExtraction(
				'[{"text":"x","participants":[""],"knowers":[],"importance":0.5}]',
			),
		).toThrow("不能是空字符串");
		expect(() =>
			parseEventExtraction(
				'[{"text":"x","participants":[],"knowers":[],"importance":0.5,"extra":1}]',
			),
		).toThrow("未知字段 extra");
		expect(() =>
			parseEventExtraction(
				'[{"text":"","participants":[],"knowers":[],"importance":0.5}]',
			),
		).toThrow("text 不能是空字符串");
	});
});

describe("事件存储", () => {
	it("按路径顺序返回事件，分页与 limit 生效", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant");
		append(store, "n2", "n1", "user");
		append(store, "n3", "n2", "assistant");
		store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "n1",
				ordinal: 0,
				text: "甲",
				participants: ["A"],
				knowers: [],
				importance: 0.2,
			},
			{
				storyId: "s1",
				sourceNodeId: "n1",
				ordinal: 1,
				text: "乙",
				participants: ["B"],
				knowers: ["*"],
				importance: 0.6,
			},
			{
				storyId: "s1",
				sourceNodeId: "n3",
				ordinal: 0,
				text: "丙",
				participants: ["C"],
				knowers: ["C"],
				importance: 0.9,
			},
		]);

		expect(store.getEventsForPath("n3").map((event) => event.text)).toEqual([
			"甲",
			"乙",
			"丙",
		]);
		expect(
			store
				.getEventsForPath("n3", { limit: 2, offset: 1 })
				.map((event) => event.text),
		).toEqual(["乙", "丙"]);
		expect(store.getEventsForPath("n3", { limit: 1 })[0]?.text).toBe("甲");
		expect(store.getEventsForPath("n2").map((event) => event.text)).toEqual([
			"甲",
			"乙",
		]);
		expect(() => store.getEventsForPath("n3", { limit: 0 })).toThrow(
			"事件条数",
		);
		expect(() => store.getEventsForPath("n3", { offset: -1 })).toThrow(
			"偏移量",
		);
		expect(() => store.getEventsForPath("missing")).toThrow("楼层节点不存在");
	});

	it("只看当前分支：兄弟楼层的事件不进入路径结果", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant");
		append(store, "n2", "n1", "user");
		append(store, "n2b", "n1", "user");
		append(store, "n3", "n2", "assistant");
		store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "n1",
				ordinal: 0,
				text: "公共",
				participants: [],
				knowers: [],
				importance: 0.1,
			},
			{
				storyId: "s1",
				sourceNodeId: "n2b",
				ordinal: 0,
				text: "另一条分支",
				participants: [],
				knowers: [],
				importance: 0.1,
			},
		]);

		expect(store.getEventsForPath("n3").map((event) => event.text)).toEqual([
			"公共",
		]);
		expect(store.getEventsForPath("n2b").map((event) => event.text)).toEqual([
			"公共",
			"另一条分支",
		]);
	});

	it("一条非法时整批不写入，触发器拒绝修改与删除", () => {
		const { store, path } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant");

		expect(() =>
			store.insertMemoryEvents([
				{
					storyId: "s1",
					sourceNodeId: "n1",
					ordinal: 0,
					text: "合法",
					participants: [],
					knowers: [],
					importance: 0.5,
				},
				{
					storyId: "s1",
					sourceNodeId: "n1",
					ordinal: 1,
					text: "非法",
					participants: [],
					knowers: [],
					importance: 1.5,
				},
			]),
		).toThrow("importance 必须在 0 到 1 之间");
		expect(store.countEventsForNode("n1")).toBe(0);

		store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "n1",
				ordinal: 0,
				text: "合法",
				participants: [],
				knowers: [],
				importance: 0.5,
			},
		]);
		const raw = new Database(path);
		try {
			expect(() =>
				raw.prepare("UPDATE memory_events SET text = '改'").run(),
			).toThrow("事件记忆不可修改");
			expect(() => raw.prepare("DELETE FROM memory_events").run()).toThrow(
				"事件记忆不可删除",
			);
		} finally {
			raw.close();
		}
	});
});

describe("事件抽取任务", () => {
	it("合法事件全部写入，重跑不重复、不再调用模型", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n-a", null, "assistant");
		append(store, "n-b", "n-a", "user");
		const { client, requests } = scriptedClient(
			JSON.stringify([
				{
					text: "云裳拿到钥匙",
					participants: ["云裳"],
					knowers: ["云裳"],
					importance: 0.7,
					location: "藏经阁",
				},
				{
					text: "守卫开始巡逻",
					participants: ["守卫"],
					knowers: [],
					importance: 0.3,
				},
				{
					text: "山门关闭",
					participants: [],
					knowers: ["*"],
					importance: 0.5,
					storyTime: "黄昏",
				},
			]),
		);
		enqueueMissingJobs({ store, storyId: "s1", kinds: ["events"] });
		const job = jobOf(store, "s1", "n-a");
		const handler = createEventExtractionHandler();

		await handler({ store, client, job });
		await handler({ store, client, job });

		expect(requests).toHaveLength(1);
		const events = store.getEventsForPath("n-a");
		expect(
			events.map((event) => [
				event.ordinal,
				event.text,
				event.participants,
				event.knowers,
				event.importance,
				event.storyTime,
				event.location,
			]),
		).toEqual([
			[0, "云裳拿到钥匙", ["云裳"], ["云裳"], 0.7, null, "藏经阁"],
			[1, "守卫开始巡逻", ["守卫"], [], 0.3, null, null],
			[2, "山门关闭", [], ["*"], 0.5, "黄昏", null],
		]);
	});

	it("包含非法事件时整批不写入，任务记失败并保留原因", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n-a", null, "assistant");
		append(store, "n-b", "n-a", "user");
		const { client } = scriptedClient(
			JSON.stringify([
				{
					text: "合法",
					participants: [],
					knowers: [],
					importance: 0.5,
				},
				{
					text: "非法",
					participants: [""],
					knowers: [],
					importance: 0.5,
				},
			]),
		);
		const result = await drainBackgroundJobs({
			store,
			registry: createBackgroundJobRegistry({
				events: createEventExtractionHandler(),
			}),
			client,
			storyId: "s1",
			maxAttempts: 1,
			now: () => FIXED_NOW,
		});

		expect(result.runs).toHaveLength(1);
		expect(result.runs[0]?.status).toBe("failed");
		expect(result.runs[0]?.error).toContain("participants[0] 不能是空字符串");
		expect(store.countEventsForNode("n-a")).toBe(0);
	});

	it("窗口取任务楼层及其前面最多 8 楼", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		let parent: string | null = null;
		for (let index = 0; index <= 11; index += 1) {
			const id = `n${index}`;
			append(store, id, parent, index % 2 === 0 ? "assistant" : "user");
			parent = id;
		}
		const { client, requests } = scriptedClient("[]");
		enqueueMissingJobs({ store, storyId: "s1", kinds: ["events"] });
		const job = jobOf(store, "s1", "n10");

		await createEventExtractionHandler()({ store, client, job });

		const userMessage = requests[0]?.messages.find(
			(message) => message.role === "user",
		);
		if (!userMessage) throw new Error("抽取请求里没有 user 消息");
		expect(userMessage.content).toContain("[[n2]]");
		expect(userMessage.content).toContain("[[n10]]");
		expect(userMessage.content).not.toContain("[[n1]]");
		expect(userMessage.content).not.toContain("[[n0]]");
	});
});
