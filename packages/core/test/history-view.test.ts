import { describe, expect, it } from "vitest";
import {
	DEFAULT_HISTORY_BLOCK_POLICY,
	type HistoryBlockPolicy,
	parseBlocks,
	renderContextView,
	renderHistoryView,
} from "../src/index.js";

const lengthTokens = (text: string): number => text.length;

const fullPolicy: HistoryBlockPolicy = { mode: "full", overrides: {} };

describe("renderHistoryView", () => {
	it("full 与现有上下文渲染逐字节一致", () => {
		const floors = [
			{
				raw: "正文<thinking>内心</thinking>中间<选项>甲\n乙</选项>结尾<状态栏>血量 3</状态栏>",
				depth: 0,
			},
			{
				raw: "开场<分析>他想要什么</分析>然后<旁白>风起</旁白>",
				depth: 2,
			},
		];
		const view = renderHistoryView(floors, {
			policy: fullPolicy,
			estimator: lengthTokens,
		});
		floors.forEach((floor, index) => {
			expect(view.texts[index]).toBe(
				renderContextView(parseBlocks(floor.raw), { depth: floor.depth }),
			);
		});
		expect(view.trace).toEqual({
			policy: "full",
			recentRawFloors: 1,
			omitted: [{ blockType: "thinking", characters: 23, tokens: 23 }],
		});
	});

	it("default 省略更早楼层的显示类块，最近一楼保留", () => {
		const raw =
			"他说：<thinking>犹豫</thinking>请进。<选项>甲\n乙</选项><状态栏>血量 3</状态栏>";
		const view = renderHistoryView(
			[
				{ raw, depth: 0 },
				{ raw, depth: 1 },
			],
			{ policy: DEFAULT_HISTORY_BLOCK_POLICY, estimator: lengthTokens },
		);
		expect(view.texts[0]).toBe(
			"他说：请进。<选项>甲\n乙</选项><状态栏>血量 3</状态栏>",
		);
		expect(view.texts[1]).toBe("他说：请进。");
		expect(view.trace.policy).toBe("default");
		expect(view.trace.omitted).toEqual([
			{ blockType: "thinking", characters: 46, tokens: 46 },
			{ blockType: "状态栏", characters: 15, tokens: 15 },
			{ blockType: "选项", characters: 12, tokens: 12 },
		]);
	});

	it("未知块、未闭合块与围栏代码块按原文保留", () => {
		const raw =
			"前<未知块>内容</未知块><选项>没有闭合\n" +
			"```\n<选项>示例</选项>\n```\n尾";
		const view = renderHistoryView([{ raw, depth: 3 }], {
			policy: DEFAULT_HISTORY_BLOCK_POLICY,
			estimator: lengthTokens,
		});
		expect(view.texts[0]).toBe(raw);
		expect(view.trace.omitted).toEqual([]);
	});

	it("按块类型覆盖策略优先于默认省略与块类型自带策略", () => {
		const policy: HistoryBlockPolicy = {
			mode: "default",
			overrides: { 选项: { kind: "keep" }, 旁白: { kind: "drop" } },
		};
		const view = renderHistoryView(
			[
				{
					raw: "<选项>甲</选项><旁白>风起</旁白><thinking>想</thinking>",
					depth: 4,
				},
			],
			{ policy, estimator: lengthTokens },
		);
		expect(view.texts[0]).toBe("<选项>甲</选项>");
		expect(view.trace.omitted.map((item) => item.blockType)).toEqual([
			"thinking",
			"旁白",
		]);
	});

	it("keep-depth 与深度策略仍按楼层深度生效，且统计只记录真正省略的块", () => {
		const view = renderHistoryView(
			[{ raw: "<分析>深层</分析>正文", depth: 6 }],
			{
				policy: {
					mode: "default",
					overrides: { 分析: { kind: "keep-depth", depth: 3 } },
				},
				estimator: lengthTokens,
			},
		);
		expect(view.texts[0]).toBe("正文");
		expect(view.trace.omitted).toEqual([
			{ blockType: "分析", characters: 11, tokens: 11 },
		]);
	});

	it("没有省略时统计为空数组", () => {
		const view = renderHistoryView([{ raw: "只有正文。", depth: 5 }], {
			policy: DEFAULT_HISTORY_BLOCK_POLICY,
			estimator: lengthTokens,
		});
		expect(view.trace.omitted).toEqual([]);
	});

	it("非法策略、压缩策略与非法保留楼数都抛错", () => {
		expect(() =>
			renderHistoryView([], {
				policy: { mode: "huge" as never, overrides: {} },
			}),
		).toThrow("mode");
		expect(() =>
			renderHistoryView([], {
				policy: {
					mode: "default",
					overrides: { 选项: { kind: "compress" } },
				},
			}),
		).toThrow("compress");
		expect(() => renderHistoryView([], { recentRawFloors: -1 })).toThrow(
			"非负整数",
		);
	});
});
