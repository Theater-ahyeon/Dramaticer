import type { ParsedBlock, ParsedContent } from "./types.js";

export interface ContextViewOptions {
	/** 当前楼层距离尾部的深度，0 表示最新一层；只影响 keep-depth 策略。 */
	readonly depth?: number;
}

/**
 * 把解析结果渲染成上下文视图：按块类型的上下文策略删除或保留内容。
 * 原文不受影响，视图每次从解析结果派生。
 */
export function renderContextView(
	content: readonly ParsedContent[],
	options: ContextViewOptions = {},
): string {
	const depth = options.depth ?? 0;
	if (!Number.isInteger(depth) || depth < 0) {
		throw new Error("上下文视图的深度必须是非负整数");
	}
	let text = "";
	for (const item of content) {
		text += item.kind === "text" ? item.text : renderBlock(item, depth);
	}
	return text;
}

function renderBlock(block: ParsedBlock, depth: number): string {
	const strategy = block.type.context;
	if (strategy.kind === "drop") return "";
	if (strategy.kind === "keep-depth" && depth >= strategy.depth) return "";
	if (strategy.kind === "compress") {
		throw new Error(`块 ${block.name} 的 compress 上下文策略尚未实现`);
	}
	const inner = renderContextView(block.content, { depth });
	return block.complete
		? `<${block.name}>${inner}</${block.name}>`
		: `<${block.name}>${inner}`;
}
