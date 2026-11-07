import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	CLUE_AGE_PRIORITY,
	CLUE_COUNT_PRIORITY,
	DEFAULT_DIRECTOR_CONFIG,
	type StoryStore,
	evaluateDirector,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
	store.createStory({ id: "s2", title: "另一个故事" });
}

/** 在 s1 上建一条从 n0 开始的链，返回按顺序排列的楼层 id。 */
function buildChain(store: StoryStore, length: number): string[] {
	const ids: string[] = [];
	for (let index = 0; index < length; index += 1) {
		const id = `n${index}`;
		store.appendNode({
			id,
			storyId: "s1",
			parentId: index === 0 ? null : `n${index - 1}`,
			role: index % 2 === 0 ? "assistant" : "user",
			raw: `楼层 ${index}`,
		});
		ids.push(id);
	}
	return ids;
}

function addNote(
	store: StoryStore,
	id: string,
	sourceNodeId: string,
	text = `线索 ${id}`,
): void {
	store.insertPlotNotes([{ id, storyId: "s1", sourceNodeId, text }]);
}

function config(overrides: Partial<typeof DEFAULT_DIRECTOR_CONFIG> = {}) {
	return { ...DEFAULT_DIRECTOR_CONFIG, ...overrides };
}

describe("导演决策框架", () => {
	it("未兑现线索的年龄等于当前位置减去来源位置，超过阈值时建议回收", () => {
		const { store } = openTempStore();
		seed(store);
		const chain = buildChain(store, 14);
		addNote(store, "clue1", "n0", "井底的人影");

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[13] as string,
			config: DEFAULT_DIRECTOR_CONFIG,
		});

		expect(suggestion).not.toBeNull();
		expect(suggestion?.mechanism).toBe("clue");
		expect(suggestion?.priority).toBe(CLUE_AGE_PRIORITY);
		expect(suggestion?.directive).toContain("已搁置 13 楼");
		expect(suggestion?.directive).toContain("井底的人影");
		expect(suggestion?.directive).not.toContain("\n");
		expect(suggestion?.signals).toMatchObject({
			openClues: 1,
			oldestAge: 13,
			selectedNoteId: "clue1",
		});

		const decision = store.getDirectorDecision(chain[13] as string);
		expect(decision).toMatchObject({
			nodeId: chain[13],
			storyId: "s1",
			directive: suggestion?.directive,
		});
		expect(decision?.mechanisms).toEqual([
			{
				name: "clue",
				triggered: true,
				reason: "最老线索搁置 13 楼，超过阈值 12",
			},
		]);
		expect(decision?.signals).toMatchObject({
			openClues: 1,
			oldestAge: 13,
			selectedNoteId: "clue1",
		});
	});

	it("年龄等于阈值不触发；数量达到上限时建议先推进最老的一条", () => {
		const { store } = openTempStore();
		seed(store);
		const chain = buildChain(store, 13);
		addNote(store, "clue1", "n0", "裂缝");

		expect(
			evaluateDirector({
				store,
				storyId: "s1",
				nodeId: chain[12] as string,
				config: DEFAULT_DIRECTOR_CONFIG,
			}),
		).toBeNull();
		const idle = store.getDirectorDecision(chain[12] as string);
		expect(idle?.directive).toBeNull();
		expect(idle?.mechanisms[0]).toMatchObject({
			name: "clue",
			triggered: false,
		});

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[12] as string,
			config: config({ maxOpenClues: 1 }),
		});
		expect(suggestion?.priority).toBe(CLUE_COUNT_PRIORITY);
		expect(suggestion?.directive).toContain("先推动最老的一条");
		expect(suggestion?.directive).toContain("裂缝");
	});

	it("两个条件同时满足时只输出一行，取优先级更高的年龄建议", () => {
		const { store } = openTempStore();
		seed(store);
		const chain = buildChain(store, 14);
		const nodeId = chain[13] as string;
		addNote(store, "clue1", "n0", "旧线索");
		for (let index = 2; index <= 5; index += 1) {
			addNote(store, `clue${index}`, nodeId, `新线索 ${index}`);
		}

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId,
			config: DEFAULT_DIRECTOR_CONFIG,
		});

		expect(suggestion?.priority).toBe(CLUE_AGE_PRIORITY);
		expect(suggestion?.directive).toContain("旧线索");
		expect(suggestion?.directive).not.toContain("先推动");
		expect(suggestion?.signals).toMatchObject({
			openClues: 5,
			oldestAge: 13,
			selectedNoteId: "clue1",
		});
		const decision = store.getDirectorDecision(nodeId);
		expect(decision?.mechanisms[0]?.reason).toContain("超过阈值");
		expect(decision?.mechanisms[0]?.reason).toContain("达到上限");
	});

	it("没有未兑现笔记时返回 null，决策记录里 directive 为 null", () => {
		const { store } = openTempStore();
		seed(store);
		const chain = buildChain(store, 3);

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[2] as string,
			config: DEFAULT_DIRECTOR_CONFIG,
		});

		expect(suggestion).toBeNull();
		const decision = store.getDirectorDecision(chain[2] as string);
		expect(decision?.directive).toBeNull();
		expect(decision?.signals).toMatchObject({
			openClues: 0,
			oldestAge: null,
			selectedNoteId: null,
		});
		expect(decision?.mechanisms[0]?.reason).toBe("当前分支没有未兑现剧情笔记");
	});

	it("同一楼层重复评估覆盖旧记录，不产生两行", () => {
		const { store, path } = openTempStore();
		seed(store);
		const chain = buildChain(store, 4);
		const nodeId = chain[3] as string;
		addNote(store, "clue1", "n0");

		const first = evaluateDirector({
			store,
			storyId: "s1",
			nodeId,
			config: config({ maxOpenClues: 1 }),
		});
		expect(first).not.toBeNull();
		expect(store.getDirectorDecision(nodeId)?.directive).toBe(
			first?.directive ?? null,
		);

		const second = evaluateDirector({
			store,
			storyId: "s1",
			nodeId,
			config: config({ enabled: false }),
		});
		expect(second).toBeNull();
		expect(store.getDirectorDecision(nodeId)?.directive).toBe(
			first?.directive ?? null,
		);

		const third = evaluateDirector({
			store,
			storyId: "s1",
			nodeId,
			config: config({ maxOpenClues: 1000, clueAgeWarning: 1000 }),
		});
		expect(third).toBeNull();
		expect(store.getDirectorDecision(nodeId)?.directive).toBeNull();

		const raw = new Database(path);
		try {
			const row = raw
				.prepare(
					"SELECT COUNT(*) AS count FROM director_decisions WHERE node_id = ?",
				)
				.get(nodeId) as { readonly count: number };
			expect(row.count).toBe(1);
		} finally {
			raw.close();
		}
	});

	it("另一分支上的笔记不参与评估，决策记录按分支过滤", () => {
		const { store } = openTempStore();
		seed(store);
		const chain = buildChain(store, 3);
		addNote(store, "mainClue", "n2", "主分支线索");

		store.appendNode({
			id: "b1",
			storyId: "s1",
			parentId: "n1",
			role: "assistant",
			raw: "分支一",
		});
		store.appendNode({
			id: "b2",
			storyId: "s1",
			parentId: "b1",
			role: "user",
			raw: "分支二",
		});

		evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[2] as string,
			config: DEFAULT_DIRECTOR_CONFIG,
		});
		const branchSuggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: "b2",
			config: DEFAULT_DIRECTOR_CONFIG,
		});
		expect(branchSuggestion).toBeNull();
		expect(store.getDirectorDecision("b2")?.signals).toMatchObject({
			openClues: 0,
		});

		const currentPath = store.getDirectorDecisionsAlongPath(chain[2] as string);
		expect(currentPath.map((decision) => decision.nodeId)).toEqual([chain[2]]);
		expect(store.getDirectorDecisionsAlongPath("b1")).toEqual([]);
		expect(
			store.getDirectorDecisionsAlongPath("b2").map((d) => d.nodeId),
		).toEqual(["b2"]);
	});

	it("关闭导演时不评估也不写记录", () => {
		const { store } = openTempStore();
		seed(store);
		const chain = buildChain(store, 2);
		addNote(store, "clue1", "n0");

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[1] as string,
			config: config({ enabled: false }),
		});

		expect(suggestion).toBeNull();
		expect(store.getDirectorDecision(chain[1] as string)).toBeNull();
	});

	it("已兑现笔记不参与评估", () => {
		const { store } = openTempStore();
		seed(store);
		const chain = buildChain(store, 4);
		addNote(store, "clue1", chain[0] as string);
		store.fulfillPlotNote("clue1", "2026-11-07T12:00:00.000Z");

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[3] as string,
			config: DEFAULT_DIRECTOR_CONFIG,
		});
		expect(suggestion).toBeNull();
		expect(
			store.getDirectorDecision(chain[3] as string)?.signals,
		).toMatchObject({ openClues: 0 });
	});

	it("非法的配置与跨故事的记录直接抛错", () => {
		const { store } = openTempStore();
		seed(store);
		const chain = buildChain(store, 2);

		expect(() =>
			evaluateDirector({
				store,
				storyId: "s1",
				nodeId: chain[1] as string,
				config: config({ clueAgeWarning: -1 }),
			}),
		).toThrow("clueAgeWarning");
		expect(() =>
			evaluateDirector({
				store,
				storyId: "s1",
				nodeId: chain[1] as string,
				config: config({ maxOpenClues: 0 }),
			}),
		).toThrow("maxOpenClues");
		expect(() =>
			evaluateDirector({
				store,
				storyId: "s1",
				nodeId: "missing",
				config: DEFAULT_DIRECTOR_CONFIG,
			}),
		).toThrow("楼层节点不存在");

		expect(() =>
			store.saveDirectorDecision({
				nodeId: chain[0] as string,
				storyId: "s2",
				directive: null,
				mechanisms: [{ name: "clue", triggered: false, reason: "没有线索" }],
				signals: {},
			}),
		).toThrow("与楼层节点所属故事不一致");
	});
});

