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
	parseEventBatchExtraction,
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

/** 每个助手楼层后面跟一个玩家楼层，保证助手楼层已确认。 */
function appendAssistantFloors(store: StoryStore, count: number): string[] {
	const ids: string[] = [];
	let parent: string | null = null;
	for (let index = 0; index < count; index += 1) {
		const assistantId = `a${index}`;
		append(store, assistantId, parent, "assistant");
		append(store, `u${index}`, assistantId, "user");
		parent = `u${index}`;
		ids.push(assistantId);
	}
	return ids;
}

/** 按请求里的窗口楼层返回结果，用来检查一次请求覆盖了哪些楼层。 */
function windowClient(): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	return {
		requests,
		client: {
			async complete(request) {
				requests.push(request);
				const content =
					request.messages.find((message) => message.role === "user")
						?.content ?? "";
				const start = content.lastIndexOf("<窗口>");
				const end = content.indexOf("</窗口>", start);
				if (start < 0 || end < 0) {
					throw new Error("抽取请求的窗口段不完整");
				}
				const body = content.slice(start, end);
				const ids = [
					...body.matchAll(/<楼层 id="([^"]+)" role="assistant">/g),
				].map((match) => match[1] ?? "");
				return fakeResult(
					JSON.stringify(
						ids.map((id) => ({
							nodeId: id,
							events: [
								{
									text: `事件 ${id}`,
									participants: [],
									knowers: [],
									importance: 0.5,
								},
							],
						})),
					),
				);
			},
		},
	};
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

	it("批量结果只接受窗口内楼层，重复或窗口外整批拒绝", () => {
		const batches = parseEventBatchExtraction(
			[
				"```json",
				JSON.stringify([
					{
						nodeId: "a0",
						events: [
							{
								text: "云裳拿到钥匙",
								participants: ["云裳"],
								knowers: ["云裳"],
								importance: 0.7,
							},
						],
					},
					{ nodeId: "a3", events: [] },
				]),
				"```",
			].join("\n"),
			["a0", "a3"],
		);
		expect(batches.map((batch) => batch.nodeId)).toEqual(["a0", "a3"]);
		expect(batches[0]?.events[0]?.text).toBe("云裳拿到钥匙");
		expect(batches[1]?.events).toEqual([]);

		expect(() =>
			parseEventBatchExtraction('[{"nodeId":"a9","events":[]}]', ["a0"]),
		).toThrow("不在本次窗口内");
		expect(() =>
			parseEventBatchExtraction(
				'[{"nodeId":"a0","events":[]},{"nodeId":"a0","events":[]}]',
				["a0"],
			),
		).toThrow("重复");
		expect(() =>
			parseEventBatchExtraction('[{"nodeId":"a0","event":[]}]', ["a0"]),
		).toThrow("未知字段 event");
		expect(() =>
			parseEventBatchExtraction(
				'[{"nodeId":"a0","events":[{"text":"x","participants":[],"knowers":[],"importance":2}]}]',
				["a0"],
			),
		).toThrow("importance 必须在 0 到 1 之间");
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

	it("抽取记录与事件一起标记已抽取楼层", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant");
		append(store, "n2", "n1", "user");
		append(store, "n3", "n2", "assistant");
		store.recordEventExtractions({
			storyId: "s1",
			nodeIds: ["n1"],
			events: [
				{
					storyId: "s1",
					sourceNodeId: "n1",
					ordinal: 0,
					text: "甲",
					participants: [],
					knowers: [],
					importance: 0.2,
				},
			],
		});
		store.recordEventExtractions({
			storyId: "s1",
			nodeIds: ["n3"],
			events: [],
		});

		expect(store.listExtractedEventNodeIds("s1").sort()).toEqual(["n1", "n3"]);
		expect(store.countEventsForNode("n3")).toBe(0);
		expect(() =>
			store.recordEventExtractions({
				storyId: "s1",
				nodeIds: ["n2"],
				events: [],
			}),
		).toThrow("只接受助手楼层");
		expect(() =>
			store.recordEventExtractions({
				storyId: "s1",
				nodeIds: ["missing"],
				events: [],
			}),
		).toThrow("不存在");
		expect(() =>
			store.recordEventExtractions({
				storyId: "s1",
				nodeIds: ["n3"],
				events: [
					{
						storyId: "s1",
						sourceNodeId: "n1",
						ordinal: 0,
						text: "乙",
						participants: [],
						knowers: [],
						importance: 0.2,
					},
				],
			}),
		).toThrow("不在本次窗口内");
	});
});

