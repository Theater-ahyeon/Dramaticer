import type { TimelineNode } from "../timeline.js";

/** 摘要、事件抽取与 NPC 议程共用同一种楼层片段格式。 */
export function formatFloors(nodes: readonly TimelineNode[]): string {
	const lines = ["以下是按时间顺序排列的楼层："];
	for (const node of nodes) {
		lines.push(`<楼层 id="${node.id}" role="${node.role}">`);
		lines.push(node.raw);
		lines.push("</楼层>");
	}
	return lines.join("\n");
}
