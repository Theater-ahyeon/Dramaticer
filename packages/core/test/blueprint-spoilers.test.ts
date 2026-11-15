import { describe, expect, it } from "vitest";
import {
	BLUEPRINT_SPOILER_MODE_LABELS,
	type BlueprintMilestone,
	type BlueprintPremise,
	type BlueprintVolume,
	type StoryStore,
	readBlueprintView,
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
		raw: "钟楼里只有风。",
	});
}

describe("蓝图剧透视图", () => {
	const premise = makePremise();
	const aiVolume = makeVolume({
		id: "volume-ai",
		source: "ai",
		title: "AI 补的第二卷",
	});
	const aiMilestone = makeMilestone({
		id: "milestone-ai",
		source: "ai",
		volumeId: "volume-ai",
		want: "AI 补的关键转身",
	});
	const playerMilestone = makeMilestone({
		id: "milestone-1",
		after: ["milestone-ai"],
		volumeId: "volume-ai",
	});
	const entries = [premise, aiVolume, aiMilestone, playerMilestone];

	it("显示档位返回全部条目，没有隐藏计数", () => {
		const view = readBlueprintView(entries, "show");
		expect(view.entries).toEqual(entries);
		expect(view.hidden).toBeNull();
	});

	it("隐藏档位只留玩家条目，AI 条目按层计数", () => {
		const view = readBlueprintView(entries, "hide");
		expect(view.entries).toEqual([premise, playerMilestone]);
		expect(view.hidden).toEqual({
			premise: 0,
			volume: 1,
			milestone: 1,
			total: 2,
		});
		expect(JSON.stringify(view)).not.toContain("AI 补的关键转身");
		expect(JSON.stringify(view)).not.toContain("AI 补的第二卷");
	});

	it("没有 AI 条目时隐藏档位与显示档位一致", () => {
		const view = readBlueprintView([premise, makeVolume()], "hide");
		expect(view.entries).toEqual([premise, makeVolume()]);
		expect(view.hidden).toBeNull();
	});

	it("默认档位是显示", () => {
		expect(readBlueprintView(entries).entries).toEqual(entries);
		expect(BLUEPRINT_SPOILER_MODE_LABELS.hide).toBe("隐藏");
	});

	it("非法档位抛错并指出字段", () => {
		expect(() => readBlueprintView(entries, "partial" as "show")).toThrow(
			'剧透设置只能是 show、hide，收到 "partial"',
		);
	});
});

describe("卡导入的默认蓝图", () => {
	it("默认蓝图沿路径对所有楼层生效，楼层修改累加在它之上", () => {
		const { store } = openTempStore();
		seedPath(store);
		store.saveStoryBlueprintBaseline("s1", [makePremise(), makeVolume()]);
		expect(store.readBlueprintEntries("n0")).toEqual([
			makePremise(),
			makeVolume(),
		]);
		store.saveStoryBlueprint({
			nodeId: "n1",
			storyId: "s1",
			source: "player",
			diffs: [
				{
					action: "set",
					entry: makeMilestone({ id: "milestone-1" }),
				},
			],
		});
		expect(store.readBlueprintEntries("n1").map((entry) => entry.id)).toEqual([
			"milestone-1",
			"premise",
			"volume-1",
		]);
		expect(store.readBlueprintEntries("n0")).toHaveLength(2);
		expect(store.listBlueprintVersions("n2")[0]?.entries).toHaveLength(3);
	});

	it("默认蓝图是故事级的，两条分支都从它开始", () => {
		const { store } = openTempStore();
		seedPath(store);
		store.appendNode({
			id: "branch-2",
			storyId: "s1",
			parentId: "n0",
			role: "assistant",
			raw: "另一条分支。",
		});
		store.saveStoryBlueprintBaseline("s1", [makePremise()]);
		store.saveStoryBlueprint({
			nodeId: "n2",
			storyId: "s1",
			source: "player",
			diffs: [{ action: "set", entry: makeVolume() }],
		});
		expect(store.readBlueprintEntries("n2")).toHaveLength(2);
		expect(store.readBlueprintEntries("branch-2").map((e) => e.id)).toEqual([
			"premise",
		]);
	});

	it("再次导入整批替换默认蓝图，空条目清掉它", () => {
		const { store } = openTempStore();
		seedPath(store);
		store.saveStoryBlueprintBaseline("s1", [makePremise(), makeVolume()]);
		expect(
			store.saveStoryBlueprintBaseline("s1", [makePremise({ tone: "热烈" })]),
		).toEqual([makePremise({ tone: "热烈" })]);
		expect(store.readBlueprintEntries("n2")).toEqual([
			makePremise({ tone: "热烈" }),
		]);
		expect(store.saveStoryBlueprintBaseline("s1", [])).toEqual([]);
		expect(store.readBlueprintEntries("n2")).toEqual([]);
	});

	it("默认蓝图里的锁定条目不接受 AI 修改", () => {
		const { store } = openTempStore();
		seedPath(store);
		store.saveStoryBlueprintBaseline("s1", [
			makePremise({ locked: true }),
			makeVolume(),
		]);
		expect(() =>
			store.saveStoryBlueprint({
				nodeId: "n2",
				storyId: "s1",
				source: "ai",
				diffs: [
					{
						action: "set",
						entry: makePremise({ locked: true, tone: "热烈" }),
					},
				],
			}),
		).toThrow("蓝图修改来自 AI，不能改动锁定的总纲：premise");
	});

	it("非法条目整批拒绝并指出路径，故事不存在时抛错", () => {
		const { store } = openTempStore();
		seedPath(store);
		expect(() =>
			store.saveStoryBlueprintBaseline("s1", [
				makeMilestone({ volumeId: "volume-missing" }),
			]),
		).toThrow("默认蓝图 的里程碑 milestone-1 指向的卷 volume-missing 不存在");
		expect(store.readStoryBlueprintBaseline("s1")).toEqual([]);
		expect(() => store.saveStoryBlueprintBaseline("missing", [])).toThrow(
			"故事不存在：missing",
		);
	});
});

describe("故事设置的剧透档位", () => {
	it("默认显示，更新后持久化", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试故事" });
		expect(store.getStorySettings("s1").blueprintSpoilers).toBe("show");
		const settings = store.updateStorySettings("s1", {
			blueprintSpoilers: "hide",
		});
		expect(settings.blueprintSpoilers).toBe("hide");
		expect(store.getStorySettings("s1").blueprintSpoilers).toBe("hide");
		expect(
			store.updateStorySettings("s1", { blueprintSpoilers: "show" })
				.blueprintSpoilers,
		).toBe("show");
	});

	it("非法取值抛错并指出字段", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试故事" });
		expect(() =>
			store.updateStorySettings("s1", {
				blueprintSpoilers: "peek" as "hide",
			}),
		).toThrow('故事设置的 blueprintSpoilers只能是 show、hide，收到 "peek"');
	});
});