describe("事件抽取任务", () => {
	it("一次请求处理整段未抽取助手楼层，事件归属到正确楼层", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const floors = appendAssistantFloors(store, 8);
		const { client, requests } = scriptedClient(
			JSON.stringify([
				{
					nodeId: "a0",
					events: [
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
					],
				},
				{
					nodeId: "a5",
					events: [
						{
							text: "山门关闭",
							participants: [],
							knowers: ["*"],
							importance: 0.5,
							storyTime: "黄昏",
						},
					],
				},
			]),
		);
		enqueueMissingJobs({ store, storyId: "s1", kinds: ["events"] });
		const job = jobOf(store, "s1", "a0");
		const handler = createEventExtractionHandler();

		await handler({ store, client, job });

		expect(requests).toHaveLength(1);
		expect(
			store
				.getEventsForNode("a0")
				.map((event) => [event.ordinal, event.text, event.location]),
		).toEqual([
			[0, "云裳拿到钥匙", "藏经阁"],
			[1, "守卫开始巡逻", null],
		]);
		expect(
			store
				.getEventsForNode("a5")
				.map((event) => [event.text, event.storyTime]),
		).toEqual([["山门关闭", "黄昏"]]);
		expect(store.countEventsForNode("a3")).toBe(0);
		expect(store.listExtractedEventNodeIds("s1").sort()).toEqual(
			[...floors].sort(),
		);
	});

	it("整段楼层由后台 drain 一次请求处理", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		appendAssistantFloors(store, 8);
		const { client, requests } = scriptedClient(
			JSON.stringify([
				{
					nodeId: "a0",
					events: [
						{
							text: "云裳拿到钥匙",
							participants: ["云裳"],
							knowers: ["云裳"],
							importance: 0.7,
						},
					],
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

		expect(requests).toHaveLength(1);
		expect(result.runs.every((run) => run.status === "done")).toBe(true);
		expect(store.listExtractedEventNodeIds("s1")).toHaveLength(8);
	});

	it("包含非法事件时整窗不写入，任务记失败并保留原因", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		appendAssistantFloors(store, 8);
		const { client } = scriptedClient(
			JSON.stringify([
				{
					nodeId: "a0",
					events: [
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
					],
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
			limit: 1,
			maxAttempts: 1,
			now: () => FIXED_NOW,
		});

		expect(result.runs).toHaveLength(1);
		expect(result.runs[0]?.status).toBe("failed");
		expect(result.runs[0]?.error).toContain("participants[0] 不能是空字符串");
		expect(store.countEventsForNode("a0")).toBe(0);
		expect(store.listExtractedEventNodeIds("s1")).toEqual([]);
	});

	it("窗口取当前路径上最早的连续未抽取助手楼层", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "s0", null, "system");
		append(store, "a0", "s0", "assistant");
		append(store, "u0", "a0", "user");
		append(store, "a1", "u0", "assistant");
		append(store, "u1", "a1", "user");
		append(store, "a2", "u1", "assistant");
		append(store, "u2", "a2", "user");
		const { client, requests } = scriptedClient("[]");
		enqueueMissingJobs({ store, storyId: "s1", kinds: ["events"] });
		const job = jobOf(store, "s1", "a0");

		await createEventExtractionHandler()({ store, client, job });

		const userMessage = requests[0]?.messages.find(
			(message) => message.role === "user",
		);
		if (!userMessage) throw new Error("抽取请求里没有 user 消息");
		expect(userMessage.content).toContain('<上下文 位置="前">');
		expect(userMessage.content).not.toContain('id="s0"');
		expect(userMessage.content).toContain('<上下文 位置="后">');
		expect(userMessage.content).not.toContain('id="u2"');
		for (const id of ["a0", "a1", "a2"]) {
			expect(userMessage.content).toContain(`id="${id}"`);
		}
		for (const id of ["u0", "u1"]) {
			expect(userMessage.content).not.toContain(`id="${id}"`);
		}
	});

	it("一次最多处理 8 个楼层，剩余楼层留给下一次请求", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const floors = appendAssistantFloors(store, 10);
		const { client, requests } = windowClient();
		enqueueMissingJobs({ store, storyId: "s1", kinds: ["events"] });
		const handler = createEventExtractionHandler();

		await handler({ store, client, job: jobOf(store, "s1", "a0") });
		expect(requests).toHaveLength(1);
		const first = requests[0]?.messages.find(
			(message) => message.role === "user",
		);
		if (!first) throw new Error("抽取请求里没有 user 消息");
		const firstIds = [...first.content.matchAll(/id="(a\d+)"/g)].map(
			(match) => match[1],
		);
		expect(firstIds).toEqual(floors.slice(0, 8));

		await handler({ store, client, job: jobOf(store, "s1", "a8") });
		expect(requests).toHaveLength(2);
		const second = requests[1]?.messages.find(
			(message) => message.role === "user",
		);
		if (!second) throw new Error("第二次抽取请求里没有 user 消息");
		const secondIds = [...second.content.matchAll(/id="(a\d+)"/g)].map(
			(match) => match[1],
		);
		expect(secondIds).toEqual(floors.slice(8));
	});

	it("重跑不再调用模型，也不重复写入", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const floors = appendAssistantFloors(store, 8);
		const { client, requests } = windowClient();
		enqueueMissingJobs({ store, storyId: "s1", kinds: ["events"] });
		const handler = createEventExtractionHandler();

		await handler({ store, client, job: jobOf(store, "s1", "a0") });
		const before = store.getEventsForPath("u7");
		await handler({ store, client, job: jobOf(store, "s1", "a3") });

		expect(requests).toHaveLength(1);
		expect(store.getEventsForPath("u7")).toHaveLength(before.length);
		expect(store.getEventsForPath("u7")).toHaveLength(floors.length);
	});

	it("没有抽到事件的楼层同样记为已抽取", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const floors = appendAssistantFloors(store, 8);
		const { client, requests } = scriptedClient("[]");
		enqueueMissingJobs({ store, storyId: "s1", kinds: ["events"] });
		const handler = createEventExtractionHandler();

		await handler({ store, client, job: jobOf(store, "s1", "a0") });
		await handler({ store, client, job: jobOf(store, "s1", "a4") });

		expect(requests).toHaveLength(1);
		expect(store.listExtractedEventNodeIds("s1").sort()).toEqual(
			[...floors].sort(),
		);
	});

	it("只处理当前路径，其他分支的楼层不进入窗口", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "a0", null, "assistant");
		append(store, "u0", "a0", "user");
		append(store, "a1", "u0", "assistant");
		append(store, "u1", "a1", "user");
		append(store, "a1b", "u0", "assistant");
		append(store, "u1b", "a1b", "user");
		store.setHead("s1", "u1");
		const { client, requests } = windowClient();
		enqueueMissingJobs({ store, storyId: "s1", kinds: ["events"] });
		const handler = createEventExtractionHandler();

		await handler({ store, client, job: jobOf(store, "s1", "a1b") });

		expect(requests).toHaveLength(1);
		const message = requests[0]?.messages.find(
			(match) => match.role === "user",
		);
		if (!message) throw new Error("抽取请求里没有 user 消息");
		expect(message.content).toContain('id="a0"');
		expect(message.content).toContain('id="a1"');
		expect(message.content).not.toContain('id="a1b"');
		expect(store.listExtractedEventNodeIds("s1").sort()).toEqual(["a0", "a1"]);
	});
});
