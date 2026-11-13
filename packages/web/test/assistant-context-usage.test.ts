import type { AssistantContextUsage } from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import {
	contextLevel,
	contextPartsLabel,
	contextPercentLabel,
	formatOrdinalRanges,
} from "../src/assistant/context-usage.js";

function usage(percent: number): AssistantContextUsage {
	return {
		used: Math.round(percent * 1_000),
		budget: 1_000,
		percent,
		parts: [
			{ id: "system", tokens: 100 },
			{ id: "summary", tokens: 50 },
			{ id: "messages", tokens: 30 },
			{ id: "tools", tokens: 20 },
		],
	};
}

describe("助手上下文用量展示", () => {
	it("百分比与悬停说明按接口字段生成", () => {
		expect(contextPercentLabel(usage(0.734))).toBe("73%");
		expect(contextPartsLabel(usage(0.5))).toBe(
			"系统提示 100 · 摘要 50 · 消息 30 · 工具结果 20",
		);
	});

	it("占用档位在阈值处切换", () => {
		expect(contextLevel(usage(0.5))).toBe("ok");
		expect(contextLevel(usage(0.8))).toBe("warn");
		expect(contextLevel(usage(0.95))).toBe("danger");
		expect(contextLevel(usage(1.2))).toBe("danger");
	});

	it("省略的消息序号合并成区间", () => {
		expect(formatOrdinalRanges([])).toBe("无");
		expect(formatOrdinalRanges([1])).toBe("1");
		expect(formatOrdinalRanges([1, 2, 3, 5, 8, 9])).toBe("1–3、5、8–9");
	});
});
