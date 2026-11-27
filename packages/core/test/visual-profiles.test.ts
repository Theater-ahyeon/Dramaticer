import { describe, expect, it } from "vitest";
import {
	type BackgroundDrainResult,
	type BackgroundJob,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	VISUAL_PROFILE_JOB_KIND,
	assertCharacterVisualProfile,
	assertUniqueVisualProfiles,
	collectVisualProfileInput,
	createBackgroundJobRegistry,
	createDefaultBackgroundJobRegistry,
	createVisualProfileHandler,
	drainBackgroundJobs,
	enqueueVisualProfileBackgroundJob,
	parseVisualProfilesResponse,
	validateVisualProfilePayload,
	visualProfileNeedsRun,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_NOW = Date.UTC(2026, 10, 9, 12, 0, 0);

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

function profile(
	character: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		character,
		base: ["黑长直", "红瞳"],
		defaultOutfit: "深蓝校服",
		...overrides,
	};
}

function profilesJson(profiles: readonly Record<string, unknown>[]): string {
	return JSON.stringify({ profiles });
}

const known = {
	names: new Set(["凛"]),
	sourceText: "凛是图书委员。她的搭档阿岚总在走廊尽头抽烟。",
};

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "视觉档案" });
	store.updateStorySettings("s1", {
		cardName: "凛",
		characterPrompt:
			"凛是图书委员，黑长直，常穿深蓝校服。她的搭档阿岚总在走廊尽头抽烟。",
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

const registry = createBackgroundJobRegistry({
	[VISUAL_PROFILE_JOB_KIND]: {
		handler: createVisualProfileHandler(),
		enqueue: "story",
		needsRun: visualProfileNeedsRun,
	},
});

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
		kinds: [VISUAL_PROFILE_JOB_KIND],
		now: () => FIXED_NOW,
		maxAttempts,
	});
}

function storyJob(): BackgroundJob {
	const timestamp = new Date(FIXED_NOW).toISOString();
	return {
		id: 0,
		storyId: "s1",
		nodeId: null,
		kind: VISUAL_PROFILE_JOB_KIND,
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: timestamp,
		startedAt: timestamp,
		finishedAt: null,
	};
}

describe("视觉档案字段校验", () => {
	it("省略的可选字段填默认值", () => {
		expect(assertCharacterVisualProfile(profile("凛"))).toEqual({
			character: "凛",
			base: ["黑长直", "红瞳"],
			defaultOutfit: "深蓝校服",
			outfitPath: null,
			negative: [],
			seed: null,
			backends: {},
			locked: false,
			slots: {
				face: {
					front: { clothed: [], bare: [] },
					back: { clothed: [], bare: [] },
				},
				upper: {
					front: { clothed: [], bare: [] },
					back: { clothed: [], bare: [] },
				},
				full: {
					front: { clothed: [], bare: [] },
					back: { clothed: [], bare: [] },
				},
			},
		});
	});

	it("未知字段与空字符串都拒绝并指出路径", () => {
		expect(() =>
			assertCharacterVisualProfile({ ...profile("凛"), extra: "多余" }),
		).toThrow("视觉档案.extra");
		expect(() => assertCharacterVisualProfile(profile("  "))).toThrow(
			"视觉档案.character",
		);
		expect(() =>
			assertCharacterVisualProfile(profile("凛", { base: [] })),
		).toThrow("视觉档案.base 至少需要一项");
		expect(() =>
			assertCharacterVisualProfile(profile("凛", { base: ["黑长直", " "] })),
		).toThrow("视觉档案.base[1]");
		expect(() =>
			assertCharacterVisualProfile(profile("凛", { defaultOutfit: "" })),
		).toThrow("视觉档案.defaultOutfit");
		expect(() =>
			assertCharacterVisualProfile(profile("凛", { negative: [""] })),
		).toThrow("视觉档案.negative[0]");
		expect(() =>
			assertCharacterVisualProfile(
				profile("凛", { outfitPath: ["character", " "] }),
			),
		).toThrow("视觉档案.outfitPath[1]");
		expect(() =>
			assertCharacterVisualProfile(profile("凛", { outfitPath: [] })),
		).toThrow("视觉档案.outfitPath");
	});

	it("越界 seed 与不能为空的 backends 都拒绝", () => {
		for (const seed of [-1, 1.5, "42"]) {
			expect(() =>
				assertCharacterVisualProfile(profile("凛", { seed })),
			).toThrow("视觉档案.seed");
		}
		expect(assertCharacterVisualProfile(profile("凛", { seed: 0 })).seed).toBe(
			0,
		);
		expect(() =>
			assertCharacterVisualProfile(
				profile("凛", { backends: { comfy: { lora: "x" } } }),
			),
		).toThrow("视觉档案.backends");
	});

	it("重复人物按忽略大小写与标点判定", () => {
		const first = assertCharacterVisualProfile(profile("Alice"));
		const second = assertCharacterVisualProfile(profile("alice"));
		expect(() => assertUniqueVisualProfiles([first, second])).toThrow(
			"视觉档案[1].character",
		);
		const spaced = assertCharacterVisualProfile(profile("阿·岚"));
		const plain = assertCharacterVisualProfile(profile("阿岚"));
		expect(() => assertUniqueVisualProfiles([plain, spaced])).toThrow(
			"视觉档案[1].character",
		);
	});
});

