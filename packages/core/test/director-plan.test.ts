import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	type DirectorPlan,
	type StoryStore,
	mergePlannedArcs,
	parseDirectorPlan,
	readDirectorPlan,
	replaceDirectorPlan,
	resolveCurrentBeat,
	runDirectorCli,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const VALID_PLAN: DirectorPlan = {
	arcs: [
		{
			id: "arc-1",
			title: "开学",
			throughLine: "凛必须说出真相",
			difficulty: 0.4,
			redLines: ["不能伤害凛"],
			sequences: [
				{
					id: "seq-1",
					title: "相遇",
					beats: [
						{
							id: "beat-1",
							goal: "确认来意",
							entrySigns: ["凛堵在门口"],
							fitPoints: ["凛盯着你", "门外有脚步声"],
						},
						{
							id: "beat-2",
							goal: "让凛松口",
							entrySigns: ["凛移开视线"],
							fitPoints: ["你提到旧事"],
						},
					],
				},
				{
					id: "seq-2",
					title: "追问",
					beats: [
						{
							id: "beat-3",
							goal: "逼出真相",
							entrySigns: ["凛握紧手"],
							fitPoints: ["你拿出证据"],
						},
					],
				},
			],
		},
		{
			id: "arc-2",
			title: "毕业",
			throughLine: "两人必须告别",
			difficulty: 0.8,
			redLines: [],
			sequences: [],
		},
	],
};

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "计划测试" });
}

function buildPath(store: StoryStore): {
	readonly u1: string;
	readonly a1: string;
	readonly u2: string;
	readonly a2: string;
} {
	const a0 = store.appendNode({
		id: "a0",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。",
	});
	const u1 = store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: a0.id,
		role: "user",
		raw: "第一句。",
	});
	const a1 = store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: u1.id,
		role: "assistant",
		raw: "第一答。",
	});
	const u2 = store.appendNode({
		id: "u2",
		storyId: "s1",
		parentId: a1.id,
		role: "user",
		raw: "第二句。",
	});
	const a2 = store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: u2.id,
		role: "assistant",
		raw: "第二答。",
	});
	return { u1: u1.id, a1: a1.id, u2: u2.id, a2: a2.id };
}

function expectPathError(value: unknown, path: string, fragment: string): void {
	expect(() => parseDirectorPlan(value)).toThrow(fragment);
	try {
		parseDirectorPlan(value);
	} catch (error) {
		expect(error instanceof Error ? error.message : "").toContain(path);
	}
}

describe("parseDirectorPlan", () => {
	it("接受完整计划并保留顺序", () => {
		const parsed = parseDirectorPlan(VALID_PLAN);
		expect(parsed).toEqual(VALID_PLAN);
	});

	it("拒绝未知字段并指出路径", () => {
		expectPathError(
			{ arcs: [], extra: true },
			"plan.extra",
			"plan.extra 是未知字段",
		);
		expectPathError(
			{
				arcs: [
					{
						...VALID_PLAN.arcs[0],
						sequences: [
							{
								...VALID_PLAN.arcs[0]?.sequences[0],
								beats: [
									{
										...(VALID_PLAN.arcs[0]?.sequences[0]?.beats[0] ?? {}),
										note: "多余",
									},
								],
							},
						],
					},
				],
			},
			"plan.arcs[0].sequences[0].beats[0].note",
			"未知字段",
		);
	});

	it("拒绝重复 id 并指出后来的位置", () => {
		expectPathError(
			{ arcs: [VALID_PLAN.arcs[0], VALID_PLAN.arcs[0]] },
			"plan.arcs[1].id",
			"重复",
		);
		expectPathError(
			{
				arcs: [
					{
						...VALID_PLAN.arcs[0],
						sequences: [
							VALID_PLAN.arcs[0]?.sequences[0],
							VALID_PLAN.arcs[0]?.sequences[0],
						],
					},
				],
			},
			"plan.arcs[0].sequences[1].id",
			"重复",
		);
		expectPathError(
			{
				arcs: [
					{
						...VALID_PLAN.arcs[0],
						sequences: [
							{
								...VALID_PLAN.arcs[0]?.sequences[0],
								beats: [
									{
										...(VALID_PLAN.arcs[0]?.sequences[0]?.beats[0] ?? {}),
										id: "dup-beat",
									},
									{
										...(VALID_PLAN.arcs[0]?.sequences[0]?.beats[1] ?? {}),
										id: "dup-beat",
									},
								],
							},
						],
					},
				],
			},
			"plan.arcs[0].sequences[0].beats[1].id",
			"重复",
		);
	});

	it("拒绝空字符串、越界难度与空的迹象或契合点", () => {
		expectPathError(
			{ arcs: [{ ...VALID_PLAN.arcs[0], title: "  " }] },
			"plan.arcs[0].title",
			"不能是空字符串",
		);
		expectPathError(
			{ arcs: [{ ...VALID_PLAN.arcs[0], difficulty: 1.2 }] },
			"plan.arcs[0].difficulty",
			"0 到 1",
		);
		expectPathError(
			{
				arcs: [
					{
						...VALID_PLAN.arcs[0],
						sequences: [
							{
								...VALID_PLAN.arcs[0]?.sequences[0],
								beats: [
									{
										...(VALID_PLAN.arcs[0]?.sequences[0]?.beats[0] ?? {}),
										entrySigns: [],
									},
								],
							},
						],
					},
				],
			},
			"plan.arcs[0].sequences[0].beats[0].entrySigns",
			"至少要有一条",
		);
		expectPathError(
			{
				arcs: [
					{
						...VALID_PLAN.arcs[0],
						sequences: [
							{
								...VALID_PLAN.arcs[0]?.sequences[0],
								beats: [
									{
										...(VALID_PLAN.arcs[0]?.sequences[0]?.beats[0] ?? {}),
										fitPoints: [""],
									},
								],
							},
						],
					},
				],
			},
			"plan.arcs[0].sequences[0].beats[0].fitPoints[0]",
			"不能是空字符串",
		);
	});
});

