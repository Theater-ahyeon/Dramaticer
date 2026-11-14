import type { StorySerialView } from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import {
	SERIAL_TABS,
	buildCharacterDiffs,
	defaultMemoryDescription,
	formatChapterTitle,
} from "../src/chat/serial-view";

function character(
	overrides: Partial<StorySerialView["cast"][number]> = {},
): StorySerialView["cast"][number] {
	return {
		who: "林雪",
		present: true,
		tier: "lead",
		status: "平静",
		location: "门厅",
		lastScene: null,
		notes: [],
		relations: [],
		uninformedScenes: [],
		...overrides,
	};
}

describe("连载页的纯函数", () => {
	it("五个标签覆盖四块派生数据与可编辑记忆", () => {
		expect(SERIAL_TABS.map((tab) => tab.label)).toEqual([
			"前情提要",
			"章节目录",
			"人物关系",
			"时间线",
			"可编辑记忆",
		]);
	});

	it("章标题带序号，未收尾的一章标出来", () => {
		expect(
			formatChapterTitle({
				ordinal: 2,
				startNodeId: "n2",
				endNodeId: "n4",
				floorCount: 3,
				sceneOrdinals: [1],
				focusLineIds: [],
			}),
		).toBe("第 2 章");
		expect(
			formatChapterTitle({
				ordinal: 3,
				startNodeId: "n5",
				endNodeId: null,
				floorCount: 1,
				sceneOrdinals: [2],
				focusLineIds: [],
			}),
		).toBe("第 3 章（进行中）");
	});

	it("只有改动的字段生成台账修改，清空写成删除", () => {
		expect(
			buildCharacterDiffs(character(), {
				status: " 警觉 ",
				location: "门厅",
			}),
		).toEqual([
			{ path: ["character", "林雪", "status"], op: "set", value: "警觉" },
		]);
		expect(
			buildCharacterDiffs(character(), { status: "平静", location: "" }),
		).toEqual([{ path: ["character", "林雪", "location"], op: "delete" }]);
		expect(
			buildCharacterDiffs(character(), { status: "平静", location: "门厅" }),
		).toEqual([]);
	});

	it("说明默认写明人物与改动的字段", () => {
		const diffs = buildCharacterDiffs(character(), {
			status: "警觉",
			location: "",
		});
		expect(defaultMemoryDescription(character(), diffs)).toBe(
			"修改「林雪」的状态、位置",
		);
	});
});
