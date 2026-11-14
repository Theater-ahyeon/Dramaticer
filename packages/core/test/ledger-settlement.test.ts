import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { StoryStore, TurnTrace } from "../src/index.js";
import { prepareSettlementForNodes, validateLedgerDiff } from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_ISO = "2026-11-07T12:00:00.000Z";

function traceFor(
	nodeId: string,
	storyId: string,
	parentNodeId: string | null,
	stopReason = "stop",
): TurnTrace {
	return {
		storyId,
		nodeId,
		parentNodeId,
		templateId: "dramaticer-default",
		turnMode: "fast",
		profile: "native",
		createdAt: FIXED_ISO,
		context: { budgetTokens: 1_000, totalTokens: 0, entries: [] },
		llm: {
			role: "writer",
			model: "fake-model",
			channel: "fake-channel",
			stopReason,
			finishReason: stopReason === "aborted" ? null : "stop",
			truncations: [],
			usage: {
				promptTokens: null,
				completionTokens: null,
				totalTokens: null,
				reasoningTokens: null,
				cachedTokens: null,
			},
			attempts: 1,
			rounds: 1,
			cached: false,
		},
		tools: {
			transport: "native",
			rounds: 0,
			maxRounds: 3,
			capped: false,
			calls: [],
			rejected: [],
		},
		structured: {
			mode: "text-tags",
			acceptedStateUpdates: 0,
			acceptedNotes: 0,
			issues: [],
		},
		timing: { firstTokenMs: 100, durationMs: 500 },
	};
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
	store.appendNode({
		id: "n1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。",
	});
}

describe("结算记录存储", () => {
	it("写入后按楼层读回，列出时按创建顺序排列", () => {
		const { store } = openTempStore();
		seedStory(store);
		const settlement = store.recordLedgerSettlement({
			nodeId: "n1",
			storyId: "s1",
			source: "settler",
			addedCount: 2,
			repairs: [
				{
					path: ["character", "凛", "location"],
					action: "fill",
					reason: "正文写了地点但模型没有写入",
				},
			],
			createdAt: FIXED_ISO,
		});
		expect(settlement).toEqual({
			nodeId: "n1",
			storyId: "s1",
			source: "settler",
			addedCount: 2,
			repairs: [
				{
					path: ["character", "凛", "location"],
					action: "fill",
					reason: "正文写了地点但模型没有写入",
				},
			],
			createdAt: FIXED_ISO,
		});
		expect(store.getLedgerSettlement("n1")).toEqual(settlement);
		expect(store.listLedgerSettlements("s1")).toEqual([settlement]);
	});

	it("同一楼层重复结算抛错，来源与条数非法时指出字段", () => {
		const { store } = openTempStore();
		seedStory(store);
		store.recordLedgerSettlement({
			nodeId: "n1",
			storyId: "s1",
			source: "model",
			addedCount: 0,
			repairs: [],
		});
		expect(store.getLedgerSettlement("n1")?.source).toBe("model");
		expect(() =>
			store.recordLedgerSettlement({
				nodeId: "n1",
				storyId: "s1",
				source: "settler",
				addedCount: 1,
				repairs: [],
			}),
		).toThrow("已经结算过");
		expect(() =>
			store.recordLedgerSettlement({
				nodeId: "n1",
				storyId: "s1",
				source: "borrowed" as unknown as "settler",
				addedCount: 0,
				repairs: [],
			}),
		).toThrow("来源");
		expect(() =>
			store.recordLedgerSettlement({
				nodeId: "n1",
				storyId: "s1",
				source: "settler",
				addedCount: -1,
				repairs: [],
			}),
		).toThrow("非负整数");
	});

	it("修复记录的动作与路径非法时指出序号", () => {
		const { store } = openTempStore();
		seedStory(store);
		expect(() =>
			store.recordLedgerSettlement({
				nodeId: "n1",
				storyId: "s1",
				source: "settler",
				addedCount: 0,
				repairs: [
					{
						path: ["clue", "c1", "status"],
						action: "invent" as unknown as "fill",
						reason: "改写成开启",
					},
				],
			}),
		).toThrow("repairs[0]");
	});

	it("数据库触发器拒绝 story_id 与楼层不一致的结算记录", () => {
		const { store, path } = openTempStore();
		seedStory(store);
		store.createStory({ id: "s2", title: "另一个故事" });
		const raw = new Database(path);
		try {
			expect(() =>
				raw
					.prepare(
						`INSERT INTO ledger_settlements
							(node_id, story_id, source, added_count, repairs, created_at)
						VALUES ('n1', 's2', 'settler', 0, '[]', ?)`,
					)
					.run(FIXED_ISO),
			).toThrow("story_id");
		} finally {
			raw.close();
		}
	});
});

