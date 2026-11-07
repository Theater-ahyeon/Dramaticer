import { describe, expect, it } from "vitest";
import {
	type ContextSlotRequest,
	createDefaultContextTemplate,
	createHistorySlotProvider,
	createStateSlotProvider,
	createStaticSlotProvider,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function request(
	storyId: string,
	nodeId: string | null,
	slot: ContextSlotRequest["slot"],
): ContextSlotRequest {
	return { slot, storyId, nodeId, switches: {}, state: undefined };
}

describe("createDefaultContextTemplate", () => {
	it("文本标签模式在协议段说明标签写法", () => {
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		});
		const protocol = template.segments.find(
			(segment) => segment.id === "protocol",
		);
		expect(protocol?.kind).toBe("static");
		if (protocol?.kind !== "static") throw new Error("缺少协议段");
		expect(protocol.text).toContain("<state_update>");
		expect(protocol.text).toContain("<plot_note>");
		expect(template.segments.at(-1)?.slot).toBe("history");
	});

	it("函数调用模式不在协议段写标签", () => {
		const template = createDefaultContextTemplate({
			structuredOutput: "function-call",
		});
		const protocol = template.segments.find(
			(segment) => segment.id === "protocol",
		);
		if (protocol?.kind !== "static") throw new Error("缺少协议段");
		expect(protocol.text).toContain("工具调用");
		expect(protocol.text).not.toContain("<state_update>");
	});
});

describe("槽位提供者", () => {
	it("历史槽位只带最近若干楼，并按上下文策略删除隐藏块", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "n-greeting",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "山门开了。",
		});
		store.appendNode({
			id: "n-user",
			storyId: "s1",
			parentId: "n-greeting",
			role: "user",
			raw: "我推门进去。",
		});
		store.appendNode({
			id: "n-reply",
			storyId: "s1",
			parentId: "n-user",
			role: "assistant",
			raw: '他说：<thinking>犹豫</thinking>请进。<state_update>{"path":["场景"],"op":"set","value":"山门"}</state_update>',
		});

		const provider = createHistorySlotProvider(store, { limit: 2 });
		const content = await provider.provide(request("s1", "n-reply", "history"));
		expect(content?.source).toBe("history:最近 2 楼");
		expect(content?.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
		expect(content?.messages[0]?.content).toBe("我推门进去。");
		expect(content?.messages[1]?.content).toBe("他说：请进。");
		expect(content?.messages[1]?.content).not.toContain("<state_update>");
	});

	it("状态槽位回放路径上的 diff", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "n-reply",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "山门开了。",
		});
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "n-reply",
			path: ["场景", "地点"],
			op: "set",
			value: "山门",
			source: "test",
		});

		const provider = createStateSlotProvider(store);
		const content = await provider.provide(request("s1", "n-reply", "state"));
		expect(content?.source).toBe("state:1 条 diff");
		expect(content?.messages[0]?.content).toContain('"地点": "山门"');
	});

	it("没有楼层或没有状态时返回 null", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "n-reply",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "山门开了。",
		});
		const history = createHistorySlotProvider(store);
		const state = createStateSlotProvider(store);
		expect(await history.provide(request("s1", null, "history"))).toBeNull();
		expect(await state.provide(request("s1", "n-reply", "state"))).toBeNull();
	});

	it("静态槽位返回固定消息并拒绝空内容", async () => {
		const provider = createStaticSlotProvider(
			[{ role: "system", content: "你是角色。" }],
			"card:测试",
		);
		const content = await provider.provide(request("s1", null, "character"));
		expect(content).toEqual({
			messages: [{ role: "system", content: "你是角色。" }],
			source: "card:测试",
		});
		expect(() => createStaticSlotProvider([], "card:空")).toThrow("至少");
	});
});
