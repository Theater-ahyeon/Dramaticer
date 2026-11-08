import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	type BackgroundDrainResult,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	OPENING_JOB_KIND,
	type StoryStore,
	createBackgroundJobRegistry,
	createDefaultContextTemplate,
	createOpeningHandler,
	drainBackgroundJobs,
	openingPackNeedsRun,
	parseOpeningPackResponse,
	readOpeningPack,
	validateOpeningPackPayload,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

function llmResult(text: string): LlmResult {
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

function createFakeClient(replies: readonly string[]): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const client: LlmClient = {
		async complete(request) {
			requests.push(request);
			const reply = replies[requests.length - 1];
			if (reply === undefined) {
				throw new Error("假客户端没有更多回复");
			}
			return llmResult(reply);
		},
	};
	return { client, requests };
}

function packJson(label: string): string {
	return JSON.stringify({
		place: `教室（${label}）`,
		time: "清晨",
		participants: [{ name: "凛", wants: "确认你的来意" }],
		conflict: "凛堵在门口，不让你进教室",
		directions: ["直接说明来意", "假装走错教室", "转身就走"],
	});
}

const registry = createBackgroundJobRegistry({
	[OPENING_JOB_KIND]: {
		handler: createOpeningHandler(),
		enqueue: "story",
		needsRun: openingPackNeedsRun,
	},
});

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "开局" });
	store.updateStorySettings("s1", {
		cardName: "凛",
		characterPrompt: "凛是图书委员，性格冷淡。",
	});
	store.upsertEntity({
		storyId: "s1",
		kind: "character",
		name: "凛",
		description: "图书委员",
		source: "test",
	});
	store.insertLoreEntries([
		{
			storyId: "s1",
			name: "常驻设定",
			content: "学校在冬天仍然开放。",
			constant: true,
			source: "test-lore",
		},
	]);
}

async function drain(
	store: StoryStore,
	client: LlmClient,
	maxAttempts?: number,
): Promise<BackgroundDrainResult> {
	return drainBackgroundJobs({
		store,
		registry,
		client,
		storyId: "s1",
		kinds: [OPENING_JOB_KIND],
		now: () => FIXED_NOW,
		maxAttempts,
	});
}

describe("开局包校验", () => {
	const known = {
		names: new Set(["凛"]),
		sourceText: "凛是图书委员，性格冷淡。",
	};

	it("接受完整开局包", () => {
		const payload = parseOpeningPackResponse(packJson("第一版"), known);
		expect(payload.place).toBe("教室（第一版）");
		expect(payload.participants).toEqual([
			{ name: "凛", wants: "确认你的来意" },
		]);
		expect(payload.directions).toHaveLength(3);
	});

	it("缺字段、未知人物与未知字段都整包拒绝", () => {
		expect(() =>
			parseOpeningPackResponse(
				'{"place":"教室","time":"清晨","conflict":"有人堵门"}',
				known,
			),
		).toThrow("participants");
		expect(() =>
			validateOpeningPackPayload(
				{
					place: "教室",
					time: "清晨",
					participants: [{ name: "无名", wants: "捣乱" }],
					conflict: "有人堵门",
					directions: ["甲", "乙", "丙"],
				},
				known,
			),
		).toThrow("不是角色卡或世界书里的人物");
		expect(() =>
			validateOpeningPackPayload(
				{
					place: "教室",
					time: "清晨",
					participants: [{ name: "凛", wants: "确认来意" }],
					conflict: "有人堵门",
					directions: ["甲", "乙", "丙"],
					extra: "多余",
				},
				known,
			),
		).toThrow("未知字段");
		expect(() =>
			validateOpeningPackPayload(
				{
					place: "教室",
					time: "清晨",
					participants: [{ name: "凛", wants: "确认来意" }],
					conflict: "有人堵门",
					directions: ["只有一条"],
				},
				known,
			),
		).toThrow("3 条");
	});

	it("角色卡正文里出现的其他人物可以通过校验", () => {
		const payload = validateOpeningPackPayload(
			{
				place: "走廊",
				time: "清晨",
				participants: [{ name: "阿岚", wants: "确认凛的去向" }],
				conflict: "阿岚拦住你",
				directions: ["甲", "乙", "丙"],
			},
			{
				names: known.names,
				sourceText: "凛是图书委员。她的搭档阿岚总在走廊尽头抽烟。",
			},
		);

		expect(payload.participants.map((item) => item.name)).toEqual(["阿岚"]);
	});

	it("卡里没有的名字仍然整包拒绝并指出字段", () => {
		expect(() =>
			validateOpeningPackPayload(
				{
					place: "走廊",
					time: "清晨",
					participants: [{ name: "赵六", wants: "路过" }],
					conflict: "有人拦住你",
					directions: ["甲", "乙", "丙"],
				},
				{
					names: known.names,
					sourceText: "凛是图书委员。她的搭档阿岚总在走廊尽头抽烟。",
				},
			),
		).toThrow("participants[0].name");
	});

	it("单字名不按正文出现判定", () => {
		expect(() =>
			validateOpeningPackPayload(
				{
					place: "走廊",
					time: "清晨",
					participants: [{ name: "雨", wants: "下个不停" }],
					conflict: "雨越下越大",
					directions: ["甲", "乙", "丙"],
				},
				{ names: new Set(), sourceText: "外面在下雨。" },
			),
		).toThrow("不是角色卡或世界书里的人物");
	});
});

