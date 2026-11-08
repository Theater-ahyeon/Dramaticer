import { describe, expect, it } from "vitest";
import {
	ACTION_POLL_ATTEMPTS,
	type CandidateActionItem,
	groupCandidateActions,
	shouldPollActions,
} from "../src/chat/candidate-actions";

function item(
	ordinal: number,
	kind: CandidateActionItem["kind"],
	text = `候选 ${ordinal}`,
): CandidateActionItem {
	return { id: `candidate-${ordinal}`, ordinal, kind, text };
}

describe("候选行动", () => {
	it("按编号分开行动与场景变化", () => {
		const groups = groupCandidateActions([
			item(5, "scene_change", "跳到第二天"),
			item(3, "action", "推开木门"),
			item(1, "action", "先听门后的动静"),
			item(2, "action"),
			item(4, "action"),
		]);
		expect(groups.actions.map((action) => action.text)).toEqual([
			"先听门后的动静",
			"候选 2",
			"推开木门",
			"候选 4",
		]);
		expect(groups.sceneChanges.map((action) => action.text)).toEqual([
			"跳到第二天",
		]);
	});

	it("没有候选时两组都为空", () => {
		const groups = groupCandidateActions([]);
		expect(groups.actions).toEqual([]);
		expect(groups.sceneChanges).toEqual([]);
	});

	it("候选未出现时在上限内继续轮询，有候选就停", () => {
		expect(shouldPollActions(0, [])).toBe(true);
		expect(shouldPollActions(ACTION_POLL_ATTEMPTS - 2, [])).toBe(true);
		expect(shouldPollActions(ACTION_POLL_ATTEMPTS - 1, [])).toBe(false);
		expect(shouldPollActions(0, [item(1, "action")])).toBe(false);
	});
});