describe("结算置信度", () => {
	it("状态 diff 带置信度写入并按原值读回", () => {
		const { store } = openTempStore();
		seedStory(store);
		const [stored] = store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "n1",
				path: ["time", "current"],
				op: "set",
				value: "黄昏",
				source: "settler",
				confidence: 0.75,
			},
		]);
		expect(stored?.confidence).toBe(0.75);
		expect(store.getStateDiffs("n1")[0]?.confidence).toBe(0.75);
	});

	it("没有置信度时存为空，越界或非数字直接抛错", () => {
		const { store } = openTempStore();
		seedStory(store);
		const [plain] = store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "n1",
				path: ["time", "current"],
				op: "set",
				value: "清晨",
				source: "model",
			},
		]);
		expect(plain?.confidence).toBeNull();
		expect(() =>
			store.appendStateDiffs([
				{
					storyId: "s1",
					nodeId: "n1",
					path: ["time", "current"],
					op: "set",
					value: "正午",
					source: "settler",
					confidence: 1.5,
				},
			]),
		).toThrow("confidence");
	});

	it("validateLedgerDiff 校验置信度范围", () => {
		expect(() =>
			validateLedgerDiff({
				path: ["time", "current"],
				op: "set",
				value: "黄昏",
				confidence: 0.4,
			}),
		).not.toThrow();
		expect(() =>
			validateLedgerDiff({
				path: ["time", "current"],
				op: "set",
				value: "黄昏",
				confidence: -0.1,
			}),
		).toThrow("confidence");
		expect(() =>
			validateLedgerDiff({
				path: ["time", "current"],
				op: "set",
				value: "黄昏",
				confidence: 2,
			}),
		).toThrow("confidence");
	});
});

describe("实体候选", () => {
	it("同一名称重复出现只累加命中次数，首个楼层保持第一次出现的位置", () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendNode({
			id: "n2",
			storyId: "s1",
			parentId: "n1",
			role: "user",
			raw: "我看向窗外。",
		});
		const first = store.upsertEntityCandidate({
			storyId: "s1",
			name: " 第 三 班 ",
			kind: "character",
			nodeId: "n1",
			createdAt: FIXED_ISO,
		});
		expect(first).toEqual({
			storyId: "s1",
			normalizedName: "第三班",
			kind: "character",
			hits: 1,
			firstNodeId: "n1",
			createdAt: FIXED_ISO,
		});
		const second = store.upsertEntityCandidate({
			storyId: "s1",
			name: "第三班",
			kind: "character",
			nodeId: "n2",
			createdAt: "2026-11-07T13:00:00.000Z",
		});
		expect(second.hits).toBe(2);
		expect(second.firstNodeId).toBe("n1");
		expect(store.listEntityCandidates("s1")).toEqual([second]);
	});

	it("类别非法与名称只有标点时抛错", () => {
		const { store } = openTempStore();
		seedStory(store);
		expect(() =>
			store.upsertEntityCandidate({
				storyId: "s1",
				name: "凛",
				kind: "spirit" as unknown as "character",
				nodeId: "n1",
			}),
		).toThrow("kind");
		expect(() =>
			store.upsertEntityCandidate({
				storyId: "s1",
				name: "……",
				kind: "character",
				nodeId: "n1",
			}),
		).toThrow("为空");
	});

	it("数据库触发器拒绝首个楼层不属于同一故事的候选", () => {
		const { store, path } = openTempStore();
		seedStory(store);
		store.createStory({ id: "s2", title: "另一个故事" });
		const raw = new Database(path);
		try {
			expect(() =>
				raw
					.prepare(
						`INSERT INTO entity_candidates
							(story_id, normalized_name, kind, hits, first_node_id, created_at)
						VALUES ('s2', '凛', 'character', 1, 'n1', ?)`,
					)
					.run(FIXED_ISO),
			).toThrow("story_id");
		} finally {
			raw.close();
		}
	});
});

