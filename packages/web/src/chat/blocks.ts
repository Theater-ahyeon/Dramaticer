import {
	type BlockTypeRegistry,
	DEFAULT_BLOCK_TYPES,
	type ParsedBlock,
	type ParsedContent,
	collectOptionLines,
	createBlockTypeRegistry,
} from "@dramaticer/core/blocks";

/** 块在聊天界面里的呈现方式。 */
export type BlockViewKind =
	| "text"
	| "thinking"
	| "options"
	| "header"
	| "whisper"
	| "narration"
	| "memo"
	| "status"
	| "analysis"
	| "image"
	| "hidden"
	| "raw";

const registry: BlockTypeRegistry =
	createBlockTypeRegistry(DEFAULT_BLOCK_TYPES);

/** 注册表里的原生组件名到界面呈现方式。没有对应组件的原生块按原文显示。 */
const NATIVE_VIEW_KINDS: Readonly<Record<string, BlockViewKind>> = {
	options: "options",
	status: "status",
	analysis: "analysis",
	image: "image",
	header: "header",
	whisper: "whisper",
	narration: "narration",
	memo: "memo",
};

export function blockViewKind(block: ParsedBlock): BlockViewKind {
	if (!block.complete) return "raw";
	const type = registry.get(block.name);
	if (type === null) return "raw";
	if (type.name === "thinking") return "thinking";
	if (type.display.kind === "hidden") return "hidden";
	if (type.display.kind === "native") {
		return NATIVE_VIEW_KINDS[type.display.component] ?? "raw";
	}
	return "raw";
}

/** 块内全部文字，按嵌套顺序拼接；用于提示与纯文本显示。 */
export function plainTextOf(items: readonly ParsedContent[]): string {
	let text = "";
	for (const item of items) {
		text += item.kind === "text" ? item.text : plainTextOf(item.content);
	}
	return text;
}

export function optionLinesOf(block: ParsedBlock): readonly string[] {
	const lines: string[] = [];
	collectOptionLines([block], lines);
	return lines;
}

/** 图片块的内容是单个地址时直接显示；其他内容按原文显示。 */
export function imageSourceOf(raw: string): string | null {
	const value = raw.trim();
	if (/\s/.test(value)) return null;
	return /^(https?:\/\/|data:image\/)/.test(value) ? value : null;
}