describe("导演决策存储", () => {
	it("裸连接写入跨故事的记录被触发器拒绝，楼层归属不可修改", () => {
		const { store, path } = openTempStore();
		seed(store);
		buildChain(store, 1);
		store.saveDirectorDecision({
			nodeId: "n0",
			storyId: "s1",
			directive: null,
			mechanisms: [{ name: "clue", triggered: false, reason: "没有线索" }],
			signals: {},
		});

		const raw = new Database(path);
		try {
			expect(() =>
				raw
					.prepare(
						`INSERT INTO director_decisions
							(node_id, story_id, directive, mechanisms, signals, created_at)
						VALUES ('n0', 's2', NULL, '[]', '{}', '2026-11-07T12:00:00.000Z')`,
					)
					.run(),
			).toThrow("必须与楼层节点一致");
			expect(() =>
				raw
					.prepare(
						"UPDATE director_decisions SET story_id = 's2' WHERE node_id = 'n0'",
					)
					.run(),
			).toThrow("归属不可修改");
		} finally {
			raw.close();
		}
	});

	it("校验机制记录与 signals，重复评估覆盖时保留最新内容", () => {
		const { store } = openTempStore();
		seed(store);
		buildChain(store, 1);

		expect(() =>
			store.saveDirectorDecision({
				nodeId: "n0",
				storyId: "s1",
				directive: null,
				mechanisms: [],
				signals: {},
			}),
		).toThrow("非空数组");
		expect(() =>
			store.saveDirectorDecision({
				nodeId: "n0",
				storyId: "s1",
				directive: null,
				mechanisms: [
					{ name: "clue", triggered: false, reason: "没有线索" },
					{ name: "clue", triggered: false, reason: "重复" },
				],
				signals: {},
			}),
		).toThrow("重复");
		expect(() =>
			store.saveDirectorDecision({
				nodeId: "n0",
				storyId: "s1",
				directive: " ",
				mechanisms: [{ name: "clue", triggered: false, reason: "没有线索" }],
				signals: {},
			}),
		).toThrow("不能是空字符串");

		store.saveDirectorDecision({
			nodeId: "n0",
			storyId: "s1",
			directive: "先回收线索",
			mechanisms: [{ name: "clue", triggered: true, reason: "过老" }],
			signals: { openClues: 1 },
			createdAt: "2026-11-07T12:00:00.000Z",
		});
		store.saveDirectorDecision({
			nodeId: "n0",
			storyId: "s1",
			directive: null,
			mechanisms: [{ name: "clue", triggered: false, reason: "已处理" }],
			signals: { openClues: 0 },
			createdAt: "2026-11-07T13:00:00.000Z",
		});
		const decision = store.getDirectorDecision("n0");
		expect(decision?.directive).toBeNull();
		expect(decision?.mechanisms).toEqual([
			{ name: "clue", triggered: false, reason: "已处理" },
		]);
		expect(decision?.createdAt).toBe("2026-11-07T13:00:00.000Z");
	});
});