describe("结算窗口", () => {
	function seedChain(store: StoryStore): void {
		store.createStory({ id: "s1", title: "测试故事" });
		const a = store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场。",
		});
		const b = store.appendNode({
			id: "n2",
			storyId: "s1",
			parentId: a.id,
			role: "user",
			raw: "我推门进去。",
		});
		const c = store.appendNode({
			id: "n3",
			storyId: "s1",
			parentId: b.id,
			role: "assistant",
			raw: "屋里很暗。",
		});
		const d = store.appendNode({
			id: "n4",
			storyId: "s1",
			parentId: c.id,
			role: "user",
			raw: "我继续问。",
		});
		const e = store.appendNode({
			id: "n5",
			storyId: "s1",
			parentId: d.id,
			role: "assistant",
			raw: "话说到一半",
		});
		store.saveTurnTrace(traceFor(a.id, "s1", null));
		store.saveTurnTrace(traceFor(c.id, "s1", b.id));
		store.saveTurnTrace(traceFor(e.id, "s1", d.id, "aborted"));
	}

	it("只取当前路径上已落定、未结算的助手楼层，中止的楼层不算", () => {
		const { store } = openTempStore();
		seedChain(store);
		expect(store.listUnsettledSettledAssistantNodes("s1", 4)).toEqual([
			"n1",
			"n3",
		]);
		store.recordLedgerSettlement({
			nodeId: "n1",
			storyId: "s1",
			source: "settler",
			addedCount: 1,
			repairs: [],
		});
		expect(store.listUnsettledSettledAssistantNodes("s1", 4)).toEqual(["n3"]);
		expect(store.listUnsettledSettledAssistantNodes("s1", 1)).toEqual(["n3"]);
	});

	it("窗口只沿当前 head 的路径取楼层", () => {
		const { store } = openTempStore();
		seedChain(store);
		const sibling = store.appendNode({
			id: "n3b",
			storyId: "s1",
			parentId: "n2",
			role: "assistant",
			raw: "另一条分支。",
		});
		store.saveTurnTrace(traceFor(sibling.id, "s1", "n2"));
		store.setHead("s1", "n5");
		expect(store.listUnsettledSettledAssistantNodes("s1", 4)).toEqual([
			"n1",
			"n3",
		]);
		store.setHead("s1", "n3b");
		expect(store.listUnsettledSettledAssistantNodes("s1", 4)).toEqual([
			"n1",
			"n3b",
		]);
	});

	it("没有 head 与非法窗口大小时返回空或抛错", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "空故事" });
		expect(store.listUnsettledSettledAssistantNodes("s1", 4)).toEqual([]);
		expect(() => store.listUnsettledSettledAssistantNodes("s1", 0)).toThrow(
			"正整数",
		);
	});

	it("显式楼层窗口只包含给定楼层，超过窗口大小抛错", () => {
		const { store } = openTempStore();
		seedChain(store);
		const window = prepareSettlementForNodes(store, "s1", ["n3"], {
			windowSize: 4,
		});
		expect(window?.nodeIds).toEqual(["n3"]);
		expect(window?.floors.map((floor) => floor.nodeId)).toEqual(["n3"]);
		expect(window?.floors[0]?.raw).toBe("屋里很暗。");
		expect(prepareSettlementForNodes(store, "s1", [])).toBeNull();
		expect(() =>
			prepareSettlementForNodes(store, "s1", ["n1", "n3", "n3", "n3", "n3"], {
				windowSize: 4,
			}),
		).toThrow("最多 4 个楼层");
	});
});

