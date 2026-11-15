import { describe, expect, it } from "vitest";
import {
	type BlueprintEntry,
	type BlueprintMilestone,
	type BlueprintVolume,
	type DirectorLine,
	type DirectorLineState,
	milestonePromiseLine,
	milestonePromiseLineId,
	orderMilestonesForPlanning,
	planMilestonePromiseDiffs,
	readActiveMilestone,
	readMilestoneProgress,
} from "../src/index.js";

const VOLUME: BlueprintVolume = {
	id: "vol1",
	kind: "volume",
	source: "player",
	locked: false,
	title: "第一卷",
	coreQuestion: "能不能进城",
	startState: "",
	endState: "",
};

function milestone(
	id: string,
	prerequisites: readonly string[],
	after: readonly string[] = [],
): BlueprintMilestone {
	return {
		id,
		kind: "milestone",
		source: "player",
		locked: false,
		volumeId: "vol1",
		want: `${id} 的目标`,
		prerequisites,
		after,
		hardness: "soft",
	};
}

function state(line: DirectorLine): DirectorLineState {
	return { line, openedDepth: 1, lastTouchedDepth: 1 };
}

describe("里程碑铺垫", () => {
	it("前提条件生成稳定的 promise 线，线 id 由里程碑与条件文本决定", () => {
		const entry = milestone("m1", ["拿到通行证", "认识守卫"]);
		const progress = readMilestoneProgress([VOLUME, entry], [], []);
		expect(progress).toHaveLength(1);
		expect(progress[0]?.lineIds).toEqual([
			milestonePromiseLineId("m1", "拿到通行证"),
			milestonePromiseLineId("m1", "认识守卫"),
		]);
		expect(progress[0]?.missingLineIds).toEqual(progress[0]?.lineIds);
		expect(progress[0]?.reached).toBe(false);

		const diffs = planMilestonePromiseDiffs(progress[0] ?? null);
		expect(diffs).toHaveLength(2);
		expect(diffs[0]).toEqual({
			action: "set",
			line: milestonePromiseLine(entry, 0),
		});
		const firstDiff = diffs[0];
		if (firstDiff?.action !== "set") {
			throw new Error("第一条铺垫修改必须是 set");
		}
		expect(firstDiff.line.kind).toBe("promise");
		expect(firstDiff.line.want).toBe("拿到通行证");
		expect(milestonePromiseLineId("m1", "拿到通行证")).toBe(
			milestonePromiseLineId("m1", "拿到通行证"),
		);
		expect(
			milestonePromiseLineId("m1", "拿到通行证").length,
		).toBeLessThanOrEqual(64);
	});

	it("写过并关闭的前提条件不再补写，全部关闭时里程碑算已达成", () => {
		const entry = milestone("m1", ["拿到通行证", "认识守卫"]);
		const first = milestonePromiseLine(entry, 0);
		const second = milestonePromiseLine(entry, 1);
		const oneClosed = readMilestoneProgress(
			[VOLUME, entry],
			[state(second)],
			[first.id, second.id],
		);
		expect(oneClosed[0]?.missingLineIds).toEqual([]);
		expect(oneClosed[0]?.openLineIds).toEqual([second.id]);
		expect(oneClosed[0]?.reached).toBe(false);

		const allClosed = readMilestoneProgress(
			[VOLUME, entry],
			[],
			[first.id, second.id],
		);
		expect(allClosed[0]?.reached).toBe(true);
		expect(planMilestonePromiseDiffs(allClosed[0] ?? null)).toEqual([]);
	});

	it("删除的里程碑不再生成线，没有前提条件的里程碑保持为最近方向", () => {
		const deleted = readMilestoneProgress([VOLUME], [], []);
		expect(deleted).toEqual([]);
		expect(readActiveMilestone([VOLUME], [], [])).toBeNull();

		const empty = milestone("m0", []);
		const progress = readMilestoneProgress([VOLUME, empty], [], []);
		expect(progress[0]?.reached).toBe(false);
		expect(progress[0]?.missingLineIds).toEqual([]);
		expect(planMilestonePromiseDiffs(progress[0] ?? null)).toEqual([]);
		expect(readActiveMilestone([VOLUME, empty], [], [])?.milestone.id).toBe(
			"m0",
		);
	});

	it("最近一个未达成里程碑按 after 排序，已达成的不再挡在前面", () => {
		const first = milestone("m1", ["拿到通行证"]);
		const second = milestone("m2", ["认识守卫"], ["m1"]);
		const third = milestone("m3", ["集结队伍"], ["m2"]);
		const entries: BlueprintEntry[] = [VOLUME, third, second, first];
		expect(
			orderMilestonesForPlanning([third, second, first]).map(
				(entry) => entry.id,
			),
		).toEqual(["m1", "m2", "m3"]);

		const firstLine = milestonePromiseLine(first, 0);
		const progress = readMilestoneProgress(entries, [], [firstLine.id]);
		expect(progress.map((item) => item.milestone.id)).toEqual([
			"m1",
			"m2",
			"m3",
		]);
		expect(progress[0]?.reached).toBe(true);
		expect(readActiveMilestone(entries, [], [firstLine.id])?.milestone.id).toBe(
			"m2",
		);
	});
});