describe("开局包任务", () => {
	it("故事级任务在还没有楼层时生成并入库", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([packJson("第一版")]);

		const result = await drain(store, client);

		expect(result.enqueued).toBe(1);
		expect(result.runs.map((run) => run.status)).toEqual(["done"]);
		const pack = store.getOpeningPack("s1");
		expect(pack?.sourceNodeId).toBeNull();
		expect(pack?.payload.place).toBe("教室（第一版）");
		expect(requests).toHaveLength(1);
		expect(requests[0]?.temperature).toBe(0);
		const content = requests[0]?.messages[1]?.content;
		expect(content).toContain("凛是图书委员");
		expect(content).toContain("学校在冬天仍然开放");
		expect(content).toContain("还没有开场白");
	});

	it("角色卡描述里的其他人物不建实体也能生成与读取开局包", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "开局" });
		store.updateStorySettings("s1", {
			cardName: "凛",
			characterPrompt: "凛是图书委员。她的搭档阿岚总在走廊尽头抽烟。",
		});
		const { client } = createFakeClient([
			JSON.stringify({
				place: "走廊",
				time: "清晨",
				participants: [{ name: "阿岚", wants: "确认凛的去向" }],
				conflict: "阿岚拦住你",
				directions: ["甲", "乙", "丙"],
			}),
		]);

		const result = await drain(store, client);

		expect(result.runs.map((run) => run.status)).toEqual(["done"]);
		const pack = readOpeningPack(store, "s1");
		expect(pack?.participants.map((item) => item.name)).toEqual(["阿岚"]);
	});

	it("没有角色卡与常驻世界书时不建任务也不调用模型", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "空白" });
		const { client, requests } = createFakeClient([]);

		const result = await drain(store, client);

		expect(result.enqueued).toBe(0);
		expect(result.runs).toEqual([]);
		expect(requests).toEqual([]);
		expect(store.getOpeningPack("s1")).toBeNull();
	});

	it("缺字段时整包拒绝并保留原因，不写入开局包", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([
			'{"place":"教室","time":"清晨","conflict":"有人堵门"}',
		]);

		const result = await drain(store, client, 1);

		expect(result.runs.map((run) => run.status)).toEqual(["failed"]);
		expect(result.runs[0]?.error).toContain("participants");
		expect(store.getOpeningPack("s1")).toBeNull();
	});

	it("同一输入重复运行不再调用模型，重复生成只覆盖同一行", async () => {
		const { store, path } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([
			packJson("第一版"),
			packJson("第二版"),
		]);

		await drain(store, client);
		const second = await drain(store, client);

		expect(second.enqueued).toBe(0);
		expect(second.runs).toEqual([]);
		expect(requests).toHaveLength(1);
		expect(store.getOpeningPack("s1")?.payload.place).toBe("教室（第一版）");

		// 输入变化（首条玩家消息出现）后重新生成，仍然只有一行。
		store.appendNode({
			id: "u1",
			storyId: "s1",
			parentId: null,
			role: "user",
			raw: "我推开门。",
		});
		const third = await drain(store, client);
		expect(third.runs.map((run) => run.status)).toEqual(["done"]);
		expect(requests).toHaveLength(2);
		expect(requests[1]?.messages[1]?.content).toContain("我推开门。");
		expect(store.getOpeningPack("s1")?.payload.place).toBe("教室（第二版）");
		expect(store.getOpeningPack("s1")?.sourceNodeId).toBe("u1");
		expect(store.getStateDiffs("u1")).toEqual([]);

		const raw = new Database(path, { readonly: true });
		try {
			const row = raw
				.prepare("SELECT COUNT(*) AS count FROM opening_packs")
				.get() as { readonly count: number };
			expect(row.count).toBe(1);
		} finally {
			raw.close();
		}
	});

	it("模板变化后重新生成", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		});
		const created = store.createContextTemplate({
			name: "叙述",
			template: { ...template, id: "narrative" },
		});
		store.updateStorySettings("s1", { templateId: created.id });
		const { client, requests } = createFakeClient([
			packJson("第一版"),
			packJson("第二版"),
		]);

		await drain(store, client);
		store.updateContextTemplate(created.id, {
			template: {
				id: "narrative",
				segments: template.segments.map((segment) =>
					segment.id === "character" ? { ...segment, priority: 95 } : segment,
				),
			},
		});
		expect(openingPackNeedsRun(store, "s1")).toBe(true);
		const second = await drain(store, client);

		expect(second.runs.map((run) => run.status)).toEqual(["done"]);
		expect(requests).toHaveLength(2);
		expect(store.getOpeningPack("s1")?.payload.place).toBe("教室（第二版）");
	});

	it("故事级任务没有楼层，重复补建不产生重复行", () => {
		const { store } = openTempStore();
		seedStory(store);

		const first = store.enqueueMissingBackgroundJobs({
			storyId: "s1",
			kinds: [OPENING_JOB_KIND],
			conditions: { [OPENING_JOB_KIND]: "story" },
		});
		const second = store.enqueueMissingBackgroundJobs({
			storyId: "s1",
			kinds: [OPENING_JOB_KIND],
			conditions: { [OPENING_JOB_KIND]: "story" },
		});

		expect(first).toHaveLength(1);
		expect(first[0]?.nodeId).toBeNull();
		expect(second).toEqual([]);
	});

	it("故事级任务必须提供 needsRun，其他入队条件不允许提供", () => {
		expect(() =>
			createBackgroundJobRegistry({
				[OPENING_JOB_KIND]: {
					handler: createOpeningHandler(),
					enqueue: "story",
				},
			}),
		).toThrow("必须提供 needsRun");
		expect(() =>
			createBackgroundJobRegistry({
				[OPENING_JOB_KIND]: {
					handler: createOpeningHandler(),
					enqueue: "settled",
					needsRun: openingPackNeedsRun,
				},
			}),
		).toThrow("只有在入队条件为 story 时");
	});
});
