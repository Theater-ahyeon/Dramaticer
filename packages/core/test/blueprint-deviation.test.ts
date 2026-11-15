import { describe, expect, it } from "vitest";
import {
	type BlueprintEntry,
	type BlueprintMilestone,
	type BlueprintPremise,
	type BlueprintVolume,
	type DirectorLine,
	type DirectorLineState,
	MILESTONE_DEVIATION_OPTIONS,
	type StoryStore,
	checkMilestoneDeviation,
	milestonePromiseLine,
	milestonePromiseLineId,
	readMilestoneDeviation,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const PREMISE: BlueprintPremise = {
	id: "premise",
	kind: "premise",
	source: "player",
	locked: false,
	coreQuestion: "卫宫能不能在仪式开始前找到妹妹",
	tone: "阴冷",
	endings: ["救回妹妹"],
	redLines: ["不写虐待儿童"],
	tension: "medium",
};

const VOLUME: BlueprintVolume = {
	id: "vol1",
	kind: "volume",
	source: "player",
	locked: false,
	title: "第一卷 钟楼",
	coreQuestion: "谁在钟楼里等她",
	startState: "",
	endState: "",
};

function milestone(
	id: string,
	prerequisites: readonly string[],
): BlueprintMilestone {
	return {
		id,
		kind: "milestone",
		source: "player",
		locked: false,
		volumeId: "vol1",
		want: `${id} 的目标`,
		prerequisites,
		after: [],
		hardness: "soft",
	};
}

function state(
	line: DirectorLine,
	lastTouchedDepth: number,
): DirectorLineState {
	return { line, openedDepth: 1, lastTouchedDepth };
}

const INPUT = { retiredLineIds: [], floorDepth: 10, clueAgeWarning: 4 };

function seedStory(store: StoryStore): void {
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
}

describe("里程碑四态检查", () => {
	it("前提条件都写过并关闭时是已达成，不带选择", () => {
		const entry = milestone("m1", ["拿到通行证", "认识守卫"]);
		const entries: BlueprintEntry[] = [PREMISE, VOLUME, entry];
		const lineIds = [
			milestonePromiseLineId("m1", "拿到通行证"),
			milestonePromiseLineId("m1", "认识守卫"),
		];
		const deviations = checkMilestoneDeviation(entries, [], lineIds, INPUT);
		expect(deviations).toEqual([
			{
				milestoneId: "m1",
				state: "achieved",
				reason: "2 条前提条件都写进过伏笔账并且都已关闭",
				options: [],
			},
		]);
	});

	it("还有前提条件没有写进伏笔账时是仍可达", () => {
		const entry = milestone("m1", ["拿到通行证", "认识守卫"]);
		const deviations = checkMilestoneDeviation(
			[PREMISE, VOLUME, entry],
			[],
			[],
			INPUT,
		);
		expect(deviations[0]?.state).toBe("reachable");
		expect(deviations[0]?.reason).toBe("还有 2 条前提条件没有写进伏笔账");
		expect(deviations[0]?.options).toEqual([]);
	});

	it("还开着的铺垫达到警告线时是受阻，返回三个选择", () => {
		const entry = milestone("m1", ["拿到通行证"]);
		const line = milestonePromiseLine(entry, 0);
		const deviations = checkMilestoneDeviation(
			[PREMISE, VOLUME, entry],
			[state(line, 6)],
			[line.id],
			INPUT,
		);
		expect(deviations[0]?.state).toBe("blocked");
		expect(deviations[0]?.reason).toBe(
			`铺垫线 ${line.id} 已经至少 4 楼没有被触及`,
		);
		expect(deviations[0]?.options).toEqual([...MILESTONE_DEVIATION_OPTIONS]);
	});

	it("铺垫刚被推进过时仍然是仍可达", () => {
		const entry = milestone("m1", ["拿到通行证"]);
		const line = milestonePromiseLine(entry, 0);
		const deviations = checkMilestoneDeviation(
			[PREMISE, VOLUME, entry],
			[state(line, 8)],
			[line.id],
			INPUT,
		);
		expect(deviations[0]?.state).toBe("reachable");
		expect(deviations[0]?.reason).toBe("铺垫还开着，最近有推进");
	});

	it("章末清点作废了铺垫时是已不可能，即使前提条件都已关闭", () => {
		const entry = milestone("m1", ["拿到通行证"]);
		const line = milestonePromiseLine(entry, 0);
		const deviations = checkMilestoneDeviation(
			[PREMISE, VOLUME, entry],
			[],
			[line.id],
			{ ...INPUT, retiredLineIds: [line.id] },
		);
		expect(deviations[0]?.state).toBe("lost");
		expect(deviations[0]?.reason).toBe(`铺垫线 ${line.id} 在章末清点里被作废`);
		expect(deviations[0]?.options).toEqual([...MILESTONE_DEVIATION_OPTIONS]);
	});

	it("没有前提条件的里程碑按仍可达处理，不生成选择", () => {
		const entry = milestone("m0", []);
		const deviations = checkMilestoneDeviation(
			[PREMISE, VOLUME, entry],
			[],
			[],
			INPUT,
		);
		expect(deviations[0]?.state).toBe("reachable");
		expect(deviations[0]?.reason).toBe(
			"这个里程碑没有前提条件，无法由伏笔账判断进展",
		);
		expect(deviations[0]?.options).toEqual([]);
	});

	it("拒绝非法阈值", () => {
		const entry = milestone("m1", ["拿到通行证"]);
		expect(() =>
			checkMilestoneDeviation([PREMISE, VOLUME, entry], [], [], {
				...INPUT,
				floorDepth: -1,
			}),
		).toThrow("偏离检查的 floorDepth 必须是非负整数");
		expect(() =>
			checkMilestoneDeviation([PREMISE, VOLUME, entry], [], [], {
				...INPUT,
				clueAgeWarning: 1.5,
			}),
		).toThrow("偏离检查的 clueAgeWarning 必须是非负整数");
	});
});

describe("章末读取偏离", () => {
	it("从章末清点读出作废的铺垫，并保持蓝图不变", () => {
		const { store } = openTempStore();
		seedStory(store);
		const entry = milestone("m1", ["拿到通行证"]);
		store.saveStoryBlueprint({
			nodeId: "n0",
			storyId: "s1",
			source: "player",
			diffs: [
				{ action: "set", entry: PREMISE },
				{ action: "set", entry: VOLUME },
				{ action: "set", entry: entry },
			],
		});
		const promise = milestonePromiseLine(entry, 0);
		const mainOne: DirectorLine = {
			id: "main-1",
			kind: "main",
			who: "卫宫",
			want: "阻止仪式",
			obstacle: "时间只剩一夜",
			countdown: null,
			preparations: [],
		};
		const mainTwo: DirectorLine = {
			id: "main-2",
			kind: "main",
			who: "妹妹",
			want: "离开钟楼",
			obstacle: "门在外面锁着",
			countdown: null,
			preparations: [],
		};
		store.saveDirectorLines({
			nodeId: "n0",
			storyId: "s1",
			diffs: [
				{ action: "set", line: mainOne },
				{ action: "set", line: mainTwo },
				{ action: "set", line: promise },
			],
		});
		store.saveDirectorChapterReview({
			nodeId: "n0",
			storyId: "s1",
			payload: {
				promises: [{ lineId: promise.id, disposition: "retire" }],
				focus: [mainOne.id, mainTwo.id],
			},
		});
		const before = store.readBlueprintEntries("n2");
		const deviations = readMilestoneDeviation(store, "s1", "n2");
		expect(deviations).toEqual([
			{
				milestoneId: "m1",
				state: "lost",
				reason: `铺垫线 ${promise.id} 在章末清点里被作废`,
				options: [...MILESTONE_DEVIATION_OPTIONS],
			},
		]);
		expect(store.readBlueprintEntries("n2")).toEqual(before);
	});

	it("没有楼层的故事没有可读的偏离", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "空故事" });
		expect(() => readMilestoneDeviation(store, "s1", "nope")).toThrow(
			"楼层节点不存在：nope",
		);
	});
});
