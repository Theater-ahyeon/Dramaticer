import { describe, expect, it } from "vitest";
import {
	type DirectorLine,
	REROLL_REASON_WILLS,
	type StoryStore,
	readDirectorArrangementLineId,
	readDirectorInterferenceStats,
	readLedger,
	undoDirectorArrangement,
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

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "撤回测试故事" });
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
		raw: "我去钟楼找她。",
	});
	store.appendNode({
		id: "n2",
		storyId: "s1",
		parentId: "n1",
		role: "assistant",
		raw: "钟楼上没有人。",
	});
	store.saveDirectorLines({
		nodeId: "n0",
		storyId: "s1",
		diffs: [{ action: "set", line: makeLine() }],
	});
	store.saveDirectorDecision({
		nodeId: "n1",
		storyId: "s1",
		directive: "钟声提前响了。",
		mechanisms: [{ name: "action", triggered: true, reason: "接球" }],
		signals: { organization: "lines", action: "catch", lineId: "line-1" },
	});
}

function selectionLineId(store: StoryStore): string | null {
	const input = readDirectorActionInput(
		store,
		"s1",
		"n2",
		DEFAULT_DIRECTOR_CONFIG,
		"advance",
	);
	return selectDirectorAction(input)?.lineId ?? null;
}

describe("撤回导演安排", () => {
	it("撤回静音那条线并记进偏好，恢复时只删掉静音", async () => {
		const { store } = openTempStore();
		seedStory(store);

		expect(readDirectorArrangementLineId(store, "s1", "n2")).toBe("line-1");

		await undoDirectorArrangement({
			store,
			storyId: "s1",
			nodeId: "n2",
			lineId: "line-1",
		});

		expect(store.listMutedDirectorLines("s1")).toEqual([
			{ lineId: "line-1", nodeId: "n2", createdAt: expect.any(String) },
		]);
		const wills = readLedger(store, "n2", ["userWill"]) as Record<
			string,
			{ kind: string; text: string }
		>;
		expect(Object.values(wills)).toEqual([
			expect.objectContaining({
				kind: "correction",
				text: REROLL_REASON_WILLS["avoid-line"],
			}),
		]);

		store.unmuteDirectorLine("s1", "line-1");
		expect(store.listMutedDirectorLines("s1")).toEqual([]);
	});

	it("重复撤回不重复写偏好，恢复时只删掉静音", async () => {
		const { store } = openTempStore();
		seedStory(store);

		await undoDirectorArrangement({
			store,
			storyId: "s1",
			nodeId: "n2",
			lineId: "line-1",
		});
		await undoDirectorArrangement({
			store,
			storyId: "s1",
			nodeId: "n2",
			lineId: "line-1",
		});

		expect(store.listMutedDirectorLines("s1")).toHaveLength(1);
		expect(
			store.getStateDiffs("n2").filter((diff) => diff.path[0] === "userWill"),
		).toHaveLength(1);

		store.unmuteDirectorLine("s1", "line-1");
		expect(store.listMutedDirectorLines("s1")).toEqual([]);
	});
});

describe("导演干扰统计", () => {
	function seedBranches(store: StoryStore): void {
		store.createStory({ id: "s1", title: "统计测试故事" });
		store.appendNode({
			id: "n0",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场。",
		});
		store.appendNode({
			id: "u1",
			storyId: "s1",
			parentId: "n0",
			role: "user",
			raw: "我按推进。",
		});
		store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: "u1",
			role: "assistant",
			raw: "第一版回复。",
		});
		store.appendNode({
			id: "u2",
			storyId: "s1",
			parentId: "n0",
			role: "user",
			raw: "我自己写。",
		});
		store.appendNode({
			id: "a2",
			storyId: "s1",
			parentId: "u2",
			role: "assistant",
			raw: "第二版回复。",
		});
		store.saveDirectorDecision({
			nodeId: "u1",
			storyId: "s1",
			directive: "接球。",
			mechanisms: [{ name: "action", triggered: true, reason: "接球" }],
			signals: { organization: "lines", action: "catch", lineId: "line-1" },
		});
	}

	function recordReason(
		store: StoryStore,
		nodeId: string,
		reason: "ignored-instruction" | "avoid-line",
	): void {
		store.recordPreference({
			storyId: "s1",
			nodeId,
			kind: "swipe",
			payload: {
				abandonedNodeId: nodeId,
				acceptedNodeId: nodeId,
				reason,
			},
		});
	}

	it("按导演是否参与分出两组，各自给出次数与比例", () => {
		const { store } = openTempStore();
		seedBranches(store);
		recordReason(store, "a1", "ignored-instruction");
		recordReason(store, "a1", "avoid-line");
		recordReason(store, "a2", "ignored-instruction");
		store.recordPreference({
			storyId: "s1",
			nodeId: "a2",
			kind: "choice",
			payload: { choiceText: "跟随" },
		});

		expect(readDirectorInterferenceStats(store, "s1")).toEqual({
			storyId: "s1",
			directorOn: {
				floors: 1,
				ignoredInstruction: 1,
				avoidLine: 1,
				ratio: 2,
			},
			directorOff: {
				floors: 2,
				ignoredInstruction: 1,
				avoidLine: 0,
				ratio: 0.5,
			},
		});
	});

	it("没有回复楼层时比例为零", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "空故事" });

		expect(readDirectorInterferenceStats(store, "s1")).toEqual({
			storyId: "s1",
			directorOn: {
				floors: 0,
				ignoredInstruction: 0,
				avoidLine: 0,
				ratio: 0,
			},
			directorOff: {
				floors: 0,
				ignoredInstruction: 0,
				avoidLine: 0,
				ratio: 0,
			},
		});
	});
});