describe("视觉档案人物校验", () => {
	it("角色卡正文里出现的人物可以通过校验", () => {
		expect(validateVisualProfilePayload(profile("阿岚"), known).character).toBe(
			"阿岚",
		);
	});

	it("角色卡与实体里都没有的人物、单字名都拒绝", () => {
		expect(() => validateVisualProfilePayload(profile("赵六"), known)).toThrow(
			"视觉档案.character",
		);
		expect(() =>
			validateVisualProfilePayload(profile("雨"), {
				names: new Set(),
				sourceText: "外面在下雨。",
			}),
		).toThrow("视觉档案.character");
	});
});

describe("视觉档案响应解析", () => {
	it("接受 1 到 8 条档案", () => {
		expect(
			parseVisualProfilesResponse(profilesJson([profile("凛")]), known),
		).toHaveLength(1);
		const names = [
			"甲甲",
			"乙乙",
			"丙丙",
			"丁丁",
			"戊戊",
			"己己",
			"庚庚",
			"辛辛",
		];
		const parsed = parseVisualProfilesResponse(
			profilesJson(names.map((name) => profile(name))),
			{ names: new Set(names), sourceText: "" },
		);
		expect(parsed.map((item) => item.character)).toEqual(names);
	});

	it("少于 1 条、多于 8 条、重复人物与未知顶层字段都整包拒绝", () => {
		expect(() => parseVisualProfilesResponse(profilesJson([]), known)).toThrow(
			"1 到 8 条",
		);
		expect(() =>
			parseVisualProfilesResponse(
				profilesJson(
					Array.from({ length: 9 }, (_, index) => profile(`人物${index}`)),
				),
				{
					names: new Set(Array.from({ length: 9 }, (_, i) => `人物${i}`)),
					sourceText: "",
				},
			),
		).toThrow("1 到 8 条");
		expect(() =>
			parseVisualProfilesResponse(
				profilesJson([profile("凛"), profile("凛")]),
				known,
			),
		).toThrow("视觉档案.profiles[1].character");
		expect(() =>
			parseVisualProfilesResponse(
				JSON.stringify({ profiles: [profile("凛")], extra: 1 }),
				known,
			),
		).toThrow("视觉档案.extra");
		expect(() =>
			parseVisualProfilesResponse('{"profiles": "不是数组"}', known),
		).toThrow("视觉档案.profiles 必须是数组");
	});
});