describe("按落定条件入队", () => {
	function seed(store: StoryStore): void {
		store.createStory({ id: "s1", title: "测试故事" });
		const a = store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场。",
		});
		const b = store.appendNode({
			id: "n2",
			storyId: "s1",
			parentId: a.id,
			role: "user",
			raw: "我来了。",
		});
		const aborted = store.appendNode({
			id: "n3x",
			storyId: "s1",
			parentId: b.id,
			role: "assistant",
			raw: "断在半句",
		});
		const c = store.appendNode({
			id: "n3",
			storyId: "s1",
			parentId: b.id,
			role: "assistant",
			raw: "还在写",
		});
		store.saveTurnTrace(traceFor(a.id, "s1", null));
		store.saveTurnTrace(traceFor(c.id, "s1", b.id));
		store.saveTurnTrace(traceFor(aborted.id, "s1", b.id, "aborted"));
	}

	it("settled 条件为已落定但未确认的助手楼层建任务，中止的楼层不算", () => {
		const { store } = openTempStore();
		seed(store);
		const created = store.enqueueMissingBackgroundJobs({
			storyId: "s1",
			kinds: ["settle"],
			conditions: { settle: "settled" },
			createdAt: FIXED_ISO,
		});
		expect(created.map((job) => job.nodeId)).toEqual(["n1", "n3"]);
	});

	it("confirmed 条件只处理有子节点的楼层", () => {
		const { store } = openTempStore();
		seed(store);
		const created = store.enqueueMissingBackgroundJobs({
			storyId: "s1",
			kinds: ["events"],
			createdAt: FIXED_ISO,
		});
		expect(created.map((job) => `${job.nodeId}:${job.kind}`)).toEqual([
			"n1:events",
			"n2:events",
		]);
	});

	it("settled 条件排除当前路径上的中止楼层", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试故事" });
		store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场。",
		});
		store.appendNode({
			id: "n2",
			storyId: "s1",
			parentId: "n1",
			role: "user",
			raw: "继续。",
		});
		store.appendNode({
			id: "n3",
			storyId: "s1",
			parentId: "n2",
			role: "assistant",
			raw: "断在半句",
		});
		store.appendNode({
			id: "n4",
			storyId: "s1",
			parentId: "n3",
			role: "user",
			raw: "再来。",
		});
		store.saveTurnTrace(traceFor("n1", "s1", null));
		store.saveTurnTrace(traceFor("n3", "s1", "n2", "aborted"));
		const created = store.enqueueMissingBackgroundJobs({
			storyId: "s1",
			kinds: ["settle"],
			conditions: { settle: "settled" },
			createdAt: FIXED_ISO,
		});
		expect(created.map((job) => job.nodeId)).toEqual(["n1"]);
	});

	it("条件键必须属于本次类型列表，取值必须是已知条件", () => {
		const { store } = openTempStore();
		seed(store);
		expect(() =>
			store.enqueueMissingBackgroundJobs({
				storyId: "s1",
				kinds: ["settle"],
				conditions: { events: "settled" },
			}),
		).toThrow("类型列表");
		expect(() =>
			store.enqueueMissingBackgroundJobs({
				storyId: "s1",
				kinds: ["settle"],
				conditions: {
					settle: "unknown" as unknown as "settled",
				},
			}),
		).toThrow("入队条件");
	});
});
