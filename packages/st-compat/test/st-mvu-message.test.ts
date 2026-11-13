import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { PluginDisplayState, StoryStore, readLedger } from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	ST_MVU_STATUS_PLACEHOLDER,
	applyMvuMessageChange,
	applyMvuStatusBarRefresh,
	hasMvuStatusPlaceholder,
	readMvuStatusBar,
} from "../src/st-mvu/index.js";

const RAW_WITH_PLACEHOLDER = `旁白。\n${ST_MVU_STATUS_PLACEHOLDER}`;

function openTempStore(): StoryStore {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-mvu-message-")),
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
		raw: RAW_WITH_PLACEHOLDER,
	});
}

describe("MVU 消息修改分类", () => {
	it("状态栏刷新只写显示状态，不新建节点、不改原文、不写台账", () => {
		const store = openTempStore();
		seed(store);
		const displayState = new PluginDisplayState();
		const ledgerBefore = readLedger(store, "a1");
		const result = applyMvuStatusBarRefresh({
			store,
			displayState,
			nodeId: "a1",
			html: "<div>好感度 10</div>",
		});
		expect(result.kind).toBe("display");
		expect(store.listStoryNodes("s1")).toHaveLength(1);
		expect(store.getNode("a1")?.raw).toBe(RAW_WITH_PLACEHOLDER);
		expect(hasMvuStatusPlaceholder(store.getNode("a1")?.raw ?? "")).toBe(true);
		expect(store.getStateDiffs("a1")).toEqual([]);
		expect(readLedger(store, "a1")).toEqual(ledgerBefore);
		expect(readMvuStatusBar(displayState, "a1")).toBe("<div>好感度 10</div>");
	});

	it("重复刷新覆盖同一项，不累加节点", () => {
		const store = openTempStore();
		seed(store);
		const displayState = new PluginDisplayState();
		applyMvuStatusBarRefresh({
			store,
			displayState,
			nodeId: "a1",
			html: "<div>旧</div>",
		});
		applyMvuStatusBarRefresh({
			store,
			displayState,
			nodeId: "a1",
			html: "<div>新</div>",
		});
		expect(readMvuStatusBar(displayState, "a1")).toBe("<div>新</div>");
		expect(displayState.get("a1", "st-mvu")?.display).toEqual({
			statusBar: "<div>新</div>",
		});
		expect(store.listStoryNodes("s1")).toHaveLength(1);
	});

	it("没有占位符、空 HTML 与不存在的楼层都拒绝", () => {
		const store = openTempStore();
		seed(store);
		store.appendNode({
			id: "a2",
			storyId: "s1",
			parentId: "a1",
			role: "assistant",
			raw: "没有占位符。",
		});
		const displayState = new PluginDisplayState();
		expect(() =>
			applyMvuStatusBarRefresh({
				store,
				displayState,
				nodeId: "a2",
				html: "<div>状态</div>",
			}),
		).toThrow(/没有 <StatusPlaceHolderImpl\/>/);
		expect(() =>
			applyMvuStatusBarRefresh({
				store,
				displayState,
				nodeId: "a1",
				html: "",
			}),
		).toThrow(/HTML 不能为空/);
		expect(() =>
			applyMvuStatusBarRefresh({
				store,
				displayState,
				nodeId: "missing",
				html: "<div>状态</div>",
			}),
		).toThrow(/目标楼层不存在：missing/);
		expect(displayState.listPlugins("a1")).toEqual([]);
		expect(displayState.listPlugins("a2")).toEqual([]);
	});

	it("改正文生成新的 swipe，原楼层逐字节不变", () => {
		const store = openTempStore();
		seed(store);
		const displayState = new PluginDisplayState();
		const result = applyMvuMessageChange({
			store,
			displayState,
			nodeId: "a1",
			change: { kind: "content", raw: "改写后的正文。" },
		});
		if (result.kind !== "content") throw new Error("预期正文修改");
		expect(result.node.parentId).toBeNull();
		expect(result.node.raw).toBe("改写后的正文。");
		expect(store.getNode("a1")?.raw).toBe(RAW_WITH_PLACEHOLDER);
		expect(store.listStoryNodes("s1")).toHaveLength(2);
		expect(store.listPreferenceEvents("s1")).toEqual([]);
		expect(displayState.get("a1", "st-mvu")).toBeNull();
	});

	it("消息元数据只写显示状态", () => {
		const store = openTempStore();
		seed(store);
		const displayState = new PluginDisplayState();
		const result = applyMvuMessageChange({
			store,
			displayState,
			nodeId: "a1",
			change: { kind: "metadata", values: { format: "brief" } },
		});
		expect(result.kind).toBe("metadata");
		expect(store.listStoryNodes("s1")).toHaveLength(1);
		expect(store.getStateDiffs("a1")).toEqual([]);
		expect(displayState.get("a1", "st-mvu")).toEqual({
			display: {},
			metadata: { format: "brief" },
		});
	});
});
