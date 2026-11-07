import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	NPC_AGENDA_EVENT_SOURCE,
	type StoryStore,
	createNpcAgendaHandler,
	parseNpcAgendaProgress,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_TIME = "2026-11-07T12:00:00.000Z";

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

/** 建一条 a1,u1,a2,u2,... 交替的路径；每个助手楼层都有子节点，因此都是已确认楼层。 */
function buildFloors(store: StoryStore, count: number): void {
	let parent: string | null = null;
	for (let index = 1; index <= count; index += 1) {
		const assistant = `a${index}`;
		append(store, assistant, parent, "assistant");
		const user = `u${index}`;
		append(store, user, assistant, "user");
		parent = user;
	}
}

function seed(store: StoryStore, count: number): void {
	store.createStory({ id: "s1", title: "测试" });
	buildFloors(store, count);
}

function addEntity(
	store: StoryStore,
	id: string,
	name: string,
	aliases: readonly string[] = [],
): void {
	store.upsertEntity({
		id,
		storyId: "s1",
		kind: "character",
		name,
		source: "test",
		aliases,
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

function scriptedClient(texts: readonly string[]): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	return {
		requests,
		client: {
			async complete(request) {
				const text = texts[requests.length];
				if (text === undefined) {
					throw new Error(`模型调用次数超过脚本：第 ${requests.length + 1} 次`);
				}
				requests.push(request);
				return fakeResult(text);
			},
		},
	};
}

function jobAt(nodeId: string): BackgroundJob {
	return {
		id: 1,
		storyId: "s1",
		nodeId,
		kind: "npc_agenda",
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: FIXED_TIME,
		startedAt: FIXED_TIME,
		finishedAt: null,
	};
}

function userContent(request: LlmRequest | undefined): string {
	const message = request?.messages.find((item) => item.role === "user");
	if (!message) throw new Error("请求里没有 user 消息");
	return message.content;
}

describe("NPC 议程存储", () => {
	it("推进进度并写入与此同时事件，事件序号接在已有事件之后", () => {
		const { store } = openTempStore();
		seed(store, 2);
		addEntity(store, "e-yun", "云裳");
		store.upsertNpcAgendas([
			{ storyId: "s1", entityId: "e-yun", goal: "寻找剑冢", importance: 0.8 },
		]);
		store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "a2",
				ordinal: 0,
				text: "抽取事件",
				participants: [],
				knowers: [],
				importance: 0.2,
			},
		]);

		const created = store.advanceNpcAgendas({
			storyId: "s1",
			nodeId: "a2",
			advances: [{ entityId: "e-yun", progress: "暗中收买了守门人" }],
		});

		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({
			sourceNodeId: "a2",
			ordinal: 1,
			participants: ["云裳"],
			knowers: ["云裳"],
			importance: 0.8,
			text: "与此同时：暗中收买了守门人",
			source: NPC_AGENDA_EVENT_SOURCE,
		});
		const agenda = store.listNpcAgendas("s1")[0];
		expect(agenda?.progress).toBe("暗中收买了守门人");
		expect(agenda?.lastAdvancedNodeId).toBe("a2");
		expect(store.countEventsForNode("a2")).toBe(2);
		expect(store.countEventsForNode("a2", "events")).toBe(1);
		expect(store.countEventsForNode("a2", NPC_AGENDA_EVENT_SOURCE)).toBe(1);
	});

	it("一条非法时整批回滚，进度与事件都不写入", () => {
		const { store } = openTempStore();
		seed(store, 2);
		addEntity(store, "e-yun", "云裳");
		addEntity(store, "e-lan", "岚音");
		store.upsertNpcAgendas([
			{ storyId: "s1", entityId: "e-yun", goal: "寻找剑冢" },
			{ storyId: "s1", entityId: "e-lan", goal: "守住山门" },
		]);

		expect(() =>
			store.advanceNpcAgendas({
				storyId: "s1",
				nodeId: "a2",
				advances: [
					{ entityId: "e-yun", progress: "合法进度" },
					{ entityId: "e-lan", progress: "   " },
				],
			}),
		).toThrow("progress 必须是非空字符串");
		expect(store.listNpcAgendas("s1").map((agenda) => agenda.progress)).toEqual(
			["", ""],
		);
		expect(store.countEventsForNode("a2")).toBe(0);

		expect(() =>
			store.advanceNpcAgendas({
				storyId: "s1",
				nodeId: "a2",
				advances: [{ entityId: "missing", progress: "进度" }],
			}),
		).toThrow("找不到 NPC 议程");
		expect(store.countEventsForNode("a2")).toBe(0);
	});
});

