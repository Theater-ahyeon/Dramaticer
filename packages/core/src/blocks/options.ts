import { type BlockParserOptions, parseBlocks } from "./parser.js";
import type { ParsedContent } from "./types.js";

/** 选项块每行一个选项；界面点击与导出配对共用同一处切分规则。 */
export const OPTION_BLOCK_NAME = "选项";

/** 按出现顺序收集全部选项块里的非空行，行首尾空白去掉。 */
export function collectOptionLines(
	items: readonly ParsedContent[],
	out: string[],
): void {
	for (const item of items) {
		if (item.kind === "text") continue;
		if (item.name === OPTION_BLOCK_NAME) {
			for (const line of item.raw.split("\n")) {
				const trimmed = line.trim();
				if (trimmed.length > 0) out.push(trimmed);
			}
			continue;
		}
		collectOptionLines(item.content, out);
	}
}

/** 解析一段楼层原文并取出全部选项行。 */
export function readOptionLines(
	raw: string,
	options: BlockParserOptions = {},
): readonly string[] {
	const lines: string[] = [];
	collectOptionLines(parseBlocks(raw, options), lines);
	return lines;
}
