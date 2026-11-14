import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIRECTOR_CONFIG,
	DEFAULT_DIRECTOR_ORGANIZATION,
	DIRECTOR_ACTION_KINDS,
	DIRECTOR_ACTION_LABELS,
	type DirectorActionInput,
	type DirectorLine,
	type DirectorLineState,
	type StoryStore,
	applyDirectorLineDiffs,
	assertDirectorLine,
	assertDirectorLineDiffs,
	createDirectorEngine,
	createDirectorSlotProvider,
	directorLineRemaining,
	isDirectorOrganizationKind,
	readDirectorActionInput,
	selectDirectorAction,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const ACTION_CONFIG = {
	stallFloors: 3,
	clueAgeWarning: 12,
	tensionStateDiffsPerFloor: 2,
};

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

function makeInput(
	overrides: Partial<DirectorActionInput> = {},
): DirectorActionInput {
	return {
		floorDepth: 4,
		playerMessage: null,
		floors: [
			{ beat: "试探", present: ["卫宫"], sceneEnds: false, stateChanges: 1 },
		],
		lines: [makeState()],
		recentActions: [],
		config: ACTION_CONFIG,
		...overrides,
	};
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

describe("八种动作", () => {
	it("八种动作都有标签，默认组织方式不变", () => {
		expect(DIRECTOR_ACTION_KINDS).toEqual([
			"yield",
			"catch",
			"escalate",
			"intrude",
			"fulfill",
			"reveal",
			"breathe",
			"transition",
		]);
		expect(DIRECTOR_ACTION_LABELS.reveal).toBe("揭示");
		expect(DEFAULT_DIRECTOR_ORGANIZATION).toBe("mechanisms");
		expect(isDirectorOrganizationKind("lines")).toBe(true);
	});

	it("玩家写了具体行动时让位，并锚定最热的线", () => {
		const selection = selectDirectorAction(
			makeInput({
				playerMessage: "我推开窗，把信藏进抽屉，然后下楼",
				lines: [
					makeState({}, 1, 1),
					makeState({ id: "line-2", who: "凛" }, 1, 2),
				],
			}),
		);
		expect(selection?.action).toBe("yield");
		expect(selection?.label).toBe("让位");
		expect(selection?.lineId).toBe("line-2");
		expect(selection?.reason).toContain("具体行动");
		expect(selection?.directive).toContain("凛");
	});

	it("场面没有结束时接球", () => {
		const selection = selectDirectorAction(makeInput());
		expect(selection?.action).toBe("catch");
		expect(selection?.label).toBe("接球");
		expect(selection?.directive).toContain("这一场还没有结束");
	});

	it("连续两楼没有状态变化时加码", () => {
		const selection = selectDirectorAction(
			makeInput({
				floors: [
					{ beat: null, present: [], sceneEnds: false, stateChanges: 0 },
					{ beat: null, present: [], sceneEnds: false, stateChanges: 0 },
				],
			}),
		);
		expect(selection?.action).toBe("escalate");
		expect(selection?.reason).toContain("取一条阻碍");
	});

	it("倒计时到点时闯入，余量按楼层推进", () => {
		const selection = selectDirectorAction(
			makeInput({
				floorDepth: 4,
				lines: [makeState({ countdown: 1 }, 1, 2)],
			}),
		);
		expect(selection?.action).toBe("intrude");
		expect(selection?.reason).toContain("余量 -1");
		expect(selection?.directive).toContain("倒计时到点");
	});

	it("伏笔足够老时兑现，越老越优先", () => {
		const selection = selectDirectorAction(
			makeInput({
				floorDepth: 15,
				lines: [
					makeState({ id: "young", kind: "promise" }, 1, 5),
					makeState({ id: "old", kind: "promise" }, 1, 2),
				],
			}),
		);
		expect(selection?.action).toBe("fulfill");
		expect(selection?.lineId).toBe("old");
		expect(selection?.reason).toContain("13 楼");
	});

	it("在场的对手图谋最近被触及时揭示", () => {
		const selection = selectDirectorAction(
			makeInput({
				floorDepth: 4,
				floors: [
					{
						beat: "试探",
						present: ["言峰"],
						sceneEnds: false,
						stateChanges: 0,
					},
				],
				lines: [
					makeState({ id: "scheme", kind: "opposition", who: "言峰" }, 1, 3),
				],
			}),
		);
		expect(selection?.action).toBe("reveal");
		expect(selection?.directive).toContain("一直没有说出口");
	});

	it("连续两楼高强度之后喘息", () => {
		const selection = selectDirectorAction(
			makeInput({
				floors: [
					{
						beat: "冲突",
						present: ["卫宫"],
						sceneEnds: false,
						stateChanges: 2,
					},
					{
						beat: "冲突",
						present: ["卫宫"],
						sceneEnds: false,
						stateChanges: 3,
					},
				],
			}),
		);
		expect(selection?.action).toBe("breathe");
		expect(selection?.reason).toContain("每楼至少 2 条状态变化");
	});

	it("场面收尾或连续停滞时转场", () => {
		const ended = selectDirectorAction(
			makeInput({
				floors: [
					{ beat: "收束", present: [], sceneEnds: true, stateChanges: 1 },
				],
			}),
		);
		expect(ended?.action).toBe("transition");
		expect(ended?.reason).toContain("这一场已经结束");

		const idle = selectDirectorAction(
			makeInput({
				floors: [
					{ beat: null, present: [], sceneEnds: false, stateChanges: 0 },
					{ beat: null, present: [], sceneEnds: false, stateChanges: 0 },
					{ beat: null, present: [], sceneEnds: false, stateChanges: 0 },
				],
			}),
		);
		expect(idle?.action).toBe("transition");
		expect(idle?.reason).toContain("停滞阈值 3");
	});

	it("同一动作连用两次后禁止第三次，改选下一候选", () => {
		const selection = selectDirectorAction(
			makeInput({
				floors: [
					{ beat: "冲突", present: [], sceneEnds: false, stateChanges: 2 },
					{ beat: "冲突", present: [], sceneEnds: false, stateChanges: 2 },
				],
				recentActions: ["breathe", "breathe"],
			}),
		);
		expect(selection?.action).toBe("catch");
		expect(selection?.signals.blockedAction).toBe("breathe");
		expect(selection?.signals.candidates).toEqual(["breathe", "catch"]);
	});

	it("没有任何条件成立时不出建议", () => {
		expect(
			selectDirectorAction(
				makeInput({
					floors: [
						{ beat: null, present: [], sceneEnds: false, stateChanges: 1 },
					],
					lines: [],
				}),
			),
		).toBeNull();
		expect(
			selectDirectorAction(
				makeInput({
					floors: [
						{ beat: null, present: [], sceneEnds: true, stateChanges: 1 },
					],
					lines: [makeState()],
					recentActions: ["transition", "transition"],
				}),
			),
		).toBeNull();
	});
});

describe("线引擎接入", () => {
	function seedStory(store: StoryStore) {
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
			raw: "我拿起桌上的信，先去钟楼找她。",
		});
		store.saveDirectorLines({
			nodeId: "n0",
			storyId: "s1",
			diffs: [{ action: "set", line: makeLine() }],
		});
	}

	it("评估一次动作并写入决策记录", () => {
		const { store } = openTempStore();
		seedStory(store);
		const engine = createDirectorEngine("lines");
		const suggestion = engine.evaluate({
			store,
			storyId: "s1",
			nodeId: "n1",
			config: DEFAULT_DIRECTOR_CONFIG,
		});
		expect(engine.kind).toBe("lines");
		expect(suggestion?.mechanism).toBe("action:yield");
		expect(suggestion?.directive).toContain("具体行动");

		const decision = store.getDirectorDecision("n1");
		expect(decision?.directive).toBe(suggestion?.directive);
		expect(decision?.mechanisms).toEqual([
			{
				name: "action",
				triggered: true,
				reason: expect.stringContaining("具体行动"),
			},
		]);
		expect(decision?.signals.action).toBe("yield");
		expect(decision?.signals.organization).toBe("lines");
	});

	it("导演关闭时不写决策记录", () => {
		const { store } = openTempStore();
		seedStory(store);
		const engine = createDirectorEngine("lines");
		expect(
			engine.evaluate({
				store,
				storyId: "s1",
				nodeId: "n1",
				config: { ...DEFAULT_DIRECTOR_CONFIG, mode: "off" },
			}),
		).toBeNull();
		expect(store.getDirectorDecision("n1")).toBeNull();
	});

	it("最近用过的动作从决策记录读出，第三次同类动作被抑制", () => {
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
			raw: "我等着。",
		});
		store.appendNode({
			id: "n2",
			storyId: "s1",
			parentId: "n1",
			role: "assistant",
			raw: "一切照旧。",
		});
		store.appendNode({
			id: "n3",
			storyId: "s1",
			parentId: "n2",
			role: "user",
			raw: "我继续等。",
		});
		store.saveDirectorDecision({
			nodeId: "n0",
			storyId: "s1",
			directive: "喘一口气。",
			mechanisms: [{ name: "action", triggered: true, reason: "高强度" }],
			signals: { organization: "lines", action: "breathe" },
		});
		store.saveDirectorDecision({
			nodeId: "n2",
			storyId: "s1",
			directive: "再喘一口气。",
			mechanisms: [{ name: "action", triggered: true, reason: "高强度" }],
			signals: { organization: "lines", action: "breathe" },
		});
		store.saveDirectorLines({
			nodeId: "n2",
			storyId: "s1",
			diffs: [{ action: "set", line: makeLine() }],
		});

		const input = readDirectorActionInput(
			store,
			"s1",
			"n3",
			DEFAULT_DIRECTOR_CONFIG,
		);
		expect(input.floorDepth).toBe(2);
		expect(input.recentActions).toEqual(["breathe", "breathe"]);
		expect(input.lines.map((state) => state.line.id)).toEqual(["line-1"]);
		expect(input.floors).toHaveLength(2);
		expect(input.playerMessage).toBe("我继续等。");
	});

	it("槽位来源写进行动标识，供 Trace 与 explain 读取", () => {
		const { store } = openTempStore();
		seedStory(store);
		const provider = createDirectorSlotProvider(store, {
			organization: "lines",
		});
		const content = provider.provide({
			slot: "director",
			storyId: "s1",
			nodeId: "n1",
			switches: {},
			state: {},
		});
		expect(content?.source).toBe("director:action:yield");
		expect(content?.suffix).toContain("【导演】");
		expect(store.getDirectorDecision("n1")?.signals.reason).toContain(
			"具体行动",
		);
	});
});
