import { describe, expect, it } from "vitest";
import {
	assembleContext,
	assertContextTemplate,
	createDefaultContextTemplate,
	createStaticSlotProvider,
	createTokenEstimator,
} from "../src/index.js";
import type { ContextTemplate } from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const DEFAULT_SEGMENT_ORDER = [
	"character",
	"lore",
	"summary",
	"history",
	"state",
	"memory",
	"scene",
	"profile",
	"reunion",
	"scene_card",
	"director",
	"user_will",
	"protocol",
];

const FULL_SEGMENT_ORDER = [
	"character",
	"lore",
	"state",
	"summary",
	"memory",
	"scene",
	"profile",
	"reunion",
	"scene_card",
	"director",
	"user_will",
	"history",
	"protocol",
];

describe("写作契约段", () => {
	it.each(["text-tags", "function-call"] as const)(
		"%s 模式下 protocol 是默认模板的最后一个片段",
		(structuredOutput) => {
			const template = createDefaultContextTemplate({ structuredOutput });
			expect(template.segments.map((segment) => segment.id)).toEqual(
				DEFAULT_SEGMENT_ORDER,
			);
			const protocol = template.segments.at(-1);
			expect(protocol?.kind).toBe("static");
			if (protocol?.kind !== "static") throw new Error("缺少协议段");
			expect(protocol.text).toContain("写作契约");
		},
	);

	it("block_format 关闭时 volatility 排布只含默认段落", () => {
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
			blockFormat: false,
		});
		expect(template.segments.map((segment) => segment.id)).toEqual(
			DEFAULT_SEGMENT_ORDER,
		);
		const withFormat = createDefaultContextTemplate({
			structuredOutput: "text-tags",
			blockFormat: true,
		});
		expect(withFormat.segments.map((segment) => segment.id)).toEqual([
			...DEFAULT_SEGMENT_ORDER.slice(0, -1),
			"block_format",
			"protocol",
		]);
	});

	it("full 排布沿用 v4 之前的顺序，场面卡仍在导演之前", () => {
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
			layout: "full",
		});
		expect(template.segments.slice(0, -1)).toEqual([
			{ id: "character", kind: "slot", slot: "character", priority: 90 },
			{ id: "lore", kind: "slot", slot: "lore", priority: 80 },
			{ id: "state", kind: "slot", slot: "state", priority: 85 },
			{ id: "summary", kind: "slot", slot: "summary", priority: 70 },
			{ id: "memory", kind: "slot", slot: "memory", priority: 60 },
			{ id: "scene", kind: "slot", slot: "scene", priority: 55 },
			{ id: "profile", kind: "slot", slot: "profile", priority: 53 },
			{ id: "reunion", kind: "slot", slot: "reunion", priority: 51 },
			{
				id: "scene_card",
				kind: "slot",
				slot: "scene_card",
				priority: 52,
			},
			{ id: "director", kind: "slot", slot: "director", priority: 50 },
			{ id: "user_will", kind: "slot", slot: "user_will", priority: 110 },
			{ id: "history", kind: "slot", slot: "history", priority: 100 },
		]);
		expect(template.segments.map((segment) => segment.id)).toEqual(
			FULL_SEGMENT_ORDER,
		);
		const withFormat = createDefaultContextTemplate({
			structuredOutput: "text-tags",
			layout: "full",
			blockFormat: true,
		});
		expect(withFormat.segments.map((segment) => segment.id)).toEqual([
			...FULL_SEGMENT_ORDER.slice(0, -1),
			"block_format",
			"protocol",
		]);
	});

	it("protocol 不在最后时校验抛错并指出模板与位置", () => {
		const template: ContextTemplate = {
			id: "reordered",
			segments: [
				{ id: "protocol", kind: "static", text: "契约" },
				{ id: "history", kind: "slot", slot: "history" },
			],
		};
		expect(() => assertContextTemplate(template)).toThrow(
			"上下文模板 reordered 的 protocol 写作契约片段必须是最后一个片段",
		);
		expect(() => assertContextTemplate(template)).toThrow("后面还有 1 个片段");
	});

	it("保存模板时拒绝把片段放在 protocol 之后", () => {
		const { store } = openTempStore();
		expect(() =>
			store.createContextTemplate({
				name: "越界模板",
				template: {
					id: "custom",
					segments: [
						{ id: "protocol", kind: "static", text: "契约" },
						{ id: "history", kind: "slot", slot: "history" },
					],
				},
			}),
		).toThrow("protocol 写作契约片段必须是最后一个片段");
		const saved = store.createContextTemplate({
			name: "合法模板",
			template: {
				id: "custom-ok",
				segments: [
					{ id: "history", kind: "slot", slot: "history" },
					{ id: "protocol", kind: "static", text: "自定义契约" },
				],
			},
		});
		expect(saved.template.segments.at(-1)?.id).toBe("protocol");
	});

	it("契约段可以换成故事模板自己的文本，Trace 记录来源与 token", async () => {
		const template: ContextTemplate = {
			id: "custom-ok",
			segments: [
				{
					id: "character",
					kind: "slot",
					slot: "character",
					priority: 90,
				},
				{
					id: "protocol",
					kind: "static",
					text: "自定义契约：按玩家指引演出。",
				},
			],
		};
		const assembled = await assembleContext({
			template,
			budgetTokens: 1_000,
			storyId: "s1",
			providers: {
				character: createStaticSlotProvider(
					[{ role: "system", content: "你扮演山神。" }],
					"card:山神",
				),
			},
			tokenEstimator: createTokenEstimator(),
		});
		const entries = assembled.trace.entries;
		expect(entries.at(-1)).toMatchObject({
			segmentId: "protocol",
			kind: "static",
			source: "template:custom-ok/protocol",
			status: "included",
		});
		expect(entries.at(-1)?.tokens).toBeGreaterThan(0);
		expect(assembled.messages.at(-1)).toEqual({
			role: "system",
			content: "自定义契约：按玩家指引演出。",
		});
	});
});
