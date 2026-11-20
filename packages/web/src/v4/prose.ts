// 书页排版用的小判断：对话段首行不缩进，引号顶格更像书。
const DIALOGUE_OPENERS = ["「", "『", "“", '"', "‘", "——", "—"];

/** 这一段是不是以引号或破折号开头的对话。 */
export function isDialogueLine(line: string): boolean {
	const text = line.trimStart();
	return DIALOGUE_OPENERS.some((opener) => text.startsWith(opener));
}
