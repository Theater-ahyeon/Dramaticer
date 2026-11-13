import { describe, expect, it } from "vitest";
import {
	PluginDisplayState,
	type StoryStore,
	applyMessageModification,
	classifyMessageModification,
	readLedger,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const ORIGINAL_RAW = "原始正文\n<StatusPlaceHolderImpl/>";

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: ORIGINAL_RAW,
	});
}

describe("消息修改分类", () => {
	it("改正文生成兄弟楼层，原楼层逐字节不变", () => {
		const { store } = openTempStore();
		seed(store);
		const displayState = new PluginDisplayState();
		const result = applyMessageModification({
			store,
			displayState,
			plugin: "st-test",
			request: { nodeId: "a1", raw: "改写后的正文" },
		});
		if (result.kind !== "content") throw new Error("预期正文修改");
		expect(result.previousNodeId).toBe("a1");
		expect(result.node.parentId).toBeNull();
		expect(result.node.role).toBe("assistant");
		expect(result.node.raw).toBe("改写后的正文");
		expect(store.getNode("a1")?.raw).toBe(ORIGINAL_RAW);
		expect(store.getHead("s1")?.id).toBe(result.node.id);
		expect(store.listStoryNodes("s1")).toHaveLength(2);
		// 插件改写正文不是玩家的接受或放弃，不产生偏好信号。
		expect(store.listPreferenceEvents("s1")).toEqual([]);
		expect(store.getStateDiffs("a1")).toEqual([]);
		expect(displayState.get("a1", "st-test")).toBeNull();
	});

	it("只改显示不新建节点，不写楼层也不写台账", () => {
		const { store } = openTempStore();
		seed(store);
		const displayState = new PluginDisplayState();
		const headBefore = store.getHead("s1")?.id;
		const ledgerBefore = readLedger(store, "a1");
		const result = applyMessageModification({
			store,
			displayState,
			plugin: "st-test",
			request: {
				nodeId: "a1",
				display: { statusBar: "<div>状态栏</div>" },
			},
		});
		expect(result.kind).toBe("display");
		expect(store.listStoryNodes("s1")).toHaveLength(1);
		expect(store.getHead("s1")?.id).toBe(headBefore);
		expect(store.getNode("a1")?.raw).toBe(ORIGINAL_RAW);
		expect(store.getStateDiffs("a1")).toEqual([]);
		expect(readLedger(store, "a1")).toEqual(ledgerBefore);
		expect(displayState.get("a1", "st-test")).toEqual({
			display: { statusBar: "<div>状态栏</div>" },
			metadata: {},
		});
	});

	it("只改元数据不新建节点，并与显示分开存放", () => {
		const { store } = openTempStore();
		seed(store);
		const displayState = new PluginDisplayState();
		applyMessageModification({
			store,
			displayState,
			plugin: "st-test",
			request: { nodeId: "a1", display: { statusBar: "A" } },
		});
		const result = applyMessageModification({
			store,
			displayState,
			plugin: "st-test",
			request: { nodeId: "a1", metadata: { format: "brief" } },
		});
		expect(result.kind).toBe("metadata");
		expect(store.listStoryNodes("s1")).toHaveLength(1);
		expect(store.getNode("a1")?.raw).toBe(ORIGINAL_RAW);
		expect(displayState.get("a1", "st-test")).toEqual({
			display: { statusBar: "A" },
			metadata: { format: "brief" },
		});
	});

	it("拒绝混合类别与空修改", () => {
		const { store } = openTempStore();
		seed(store);
		const displayState = new PluginDisplayState();
		expect(() =>
			classifyMessageModification({
				nodeId: "a1",
				raw: "新正文",
				display: { statusBar: "A" },
			}),
		).toThrow(/只能属于一类.*content、display/);
		expect(() => classifyMessageModification({ nodeId: "a1" })).toThrow(
			/至少要有正文、显示或元数据中的一项/,
		);
		expect(() =>
			applyMessageModification({
				store,
				displayState,
				plugin: "st-test",
				request: { nodeId: "a1", raw: "新正文", metadata: { a: 1 } },
			}),
		).toThrow(/只能属于一类/);
		expect(store.listStoryNodes("s1")).toHaveLength(1);
		expect(displayState.listPlugins("a1")).toEqual([]);
	});

	it("正文没有变化与目标楼层不存在时拒绝", () => {
		const { store } = openTempStore();
		seed(store);
		const displayState = new PluginDisplayState();
		expect(() =>
			applyMessageModification({
				store,
				displayState,
				plugin: "st-test",
				request: { nodeId: "a1", raw: ORIGINAL_RAW },
			}),
		).toThrow(/与原文相同/);
		expect(() =>
			applyMessageModification({
				store,
				displayState,
				plugin: "st-test",
				request: { nodeId: "missing", raw: "新正文" },
			}),
		).toThrow(/目标楼层不存在：missing/);
		expect(store.listStoryNodes("s1")).toHaveLength(1);
	});
});

describe("插件显示状态", () => {
	it("按楼层与插件隔离，并支持读取与清理", () => {
		const displayState = new PluginDisplayState();
		const snapshot = () => {
			displayState.clear("a1");
			displayState.set({
				nodeId: "a1",
				plugin: "st-a",
				kind: "display",
				values: { statusBar: "A" },
			});
			displayState.set({
				nodeId: "a1",
				plugin: "st-b",
				kind: "metadata",
				values: { format: "brief" },
			});
			return displayState;
		};
		snapshot();
		expect(displayState.get("a1", "st-a")).toEqual({
			display: { statusBar: "A" },
			metadata: {},
		});
		expect(displayState.get("a1", "st-b")).toEqual({
			display: {},
			metadata: { format: "brief" },
		});
		expect(displayState.listPlugins("a1")).toEqual(["st-a", "st-b"]);
		expect(displayState.getValue("a1", "st-b", "metadata", "format")).toBe(
			"brief",
		);
		expect(
			displayState.getValue("a1", "st-b", "display", "format"),
		).toBeUndefined();
		expect(displayState.get("a2", "st-a")).toBeNull();
		displayState.clear("a1", "st-a");
		expect(displayState.get("a1", "st-a")).toBeNull();
		expect(displayState.get("a1", "st-b")).not.toBeNull();
		displayState.clear("a1");
		expect(displayState.listPlugins("a1")).toEqual([]);
	});

	it("值必须是有限 JSON，且类别与键都要合法", () => {
		const displayState = new PluginDisplayState();
		expect(() =>
			displayState.set({
				nodeId: "a1",
				plugin: "st-a",
				kind: "display",
				values: {},
			}),
		).toThrow(/至少需要一个键/);
		expect(() =>
			displayState.set({
				nodeId: "a1",
				plugin: "st-a",
				kind: "display",
				values: { broken: Number.NaN },
			}),
		).toThrow(/显示状态\.display\.broken 不是有限数字/);
		expect(() =>
			displayState.set({
				nodeId: "a1",
				plugin: "",
				kind: "display",
				values: { a: 1 },
			}),
		).toThrow(/插件名必须是非空字符串/);
		expect(() =>
			displayState.set({
				nodeId: "a1",
				plugin: "st-a",
				// @ts-expect-error 运行期也要拒绝未知类别
				kind: "render",
				values: { a: 1 },
			}),
		).toThrow(/类别不合法：render/);
	});
});
