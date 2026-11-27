import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type DirectorLine,
	type DirectorLineState,
	type StoryStore,
	applyDirectorLineDiffs,
	assertChapterReviewMatchesLines,
	assertDirectorChapterReviewPayload,
	assertDirectorLine,
	assertDirectorLineDiffs,
	assertPromiseBudget,
	countOpenPromises,
	directorLineRemaining,
	readPlayerIntent,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function makeLine(overrides: Partial<DirectorLine> = {}): DirectorLine {
	return {
		id: "line-1",
		kind: "main",
		who: "卫宫",
		want: "阻止仪式",
		obstacle: "时间只剩一夜",
		countdown: null,
		preparations: ["她先去了钟楼", "她把信交给了管家"],
		...overrides,
	};
}

function makeState(
	overrides: Partial<DirectorLine> = {},
	openedDepth = 1,
	lastTouchedDepth = 1,
): DirectorLineState {
	return { line: makeLine(overrides), openedDepth, lastTouchedDepth };
}

describe("线对象与存储", () => {
	it("校验线的字段并指出字段路径", () => {
		expect(
			assertDirectorLine({ ...makeLine(), who: "  卫宫  " }, "线"),
		).toEqual(makeLine());
		expect(() =>
			assertDirectorLine({ ...makeLine(), kind: "scheme" }, "线"),
		).toThrow("线.kind 只能是 main、relationship、opposition、promise");
		expect(() => assertDirectorLine({ ...makeLine(), who: " " }, "线")).toThrow(
			"线.who 必须是非空字符串",
		);
		expect(() =>
			assertDirectorLine({ ...makeLine(), countdown: -1 }, "线"),
		).toThrow("线.countdown 必须是非负整数或 null");
		expect(() =>
			assertDirectorLine(
				{
					...makeLine(),
					preparations: ["一", "二", "三", "四"],
				},
				"线",
			),
		).toThrow("线.preparations 最多 3 条");
		expect(() =>
			assertDirectorLine(
				{ ...makeLine(), preparations: ["同样的", "同样的"] },
				"线",
			),
		).toThrow("线.preparations[1] 与前面的发展重复");
		expect(() =>
			assertDirectorLine({ ...makeLine(), owner: "卫宫" }, "线"),
		).toThrow("线.owner 是未知字段");
		expect(
			assertDirectorLine({ ...makeLine(), mustInterrupt: true }, "线"),
		).toEqual({ ...makeLine(), mustInterrupt: true });
		expect(() =>
			assertDirectorLine({ ...makeLine(), mustInterrupt: "yes" }, "线"),
		).toThrow("线.mustInterrupt 必须是布尔值");
	});

	it("校验修改动作的两种形状", () => {
		const parsed = assertDirectorLineDiffs(
			[
				{ action: "set", line: makeLine() },
				{ action: "delete", id: "line-2" },
			],
			"diffs",
		);
		expect(parsed).toHaveLength(2);
		expect(() =>
			assertDirectorLineDiffs([{ action: "delete", id: "" }], "diffs"),
		).toThrow("diffs[0].id 必须是非空字符串");
		expect(() =>
			assertDirectorLineDiffs(
				[{ action: "set", line: makeLine(), id: "line-1" }],
				"diffs",
			),
		).toThrow("diffs[0].id 是未知字段");
	});

	it("沿路径累加修改，冷热取最近一次写入的深度", () => {
		let states = applyDirectorLineDiffs(
			[],
			[{ action: "set", line: makeLine({ countdown: 2 }) }],
			3,
		);
		expect(states).toEqual([
			{
				line: makeLine({ countdown: 2 }),
				openedDepth: 3,
				lastTouchedDepth: 3,
			},
		]);
		states = applyDirectorLineDiffs(
			states,
			[
				{ action: "set", line: makeLine({ id: "line-2", kind: "promise" }) },
				{ action: "set", line: makeLine({ countdown: 0 }) },
			],
			5,
		);
		expect(states.map((state) => state.line.id)).toEqual(["line-1", "line-2"]);
		expect(states[0]?.openedDepth).toBe(3);
		expect(states[0]?.lastTouchedDepth).toBe(5);
		expect(states[1]?.openedDepth).toBe(5);
		expect(directorLineRemaining(states[0] as DirectorLineState, 6)).toBe(-1);
		states = applyDirectorLineDiffs(
			states,
			[{ action: "delete", id: "line-1" }],
			6,
		);
		expect(states.map((state) => state.line.id)).toEqual(["line-2"]);
	});

	it("按分支读取，其他分支的记录不参与", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试故事" });
		store.appendNode({
			id: "n0",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场。",
		});
		store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: "n0",
			role: "user",
			raw: "我走向钟楼。",
		});
		store.appendNode({
			id: "n2",
			storyId: "s1",
			parentId: "n1",
			role: "assistant",
			raw: "钟楼里没有人。",
		});
		store.appendNode({
			id: "n3",
			storyId: "s1",
			parentId: "n0",
			role: "user",
			raw: "我留在原地。",
		});
		store.appendNode({
			id: "n4",
			storyId: "s1",
			parentId: "n3",
			role: "assistant",
			raw: "大厅里很安静。",
		});

		store.saveDirectorLines({
			nodeId: "n0",
			storyId: "s1",
			diffs: [{ action: "set", line: makeLine({ countdown: 2 }) }],
		});
		store.saveDirectorLines({
			nodeId: "n2",
			storyId: "s1",
			diffs: [
				{ action: "set", line: makeLine({ countdown: 0 }) },
				{
					action: "set",
					line: makeLine({
						id: "line-2",
						kind: "promise",
						countdown: null,
					}),
				},
			],
		});

		const here = store.readDirectorLineStates("n2");
		expect(here.map((state) => state.line.id)).toEqual(["line-1", "line-2"]);
		expect(here[0]?.openedDepth).toBe(1);
		expect(here[0]?.lastTouchedDepth).toBe(2);
		expect(here[0]?.line.countdown).toBe(0);

		const other = store.readDirectorLineStates("n4");
		expect(other).toHaveLength(1);
		expect(other[0]?.openedDepth).toBe(1);
		expect(other[0]?.line.countdown).toBe(2);

		expect(
			store.listDirectorLinesAlongPath("n2").map((record) => record.nodeId),
		).toEqual(["n0", "n2"]);
		expect(
			store.listDirectorLinesAlongPath("n4").map((record) => record.nodeId),
		).toEqual(["n0"]);

		expect(() =>
			store.saveDirectorLines({
				nodeId: "n0",
				storyId: "s1",
				diffs: [{ action: "set", line: makeLine() }],
			}),
		).toThrow();
		expect(store.getDirectorLines("n0")?.diffs).toHaveLength(1);
		expect(() =>
			store.saveDirectorLines({
				nodeId: "n0",
				storyId: "s2",
				diffs: [{ action: "set", line: makeLine() }],
			}),
		).toThrow("线修改的 storyId 与楼层所属故事不一致：s2");
	});
});

