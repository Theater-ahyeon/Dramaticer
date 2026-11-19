import { describe, expect, it } from "vitest";
import {
	BLUEPRINT_ENTRY_KIND_LABELS,
	type BlueprintMilestone,
	type BlueprintPremise,
	type BlueprintVolume,
	type StoryStore,
	applyBlueprintDiffs,
	assertBlueprintEntries,
	planBlueprintRollback,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

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

function seedPath(store: StoryStore): void {
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
		raw: "我走进钟楼。",
	});
	store.appendNode({
		id: "n2",
		storyId: "s1",
		parentId: "n1",
		role: "assistant",
		raw: "钟楼里只有灰尘。",
	});
	store.appendNode({
		id: "n3",
		storyId: "s1",
		parentId: "n2",
		role: "user",
		raw: "我上楼顶。",
	});
	store.appendNode({
		id: "n4",
		storyId: "s1",
		parentId: "n3",
		role: "assistant",
		raw: "楼顶有一把旧锁。",
	});
	store.appendNode({
		id: "n5",
		storyId: "s1",
		parentId: "n4",
		role: "user",
		raw: "我把锁收进包里。",
	});
	store.appendNode({
		id: "branch",
		storyId: "s1",
		parentId: "n0",
		role: "user",
		raw: "我留在城里。",
	});
	store.appendNode({
		id: "branch-2",
		storyId: "s1",
		parentId: "branch",
		role: "assistant",
		raw: "城里下起了雨。",
	});
}

describe("蓝图结构", () => {
	it("三层结构都有中文标签", () => {
		expect(BLUEPRINT_ENTRY_KIND_LABELS).toEqual({
			premise: "总纲",
			volume: "卷",
			milestone: "里程碑",
		});
	});

	it("总纲的拉力缺省按弱档补齐，非法档位拒绝", () => {
		const legacy: Record<string, unknown> = { ...makePremise() };
		legacy.tension = undefined;
		const parsed = assertBlueprintEntries([legacy]);
		expect((parsed[0] as BlueprintPremise).tension).toBe("loose");
		expect(() =>
			assertBlueprintEntries([{ ...makePremise(), tension: "stormy" }]),
		).toThrow("蓝图条目[0].tension 只能是 loose、medium、tight");
		expect(
			(
				assertBlueprintEntries([makePremise({ tension: "tight" })])[0] as
					| BlueprintPremise
					| undefined
			)?.tension,
		).toBe("tight");
	});

	it("校验整套蓝图：总纲唯一、里程碑指向存在的卷、先后约束不成环", () => {
		expect(
			assertBlueprintEntries([
				makePremise(),
				makeVolume(),
				makeMilestone({ after: [] }),
			]).map((entry) => entry.id),
		).toEqual(["premise", "volume-1", "milestone-1"]);

		expect(() =>
			assertBlueprintEntries([makePremise(), makePremise({ id: "premise-2" })]),
		).toThrow("总纲最多一条");

		expect(() =>
			assertBlueprintEntries([makePremise(), makeMilestone()]),
		).toThrow("指向的卷 volume-1 不存在");

		expect(() =>
			assertBlueprintEntries([
				makePremise(),
				makeVolume(),
				makeMilestone(),
				makeMilestone({ id: "milestone-2", after: ["milestone-1"] }),
			]),
		).not.toThrow();

		expect(() =>
			assertBlueprintEntries([
				makePremise(),
				makeVolume(),
				makeMilestone({ after: ["milestone-2"] }),
				makeMilestone({ id: "milestone-2", after: ["milestone-1"] }),
			]),
		).toThrow("先后约束成环");

		expect(() =>
			assertBlueprintEntries([
				makePremise(),
				makeVolume(),
				makeMilestone({ after: ["milestone-1"] }),
			]),
		).toThrow("不能把自己列为先后约束");

		expect(() =>
			assertBlueprintEntries([
				makePremise(),
				makeVolume(),
				makeMilestone({ after: ["nope"] }),
			]),
		).toThrow("先后约束 nope 不存在");
	});

	it("未知字段、重复 id 与非法硬性程度都拒绝", () => {
		expect(() =>
			assertBlueprintEntries([
				{ ...makePremise(), authorNote: "多余" },
				makeVolume(),
			]),
		).toThrow();
		expect(() =>
			assertBlueprintEntries([makeVolume(), makeVolume({ title: "重复" })]),
		).toThrow("id 重复：volume-1");
		expect(() =>
			assertBlueprintEntries([
				makePremise(),
				makeVolume(),
				makeMilestone({ hardness: "medium" as "hard" }),
			]),
		).toThrow("hardness 只能是 hard、soft");
	});

	it("删除卷时同一批修改里必须处理掉它的里程碑", () => {
		const entries = [makePremise(), makeVolume(), makeMilestone()];
		const remaining = applyBlueprintDiffs(entries, [
			{ action: "delete", id: "milestone-1" },
			{ action: "delete", id: "volume-1" },
		]);
		expect(remaining.map((entry) => entry.id)).toEqual(["premise"]);
		expect(() =>
			applyBlueprintDiffs(entries, [{ action: "delete", id: "volume-1" }]),
		).toThrow("指向的卷 volume-1 不存在");
	});

	it("回滚计划：多出来的条目删除、内容不同的条目重写、相同时为空", () => {
		const base = [makePremise(), makeVolume()];
		const changed = [
			makePremise({ tone: "温暖" }),
			makeVolume(),
			makeMilestone(),
		];
		expect(planBlueprintRollback(changed, base)).toEqual([
			{ action: "delete", id: "milestone-1" },
			{ action: "set", entry: makePremise() },
		]);
		expect(planBlueprintRollback(base, base)).toEqual([]);
	});
});

