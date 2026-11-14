import { describe, expect, it } from "vitest";
import {
	DEFAULT_CONTEXT_SEGMENT_ORDER,
	assembleContext,
	createDefaultContextTemplate,
	createHistorySlotProvider,
	createNaiveContextTemplate,
	createStaticSlotProvider,
	detectContextLayout,
} from "../src/index.js";
import type { ContextSlotProviders, StoryStore } from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function seedPath(store: StoryStore): string {
	store.createStory({ id: "s1", title: "山门" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "山门在雾里。",
	});
	const user = store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "a1",
		role: "user",
		raw: "我推门进去。",
	});
	return user.id;
}

describe("上下文排布", () => {
	it("默认按易变性排布，历史原文在每轮变化的槽位之前", () => {
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		});
		expect(template.segments.map((segment) => segment.id)).toEqual(
			DEFAULT_CONTEXT_SEGMENT_ORDER.volatility,
		);
		expect(detectContextLayout(template)).toBe("volatility");
	});

	it("block_format 不参与排布判断", () => {
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
			blockFormat: true,
		});
		expect(detectContextLayout(template)).toBe("volatility");
	});

	it("full 与朴素模板的排布判断", () => {
		expect(
			detectContextLayout(
				createDefaultContextTemplate({
					structuredOutput: "text-tags",
					layout: "full",
				}),
			),
		).toBe("full");
		expect(detectContextLayout(createNaiveContextTemplate())).toBe("custom");
	});

	it("每轮变化的槽位不移动只追加的前缀", async () => {
		const { store } = openTempStore();
		const nodeId = seedPath(store);
		let variant = 0;
		const providers: ContextSlotProviders = {
			character: createStaticSlotProvider(
				[{ role: "system", content: "你扮演山神。" }],
				"card:山神",
			),
			lore: createStaticSlotProvider(
				[{ role: "system", content: "山门终年有雾。" }],
				"lore:1 条常驻",
			),
			summary: createStaticSlotProvider(
				[{ role: "system", content: "第一章：旅人抵达。" }],
				"summary:1 章",
			),
			history: createHistorySlotProvider(store),
			state: {
				provide() {
					return {
						messages: [
							{ role: "system" as const, content: `当前状态：${variant}` },
						],
						source: "state:台账",
					};
				},
			},
			scene: {
				provide() {
					return {
						messages: [
							{ role: "system" as const, content: `现场分析：${variant}` },
						],
						source: "scene:本楼",
					};
				},
			},
		};
		const input = {
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			budgetTokens: 100_000,
			storyId: "s1",
			nodeId,
			providers,
		} as const;
		variant = 1;
		const first = await assembleContext(input);
		variant = 2;
		const second = await assembleContext(input);

		expect(first.segments.map((segment) => segment.segmentId)).toEqual(
			DEFAULT_CONTEXT_SEGMENT_ORDER.volatility.filter(
				(id) =>
					id === "character" ||
					id === "lore" ||
					id === "summary" ||
					id === "history" ||
					id === "state" ||
					id === "scene" ||
					id === "protocol",
			),
		);
		const appendOnly = ["character", "lore", "summary", "history"];
		let prefixLength = 0;
		for (const segment of first.segments) {
			if (!appendOnly.includes(segment.segmentId)) break;
			prefixLength += segment.messages.length;
		}
		expect(prefixLength).toBeGreaterThan(0);
		expect(second.messages.slice(0, prefixLength)).toEqual(
			first.messages.slice(0, prefixLength),
		);
		expect(first.messages[prefixLength]?.content).toBe("当前状态：1");
		expect(second.messages[prefixLength]?.content).toBe("当前状态：2");
		expect(first.messages.at(-1)?.content).toContain("写作契约");
	});
});
