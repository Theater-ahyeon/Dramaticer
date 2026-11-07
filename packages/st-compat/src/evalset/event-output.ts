import path from "node:path";
import type { EventQuestion } from "./event-questions.js";
import { sanitizeFileName } from "./question-files.js";

export interface EvidenceExcerpt {
	readonly nodeId: string;
	readonly name: string;
	readonly text: string;
}

export function eventSpotcheckPath(
	outputRoot: string,
	storyId?: string,
): string {
	const fileName =
		storyId === undefined
			? "spotcheck.md"
			: `spotcheck-${sanitizeFileName(storyId)}.md`;
	return path.join(outputRoot, fileName);
}

export function eventSummaryPath(outputRoot: string, storyId?: string): string {
	const fileName =
		storyId === undefined
			? "event-summary.json"
			: `event-summary-${sanitizeFileName(storyId)}.json`;
	return path.join(outputRoot, fileName);
}

export function renderSpotcheck(
	questions: readonly EventQuestion[],
	total: number,
	excerpts: ReadonlyMap<string, EvidenceExcerpt>,
	generatedAt: string,
): string {
	const lines = [
		"# 事件题抽查",
		"",
		`生成时间：${generatedAt}`,
		`从 ${total} 道事件题里抽取 ${questions.length} 道（20%）。`,
		"用途：对照 `eval-private/raw/` 里的对话原文，核对问题、答案和证据楼层是否一致。这一项是可选的，不阻塞任何任务。",
		"",
	];
	for (const question of questions) {
		lines.push(`## ${question.id}`, "");
		lines.push(`- 故事：\`${question.story}\``);
		lines.push(`- 提问楼层：\`${question.askAtNode}\``);
		lines.push(`- 问题：${oneLine(question.question)}`);
		lines.push(`- 标准答案：${oneLine(question.answer)}`);
		lines.push(
			`- 证据楼层：${question.evidenceNodes.map((nodeId) => `\`${nodeId}\``).join("、")}`,
		);
		lines.push("");
		for (const nodeId of question.evidenceNodes) {
			const excerpt = excerpts.get(nodeId);
			if (!excerpt) {
				lines.push(`> \`${nodeId}\`（没有找到原文）`, "");
				continue;
			}
			lines.push(
				`> \`${nodeId}\` ${oneLine(excerpt.name)}：${oneLine(excerpt.text).slice(0, 400)}`,
				"",
			);
		}
	}
	return `${lines.join("\n")}\n`;
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}