describe("导演计划存储", () => {
	it("玩家整份替换后按原顺序读回，所有行来源为 player", () => {
		const { store } = openTempStore();
		seedStory(store);
		replaceDirectorPlan(store, "s1", VALID_PLAN);

		expect(readDirectorPlan(store, "s1")).toEqual(VALID_PLAN);
		const entries = store.listDirectorPlanEntries("s1");
		expect(entries.arcs.map((arc) => arc.id)).toEqual(["arc-1", "arc-2"]);
		expect(entries.sequences.map((sequence) => sequence.id)).toEqual([
			"seq-1",
			"seq-2",
		]);
		expect([...entries.beats.map((beat) => beat.id)].sort()).toEqual([
			"beat-1",
			"beat-2",
			"beat-3",
		]);
		expect(
			[...entries.arcs, ...entries.sequences, ...entries.beats].every(
				(row) => row.source === "player",
			),
		).toBe(true);
	});

	it("合并只更新或追加，不删除行，也不覆盖 player 行", () => {
		const { store } = openTempStore();
		seedStory(store);
		mergePlannedArcs(store, "s1", VALID_PLAN, "model");
		expect(readDirectorPlan(store, "s1")).toEqual(VALID_PLAN);

		const second = mergePlannedArcs(store, "s1", VALID_PLAN, "model");
		expect(second.inserted).toBe(0);
		expect(second.updated).toBe(7);
		expect(second.skipped).toBe(0);
		expect(readDirectorPlan(store, "s1")).toEqual(VALID_PLAN);

		const edited: DirectorPlan = {
			arcs: [
				{
					...VALID_PLAN.arcs[0],
					title: "玩家改过的标题",
					sequences: [
						{
							...VALID_PLAN.arcs[0]?.sequences[0],
							title: "玩家改过的序列",
							beats: [
								{
									...(VALID_PLAN.arcs[0]?.sequences[0]?.beats[0] ?? {
										id: "",
										goal: "",
										entrySigns: [],
										fitPoints: [],
									}),
									goal: "玩家改过的目标",
								},
							],
						},
					],
				},
			],
		} as DirectorPlan;
		replaceDirectorPlan(store, "s1", edited);

		const proposed: DirectorPlan = {
			arcs: [
				{
					...VALID_PLAN.arcs[0],
					title: "模型改过的标题",
					sequences: [
						{
							...VALID_PLAN.arcs[0]?.sequences[0],
							title: "模型改过的序列",
							beats: [
								{
									...(VALID_PLAN.arcs[0]?.sequences[0]?.beats[0] ?? {
										id: "",
										goal: "",
										entrySigns: [],
										fitPoints: [],
									}),
									goal: "模型改过的目标",
								},
								{
									id: "beat-new",
									goal: "新增拍",
									entrySigns: ["新迹象"],
									fitPoints: ["新契合点"],
								},
							],
						},
						{
							id: "seq-new",
							title: "新增序列",
							beats: [
								{
									id: "beat-new-2",
									goal: "新增目标",
									entrySigns: ["迹象"],
									fitPoints: ["契合点"],
								},
							],
						},
					],
				},
				{
					id: "arc-new",
					title: "新增弧线",
					throughLine: "新的贯穿线",
					difficulty: 0.2,
					redLines: [],
					sequences: [],
				},
			],
		};
		const result = mergePlannedArcs(store, "s1", proposed, "model");
		expect(result.skipped).toBe(3);
		expect(result.inserted).toBe(4);
		expect(result.updated).toBe(0);

		const after = readDirectorPlan(store, "s1");
		expect(after.arcs?.[0]?.title).toBe("玩家改过的标题");
		expect(after.arcs?.[0]?.sequences[0]?.title).toBe("玩家改过的序列");
		expect(after.arcs?.[0]?.sequences[0]?.beats[0]?.goal).toBe(
			"玩家改过的目标",
		);
		expect(after.arcs?.[0]?.sequences[0]?.beats.map((beat) => beat.id)).toEqual(
			["beat-1", "beat-new"],
		);
		expect(after.arcs?.[0]?.sequences.map((sequence) => sequence.id)).toEqual([
			"seq-1",
			"seq-new",
		]);
		expect(after.arcs.map((arc) => arc.id)).toEqual(["arc-1", "arc-new"]);
	});

	it("序列不能改挂到另一条弧线", () => {
		const { store } = openTempStore();
		seedStory(store);
		mergePlannedArcs(store, "s1", VALID_PLAN, "model");
		const moved: DirectorPlan = {
			arcs: [
				{
					id: "arc-2",
					title: "毕业",
					throughLine: "两人必须告别",
					difficulty: 0.8,
					redLines: [],
					sequences: [VALID_PLAN.arcs[0]?.sequences[0] as never],
				},
			],
		};
		expect(() => mergePlannedArcs(store, "s1", moved, "model")).toThrow(
			"不能改挂",
		);
	});
});