describe("NPC 议程输出解析", () => {
	it("接受代码块包裹的数组，拒绝未知字段与重复名称", () => {
		expect(
			parseNpcAgendaProgress(
				'```json\n[{"npc":"云裳","progress":" 前往山门 "}]\n```',
			),
		).toEqual([{ npc: "云裳", progress: "前往山门" }]);
		expect(() =>
			parseNpcAgendaProgress('[{"npc":"云裳","progress":"a","mood":"静"}]'),
		).toThrow("包含未知字段 mood");
		expect(() =>
			parseNpcAgendaProgress(
				'[{"npc":"云裳","progress":"a"},{"npc":"云 裳","progress":"b"}]',
			),
		).toThrow("npc 重复");
		expect(() => parseNpcAgendaProgress('{"npc":"云裳"}')).toThrow(
			"必须是 JSON 数组",
		);
	});
});

describe("NPC 议程后台任务", () => {
	it("非章节边界不调用模型", async () => {
		const { store } = openTempStore();
		seed(store, 5);
		addEntity(store, "e-yun", "云裳");
		store.upsertNpcAgendas([
			{ storyId: "s1", entityId: "e-yun", goal: "寻找剑冢" },
		]);
		const scripted = scriptedClient([]);
		await createNpcAgendaHandler()({
			store,
			client: scripted.client,
			job: jobAt("a5"),
		});
		expect(scripted.requests).toHaveLength(0);
	});

	it("章节边界没有议程时不调用模型", async () => {
		const { store } = openTempStore();
		seed(store, 20);
		const scripted = scriptedClient([]);
		await createNpcAgendaHandler()({
			store,
			client: scripted.client,
			job: jobAt("a20"),
		});
		expect(scripted.requests).toHaveLength(0);
	});

	it("章节边界调用一次模型，按别名匹配名称并写入进度与事件", async () => {
		const { store } = openTempStore();
		seed(store, 20);
		addEntity(store, "e-yun", "云裳", ["小云"]);
		store.upsertNpcAgendas([
			{ storyId: "s1", entityId: "e-yun", goal: "寻找剑冢", importance: 0.7 },
		]);
		const scripted = scriptedClient([
			'[{"npc":"小云","progress":"暗中收买了守门人"}]',
		]);
		await createNpcAgendaHandler()({
			store,
			client: scripted.client,
			job: jobAt("a20"),
		});

		expect(scripted.requests).toHaveLength(1);
		const prompt = userContent(scripted.requests[0]);
		expect(prompt).toContain('<议程 名称="云裳" 目标="寻找剑冢">');
		expect(prompt).toContain("（尚未推进）");
		expect(prompt).toContain("[[a1]]");
		expect(prompt).toContain("[[a20]]");

		const agenda = store.listNpcAgendas("s1")[0];
		expect(agenda?.progress).toBe("暗中收买了守门人");
		expect(agenda?.lastAdvancedNodeId).toBe("a20");
		const events = store.getEventsForNode("a20");
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			text: "与此同时：暗中收买了守门人",
			participants: ["云裳"],
			knowers: ["云裳"],
			importance: 0.7,
			source: NPC_AGENDA_EVENT_SOURCE,
		});
	});

	it("有章节摘要时用摘要，没有时用上一章节终点之后的楼层原文", async () => {
		const { store } = openTempStore();
		seed(store, 40);
		addEntity(store, "e-yun", "云裳");
		store.upsertNpcAgendas([
			{ storyId: "s1", entityId: "e-yun", goal: "寻找剑冢" },
		]);
		store.insertSummary({
			storyId: "s1",
			level: "chapter",
			startNodeId: "a1",
			endNodeId: "a20",
			text: "第一章摘要",
		});

		const first = scriptedClient(['[{"npc":"云裳","progress":"进入山门"}]']);
		await createNpcAgendaHandler()({
			store,
			client: first.client,
			job: jobAt("a20"),
		});
		expect(userContent(first.requests[0])).toContain("第一章摘要");
		expect(userContent(first.requests[0])).not.toContain("[[a1]]");

		const second = scriptedClient(['[{"npc":"云裳","progress":"打开密室"}]']);
		await createNpcAgendaHandler()({
			store,
			client: second.client,
			job: jobAt("a40"),
		});
		const prompt = userContent(second.requests[0]);
		expect(prompt).toContain("[[a21]]");
		expect(prompt).toContain("[[a40]]");
		expect(prompt).not.toContain("[[a1]]");
		expect(prompt).toContain("进入山门");
	});

	it("缺项、陌生名称、空进度与重复名称整批不写入", async () => {
		const cases: readonly {
			readonly output: string;
			readonly error: string;
		}[] = [
			{ output: "[]", error: "缺少议程" },
			{
				output: '[{"npc":"陌生人","progress":"行动"}]',
				error: "找不到议程",
			},
			{
				output: '[{"npc":"云裳","progress":"   "}]',
				error: "不能是空字符串",
			},
			{
				output:
					'[{"npc":"云裳","progress":"甲"},{"npc":"云 裳","progress":"乙"}]',
				error: "npc 重复",
			},
		];
		for (const item of cases) {
			const { store } = openTempStore();
			seed(store, 20);
			addEntity(store, "e-yun", "云裳");
			store.upsertNpcAgendas([
				{ storyId: "s1", entityId: "e-yun", goal: "寻找剑冢" },
			]);
			const scripted = scriptedClient([item.output]);
			await expect(
				createNpcAgendaHandler()({
					store,
					client: scripted.client,
					job: jobAt("a20"),
				}),
			).rejects.toThrow(item.error);
			expect(store.listNpcAgendas("s1")[0]?.progress).toBe("");
			expect(store.countEventsForNode("a20")).toBe(0);
		}
	});

	it("同一楼层重复执行不再调用模型，也不重复写事件", async () => {
		const { store } = openTempStore();
		seed(store, 20);
		addEntity(store, "e-yun", "云裳");
		store.upsertNpcAgendas([
			{ storyId: "s1", entityId: "e-yun", goal: "寻找剑冢" },
		]);
		const scripted = scriptedClient(['[{"npc":"云裳","progress":"第一次"}]']);
		await createNpcAgendaHandler()({
			store,
			client: scripted.client,
			job: jobAt("a20"),
		});
		await createNpcAgendaHandler()({
			store,
			client: scripted.client,
			job: jobAt("a20"),
		});
		expect(scripted.requests).toHaveLength(1);
		expect(store.countEventsForNode("a20")).toBe(1);
		expect(store.listNpcAgendas("s1")[0]?.progress).toBe("第一次");
	});

	it("everyChapters 为 2 时只在偶数章节边界推进", async () => {
		const { store } = openTempStore();
		seed(store, 40);
		addEntity(store, "e-yun", "云裳");
		addEntity(store, "e-lan", "岚音");
		store.upsertNpcAgendas([
			{
				storyId: "s1",
				entityId: "e-yun",
				goal: "寻找剑冢",
				everyChapters: 1,
			},
			{
				storyId: "s1",
				entityId: "e-lan",
				goal: "守住山门",
				everyChapters: 2,
			},
		]);

		const first = scriptedClient(['[{"npc":"云裳","progress":"第一章"}]']);
		await createNpcAgendaHandler()({
			store,
			client: first.client,
			job: jobAt("a20"),
		});
		const firstPrompt = userContent(first.requests[0]);
		expect(firstPrompt).toContain('名称="云裳"');
		expect(firstPrompt).not.toContain('名称="岚音"');
		expect(
			store.listNpcAgendas("s1").find((item) => item.entityId === "e-lan")
				?.progress,
		).toBe("");

		const second = scriptedClient([
			'[{"npc":"云裳","progress":"第二章"},{"npc":"岚音","progress":"第二章"}]',
		]);
		await createNpcAgendaHandler()({
			store,
			client: second.client,
			job: jobAt("a40"),
		});
		const secondPrompt = userContent(second.requests[0]);
		expect(secondPrompt).toContain('名称="云裳"');
		expect(secondPrompt).toContain('名称="岚音"');
		const agendas = store.listNpcAgendas("s1");
		expect(
			agendas.find((item) => item.entityId === "e-lan")?.lastAdvancedNodeId,
		).toBe("a40");
		expect(agendas.find((item) => item.entityId === "e-yun")?.progress).toBe(
			"第二章",
		);
	});

	it("章节窗口参数非法时在创建处理器时抛错", () => {
		expect(() => createNpcAgendaHandler({ chapterSize: 1 })).toThrow(
			"章节窗口必须是不小于 2 的整数",
		);
	});
});
