import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	StoryStore,
	applySettlementProposals,
	prepareSettlement,
	readLedger,
} from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { MvuLedgerSession, buildMvuInitState } from "../src/st-mvu/index.js";

function openTempStore(): StoryStore {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-mvu-ledger-")),
		"story.db",
	);
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(path), {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
	});
	return store;
}

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。",
	});
}

function initState() {
	return buildMvuInitState({
		角色: { 好感度: 10 },
		世界: { 时间: "早晨" },
	});
}

describe("MVU 变量与台账 mvu 命名空间", () => {
	it("初始变量在提交前只是待结算值", () => {
		const store = openTempStore();
		seed(store);
		const session = MvuLedgerSession.open({
			store,
			nodeId: "a1",
			state: initState(),
		});
		expect(session.read()).toEqual({
			角色: { 好感度: 10 },
			世界: { 时间: "早晨" },
		});
		expect(readLedger(store, "a1", ["mvu"])).toBeUndefined();
		expect(session.pending().map((write) => write.path)).toEqual([
			["mvu", "角色", "好感度"],
			["mvu", "世界", "时间"],
		]);
	});

	it("脚本写后立即可读，提交后读取与结算路径都以台账为准", () => {
		const store = openTempStore();
		seed(store);
		const trace: string[] = [];
		const session = MvuLedgerSession.open({
			store,
			nodeId: "a1",
			state: initState(),
			onTrace: (entry) =>
				trace.push(`${entry.outcome}:${entry.path?.join("/") ?? "-"}`),
		});
		const applied = session.apply([
			{ op: "replace", path: "/世界/时间", value: "下午" },
			{ op: "replace", path: "/缺失", value: 1 },
		]);
		expect(applied.applied).toBe(1);
		expect(applied.rejected).toHaveLength(1);
		expect(applied.rejected[0]?.reason).toContain("/缺失");
		expect(applied.trace).toEqual([
			{
				plugin: "st-mvu",
				action: "ledger-write",
				target: "mvu",
				outcome: "rejected",
				path: ["缺失"],
				reason: expect.stringContaining("/缺失"),
			},
		]);
		expect(trace).toEqual(["rejected:缺失"]);
		expect(session.read()).toEqual({
			角色: { 好感度: 10 },
			世界: { 时间: "下午" },
		});
		expect(readLedger(store, "a1", ["mvu"])).toBeUndefined();

		const commit = session.commit({ storyId: "s1" });
		expect(commit.accepted.map((diff) => diff.path)).toEqual([
			["mvu", "角色", "好感度"],
			["mvu", "世界", "时间"],
			["mvu", "世界", "时间"],
		]);
		expect(commit.trace.map((entry) => entry.outcome)).toEqual([
			"accepted",
			"accepted",
			"accepted",
		]);
		expect(session.pending()).toEqual([]);
		expect(readLedger(store, "a1", ["mvu"])).toEqual(session.read());
		expect(readLedger(store, "a1", ["mvu"])).toEqual({
			角色: { 好感度: 10 },
			世界: { 时间: "下午" },
		});
		expect(
			store.getStateDiffs("a1").every((diff) => diff.path[0] === "mvu"),
		).toBe(true);

		const window = prepareSettlement(store, "s1");
		expect(window?.floors[0]?.covered.map((item) => item.path)).toEqual([
			["mvu", "角色", "好感度"],
			["mvu", "世界", "时间"],
			["mvu", "世界", "时间"],
		]);
		applySettlementProposals(
			store,
			window as NonNullable<typeof window>,
			new Map([
				[
					"a1",
					{
						diffs: [
							{
								path: ["mvu", "世界", "时间"],
								op: "set",
								value: "夜晚",
								confidence: 0.9,
							},
						],
						conflicts: [],
						beatCompleted: false,
						beatCompletedError: null,
					},
				],
			]),
		);
		expect(readLedger(store, "a1", ["mvu"])).toEqual({
			角色: { 好感度: 10 },
			世界: { 时间: "下午" },
		});
		expect(store.getStateDiffs("a1")).toHaveLength(3);
		expect(prepareSettlement(store, "s1")).toBeNull();
	});

	it("锁定对象的新增键被拒绝，非法补丁不写台账且原因留在 Trace", () => {
		const store = openTempStore();
		seed(store);
		const session = MvuLedgerSession.open({
			store,
			nodeId: "a1",
			state: buildMvuInitState({ 角色: { 好感度: 10 } }),
		});
		const result = session.apply([
			{ op: "insert", path: "/角色/新键", value: 1 },
			{ op: "replace", path: "/角色/好感度", value: 20 },
		]);
		expect(result.applied).toBe(1);
		expect(result.rejected).toHaveLength(1);
		expect(result.rejected[0]?.reason).toContain("对象结构已锁定");
		expect(result.trace).toEqual([
			{
				plugin: "st-mvu",
				action: "ledger-write",
				target: "mvu",
				outcome: "rejected",
				path: ["角色", "新键"],
				reason: expect.stringContaining("对象结构已锁定"),
			},
		]);
		session.commit({ storyId: "s1" });
		expect(readLedger(store, "a1", ["mvu"])).toEqual({ 角色: { 好感度: 20 } });
	});

	it("同一楼层再次打开时从台账读起，新建的值仍只有一份事实", () => {
		const store = openTempStore();
		seed(store);
		const first = MvuLedgerSession.open({
			store,
			nodeId: "a1",
			state: initState(),
		});
		first.apply([{ op: "delta", path: "/角色/好感度", value: 5 }]);
		first.commit({ storyId: "s1" });
		expect(readLedger(store, "a1", ["mvu"])).toEqual({
			角色: { 好感度: 15 },
			世界: { 时间: "早晨" },
		});

		const second = MvuLedgerSession.open({
			store,
			nodeId: "a1",
			state: initState(),
		});
		expect(second.read()).toEqual(readLedger(store, "a1", ["mvu"]));
		expect(second.pending()).toEqual([]);
		second.apply([{ op: "delta", path: "/角色/好感度", value: 5 }]);
		expect(second.read()).toEqual({
			角色: { 好感度: 20 },
			世界: { 时间: "早晨" },
		});
		second.commit({ storyId: "s1" });
		expect(readLedger(store, "a1", ["mvu"])).toEqual({
			角色: { 好感度: 20 },
			世界: { 时间: "早晨" },
		});
	});
});
