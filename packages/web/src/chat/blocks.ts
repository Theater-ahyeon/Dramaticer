import { OPTION_BLOCK_NAME, splitOptionLines } from "@dramaticer/core/blocks";
import type { DisplayedBlock, DisplayedContent } from "@dramaticer/protocol";

/** 块在聊天界面里的呈现方式。 */
export type BlockViewKind =
	| "thinking"
	| "options"
	| "header"
	| "whisper"
	| "narration"
	| "memo"
	| "status"
	| "analysis"
	| "html"
	| "hidden"
	| "raw";

/** 注册表里的原生组件名到界面呈现方式。没有对应组件的原生块按原文显示。 */
const NATIVE_VIEW_KINDS: Readonly<Record<string, BlockViewKind>> = {
	options: "options",
	status: "status",
	analysis: "analysis",
	header: "header",
	whisper: "whisper",
	narration: "narration",
	memo: "memo",
};

/** 显示策略由服务端的块注册表给出；没有策略的块按原文显示。 */
export function blockViewKind(block: DisplayedBlock): BlockViewKind {
	if (!block.complete) return "raw";
	if (block.name === "thinking") return "thinking";
	const display = block.display;
	if (display === null) return "raw";
	if (display.kind === "hidden") return "hidden";
	if (display.kind === "html") return "html";
	return NATIVE_VIEW_KINDS[display.component] ?? "raw";
}

/** 块内全部文字，按嵌套顺序拼接；用于提示与纯文本显示。 */
export function plainTextOf(items: readonly DisplayedContent[]): string {
	let text = "";
	for (const item of items) {
		text += item.kind === "text" ? item.text : plainTextOf(item.content);
	}
	return text;
}

export function optionLinesOf(block: DisplayedBlock): readonly string[] {
	const lines: string[] = [];
	collectOptionLines([block], lines);
	return lines;
}

function collectOptionLines(
	items: readonly DisplayedContent[],
	out: string[],
): void {
	for (const item of items) {
		if (item.kind === "text") continue;
		if (item.name === OPTION_BLOCK_NAME) {
			out.push(...splitOptionLines(item.raw));
			continue;
		}
		collectOptionLines(item.content, out);
	}
}

/** 图片块的内容是单个地址时直接显示；其他内容按原文显示。 */
export function imageSourceOf(raw: string): string | null {
	const value = raw.trim();
	if (/\s/.test(value)) return null;
	return /^(https?:\/\/|data:image\/)/.test(value) ? value : null;
}