describe("蓝图存储与版本", () => {
	it("沿路径累加修改，其他分支不参与", () => {
		const { store } = openTempStore();
		seedPath(store);

		store.saveStoryBlueprint({
			nodeId: "n0",
			storyId: "s1",
			source: "player",
			diffs: [
				{ action: "set", entry: makePremise() },
				{ action: "set", entry: makeVolume() },
			],
		});
		store.saveStoryBlueprint({
			nodeId: "n2",
			storyId: "s1",
			source: "player",
			diffs: [
				{ action: "set", entry: makeMilestone() },
				{
					action: "set",
					entry: makeMilestone({
						id: "milestone-2",
						want: "让管家说出实话",
						after: ["milestone-1"],
						hardness: "hard",
					}),
				},
			],
		});
		store.saveStoryBlueprint({
			nodeId: "n4",
			storyId: "s1",
			source: "ai",
			diffs: [
				{
					action: "set",
					entry: makeMilestone({ want: "找到钟楼里那把旧锁" }),
				},
			],
		});

		const here = store.readBlueprintEntries("n4");
		expect(here.map((entry) => entry.id)).toEqual([
			"milestone-1",
			"milestone-2",
			"premise",
			"volume-1",
		]);
		expect(here.find((entry) => entry.id === "milestone-1")).toMatchObject({
			want: "找到钟楼里那把旧锁",
			source: "player",
			after: [],
		});

		const other = store.readBlueprintEntries("branch-2");
		expect(other.map((entry) => entry.id)).toEqual(["premise", "volume-1"]);

		const appended = store.saveStoryBlueprint({
			nodeId: "n0",
			storyId: "s1",
			source: "player",
			diffs: [{ action: "set", entry: makeVolume({ title: "重写" }) }],
		});
		expect(appended.seq).toBe(2);
		expect(
			store.listStoryBlueprintRecords("n0").map((record) => record.seq),
		).toEqual([1, 2]);
		expect(
			store.readBlueprintEntries("n0").find((entry) => entry.id === "volume-1"),
		).toMatchObject({ title: "重写" });
		expect(() =>
			store.saveStoryBlueprint({
				nodeId: "n4",
				storyId: "s2",
				source: "player",
				diffs: [{ action: "set", entry: makeVolume() }],
			}),
		).toThrow("蓝图修改的 storyId 与楼层所属故事不一致：s2");
		expect(() =>
			store.saveStoryBlueprint({
				nodeId: "n4",
				storyId: "s1",
				source: "player",
				diffs: [],
			}),
		).toThrow("至少要有一条");
	});

	it("锁定的条目拒绝 AI 覆盖，玩家可以解锁与改写", () => {
		const { store } = openTempStore();
		seedPath(store);

		store.saveStoryBlueprint({
			nodeId: "n0",
			storyId: "s1",
			source: "player",
			diffs: [
				{ action: "set", entry: makePremise({ locked: true }) },
				{ action: "set", entry: makeVolume() },
			],
		});

		expect(() =>
			store.saveStoryBlueprint({
				nodeId: "n2",
				storyId: "s1",
				source: "ai",
				diffs: [{ action: "set", entry: makePremise({ tone: "热烈" }) }],
			}),
		).toThrow("不能改动锁定的总纲：premise");
		expect(store.readBlueprintEntries("n2")).toHaveLength(2);

		expect(() =>
			store.saveStoryBlueprint({
				nodeId: "n2",
				storyId: "s1",
				source: "ai",
				diffs: [{ action: "delete", id: "premise" }],
			}),
		).toThrow("不能改动锁定的总纲：premise");

		expect(() =>
			store.saveStoryBlueprint({
				nodeId: "n2",
				storyId: "s1",
				source: "ai",
				diffs: [{ action: "set", entry: makePremise({ locked: false }) }],
			}),
		).toThrow("不能改动锁定的总纲：premise");

		store.saveStoryBlueprint({
			nodeId: "n2",
			storyId: "s1",
			source: "ai",
			diffs: [
				{ action: "set", entry: makeVolume({ endState: "卫宫拿回了信" }) },
				{ action: "set", entry: makeMilestone() },
			],
		});
		expect(
			store.readBlueprintEntries("n2").find((entry) => entry.id === "volume-1"),
		).toMatchObject({ endState: "卫宫拿回了信" });

		store.saveStoryBlueprint({
			nodeId: "n4",
			storyId: "s1",
			source: "player",
			diffs: [
				{
					action: "set",
					entry: makePremise({ tone: "阴冷但有暖意", locked: false }),
				},
			],
		});
		expect(
			store.readBlueprintEntries("n4").find((entry) => entry.id === "premise"),
		).toMatchObject({ tone: "阴冷但有暖意", locked: false });
	});

	it("每一版都能回看，回滚写成新记录并保留来源", () => {
		const { store } = openTempStore();
		seedPath(store);

		store.saveStoryBlueprint({
			nodeId: "n0",
			storyId: "s1",
			source: "player",
			diffs: [
				{ action: "set", entry: makePremise() },
				{ action: "set", entry: makeVolume() },
			],
			createdAt: "2026-11-14T00:00:00.000Z",
		});
		store.saveStoryBlueprint({
			nodeId: "n2",
			storyId: "s1",
			source: "ai",
			diffs: [{ action: "set", entry: makeMilestone() }],
			createdAt: "2026-11-14T00:01:00.000Z",
		});
		store.saveStoryBlueprint({
			nodeId: "n4",
			storyId: "s1",
			source: "player",
			diffs: [
				{ action: "set", entry: makeMilestone({ want: "找到楼顶的旧锁" }) },
			],
			createdAt: "2026-11-14T00:02:00.000Z",
		});

		const versions = store.listBlueprintVersions("n4");
		expect(
			versions.map((version) => [version.nodeId, version.entries.length]),
		).toEqual([
			["n0", 2],
			["n2", 3],
			["n4", 3],
		]);
		expect(versions.map((version) => version.source)).toEqual([
			"player",
			"ai",
			"player",
		]);
		expect(versions[1]?.diffs).toEqual([
			{ action: "set", entry: makeMilestone() },
		]);
		expect(
			versions[2]?.entries.find((entry) => entry.id === "milestone-1"),
		).toMatchObject({ want: "找到楼顶的旧锁" });

		const rollback = store.rollbackStoryBlueprint({
			nodeId: "n5",
			storyId: "s1",
			versionNodeId: "n2",
			createdAt: "2026-11-14T00:03:00.000Z",
		});
		expect(rollback.source).toBe("player");
		expect(rollback.diffs).toEqual([{ action: "set", entry: makeMilestone() }]);
		expect(store.readBlueprintEntries("n5")).toEqual(
			store.readBlueprintEntries("n2"),
		);
		expect(store.listBlueprintVersions("n5")).toHaveLength(4);

		store.saveStoryBlueprint({
			nodeId: "branch",
			storyId: "s1",
			source: "player",
			diffs: [{ action: "set", entry: makeMilestone() }],
		});
		const shorter = store.rollbackStoryBlueprint({
			nodeId: "branch-2",
			storyId: "s1",
			versionNodeId: "n0",
		});
		expect(shorter.diffs).toEqual([{ action: "delete", id: "milestone-1" }]);
		expect(store.readBlueprintEntries("branch-2")).toEqual(
			store.readBlueprintEntries("n0"),
		);

		expect(() =>
			store.rollbackStoryBlueprint({
				nodeId: "branch-2",
				storyId: "s1",
				versionNodeId: "n0",
			}),
		).toThrow("已经是这一版");
		expect(() =>
			store.rollbackStoryBlueprint({
				nodeId: "n5",
				storyId: "s1",
				versionNodeId: "n1",
			}),
		).toThrow("没有蓝图修改记录");
	});

	it("同一楼层可以有多批修改，回滚能定位到其中一批", () => {
		const { store } = openTempStore();
		seedPath(store);

		store.saveStoryBlueprint({
			nodeId: "n4",
			storyId: "s1",
			source: "player",
			diffs: [
				{ action: "set", entry: makePremise() },
				{ action: "set", entry: makeVolume() },
			],
		});
		store.saveStoryBlueprint({
			nodeId: "n4",
			storyId: "s1",
			source: "player",
			diffs: [{ action: "set", entry: makeMilestone() }],
		});
		store.saveStoryBlueprint({
			nodeId: "n4",
			storyId: "s1",
			source: "player",
			diffs: [
				{ action: "set", entry: makeMilestone({ want: "找到楼顶的旧锁" }) },
			],
		});

		const versions = store.listBlueprintVersions("n4");
		expect(versions.map((version) => [version.nodeId, version.seq])).toEqual([
			["n4", 1],
			["n4", 2],
			["n4", 3],
		]);
		expect(versions.map((version) => version.entries.length)).toEqual([
			2, 3, 3,
		]);
		expect(
			versions[2]?.entries.find((entry) => entry.id === "milestone-1"),
		).toMatchObject({ want: "找到楼顶的旧锁" });

		const rollback = store.rollbackStoryBlueprint({
			nodeId: "n5",
			storyId: "s1",
			versionNodeId: "n4",
			versionSeq: 2,
		});
		expect(rollback.diffs).toEqual([{ action: "set", entry: makeMilestone() }]);
		expect(store.readBlueprintEntries("n5")).toEqual(versions[1]?.entries);

		expect(() =>
			store.rollbackStoryBlueprint({
				nodeId: "n5",
				storyId: "s1",
				versionNodeId: "n4",
				versionSeq: 9,
			}),
		).toThrow("没有第 9 批蓝图修改记录");
		expect(() =>
			store.rollbackStoryBlueprint({
				nodeId: "n5",
				storyId: "s1",
				versionNodeId: "n4",
				versionSeq: 0,
			}),
		).toThrow("批次序号必须是正整数");
	});
});
