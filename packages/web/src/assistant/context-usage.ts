import type { AssistantContextUsage } from "@dramaticer/protocol";

const PART_LABELS: Record<string, string> = {
	system: "系统提示",
	summary: "摘要",
	messages: "消息",
	tools: "工具结果",
};

export type AssistantContextLevel = "ok" | "warn" | "danger";

export function contextPercentLabel(usage: AssistantContextUsage): string {
	return `${Math.round(usage.percent * 100)}%`;
}

/** 悬停说明：各部分估算 token，按接口返回的顺序展示。 */
export function contextPartsLabel(usage: AssistantContextUsage): string {
	return usage.parts
		.map((part) => `${PART_LABELS[part.id] ?? part.id} ${part.tokens}`)
		.join(" · ");
}

export function contextLevel(
	usage: AssistantContextUsage,
): AssistantContextLevel {
	if (usage.percent >= 0.95) return "danger";
	if (usage.percent >= 0.8) return "warn";
	return "ok";
}

/** 把省略的消息序号合并成区间：1-3、5、8-9。 */
export function formatOrdinalRanges(ids: readonly number[]): string {
	if (ids.length === 0) return "无";
	const ranges: string[] = [];
	let start = ids[0] as number;
	let previous = start;
	for (const id of ids.slice(1)) {
		if (id === previous + 1) {
			previous = id;
			continue;
		}
		ranges.push(start === previous ? String(start) : `${start}–${previous}`);
		start = id;
		previous = id;
	}
	ranges.push(start === previous ? String(start) : `${start}–${previous}`);
	return ranges.join("、");
}