describe("伏笔账", () => {
	function seedStory(store: StoryStore): void {
		store.createStory({ id: "s1", title: "测试故事" });
		store.appendNode({
			id: "n0",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场。",
		});
	}

	function promises(count: number) {
		return Array.from({ length: count }, (_, index) => ({
			action: "set" as const,
			line: makeLine({
				id: `promise-${index + 1}`,
				kind: "promise" as const,
				countdown: null,
				preparations: [],
			}),
		}));
	}

	it("默认上限是 5，超出的新建整批拒绝", () => {
		const { store } = openTempStore();
		seedStory(store);
		expect(DEFAULT_DIRECTOR_CONFIG.maxOpenPromises).toBe(5);
		expect(() =>
			store.saveDirectorLines({
				nodeId: "n0",
				storyId: "s1",
				diffs: promises(6),
			}),
		).toThrow("超过上限 5");
		expect(store.getDirectorLines("n0")).toBeNull();

		store.saveDirectorLines({
			nodeId: "n0",
			storyId: "s1",
			diffs: promises(5),
		});
		store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: "n0",
			role: "assistant",
			raw: "继续。",
		});
		store.saveDirectorLines({
			nodeId: "n1",
			storyId: "s1",
			diffs: [
				{
					action: "set",
					line: makeLine({
						id: "promise-1",
						kind: "promise",
						countdown: null,
						want: "换一个说法",
						preparations: [],
					}),
				},
			],
		});
		expect(countOpenPromises(store.readDirectorLineStates("n1"))).toBe(5);

		store.appendNode({
			id: "n2",
			storyId: "s1",
			parentId: "n1",
			role: "assistant",
			raw: "再继续。",
		});
		const replace = [
			{ action: "delete" as const, id: "promise-1" },
			{
				action: "set" as const,
				line: makeLine({
					id: "promise-6",
					kind: "promise" as const,
					countdown: null,
					preparations: [],
				}),
			},
		];
		store.saveDirectorLines({ nodeId: "n2", storyId: "s1", diffs: replace });
		expect(countOpenPromises(store.readDirectorLineStates("n2"))).toBe(5);

		expect(() =>
			assertPromiseBudget(store.readDirectorLineStates("n2"), promises(1), 5),
		).toThrow("超过上限 5");
		expect(() => assertPromiseBudget([], promises(1), -1)).toThrow(
			"伏笔上限必须是非负整数",
		);
	});
});

