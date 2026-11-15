import { describe, expect, it } from "vitest";
import {
	BLUEPRINT_SUGGESTION_OPERATIONS,
	type BlueprintMilestone,
	type BlueprintPremise,
	type BlueprintVolume,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	blueprintSuggestionNeedsRun,
	createBlueprintSuggestionHandler,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

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

function makePremise(
	overrides: Partial<BlueprintPremise> = {},
): BlueprintPremise {
	return {
		id: "premise",
		kind: "premise",
		source: "player",
		locked: false,
		coreQuestion: "卫宫能不能在仪式开始前找到妹妹",
		tone: "阴冷",
		endings: ["救回妹妹", "妹妹成为代价"],
		redLines: ["不写虐待儿童"],
		tension: "medium",
		...overrides,
	};
}

function makeVolume(overrides: Partial<BlueprintVolume> = {}): BlueprintVolume {
	return {
		id: "volume-1",
		kind: "volume",
		source: "player",
		locked: false,
		title: "第一卷 钟楼",
		coreQuestion: "谁在钟楼里等她",
		startState: "卫宫刚进城",
		endState: "卫宫知道钟楼下埋着什么",
		...overrides,
	};
}

function makeMilestone(
	overrides: Partial<BlueprintMilestone> = {},
): BlueprintMilestone {
	return {
		id: "milestone-1",
		kind: "milestone",
		source: "player",
		locked: false,
		volumeId: "volume-1",
		want: "找到钟楼的钥匙",
		prerequisites: ["拿到管家写的信"],
		after: [],
		hardness: "soft",
		...overrides,
	};
}

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
	store.appendNode({
		id: "n0",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场：卫宫走进城里。",
	});
	store.appendNode({
		id: "n1",
		storyId: "s1",
		parentId: "n0",
		role: "user",
		raw: "我去钟楼。",
	});
	store.appendNode({
		id: "n2",
		storyId: "s1",
		parentId: "n1",
		role: "assistant",
		raw: "钟楼里只有灰尘与旧锁。",
	});
	store.saveStoryBlueprint({
		nodeId: "n0",
		storyId: "s1",
		source: "player",
		diffs: [
			{ action: "set", entry: makePremise() },
			{ action: "set", entry: makeVolume() },
			{ action: "set", entry: makeMilestone() },
		],
	});
}

function job() {
	return {
		id: 1,
		storyId: "s1",
		nodeId: null,
		kind: "blueprint_suggestion",
		status: "running" as const,
		attempts: 1,
		lastError: null,
		createdAt: "2026-11-14T12:00:00.000Z",
		startedAt: "2026-11-14T12:00:00.000Z",
		finishedAt: null,
	};
}

function reply(suggestions: readonly unknown[]): string {
	return JSON.stringify({ suggestions });
}

