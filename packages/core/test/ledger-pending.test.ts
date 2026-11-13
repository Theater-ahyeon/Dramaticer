import { describe, expect, it } from "vitest";
import {
	PendingLedgerView,
	type StoryStore,
	readLedger,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
	store.appendNode({
		id: "n1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。",
	});
}

describe("待结算台账视图", () => {
	it("写后立即可读，提交前台账没有这条事实", () => {
		const { store } = openTempStore();
		seed(store);
		const view = PendingLedgerView.open(store, "n1", ["mvu"]);
		const staged = view.stage(
			[{ path: ["mvu", "角色", "好感度"], op: "set", value: 10 }],
			"settler",
		);
		expect(staged.rejected).toEqual([]);
		expect(view.read()).toEqual({ 角色: { 好感度: 10 } });
		expect(readLedger(store, "n1", ["mvu"])).toBeUndefined();
		expect(view.pending()).toEqual([
			{ path: ["mvu", "角色", "好感度"], op: "set", value: 10, reason: null },
		]);
	});

	it("提交后以台账为准，待结算写入清空且重复提交不新增行", () => {
		const { store } = openTempStore();
		seed(store);
		const view = PendingLedgerView.open(store, "n1", ["mvu"]);
		view.stage(
			[
				{ path: ["mvu", "角色", "好感度"], op: "set", value: 10 },
				{ path: ["mvu", "世界", "时间"], op: "set", value: "早晨" },
			],
			"settler",
		);
		const commit = view.commit({ storyId: "s1", source: "settler" });
		expect(commit.rejected).toEqual([]);
		expect(commit.accepted.map((diff) => diff.path)).toEqual([
			["mvu", "角色", "好感度"],
			["mvu", "世界", "时间"],
		]);
		expect(readLedger(store, "n1", ["mvu"])).toEqual({
			角色: { 好感度: 10 },
			世界: { 时间: "早晨" },
		});
		expect(view.pending()).toEqual([]);
		expect(view.read()).toEqual(readLedger(store, "n1", ["mvu"]));
		const again = view.commit({ storyId: "s1", source: "settler" });
		expect(again.accepted).toEqual([]);
		expect(store.getStateDiffs("n1")).toHaveLength(2);
	});

	it("删除写入在待结算视图与台账里一致", () => {
		const { store } = openTempStore();
		seed(store);
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "n1",
				path: ["mvu", "角色", "好感度"],
				op: "set",
				value: 10,
				source: "import",
			},
		]);
		const view = PendingLedgerView.open(store, "n1", ["mvu"]);
		view.stage([{ path: ["mvu", "角色", "好感度"], op: "delete" }], "settler");
		expect(view.read()).toEqual({ 角色: {} });
		view.commit({ storyId: "s1", source: "settler" });
		expect(readLedger(store, "n1", ["mvu"])).toEqual({ 角色: {} });
	});

	it("前缀之外的路径、空变量路径与非法值被逐条拒绝并给出原因", () => {
		const { store } = openTempStore();
		seed(store);
		const view = PendingLedgerView.open(store, "n1", ["mvu"]);
		const outcome = view.stage(
			[
				{ path: ["character", "卫宫", "tier"], op: "set", value: "lead" },
				{ path: ["mvu"], op: "set", value: {} },
				{ path: ["mvu", "数值"], op: "set", value: Number.NaN },
				{ path: ["mvu", "角色", "好感度"], op: "delete", value: 1 },
			],
			"settler",
		);
		expect(outcome.accepted).toEqual([]);
		expect(outcome.rejected).toHaveLength(4);
		expect(outcome.rejected[0]?.reason).toContain("不在前缀");
		expect(outcome.rejected[1]?.reason).toContain("不在前缀");
		expect(outcome.rejected[2]?.reason).toContain("不是有限数字");
		expect(outcome.rejected[3]?.reason).toContain("delete 不能带 value");
		expect(view.read()).toBeUndefined();
	});

	it("不限定前缀时按台账结构校验，实体级路径只能删除", () => {
		const { store } = openTempStore();
		seed(store);
		const view = PendingLedgerView.open(store, "n1");
		const outcome = view.stage(
			[
				{ path: ["character", "卫宫", "tier"], op: "set", value: "lead" },
				{ path: ["character", "凛"], op: "set", value: {} },
				{ path: ["mvu"], op: "set", value: {} },
			],
			"settler",
		);
		expect(outcome.accepted.map((write) => write.path)).toEqual([
			["character", "卫宫", "tier"],
		]);
		expect(outcome.rejected[0]?.reason).toContain("只能删除");
		expect(outcome.rejected[1]?.reason).toContain("至少包含一个变量路径段");
		expect(view.read()).toEqual({ character: { 卫宫: { tier: "lead" } } });
	});
});