describe("章末清点", () => {
	function seedChapter(store: StoryStore): void {
		store.createStory({ id: "s1", title: "测试故事" });
		store.appendNode({
			id: "n0",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "第一章结束。",
		});
		store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: "n0",
			role: "assistant",
			raw: "另一条分支。",
		});
		store.saveDirectorLines({
			nodeId: "n0",
			storyId: "s1",
			diffs: [
				{ action: "set", line: makeLine({ id: "main" }) },
				{
					action: "set",
					line: makeLine({
						id: "promise-1",
						kind: "promise",
						countdown: null,
					}),
				},
				{
					action: "set",
					line: makeLine({
						id: "promise-2",
						kind: "promise",
						countdown: null,
					}),
				},
			],
		});
	}

	const PAYLOAD = {
		promises: [
			{ lineId: "promise-1", disposition: "carry" as const },
			{ lineId: "promise-2", disposition: "retire" as const },
		],
		focus: ["main", "promise-1"],
	};

	it("写入后读回，重复写入被拒绝", () => {
		const { store } = openTempStore();
		seedChapter(store);
		const saved = store.saveDirectorChapterReview({
			nodeId: "n0",
			storyId: "s1",
			payload: PAYLOAD,
		});
		expect(saved.payload).toEqual(PAYLOAD);
		expect(store.getDirectorChapterReview("n0")?.payload).toEqual(PAYLOAD);
		expect(store.listDirectorChapterReviewsAlongPath("n0")).toHaveLength(1);
		expect(store.listDirectorChapterReviewsAlongPath("n1")).toHaveLength(1);
		expect(() =>
			store.saveDirectorChapterReview({
				nodeId: "n0",
				storyId: "s1",
				payload: PAYLOAD,
			}),
		).toThrow("已经有章末清点记录");
	});

	it("每条伏笔都要有处理，聚焦的线必须在场且没有作废", () => {
		const { store } = openTempStore();
		seedChapter(store);
		const states = store.readDirectorLineStates("n0");
		const firstPromise = {
			lineId: "promise-1",
			disposition: "carry" as const,
		};
		expect(() =>
			assertChapterReviewMatchesLines(
				{ promises: [firstPromise], focus: ["main", "promise-2"] },
				states,
			),
		).toThrow("没有给出伏笔的处理：promise-2");
		expect(() =>
			assertChapterReviewMatchesLines(
				{
					promises: [
						...PAYLOAD.promises,
						{ lineId: "ghost", disposition: "carry" },
					],
					focus: ["main", "promise-2"],
				},
				states,
			),
		).toThrow("不存在的线：ghost");
		expect(() =>
			assertChapterReviewMatchesLines(
				{
					promises: [
						{ lineId: "main", disposition: "carry" },
						...PAYLOAD.promises,
					],
					focus: ["main", "promise-1"],
				},
				states,
			),
		).toThrow("不是未兑现的伏笔：main");
		expect(() =>
			assertChapterReviewMatchesLines(
				{
					promises: PAYLOAD.promises,
					focus: ["main", "promise-2"],
				},
				states,
			),
		).toThrow("作废的伏笔：promise-2");
	});

	it("形状校验拒绝坏字段、重复与不合适的聚焦条数", () => {
		expect(() =>
			assertDirectorChapterReviewPayload({
				promises: [{ lineId: "p1", disposition: "next" }],
				focus: ["a", "b"],
			}),
		).toThrow("disposition 只能是 carry、retire");
		expect(() =>
			assertDirectorChapterReviewPayload({
				promises: [
					{ lineId: "p1", disposition: "carry" },
					{ lineId: "p1", disposition: "retire" },
				],
				focus: ["a", "b"],
			}),
		).toThrow("与前面的伏笔重复：p1");
		expect(() =>
			assertDirectorChapterReviewPayload({ promises: [], focus: ["a"] }),
		).toThrow("必须是 2 到 3 条线");
		expect(() =>
			assertDirectorChapterReviewPayload({
				promises: [],
				focus: ["a", "b", "c", "d"],
			}),
		).toThrow("必须是 2 到 3 条线");
		expect(() =>
			assertDirectorChapterReviewPayload({
				promises: [],
				focus: ["a", "a"],
			}),
		).toThrow("与前面的线重复：a");
		expect(() =>
			assertDirectorChapterReviewPayload({
				promises: [],
				focus: ["a", "b"],
				x: 1,
			}),
		).toThrow("x 是未知字段");
	});
});

describe("玩家意图", () => {
	it("看内容不看字数：短而明确的行动也是玩家自己的决定", () => {
		expect(readPlayerIntent("去码头", null).kind).toBe("free");
		expect(readPlayerIntent("接过钥匙，现在就上顶层", null).kind).toBe("free");
		expect(readPlayerIntent("跳到第二天早上", null).kind).toBe("free");
	});

	it("固定说法与推进按钮等价，并对应三档", () => {
		expect(readPlayerIntent("继续", null)).toMatchObject({
			kind: "push",
			push: "advance",
		});
		expect(readPlayerIntent("推进剧情。", null).push).toBe("advance");
		expect(readPlayerIntent("快速推进剧情", null).push).toBe("quick");
		expect(readPlayerIntent("大幅度推进剧情", null).push).toBe("jump");
		expect(readPlayerIntent("……", null).push).toBe("advance");
		expect(readPlayerIntent("随便写点什么", "quick").push).toBe("quick");
		expect(readPlayerIntent(null, null).kind).toBe("none");
	});
});
