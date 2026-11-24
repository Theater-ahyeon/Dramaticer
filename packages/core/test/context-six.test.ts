import { describe, expect, it } from "vitest";
import {
	assembleContext,
	createDefaultContextTemplate,
	createPagesSlotProvider,
	ensureNotebookInit,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

// memory-v5/04：上下文收拢为六节。

describe("默认模板的六节", () => {
	it("卡与写作条目、世界索引、此刻局面、相关页面、方向、最近原文，加偏好与写作契约", () => {
		const ids = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		}).segments.map((segment) => segment.id);
		expect(ids).toEqual([
			"character",
			"lore",
			"summary",
			"history",
			"world_index",
			"situation",
			"pages",
			"memory",
			"director",
			"user_will",
			"protocol",
		]);
		for (const retired of [
			"state",
			"scene",
			"scene_card",
			"profile",
			"reunion",
			"blueprint",
		]) {
			expect(ids).not.toContain(retired);
		}
	});
});

describe("相关页面", () => {
	it("在场者的记事页整页进上下文，带来源与楼层锚点", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "旧宅" });
		for (const [name, description] of [
			["林雪", "旧宅的守夜人。"],
			["阿宁", "林雪的表妹。"],
		] as const) {
			store.upsertEntity({
				storyId: "s1",
				kind: "character",
				name,
				description,
				source: "test",
				aliases: [],
			});
		}
		store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "林雪点亮门厅的灯。",
		});
		store.saveSceneLog({
			nodeId: "a1",
			storyId: "s1",
			beat: "开场",
			present: ["林雪"],
			sceneEnds: false,
			sceneCard: null,
			bits: [],
			conditions: [],
			states: [],
			quotes: { submitted: 0, verified: 0 },
			repairs: [],
		});
		ensureNotebookInit(store, "s1", "a1");
		const context = await assembleContext({
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			budgetTokens: 8_000,
			storyId: "s1",
			nodeId: "a1",
			providers: { pages: createPagesSlotProvider(store) },
		});
		const entry = context.trace.entries.find(
			(segment) => segment.segmentId === "pages",
		);
		expect(entry?.status).toBe("included");
		expect(entry?.items?.map((item) => item.label)).toEqual(["林雪"]);
		expect(entry?.items?.[0]?.source.kind).toBe("wiki");
		const text = context.messages.map((message) => message.content).join("\n");
		expect(text).toContain("相关页面：");
		expect(text).toContain("底色：旧宅的守夜人。");
		// 不在场的人不带整页。
		expect(text).not.toContain("林雪的表妹");
	});
});