describe("resolveCurrentBeat", () => {
	it("无状态取第一拍，完成后前进，跨序列续接，耗尽返回 null", () => {
		const { store } = openTempStore();
		seedStory(store);
		const path = buildPath(store);
		replaceDirectorPlan(store, "s1", VALID_PLAN);

		expect(resolveCurrentBeat(store, "s1", path.u1)?.beat.id).toBe("beat-1");

		store.saveDirectorBeatState({
			nodeId: path.u1,
			storyId: "s1",
			beatId: "beat-1",
			completed: true,
		});
		expect(resolveCurrentBeat(store, "s1", path.a1)?.beat.id).toBe("beat-2");

		store.saveDirectorBeatState({
			nodeId: path.a1,
			storyId: "s1",
			beatId: "beat-2",
			completed: true,
		});
		expect(resolveCurrentBeat(store, "s1", path.u2)?.sequence.id).toBe("seq-2");
		expect(resolveCurrentBeat(store, "s1", path.u2)?.beat.id).toBe("beat-3");

		store.saveDirectorBeatState({
			nodeId: path.u2,
			storyId: "s1",
			beatId: "beat-3",
			completed: true,
		});
		expect(resolveCurrentBeat(store, "s1", path.a2)).toBeNull();
	});

	it("未完成的拍留在原地，另一分支的状态不参与", () => {
		const { store } = openTempStore();
		seedStory(store);
		const path = buildPath(store);
		replaceDirectorPlan(store, "s1", VALID_PLAN);
		const sibling = store.appendNode({
			id: "u-other",
			storyId: "s1",
			parentId: "a0",
			role: "user",
			raw: "另一条分支。",
		});
		store.saveDirectorBeatState({
			nodeId: sibling.id,
			storyId: "s1",
			beatId: "beat-2",
			completed: true,
		});

		expect(resolveCurrentBeat(store, "s1", path.a2)?.beat.id).toBe("beat-1");
		expect(resolveCurrentBeat(store, "s1", sibling.id)?.beat.id).toBe("beat-3");

		store.saveDirectorBeatState({
			nodeId: path.u1,
			storyId: "s1",
			beatId: "beat-1",
			completed: false,
		});
		expect(resolveCurrentBeat(store, "s1", path.a1)?.beat.id).toBe("beat-1");
		expect(
			store
				.listDirectorBeatStatesAlongPath(path.a1)
				.map((state) => state.nodeId),
		).toEqual(["u1"]);
	});

	it("计划为空时返回 null，旧拍状态指向的节拍被删除后跳过", () => {
		const { store } = openTempStore();
		seedStory(store);
		const path = buildPath(store);
		expect(resolveCurrentBeat(store, "s1", path.u1)).toBeNull();

		replaceDirectorPlan(store, "s1", VALID_PLAN);
		store.saveDirectorBeatState({
			nodeId: path.u1,
			storyId: "s1",
			beatId: "beat-1",
			completed: true,
		});
		const trimmed: DirectorPlan = {
			arcs: [
				{
					id: "arc-1",
					title: "开学",
					throughLine: "凛必须说出真相",
					difficulty: 0.4,
					redLines: [],
					sequences: [
						{
							id: "seq-1",
							title: "相遇",
							beats: [VALID_PLAN.arcs[0]?.sequences[0]?.beats[1] as never],
						},
					],
				},
			],
		};
		replaceDirectorPlan(store, "s1", trimmed);
		expect(resolveCurrentBeat(store, "s1", path.a1)?.beat.id).toBe("beat-2");
	});

	it("同一楼层重复写拍状态只保留一行", () => {
		const { store } = openTempStore();
		seedStory(store);
		const path = buildPath(store);
		replaceDirectorPlan(store, "s1", VALID_PLAN);
		store.saveDirectorBeatState({
			nodeId: path.u1,
			storyId: "s1",
			beatId: "beat-1",
			completed: false,
		});
		store.saveDirectorBeatState({
			nodeId: path.u1,
			storyId: "s1",
			beatId: "beat-1",
			completed: true,
		});
		const state = store.getDirectorBeatState(path.u1);
		expect(state?.completed).toBe(true);
		expect(() =>
			store.saveDirectorBeatState({
				nodeId: path.u1,
				storyId: "s1",
				beatId: "beat-missing",
				completed: true,
			}),
		).toThrow("节拍不存在");
	});
});