describe("蓝图建议请求", () => {
	it("五个操作都能登记请求，生成前需要后台任务", () => {
		const { store } = openTempStore();
		seed(store);

		for (const operation of BLUEPRINT_SUGGESTION_OPERATIONS) {
			const request = store.createBlueprintSuggestionRequest({
				storyId: "s1",
				operation,
				note: "",
			});
			expect(request.status).toBe("pending");
			expect(request.operation).toBe(operation);
		}
		expect(blueprintSuggestionNeedsRun(store, "s1")).toBe(true);
		expect(() =>
			store.createBlueprintSuggestionRequest({
				storyId: "s1",
				operation: "unknown" as never,
			}),
		).toThrow("蓝图建议操作只能是");
	});

	it("生成只存建议，不写蓝图也不改楼层原文", async () => {
		const { store } = openTempStore();
		seed(store);
		const request = store.createBlueprintSuggestionRequest({
			storyId: "s1",
			operation: "complete",
			note: "补上总纲",
		});
		const beforeEntries = store.readBlueprintEntries("n2");
		const beforeRaw = store.getNode("n2")?.raw;
		const { client, requests } = createFakeClient([
			reply([
				{
					title: "补全总纲",
					reason: "总纲还缺一个明确的核心问题。",
					diffs: [
						{
							action: "set",
							entry: makePremise({
								source: "player",
								locked: true,
								coreQuestion: "卫宫能不能赶在仪式前救回妹妹",
							}),
						},
					],
				},
			]),
		]);

		await createBlueprintSuggestionHandler()({
			store,
			client,
			job: job(),
		});

		expect(requests).toHaveLength(1);
		const prompt = requests[0]?.messages[1]?.content ?? "";
		expect(prompt).toContain("操作：帮我补全");
		expect(prompt).toContain("补上总纲");
		expect(prompt).toContain("卫宫能不能在仪式开始前找到妹妹");
		expect(prompt).toContain("钟楼里只有灰尘与旧锁。");
		expect(store.readBlueprintEntries("n2")).toEqual(beforeEntries);
		expect(store.getNode("n2")?.raw).toBe(beforeRaw);
		expect(store.listStoryBlueprintRecords("n2")).toHaveLength(0);

		const stored = store.listBlueprintSuggestions({ storyId: "s1" });
		expect(stored).toHaveLength(1);
		expect(stored[0]?.status).toBe("pending");
		expect(stored[0]?.requestId).toBe(request.id);
		const diff = stored[0]?.diffs[0];
		expect(diff?.action).toBe("set");
		if (diff?.action === "set") {
			expect(diff.entry.source).toBe("ai");
			expect(diff.entry.locked).toBe(false);
		}
		expect(store.getBlueprintSuggestionRequest(request.id)?.status).toBe(
			"done",
		);
		expect(blueprintSuggestionNeedsRun(store, "s1")).toBe(false);
	});

	it("接受一条只写一批修改，同一楼层连续接受不互相覆盖", async () => {
		const { store } = openTempStore();
		seed(store);
		store.createBlueprintSuggestionRequest({
			storyId: "s1",
			operation: "expand-volume",
			note: "",
		});
		const { client } = createFakeClient([
			reply([
				{
					title: "加一个铺垫里程碑",
					reason: "钥匙需要先被提到。",
					diffs: [
						{
							action: "set",
							entry: makeMilestone({
								id: "milestone-2",
								want: "听见钟楼的第二声钟响",
								after: ["milestone-1"],
							}),
						},
					],
				},
				{
					title: "加一个终局里程碑",
					reason: "这一卷需要一个收束。",
					diffs: [
						{
							action: "set",
							entry: makeMilestone({
								id: "milestone-3",
								want: "打开钟楼地下的门",
								after: ["milestone-1"],
								hardness: "hard",
							}),
						},
					],
				},
			]),
		]);

		await createBlueprintSuggestionHandler()({ store, client, job: job() });
		const suggestions = store.listBlueprintSuggestions({ storyId: "s1" });
		expect(suggestions).toHaveLength(2);

		const first = store.acceptBlueprintSuggestion({
			id: suggestions[0]?.id ?? 0,
			nodeId: "n2",
		});
		expect(first.record.seq).toBe(1);
		expect(first.record.source).toBe("player");
		expect(first.suggestion.status).toBe("accepted");

		const second = store.acceptBlueprintSuggestion({
			id: suggestions[1]?.id ?? 0,
			nodeId: "n2",
		});
		expect(second.record.seq).toBe(2);

		const entries = store.readBlueprintEntries("n2");
		expect(entries.map((entry) => entry.id).sort()).toEqual([
			"milestone-1",
			"milestone-2",
			"milestone-3",
			"premise",
			"volume-1",
		]);
		for (const id of ["milestone-2", "milestone-3"]) {
			const entry = entries.find((item) => item.id === id);
			expect(entry?.source).toBe("ai");
		}
	});

	it("生成时跳过锁定条目，只剩锁定修改的建议整条丢弃", async () => {
		const { store } = openTempStore();
		seed(store);
		store.saveStoryBlueprint({
			nodeId: "n0",
			storyId: "s1",
			source: "player",
			diffs: [{ action: "set", entry: makePremise({ locked: true }) }],
		});
		store.createBlueprintSuggestionRequest({
			storyId: "s1",
			operation: "find-flaws",
			note: "",
		});
		const { client } = createFakeClient([
			reply([
				{
					title: "改总纲",
					reason: "锁定的条目。",
					diffs: [
						{
							action: "set",
							entry: makePremise({ coreQuestion: "被改掉的问题" }),
						},
					],
				},
				{
					title: "加里程碑",
					reason: "总纲锁定时只改里程碑。",
					diffs: [
						{
							action: "set",
							entry: makeMilestone({
								id: "milestone-2",
								want: "找到第二把钥匙",
							}),
						},
					],
				},
			]),
		]);

		await createBlueprintSuggestionHandler()({ store, client, job: job() });

		const suggestions = store.listBlueprintSuggestions({ storyId: "s1" });
		expect(suggestions).toHaveLength(1);
		const ids = suggestions[0]?.diffs.map((diff) =>
			diff.action === "set" ? diff.entry.id : diff.id,
		);
		expect(ids).toEqual(["milestone-2"]);
	});

	it("接受时跳过后来被锁定的条目，全部命中时整条拒绝", async () => {
		const { store } = openTempStore();
		seed(store);
		store.createBlueprintSuggestionRequest({
			storyId: "s1",
			operation: "complete",
			note: "",
		});
		const { client } = createFakeClient([
			reply([
				{
					title: "改卷的标题",
					reason: "标题还能更具体。",
					diffs: [
						{
							action: "set",
							entry: makeVolume({ title: "第一卷 旧钟楼" }),
						},
					],
				},
			]),
		]);
		await createBlueprintSuggestionHandler()({ store, client, job: job() });
		const suggestion = store.listBlueprintSuggestions({
			storyId: "s1",
		})[0];

		store.saveStoryBlueprint({
			nodeId: "n2",
			storyId: "s1",
			source: "player",
			diffs: [{ action: "set", entry: makeVolume({ locked: true }) }],
		});

		expect(() =>
			store.acceptBlueprintSuggestion({
				id: suggestion?.id ?? 0,
				nodeId: "n2",
			}),
		).toThrow("都命中了锁定条目");
		expect(store.getBlueprintSuggestion(suggestion?.id ?? 0)?.status).toBe(
			"pending",
		);
		const volume = store
			.readBlueprintEntries("n2")
			.find((entry) => entry.id === "volume-1");
		expect(volume?.locked).toBe(true);
		if (volume?.kind === "volume") {
			expect(volume.title).toBe("第一卷 钟楼");
		}
		expect(store.listStoryBlueprintRecords("n2")).toHaveLength(1);
	});

	it("蓝图变化让建议不合法时整条拒绝，一行都不写", async () => {
		const { store } = openTempStore();
		seed(store);
		store.createBlueprintSuggestionRequest({
			storyId: "s1",
			operation: "expand-volume",
			note: "",
		});
		const { client } = createFakeClient([
			reply([
				{
					title: "加一个依赖第一卷的里程碑",
					reason: "这一卷还需要一个收尾。",
					diffs: [
						{
							action: "set",
							entry: makeMilestone({
								id: "milestone-2",
								want: "把钥匙插进钟楼的门",
							}),
						},
					],
				},
			]),
		]);
		await createBlueprintSuggestionHandler()({ store, client, job: job() });
		const suggestion = store.listBlueprintSuggestions({
			storyId: "s1",
		})[0];

		store.saveStoryBlueprint({
			nodeId: "n2",
			storyId: "s1",
			source: "player",
			diffs: [
				{ action: "delete", id: "milestone-1" },
				{ action: "delete", id: "volume-1" },
			],
		});
		const before = store.readBlueprintEntries("n2");

		expect(() =>
			store.acceptBlueprintSuggestion({
				id: suggestion?.id ?? 0,
				nodeId: "n2",
			}),
		).toThrow("指向的卷 volume-1 不存在");
		expect(store.readBlueprintEntries("n2")).toEqual(before);
		expect(store.listStoryBlueprintRecords("n2")).toHaveLength(1);
		expect(store.getBlueprintSuggestion(suggestion?.id ?? 0)?.status).toBe(
			"pending",
		);
	});

	it("拒绝只改建议状态，不写蓝图", async () => {
		const { store } = openTempStore();
		seed(store);
		store.createBlueprintSuggestionRequest({
			storyId: "s1",
			operation: "recent-update",
			note: "",
		});
		const { client } = createFakeClient([
			reply([
				{
					title: "更新卷的起止状态",
					reason: "卫宫已经进了钟楼。",
					diffs: [
						{
							action: "set",
							entry: makeVolume({ startState: "卫宫已经进了钟楼" }),
						},
					],
				},
			]),
		]);
		await createBlueprintSuggestionHandler()({ store, client, job: job() });
		const suggestion = store.listBlueprintSuggestions({
			storyId: "s1",
		})[0];
		const before = store.readBlueprintEntries("n2");

		const rejected = store.rejectBlueprintSuggestion({
			id: suggestion?.id ?? 0,
		});

		expect(rejected.status).toBe("rejected");
		expect(rejected.decidedAt).not.toBeNull();
		expect(store.readBlueprintEntries("n2")).toEqual(before);
		expect(store.listStoryBlueprintRecords("n2")).toHaveLength(0);
		expect(() =>
			store.rejectBlueprintSuggestion({ id: suggestion?.id ?? 0 }),
		).toThrow("已经决定过");
	});
});