describe("视觉档案任务", () => {
	it("故事级任务生成一包并入库，来源为 model", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([
			profilesJson([
				profile("凛"),
				profile("阿岚", { defaultOutfit: "灰色夹克" }),
			]),
		]);

		const result = await drain(store, client);

		expect(result.enqueued).toBe(1);
		expect(result.runs.map((run) => run.status)).toEqual(["done"]);
		expect(result.runs[0]?.nodeId).toBeNull();
		const records = store.listCharacterVisualProfiles("s1");
		expect(records.map((record) => record.profile.character)).toEqual([
			"凛",
			"阿岚",
		]);
		expect(records.every((record) => record.source === "model")).toBe(true);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.temperature).toBe(0);
		const content = requests[0]?.messages[1]?.content;
		expect(content).toContain("凛是图书委员");
		expect(content).toContain("学校在冬天仍然开放");
		expect(content).toContain("已知人物名");
	});

	it("重复执行只覆盖同一行，创建时间不变", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([
			profilesJson([profile("凛"), profile("阿岚")]),
			profilesJson([
				profile("凛", { base: ["银发"] }),
				profile("阿岚", { defaultOutfit: "白色风衣" }),
			]),
		]);
		const handler = createVisualProfileHandler();

		await handler({ store, client, job: storyJob() });
		const first = store.getCharacterVisualProfile("s1", "凛");
		await handler({ store, client, job: storyJob() });

		const records = store.listCharacterVisualProfiles("s1");
		expect(records).toHaveLength(2);
		const second = store.getCharacterVisualProfile("s1", "凛");
		expect(second?.profile.base).toEqual(["银发"]);
		expect(second?.createdAt).toBe(first?.createdAt);
		expect(
			store.getCharacterVisualProfile("s1", "阿岚")?.profile.defaultOutfit,
		).toBe("白色风衣");
	});

	it("锁定的档案不被后台自动生成覆盖", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.saveCharacterVisualProfiles({
			storyId: "s1",
			source: "player",
			profiles: [
				assertCharacterVisualProfile(
					profile("凛", { base: ["锁定外貌"], locked: true }),
				),
			],
		});
		const { client } = createFakeClient([
			profilesJson([profile("凛", { base: ["模型外貌"] }), profile("阿岚")]),
		]);

		await createVisualProfileHandler()({ store, client, job: storyJob() });

		expect(store.getCharacterVisualProfile("s1", "凛")?.profile.base).toEqual([
			"锁定外貌",
		]);
		expect(store.getCharacterVisualProfile("s1", "阿岚")).not.toBeNull();
	});

	it("没有角色卡与常驻世界书时不入队也不调用模型", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "空白" });
		const { client, requests } = createFakeClient([]);

		const result = await drain(store, client);

		expect(result.enqueued).toBe(0);
		expect(result.runs).toEqual([]);
		expect(requests).toEqual([]);
		expect(collectVisualProfileInput(store, "s1")).toBeNull();
		expect(visualProfileNeedsRun(store, "s1")).toBe(false);
	});

	it("未知人物整包拒绝，不写入档案", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([profilesJson([profile("赵六")])]);

		const result = await drain(store, client, 1);

		expect(result.runs.map((run) => run.status)).toEqual(["failed"]);
		expect(result.runs[0]?.error).toContain("视觉档案.profiles[0].character");
		expect(store.listCharacterVisualProfiles("s1")).toEqual([]);
	});

	it("档案表为空时才入队，完成后不再补建", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([profilesJson([profile("凛")])]);

		expect(visualProfileNeedsRun(store, "s1")).toBe(true);
		const [first] = enqueueVisualProfileBackgroundJob(store, "s1");
		const [again] = enqueueVisualProfileBackgroundJob(store, "s1");
		expect(first?.id).toBe(again?.id);
		expect(
			store.listBackgroundJobs({
				storyId: "s1",
				kinds: [VISUAL_PROFILE_JOB_KIND],
			}),
		).toHaveLength(1);

		await drain(store, client);

		expect(visualProfileNeedsRun(store, "s1")).toBe(false);
		expect(enqueueVisualProfileBackgroundJob(store, "s1")).toEqual([]);
	});

	it("注册表把视觉档案任务放在间隙档", () => {
		const defaults = createDefaultBackgroundJobRegistry();
		expect(defaults.get(VISUAL_PROFILE_JOB_KIND)).toMatchObject({
			enqueue: "story",
			tier: "gap",
		});
	});
});