describe("runDirectorCli", () => {
	it("--set 用玩家身份整份替换，--json 输出计划", async () => {
		const { store, path } = openTempStore();
		seedStory(store);
		const dir = dirname(path);
		const setPath = join(dir, "plan.json");
		writeFileSync(setPath, JSON.stringify(VALID_PLAN), "utf8");
		const lines: string[] = [];
		const result = await runDirectorCli(
			[
				"director",
				"plan",
				"--story",
				"s1",
				`--db=${path}`,
				"--set",
				setPath,
				"--json",
			],
			{ log: (message) => lines.push(message) },
		);
		expect(result.action).toBe("set");
		expect(result.plan).toEqual(VALID_PLAN);
		expect(JSON.parse(lines[lines.length - 1] as string)).toEqual(VALID_PLAN);
		expect(
			store
				.listDirectorPlanEntries("s1")
				.arcs.every((arc) => arc.source === "player"),
		).toBe(true);
	});

	it("列表只读，缺参数与不认识的参数都报错", async () => {
		const { store, path } = openTempStore();
		seedStory(store);
		replaceDirectorPlan(store, "s1", VALID_PLAN);
		const before = store.listDirectorPlanEntries("s1");
		const lines: string[] = [];
		const result = await runDirectorCli(
			["director", "plan", "--story", "s1", "--db", path],
			{ log: (message) => lines.push(message) },
		);
		expect(result.action).toBe("list");
		expect(lines.join("\n")).toContain("弧线 arc-1《开学》");
		expect(lines.join("\n")).toContain("beat-3：逼出真相");
		expect(store.listDirectorPlanEntries("s1")).toEqual(before);

		await expect(
			runDirectorCli(["director", "plan", "--db", path], { log: () => {} }),
		).rejects.toThrow("--story");
		await expect(
			runDirectorCli(
				["director", "plan", "--story", "s1", "--db", path, "--yaml"],
				{
					log: () => {},
				},
			),
		).rejects.toThrow("不认识的参数 --yaml");
	});

	it("计划文件不合法时指出路径", async () => {
		const { store, path } = openTempStore();
		seedStory(store);
		const dir = mkdtempSync(join(import.meta.dirname, ".tmp-plan-cli-"));
		onTestFinished(() => {
			rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
		});
		const setPath = join(dir, "bad.json");
		writeFileSync(setPath, JSON.stringify({ arcs: [{ id: "a" }] }), "utf8");
		await expect(
			runDirectorCli(
				["director", "plan", "--story", "s1", "--db", path, "--set", setPath],
				{ log: () => {} },
			),
		).rejects.toThrow("plan.arcs[0].title");
	});
});
